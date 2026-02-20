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

-- RPC: reserve_credits (Atomic Check & Freeze - 终极防并发版)
CREATE OR REPLACE FUNCTION reserve_credits(
  p_user_id uuid,
  p_amount numeric,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated_balance numeric;
BEGIN
  -- 核心防御：直接使用原子的 UPDATE 并带有余额条件，利用 RETURNING 捕获更新后的余额
  UPDATE profiles
  SET credits = credits - p_amount,
      credits_reserved = COALESCE(credits_reserved, 0) + p_amount
  WHERE id = p_user_id AND credits >= p_amount
  RETURNING credits INTO v_updated_balance;

  -- 如果 v_updated_balance 不是 NULL，说明更新成功（余额充足）
  IF v_updated_balance IS NOT NULL THEN
    -- 记录到账本
    INSERT INTO credit_ledger (user_id, amount, type, meta)
    VALUES (p_user_id, -p_amount, 'reserve', p_meta);

    RETURN jsonb_build_object('success', true, 'remaining', v_updated_balance);
  ELSE
    -- 更新失败（要么用户不存在，要么余额不足以扣除）
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'INSUFFICIENT_CREDITS', 
      'available', COALESCE((SELECT credits FROM profiles WHERE id = p_user_id), 0), 
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
BEGIN
  UPDATE profiles
  SET credits_reserved = GREATEST(0, credits_reserved - p_amount)
  WHERE id = p_user_id;

  INSERT INTO credit_ledger (user_id, amount, type, meta)
  VALUES (p_user_id, 0, 'commit', p_meta);

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