-- Add credits_reserved to profiles if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'credits_reserved') THEN
        ALTER TABLE profiles ADD COLUMN credits_reserved numeric DEFAULT 0;
    END IF;
END $$;

-- Create credit_ledger table
CREATE TABLE IF NOT EXISTS credit_ledger (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) NOT NULL,
  amount numeric NOT NULL,
  type text NOT NULL CHECK (type IN ('reserve', 'commit', 'release', 'purchase', 'admin_gift', 'refund')),
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create generation_jobs table
CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) NOT NULL,
  prediction_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending', -- pending, succeeded, failed, canceled
  model text,
  estimated_cost numeric,
  actual_cost numeric,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Users can read their own data)
DROP POLICY IF EXISTS "Users can view own ledger" ON credit_ledger;
CREATE POLICY "Users can view own ledger" ON credit_ledger FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view own jobs" ON generation_jobs;
CREATE POLICY "Users can view own jobs" ON generation_jobs FOR SELECT USING (auth.uid() = user_id);

-- RPC: reserve_credits (Atomic Check & Freeze)
CREATE OR REPLACE FUNCTION reserve_credits(
  p_user_id uuid,
  p_amount numeric,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance numeric;
  v_current_reserved numeric;
BEGIN
  -- Lock the user row to prevent race conditions
  SELECT credits, credits_reserved INTO v_current_balance, v_current_reserved
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  -- Check if user exists
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Init reserved if null
  IF v_current_reserved IS NULL THEN v_current_reserved := 0; END IF;

  -- Check balance
  IF v_current_balance >= p_amount THEN
    -- Deduct from available, add to reserved
    UPDATE profiles
    SET credits = credits - p_amount,
        credits_reserved = v_current_reserved + p_amount
    WHERE id = p_user_id;

    -- Log to ledger
    INSERT INTO credit_ledger (user_id, amount, type, meta)
    VALUES (p_user_id, -p_amount, 'reserve', p_meta);

    RETURN jsonb_build_object('success', true, 'remaining', v_current_balance - p_amount);
  ELSE
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'INSUFFICIENT_CREDITS', 
      'available', v_current_balance, 
      'required', p_amount
    );
  END IF;
END;
$$;

-- RPC: commit_credits (Finalize usage, release reserved)
CREATE OR REPLACE FUNCTION commit_credits(
  p_user_id uuid,
  p_amount numeric, -- Actual cost
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reserved_amount numeric; -- Amount we originally reserved
BEGIN
  -- Try to find the reservation amount from the matching prediction_id in meta if possible, 
  -- but for simplicity, we assume the caller passes the correct amount to 'commit' (finalize).
  -- In a strictly reserved system, we'd deduct p_amount from reserved.
  -- But here 'reserve' essentially ALREADY deducted from 'credits' and moved to 'reserved'.
  -- So 'commit' means: "Remove from reserved (burn it)".
  
  -- However, if Actual Cost < Estimated (Reserved), we need to Refund the difference.
  -- Let's simplify: Standard flow is Reserve X -> Commit X.
  -- If logic varies, we might need 'release_credits' for the difference.
  
  -- For this implementation: We just decrease credits_reserved. 
  -- The 'credits' (balance) was already reduced during reserve.
  
  UPDATE profiles
  SET credits_reserved = GREATEST(0, credits_reserved - p_amount)
  WHERE id = p_user_id;

  INSERT INTO credit_ledger (user_id, amount, type, meta)
  VALUES (p_user_id, 0, 'commit', p_meta); -- amount 0 because value already moved out of balance

  RETURN jsonb_build_object('success', true);
END;
$$;

-- RPC: release_credits (Refund/Cancel)
CREATE OR REPLACE FUNCTION release_credits(
  p_user_id uuid,
  p_amount numeric,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Move back from reserved to credits
  UPDATE profiles
  SET credits = credits + p_amount,
      credits_reserved = GREATEST(0, credits_reserved - p_amount)
  WHERE id = p_user_id;

  INSERT INTO credit_ledger (user_id, amount, type, meta)
  VALUES (p_user_id, p_amount, 'release', p_meta);

  RETURN jsonb_build_object('success', true, 'new_balance', (SELECT credits FROM profiles WHERE id = p_user_id));
END;
$$;

-- RPC: add_credits (Top-up)
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id uuid,
  p_amount numeric,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET credits = credits + p_amount
  WHERE id = p_user_id;

  INSERT INTO credit_ledger (user_id, amount, type, meta)
  VALUES (p_user_id, p_amount, 'purchase', p_meta);

  RETURN jsonb_build_object('success', true, 'new_balance', (SELECT credits FROM profiles WHERE id = p_user_id));
END;
$$;
