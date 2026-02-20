/**
 * Replicate API 代理路由
 * 安全地在服务器端调用 Replicate API
 */
import { Router } from 'express';

export const replicateRouter = Router();

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

const getToken = () => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error('REPLICATE_API_TOKEN not configured on server');
    return token;
};

// POST /api/replicate/predict - 创建预测任务（图片/视频生成）
// 自动重试 429 速率限制错误
replicateRouter.post('/predict', async (req, res) => {
    try {
        const token = getToken();
        const { version, input } = req.body;

        if (!version || !input) {
            return res.status(400).json({ error: 'Missing version or input' });
        }

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
