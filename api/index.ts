import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// --- Type Definitions ---
interface ReplicateResponse {
    id: string;
    status: string;
    output?: any;
    error?: string;
    [key: string]: any;
}

// --- Configuration ---
dotenv.config({ path: '.env.local' });
const app = express();

// --- Middleware ---
// Raw body needed for Stripe webhook signature verification
app.use(cors({ origin: true, credentials: true }));
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// --- Helpers & Clients ---
const getGeminiAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured on server');
    return new GoogleGenAI({ apiKey });
};

const getReplicateToken = () => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error('REPLICATE_API_TOKEN not configured on server');
    return token;
};

// Supabase Admin Client (Service Role) - for trusted backend operations
const getSupabaseAdmin = () => {
    const updatedUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!updatedUrl || !serviceKey) throw new Error('Supabase URL or Service Key missing');
    return createClient(updatedUrl, serviceKey);
};

// Stripe Client
const getStripe = () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY missing');
    return new Stripe(key, { apiVersion: '2023-10-16' });
};

// Auth Middleware
const requireAuth = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

    const token = authHeader.replace('Bearer ', '');
    const supabase = getSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    next();
};

// Cost Estimation Helper
const estimateCost = (model: string): number => {
    // Should match frontend constants or be slightly safer
    const COSTS: Record<string, number> = {
        'wan-video/wan-2.2-i2v-fast': 8,
        'minimax/hailuo-02-fast': 18,
        'bytedance/seedance-1-lite': 28,
        'kwaivgi/kling-v2.5-turbo-pro': 53,
        'minimax/video-01-live': 75,
        'black-forest-labs/flux-1.1-pro': 6,
        'black-forest-labs/flux-schnell': 1,
    };
    // Default fallback
    return COSTS[model] || 20;
};

// --- Routes ---

