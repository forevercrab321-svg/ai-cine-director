/**
 * Replicate API 代理路由
 * 安全地在服务器端调用 Replicate API
 */
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

export const replicateRouter = Router();

// Replicate Supabase Admin creation logic
const getSupabaseAdmin = () => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Supabase URL or Service Role Key missing on server');
    }
    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
};

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

const getToken = () => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error('REPLICATE_API_TOKEN not configured on server');
    return token;
};

// POST /api/replicate/predict - Creating Prediction
replicateRouter.post('/predict', async (req, res) => {
    try {
        const token = getToken();
        // ★ 1. Auth & Credit Check
        const authHeader = req.headers.authorization; // "Bearer <user_token>"
        if (!authHeader) {
            return res.status(401).json({ error: "Missing Authorization header" });
        }

        const supabaseAdmin = getSupabaseAdmin();
        const userToken = authHeader.replace('Bearer ', '');

        // Validate User
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(userToken);

        if (authError || !user) {
            return res.status(401).json({ error: "Invalid or expired token" });
        }

        const { version, input, model } = req.body;

        if (!version || !input) {
            return res.status(400).json({ error: 'Missing version or input' });
        }

        // ★ Determine Cost — aligned with frontend MODEL_COSTS (types.ts)
        const BACKEND_COST_MAP: Record<string, number> = {
            'wan-video/wan-2.2-i2v-fast': 8,
            'minimax/hailuo-02-fast': 18,
            'bytedance/seedance-1-lite': 28,
            'kwaivgi/kling-v2.5-turbo-pro': 53,
            'minimax/video-01-live': 75,
            'black-forest-labs/flux-1.1-pro': 6,
            'black-forest-labs/flux-schnell': 1,
            'google/gemini-nano-banana': 5,
        };
        let estimatedCost = BACKEND_COST_MAP[version] || 20; // Safe default

        // ★ 2. Deduct Credits (Atomic)
        // RPC: deduct_credits(amount_to_deduct, model_used, base_cost, multiplier)
        // Note: deduct_credits needs to be called as the USER.
        // We need 'rpc' call. Since we are admin, we can set auth context?
        // Actually, 'security definer' RPC uses `auth.uid()`. 
        // We can use `supabaseAdmin.rpc(..., { global: { headers: { Authorization: ... } } })`?
        // Easier: Use `supabaseClient` initialized with user token?
        // Or pass user_id to a modified RPC?
        // Current RPC `deduct_credits` uses `auth.uid()`.

        // We can create a client FOR THIS USER
        const supabaseUserClient = createClient(
            process.env.VITE_SUPABASE_URL!,
            process.env.VITE_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: success, error: rpcError } = await supabaseUserClient.rpc('deduct_credits', {
            amount_to_deduct: estimatedCost,
            model_used: model || 'unknown',
            base_cost: estimatedCost,
            multiplier: 1
        });

        if (rpcError) {
            console.error('Credit check error:', rpcError);
            return res.status(500).json({ error: 'Credit verification failed' });
        }

        if (!success) {
            return res.status(402).json({ error: "Insufficient credits", code: "INSUFFICIENT_CREDITS" });
        }

        // ★ 3. Proceed with Replicate Call
        // 判断是 model 路径还是版本 hash
        const isModelPath = version.includes('/') && !version.match(/^[a-f0-9]{64}$/);
        let targetUrl: string;

        if (isModelPath) {
            targetUrl = `${REPLICATE_API_BASE}/models/${version}/predictions`;
        } else {
            targetUrl = `${REPLICATE_API_BASE}/predictions`;
        }

        const maxRetries = 3;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            console.log(`[Replicate] POST ${targetUrl} (attempt ${attempt + 1}/${maxRetries + 1})`);

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Prefer: 'wait',
                },
                body: JSON.stringify(isModelPath ? { input } : { version, input }),
            });

            // 429 速率限制 → 自动等待重试
            if (response.status === 429 && attempt < maxRetries) {
                let retryAfter = 10; // 默认等 10 秒
                try {
                    const errData = JSON.parse(await response.text());
                    retryAfter = errData.retry_after || errData.detail?.match(/~(\d+)s/)?.[1] || 10;
                } catch { }
                const waitMs = (Number(retryAfter) + 2) * 1000; // 加 2 秒缓冲
                console.log(`[Replicate] Rate limited (429). Waiting ${waitMs / 1000}s before retry...`);
                await new Promise(r => setTimeout(r, waitMs));
                continue;
            }

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[Replicate] Error ${response.status}: ${errText}`);
                return res.status(response.status).json({ error: errText });
            }

            const data = await response.json();
            return res.json(data);
        }

        // 超过最大重试次数
        return res.status(429).json({ error: 'Rate limit exceeded after retries. Please try again later or add credits to your Replicate account.' });
    } catch (error: any) {
        console.error('[Replicate] Error:', error.message);
        res.status(500).json({ error: error.message || 'Replicate prediction failed' });
    }
});


// GET /api/replicate/status/:id - 查询任务状态
replicateRouter.get('/status/:id', async (req, res) => {
    try {
        const token = getToken();
        const { id } = req.params;

        const response = await fetch(`${REPLICATE_API_BASE}/predictions/${id}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errText = await response.text();
            return res.status(response.status).json({ error: errText });
        }

        const data = await response.json();
        res.json(data);
    } catch (error: any) {
        console.error('[Replicate Status] Error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to check status' });
    }
});
