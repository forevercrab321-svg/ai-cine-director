# 🔧 Supabase 配置完整指南

## 📊 当前项目状态

- **项目URL**: https://gtxgkdsayswonlewqfzj.supabase.co
- **区域**: 生产环境 (PRODUCTION)
- **环境变量**: ✅ 已配置在 .env.local

---

## ✅ 必须完成的步骤

### Step 1: 验证数据库Schema已部署 ✓

```bash
# 检查是否有 profiles 表
cd /Users/monsterlee/Desktop/ai-cine-director

# 查看 schema.sql 是否已执行
cat supabase/schema.sql | head -20
```

**在 Supabase Dashboard 验证**:
1. 打开: https://app.supabase.com/project/gtxgkdsayswonlewqfzj/editor
2. 左侧菜单 → SQL Editor
3. 查看是否有表:
   - `profiles` ✓
   - `storyboards` ✓
   - `scenes` ✓

**如果没有表，执行以下步骤**:
```bash
# 方式 1: 使用 SQL Editor
# 1. 打开 SQL Editor
# 2. 新建 Query
# 3. 复制 supabase/schema.sql 的内容
# 4. 点击 "Run"

# 方式 2: 使用命令行 (需要安装 supabase-cli)
supabase db push
```

---

### Step 2: 验证 Row Level Security (RLS) 🔐

在 Supabase Dashboard 验证所有表已启用 RLS:

1. **Authentication** → **Policies**
2. 确认 `profiles`, `storyboards`, `scenes` 都有 Policies:
   - ✓ "Public profiles are viewable by everyone."
   - ✓ "Users can insert their own profile."
   - ✓ "Users can update own profile."
   - (等等)

**问题表现**:
- 如果没有 RLS 或 Policies，用户可能看不到自己的数据
- 或者看到其他用户的数据（安全风险！）

---

### Step 3: 设置 Trigger 自动创建用户Profile ✓

**在 Supabase Dashboard 验证**:

1. **SQL Editor** → **New Query**
2. 搜索或检查是否存在 `handle_new_user` trigger:

```sql
-- 验证 trigger 是否存在
SELECT trigger_name 
FROM information_schema.triggers 
WHERE trigger_schema = 'public' AND trigger_name = 'on_auth_user_created';
```

**如果不存在，运行**:
```sql
-- 创建 trigger 函数
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, role, credits)
  values (new.id, new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'role', 50);
  return new;
end;
$$ language plpgsql security definer;

-- 创建 trigger
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();
```

**验证**:
- 注册新用户时，`profiles` 表自动创建记录且 credits = 50

---

### Step 4: 验证认证配置 👤

在 Supabase Dashboard:

1. **Authentication** → **Providers**
2. 检查:
   - ✓ Email/Password 已启用 (应该默认启用)
   - 可选: 启用 OAuth (Google, GitHub 等)

---

### Step 5: 配置邮件发送（可选）📧

**当前状态**: Supabase 默认使用 Supabase 自己的 SMTP 发送邮件（无需配置）

**如果你看到 "Enable custom SMTP" 的警告**:
- 这是 **可选的**，只有你想使用自己的邮件服务器时才需要
- 默认情况下，Supabase 会使用他们自己的邮件服务

**推荐**: 保持默认设置即可

---

## 🧪 测试 Supabase 连接

### 测试 1: 前端能否连接到 Supabase

```typescript
// 在浏览器控制台运行
import { supabase } from './lib/supabaseClient';

// 测试连接
supabase.auth.getSession().then(({ data, error }) => {
  console.log('Session:', data?.session);
  console.log('Error:', error);
});
```

预期: 返回当前 session 或 null（未登录时）

---

### 测试 2: 注册和登录

```typescript
// 注册
const { data, error } = await supabase.auth.signUp({
  email: 'test@example.com',
  password: 'TestPassword123!'
});

console.log('Signup:', data, error);

// 登录
const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
  email: 'test@example.com',
  password: 'TestPassword123!'
});

console.log('Login:', loginData, loginError);
```

