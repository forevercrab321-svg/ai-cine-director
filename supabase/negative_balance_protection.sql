-- =====================================================
-- Bug Fix #3: 负数余额后端防护增强
-- 确保Credit系统绝对不会出现负数余额
-- =====================================================

-- 1. 添加数据库约束 - 硬性防止负数
ALTER TABLE profiles 
  DROP CONSTRAINT IF EXISTS credits_non_negative;

ALTER TABLE profiles 
  ADD CONSTRAINT credits_non_negative 
  CHECK (credits >= 0);

-- 2. 修复任何现有的负数余额
UPDATE profiles SET credits = 0 WHERE credits < 0;

-- 3. 添加credits_reserved的约束（如果字段存在）
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'profiles' AND column_name = 'credits_reserved') THEN
    ALTER TABLE profiles 
      DROP CONSTRAINT IF EXISTS credits_reserved_non_negative;
    
    ALTER TABLE profiles 
      ADD CONSTRAINT credits_reserved_non_negative 
      CHECK (credits_reserved >= 0);
    
    UPDATE profiles SET credits_reserved = 0 WHERE credits_reserved < 0;
  END IF;
END $$;

-- 4. 创建辅助函数：安全检查余额
DROP FUNCTION IF EXISTS public.check_sufficient_balance(uuid, numeric);

CREATE OR REPLACE FUNCTION public.check_sufficient_balance(
  user_id uuid,
  required_amount numeric
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  current_balance numeric;
BEGIN
  SELECT credits INTO current_balance 
  FROM profiles 
  WHERE id = user_id
  FOR UPDATE;  -- 行级锁，防止并发

  RETURN current_balance >= required_amount;
END;
$$;

-- 5. 增强reserve_credits函数 - 添加额外验证
-- ★ 先DROP旧函数，避免参数默认值冲突
DROP FUNCTION IF EXISTS public.reserve_credits(numeric, text, text);
DROP FUNCTION IF EXISTS public.reserve_credits(numeric);

CREATE OR REPLACE FUNCTION reserve_credits(
  amount numeric,
  ref_type text DEFAULT 'unknown',
  ref_id text DEFAULT ''
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_uid uuid := auth.uid();
  affected_rows integer;
  current_balance numeric;
BEGIN
  -- 验证用户已登录
  IF v_uid IS NULL THEN 
    RAISE NOTICE 'reserve_credits: User not authenticated';
    RETURN false; 
  END IF;

  -- 验证金额为正数
  IF amount <= 0 THEN
    RAISE NOTICE 'reserve_credits: Invalid amount %', amount;
    RETURN false;
  END IF;

  -- ★ 双重检查：先查询当前余额（带行锁）
  SELECT credits INTO current_balance
  FROM profiles
  WHERE id = v_uid
  FOR UPDATE;  -- 锁住这一行，防止并发修改

  IF current_balance IS NULL THEN
    RAISE NOTICE 'reserve_credits: User profile not found';
    RETURN false;
  END IF;

  IF current_balance < amount THEN
    RAISE NOTICE 'reserve_credits: Insufficient balance. Required: %, Available: %', amount, current_balance;
    RETURN false;
  END IF;

  -- ★ 核心防御：原子性UPDATE with WHERE条件
  UPDATE profiles
  SET credits = credits - amount,
      credits_reserved = COALESCE(credits_reserved, 0) + amount
  WHERE id = v_uid 
    AND credits >= amount;  -- 再次验证，确保万无一失

  -- 检查UPDATE是否成功
  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  IF affected_rows = 0 THEN
    RAISE NOTICE 'reserve_credits: UPDATE failed (race condition or insufficient balance)';
    RETURN false;
  END IF;

  -- 记录到ledger
  INSERT INTO credits_ledger (user_id, delta, kind, ref_type, ref_id, status)
  VALUES (v_uid, -amount, 'reserve', ref_type, ref_id, 'pending');

  RAISE NOTICE 'reserve_credits: Success. Deducted % credits. Remaining: %', amount, current_balance - amount;
  RETURN true;
END;
$$;

-- 6. 创建监控函数：检查系统中是否有负数余额
DROP FUNCTION IF EXISTS public.audit_negative_balances();

CREATE OR REPLACE FUNCTION public.audit_negative_balances()
RETURNS TABLE(
  user_id uuid,
  credits numeric,
  credits_reserved numeric,
  email text
) 
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.credits,
    p.credits_reserved,
    u.email
  FROM profiles p
  LEFT JOIN auth.users u ON p.id = u.id
  WHERE p.credits < 0 OR p.credits_reserved < 0
  ORDER BY p.credits ASC;
END;
$$;

-- 7. 创建自动修复函数（定期运行或手动触发）
DROP FUNCTION IF EXISTS public.auto_fix_negative_balances();

CREATE OR REPLACE FUNCTION public.auto_fix_negative_balances()
RETURNS TABLE(
  fixed_user_id uuid,
  old_balance numeric,
  new_balance numeric
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH fixed AS (
    UPDATE profiles
    SET credits = 0,
        credits_reserved = GREATEST(0, credits_reserved)
    WHERE credits < 0 OR credits_reserved < 0
    RETURNING id, credits AS old_credits, 0 AS new_credits
  )
  SELECT * FROM fixed;
END;
$$;

-- 8. 添加触发器：在INSERT/UPDATE时自动验证
DROP FUNCTION IF EXISTS public.prevent_negative_credits() CASCADE;

CREATE OR REPLACE FUNCTION public.prevent_negative_credits()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- 确保credits不为负
  IF NEW.credits < 0 THEN
    RAISE EXCEPTION 'Cannot set negative credits: %', NEW.credits;
  END IF;

  -- 确保credits_reserved不为负（如果字段存在）
  IF TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'profiles' THEN
    IF (SELECT column_name FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'credits_reserved') IS NOT NULL 
       AND NEW.credits_reserved < 0 THEN
      RAISE EXCEPTION 'Cannot set negative credits_reserved: %', NEW.credits_reserved;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_non_negative_credits ON profiles;
CREATE TRIGGER enforce_non_negative_credits
  BEFORE INSERT OR UPDATE OF credits, credits_reserved ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_negative_credits();

-- 9. 测试查询
-- 运行以下查询验证防护是否生效：

-- 查看当前是否有负数余额
-- SELECT * FROM audit_negative_balances();

-- 手动修复所有负数（如果有）
-- SELECT * FROM auto_fix_negative_balances();

-- 测试reserve_credits是否正确拒绝不足余额的请求
-- SELECT reserve_credits(1000000, 'test', 'test-ref-123');  
-- 预期: 返回false，并在日志中显示 "Insufficient balance"

COMMENT ON CONSTRAINT credits_non_negative ON profiles IS 
  'Prevents negative credit balances at database level (Bug Fix #3)';

COMMENT ON FUNCTION reserve_credits IS 
  'Enhanced with dual-check protection against negative balances (Bug Fix #3)';

-- 完成
SELECT 'Bug Fix #3: Negative balance protection installed successfully' AS status;
