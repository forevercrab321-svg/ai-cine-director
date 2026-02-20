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

// ★ Cost map — must match frontend MODEL_COSTS in types.ts
const BACKEND_COST_MAP: Record<string, number> = {
    'wan-video/wan-2.2-i2v-fast': 8,
    'minimax/hailuo-02-fast': 18,
    'bytedance/seedance-1-lite': 28,
    'kwaivgi/kling-v2.5-turbo-pro': 53,
    'minimax/video-01-live': 75,
    'black-forest-labs/flux-1.1-pro': 6,
    'black-forest-labs/flux-schnell': 1,
};

// POST /api/replicate/predict - Creating Prediction
replicateRouter.post('/predict', async (req, res) => {
    try {
        const token = getToken();

        // 1. Auth Check
        const authHeader = req.headers.authorization; // "Bearer <user_token>"
        if (!authHeader) {
            return res.status(401).json({ error: "Missing Authorization header" });
        }

        const userToken = authHeader.replace('Bearer ', '');

        // 2. Validate User via Admin client
        const supabaseAdmin = getSupabaseAdmin();
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(userToken);

        if (authError || !user) {
            return res.status(401).json({ error: "Invalid or expired token" });
        }

        const { version, input, model } = req.body;

        if (!version || !input) {
            return res.status(400).json({ error: 'Missing version or input' });
        }

        // 3. Estimate Cost
        let estimatedCost = BACKEND_COST_MAP[version] || 20;

        // 4. ★ Deduct Credits (Atomic) — use USER client so auth.uid() works in RPC
        const supabaseUserClient = createClient(
            process.env.VITE_SUPABASE_URL!,
            process.env.VITE_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: deductSuccess, error: deductError } = await supabaseUserClient.rpc('deduct_credits', {
            amount_to_deduct: estimatedCost,
            model_used: model || version,
            base_cost: estimatedCost,
            multiplier: 1
        });

        if (deductError) {
            console.error('[Credit Deduct Error]', deductError);
            return res.status(500).json({ error: 'Credit verification failed: ' + deductError.message });
        }

        // deduct_credits returns boolean: true = OK, false = insufficient
        if (!deductSuccess) {
            return res.status(402).json({
                error: 'INSUFFICIENT_CREDITS',
                code: 'INSUFFICIENT_CREDITS',
                message: 'Insufficient credits to perform this action'
            });
        }

        // 5. ★ Call Replicate API
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

            // 429 Rate limit → wait and retry
            if (response.status === 429 && attempt < maxRetries) {
                let retryAfter = 10;
                try {
                    const errData = JSON.parse(await response.text());
                    retryAfter = errData.retry_after || errData.detail?.match(/~(\d+)s/)?.[1] || 10;
                } catch { }
                const waitMs = (Number(retryAfter) + 2) * 1000;
                console.log(`[Replicate] Rate limited (429). Waiting ${waitMs / 1000}s before retry...`);
                await new Promise(r => setTimeout(r, waitMs));
                continue;
            }

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[Replicate] Error ${response.status}: ${errText}`);

                // Refund credits on Replicate API failure
                try {
                    const { data: profile } = await supabaseAdmin
                        .from('profiles')
                        .select('credits')
                        .eq('id', user.id)
                        .single();
                    if (profile) {
                        await supabaseAdmin
                            .from('profiles')
                            .update({ credits: Math.max(0, (profile.credits || 0) + estimatedCost) })
                            .eq('id', user.id);
                        console.log(`[Replicate] Refunded ${estimatedCost} credits to user ${user.id}`);
                    }
                } catch (refundErr) {
                    console.error('[Replicate] Failed to refund credits:', refundErr);
                }

                return res.status(response.status).json({ error: errText });
            }

            const data = await response.json();
            return res.json(data);
        }

        // Max retries exceeded
        return res.status(429).json({ error: 'Rate limit exceeded after retries. Please try again later.' });
    } catch (error: any) {
        console.error('[Replicate] Error:', error.message);
        res.status(500).json({ error: error.message || 'Replicate prediction failed' });
    }
});


// GET /api/replicate/status/:id - Query task status (no credit settlement needed, deduction was upfront)
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
