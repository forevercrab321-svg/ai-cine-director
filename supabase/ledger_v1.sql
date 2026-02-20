-- =====================================================
-- Ledger V1: Reserve → Finalize / Refund credit system
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1) Add credits_reserved column if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'profiles' AND column_name = 'credits_reserved') THEN
        ALTER TABLE profiles ADD COLUMN credits_reserved numeric DEFAULT 0;
    END IF;
END $$;

-- 2) Create credits_ledger table
CREATE TABLE IF NOT EXISTS credits_ledger (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) NOT NULL,
  delta numeric NOT NULL,          -- positive = add, negative = deduct
  kind text NOT NULL,              -- 'reserve','settle','refund','purchase'
  ref_type text,                   -- 'replicate','gemini','stripe'
  ref_id text,                     -- unique job reference
  status text DEFAULT 'pending',   -- 'pending','settled','refunded'
  created_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE credits_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own ledger" ON credits_ledger;
CREATE POLICY "Users can view own ledger" ON credits_ledger
  FOR SELECT USING (auth.uid() = user_id);

-- Allow service role full access (inserts from webhook)
DROP POLICY IF EXISTS "Service role full access" ON credits_ledger;
CREATE POLICY "Service role full access" ON credits_ledger
  FOR ALL USING (true) WITH CHECK (true);

-- 3) reserve_credits(amount, ref_type, ref_id)
--    Called by user-context client → auth.uid() is the user
--    Returns BOOLEAN: true = reserved, false = insufficient
CREATE OR REPLACE FUNCTION reserve_credits(
  amount numeric,
  ref_type text DEFAULT 'unknown',
  ref_id text DEFAULT ''
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance numeric;
  v_reserved numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT credits, COALESCE(credits_reserved, 0)
    INTO v_balance, v_reserved
    FROM profiles WHERE id = v_uid FOR UPDATE;

  IF NOT FOUND OR v_balance < amount THEN
    RETURN false;
  END IF;

  UPDATE profiles
  SET credits = credits - amount,
      credits_reserved = v_reserved + amount
  WHERE id = v_uid;

  INSERT INTO credits_ledger (user_id, delta, kind, ref_type, ref_id, status)
  VALUES (v_uid, -amount, 'reserve', ref_type, ref_id, 'pending');

  RETURN true;
END;
$$;

-- 4) finalize_reserve(ref_type, ref_id)
--    Job succeeded → burn the reserved amount (mark as settled)
CREATE OR REPLACE FUNCTION finalize_reserve(
  ref_type text,
  ref_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_amount numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT ABS(delta) INTO v_amount
    FROM credits_ledger
    WHERE user_id = v_uid
      AND credits_ledger.ref_type = finalize_reserve.ref_type
      AND credits_ledger.ref_id = finalize_reserve.ref_id
      AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE profiles
  SET credits_reserved = GREATEST(0, credits_reserved - v_amount)
  WHERE id = v_uid;

  UPDATE credits_ledger
  SET status = 'settled'
  WHERE user_id = v_uid
    AND credits_ledger.ref_type = finalize_reserve.ref_type
    AND credits_ledger.ref_id = finalize_reserve.ref_id
    AND status = 'pending';

  RETURN true;
END;
$$;

-- 5) refund_reserve(amount, ref_type, ref_id)
--    Job failed → return credits from reserved back to available
CREATE OR REPLACE FUNCTION refund_reserve(
  amount numeric,
  ref_type text,
  ref_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  UPDATE profiles
  SET credits = credits + amount,
      credits_reserved = GREATEST(0, credits_reserved - amount)
  WHERE id = v_uid;

  UPDATE credits_ledger
  SET status = 'refunded'
  WHERE user_id = v_uid
    AND credits_ledger.ref_type = refund_reserve.ref_type
    AND credits_ledger.ref_id = refund_reserve.ref_id
    AND status = 'pending';

  INSERT INTO credits_ledger (user_id, delta, kind, ref_type, ref_id, status)
  VALUES (v_uid, amount, 'refund', ref_type, ref_id, 'settled');

  RETURN true;
END;
$$;

-- 6) Keep old deduct_credits for backward compat (gemini route uses it)
--    This is a simple atomic deduct, no reserve/finalize cycle needed
--    for cheap operations like storyboard (cost=1)
