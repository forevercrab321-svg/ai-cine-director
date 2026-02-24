# GOD MODE 实现文档

## 📋 概述

实现了一个完整的开发者权限系统（GOD MODE），允许指定的开发者邮箱跳过 credits 检查，无限制使用所有生成功能。

---

## 🏗️ 架构设计

### 核心原则

1. **服务端强制（Server-side Gate）** - 所有权限检查在后端执行，前端仅做 UI 展示
2. **环境变量配置** - 开发者邮箱通过 `DEV_EMAIL_ALLOWLIST` 配置，无需修改代码
3. **统一权限入口** - 所有生成 API 调用同一个 `checkEntitlement()` 函数
4. **向后兼容** - 保留原有 `ADMIN_EMAILS` 硬编码列表作为后备

---

## 📁 文件变更

### 新增文件

| 文件 | 用途 |
|------|------|
| `utils/auth/isDeveloper.ts` | 开发者检查工具函数 |
| `utils/auth/requireEntitlement.ts` | 统一权限入口（可复用于 Express） |
| `GOD_MODE_IMPLEMENTATION.md` | 本文档 |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `api/index.ts` | 添加 `checkEntitlement()`、`/api/entitlement` 端点、重构所有生成 API |
| `context/AppContext.tsx` | 添加 `EntitlementState`、`fetchEntitlement()`、GOD MODE 状态同步 |
| `components/Header.tsx` | 添加 `GodModeBadge` 组件 |
| `.env.local` | 添加 `DEV_EMAIL_ALLOWLIST` 配置 |

---

## 🔧 配置方式

### 1. 环境变量

在 `.env.local` 或 Vercel 环境变量中添加：

```env
DEV_EMAIL_ALLOWLIST=developer1@example.com,developer2@example.com
```

多个邮箱用逗号分隔，大小写不敏感。

### 2. Vercel 部署

```bash
vercel env add DEV_EMAIL_ALLOWLIST
# 输入: forevercrab321@gmail.com,monsterlee@gmail.com
```

---

## 🔐 权限检查流程

```
用户请求生成 API
        ↓
┌───────────────────────┐
│  checkEntitlement()   │
└───────────────────────┘
        ↓
   是否在 DEV_EMAIL_ALLOWLIST?
        ↓
   ┌────┴────┐
   │         │
 是 ↓       否 ↓
┌─────────┐  ┌─────────────────┐
│GOD MODE │  │ 检查 credits    │
│直接放行 │  │ 余额是否充足    │
└─────────┘  └─────────────────┘
                     ↓
              ┌──────┴──────┐
              │             │
            充足 ↓        不足 ↓
         ┌─────────┐   ┌───────────┐
         │ 预扣费  │   │ 402 错误  │
         │ 继续执行│   │NEED_PAYMENT│
         └─────────┘   └───────────┘
```

---

## 🔌 API 端点

### GET /api/entitlement

返回当前用户的权限状态。

**请求头：**
```
Authorization: Bearer <supabase_access_token>
```

**响应（GOD MODE）：**
```json
{
  "isDeveloper": true,
  "isAdmin": true,
  "plan": "developer",
  "credits": 999999,
  "canGenerate": true,
  "mode": "developer",
  "reasonIfBlocked": null
}
```

**响应（普通用户）：**
```json
{
  "isDeveloper": false,
  "isAdmin": false,
  "plan": "free",
  "credits": 50,
  "canGenerate": true,
  "mode": "free",
  "reasonIfBlocked": null
}
```

**响应（需要付费）：**
```json
{
  "isDeveloper": false,
  "isAdmin": false,
  "plan": "free",
  "credits": 0,
  "canGenerate": false,
  "mode": "free",
  "reasonIfBlocked": "NEED_PAYMENT"
}
```

---

## 🎨 前端 UI

### GOD MODE Badge

当用户是开发者时，Header 中显示一个醒目的徽章：

```
┌──────────────────────────────────────────────┐
│ AI Cine-Director [⚡ GOD MODE] [Pro]         │
│ SaaS Edition v3.1                            │
└──────────────────────────────────────────────┘
```

徽章特性：
- 渐变背景（amber → orange）
- 脉冲动画
- 仅在 `entitlement.isDeveloper === true` 时显示

---

## 📊 日志记录

所有 GOD MODE 操作都记录到服务端日志：

```
[GOD MODE] Developer "forevercrab321@gmail.com" performed: generate_script
[GOD MODE] Developer "forevercrab321@gmail.com" performed: replicate:flux:cost=6
[GOD MODE] Developer "forevercrab321@gmail.com" performed: batch:gen-images:count=9:totalCost=54
```

---

## 🧪 测试

### 手动测试

1. 确保 `.env.local` 包含你的邮箱在 `DEV_EMAIL_ALLOWLIST`
2. 启动开发服务器：`npm run dev:all`
3. 登录后检查：
   - Header 是否显示 GOD MODE badge
   - 生成功能是否跳过 credits 检查
   - 服务端日志是否记录 `[GOD MODE]` 日志

### API 测试

```bash
# 获取 access token
TOKEN=$(node -e "require('./lib/supabaseClient').supabase.auth.getSession().then(s => console.log(s.data.session.access_token))")

# 测试 entitlement 端点
curl -H "Authorization: Bearer $TOKEN" http://localhost:3002/api/entitlement
```

---

## 🔒 安全注意事项

1. **永远不要在前端代码中暴露 `DEV_EMAIL_ALLOWLIST`**
2. **所有权限检查必须在服务端执行**
3. **定期审查开发者名单**
4. **生产环境谨慎添加邮箱**

---

## 📝 Checklist

- [x] 创建 `isDeveloper()` 工具函数
- [x] 创建 `checkEntitlement()` 统一权限入口
- [x] 添加 `/api/entitlement` 端点
- [x] 重构 `/api/replicate/predict` 使用 checkEntitlement
- [x] 重构 `/api/gemini/generate` 使用 checkEntitlement
- [x] 重构 `/api/shots/generate` 使用 checkEntitlement
- [x] 重构 `/api/shot-images/:shotId/generate` 使用 checkEntitlement
- [x] 重构 `/api/shot-images/:imageId/edit` 使用 checkEntitlement
- [x] 重构 `/api/batch/gen-images` 使用 checkEntitlement
- [x] 重构 `/api/batch/gen-images/continue` 使用 checkEntitlement
- [x] 更新 `AppContext` 添加 entitlement 状态
- [x] 创建 `GodModeBadge` 组件
- [x] 添加 `DEV_EMAIL_ALLOWLIST` 到 `.env.local`
- [x] 编写文档

---

## 🚀 部署

部署到 Vercel 前：

1. 添加环境变量：
```bash
vercel env add DEV_EMAIL_ALLOWLIST production
```

2. 重新部署：
```bash
vercel --prod
```

3. 验证：访问生产环境并确认 GOD MODE 正常工作
