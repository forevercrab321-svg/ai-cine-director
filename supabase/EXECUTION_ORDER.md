# Supabase SQL 执行顺序指南

## 当前数据库状态诊断

在执行任何SQL前，先在Supabase SQL Editor运行：

```sql
-- 检查当前数据库状态
SELECT 
  'profiles table' AS check_item,
  CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'profiles') 
    THEN '✅ EXISTS' ELSE '❌ NOT FOUND' END AS status
UNION ALL
SELECT 
  'credits_ledger table',
  CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'credits_ledger') 
    THEN '✅ EXISTS' ELSE '❌ NOT FOUND' END
UNION ALL
SELECT 
  'credits_reserved column',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'profiles' AND column_name = 'credits_reserved') 
    THEN '✅ EXISTS' ELSE '❌ NOT FOUND' END
UNION ALL
SELECT 
  'reserve_credits function',
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reserve_credits') 
    THEN '✅ EXISTS' ELSE '❌ NOT FOUND' END;
```

---

## 执行顺序

### 方案A：全新数据库（从零开始）

**Step 1: 基础表结构**
```bash
执行文件: schema.sql
功能: 创建 profiles, storyboards, scenes 表 + RLS policies
```

**Step 2: 积分账本系统**
```bash
执行文件: ledger_v1.sql
功能: 
- 添加 credits_reserved 字段
- 创建 credits_ledger 表
- 创建 reserve_credits, finalize_reserve, refund_reserve 函数
```

**Step 3: RPC辅助函数**
```bash
执行文件: rpc.sql
功能: 创建 deduct_credits 等辅助RPC函数
```

**Step 4: 负数余额防护（Bug Fix #3）**
```bash
执行文件: negative_balance_protection_fixed.sql  ✅ 新版本
功能:
- 添加 CHECK 约束 (credits >= 0)
- 创建监控函数 audit_negative_balances()
- 创建触发器 prevent_negative_credits()
- 不修改任何已存在的函数
```

---

### 方案B：已有数据库（只添加Bug Fix #3防护）

如果你已经运行过 `schema.sql` 和 `ledger_v1.sql`，只需：

```bash
执行文件: negative_balance_protection_fixed.sql
前置条件: 
  ✅ profiles 表已存在
  ✅ credits 字段已存在
  ⚠️ 不要求 credits_reserved 存在（脚本会自动检测）
```

---

## 常见错误及解决方案

### 错误1: "cannot remove parameter defaults from existing function"

**原因**: 尝试修改已存在函数的参数默认值  
**解决**: 使用 `negative_balance_protection_fixed.sql` - 它**不修改**reserve_credits

### 错误2: "relation 'profiles' already exists"

**原因**: 重复执行 schema.sql  
**解决**: 跳过 schema.sql，直接执行后续脚本

### 错误3: "Failed to perform authorization check"

**原因**: RLS策略冲突或权限不足  
**解决**: 
1. 在Supabase Dashboard用Service Role身份执行
2. 或临时禁用RLS: `ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;`

---

## 验证步骤

### 1. 检查约束是否生效
```sql
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'credits_non_negative';
```
预期输出: `(credits >= 0)`

### 2. 检查是否有负数余额
```sql
SELECT * FROM audit_negative_balances();
```
预期输出: `0 rows` (没有负数余额)

### 3. 测试约束（应该失败）
```sql
-- 这条语句应该报错
UPDATE profiles SET credits = -100 WHERE id = auth.uid();
```
预期错误: `NEGATIVE_CREDITS_BLOCKED: Attempted to set credits to -100`

### 4. 查看所有用户余额
```sql
SELECT 
  p.id, 
  u.email, 
  p.credits, 
  p.is_admin,
  COALESCE(p.credits_reserved, 0) AS reserved
FROM profiles p
LEFT JOIN auth.users u ON p.id = u.id
ORDER BY p.credits DESC
LIMIT 20;
```

---

## 紧急修复命令

如果发现负数余额：

```sql
-- 查看所有负数余额
SELECT * FROM audit_negative_balances();

-- 自动修复所有负数（重置为0）
SELECT * FROM emergency_fix_negative_balances();
```

---

## 当前推荐执行

根据你的截图错误，推荐执行：

```bash
❌ 不要用: negative_balance_protection.sql (旧版本，会报错)
✅ 使用新版: negative_balance_protection_fixed.sql
```

**执行方法**:
1. 打开 Supabase Dashboard
2. 进入 SQL Editor
3. 复制 `negative_balance_protection_fixed.sql` 全部内容
4. 粘贴并点击 RUN
5. 查看执行日志确认成功

**预期输出**:
```
NOTICE:  Added CHECK constraint: credits >= 0
NOTICE:  No negative credits found - database is clean
NOTICE:  Skipped credits_reserved constraint (field does not exist)
NOTICE:  ====== VALIDATION REPORT ======
NOTICE:  Total profiles: X
NOTICE:  Negative balances: 0
NOTICE:  ✅ SUCCESS: All credit balances are non-negative
```
