# 🛠️ 缺失资料 & 手动操作指南

## 📋 缺失的环境变量

### 当前 .env.local 状态
```
✅ VITE_SUPABASE_URL=https://gtxgkdsayswonlewqfzj.supabase.co
✅ VITE_SUPABASE_ANON_KEY=eyJ...
✅ SUPABASE_SERVICE_ROLE_KEY=eyJ...
❌ GEMINI_API_KEY=??? (必须)
❌ REPLICATE_API_TOKEN=??? (必须)
❌ STRIPE_SECRET_KEY=??? (必须)
❌ NODE_ENV=development (可选，但推荐)
```

### 获取方式

#### 1️⃣ GEMINI_API_KEY
**获取步骤**:
1. 访问 https://aistudio.google.com/apikey
2. 点击"Create API Key"
3. 选择现有项目或创建新项目
4. 复制密钥

**验证命令**:
```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}'
```

---

#### 2️⃣ REPLICATE_API_TOKEN
**获取步骤**:
1. 访问 https://replicate.com/account/api-tokens
2. 如果没有账户，先注册
3. 创建新token或复制现有token
4. 保存

**验证命令**:
```bash
curl https://api.replicate.com/v1/account \
  -H "Authorization: Bearer YOUR_TOKEN"
# 应返回账户信息
```

---

#### 3️⃣ STRIPE_SECRET_KEY
**获取步骤**:
1. 访问 https://dashboard.stripe.com/apikeys
2. 登录你的Stripe账户
3. 复制 "Secret key" (不是Publishable key)
4. 保存

**验证命令**:
```bash
curl https://api.stripe.com/v1/customers \
  -u YOUR_SECRET_KEY:
# 应返回客户列表
```

---

### 📝 更新 .env.local

**步骤**:
```bash
cd /Users/monsterlee/Desktop/ai-cine-director

# 编辑 .env.local (使用编辑器或命令行)
cat >> .env.local << 'EOF'

# API Keys (从上面获取)
GEMINI_API_KEY=your_gemini_key_here
REPLICATE_API_TOKEN=your_replicate_token_here
STRIPE_SECRET_KEY=your_stripe_secret_here

# 开发配置
NODE_ENV=development
API_SERVER_PORT=3002
EOF

# 验证文件
cat .env.local | grep -E "GEMINI|REPLICATE|STRIPE"
```

---

## 🔧 需要的手动操作

### Phase 1: 本地测试 (今天)

#### ✅ Step 1.1 - 验证依赖安装
```bash
cd /Users/monsterlee/Desktop/ai-cine-director
npm list | grep -E "react|vite|express|@google/genai|stripe" | head -10

# 预期输出应该看到:
# ├── @google/genai@1.41.0
# ├── express@5.2.1
# ├── react@19.2.4
# └── vite@6.4.1
```

**如果有缺失**:
```bash
npm install
```

---

#### ✅ Step 1.2 - 启动本地开发服务
```bash
# 在项目目录中运行两个终端

# 终端 1 (后端)
npm run server

# 应看到:
# 🎬 AI Cine Director API Server
#    Running on http://localhost:3002
#    Gemini Key: ✅
#    Replicate Token: ✅

# 终端 2 (前端)
npm run dev

# 应看到:
# VITE v6.4.1 running at:
#   Local: http://localhost:3000/
```

---

#### ✅ Step 1.3 - 验证后端健康检查
```bash
# 在第三个终端运行
curl http://localhost:3002/api/health

# 预期输出:
# {
#   "status": "ok",
#   "geminiKey": "✅ configured",
#   "replicateToken": "✅ configured"
# }

# 如果看到 ❌ missing，检查 .env.local
```

---

#### ✅ Step 1.4 - 测试前端加载
1. 打开浏览器访问 http://localhost:3000
2. 应看到认证页面 (Supabase Auth 表单)
3. 使用测试邮箱登录 (例: test@example.com)
4. 应进入主界面，显示余额为 0

**如果看到错误**:
- ❌ "Missing Supabase environment variables" → 检查 VITE_SUPABASE_* 变量
- ❌ "Cannot reach backend" → 确保 npm run server 在运行
- ❌ 认证失败 → 检查Supabase URL和anon key

---

### Phase 2: 功能测试 (本周)

#### ✅ Step 2.1 - 测试故事板生成

**前提**: 已完成 Phase 1.4 并登录

```javascript
// 在浏览器控制台运行
// 1. 生成测试故事板
fetch('http://localhost:3002/api/gemini/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('sb-gt')}`  // Supabase token
  },
  body: JSON.stringify({
    storyIdea: 'A robot learning to dance',
    visualStyle: 'Studio Ghibli Anime',
    language: 'en',
    identityAnchor: 'A small cute robot with blue eyes and silver body'
  })
})
.then(r => r.json())
.then(data => console.log('Storyboard:', data))
.catch(e => console.error('Error:', e))
```

**预期结果**:
```json
{
  "project_title": "...",
  "visual_style": "...",
  "character_anchor": "...",
  "scenes": [
    {
      "scene_number": 1,
      "visual_description": "...",
      "audio_description": "...",
      "shot_type": "...",
      "image_prompt": "...",
      "video_motion_prompt": "..."
    }
    // ... 5个场景
  ]
}
```

---

#### ✅ Step 2.2 - 测试图片生成

```javascript
// 假设已有故事板中的 character_anchor
const characterAnchor = "A small cute robot...";
const prompt = "Robot dancing in a sunlit garden, Studio Ghibli style";

