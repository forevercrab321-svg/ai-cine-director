# AI Cine Director - 快速参考指南

## 🎯 当前系统状态

### ✅ 全部就绪
- 前端: http://localhost:3000 ✅
- 后端: http://localhost:3002 ✅
- Resend 域名: aidirector.business (已验证) ✅
- 所有 API Keys: 配置正确 ✅

---

## 🚀 快速启动

```bash
# 启动开发环境 (前后端同时)
npm run dev:all

# 测试所有组件
npx tsx scripts/diagnose-all.ts

# 测试邮件发送
npx tsx scripts/test-email.ts your@email.com
```

---

## 🔑 关键文件位置

### 配置文件
- `.env.local` - 所有 API Keys 和环境变量
- `vite.config.ts` - Vite 配置 (API 代理设置)
- `package.json` - 脚本和依赖

### 后端核心
- `server/index.ts` - Express 服务器入口
- `server/routes/gemini.ts` - Gemini API 路由
- `server/routes/replicate.ts` - Replicate API 路由
- `server/routes/shots.ts` - Shot 管理路由
- `server/routes/batch.ts` - 批量生成路由

### 前端核心
- `App.tsx` - 应用主入口
- `context/AppContext.tsx` - 全局状态管理
- `components/VideoGenerator.tsx` - 主界面组件
- `components/BatchImagePanel.tsx` - 批量图片生成面板
- `services/geminiService.ts` - Gemini API 前端代理
- `services/replicateService.ts` - Replicate API 前端代理

---

## 🛠️ 常用诊断命令

### 检查服务状态
```bash
# 后端健康检查
curl http://localhost:3002/api/health

# 前端访问
curl http://localhost:3000

# Resend 域名状态
curl -H "Authorization: Bearer $RESEND_API_KEY" \
  https://api.resend.com/domains | jq
```

### 查看日志
- 后端日志: 终端中运行 `npm run server` 的输出
- 前端日志: 浏览器开发者工具 Console
- 网络请求: 浏览器开发者工具 Network 标签

---

## 🐛 常见问题排查

### 问题 1: `[vite] http proxy error: /api/*`
**原因**: 后端服务器未运行  
**解决**: 确保使用 `npm run dev:all` 而不是 `npm run dev`

### 问题 2: 积分扣除失败
**检查**:
1. JWT Token 是否过期 (重新登录)
2. Supabase RPC 函数 `reserve_credits` 是否存在
3. 后端日志中是否有 SQL 错误

### 问题 3: 邮件未收到
**检查**:
1. 垃圾邮件文件夹
2. Resend 域名状态: `npx tsx scripts/diagnose-all.ts`
3. 后端日志中的 Resend API 响应

### 问题 4: 图片/视频生成失败
**检查**:
1. Replicate API Token 是否有效
2. 用户积分是否足够
3. Prompt 是否触发 NSFW 过滤 (查看错误消息)
4. 后端日志中的详细错误

---

## 💡 开发技巧

### 管理员模式
使用开发者邮箱登录以获得:
- ✅ 无限积分 (绕过所有扣费)
- ✅ 特殊标识 (UI 中显示 "ADMIN")
- 📧 开发者邮箱: `forevercrab321@gmail.com`

### Mock 模式
在 `SettingsModal` 中启用 Mock 模式:
- 跳过真实 API 调用
- 返回模拟数据
- 适合 UI 开发和测试

### 积分系统调试
```sql
-- 查看用户积分余额
SELECT id, name, credits FROM profiles WHERE email = 'your@email.com';

-- 查看积分流水
SELECT * FROM ledger WHERE user_id = 'user-uuid' ORDER BY created_at DESC LIMIT 10;

-- 手动增加积分
UPDATE profiles SET credits = credits + 100 WHERE id = 'user-uuid';
```

---

## 📊 API 端点速查

### 认证相关
- `POST /api/auth/send-otp` - 发送登录验证码
- `POST /api/auth/ensure-user` - 确保用户存在

