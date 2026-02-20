/**
 * Replicate API 代理路由
 * 使用 Ledger Reserve/Finalize/Refund 系统处理额度
 */
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';

export const replicateRouter = Router();

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

const getToken = () => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error('REPLICATE_API_TOKEN not configured');
    return token;
};

const BACKEND_COST_MAP: Record<string, number> = {
    'wan-video/wan-2.2-i2v-fast': 8,
    'minimax/hailuo-02-fast': 18,
    'bytedance/seedance-1-lite': 28,
    'kwaivgi/kling-v2.5-turbo-pro': 53,
    'minimax/video-01-live': 75,
    'black-forest-labs/flux-1.1-pro': 6,
    'black-forest-labs/flux-schnell': 1,
};

// POST /api/replicate/predict
replicateRouter.post('/predict', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ error: "Missing Authorization header" });
    }

    const { version, input } = req.body;
    if (!version || !input) {
        return res.status(400).json({ error: 'Missing version or input' });
    }

    const estimatedCost = BACKEND_COST_MAP[version] || 20;
    const jobRef = `replicate:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    // User-context client (auth.uid() works in RPC)
    const supabaseUser = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.VITE_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: authHeader } } }
    );

    // 1) Reserve credits
    const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
        amount: estimatedCost,
        ref_type: 'replicate',
        ref_id: jobRef
    });

    if (reserveErr) {
        console.error('[Reserve Error]', reserveErr);
        return res.status(500).json({ error: 'Reserve failed' });
    }

    if (!reserved) {
        return res.status(402).json({
            error: 'INSUFFICIENT_CREDITS',
            code: 'INSUFFICIENT_CREDITS',
            message: 'Insufficient credits'
        });
    }

    // 2) Call Replicate
    try {
        const token = getToken();
        const isModelPath = version.includes('/') && !version.match(/^[a-f0-9]{64}$/);
        const targetUrl = isModelPath
            ? `${REPLICATE_API_BASE}/models/${version}/predictions`
            : `${REPLICATE_API_BASE}/predictions`;

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

            // 429 Rate limit → wait and retry
            if (response.status === 429 && attempt < maxRetries) {
                let retryAfter = 10;
                try {
                    const errData = JSON.parse(await response.text());
                    retryAfter = errData.retry_after || errData.detail?.match(/~(\d+)s/)?.[1] || 10;
                } catch { }
                const waitMs = (Number(retryAfter) + 2) * 1000;
                console.log(`[Replicate] Rate limited. Waiting ${waitMs / 1000}s...`);
                await new Promise(r => setTimeout(r, waitMs));
                continue;
            }

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[Replicate] Error ${response.status}: ${errText}`);

                // Refund via ledger
                await supabaseUser.rpc('refund_reserve', {
                    amount: estimatedCost,
                    ref_type: 'replicate',
                    ref_id: jobRef
                });

                return res.status(response.status).json({ error: errText });
            }

            const data = await response.json();

            // Finalize (burn reserved credits)
            await supabaseUser.rpc('finalize_reserve', {
                ref_type: 'replicate',
                ref_id: jobRef
            });

            return res.json(data);
        }

        // Max retries exceeded → refund
        await supabaseUser.rpc('refund_reserve', {
            amount: estimatedCost,
            ref_type: 'replicate',
            ref_id: jobRef
        });

        return res.status(429).json({ error: '请求频率过高，请稍后重试。' });
    } catch (error: any) {
        console.error('[Replicate] Error:', error.message);

        // Safety refund
        try {
            await supabaseUser.rpc('refund_reserve', {
                amount: estimatedCost,
                ref_type: 'replicate',
                ref_id: jobRef
            });
        } catch (_) { /* best effort */ }

        res.status(500).json({ error: error.message || 'Replicate prediction failed' });
    }
});

// GET /api/replicate/status/:id
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
