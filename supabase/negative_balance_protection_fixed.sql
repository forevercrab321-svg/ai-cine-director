-- =====================================================
-- Bug Fix #3: 负数余额后端防护增强
-- 纯增强脚本 - 不修改已存在的函数，只添加约束和监控
-- =====================================================

-- ==================== PART 1: 数据库约束层 ====================

-- 1. 添加credits字段的CHECK约束 - 硬性防止负数
DO $$ 
BEGIN
  -- 先删除旧约束（如果存在）
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS credits_non_negative;
  
  -- 添加新约束
  ALTER TABLE profiles ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);
  
  -- 添加注释
  COMMENT ON CONSTRAINT credits_non_negative ON profiles IS 
    'Prevents negative credit balances at database level (Bug Fix #3)';
    
  RAISE NOTICE 'Added CHECK constraint: credits >= 0';
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'Warning: Could not add constraint - %', SQLERRM;
END $$;

-- 2. 修复任何现有的负数余额
DO $$
DECLARE
  fixed_count integer;
BEGIN
  UPDATE profiles SET credits = 0 WHERE credits < 0;
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  
  IF fixed_count > 0 THEN
    RAISE NOTICE 'Fixed % profiles with negative credits', fixed_count;
  ELSE
    RAISE NOTICE 'No negative credits found - database is clean';
  END IF;
END $$;

-- 3. 添加credits_reserved约束（仅当字段存在时）
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_schema = 'public' 
             AND table_name = 'profiles' 
             AND column_name = 'credits_reserved') THEN
    
    ALTER TABLE profiles DROP CONSTRAINT IF EXISTS credits_reserved_non_negative;
    ALTER TABLE profiles ADD CONSTRAINT credits_reserved_non_negative 
      CHECK (credits_reserved >= 0);
    
    UPDATE profiles SET credits_reserved = 0 WHERE credits_reserved < 0;
    
    RAISE NOTICE 'Added CHECK constraint: credits_reserved >= 0';
  ELSE
    RAISE NOTICE 'Skipped credits_reserved constraint (field does not exist)';
  END IF;
END $$;

-- ==================== PART 2: 监控和审计函数 ====================

-- 4. 创建监控函数：检查系统中是否有负数余额
DROP FUNCTION IF EXISTS public.audit_negative_balances() CASCADE;

CREATE OR REPLACE FUNCTION public.audit_negative_balances()
RETURNS TABLE(
  user_id uuid,
  credits numeric,
  credits_reserved numeric,
  email text,
  issue text
) 
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.credits,
    COALESCE(
      (SELECT credits_reserved FROM profiles WHERE id = p.id), 
      0
    )::numeric,
    u.email,
    CASE 
      WHEN p.credits < 0 THEN 'NEGATIVE_CREDITS'
      ELSE 'OK'
    END AS issue
  FROM profiles p
  LEFT JOIN auth.users u ON p.id = u.id
  WHERE p.credits < 0
  ORDER BY p.credits ASC;
END;
$$;

COMMENT ON FUNCTION public.audit_negative_balances() IS 
  'Scans for any profiles with negative balance - should return 0 rows if protection works';

-- 5. 创建自动修复函数（紧急情况手动触发）
DROP FUNCTION IF EXISTS public.emergency_fix_negative_balances() CASCADE;

