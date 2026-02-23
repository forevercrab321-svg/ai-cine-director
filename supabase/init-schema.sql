-- ====================================================================
-- AI Cine Director - Supabase Schema 初始化脚本
-- ====================================================================
-- 
-- 运行步骤:
-- 1. 打开 Supabase Dashboard SQL Editor
--    https://app.supabase.com/project/gtxgkdsayswonlewqfzj/sql
-- 2. 创建新 Query
-- 3. 复制并粘贴本脚本
-- 4. 点击 "Run" 按钮
--
-- ====================================================================

-- ✓ 步骤 1: 创建 profiles 表（用户信息和积分）
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  role text,
  credits integer NOT NULL DEFAULT 50 CHECK (credits >= 0),
  is_pro boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ✓ 步骤 2: 为 profiles 表创建 RLS 策略
-- ====================================================================

-- 允许用户查看自己的 profile
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

-- 允许用户更新自己的 profile
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- 允许用户插入自己的 profile (由 trigger 处理)
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 允许后端服务角色访问所有 profiles
CREATE POLICY "Service role can access all profiles" ON public.profiles
  USING (auth.role() = 'service_role');

-- ✓ 步骤 3: 创建 storyboards 表（故事板项目）
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.storyboards (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  visual_style text,
  character_anchor text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.storyboards ENABLE ROW LEVEL SECURITY;

-- Storyboard RLS 策略
CREATE POLICY "Users can view own storyboards" ON public.storyboards
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert storyboards" ON public.storyboards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own storyboards" ON public.storyboards
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own storyboards" ON public.storyboards
  FOR DELETE USING (auth.uid() = user_id);

-- ✓ 步骤 4: 创建 scenes 表（场景详情）
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.scenes (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  storyboard_id uuid NOT NULL REFERENCES public.storyboards(id) ON DELETE CASCADE,
  scene_number integer NOT NULL,
  visual_description text,
  audio_description text,
  shot_type text,
  image_prompt text,
  video_motion_prompt text,
  image_url text,
  video_url text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;

-- Scenes RLS 策略
CREATE POLICY "Users can view own scenes" ON public.scenes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.storyboards 
      WHERE storyboards.id = scenes.storyboard_id 
      AND storyboards.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert scenes" ON public.scenes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.storyboards 
      WHERE storyboards.id = storyboard_id 
      AND storyboards.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own scenes" ON public.scenes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.storyboards 
      WHERE storyboards.id = scenes.storyboard_id 
      AND storyboards.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own scenes" ON public.scenes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.storyboards 
      WHERE storyboards.id = scenes.storyboard_id 
      AND storyboards.user_id = auth.uid()
    )
  );

-- ✓ 步骤 5: 创建 Trigger - 新用户注册时自动创建 Profile
-- ====================================================================

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

-- 删除旧的 trigger（如果存在）
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 创建新的 trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ✓ 步骤 6: 创建积分日志表（可选，用于审计）
-- ====================================================================

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own credit ledger" ON public.credit_ledger
  FOR SELECT USING (auth.uid() = user_id);

-- ====================================================================
-- ✅ 初始化完成
-- ====================================================================
--
-- 验证步骤：
-- 
-- 1. 查询表是否创建成功:
--    SELECT * FROM information_schema.tables 
--    WHERE table_schema = 'public';
--
-- 2. 查询 RLS 策略:
--    SELECT * FROM pg_policies 
--    WHERE schemaname = 'public';
--
-- 3. 查询 trigger:
--    SELECT * FROM pg_trigger 
--    WHERE tgrelname = 'users';
--
-- 4. 测试新用户注册:
--    - 在应用中注册新用户
--    - 查询: SELECT * FROM public.profiles WHERE id = 'user-id'
--    - 应该看到 credits = 50
--
-- ====================================================================
