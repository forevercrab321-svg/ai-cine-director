/**
 * Express API Server - 安全代理层
 * 所有敏感 API Key 仅在此服务器端使用，不暴露给前端
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { geminiRouter } from './routes/gemini';
import { replicateRouter } from './routes/replicate';
import fetch from 'node-fetch';

if (!globalThis.fetch) {
    // @ts-ignore
    globalThis.fetch = fetch;
    // @ts-ignore
    globalThis.Headers = fetch.Headers;
    // @ts-ignore
    globalThis.Request = fetch.Request;
    // @ts-ignore
    globalThis.Response = fetch.Response;
}

// 加载 .env.local
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.API_SERVER_PORT || 3002;

// 中间件
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' })); // 支持 base64 图片上传

// 路由
app.use('/api/gemini', geminiRouter);
app.use('/api/replicate', replicateRouter);

// 健康检查
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        geminiKey: !!process.env.GEMINI_API_KEY ? '✅ configured' : '❌ missing',
        replicateToken: !!process.env.REPLICATE_API_TOKEN ? '✅ configured' : '❌ missing',
    });
});

// For Vercel Serverless (Export the app)
export default app;

// For Local Development (Run the server)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`\n🎬 AI Cine Director API Server`);
        console.log(`   Running on http://localhost:${PORT}`);
        console.log(`   Gemini Key: ${process.env.GEMINI_API_KEY ? '✅' : '❌'}`);
        console.log(`   Replicate Token: ${process.env.REPLICATE_API_TOKEN ? '✅' : '❌'}\n`);
    });
}
