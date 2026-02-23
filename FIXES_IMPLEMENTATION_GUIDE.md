# 🔧 代码修复指南 - 具体实施步骤

## 概述
本文档提供了针对CODE_REVIEW_REPORT.md中发现的所有问题的**逐步修复指南**。

---

## 🔴 CRITICAL 修复 #1: 合并双重API实现

### 问题描述
- `api/index.ts` (427行) - Vercel Serverless版本
- `server/routes/gemini.ts` (251行) - Express版本  
- `server/routes/replicate.ts` (180行) - Express版本
- 代码重复，维护困难

### 修复策略
**保留**: `server/routes/` 本地开发版本（更模块化、易维护）  
**删除**: `api/index.ts` （改为Vercel Proxy配置）

### 实施步骤

#### Step 1: 备份原文件
```bash
cd /Users/monsterlee/Desktop/ai-cine-director

# 创建备份目录
mkdir -p .backup
cp api/index.ts .backup/api.index.ts.bak
```

#### Step 2: 删除 api/index.ts
```bash
rm api/index.ts
```

#### Step 3: 创建 vercel.json (Vercel Proxy配置)
```bash
cat > vercel.json << 'EOF'
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "functions": {
    "api/**": {
      "memory": 1024,
      "maxDuration": 60
    }
  },
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "${BACKEND_URL}/api/$1"
    }
  ]
}
EOF
```

#### Step 4: 更新 vite.config.ts (开发环境保持不变)
```bash
# 确认 vite.config.ts 中有正确的proxy配置
grep -A 3 "proxy:" vite.config.ts

# 应显示:
#   proxy: {
#     '/api': {
#       target: 'http://localhost:3002',
```

#### Step 5: 验证本地开发仍可运行
```bash
# 终端 1
npm run server

# 终端 2
npm run dev

# 验证
curl http://localhost:3002/api/health
# 应返回 { "status": "ok" }
```

---

## 🔴 CRITICAL 修复 #2: 补充环境变量

### 问题描述
`.env.local` 缺少关键的API密钥

### 修复步骤

#### Step 1: 获取三个关键密钥

**GEMINI_API_KEY**:
```
访问: https://aistudio.google.com/apikey
点击: Create API Key
复制: 完整的密钥 (长字符串)
```

**REPLICATE_API_TOKEN**:
```
访问: https://replicate.com/account/api-tokens  
点击: Create API token
复制: 完整的token (长字符串)
```

**STRIPE_SECRET_KEY**:
```
访问: https://dashboard.stripe.com/apikeys
找到: Secret key (不是 Publishable key)
复制: sk_test_... 或 sk_live_... (长字符串)
```

#### Step 2: 更新 .env.local
```bash
cat >> /Users/monsterlee/Desktop/ai-cine-director/.env.local << 'EOF'

# === API Keys (获取自上述URL) ===
GEMINI_API_KEY=your_key_here_copy_from_aistudio
REPLICATE_API_TOKEN=your_token_here_copy_from_replicate
STRIPE_SECRET_KEY=your_secret_here_copy_from_stripe

# === 开发配置 ===
NODE_ENV=development
API_SERVER_PORT=3002
BACKEND_URL=http://localhost:3002
EOF
```

#### Step 3: 验证
```bash
# 检查是否已添加
cat /Users/monsterlee/Desktop/ai-cine-director/.env.local | tail -10

# 应看到上面添加的行

# 测试Gemini连接
NODE_OPTIONS='--loader tsx' node -e "
import('dotenv').then(d => d.config({ path: '.env.local' }));
setTimeout(() => {
  const key = process.env.GEMINI_API_KEY;
  console.log('GEMINI_API_KEY:', key ? '✅ 已配置' : '❌ 缺失');
}, 100);
"
```

---

## 🔴 CRITICAL 修复 #3: 修复双重成本定义

### 问题描述
模型成本定义在三个地方:
1. `types.ts` - `MODEL_COSTS` (模型名称为键)
2. `server/routes/replicate.ts` - `BACKEND_COST_MAP` (Replicate路径为键)
3. `services/replicateService.ts` - `REPLICATE_MODEL_MAP` (映射)

修改成本需要改多个地方，容易遗漏。

### 修复目标
**单一真实来源**: 所有成本信息来自 `types.ts`

### 实施步骤

#### Step 1: 在 types.ts 中添加模型路径映射

