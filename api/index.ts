import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// --- Types ---
interface ReplicateResponse {
    id: string;
    status: string;
    output?: any;
    error?: string;
}

// --- Setup ---
dotenv.config({ path: '.env.local' });
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

const getReplicateToken = () => {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) throw new Error('REPLICATE_API_TOKEN not configured');
    return token;
};

const getSupabaseAdmin = () => {
    const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase URL or Service Key missing');
    return createClient(url, key);
};

const getStripe = () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY missing');
    return new Stripe(key, { apiVersion: '2026-01-28.clover' });
};

// --- Auth ---
const requireAuth = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

    const rawAuthHeader = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const token = rawAuthHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'Invalid Authorization header' });

    req.accessToken = token;
    const supabase = getSupabaseAdmin();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        console.error('[Auth Error]', error);
        return res.status(401).json({ error: `Invalid token: ${error?.message || 'No user found'}` });
    }
    req.user = user;
    next();
};

// --- Cost ---
const estimateCost = (model: string): number => {
    const COSTS: Record<string, number> = {
        'wan-video/wan-2.2-i2v-fast': 8,
        'minimax/hailuo-02-fast': 18,
        'bytedance/seedance-1-lite': 28,
        'kwaivgi/kling-v2.5-turbo-pro': 53,
        'minimax/video-01-live': 75,
        'black-forest-labs/flux-1.1-pro': 6,
        'black-forest-labs/flux-schnell': 1,
    };
    return COSTS[model] || 20;
};

// --- Admin Check ---
const ADMIN_EMAILS = [
    'forevercrab321@gmail.com',
    'monsterlee@gmail.com',
];

const isAdminUser = (email: string | undefined): boolean => {
    if (!email) return false;
    return ADMIN_EMAILS.includes(email.toLowerCase());
};

// --- Routes ---

// Replicate Predict with Reserve / Finalize / Refund
app.post('/api/replicate/predict', requireAuth, async (req: any, res: any) => {
    const { version, input } = req.body;
    const authHeader = `Bearer ${req.accessToken}`;
    const userEmail = req.user?.email;

    const estimatedCost = estimateCost(version);
    const jobRef = `replicate:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    // ★ ADMIN BYPASS: Skip credit check for admin users
    const skipCreditCheck = isAdminUser(userEmail);
    if (skipCreditCheck) {
        console.log(`[ADMIN BYPASS] Skipping credit reserve for admin: ${userEmail} (cost would be ${estimatedCost})`);
    }

    // User-context client for RPC
    const supabaseUser = createClient(
        process.env.VITE_SUPABASE_URL!,
        process.env.VITE_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: authHeader } } }
    );

    // 1) Reserve credits (skip for admin)
    let reserved = true;
    if (!skipCreditCheck) {
        const { data, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
            amount: estimatedCost,
            ref_type: 'replicate',
            ref_id: jobRef
        });
        reserved = data;

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
    }

    // 2) Call Replicate
    try {
        const token = getReplicateToken();
        const base = 'https://api.replicate.com/v1';

        const isModelPath = version.includes('/') && !version.match(/^[a-f0-9]{64}$/);
        const targetUrl = isModelPath ? `${base}/models/${version}/predictions` : `${base}/predictions`;

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
            const errText = await response.text();
            // 3a) Refund reserve (skip for admin)
            if (!skipCreditCheck) {
                await supabaseUser.rpc('refund_reserve', {
                    amount: estimatedCost,
                    ref_type: 'replicate',
                    ref_id: jobRef
                });
            }
            return res.status(response.status).json({ error: errText });
        }

        const prediction = await response.json() as ReplicateResponse;

        // 3b) Finalize reserve (skip for admin)
        if (!skipCreditCheck) {
            await supabaseUser.rpc('finalize_reserve', {
                ref_type: 'replicate',
                ref_id: jobRef
            });
        }

        res.json(prediction);

    } catch (err: any) {
        console.error('[Replicate Error]', err);
        // Safety refund on unexpected error (skip for admin)
        if (!skipCreditCheck) {
            await supabaseUser.rpc('refund_reserve', {
                amount: estimatedCost,
                ref_type: 'replicate',
                ref_id: jobRef
            });
        }
        res.status(500).json({ error: err.message || 'Replicate failed' });
    }
});

// Replicate Status
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
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- Gemini Routes (must be inline for Vercel serverless) ---

const getGeminiAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    return new GoogleGenAI({ apiKey });
};

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

app.post('/api/gemini/generate', requireAuth, async (req: any, res: any) => {
    const jobRef = `gemini:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
        const { storyIdea, visualStyle, language, identityAnchor } = req.body;
        const authHeader = `Bearer ${req.accessToken}`;
        const userEmail = req.user?.email;
        const skipCreditCheck = isAdminUser(userEmail);

        const supabaseUser = createClient(
            process.env.VITE_SUPABASE_URL!,
            process.env.VITE_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader } } }
        );

        // Reserve 1 credit
        const COST = 1;
        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'gemini', ref_id: jobRef
            });

            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'INSUFFICIENT_CREDITS', code: 'INSUFFICIENT_CREDITS' });
        } else {
            console.log(`[ADMIN BYPASS] Skipping gemini credit reserve for admin: ${userEmail}`);
        }
        if (!storyIdea) return res.status(400).json({ error: 'Missing storyIdea' });

        const ai = getGeminiAI();
        const systemInstruction = `
**Role:** Professional Hollywood Screenwriter & Director of Photography.
**Task:** Break down the User's Story Concept into a production-ready script with 5 distinct scenes.

**★ CRITICAL — CHARACTER CONSISTENCY RULES (MANDATORY):**
The "character_anchor" field is the SINGLE SOURCE OF TRUTH for the protagonist's appearance.
It MUST be an extremely detailed, frozen visual identity containing ALL of the following:
- Exact ethnicity and age range
- Face shape, eye/hair color, hair style
- Outfit: exact clothing with colors and materials (e.g., "red ski suit")
- Specific Equipment: (e.g., "snowboard", "skis", or "camera")

**★ CRITICAL RULE FOR VISUAL DESCRIPTION:**
You MUST rigidly copy the character's exact clothing, colors, and specific equipment from the \`character_anchor\` into EVERY SINGLE \`visual_description\`. 
NEVER change their equipment (e.g., do NOT switch a snowboard to skis). 
If the anchor wears a 'red suit', you must explicitly write 'wearing a red suit' in the visual description of Scene 1, Scene 2, Scene 3, Scene 4, and Scene 5. 
Diffusion models have no memory; you must feed them the exact visual traits in every prompt.

EVERY scene's "visual_description" MUST begin with the EXACT character_anchor text, word for word, followed by the scene-specific action and environment. 

**Technical Precision:** Describe camera movements, lighting, and composition.

**Language Rule:**
* **visual_description** & **shot_type**: ALWAYS in English.
* **audio_description** & **project_title**: ${language === 'zh' ? "Chinese (Simplified)" : "English"}.
**Output Format:** JSON strictly following the provided schema.`;

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `Draft a 5-scene storyboard for: ${storyIdea}. Style: ${visualStyle}`,
                config: { systemInstruction, responseMimeType: 'application/json', responseSchema: geminiResponseSchema, temperature: 0.7 },
            });
        } catch (initialError: any) {
            if (initialError.message?.includes('429') || initialError.message?.includes('Resource exhausted')) {
                response = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: `Draft a 5-scene storyboard for: ${storyIdea}. Style: ${visualStyle}`,
                    config: { systemInstruction, responseMimeType: 'application/json', responseSchema: geminiResponseSchema, temperature: 0.7 },
                });
            } else {
                throw initialError;
            }
        }

        const text = response.text;
        if (!text) throw new Error('No response from AI Director.');
        const project = JSON.parse(text);
        project.scenes = project.scenes.map((s: any) => ({
            ...s,
            image_prompt: `${project.character_anchor}, ${s.visual_description}, ${s.shot_type}`,
            video_motion_prompt: s.shot_type,
        }));

        if (!skipCreditCheck) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'gemini', ref_id: jobRef });
        }
        res.json(project);
    } catch (error: any) {
        console.error('[Gemini] Error:', error);
        try {
            const supabaseRefund = createClient(
                process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!,
                { global: { headers: { Authorization: `Bearer ${req.accessToken}` } } }
            );
            await supabaseRefund.rpc('refund_reserve', { amount: 1, ref_type: 'gemini', ref_id: jobRef });
        } catch (_) { /* best effort */ }

        const isQuotaError = error.message?.includes('429') || error.message?.includes('Resource exhausted');
        res.status(isQuotaError ? 429 : 500).json({
            error: isQuotaError ? '系统繁忙，请稍后再试。' : (error.message || 'Gemini generation failed'),
        });
    }
});

