import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// ═══════════════════════════════════════════════════════════════
// INLINED TYPES FROM types.ts (Vercel cannot resolve ../types)
// ═══════════════════════════════════════════════════════════════

type VideoModel = 'wan_2_2_fast' | 'hailuo_02_fast' | 'seedance_lite' | 'kling_2_5' | 'hailuo_live' | 'google_gemini_nano_banana';
type ImageModel = 'flux' | 'flux_schnell' | 'nano_banana';
type BatchJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
type BatchItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface BatchJob {
  id: string;
  project_id: string;
  user_id?: string;
  type: 'gen_images' | 'gen_images_continue';
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  status: BatchJobStatus;
  created_at: string;
  updated_at: string;
  concurrency: number;
  range_start_scene?: number;
  range_start_shot?: number;
  range_end_scene?: number;
  range_end_shot?: number;
  strategy?: 'strict' | 'skip_failed';
  all_done?: boolean;
  remaining_count?: number;
}

interface BatchJobItem {
  id: string;
  job_id: string;
  shot_id: string;
  shot_number: number;
  scene_number: number;
  status: BatchItemStatus;
  image_id?: string;
  image_url?: string;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

const REPLICATE_MODEL_PATHS: Record<VideoModel | ImageModel, string> = {
  wan_2_2_fast: "wan-video/wan-2.2-i2v-fast",
  hailuo_02_fast: "minimax/hailuo-02-fast",
  seedance_lite: "bytedance/seedance-1-lite",
  kling_2_5: "kwaivgi/kling-v2.5-turbo-pro",
  hailuo_live: "minimax/video-01-live",
  google_gemini_nano_banana: "google/gemini-nano-banana",
  flux: "black-forest-labs/flux-1.1-pro",
  flux_schnell: "black-forest-labs/flux-schnell",
  nano_banana: "google/gemini-nano-banana"
};

const IMAGE_MODEL_COSTS: Record<ImageModel, number> = {
  flux: 6,
  flux_schnell: 1,
  nano_banana: 2
};

interface StylePreset {
  id: string;
  label: string;
  category: string;
  promptModifier: string;
}

const STYLE_PRESETS: StylePreset[] = [
  { id: 'chinese_3d', label: 'Chinese 3D Anime (国漫)', category: '🇨🇳 Chinese Aesthetics', promptModifier: ', 3D donghua style, Light Chaser Animation aesthetic, White Snake inspired, oriental fantasy, highly detailed 3D render, blind box texture, 8k, ethereal lighting, martial arts vibe, consistent character features' },
  { id: 'chinese_ink', label: 'Chinese Ink Wash (水墨)', category: '🇨🇳 Chinese Aesthetics', promptModifier: ', traditional Chinese ink wash painting, shuimo style, watercolor texture, flowing ink, negative space, oriental landscape, artistic, Shanghai Animation Film Studio style, masterpiece' },
  { id: 'pop_mart', label: 'Pop Mart 3D (盲盒)', category: '🇨🇳 Chinese Aesthetics', promptModifier: ', Pop Mart style, blind box toy, C4D render, clay material, cute proportions, studio lighting, clean background, 3D character design, plastic texture' },
  { id: 'realism', label: 'Hyper Realism (4K ARRI)', category: '🎥 Cinema & Realism', promptModifier: ', photorealistic, shot on ARRI Alexa, 35mm lens, cinematic lighting, depth of field, hyper-realistic, live action footage, raytracing, 8k, raw photo' },
  { id: 'blockbuster_3d', label: 'Hollywood Blockbuster', category: '🎥 Cinema & Realism', promptModifier: ', hollywood blockbuster style, Unreal Engine 5 render, IMAX quality, cinematic composition, dramatic lighting, highly detailed VFX, transformers style, sci-fi masterpiece' },
  { id: 'cyberpunk', label: 'Cinematic Cyberpunk', category: '🎥 Cinema & Realism', promptModifier: ', futuristic sci-fi masterpiece, neon lights, high tech, cybernetic atmosphere, blade runner style, night city, volumetric fog, cinematic' },
  { id: 'ghibli', label: 'Studio Ghibli (吉卜力)', category: '🎨 Art & Anime', promptModifier: ', Studio Ghibli style, Hayao Miyazaki, hand drawn anime, cel shading, vibrant colors, picturesque scenery, 2D animation, cinematic' },
  { id: 'shinkai', label: 'Makoto Shinkai (新海诚)', category: '🎨 Art & Anime', promptModifier: ', Makoto Shinkai style, Your Name style, vibrant vivid colors, highly detailed background art, lens flare, emotional lighting, anime masterpiece, 8k wallpaper' }
];

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
    const raw = process.env.REPLICATE_API_TOKEN;
    const token = raw?.replace(/\s+/g, '');
    if (!token) throw new Error('REPLICATE_API_TOKEN not configured');
    return token;
};

const getSupabaseAdmin = () => {
    const url = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) throw new Error('Supabase URL or Service Key missing');
    return createClient(url, key);
};

const getStripe = () => {
    const key = process.env.STRIPE_SECRET_KEY?.replace(/\s+/g, '');
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

const isUserAlreadyExistsError = (errorLike: any): boolean => {
    const msg = String(errorLike?.message || errorLike || '').toLowerCase();
    return msg.includes('already registered')
        || msg.includes('has already been registered')
        || msg.includes('user already registered')
        || msg.includes('already exists');
};

const findUserIdByEmail = async (supabaseAdmin: any, email: string): Promise<string | undefined> => {
    const target = email.toLowerCase();
    const perPage = 1000;

    for (let page = 1; page <= 10; page += 1) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) {
            console.error('[Auth Ensure User] listUsers failed:', error);
            return undefined;
        }

        const users = (data as any)?.users as Array<{ id: string; email?: string }> | undefined;
        if (!users?.length) return undefined;

        const match = users.find((u) => (u.email || '').toLowerCase() === target);
        if (match?.id) return match.id;

        if (users.length < perPage) return undefined;
    }

    return undefined;
};

