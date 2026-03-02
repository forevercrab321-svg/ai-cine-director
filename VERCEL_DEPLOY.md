# AI Cine-Director - Vercel 部署指南

## 快速部署

### 方式1: Vercel CLI (推荐)

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 进入项目目录
cd ai-cine-director

# 部署到 Vercel
vercel --prod
```

### 方式2: GitHub 集成

1. 推送代码到 GitHub
2. 在 Vercel 导入项目: https://vercel.com/new
3. 选择 "Import Git Repository"
4. 配置环境变量:
   - `GEMINI_API_KEY`
   - `REPLICATE_API_TOKEN`
   - `STRIPE_SECRET_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `RESEND_API_KEY`

### 方式3: 手动部署

```bash
# 构建
npm run build

# 部署 dist 目录
vercel deploy --prod --dist-dir dist
```

## 环境变量

请在 Vercel Project Settings 中添加以下环境变量:

```
GEMINI_API_KEY=your_google_gemini_key
REPLICATE_API_TOKEN=your_replicate_token
STRIPE_SECRET_KEY=your_stripe_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_key
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
RESEND_API_KEY=your_resend_api_key
DEV_EMAIL_ALLOWLIST=forevercrab321@gmail.com,monsterlee@gmail.com
```

## 开发者模式

已在代码中配置以下开发者邮箱自动获得无限额度:
- forevercrab321@gmail.com
- monsterlee@gmail.com

## API 端点

部署后，以下 API 端点可用:
- `/api/auth/send-otp` - 发送登录验证码
- `/api/generate` - 生成脚本
- `/api/video/generate` - 生成视频
- `/api/audio/generate` - 生成语音
- `/api/billing/*` - 支付相关
