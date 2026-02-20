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
--    ★ FIXED: Refactored to absolute atomic UPDATE to prevent Race Conditions
DROP FUNCTION IF EXISTS reserve_credits(numeric, text, text);
DROP FUNCTION IF EXISTS reserve_credits(uuid, numeric, jsonb);
CREATE OR REPLACE FUNCTION reserve_credits(
  amount numeric,
  ref_type text DEFAULT 'unknown',
  ref_id text DEFAULT ''
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  affected_rows integer;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  -- ★ 核心防御：直接 UPDATE，并加上 credits >= amount 的严格条件，不给并发留任何空隙
  UPDATE profiles
  SET credits = credits - amount,
      credits_reserved = COALESCE(credits_reserved, 0) + amount
  WHERE id = v_uid 
    AND credits >= amount;

  -- 检查上一条 UPDATE 语句是否成功修改了数据
  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  -- 如果影响的行数是 0，说明要么用户不存在，要么余额不足以扣减，直接拦截
  IF affected_rows = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO credits_ledger (user_id, delta, kind, ref_type, ref_id, status)
  VALUES (v_uid, -amount, 'reserve', ref_type, ref_id, 'pending');

  RETURN true;
END;
$$;

-- 4) finalize_reserve(ref_type, ref_id)
DROP FUNCTION IF EXISTS finalize_reserve(text, text);
DROP FUNCTION IF EXISTS commit_credits(uuid, numeric, jsonb);
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
DROP FUNCTION IF EXISTS refund_reserve(numeric, text, text);
DROP FUNCTION IF EXISTS release_credits(uuid, numeric, jsonb);
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

-- 7) Safety: Fix any existing negative credits in DB
UPDATE profiles SET credits = 0 WHERE credits < 0;

-- 8) DB-level constraint: prevent credits going below 0
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS credits_non_negative;
ALTER TABLE profiles ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);