// --- Auth helper (supports projects with signups disabled) ---
app.post('/api/auth/ensure-user', async (req: any, res: any) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'Missing email' });

        const supabaseAdmin = getSupabaseAdmin();

        // 1) First try lookup (for already-registered users)
        let userId = await findUserIdByEmail(supabaseAdmin, email);

        // 2) If not found, create user (idempotent fallback)
        if (!userId) {
            const { data: createdUser, error } = await supabaseAdmin.auth.admin.createUser({
                email,
                email_confirm: true
            });

            if (error && !isUserAlreadyExistsError(error)) {
                console.error('[Auth Ensure User] Failed:', error);
                return res.status(500).json({ error: error.message || 'Failed to ensure user' });
            }

            userId = createdUser?.user?.id || await findUserIdByEmail(supabaseAdmin, email);
        }

        if (userId) {
            // Keep this best-effort: some deployed DBs may not have role column yet.
            const { error: upsertErr } = await supabaseAdmin
                .from('profiles')
                .upsert({
                    id: userId,
                    name: email,
                    role: 'Director',
                    credits: 50,
                }, { onConflict: 'id' });

            if (upsertErr) {
                const { error: fallbackUpsertErr } = await supabaseAdmin
                    .from('profiles')
                    .upsert({
                        id: userId,
                        name: email,
                        credits: 50,
                    }, { onConflict: 'id' });

                if (fallbackUpsertErr) {
                    console.error('[Auth Ensure User] Profile upsert failed:', fallbackUpsertErr);
                }
            }
        }

        return res.json({ ok: true });
    } catch (err: any) {
        console.error('[Auth Ensure User] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to ensure user' });
    }
});

app.post('/api/auth/generate-link', async (req: any, res: any) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const redirectTo = String(req.body?.redirectTo || '').trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });

        const supabaseAdmin = getSupabaseAdmin();
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email,
            options: redirectTo ? { redirectTo } : undefined
        });

        if (error || !data?.properties?.action_link) {
            if (error) console.error('[Auth Generate Link] Failed:', error);
            return res.status(500).json({ error: error?.message || 'Failed to generate magic link' });
        }

        return res.json({ actionLink: data.properties.action_link });
    } catch (err: any) {
        console.error('[Auth Generate Link] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to generate magic link' });
    }
});