预期:
- ✓ Signup 返回 user 对象
- ✓ 同时自动创建 profile 记录
- ✓ Login 返回有效的 session

---

### 测试 3: 查询用户数据

```typescript
// 登录后运行
const { data, error } = await supabase
  .from('profiles')
  .select('*')
  .single();

console.log('Profile:', data);
// 应该返回:
// {
//   id: "...",
//   name: null,
//   credits: 50,
//   role: null,
//   is_pro: false,
//   created_at: "2024-01-01T..."
// }
```

---

### 测试 4: 检查 RLS 是否工作

```typescript
// 作为 User A 登录，查询其他 User B 的数据
// 应该返回空结果（RLS 保护）

// 或者尝试删除其他用户的数据
// 应该返回错误

const { error } = await supabase
  .from('profiles')
  .delete()
  .eq('id', 'other-user-id');

console.log(error); // 应该提示权限拒绝
```

---

## 🔍 常见问题排查

### ❌ 问题: "Missing Supabase environment variables"

**原因**: 前端无法读取 `VITE_SUPABASE_URL` 或 `VITE_SUPABASE_ANON_KEY`

**解决**:
```bash
# 检查 .env.local
cat .env.local | grep VITE_SUPABASE

# 应该看到:
# VITE_SUPABASE_URL=https://gtxgkdsayswonlewqfzj.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJ...
```

**重启 Vite**:
```bash
# 停止当前的 Vite 服务
# Ctrl+C

# 重新启动
npm run dev
```

---

### ❌ 问题: 注册后用户没有自动创建 Profile

**原因**: `handle_new_user` trigger 没有创建或执行失败

**检查**:
```sql
-- 在 Supabase SQL Editor 运行
SELECT * FROM auth.users LIMIT 1;
SELECT * FROM public.profiles LIMIT 1;
```

**解决**:
1. 如果 `auth.users` 有记录但 `profiles` 为空，说明 trigger 失败
2. 手动创建缺失的 profiles:

```sql
-- 为所有没有 profile 的用户创建 profile
INSERT INTO public.profiles (id, credits)
SELECT id, 50
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);
```

---

### ❌ 问题: "Insufficient permissions" 或 "RLS Policy Violation"

**原因**: RLS 拒绝了查询

**检查步骤**:
1. 确认用户已登录（JWT 有效）
2. 检查 Policies 是否正确配置
3. 验证 JWT 中的 `sub` 和查询条件匹配

**调试**:
```typescript
// 查看当前用户 ID
const { data: { user } } = await supabase.auth.getUser();
console.log('Current user:', user?.id);

// 查询应该包含正确的条件
const { data, error } = await supabase
  .from('storyboards')
  .select('*')
  .eq('user_id', user!.id);
```

---

## 📋 完整检查清单

- [ ] ✅ Supabase 项目已创建 (URL: https://gtxgkdsayswonlewqfzj.supabase.co)
- [ ] ✅ Environment 变量已配置在 .env.local
- [ ] Schema SQL 已执行 (tables: profiles, storyboards, scenes)
- [ ] RLS 已启用在所有表
- [ ] Policies 已创建
- [ ] Trigger `handle_new_user` 已创建
- [ ] 测试 Email/Password 登录
- [ ] 测试用户创建后自动获得 50 credits
- [ ] 测试 RLS (无法访问其他用户数据)
- [ ] 后端可以使用 SERVICE_ROLE_KEY 查询所有数据

---

## 🚀 下一步

1. **验证所有步骤**已完成
2. **启动开发服务**:
   ```bash
   npm run dev:all
   ```
3. **测试登录流程**
4. **查询 Supabase 数据**（使用浏览器控制台）

---

## 📞 快速命令

```bash
# 查看 Supabase 配置
grep -E "VITE_SUPABASE|SUPABASE_SERVICE" /Users/monsterlee/Desktop/ai-cine-director/.env.local

# 打开 SQL Editor
open "https://app.supabase.com/project/gtxgkdsayswonlewqfzj/sql"

# 打开 Database Editor
open "https://app.supabase.com/project/gtxgkdsayswonlewqfzj/editor"
```
