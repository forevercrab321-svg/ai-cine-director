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
    return new Stripe(key, { apiVersion: '2026-01-28.clover' });
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
        const { version, input } = req.body;
        const userId = req.user.id;
        const authHeader = req.headers.authorization; // "Bearer <user_token>"

        // 1. Identify Model & Estimate Cost
        const estimatedCost = estimateCost(version);

        // 2. Deduct Credits using user-context client (so auth.uid() works in RPC)
        // Using deduct_credits RPC which is atomic and prevents negative credits
        const supabaseUserClient = createClient(
            process.env.VITE_SUPABASE_URL!,
            process.env.VITE_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: deductSuccess, error: deductError } = await supabaseUserClient.rpc('deduct_credits', {
            amount_to_deduct: estimatedCost,
            model_used: version,
            base_cost: estimatedCost,
            multiplier: 1
        });

        if (deductError) {
            console.error('[Credit Deduct Error]', deductError);
            return res.status(500).json({ error: 'Credit verification failed: ' + deductError.message });
        }

        // deduct_credits returns boolean: true = deducted, false = insufficient
        if (!deductSuccess) {
            return res.status(402).json({
                error: 'INSUFFICIENT_CREDITS',
                code: 'INSUFFICIENT_CREDITS',
                message: 'Insufficient credits to perform this action'
            });
        }

        // 3. Call Replicate API
        const token = getReplicateToken();
        const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

        const isModelPath = version.includes('/') && !version.match(/^[a-f0-9]{64}$/);
        const targetUrl = isModelPath
            ? `${REPLICATE_API_BASE}/models/${version}/predictions`
            : `${REPLICATE_API_BASE}/predictions`;

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Prefer: 'wait',
            },
            body: JSON.stringify(isModelPath ? { input } : { version, input }),
        });

        if (!response.ok) {
            // Replicate call failed after credit deduction — refund credits via admin client
            try {
                const supabaseAdmin = getSupabaseAdmin();
                const { data: profile } = await supabaseAdmin
                    .from('profiles')
                    .select('credits')
                    .eq('id', userId)
                    .single();
                if (profile) {
                    await supabaseAdmin
                        .from('profiles')
                        .update({ credits: Math.max(0, (profile.credits || 0) + estimatedCost) })
                        .eq('id', userId);
                    console.log(`[Replicate] Refunded ${estimatedCost} credits to user ${userId} after API failure`);
                }
            } catch (refundErr) {
                console.error('[Replicate] Failed to refund credits after API error:', refundErr);
            }
            const errText = await response.text();
            console.error(`[Replicate] Error ${response.status}: ${errText}`);
            return res.status(response.status).json({ error: errText });
        }

        const prediction = await response.json() as ReplicateResponse;

        // 4. Log the job (best effort)
        try {
            const supabaseAdmin = getSupabaseAdmin();
            await supabaseAdmin.from('generation_jobs').insert({
                user_id: userId,
                prediction_id: prediction.id,
                status: prediction.status,
                model: version,
                estimated_cost: estimatedCost,
                actual_cost: estimatedCost
            });
        } catch (e) {
            console.warn('[Job Log] Failed to log job (non-fatal):', e);
        }

        res.json(prediction);

    } catch (error: any) {
        console.error('[Replicate Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// 2. Replicate Status Check (simple pass-through, no credit settlement needed)
// Credits are deducted upfront atomically via deduct_credits RPC
app.get('/api/replicate/status/:id', requireAuth, async (req: any, res: any) => {
    try {
        const { id } = req.params;
        const token = getReplicateToken();

        const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) return res.status(response.status).json({ error: await response.text() });
        const prediction = await response.json() as ReplicateResponse;
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
            // Use direct update since add_credits RPC may not exist or have diff params
            const { data: profile } = await supabase
                .from('profiles')
                .select('credits')
                .eq('id', userId)
                .single();

            if (profile) {
                await supabase
                    .from('profiles')
                    .update({ credits: (profile.credits || 0) + credits })
                    .eq('id', userId);
                console.log(`[Billing] Added ${credits} credits to user ${userId}. New balance: ${(profile.credits || 0) + credits}`);
            }
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