app.post('/api/gemini/analyze', async (req: any, res: any) => {
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

// Billing checkout
app.post('/api/billing/checkout', requireAuth, async (req: any, res: any) => {
    const { packageId } = req.body;
    const userId = req.user.id;
    const stripe = getStripe();

    const PACKAGES: Record<string, { price: number, credits: number, name: string }> = {
        'pack_small': { price: 500, credits: 500, name: 'Starter Pack (500 Credits)' },
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
});

// Billing webhook → add credits directly to profiles + ledger
app.post('/api/billing/webhook', async (req: any, res: any) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripe = getStripe();

    let event;
    try {
        if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET missing');
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
        console.error('[Webhook Error]', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;

        // Stripe Payment Links use client_reference_id, fallback to metadata for custom sessions
        const userId = session.client_reference_id || session.metadata?.user_id;

        // Payment Link doesn't carry custom metadata by default, grant 1000 credits 
        const credits = Number(session.metadata?.credits) || 1000;

        if (userId && credits) {
            const supabase = getSupabaseAdmin();

            // 1) Fetch current balance, then update
            const { data: profile } = await supabase
                .from('profiles')
                .select('credits')
                .eq('id', userId)
                .single();

            const newBalance = (profile?.credits || 0) + credits;

            await supabase
                .from('profiles')
                .update({ credits: newBalance })
                .eq('id', userId);

            // 2) Insert ledger record
            await supabase.from('credits_ledger').insert({
                user_id: userId,
                delta: credits,
                kind: 'purchase',
                ref_type: 'stripe',
                ref_id: String(session.id),
                status: 'settled'
            });

            console.log(`[Billing] Added ${credits} credits to user ${userId}`);
        }
    }

    res.json({ received: true });
});

// Health
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), build: 'ledger-v2-profiles-reserve' });
});

export default app;