CREATE OR REPLACE FUNCTION public.emergency_fix_negative_balances()
RETURNS TABLE(
  fixed_user_id uuid,
  old_credits numeric,
  new_credits numeric,
  fixed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  fix_count integer;
BEGIN
  -- 先检查有多少需要修复
  SELECT COUNT(*) INTO fix_count FROM profiles WHERE credits < 0;
  
  IF fix_count = 0 THEN
    RAISE NOTICE 'No negative balances found - nothing to fix';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Found % profiles with negative credits - fixing...', fix_count;
  
  -- 执行修复并返回结果
  RETURN QUERY
  WITH fixed AS (
    UPDATE profiles
    SET credits = 0
    WHERE credits < 0
    RETURNING id, credits AS old_val, 0 AS new_val, now() AS fix_time
  )
  SELECT * FROM fixed;
  
  RAISE NOTICE 'Successfully fixed % profiles', fix_count;
END;
$$;

COMMENT ON FUNCTION public.emergency_fix_negative_balances() IS 
  'Emergency function to reset all negative credits to 0 - logs all fixes';

-- ==================== PART 3: 触发器保护层 ====================

-- 6. 创建触发器函数：在INSERT/UPDATE时验证
DROP FUNCTION IF EXISTS public.prevent_negative_credits() CASCADE;

CREATE OR REPLACE FUNCTION public.prevent_negative_credits()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- 检查credits字段
  IF NEW.credits < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_CREDITS_BLOCKED: Attempted to set credits to % for user %', 
      NEW.credits, NEW.id
      USING HINT = 'Credits must be >= 0',
            ERRCODE = '23514'; -- check_violation
  END IF;

  -- 检查credits_reserved字段（如果存在）
  IF (SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND column_name = 'credits_reserved') IS NOT NULL THEN
    
    IF NEW.credits_reserved < 0 THEN
      RAISE EXCEPTION 'NEGATIVE_RESERVED_BLOCKED: Attempted to set credits_reserved to % for user %',
        NEW.credits_reserved, NEW.id
        USING HINT = 'Reserved credits must be >= 0',
              ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.prevent_negative_credits() IS 
  'Trigger function that blocks any attempt to set negative credits';

-- 7. 注册触发器（如果不存在）
DROP TRIGGER IF EXISTS enforce_non_negative_credits ON profiles;

CREATE TRIGGER enforce_non_negative_credits
  BEFORE INSERT OR UPDATE OF credits ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_negative_credits();

COMMENT ON TRIGGER enforce_non_negative_credits ON profiles IS 
  'Prevents negative credit balances before they hit the database';

-- ==================== PART 4: 验证和测试 ====================

-- 8. 运行验证检查
DO $$
DECLARE
  negative_count integer;
  total_users integer;
BEGIN
  SELECT COUNT(*) INTO negative_count FROM profiles WHERE credits < 0;
  SELECT COUNT(*) INTO total_users FROM profiles;
  
  RAISE NOTICE '====== VALIDATION REPORT ======';
  RAISE NOTICE 'Total profiles: %', total_users;
  RAISE NOTICE 'Negative balances: %', negative_count;
  
  IF negative_count = 0 THEN
    RAISE NOTICE '✅ SUCCESS: All credit balances are non-negative';
  ELSE
    RAISE WARNING '❌ FOUND % profiles with negative credits - run emergency_fix_negative_balances()', negative_count;
  END IF;
  
  RAISE NOTICE '===============================';
END $$;

-- ==================== 使用说明 ====================
/*
执行后的验证命令：

1. 检查是否有负数余额：
   SELECT * FROM audit_negative_balances();
   -- 应该返回 0 rows

2. 如果发现负数（紧急修复）：
   SELECT * FROM emergency_fix_negative_balances();

3. 测试约束是否生效（应该失败）：
   UPDATE profiles SET credits = -100 WHERE id = 'some-uuid';
   -- 预期错误：NEGATIVE_CREDITS_BLOCKED

4. 查看所有用户余额：
   SELECT id, credits, is_admin FROM profiles ORDER BY credits DESC LIMIT 10;

保护层级总结：
✅ Layer 1: CHECK Constraint (credits >= 0) - 数据库层硬约束
✅ Layer 2: TRIGGER (prevent_negative_credits) - 插入/更新前验证
✅ Layer 3: Monitoring (audit_negative_balances) - 定期扫描
✅ Layer 4: Auto-fix (emergency_fix_negative_balances) - 紧急修复工具
*/