// POST /api/auth/send-otp — generate magic-link via Admin API + send email via Resend HTTP API
app.post('/api/auth/send-otp', async (req: any, res: any) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'Missing email' });

        const resendKey = process.env.RESEND_API_KEY;
        if (!resendKey) return res.status(500).json({ error: 'RESEND_API_KEY not configured' });

        const supabaseAdmin = getSupabaseAdmin();

        // 1) Ensure user exists
        let userId = await findUserIdByEmail(supabaseAdmin, email);
        if (!userId) {
            const { data: createdUser, error } = await supabaseAdmin.auth.admin.createUser({
                email,
                email_confirm: true,
            });
            if (error && !isUserAlreadyExistsError(error)) {
                console.error('[Send OTP] Create user failed:', error);
                return res.status(500).json({ error: error.message });
            }
            userId = createdUser?.user?.id || await findUserIdByEmail(supabaseAdmin, email);
        }

        // 2) Generate magic link (Admin API — does NOT send email)
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email,
        });

        if (linkError || !linkData) {
            console.error('[Send OTP] generateLink failed:', linkError);
            return res.status(500).json({ error: linkError?.message || 'Failed to generate link' });
        }

        const actionLink = linkData.properties?.action_link || '';
        const emailOtp = (linkData as any).properties?.email_otp
            || (linkData.properties as any)?.verification_token
            || '';

        console.log('[Send OTP] Generated for:', email, '| has token:', !!emailOtp, '| has link:', !!actionLink);

        // 3) Send email via Resend HTTP API
        const emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h1 style="font-size: 24px; font-weight: 800; color: #111; margin: 0;">🎬 CINE-DIRECTOR AI</h1>
                    <p style="color: #666; font-size: 12px; letter-spacing: 2px; margin-top: 4px;">VISIONARY PRODUCTION SUITE</p>
                </div>
                <div style="background: #f8f9fa; border-radius: 16px; padding: 32px; text-align: center;">
                    <h2 style="font-size: 20px; color: #111; margin: 0 0 12px;">Your Login Code</h2>
                    ${emailOtp ? `<div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: white; border-radius: 12px; padding: 16px; margin: 16px 0; font-family: monospace;">${emailOtp}</div>` : ''}
                    <p style="color: #666; font-size: 14px; margin: 16px 0 0;">Or click the button below:</p>
                    <a href="${actionLink}" style="display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 14px 32px; border-radius: 999px; font-weight: 700; font-size: 14px; margin-top: 16px;">Log In to Studio</a>
                </div>
                <p style="color: #999; font-size: 11px; text-align: center; margin-top: 24px;">This link expires in 10 minutes. If you didn't request this, ignore this email.</p>
            </div>
        `;

        // Try custom domain first, fallback to onboarding@resend.dev
        const senders = [
            'AI Cine Director <noreply@aidirector.business>',
            'AI Cine Director <onboarding@resend.dev>',
        ];
        let resendData: any = null;
        let lastErr = '';

        for (const fromAddr of senders) {
            const resendResp = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    from: fromAddr,
                    to: email,
                    subject: 'Your Login Code — CINE-DIRECTOR AI',
                    html: emailHtml,
                }),
            });

            if (resendResp.ok) {
                resendData = await resendResp.json();
                console.log('[Send OTP] Email sent via Resend:', resendData, '| from:', fromAddr);
                break;
            }

            lastErr = await resendResp.text();
            console.warn(`[Send OTP] Resend failed with sender "${fromAddr}":`, resendResp.status, lastErr);
            if (resendResp.status === 403) continue;
            break;
        }

        if (!resendData) {
            console.error('[Send OTP] All Resend senders failed. Last error:', lastErr);
            return res.status(500).json({ error: '验证邮件发送失败，请稍后重试' });
        }

        // Ensure profile
        if (userId) {
            await supabaseAdmin.from('profiles').upsert({
                id: userId, name: email, role: 'Director', credits: 50,
            }, { onConflict: 'id' });
        }

        return res.json({ ok: true, message: 'Verification email sent' });
    } catch (err: any) {
        console.error('[Send OTP] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to send OTP' });
    }
});

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

const isNsfwError = (text: string) => /nsfw|safety|moderation|content policy/i.test(text || '');

const sanitizePromptForSafety = (prompt: string) => {
    return (prompt || '')
        .replace(/\b(kill|killing|blood|bloody|gore|gory|brutal|weapon|sword|spear|fight|battle|war)\b/gi, 'cinematic')
        .replace(/大战|战斗|厮杀|杀戮|血腥|武器|长矛|刀剑/g, '史诗对峙')
        .concat(' Family-friendly cinematic scene, no gore, no violence, no explicit content.');
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
            // NSFW fallback retry (sanitized prompt + flux_schnell)
            if (isNsfwError(errText) && input?.prompt) {
                const safePrompt = sanitizePromptForSafety(input.prompt);
                const fallbackVersion = 'black-forest-labs/flux-schnell';
                const fallbackTargetUrl = `${base}/models/${fallbackVersion}/predictions`;
                const fallbackResponse = await fetch(fallbackTargetUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        Prefer: 'wait',
                    },
                    body: JSON.stringify({ input: { ...input, prompt: safePrompt } })
                });

                if (fallbackResponse.ok) {
                    const prediction = await fallbackResponse.json() as ReplicateResponse;
                    if (!skipCreditCheck) {
                        await supabaseUser.rpc('finalize_reserve', {
                            ref_type: 'replicate',
                            ref_id: jobRef
                        });
                    }
                    return res.json(prediction);
                }
            }

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
    const apiKey = process.env.GEMINI_API_KEY?.replace(/\s+/g, '');
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

// ═══════════════════════════════════════════════════════════════════════════════
// ★ SHOT SYSTEM + SHOT IMAGES + BATCH IMAGE GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

// --- Shared helpers for Shot / Image / Batch routes ---

const getUserClient = (authHeader: string) => createClient(
    (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim(),
    (process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim(),
    { global: { headers: { Authorization: authHeader } } }
);

async function checkIsAdmin(supabaseUser: any): Promise<boolean> {
    try {
        const { data: { user } } = await supabaseUser.auth.getUser();
        if (!user) return false;
        if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) return true;
        const { data: profile } = await supabaseUser.from('profiles').select('is_admin').eq('id', user.id).single();
        return profile?.is_admin === true;
    } catch { return false; }
}

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

async function callReplicateImage(params: {
    prompt: string; model: string; aspectRatio: string; seed: number | null;
}): Promise<{ url: string; predictionId: string }> {
    const token = getReplicateToken();
    const modelPath = params.model;
    const isModelPath = modelPath.includes('/') && !modelPath.match(/^[a-f0-9]{64}$/);
    const targetUrl = isModelPath
        ? `${REPLICATE_API_BASE}/models/${modelPath}/predictions`
        : `${REPLICATE_API_BASE}/predictions`;

    const input: Record<string, any> = {
        prompt: params.prompt, aspect_ratio: params.aspectRatio, output_format: 'jpg',
    };
    if (params.seed != null) input.seed = params.seed;
    const body = isModelPath ? { input } : { version: modelPath, input };

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Replicate error ${response.status}: ${errText}`);
    }

    let prediction: any = await response.json();
    while (['starting', 'processing'].includes(prediction.status)) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch(`${REPLICATE_API_BASE}/predictions/${prediction.id}`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        prediction = await pollRes.json();
    }
    if (prediction.status !== 'succeeded') throw new Error(prediction.error || 'Image generation failed');
    const output = prediction.output;
    return { url: Array.isArray(output) ? output[0] : output, predictionId: prediction.id };
}

function buildFinalPrompt(params: {
    basePrompt: string; deltaInstruction?: string; characterAnchor?: string; style?: string; referencePolicy?: string;
}): string {
    const parts: string[] = [];
    if (params.characterAnchor && params.referencePolicy !== 'none') {
        parts.push(`[CRITICAL: Maintain exact same character identity. Same face, hairstyle, costume, body proportions.] ${params.characterAnchor}.`);
    }
    parts.push(params.basePrompt);
    if (params.deltaInstruction) parts.push(`[EDIT INSTRUCTION: ${params.deltaInstruction}]`);
    if (params.style && params.style !== 'none') {
        const preset = STYLE_PRESETS.find(s => s.id === params.style);
        if (preset) parts.push(preset.promptModifier);
    }
    if (params.characterAnchor && params.referencePolicy !== 'none') {
        parts.push('[IMPORTANT: Character must look IDENTICAL to description above.]');
    }
    return parts.join(' ');
}

// --- In-memory BatchQueue (same as server/batchQueue.ts) ---

interface BatchJobState {
    job: BatchJob; items: BatchJobItem[]; cancelRequested: boolean; workerPromise?: Promise<void>;
}
type TaskExecutor = (item: BatchJobItem, job: BatchJob) => Promise<{ image_id: string; image_url: string }>;
const batchJobs = new Map<string, BatchJobState>();