// 1. Replicate Prediction (With Credit Check)
app.post('/api/replicate/predict', requireAuth, async (req: any, res: any) => {
    try {
        const { version, input } = req.body; // version is full model path (owner/name) or ID
        const userId = req.user.id;
        const supabase = getSupabaseAdmin();

        // 1. Identify Model & Estimate Cost
        // If version is a hash, we might need a mapping, but assuming full path for now based on service
        // Let's rely on what the frontend sends. Services usually send full path now.
        // If it's a hash, we default to 20.
        const modelKey = version.split(':')[0]; // simpler check
        const estimatedCost = estimateCost(version);

        // 2. Reserve Credits (Atomic RPC)
        const { data: reserveResult, error: reserveError } = await supabase
            .rpc('reserve_credits', {
                p_user_id: userId,
                p_amount: estimatedCost,
                p_meta: { action: 'predict', model: version }
            });

        if (reserveError) throw new Error(reserveError.message);

        // 3. Handle Insufficient Funds
        // RPC returns { success: bool, error?: string, ... }
        const result = reserveResult as any;
        if (!result || !result.success) {
            return res.status(402).json(result);
        }

        // 4. Call Replicate
        const token = getReplicateToken();
        const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

        // Use standard model path or version
        const isModelPath = version.includes('/') && !version.match(/^[a-f0-9]{64}$/);
        const targetUrl = isModelPath
            ? `${REPLICATE_API_BASE}/models/${version}/predictions`
            : `${REPLICATE_API_BASE}/predictions`;

        // Setup Webhook for async completion
        // If deployed on Vercel, we need the real URL.
        // For dev, we might verify via polling or ngrok.
        // Here we'll stick to frontend polling for simplicity unless user provided a domain.
        // BUT Requirement 7 says: "implement /api/billing/webhook". 
        // Replicate webhook isn't strictly requested but is good practice.
        // For now, let's keep the synchronous start + frontend poll pattern 
        // BUT we must track the specific prediction ID to settle credits later.

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Prefer: 'wait', // Trying to get result immediately if fast
            },
            body: JSON.stringify(isModelPath ? { input } : { version, input }),
        });

        if (!response.ok) {
            // Refund on immediate API failure
            await supabase.rpc('release_credits', {
                p_user_id: userId,
                p_amount: estimatedCost,
                p_meta: { reason: 'api_error' }
            });
            const errText = await response.text();
            return res.status(response.status).json({ error: errText });
        }

        const prediction = await response.json() as ReplicateResponse;

        // 5. Record Job
        await supabase.from('generation_jobs').insert({
            user_id: userId,
            prediction_id: prediction.id,
            status: prediction.status,
            model: version,
            estimated_cost: estimatedCost,
            actual_cost: estimatedCost // placeholder
        });

        // 6. Return to Frontend
        // Frontend will poll. If it fails later, we need a way to refund.
        // Ideally we need a Replicate Webhook.
        // For now, we will rely on a "check status" endpoint that also settles credits if finished.
        res.json(prediction);

    } catch (error: any) {
        console.error('[Replicate Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Replicate Status Check & Credit Settlement
app.get('/api/replicate/status/:id', requireAuth, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const supabase = getSupabaseAdmin();
        const token = getReplicateToken();

        const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) return res.status(response.status).json({ error: await response.text() });
        const prediction = await response.json() as ReplicateResponse;

        // Sync Status to DB
        // If terminal state, settle credits
        if (['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
            // Get job to know estimated cost
            const { data: job } = await supabase
                .from('generation_jobs')
                .select('*')
                .eq('prediction_id', id)
                .single();

            if (job && job.status !== prediction.status) {
                // Settle
                if (prediction.status === 'succeeded') {
                    // Commit (burn reserved)
                    // If we want exact time-based billing, we'd adjust cost here. 
                    // For now, commit estimated cost.
                    await supabase.rpc('commit_credits', {
                        p_user_id: userId,
                        p_amount: job.estimated_cost,
                        p_meta: { prediction_id: id }
                    });
                } else {
                    // Refund
                    await supabase.rpc('release_credits', {
                        p_user_id: userId,
                        p_amount: job.estimated_cost,
                        p_meta: { reason: prediction.status, prediction_id: id }
                    });
                }

                // Update Job
                await supabase
                    .from('generation_jobs')
                    .update({ status: prediction.status, updated_at: new Date().toISOString() })
                    .eq('id', job.id);
            }
        }

        res.json(prediction);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});


// 3. Billing: Create Checkout Session
app.post('/api/billing/checkout', requireAuth, async (req: any, res: any) => {
    try {
        const { packageId } = req.body;
        const userId = req.user.id;
        const stripe = getStripe();

        // Define Packages Map
        const PACKAGES: Record<string, { price: number, credits: number, name: string }> = {
            'pack_small': { price: 500, credits: 500, name: 'Starter Pack (500 Credits)' }, // cents
            'pack_medium': { price: 1000, credits: 1200, name: 'Value Pack (1200 Credits)' },
            'pack_large': { price: 2500, credits: 3500, name: 'Pro Pack (3500 Credits)' },
        };

        const pkg = PACKAGES[packageId];
        if (!pkg) return res.status(400).json({ error: 'Invalid package' });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: pkg.name },
                    unit_amount: pkg.price,
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.headers.origin}/?success=true`,
            cancel_url: `${req.headers.origin}/?canceled=true`,
            metadata: {
                user_id: userId,
                credits: pkg.credits.toString()
            }
        });

        res.json({ url: session.url });
    } catch (error: any) {
        console.error('[Stripe Checkout]', error);
        res.status(500).json({ error: error.message });
    }
});


// 4. Billing: Webhook
app.post('/api/billing/webhook', async (req: any, res: any) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    const stripe = getStripe();

    try {
        if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET missing');
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
        console.error('[Webhook Error]', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        const credits = Number(session.metadata?.credits);

        if (userId && credits) {
            const supabase = getSupabaseAdmin();
            await supabase.rpc('add_credits', {
                p_user_id: userId,
                p_amount: credits,
                p_meta: { stripe_session_id: session.id }
            });
            console.log(`[Billing] Added ${credits} credits to user ${userId}`);
        }
    }

    res.json({ received: true });
});


// --- Other Existing Routes (Gemini) --- 
// Kept largely as is, but we could add auth here too if desired.
// For now focusing on Credit Logic request.

const geminiResponseSchema = {
    type: Type.OBJECT,
    properties: {
        project_title: { type: Type.STRING },
        visual_style: { type: Type.STRING },
        character_anchor: { type: Type.STRING },
        scenes: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    scene_number: { type: Type.INTEGER },
                    visual_description: { type: Type.STRING },
                    audio_description: { type: Type.STRING },
                    shot_type: { type: Type.STRING },
                },
                required: ['scene_number', 'visual_description', 'audio_description', 'shot_type'],
            },
        },
    },
    required: ['project_title', 'visual_style', 'character_anchor', 'scenes'],
};

// Assuming Gemini is free for now or included in "Director Mode"
app.post('/api/gemini/generate', async (req: any, res: any) => {
    // ... existing implementation ...
    // Note: Re-implementing briefly to keep file complete
    try {
        const { storyIdea, visualStyle, language, identityAnchor } = req.body;
        if (!storyIdea) return res.status(400).json({ error: 'Missing storyIdea' });
        const ai = getGeminiAI();
        const systemInstruction = `
**Role:** Professional Hollywood Screenwriter & Director of Photography.
**Task:** Break down the User's Story Concept into a production-ready script with 5 distinct scenes.
**CORE PHILOSOPHY: THE ANCHOR METHOD**
1. **Character Continuity:** ${identityAnchor ? `The character is LOCKED to: "${identityAnchor}"` : `Define a unique visual identity ("Anchor") for the protagonist.`}
2. **Technical Precision:** Describe camera movements, lighting, and action keywords.
**Language Rule:**
* **visual_description** & **shot_type**: ALWAYS in English.
* **audio_description** & **project_title**: ${language === 'zh' ? "Chinese (Simplified)" : "English"}.
**Output Format:** JSON strictly following the provided schema.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: `Draft a 5-scene storyboard for: ${storyIdea}. Style: ${visualStyle}`,
            config: { systemInstruction, responseMimeType: 'application/json', responseSchema: geminiResponseSchema, temperature: 0.7 },
        });
        const text = response.text;
        if (!text) throw new Error('No response from AI Director.');
        const project = JSON.parse(text);
        project.scenes = project.scenes.map((s: any) => ({
            ...s,
            image_prompt: `${project.character_anchor}, ${s.visual_description}, ${s.shot_type}`,
            video_motion_prompt: s.shot_type,
        }));
        res.json(project);
    } catch (error: any) {
        console.error('[Gemini] Error:', error);
        res.status(500).json({ error: error.message || 'Gemini generation failed' });
    }
});

app.post('/api/gemini/analyze', async (req: any, res: any) => {
    // ... existing implementation ...
    try {
        const { base64Data } = req.body;
        if (!base64Data) return res.status(400).json({ error: 'Missing base64Data' });
        const ai = getGeminiAI();
        const cleanBase64 = base64Data.split(',')[1] || base64Data;
        const mimeType = base64Data.match(/:(.*?);/)?.[1] || 'image/png';
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: { parts: [{ inlineData: { mimeType, data: cleanBase64 } }, { text: 'Analyze this character and extract a dense Identity Anchor description: face, hair, and key outfit elements.' }] },
        });
        res.json({ anchor: (response.text || 'A cinematic character').trim() });
    } catch (error: any) {
        console.error('[Gemini Analyze] Error:', error.message);
        res.json({ anchor: 'A cinematic character' });
    }
});

// Health
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), build: 'monolithic-v2-credit-system' });
});

export default app;