fetch('http://localhost:3002/api/replicate/predict', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('sb-gt')}`
  },
  body: JSON.stringify({
    version: 'black-forest-labs/flux-schnell',
    input: {
      prompt: `${characterAnchor}. ${prompt}`,
      num_inference_steps: 4
    }
  })
})
.then(r => r.json())
.then(data => {
  console.log('Prediction ID:', data.id);
  console.log('Status:', data.status);
  if (data.output) console.log('Image URL:', data.output[0]);
})
.catch(e => console.error('Error:', e))
```

**预期结果**: 
- `status: "succeeded"`
- `output: ["https://...image.png"]`

**常见错误**:
- `402 INSUFFICIENT_CREDITS` → 运行: `npm run test:api` 检查余额

---

#### ✅ Step 2.3 - 运行集成测试

```bash
# 确保后端正在运行 (npm run server)
npm run test:api

# 预期输出示例:
# ✅ Test 1: Missing Anchor Auto-Correction - PASSED
# ✅ Test 2: Insufficient Credits Guard - PASSED  
# ✅ Test 3: Character Consistency Keywords - PASSED
# ✅ All tests completed
```

---

### Phase 3: 代码修复 (本周末)

#### 🔨 Fix #1: 合并双重API实现

**问题文件**:
- `/api/index.ts` (427行, Vercel)
- `/server/routes/gemini.ts` (251行, 本地)
- `/server/routes/replicate.ts` (180行, 本地)

**操作**:
1. 检查 `/api/index.ts` 中的逻辑是否与 `server/routes/` 相同
2. 选择保留一个版本:
   - **选项A (推荐)**: 保留 `server/routes/`, 删除 `/api/index.ts`
     - 原因: 更好的模块化，易于本地开发
     - Vercel改为使用Proxy到自托管后端
   - **选项B**: 删除 `server/routes/`, 保留 `/api/index.ts`
     - 原因: 完全Serverless部署
     - 要求: 启用Vercel Functions

**建议**: 选项A (与项目架构一致)

```bash
# Step 1: 确认server/routes中的逻辑完整
ls -la server/routes/

# Step 2: 备份api/index.ts
cp api/index.ts api/index.ts.bak

# Step 3: 删除 api/index.ts (可选，或移到api.bak/目录)
rm api/index.ts

# Step 4: 更新 vercel.json 以配置Proxy
# (见下文)
```

---

#### 🔨 Fix #2: 补充缺失的环境变量

```bash
# 编辑 .env.local
nano .env.local

# 添加以下行:
GEMINI_API_KEY=<从Google AI Studio复制>
REPLICATE_API_TOKEN=<从Replicate复制>
STRIPE_SECRET_KEY=<从Stripe复制>
NODE_ENV=development
```

---

#### 🔨 Fix #3: 修复双重成本定义

**原文件**:
- `types.ts` - 第137-150行
- `server/routes/replicate.ts` - 第17-25行

**操作**: 在 `types.ts` 中添加Replicate模型路径映射

```typescript
// 在 types.ts 添加
export const REPLICATE_MODEL_PATHS: Record<VideoModel, string> = {
  wan_2_2_fast: "wan-video/wan-2.2-i2v-fast",
  hailuo_02_fast: "minimax/hailuo-02-fast",
  seedance_lite: "bytedance/seedance-1-lite",
  kling_2_5: "kwaivgi/kling-v2.5-turbo-pro",
  hailuo_live: "minimax/video-01-live",
  flux: "black-forest-labs/flux-1.1-pro",
  flux_schnell: "black-forest-labs/flux-schnell",
  google_gemini_nano_banana: "google/gemini-nano-banana",
};
```

然后在 `server/routes/replicate.ts` 中更新:

```typescript
// 删除 BACKEND_COST_MAP
// 改为:
import { MODEL_COSTS, REPLICATE_MODEL_PATHS } from '../types';

const estimatedCost = (version: string): number => {
  // 尝试从version字符串反推模型名称
  for (const [model, path] of Object.entries(REPLICATE_MODEL_PATHS)) {
    if (path === version) {
      return MODEL_COSTS[model as VideoModel] || MODEL_COSTS.DEFAULT;
    }
  }
  return MODEL_COSTS.DEFAULT;
};
```

---

### Phase 4: 部署准备 (下周)

#### 📦 部署选项确认

