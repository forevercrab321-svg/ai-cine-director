# 🚀 Supabase 快速修复 (5分钟)

## 🎯 目标
修复 RLS 策略和 Trigger，使应用完全正常工作

## ⚡ 快速步骤

### 1️⃣ 打开 Supabase SQL Editor
```
https://app.supabase.com/project/gtxgkdsayswonlewqfzj/sql
```

### 2️⃣ 复制并运行以下 SQL（全部一起运行）

```sql
-- ====================================================================
-- 1. 创建 Profiles RLS 策略
-- ====================================================================

DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;

CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Service role can access all profiles"
  ON profiles USING (auth.role() = 'service_role');

-- ====================================================================
-- 2. 创建 Trigger（新用户自动创建 Profile）
-- ====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, name, credits)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'name', new.email), 50);
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ====================================================================
-- 3. Storyboards RLS 策略
-- ====================================================================

DROP POLICY IF EXISTS "Users can view their own storyboards." ON public.storyboards;
DROP POLICY IF EXISTS "Users can insert their own storyboards." ON public.storyboards;
DROP POLICY IF EXISTS "Users can update their own storyboards." ON public.storyboards;
DROP POLICY IF EXISTS "Users can delete their own storyboards." ON public.storyboards;

CREATE POLICY "Users can view own storyboards" ON storyboards
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert storyboards" ON storyboards
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own storyboards" ON storyboards
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own storyboards" ON storyboards
  FOR DELETE USING (auth.uid() = user_id);

-- ====================================================================
-- 4. Scenes RLS 策略
-- ====================================================================

DROP POLICY IF EXISTS "Users can view scenes from their storyboards." ON public.scenes;
DROP POLICY IF EXISTS "Users can insert scenes to their storyboards." ON public.scenes;
DROP POLICY IF EXISTS "Users can update scenes from their storyboards." ON public.scenes;
DROP POLICY IF EXISTS "Users can delete scenes from their storyboards." ON public.scenes;

CREATE POLICY "Users can view own scenes" ON scenes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.storyboards 
    WHERE storyboards.id = scenes.storyboard_id AND storyboards.user_id = auth.uid())
  );
CREATE POLICY "Users can insert scenes" ON scenes
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.storyboards 
    WHERE storyboards.id = storyboard_id AND storyboards.user_id = auth.uid())
  );
CREATE POLICY "Users can update own scenes" ON scenes
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.storyboards 
    WHERE storyboards.id = scenes.storyboard_id AND storyboards.user_id = auth.uid())
  );
CREATE POLICY "Users can delete own scenes" ON scenes
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.storyboards 
    WHERE storyboards.id = scenes.storyboard_id AND storyboards.user_id = auth.uid())
  );

-- ====================================================================
-- 5. 为现有用户创建缺失的 Profiles
-- ====================================================================

INSERT INTO public.profiles (id, name, credits)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'name', u.email), 50
FROM auth.users u
WHERE u.id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

-- ====================================================================
-- 验证
-- ====================================================================

SELECT COUNT(*) as profiles_count FROM public.profiles;
SELECT COUNT(*) as policies_count FROM pg_policies WHERE schemaname = 'public';
```

### 3️⃣ 验证成功
```bash
# 运行诊断脚本
cd /Users/monsterlee/Desktop/ai-cine-director
bash scripts/diagnose-supabase-complete.sh

# 应该看到全 ✅ 通过
```

### 4️⃣ 启动应用
```bash
npm run dev:all
```

### 5️⃣ 测试
1. 打开 http://localhost:3000
2. 注册新用户
3. 应该看到 50 积分✅

---

## 🔍 如果出错

| 错误 | 解决 |
|-----|-----|
| "duplicate key" | 表示 trigger 已存在，继续运行其他部分 |
| "Policy already exists" | 正常，DROP 会删除旧的 |
| "权限拒绝" | 检查是否使用了 Service Role Key |

---

## ✅ 完成标志

- [ ] SQL 运行无错误
- [ ] `diagnose-supabase-complete.sh` 全部 ✅
- [ ] 能注册新用户
- [ ] 新用户有 50 积分

完成后，应用就完全就绪了！ 🎉