function createBatchJob(p: {
    jobId: string; projectId: string; userId: string;
    items: Array<{ shotId: string; shotNumber: number; sceneNumber: number }>;
    concurrency: number; executor: TaskExecutor;
}): BatchJob {
    const now = new Date().toISOString();
    const job: BatchJob = {
        id: p.jobId, project_id: p.projectId, user_id: p.userId, type: 'gen_images',
        total: p.items.length, done: 0, succeeded: 0, failed: 0, status: 'pending',
        created_at: now, updated_at: now, concurrency: p.concurrency,
    };
    const batchItems: BatchJobItem[] = p.items.map(item => ({
        id: crypto.randomUUID(), job_id: p.jobId, shot_id: item.shotId,
        shot_number: item.shotNumber, scene_number: item.sceneNumber, status: 'queued' as BatchItemStatus,
    }));
    const state: BatchJobState = { job, items: batchItems, cancelRequested: false };
    batchJobs.set(p.jobId, state);
    state.workerPromise = runBatchWorker(state, p.executor);
    return job;
}

function getBatchJobStatus(jobId: string): { job: BatchJob; items: BatchJobItem[] } | null {
    const s = batchJobs.get(jobId);
    return s ? { job: { ...s.job }, items: s.items.map(i => ({ ...i })) } : null;
}

function cancelBatchJob(jobId: string): boolean {
    const s = batchJobs.get(jobId);
    if (!s || s.job.status === 'completed' || s.job.status === 'cancelled') return false;
    s.cancelRequested = true;
    return true;
}

function retryFailedBatchItems(jobId: string, executor: TaskExecutor): boolean {
    const s = batchJobs.get(jobId);
    if (!s || s.job.status === 'running') return false;
    let hasRetries = false;
    for (const item of s.items) {
        if (item.status === 'failed') {
            item.status = 'queued'; item.error = undefined;
            item.started_at = undefined; item.completed_at = undefined;
            item.image_id = undefined; item.image_url = undefined;
            hasRetries = true;
        }
    }
    if (!hasRetries) return false;
    s.job.failed = 0;
    s.job.done = s.items.filter(i => i.status === 'succeeded').length;
    s.job.status = 'pending';
    s.cancelRequested = false;
    s.job.updated_at = new Date().toISOString();
    s.workerPromise = runBatchWorker(s, executor);
    return true;
}

async function runBatchWorker(state: BatchJobState, executor: TaskExecutor): Promise<void> {
    state.job.status = 'running';
    state.job.updated_at = new Date().toISOString();
    const queue = state.items.filter(i => i.status === 'queued');
    let qi = 0;
    const runNext = async (): Promise<void> => {
        while (qi < queue.length) {
            if (state.cancelRequested) return;
            const item = queue[qi++];
            if (!item || item.status !== 'queued') continue;
            if (state.cancelRequested) { item.status = 'cancelled'; continue; }
            item.status = 'running'; item.started_at = new Date().toISOString();
            state.job.updated_at = new Date().toISOString();
            try {
                const r = await executor(item, state.job);
                item.status = 'succeeded'; item.image_id = r.image_id; item.image_url = r.image_url;
                item.completed_at = new Date().toISOString(); state.job.succeeded += 1;
            } catch (err: any) {
                item.status = 'failed'; item.error = err.message || 'Unknown error';
                item.completed_at = new Date().toISOString(); state.job.failed += 1;
                console.error(`[BatchQueue] Item ${item.id} (shot ${item.shot_id}) failed:`, err.message);
            }
            state.job.done += 1; state.job.updated_at = new Date().toISOString();
        }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < state.job.concurrency; i++) workers.push(runNext());
    await Promise.all(workers);
    if (state.cancelRequested) {
        for (const item of state.items) { if (item.status === 'queued') item.status = 'cancelled'; }
        state.job.status = 'cancelled';
    } else if (state.job.failed > 0 && state.job.succeeded === 0) {
        state.job.status = 'failed';
    } else {
        state.job.status = 'completed';
    }
    state.job.updated_at = new Date().toISOString();
}

// ───────────────────────────────────────────────────────────────
// POST /api/shots/generate — Break scene into detailed shots via Gemini
// ───────────────────────────────────────────────────────────────

const shotResponseSchema = {
    type: Type.OBJECT,
    properties: {
        scene_title: { type: Type.STRING },
        shots: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    shot_number: { type: Type.INTEGER }, duration_sec: { type: Type.NUMBER },
                    location_type: { type: Type.STRING }, location: { type: Type.STRING },
                    time_of_day: { type: Type.STRING }, characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                    action: { type: Type.STRING }, dialogue: { type: Type.STRING },
                    camera: { type: Type.STRING }, lens: { type: Type.STRING },
                    movement: { type: Type.STRING }, composition: { type: Type.STRING },
                    lighting: { type: Type.STRING }, art_direction: { type: Type.STRING },
                    mood: { type: Type.STRING }, sfx_vfx: { type: Type.STRING },
                    audio_notes: { type: Type.STRING }, continuity_notes: { type: Type.STRING },
                    image_prompt: { type: Type.STRING }, negative_prompt: { type: Type.STRING },
                },
                required: [
                    'shot_number', 'duration_sec', 'location_type', 'location',
                    'time_of_day', 'characters', 'action', 'dialogue',
                    'camera', 'lens', 'movement', 'composition',
                    'lighting', 'art_direction', 'mood', 'sfx_vfx',
                    'audio_notes', 'continuity_notes', 'image_prompt', 'negative_prompt'
                ],
            },
        },
    },
    required: ['scene_title', 'shots'],
};

