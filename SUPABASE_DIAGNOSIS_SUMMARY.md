# 📊 Supabase 诊断 & 修复总结

## 🔍 诊断结果（2024-02-23）

```
✅ 环境变量已配置 (VITE_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY)
✅ Supabase API 连接正常 (HTTP 401 - 正常响应)
✅ 数据库表已创建:
   - profiles
   - storyboards
   - scenes
⚠️  RLS 策略未配置 (需要修复)
⚠️  Trigger 未创建 (需要修复)
```

---

## 🎯 需要修复的问题

### 问题 1: RLS 策略缺失
**症状**:
- 所有用户可能看到其他用户的数据（🚨 安全风险！）
- 应用可能允许跨用户数据访问

**修复**: 创建 RLS 策略限制用户只能访问自己的数据

### 问题 2: Trigger 缺失
**症状**:
- 新用户注册后，`profiles` 表不会自动创建记录
- 新用户没有初始的 50 积分
- 应用会因找不到 profile 而崩溃

**修复**: 创建 `on_auth_user_created` trigger 自动创建 profile

---

## 📋 修复文档

我已为你创建了以下文档和脚本：

| 文件 | 目的 |
|------|------|
| [SUPABASE_QUICK_FIX.md](SUPABASE_QUICK_FIX.md) | ⚡ 5分钟快速修复（推荐） |
| [SUPABASE_FIX_RLS_AND_TRIGGER.md](SUPABASE_FIX_RLS_AND_TRIGGER.md) | 📖 详细修复指南 |
| [SUPABASE_SETUP_GUIDE.md](SUPABASE_SETUP_GUIDE.md) | 🔧 完整配置指南 |
| [supabase/init-schema.sql](supabase/init-schema.sql) | 📄 完整 Schema 初始化脚本 |
| [supabase/FIXES.json](supabase/FIXES.json) | 📋 所有修复 SQL 脚本集合 |
| [scripts/diagnose-supabase-complete.sh](scripts/diagnose-supabase-complete.sh) | 🧪 诊断脚本 |

---

## ⚡ 快速开始（推荐）

### Step 1: 修复 Supabase 配置
1. 打开: https://app.supabase.com/project/gtxgkdsayswonlewqfzj/sql
2. 新建 Query
3. 复制 [SUPABASE_QUICK_FIX.md](SUPABASE_QUICK_FIX.md) 中的所有 SQL
4. 运行（Ctrl+Enter）
5. 等待完成（无错误）

### Step 2: 验证修复
```bash
cd /Users/monsterlee/Desktop/ai-cine-director
bash scripts/diagnose-supabase-complete.sh
```

应该看到所有 ✅ 通过

### Step 3: 启动应用
```bash
npm run dev:all
```

### Step 4: 测试
- 打开 http://localhost:3000
- 注册新用户
- 验证新用户有 50 积分

---

## 🔐 关于 Supabase 邮件配置

你看到的 "Enable custom SMTP" 警告是 **可选的**。

### 当前邮件配置
- ✅ Supabase 默认使用自己的 SMTP 服务
- ✅ 邮件已启用（注册、密码重置等）
- ❌ 不需要配置自定义 SMTP，除非要使用自己的邮件服务器

### 如果需要自定义 SMTP（可选）
打开 Supabase Dashboard → Authentication → Email → Enable custom SMTP
然后填充:
- Sender email address
- Sender name
- SMTP server (Host)
- Port (通常 465 或 587)
- Username
- Password

---

## 📊 修复前后对比

### 修复前 ❌
```
新用户注册:
  1. 输入邮箱和密码
  2. 点击 Sign Up
  3. ❌ 错误：profiles 表无记录
  4. ❌ 应用崩溃或功能不可用
  5. ❌ 无法获取用户余额

用户隐私:
  ❌ User A 可以查询 User B 的 storyboards
  ❌ 没有行级安全保护
  ❌ 数据暴露风险
```

### 修复后 ✅
```
新用户注册:
  1. 输入邮箱和密码
  2. 点击 Sign Up
  3. ✅ profiles 自动创建
  4. ✅ 自动分配 50 积分
  5. ✅ 能正常使用应用

用户隐私:
  ✅ User A 只能查询自己的数据
  ✅ 行级安全 (RLS) 保护
  ✅ 数据隔离完善
```

---

## 🧪 验证修复的命令

### 查看所有 RLS 策略
```sql
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, policyname;
```

### 查看 Trigger
```sql
SELECT trigger_name, event_object_table 
FROM information_schema.triggers 
WHERE trigger_schema = 'public';
```

### 查看用户和 Profiles
```sql
SELECT u.id, u.email, p.credits, p.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
LIMIT 10;
```

---

## 📞 常见问题

### Q1: "duplicate key value violates unique constraint"
**A**: Trigger 已存在。这是正常的，继续运行其他 SQL。

### Q2: "Policy already exists"
**A**: 正常。脚本中的 `DROP POLICY IF EXISTS` 会先删除旧的。

### Q3: 新用户注册后还是没有 profile
**A**: 可能 trigger 没有正确创建。运行:
```sql
SELECT * FROM information_schema.triggers 
WHERE trigger_name = 'on_auth_user_created';
```

### Q4: 用户看到其他用户的数据
**A**: RLS 策略配置有问题。检查 pg_policies 表。

---

## 🚀 下一步

修复完成后，你可以:

1. ✅ 部署到 Vercel
2. ✅ 启用 Stripe 支付系统
3. ✅ 配置 Gemini 和 Replicate API
4. ✅ 开始生成故事板和视频

---

## 📝 相关文件

- [lib/supabaseClient.ts](lib/supabaseClient.ts) - Supabase 客户端配置
- [server/index.ts](server/index.ts) - 后端 API 服务
- [context/AppContext.tsx](context/AppContext.tsx) - 应用状态管理
- [.env.local](.env.local) - 环境变量（已配置）

---

**生成时间**: 2024-02-23
**诊断版本**: 1.0
**修复指导**: 立即运行 SUPABASE_QUICK_FIX.md
