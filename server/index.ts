/**
 * Local Development Server Entry Point
 * This imports the same Express app used by Vercel Serverless in api/index.ts
 * and starts it listening on the specified port.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import app from '../api/index';

const PORT = process.env.API_SERVER_PORT || 3002;

app.listen(PORT, () => {
    console.log(`\n🎬 AI Cine Director Local Server`);
    console.log(`   Running on http://localhost:${PORT}`);
    console.log(`   Gemini Key: ${process.env.GEMINI_API_KEY ? '✅' : '❌'}`);
    console.log(`   Replicate Token: ${process.env.REPLICATE_API_TOKEN ? '✅' : '❌'}`);
    console.log(`   Stripe Key: ${process.env.STRIPE_SECRET_KEY ? '✅' : '❌'}\n`);
});
