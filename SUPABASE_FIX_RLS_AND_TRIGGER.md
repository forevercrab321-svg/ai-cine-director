# 🔧 Supabase RLS & Trigger 修复指南

## 📊 当前诊断结果

```
✅ 环境变量已配置
✅ Supabase API 可访问
✅ 数据库表已创建 (profiles, storyboards, scenes)
⚠️  RLS 策略未配置
⚠️  Trigger 未创建
```

## 🚨 问题影响

### 1️⃣ RLS 策略未配置
**症状**:
- 所有用户都可能看到其他用户的数据（安全风险！）
- 某些查询可能失败

### 2️⃣ Trigger 未创建
**症状**:
- 新用户注册后，`profiles` 表不会自动创建记录
- 新用户的积分不会初始化为 50
- 应用会崩溃因为找不到用户的 profile

---

## ✅ 修复步骤

### Step 1: 创建 RLS 策略

**打开 Supabase Dashboard**:
1. 访问: https://app.supabase.com/project/gtxgkdsayswonlewqfzj/sql
2. 新建 Query
3. 复制以下 SQL 并运行:

```sql
-- ====================================================================
-- 为 profiles 表创建 RLS 策略
-- ====================================================================

-- 删除旧的策略（如果存在）
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;

-- 策略 1: 用户可以查看自己的 profile
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- 策略 2: 用户可以插入自己的 profile
CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- 策略 3: 用户可以更新自己的 profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- 策略 4: 后端服务可以访问所有 profiles (用于服务器端操作)
CREATE POLICY "Service role can access all profiles"
  ON profiles USING (auth.role() = 'service_role');
```

### Step 2: 创建 Trigger

在同一个 SQL Editor 中，继续运行:

```sql
-- ====================================================================
-- 创建 Trigger: 新用户注册时自动创建 Profile
-- ====================================================================

-- 1. 创建 trigger 函数
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, credits)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'name', new.email),
    50
  );
  RETURN new;
END;
$$;

-- 2. 删除旧的 trigger（如果存在）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 3. 创建新的 trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
```

### Step 3: 为现有用户创建 Profile（如果缺失）

如果已有用户但没有 profile，运行:

```sql
-- 为所有没有 profile 的用户创建 profile
INSERT INTO public.profiles (id, name, credits)
SELECT 
  u.id,
  COALESCE(u.raw_user_meta_data->>'name', u.email),
  50
FROM auth.users u
WHERE u.id NOT IN (SELECT id FROM public.profiles);

-- 验证
SELECT COUNT(*) FROM public.profiles;
```

### Step 4: 为 Storyboards 和 Scenes 创建 RLS 策略

```sql
-- ====================================================================
-- Storyboards 表的 RLS 策略
-- ====================================================================

DROP POLICY IF EXISTS "Users can view their own storyboards." ON public.storyboards;
DROP POLICY IF EXISTS "Users can insert their own storyboards." ON public.storyboards;
DROP POLICY IF EXISTS "Users can update their own storyboards." ON public.storyboards;
DROP POLICY IF EXISTS "Users can delete their own storyboards." ON public.storyboards;

CREATE POLICY "Users can view own storyboards"
  ON storyboards FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert storyboards"
  ON storyboards FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own storyboards"
  ON storyboards FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own storyboards"
  ON storyboards FOR DELETE
  USING (auth.uid() = user_id);

-- ====================================================================
-- Scenes 表的 RLS 策略
-- ====================================================================

DROP POLICY IF EXISTS "Users can view scenes from their storyboards." ON public.scenes;
DROP POLICY IF EXISTS "Users can insert scenes to their storyboards." ON public.scenes;
DROP POLICY IF EXISTS "Users can update scenes from their storyboards." ON public.scenes;
DROP POLICY IF EXISTS "Users can delete scenes from their storyboards." ON public.scenes;

CREATE POLICY "Users can view own scenes"
  ON scenes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.storyboards 
      WHERE storyboards.id = scenes.storyboard_id 
      AND storyboards.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert scenes"
  ON scenes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.storyboards 
      WHERE storyboards.id = storyboard_id 
      AND storyboards.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own scenes"
  ON scenes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.storyboards 
      WHERE storyboards.id = scenes.storyboard_id 
      AND storyboards.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own scenes"
  ON scenes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.storyboards 
      WHERE storyboards.id = scenes.storyboard_id 
      AND storyboards.user_id = auth.uid()
    )
  );
```

---

## ✅ 验证修复

运行以下 SQL 来验证所有策略和 trigger 已创建:

```sql
-- 1. 检查 Policies
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, policyname;

-- 应该返回 13+ 个 policies

-- 2. 检查 Trigger
SELECT trigger_schema, trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY trigger_name;

-- 应该看到: trigger_name = 'on_auth_user_created'

-- 3. 检查 Profiles 数据
SELECT id, name, credits, created_at FROM public.profiles LIMIT 5;
```

---

## 🧪 测试修复

### 测试 1: 注册新用户

1. 打开应用: http://localhost:3000
2. 点击 "Sign Up"
3. 输入新邮箱 (例: newuser123@example.com)
4. 输入密码并提交
5. 应该能登录并看到 50 积分

### 测试 2: 验证 RLS

```javascript
// 在浏览器控制台运行

// 作为 User A 登录后，尝试查询其他用户的 storyboard
const { data, error } = await supabase
  .from('storyboards')
  .select('*')
  .eq('user_id', 'OTHER_USER_ID');

console.log(data); // 应该是 null 或空数组
console.log(error); // 可能有权限错误
```

### 测试 3: 验证新用户 Profile 自动创建

```javascript
// 注册新用户后，检查 profile 是否自动创建

const { data: { user } } = await supabase.auth.getUser();
const { data: profile } = await supabase
  .from('profiles')
  .select('*')
  .eq('id', user.id)
  .single();

console.log(profile);
// 应该返回:
// {
//   id: "...",
//   name: "newuser123@example.com",
//   credits: 50,
//   is_pro: false,
//   created_at: "2024-..."
// }
```

---

## 🚀 后续步骤

完成以上修复后:

1. ✅ 运行诊断脚本验证: `bash scripts/diagnose-supabase-complete.sh`
2. ✅ 启动应用: `npm run dev:all`
3. ✅ 测试注册和登录流程
4. ✅ 检查积分系统是否工作

---

## 📝 快速参考

| 问题 | 解决方案 |
|------|--------|
| 新用户注册后没有 profile | 创建 `on_auth_user_created` trigger |
| 新用户没有 50 积分 | 检查 trigger 函数中的 `credits` 默认值 |
| 用户能看到其他用户数据 | 创建 RLS 策略 |
| 应用崩溃 (找不到 profile) | 为现有用户手动创建 profile |
| 某些操作被拒绝 | 检查 JWT token 和 RLS 策略 |