**选项1: 仅Vercel (完全Serverless)**
```bash
# vercel.json 配置示例
{
  "buildCommand": "npm run build",
  "functions": {
    "api/**": { "memory": 1024, "maxDuration": 60 }
  }
}

# 使用 api/index.ts (Vercel Functions)
# ✅ 优点: 简单，一键部署
# ❌ 缺点: 冷启动延迟，内存限制
```

**选项2: 前后端分离 (推荐)**
```bash
# Frontend → Vercel
# Backend → Railway/Render/Heroku (使用 server/index.ts)

# 步骤:
# 1. Backend: 选择Railway/Render
# 2. 部署 server/index.ts 到平台 (使用 npm run server)
# 3. Frontend: Vercel
#    - 修改 vite.config.ts proxy target为生产后端URL
#    - 部署到Vercel
# 4. Vercel环境变量: 仅需前端变量 (VITE_*)

# ✅ 优点: 灵活，易于扩展
# ✅ 缺点: 需要两个平台账户
```

**我的建议**: 选项2 (当前架构支持)

---

## 📊 验证检查清单

### ✅ 开发环境检查

```bash
# 1. 依赖安装
npm list | wc -l
# 应 > 50

# 2. TypeScript编译
npx tsc --noEmit
# 应无错误

# 3. 后端启动
npm run server &
sleep 3
curl http://localhost:3002/api/health
# 应返回 { "status": "ok" }

# 4. 前端启动
npm run dev &
sleep 5
curl http://localhost:3000
# 应返回 HTML (含 <title>AI Cine Director</title>)

# 5. 测试API
npm run test:api
# 应至少通过1个测试
```

---

### ✅ 生产前检查

```bash
# 1. 环境变量完整性
grep -E "GEMINI|REPLICATE|STRIPE|SUPABASE" .env.local | wc -l
# 应 >= 5

# 2. 构建成功
npm run build
# 应生成 dist/ 目录

# 3. 无console错误
npm run build 2>&1 | grep -i error
# 应无输出

# 4. 类型检查
npx tsc --noEmit
# 应无错误

# 5. 代码重复检查
find . -name "*.ts" -not -path "./node_modules/*" | \
  xargs wc -l | sort -rn | head -10
# 检查是否有重复的大文件 (>300行)
```

---

## 🚨 常见问题排查

### Q1: "Cannot find module '@google/genai'"
**解决**:
```bash
npm install @google/genai@latest
```

### Q2: "CORS error: Origin not allowed"
**解决**: 检查 vite.config.ts
```typescript
// 应有代理配置
proxy: {
  '/api': {
    target: 'http://localhost:3002',
    changeOrigin: true,
  }
}
```

### Q3: "Supabase JWT invalid"
**解决**: 
```bash
# 1. 确保已登录
localStorage.getItem('sb-gt');  // 在浏览器控制台运行

# 2. 如果为空，手动登录

# 3. 检查token格式
const token = localStorage.getItem('sb-gt');
console.log(token.slice(0, 20) + '...');
// 应以 'eyJ...' 开头
```

### Q4: "API Call timeout (>30s)"
**解决**:
```bash
# 1. 检查后端是否运行
curl http://localhost:3002/api/health

# 2. 增加timeout
# services/geminiService.ts
const response = await fetch(url, {
  // ...
  signal: AbortSignal.timeout(60000)  // 60秒
});
```

### Q5: "INSUFFICIENT_CREDITS但刚充值"
**解决**:
```bash
# 1. 刷新页面 (F5)
# 2. 或在控制台运行
// (需要已导入 useAppContext)
const { refreshBalance } = useAppContext();
await refreshBalance();

# 3. 检查数据库
# Supabase → profiles 表 → credits 列
```

---

## 📞 支持信息

### 调试工具

**浏览器控制台**:
```javascript
// 检查用户余额
const token = localStorage.getItem('sb-gt');
console.log('Token:', token?.slice(0, 20) + '...');

// 测试API
fetch('/api/health')
  .then(r => r.json())
  .then(console.log)
```

**后端日志**:
```bash
# 查看实时日志
tail -f ~/ai-cine-director/server.log

# 或在终端中查看 (npm run server 的输出)
```

**Supabase Dashboard**:
- URL: https://app.supabase.com/project/gtxgkdsayswonlewqfzj
- 检查: profiles 表, ledger 表

---

## 📝 后续交接

### 当完成以上所有步骤后

1. **告诉我**:
   - 哪个步骤有问题 (提供错误截图)
   - 是否所有API测试都通过
   - 是否可以成功登录和生成故事板

2. **我将**:
   - 提供针对性的代码修复
   - 帮你部署到生产环境
   - 优化性能和安全

3. **预计时间**:
   - Phase 1 (测试): 1小时
   - Phase 2 (功能): 2小时
   - Phase 3 (修复): 4小时
   - Phase 4 (部署): 3小时
   - **总计**: 10小时

---

**准备好了吗？从 Step 1.1 开始！** 🚀