app.post('/api/shots/generate', async (req: any, res: any) => {
    try {
        const {
            scene_number, visual_description, audio_description, shot_type,
            visual_style, character_anchor, language, num_shots
        } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
        if (!visual_description) return res.status(400).json({ error: 'Missing visual_description' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);
        const COST = 1;
        const jobRef = `shots:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'shots', ref_id: jobRef
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        }

        const ai = getGeminiAI();
        const targetShots = num_shots || 5;

        const systemInstruction = `
**Role:** You are an expert Director of Photography (DP) and 1st Assistant Director.
**Task:** Break the following SCENE into exactly ${targetShots} detailed, production-ready SHOTS.

**Scene ${scene_number || 1}:**
Visual: ${visual_description}
Audio: ${audio_description || 'N/A'}
Shot Direction: ${shot_type || 'N/A'}
Visual Style: ${visual_style || 'Cinematic Realism'}
${character_anchor ? `Character Anchor (MUST appear in every shot's image_prompt): ${character_anchor}` : ''}

**RULES:**
1. Each shot must be a distinct camera setup / angle / moment.
2. "camera" must be one of: wide, medium, close, ecu, over-shoulder, pov, aerial, two-shot
3. "movement" must be one of: static, push-in, pull-out, pan-left, pan-right, tilt-up, tilt-down, dolly, tracking, crane, handheld, steadicam, whip-pan, zoom
4. "time_of_day" must be one of: dawn, morning, noon, afternoon, golden-hour, dusk, night, blue-hour
5. "location_type" must be one of: INT, EXT, INT/EXT
6. "image_prompt" must be a COMPLETE, self-contained prompt for image generation including the character anchor and all visual details.
7. "negative_prompt" should list what to avoid (bad quality, deformed hands, etc.)
8. "duration_sec" should be realistic (2-8 seconds per shot).
9. "lighting" should describe key/fill/back lights, color temperature.
10. "continuity_notes" should note what must match between adjacent shots.
11. Language: image_prompt, negative_prompt, and technical fields ALWAYS in English. dialogue and audio_notes in ${language === 'zh' ? 'Chinese (Simplified)' : 'English'}.

**Output:** JSON strictly following the provided schema. Return exactly ${targetShots} shots.
`;

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `Break Scene ${scene_number || 1} into ${targetShots} shots. Scene description: ${visual_description}`,
                config: { systemInstruction, responseMimeType: 'application/json', responseSchema: shotResponseSchema, temperature: 0.6 },
            });
        } catch (initialError: any) {
            if (initialError.message?.includes('429') || initialError.status === 429) {
                response = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: `Break Scene ${scene_number || 1} into ${targetShots} shots. Scene description: ${visual_description}`,
                    config: { systemInstruction, responseMimeType: 'application/json', responseSchema: shotResponseSchema, temperature: 0.6 },
                });
            } else throw initialError;
        }

        const text = response.text;
        if (!text) throw new Error('No response from AI');
        const result = JSON.parse(text);

        const enrichedShots = (result.shots || []).map((s: any, idx: number) => ({
            shot_id: crypto.randomUUID(),
            scene_id: '', scene_title: result.scene_title || `Scene ${scene_number || 1}`,
            shot_number: s.shot_number || idx + 1, duration_sec: s.duration_sec || 3,
            location_type: s.location_type || 'INT', location: s.location || '',
            time_of_day: s.time_of_day || 'day', characters: s.characters || [],
            action: s.action || '', dialogue: s.dialogue || '',
            camera: s.camera || 'medium', lens: s.lens || '50mm',
            movement: s.movement || 'static', composition: s.composition || '',
            lighting: s.lighting || '', art_direction: s.art_direction || '',
            mood: s.mood || '', sfx_vfx: s.sfx_vfx || '',
            audio_notes: s.audio_notes || '', continuity_notes: s.continuity_notes || '',
            image_prompt: s.image_prompt || '', negative_prompt: s.negative_prompt || '',
            seed_hint: null, reference_policy: 'anchor' as const,
            status: 'draft' as const, locked_fields: [], version: 1,
            updated_at: new Date().toISOString(),
        }));

        if (!isAdmin) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'shots', ref_id: jobRef });
        }

        res.json({ scene_title: result.scene_title || `Scene ${scene_number || 1}`, shots: enrichedShots });
    } catch (error: any) {
        console.error('[Shots Generate] Error:', error);
        res.status(500).json({ error: error.message || 'Shot generation failed' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/shots/:shotId/rewrite — AI-rewrite specific fields
// ───────────────────────────────────────────────────────────────
app.post('/api/shots/:shotId/rewrite', async (req: any, res: any) => {
    try {
        const { shotId } = req.params;
        const { fields_to_rewrite, user_instruction, locked_fields, current_shot, project_context, language } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
        if (!fields_to_rewrite?.length) return res.status(400).json({ error: 'No fields specified for rewrite' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);
        const COST = 1;
        const jobRef = `rewrite:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'rewrite', ref_id: jobRef
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        }

        const ai = getGeminiAI();
        const shotJson = JSON.stringify(current_shot, null, 2);
        const fieldsStr = fields_to_rewrite.join(', ');
        const lockedStr = (locked_fields || []).join(', ');

        const systemInstruction = `
**Role:** Expert DP / Script Supervisor.
**Task:** Rewrite ONLY the following fields of this shot: [${fieldsStr}]
${lockedStr ? `**LOCKED fields (DO NOT MODIFY):** [${lockedStr}]` : ''}
${user_instruction ? `**Director's instruction:** "${user_instruction}"` : ''}

**Current shot state:**
\`\`\`json
${shotJson}
\`\`\`

**Project context:**
- Visual Style: ${project_context?.visual_style || 'Cinematic'}
- Character Anchor: ${project_context?.character_anchor || 'N/A'}
- Scene: ${project_context?.scene_title || 'N/A'}

**RULES:**
1. Return a JSON object with ONLY the rewritten fields.
2. Do NOT include any fields that are locked or not in the rewrite list.
3. Keep the same format/type as the original field values.
4. If rewriting image_prompt, include the character anchor.
5. Be creative but stay consistent with the visual style and scene context.
6. Language: technical fields in English, dialogue in ${language === 'zh' ? 'Chinese' : 'English'}.

**Output:** A flat JSON object with only the rewritten field keys and new values.
`;

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `Rewrite fields [${fieldsStr}] for shot ${shotId}. ${user_instruction || ''}`,
                config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
            });
        } catch (initialError: any) {
            if (initialError.message?.includes('429') || initialError.status === 429) {
                response = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: `Rewrite fields [${fieldsStr}] for shot ${shotId}. ${user_instruction || ''}`,
                    config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
                });
            } else throw initialError;
        }

        const text = response.text;
        if (!text) throw new Error('No response from AI');
        const rewrittenFields = JSON.parse(text);
        for (const locked of (locked_fields || [])) delete rewrittenFields[locked];
        for (const key of Object.keys(rewrittenFields)) {
            if (!fields_to_rewrite.includes(key)) delete rewrittenFields[key];
        }

        if (!isAdmin) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'rewrite', ref_id: jobRef });
        }

        res.json({ shot_id: shotId, rewritten_fields: rewrittenFields, change_source: 'ai-rewrite', changed_fields: Object.keys(rewrittenFields) });
    } catch (error: any) {
        console.error('[Shot Rewrite] Error:', error);
        res.status(500).json({ error: error.message || 'Shot rewrite failed' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/shot-images/:shotId/generate — Generate image for a shot
// ───────────────────────────────────────────────────────────────
app.post('/api/shot-images/:shotId/generate', async (req: any, res: any) => {
    const startTime = Date.now();
    try {
        const { shotId } = req.params;
        const { prompt, negative_prompt, delta_instruction, model, aspect_ratio, style, seed, character_anchor, reference_policy, project_id } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);
        const imageModel = model || 'flux';
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[imageModel] || REPLICATE_MODEL_PATHS['flux'];
        const cost = (IMAGE_MODEL_COSTS as any)[imageModel] ?? 6;

        const jobRef = `shot-img:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: cost, ref_type: 'shot-image', ref_id: jobRef,
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        }

        const finalPrompt = buildFinalPrompt({
            basePrompt: prompt || '', deltaInstruction: delta_instruction,
            characterAnchor: character_anchor, style: style || 'none', referencePolicy: reference_policy || 'anchor',
        });

        let result: { url: string; predictionId: string };
        try {
            result = await callReplicateImage({ prompt: finalPrompt, model: replicatePath, aspectRatio: aspect_ratio || '16:9', seed: seed ?? 142857 });
        } catch (genErr: any) {
            if (!isAdmin) { try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'shot-image', ref_id: jobRef }); } catch (_) {} }
            throw genErr;
        }

        if (!isAdmin) { await supabaseUser.rpc('finalize_reserve', { ref_type: 'shot-image', ref_id: jobRef }); }

        const now = new Date().toISOString();
        const imageId = crypto.randomUUID();
        res.json({
            image: { id: imageId, shot_id: shotId, project_id: project_id || null, url: result.url, is_primary: false, status: 'succeeded', label: null, created_at: now },
            generation: {
                id: crypto.randomUUID(), image_id: imageId, shot_id: shotId, project_id: project_id || null,
                prompt: prompt || '', negative_prompt: negative_prompt || '', delta_instruction: delta_instruction || null,
                model: imageModel, aspect_ratio: aspect_ratio || '16:9', style: style || 'none', seed: seed ?? 142857,
                anchor_refs: character_anchor ? [character_anchor] : [], reference_policy: reference_policy || 'anchor',
                edit_mode: null, status: 'succeeded', output_url: result.url, replicate_prediction_id: result.predictionId,
                created_at: now, completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime,
            },
        });
    } catch (error: any) {
        console.error('[ShotImage Generate] Error:', error.message);
        res.status(500).json({ error: error.message || 'Image generation failed' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/shot-images/:imageId/edit — Edit existing shot image
// ───────────────────────────────────────────────────────────────
app.post('/api/shot-images/:imageId/edit', async (req: any, res: any) => {
    const startTime = Date.now();
    try {
        const { imageId } = req.params;
        const { edit_mode, delta_instruction, original_prompt, negative_prompt, reference_image_url, locked_attributes, model, aspect_ratio, style, seed, character_anchor, reference_policy, shot_id, project_id } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
        if (!edit_mode) return res.status(400).json({ error: 'Missing edit_mode' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);
        const imageModel = model || 'flux';
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[imageModel] || REPLICATE_MODEL_PATHS['flux'];
        const cost = (IMAGE_MODEL_COSTS as any)[imageModel] ?? 6;

        const jobRef = `shot-img-edit:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: cost, ref_type: 'shot-image-edit', ref_id: jobRef,
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        }

        let basePrompt = original_prompt || '';
        if (edit_mode === 'attribute_edit') {
            const lockedStr = (locked_attributes || []).join(', ');
            basePrompt = lockedStr ? `${basePrompt}. [KEEP UNCHANGED: ${lockedStr}]. [CHANGE: ${delta_instruction || ''}]` : `${basePrompt}. [EDIT: ${delta_instruction || ''}]`;
        } else if (edit_mode === 'reference_edit') {
            basePrompt = `Based on reference image, ${delta_instruction || 'maintain composition and subject'}. ${basePrompt}`;
        }

        const finalPrompt = buildFinalPrompt({
            basePrompt, characterAnchor: character_anchor, style: style || 'none', referencePolicy: reference_policy || 'anchor',
        });
        const editSeed = edit_mode === 'reroll' ? Math.floor(Math.random() * 999999) : (seed ?? 142857);

        let result: { url: string; predictionId: string };
        try {
            result = await callReplicateImage({ prompt: finalPrompt, model: replicatePath, aspectRatio: aspect_ratio || '16:9', seed: editSeed });
        } catch (genErr: any) {
            if (!isAdmin) { try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'shot-image-edit', ref_id: jobRef }); } catch (_) {} }
            throw genErr;
        }

        if (!isAdmin) { await supabaseUser.rpc('finalize_reserve', { ref_type: 'shot-image-edit', ref_id: jobRef }); }

        const now = new Date().toISOString();
        const newImageId = crypto.randomUUID();
        res.json({
            image: { id: newImageId, shot_id: shot_id || '', project_id: project_id || null, url: result.url, is_primary: false, status: 'succeeded', label: `Edit (${edit_mode})`, created_at: now },
            generation: {
                id: crypto.randomUUID(), image_id: newImageId, shot_id: shot_id || '', project_id: project_id || null,
                prompt: basePrompt, negative_prompt: negative_prompt || '', delta_instruction: delta_instruction || null,
                model: imageModel, aspect_ratio: aspect_ratio || '16:9', style: style || 'none', seed: editSeed,
                anchor_refs: character_anchor ? [character_anchor] : [], reference_image_url: reference_image_url || null,
                reference_policy: reference_policy || 'anchor', edit_mode, status: 'succeeded',
                output_url: result.url, replicate_prediction_id: result.predictionId,
                created_at: now, completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime,
                parent_image_id: imageId,
            },
        });
    } catch (error: any) {
        console.error('[ShotImage Edit] Error:', error.message);
        res.status(500).json({ error: error.message || 'Image edit failed' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/batch/gen-images — Start batch image generation
// ───────────────────────────────────────────────────────────────
app.post('/api/batch/gen-images', async (req: any, res: any) => {
    try {
        const { project_id, shots, count = 9, model = 'flux', aspect_ratio = '16:9', style = 'none', character_anchor = '', concurrency = 2 } = req.body;
        if (!project_id) return res.status(400).json({ error: 'Missing project_id' });
        if (!shots?.length) return res.status(400).json({ error: 'Missing or empty shots array' });

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);

        const sortedShots = [...shots].sort((a: any, b: any) => (a.scene_number - b.scene_number) || (a.shot_number - b.shot_number)).slice(0, count);
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[model] || REPLICATE_MODEL_PATHS['flux'];
        const costPerImage = (IMAGE_MODEL_COSTS as any)[model] ?? 6;
        const totalCost = costPerImage * sortedShots.length;

        const batchRef = `batch-img:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', { amount: totalCost, ref_type: 'batch-image', ref_id: batchRef });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', needed: totalCost });
        }

        const jobId = crypto.randomUUID();
        const executor: TaskExecutor = async (item) => {
            const shotData = sortedShots.find((s: any) => s.shot_id === item.shot_id);
            if (!shotData) throw new Error('Shot data not found');
            const finalPrompt = buildFinalPrompt({ basePrompt: shotData.image_prompt || '', characterAnchor: character_anchor, style, referencePolicy: shotData.reference_policy || 'anchor' });
            const result = await callReplicateImage({ prompt: finalPrompt, model: replicatePath, aspectRatio: aspect_ratio, seed: shotData.seed_hint ?? null });
            return { image_id: crypto.randomUUID(), image_url: result.url };
        };

        const job = createBatchJob({
            jobId, projectId: project_id, userId: '', concurrency: Math.min(concurrency, 3), executor,
            items: sortedShots.map((s: any) => ({ shotId: s.shot_id, shotNumber: s.shot_number, sceneNumber: s.scene_number })),
        });

        // Async credit finalization
        if (!isAdmin) {
            (async () => {
                for (let a = 0; a < 600; a++) {
                    await new Promise(r => setTimeout(r, 3000));
                    const st = getBatchJobStatus(jobId);
                    if (!st) break;
                    if (['completed', 'failed', 'cancelled'].includes(st.job.status)) {
                        const notOk = st.job.total - st.job.succeeded;
                        if (notOk > 0) { try { await supabaseUser.rpc('refund_reserve', { amount: notOk * costPerImage, ref_type: 'batch-image-partial', ref_id: batchRef }); } catch(e) {} }
                        try { await supabaseUser.rpc('finalize_reserve', { ref_type: 'batch-image', ref_id: batchRef }); } catch(e) {}
                        break;
                    }
                }
            })().catch(e => console.error('[Batch] Credit finalization error:', e));
        }

        res.json({ job_id: jobId, status: job.status, total: job.total, cost_per_image: costPerImage, total_cost: totalCost });
    } catch (error: any) {
        console.error('[Batch GenImages] Error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to start batch job' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/batch/gen-images/continue — Continue generating next batch
// ───────────────────────────────────────────────────────────────
app.post('/api/batch/gen-images/continue', async (req: any, res: any) => {
    try {
        const { project_id, shots, shots_with_images = [], count = 9, strategy = 'strict', model = 'flux', aspect_ratio = '16:9', style = 'none', character_anchor = '', concurrency = 2 } = req.body;
        if (!project_id) return res.status(400).json({ error: 'Missing project_id' });
        if (!shots?.length) return res.status(400).json({ error: 'Missing or empty shots array' });

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);

        const sortedAll = [...shots].sort((a: any, b: any) => (a.scene_number - b.scene_number) || (a.shot_number - b.shot_number));
        const hasImageSet = new Set(shots_with_images as string[]);

        let nextBatch: typeof sortedAll;
        if (strategy === 'strict') {
            const firstMissingIdx = sortedAll.findIndex((s: any) => !hasImageSet.has(s.shot_id));
            if (firstMissingIdx < 0) return res.json({ job_id: null, all_done: true, message: '所有镜头已有图片', remaining_count: 0 });
            nextBatch = [];
            for (let i = firstMissingIdx; i < sortedAll.length && nextBatch.length < count; i++) {
                if (!hasImageSet.has(sortedAll[i].shot_id)) nextBatch.push(sortedAll[i]);
            }
        } else {
            let lastSuccessIdx = -1;
            for (let i = sortedAll.length - 1; i >= 0; i--) {
                if (hasImageSet.has(sortedAll[i].shot_id)) { lastSuccessIdx = i; break; }
            }
            nextBatch = [];
            for (let i = lastSuccessIdx + 1; i < sortedAll.length && nextBatch.length < count; i++) {
                if (!hasImageSet.has(sortedAll[i].shot_id)) nextBatch.push(sortedAll[i]);
            }
        }

        if (nextBatch.length === 0) return res.json({ job_id: null, all_done: true, message: '所有镜头已有图片', remaining_count: 0 });

        const totalMissing = sortedAll.filter((s: any) => !hasImageSet.has(s.shot_id)).length;
        const remainingAfter = totalMissing - nextBatch.length;
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[model] || REPLICATE_MODEL_PATHS['flux'];
        const costPerImage = (IMAGE_MODEL_COSTS as any)[model] ?? 6;
        const totalCost = costPerImage * nextBatch.length;

        const batchRef = `batch-continue:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', { amount: totalCost, ref_type: 'batch-image-continue', ref_id: batchRef });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', needed: totalCost });
        }

        const jobId = crypto.randomUUID();
        const executor: TaskExecutor = async (item) => {
            const shotData = nextBatch.find((s: any) => s.shot_id === item.shot_id);
            if (!shotData) throw new Error('Shot data not found');
            const finalPrompt = buildFinalPrompt({ basePrompt: shotData.image_prompt || '', characterAnchor: character_anchor, style, referencePolicy: shotData.reference_policy || 'anchor' });
            const result = await callReplicateImage({ prompt: finalPrompt, model: replicatePath, aspectRatio: aspect_ratio, seed: shotData.seed_hint ?? null });
            return { image_id: crypto.randomUUID(), image_url: result.url };
        };

        const job = createBatchJob({
            jobId, projectId: project_id, userId: '', concurrency: Math.min(concurrency, 3), executor,
            items: nextBatch.map((s: any) => ({ shotId: s.shot_id, shotNumber: s.shot_number, sceneNumber: s.scene_number })),
        });

        const jobState = getBatchJobStatus(jobId);
        if (jobState) {
            const raw = batchJobs.get(jobId);
            if (raw) {
                raw.job.type = 'gen_images_continue'; raw.job.strategy = strategy;
                raw.job.range_start_scene = nextBatch[0].scene_number; raw.job.range_start_shot = nextBatch[0].shot_number;
                raw.job.range_end_scene = nextBatch[nextBatch.length - 1].scene_number; raw.job.range_end_shot = nextBatch[nextBatch.length - 1].shot_number;
                raw.job.remaining_count = remainingAfter; raw.job.all_done = remainingAfter === 0;
            }
        }

        if (!isAdmin) {
            (async () => {
                for (let a = 0; a < 600; a++) {
                    await new Promise(r => setTimeout(r, 3000));
                    const st = getBatchJobStatus(jobId);
                    if (!st) break;
                    if (['completed', 'failed', 'cancelled'].includes(st.job.status)) {
                        const notOk = st.job.total - st.job.succeeded;
                        if (notOk > 0) { try { await supabaseUser.rpc('refund_reserve', { amount: notOk * costPerImage, ref_type: 'batch-continue-partial', ref_id: batchRef }); } catch(e) {} }
                        try { await supabaseUser.rpc('finalize_reserve', { ref_type: 'batch-image-continue', ref_id: batchRef }); } catch(e) {}
                        break;
                    }
                }
            })().catch(e => console.error('[Batch Continue] Credit error:', e));
        }

        const rangeLabel = `S${nextBatch[0].scene_number}.${nextBatch[0].shot_number} → S${nextBatch[nextBatch.length - 1].scene_number}.${nextBatch[nextBatch.length - 1].shot_number}`;
        res.json({ job_id: jobId, status: job.status, total: job.total, cost_per_image: costPerImage, total_cost: totalCost, range_label: rangeLabel, remaining_count: remainingAfter, all_done: remainingAfter === 0, strategy });
    } catch (error: any) {
        console.error('[Batch Continue] Error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to start continue batch job' });
    }
});