### 内容生成
- `POST /api/gemini/generate` - 生成故事板
- `POST /api/gemini/analyze` - 分析角色锚点
- `POST /api/replicate/predict` - 图片/视频生成
- `GET /api/replicate/prediction/:id` - 查询生成状态

### 批量生成
- `POST /api/batch/start` - 开始批量生成
- `POST /api/batch/continue` - 继续批量生成
- `GET /api/batch/:jobId` - 查询批量任务状态
- `POST /api/batch/:jobId/cancel` - 取消批量任务

### 健康检查
- `GET /api/health` - 服务器状态

---

## 🎨 模型和成本

### 图片模型
| 模型 | 成本 | 速度 | 质量 |
|------|------|------|------|
| flux | 2 积分 | 中等 | 高 |
| flux_schnell | 1 积分 | 快 | 中等 |

### 视频模型
| 模型 | 成本 | 时长 | 质量 |
|------|------|------|------|
| hailuo_02_fast | 28 积分 | 5-6秒 | 高 |
| hailuo_02 | 35 积分 | 5-6秒 | 最高 |
| minimax_video_01 | 35 积分 | 6秒 | 高 |
| pyramid_flow | 2 积分 | 5秒 | 中等 |

---

## 🔐 环境变量清单

复制到 `.env.local`:

```bash
# Supabase
VITE_SUPABASE_URL=https://gtxgkdsayswonlewqfzj.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# API Keys
GEMINI_API_KEY=your-gemini-key
REPLICATE_API_TOKEN=your-replicate-token
STRIPE_SECRET_KEY=your-stripe-key
RESEND_API_KEY=your-resend-key

# 服务器配置
NODE_ENV=development
API_SERVER_PORT=3002
```

---

## 📚 项目结构

```
ai-cine-director/
├── .env.local              # 环境变量 (不提交)
├── package.json            # 依赖和脚本
├── vite.config.ts          # Vite 配置
├── tsconfig.json           # TypeScript 配置
├── types.ts                # 全局类型定义
├── i18n.ts                 # 国际化
│
├── server/                 # 后端 Express 服务器
│   ├── index.ts            # 服务器入口
│   └── routes/             # API 路由
│       ├── gemini.ts
│       ├── replicate.ts
│       ├── shots.ts
│       ├── batch.ts
│       └── shotImages.ts
│
├── services/               # 前端服务层
│   ├── geminiService.ts
│   ├── replicateService.ts
│   ├── batchService.ts
│   └── shotService.ts
│
├── components/             # React 组件
│   ├── VideoGenerator.tsx
│   ├── BatchImagePanel.tsx
│   ├── SceneCard.tsx
│   └── ...
│
├── context/                # 全局状态
│   └── AppContext.tsx
│
├── lib/                    # 工具库
│   ├── supabaseClient.ts
│   └── db.ts
│
├── scripts/                # 辅助脚本
│   ├── diagnose-all.ts     # 全面诊断
│   ├── test-email.ts       # 邮件测试
│   └── test-api.ts         # API 测试
│
└── supabase/               # 数据库迁移
    ├── schema.sql
    └── ...
```

---

## 🎓 学习资源

### 关键概念
1. **后端代理模式**: API Keys 在后端，前端通过 /api 代理
2. **积分系统**: 预留 → 调用 → 释放/退款
3. **RLS (Row Level Security)**: Supabase 数据库权限控制
4. **JWT 认证**: Supabase Auth 生成的 Token

### 外部文档
- [Vite 代理配置](https://vitejs.dev/config/server-options.html#server-proxy)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Resend API](https://resend.com/docs/api-reference/emails/send-email)
- [Google Gemini](https://ai.google.dev/docs)
- [Replicate API](https://replicate.com/docs/reference/http)

---

## 📞 联系和支持

- **项目主页**: [GitHub Repository]
- **开发者**: forevercrab321@gmail.com
- **域名**: aidirector.business
- **Vercel 部署**: ai-cine-director.vercel.app

---

**最后更新**: 2026年2月23日  
**系统状态**: ✅ 完全就绪