打开 [types.ts](types.ts#L150)，在 `MODEL_COSTS` 后添加:

```typescript
// 在 types.ts 第150行后面添加

/**
 * Replicate模型路径映射
 * 用于调用Replicate API时确定正确的endpoint
 */
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

/**
 * 根据Replicate路径获取模型成本
 * 用于后端API路由
 */
export const getCostForReplicatePath = (path: string): number => {
  for (const [model, repPath] of Object.entries(REPLICATE_MODEL_PATHS)) {
    if (repPath === path) {
      return MODEL_COSTS[model as VideoModel] || MODEL_COSTS.DEFAULT;
    }
  }
  return MODEL_COSTS.DEFAULT;
};
```

#### Step 2: 更新 server/routes/replicate.ts

打开 [server/routes/replicate.ts](server/routes/replicate.ts#L1)

**删除** 第17-25行:
```typescript
// ❌ 删除这段
const BACKEND_COST_MAP: Record<string, number> = {
    'wan-video/wan-2.2-i2v-fast': 8,
    'minimax/hailuo-02-fast': 18,
    'bytedance/seedance-1-lite': 28,
    'kwaivgi/kling-v2.5-turbo-pro': 53,
    'minimax/video-01-live': 75,
    'black-forest-labs/flux-1.1-pro': 6,
    'black-forest-labs/flux-schnell': 1,
};
```

**在文件顶部添加导入**:
```typescript
// ✅ 在 server/routes/replicate.ts 第6行后添加
import { getCostForReplicatePath } from '../types';
```

**更新成本计算** (第28行改为):
```typescript
// ❌ 原来
const estimatedCost = BACKEND_COST_MAP[version] || 20;

// ✅ 改为
const estimatedCost = getCostForReplicatePath(version);
```

#### Step 3: 更新 services/replicateService.ts

打开 [services/replicateService.ts](services/replicateService.ts#L47)

**更新导入** (第5行):
```typescript
// ❌ 原来
import { VideoStyle, ImageModel, AspectRatio, GenerationMode, VideoQuality, VideoDuration, VideoFps, VideoResolution, VideoModel } from '../types';

// ✅ 改为
import { VideoStyle, ImageModel, AspectRatio, GenerationMode, VideoQuality, VideoDuration, VideoFps, VideoResolution, VideoModel, REPLICATE_MODEL_PATHS } from '../types';
```

**更新REPLICATE_MODEL_MAP** (第47-57行改为):
```typescript
// ✅ 新版本 - 从types导入
const REPLICATE_MODEL_PATHS_LOCAL = REPLICATE_MODEL_PATHS;  // 直接使用types中定义的
```

#### Step 4: 验证修复

```bash
# 编译检查
npx tsc --noEmit

# 应无错误

# 运行测试以确保成本计算正确
npm run test:api
```

---

## 🟠 MAJOR 修复 #1: 实现乐观更新 + refreshBalance确认

### 问题描述
生成完成后，用户看到成功消息但余额仍是旧值（延迟100ms+）。

### 修复步骤

#### Step 1: 更新 context/AppContext.tsx

打开 [context/AppContext.tsx](context/AppContext.tsx#L274)

找到 `refreshBalance` 函数（第274行），确保其实现如下：

```typescript
// ✅ refreshBalance 应如下（已有，确认）
const refreshBalance = async () => {
  if (!session?.user) return;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', session.user.id)
      .single();
    if (!error && data) {
      const dbBalance = data.credits ?? 0;
      balanceRef.current = dbBalance;
      setUserState(prev => ({ ...prev, balance: dbBalance }));
      console.log(`[CREDIT SYNC] Balance refreshed from DB: ${dbBalance}`);
    }
  } catch (e) {
    console.error('[CREDIT SYNC] Failed to refresh balance:', e);
  }
};
```

#### Step 2: 更新 components/VideoGenerator.tsx

打开 [components/VideoGenerator.tsx](components/VideoGenerator.tsx#L100)

找到 `executeImageGeneration` 函数（约第120行），改为：

```typescript
// ❌ 原来的实现
const executeImageGeneration = async (scene: Scene) => {
    if (!userState.isAdmin && !hasEnoughCredits(imageCost)) {
        throw Object.assign(new Error("INSUFFICIENT_CREDITS"), { code: "INSUFFICIENT_CREDITS" });
    }

    setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'image_gen', message: '🎨 正在生成图片...' } }));

    try {
        const prompt = `${scene.visual_description}, ${scene.shot_type}`;
        const url = await generateImage(...);
        setSceneImages(prev => ({ ...prev, [scene.scene_number]: url }));
        setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'ready', message: '图片已就绪' } }));
        await refreshBalance();  // ⚠️ 延迟刷新
        return url;
    } catch (e: any) {
        // ...
    }
};

// ✅ 改为 - 乐观更新 + 后台确认
const executeImageGeneration = async (scene: Scene) => {
    if (!userState.isAdmin && !hasEnoughCredits(imageCost)) {
        throw Object.assign(new Error("INSUFFICIENT_CREDITS"), { code: "INSUFFICIENT_CREDITS" });
    }

    setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'image_gen', message: '🎨 正在生成图片...' } }));

    // 1️⃣ 立即扣款（UI乐观更新）
    const optimisticCost = imageCost;
    deductCredits(optimisticCost);  // 这会同步更新balanceRef和状态

    try {
        const prompt = `${scene.visual_description}, ${scene.shot_type}`;
        const url = await generateImage(
            prompt,
            settings.imageModel,
            settings.videoStyle,
            settings.aspectRatio,
            project.character_anchor
        );

        setSceneImages(prev => ({ ...prev, [scene.scene_number]: url }));
        setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'ready', message: '图片已就绪' } }));
        
        // 2️⃣ 后台异步确认（不阻塞UI）
        refreshBalance().catch(e => {
            console.error('[Image Gen] Balance sync failed:', e);
            // 可选: 显示警告
        });

        return url;
    } catch (e: any) {
        // 3️⃣ 失败时回滚（手动实现refund）
        console.error('[Image Gen] Generation failed, rolling back credit deduction');
        
        // 从后端获取真实余额（确保没被双重扣款）
        await refreshBalance();

        setSceneStatus(prev => ({
            ...prev,
            [scene.scene_number]: { status: 'failed', error: e.message, message: '图片生成失败' }
        }));
        throw e;
    }
};
```

#### Step 3: 类似更新视频生成函数

在同一文件中找到 `executeVideoGeneration` 函数，应用相同的模式。

#### Step 4: 验证

```bash
# 1. 启动本地开发
npm run dev:all

# 2. 在浏览器中生成图片并观察:
#    - 生成前: balance = 100
#    - 点击"生成图片"
#    - 生成中: balance = 94 (立即更新)
#    - 生成成功: 显示图片，balance = 94 (确认)
#    - 不应该看到 balance 延迟跳动的情况
```

---

## 🟠 MAJOR 修复 #2: 添加后端负数余额防护

### 问题描述
前端自动修复负余额，但后端RPC缺乏防护。

### 修复步骤

#### Step 1: 检查 Supabase RPC 定义

打开 Supabase Dashboard:
- 访问: https://app.supabase.com/project/gtxgkdsayswonlewqfzj/sql/new
- 查看现有 `reserve_credits` RPC 的定义

#### Step 2: 更新 reserve_credits RPC

在Supabase SQL编辑器中运行：

```sql
-- 更新 reserve_credits 函数以防止负数
DROP FUNCTION IF EXISTS public.reserve_credits(integer, text, text);

CREATE OR REPLACE FUNCTION public.reserve_credits(
  amount integer,
  ref_type text,
  ref_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_id uuid := auth.uid();
  current_balance integer;
BEGIN
  -- 检查用户是否已验证
  IF user_id IS NULL THEN
    RETURN false;
  END IF;

  -- 获取当前余额
  SELECT credits INTO current_balance
  FROM public.profiles
  WHERE id = user_id;

  -- ✅ 防止负数：检查是否有足够的余额
  IF current_balance IS NULL OR current_balance < amount THEN
    RETURN false;
  END IF;

  -- 创建预留记录 (在ledger表中)
  INSERT INTO public.ledger (user_id, amount, ref_type, ref_id, status)
  VALUES (user_id, -amount, ref_type, ref_id, 'reserved')
  ON CONFLICT (ref_id) DO NOTHING;

  -- 更新用户余额
  UPDATE public.profiles
  SET credits = credits - amount
  WHERE id = user_id;

  RETURN true;
END;
$$;
```

#### Step 3: 添加余额检查函数（可选）

```sql
-- 添加检查函数确保无负数
CREATE OR REPLACE FUNCTION public.check_negative_balances()
RETURNS TABLE(user_id uuid, balance integer, status text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    id as user_id,
    credits as balance,
    CASE 
      WHEN credits < 0 THEN 'negative'
      ELSE 'ok'
    END as status
  FROM public.profiles
  WHERE credits < 0;
$$;

-- 运行检查
SELECT * FROM public.check_negative_balances();

-- 如果有负数，修复
UPDATE public.profiles SET credits = 0 WHERE credits < 0;
```

#### Step 4: 验证修复

```bash
# 在后端测试中运行
npm run test:api

# 检查日志中 reserve_credits 是否返回正确的false
```

---

## 🟠 MAJOR 修复 #3: 添加请求速率限制

### 问题描述
用户可以快速连续点击生成按钮，导致:
- 不必要的API调用
- Replicate 429 错误
- 费用浪费

### 修复步骤

#### Step 1: 在 VideoGenerator.tsx 中添加锁

打开 [components/VideoGenerator.tsx](components/VideoGenerator.tsx#L59)

找到状态声明部分（约第59行），确保有生成状态锁：

```typescript
// ✅ 应该已有这些状态
const [isRenderingImages, setIsRenderingImages] = useState(false);
const [isRenderingVideos, setIsRenderingVideos] = useState(false);
```

#### Step 2: 更新按钮handler确保检查锁

找到 `handleRenderImages` 函数（约第135行），确保顶部有检查：

```typescript
// ✅ 应该已有这个检查
const handleRenderImages = async () => {
    if (!isAuthenticated) return alert("请先登录以生成图片。");
    if (isRenderingImages || isRenderingVideos) return;  // ⚠️ 防止多重生成

    setIsRenderingImages(true);
    try {
        // ... 生成逻辑
    } finally {
        setIsRenderingImages(false);
    }
};
```

#### Step 3: 添加单个场景生成的防护

在 `executeImageGeneration` 中添加场景级别的锁：

```typescript
// 在 VideoGenerator.tsx 中添加
const [generatingScenes, setGeneratingScenes] = useState<Set<number>>(new Set());

// ✅ 修改 executeImageGeneration
const executeImageGeneration = async (scene: Scene) => {
    // ⚠️ 防止同一场景多重生成
    if (generatingScenes.has(scene.scene_number)) {
        console.warn(`Scene ${scene.scene_number} already generating`);
        return;
    }

    // 标记正在生成
    setGeneratingScenes(prev => new Set([...prev, scene.scene_number]));

    try {
        // ... 现有逻辑
    } finally {
        // 清除标记
        setGeneratingScenes(prev => {
            const next = new Set(prev);
            next.delete(scene.scene_number);
            return next;
        });
    }
};
```

#### Step 4: 添加全局请求队列（可选，高级）

对于更复杂的场景，可以使用请求队列库：

```bash
npm install p-queue
```

然后在 services/replicateService.ts 中：

```typescript
import PQueue from 'p-queue';

// 全局请求队列：最多同时处理2个请求
const requestQueue = new PQueue({ concurrency: 2 });

export const generateImage = async (...): Promise<string> => {
  return requestQueue.add(async () => {
    // 实际的generateImage逻辑
    // ...
  });
};
```

#### Step 5: 测试

```bash
# 启动本地开发
npm run dev:all

# 快速连续点击"生成图片"按钮
# 应该看到：
# ✅ 只有第一个请求被处理
# ✅ 后续点击被忽略（显示提示或禁用按钮）
# ✅ 不会生成多个图片
```

---

## 📋 修复完成检查清单

完成上述修复后，运行以下验证：

```bash
# 1. TypeScript 编译检查
npx tsc --noEmit
# 应无错误 ✅

# 2. 启动本地开发环境
npm run dev:all
# 应看到:
# - Backend running on http://localhost:3002 ✅
# - Vite running on http://localhost:3000 ✅

# 3. 健康检查
curl http://localhost:3002/api/health
# 应返回 { "status": "ok", ... } ✅

# 4. 运行集成测试
npm run test:api
# 应至少通过 3 个测试 ✅

# 5. 手动测试流程
# - 打开 http://localhost:3000
# - 登录
# - 输入故事创意
# - 生成故事板
# - 生成图片
# - 检查余额更新是否立即且正确 ✅

# 6. 重复点击测试
# - 快速连续点击"生成"按钮
# - 应该只生成一次 ✅
```

---

## 🎯 修复完成后的下一步

### 推荐顺序：

1. **今天** (4小时):
   - ✅ Fix #1: 删除 api/index.ts
   - ✅ Fix #2: 补充 .env.local
   - ✅ Fix #3: 修复成本定义

2. **明天** (3小时):
   - ✅ Fix #1 (MAJOR): 乐观更新
   - ✅ Fix #2 (MAJOR): 后端防护
   - ✅ Fix #3 (MAJOR): 速率限制

3. **本周** (4小时):
   - 添加输入验证 (zod)
   - 实现结构化日志
   - 编写单元测试

4. **生产前** (2小时):
   - 配置错误追踪 (Sentry)
   - 性能测试和优化
   - 安全审计

---

**所有修复完成预计总时间: 13小时**

准备开始吗？从 **CRITICAL 修复 #1** 开始！💪