// ───────────────────────────────────────────────────────────────
// GET /api/batch/:jobId — Get batch job status
// ───────────────────────────────────────────────────────────────
app.get('/api/batch/:jobId', async (req: any, res: any) => {
    try {
        const status = getBatchJobStatus(req.params.jobId);
        if (!status) return res.status(404).json({ error: 'Job not found' });
        res.json(status);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ───────────────────────────────────────────────────────────────
// POST /api/batch/:jobId/cancel — Cancel a running batch job
// ───────────────────────────────────────────────────────────────
app.post('/api/batch/:jobId/cancel', async (req: any, res: any) => {
    try {
        const ok = cancelBatchJob(req.params.jobId);
        if (!ok) return res.status(400).json({ error: 'Job cannot be cancelled' });
        res.json({ ok: true, message: 'Cancellation requested' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ───────────────────────────────────────────────────────────────
// POST /api/batch/:jobId/retry — Retry failed items
// ───────────────────────────────────────────────────────────────
app.post('/api/batch/:jobId/retry', async (req: any, res: any) => {
    try {
        const { model = 'flux', aspect_ratio = '16:9', style = 'none', character_anchor = '', shots = [] } = req.body;
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[model] || REPLICATE_MODEL_PATHS['flux'];
        const executor: TaskExecutor = async (item) => {
            const shotData = shots.find((s: any) => s.shot_id === item.shot_id);
            const finalPrompt = buildFinalPrompt({ basePrompt: shotData?.image_prompt || '', characterAnchor: character_anchor, style, referencePolicy: shotData?.reference_policy || 'anchor' });
            const result = await callReplicateImage({ prompt: finalPrompt, model: replicatePath, aspectRatio: aspect_ratio, seed: shotData?.seed_hint ?? null });
            return { image_id: crypto.randomUUID(), image_url: result.url };
        };
        const ok = retryFailedBatchItems(req.params.jobId, executor);
        if (!ok) return res.status(400).json({ error: 'No failed items to retry or job is still running' });
        res.json({ ok: true, message: 'Retry started' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
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
    const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const supabaseService = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const supabaseAnon = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        build: 'ledger-v2-profiles-reserve',
        config: {
            hasSupabaseUrl: !!supabaseUrl,
            hasSupabaseAnon: !!supabaseAnon,
            hasSupabaseServiceRole: !!supabaseService,
        }
    });
});

export default app;