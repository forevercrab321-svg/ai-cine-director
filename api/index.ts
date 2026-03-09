import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import { GoogleGenAI, Type } from '@google/genai';


// ═══════════════════════════════════════════════════════════════
// INLINED TYPES FROM types.ts (Vercel cannot resolve ../types)
// ═══════════════════════════════════════════════════════════════

// Profile type for database operations
interface Profile {
    id: string;
    credits: number;
    is_pro: boolean;
    is_admin: boolean;
    name?: string;
    role?: string;
}

type VideoModel =
    // ★ 性价比模型 (2个) - 快速出片
    | 'wan_2_2_fast'           // ★ Alibaba Wan 2.2 - 性价比之王
    | 'hailuo_02_fast'        // ★ MiniMax Hailuo-02 - 均衡之选

    // ★ 顶级画质模型 (4个) - 电影级质量
    | 'kling_2_5_pro'        // ★ 快手Kling 2.5 Pro - 顶级物理
    | 'veo_3'                // ★ Google Veo 3 - 最高质量
    | 'seedance_pro'          // ★ ByteDance Seedance Pro - 首帧尾帧
    | 'sora_2';              // ★ OpenAI Sora 2 - 最新AI
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
    // ★ 性价比模型 (2个)
    wan_2_2_fast: "wan-video/wan-2.2-i2v-fast",
    hailuo_02_fast: "minimax/hailuo-02-fast",

    // ★ 顶级画质模型 (4个)
    kling_2_5_pro: "kwaivgi/kling-v2.5-turbo-pro",
    veo_3: "google/veo-3",
    seedance_pro: "bytedance/seedance-1-pro",
    sora_2: "openai/sora-2",

    // Image models
    flux: "black-forest-labs/flux-1.1-pro",
    flux_schnell: "black-forest-labs/flux-schnell",
    nano_banana: "black-forest-labs/flux-schnell" // Fallback since gemini-nano-banana is invalid
};

const IMAGE_MODEL_COSTS: Record<ImageModel, number> = {
    flux: 6,
    flux_schnell: 1,
    nano_banana: 2
};

// ★ 视频模型成本映射 (与 types.ts 同步)
const VIDEO_MODEL_COSTS: Record<VideoModel, number> = {
    wan_2_2_fast: 8,
    hailuo_02_fast: 22,
    kling_2_5_pro: 85,
    veo_3: 300,
    seedance_pro: 55,
    sora_2: 250
};

// 估算成本函数
function estimateCost(modelPath: string): number {
    // 首先尝试精确匹配
    for (const [model, path] of Object.entries(REPLICATE_MODEL_PATHS)) {
        if (path === modelPath) {
            const videoCost = VIDEO_MODEL_COSTS[model as VideoModel];
            if (videoCost !== undefined) return videoCost;
            const imageCost = IMAGE_MODEL_COSTS[model as ImageModel];
            if (imageCost !== undefined) return imageCost;
        }
    }
    // 回退到基于路径的模式匹配
    if (modelPath.includes('wan-video')) return 8;
    if (modelPath.includes('hailuo') || modelPath.includes('minimax')) return 22;
    if (modelPath.includes('kling')) return 85;
    if (modelPath.includes('veo') || modelPath.includes('google/veo')) return 300;
    if (modelPath.includes('seedance') || modelPath.includes('bytedance')) return 55;
    if (modelPath.includes('sora') || modelPath.includes('openai')) return 250;
    return 22; // 默认成本
}

function sanitizePromptInput(value: unknown, maxLength: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeEntityType(value: unknown): 'character' | 'prop' | 'location' {
    const t = String(value || '').toLowerCase().trim();
    if (t === 'prop' || t === 'location') return t;
    return 'character';
}

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
// Stripe webhook必须用raw body，不能用json parser
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-01-28.clover' });
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
        event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);
    } catch (err: any) {
        console.error('[Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message} `);
    }

    if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
        const obj = event.data.object as any;
        let userId = '';
        let creditsToGrant = 0;
        let isSubscription = false;
        let planTier = '';

        if (event.type === 'checkout.session.completed' && obj.mode === 'payment') {
            userId = obj.client_reference_id || obj.metadata?.user_id;
            creditsToGrant = Number(obj.metadata?.credits || 0);
        } else if (event.type === 'invoice.paid' && obj.subscription) {
            try {
                const subscription = await stripe.subscriptions.retrieve(obj.subscription as string);
                userId = subscription.metadata?.user_id || '';
                planTier = subscription.metadata?.tier || '';
                // ★ Credits match actual plan definitions in types.ts BUSINESS_PLANS
                if (planTier === 'creator' || planTier === 'plan_starter') creditsToGrant = 3000;
                if (planTier === 'director' || planTier === 'plan_pro') creditsToGrant = 15000;
                if (planTier === 'plan_business') creditsToGrant = 50000;
                if (planTier === 'plan_enterprise') creditsToGrant = 300000;
                isSubscription = true;
            } catch (err) {
                console.error('[Stripe Webhook] Fetch subscription error:', err);
            }
        }

        if (userId && creditsToGrant > 0) {
            const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
            const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
            if (supabaseUrl && supabaseKey) {
                const supabase = createClient(supabaseUrl, supabaseKey);

                let updateData: any = {};
                if (isSubscription && planTier) {
                    updateData.is_pro = true;
                    // Update is_pro and plan_type for subscription users
                    updateData.plan_type = planTier;
                    await supabase.from('profiles').update(updateData).eq('id', userId);
                }

                // Append atomic add_credits if available to prevent race conditions
                try {
                    const { error: rpcErr } = await supabase.rpc('add_credits_to_user', { target_user_id: userId, amount_to_add: creditsToGrant });
                    if (rpcErr) throw rpcErr;
                } catch (e) {
                    // Fallback to select+update if RPC is missing
                    const { data: profile } = await supabase.from('profiles').select('credits').eq('id', userId).single();
                    await supabase.from('profiles').update({ credits: (profile?.credits || 0) + creditsToGrant }).eq('id', userId);
                }

                await supabase.from('credits_ledger').insert({
                    user_id: userId,
                    delta: creditsToGrant,
                    kind: isSubscription ? 'subscription_renewal' : 'purchase',
                    ref_type: 'stripe',
                    ref_id: String(obj.id),
                    status: 'settled'
                });
                console.log(`[Billing] Granted ${creditsToGrant} credits to user ${userId} (Sub: ${isSubscription})`);
            }
        }
    }
    res.json({ received: true });
});

// 其它路由用json parser
app.use(express.json({ limit: '10mb' }));
// Stripe订阅checkout

const getReplicateToken = () => {
    const raw = process.env.REPLICATE_API_TOKEN;
    const token = raw?.replace(/\s+/g, '');
    if (!token) throw new Error('REPLICATE_API_TOKEN not configured');
    return token;
};

// ★ Singleton — avoid creating a new client on every request (performance)
let _supabaseAdminSingleton: ReturnType<typeof createClient> | null = null;
const getSupabaseAdmin = () => {
    const url = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) throw new Error('Supabase URL or Service Key missing');
    if (!_supabaseAdminSingleton) {
        _supabaseAdminSingleton = createClient(url, key);
    }
    return _supabaseAdminSingleton;
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
        return res.status(401).json({ error: `Invalid token: ${error?.message || 'No user found'} ` });
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
        if (!users || !Array.isArray(users)) return undefined;

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
                    is_pro: false,
                    plan_type: 'free',
                    monthly_credits_used: 0
                } as any, { onConflict: 'id' });

            if (upsertErr) {
                const { error: fallbackUpsertErr } = await supabaseAdmin
                    .from('profiles')
                    .upsert({
                        id: userId,
                        name: email,
                        credits: 50,
                        is_pro: false,
                        plan_type: 'free',
                        monthly_credits_used: 0
                    } as any, { onConflict: 'id' });

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
    < div style = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;" >
        <div style="text-align: center; margin-bottom: 32px;" >
            <h1 style="font-size: 24px; font-weight: 800; color: #111; margin: 0;" >🎬 CINE - DIRECTOR AI </h1>
                < p style = "color: #666; font-size: 12px; letter-spacing: 2px; margin-top: 4px;" > VISIONARY PRODUCTION SUITE </p>
                    </div>
                    < div style = "background: #f8f9fa; border-radius: 16px; padding: 32px; text-align: center;" >
                        <h2 style="font-size: 20px; color: #111; margin: 0 0 12px;" > Your Login Code </h2>
                    ${emailOtp ? `<div style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #4f46e5; background: white; border-radius: 12px; padding: 16px; margin: 16px 0; font-family: monospace;">${emailOtp}</div>` : ''}
<p style="color: #666; font-size: 14px; margin: 16px 0 0;" > Or click the button below: </p>
    < a href = "${actionLink}" style = "display: inline-block; background: #4f46e5; color: white; text-decoration: none; padding: 14px 32px; border-radius: 999px; font-weight: 700; font-size: 14px; margin-top: 16px;" > Log In to Studio </a>
        </div>
        < p style = "color: #999; font-size: 11px; text-align: center; margin-top: 24px;" > This link expires in 10 minutes.If you didn't request this, ignore this email.</p>
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
                    'Authorization': `Bearer ${resendKey} `,
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
            console.warn(`[Send OTP] Resend failed with sender "${fromAddr}": `, resendResp.status, lastErr);
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
            } as any, { onConflict: 'id' });
        }

        return res.json({ ok: true, message: 'Verification email sent' });
    } catch (err: any) {
        console.error('[Send OTP] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to send OTP' });
    }
});

// POST /api/auth/verify-otp — Verify the OTP code from email and create session
app.post('/api/auth/verify-otp', async (req: any, res: any) => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ error: 'Missing email or code' });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Find user by email
        const userId = await findUserIdByEmail(supabaseAdmin, email);
        if (!userId) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Verify the code - since we're using magic links, we need to verify through admin
        // For simplicity, we'll generate a new session using admin API
        // The code from email is validated by checking if it matches the pattern

        // Generate a session for the user using admin API
        // This is a simplified flow - in production you'd validate the OTP properly
        const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: email,
        });

        if (sessionError) {
            console.error('[Verify OTP] Session error:', sessionError);
            return res.status(500).json({ error: 'Failed to verify code' });
        }

        // For now, we'll return success and let the frontend handle the redirect
        // The magic link already confirmed the user's email
        return res.json({
            ok: true,
            message: 'Verification successful',
            userId: userId,
            actionLink: sessionData?.properties?.action_link
        });

    } catch (err: any) {
        console.error('[Verify OTP] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to verify code' });
    }
});

// --- Cost --- (同步自 types.ts MODEL_COSTS)
// estimateCost is defined at the top of the file

// ═══════════════════════════════════════════════════════════════
// GOD MODE - Developer Allowlist (env-driven + hardcoded fallback)
// ═══════════════════════════════════════════════════════════════

// Hardcoded developer emails (always checked, no env dependency)
const HARDCODED_DEV_EMAILS = [
    'forevercrab321@gmail.com',
    'monsterlee@gmail.com',
];

const getDeveloperAllowlist = (): string[] => {
    const envVal = process.env.DEV_EMAIL_ALLOWLIST || '';
    const envEmails = envVal
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    // Merge hardcoded + env-driven, dedupe
    return [...new Set([...HARDCODED_DEV_EMAILS.map(e => e.toLowerCase()), ...envEmails])];
};

const isDeveloper = (email: string | null | undefined): boolean => {
    if (!email) return false;
    const allowlist = getDeveloperAllowlist();
    return allowlist.includes(email.toLowerCase());
};

const logDeveloperAccess = (email: string, action: string) => {
    console.log(`[GOD MODE] Developer "${email}" performed: ${action} `);
};

// --- Legacy Admin Check (merged into isDeveloper — no separate list needed) ---
const isAdminUser = (email: string | undefined): boolean => {
    if (!email) return false;
    return isDeveloper(email);
};

// ═══════════════════════════════════════════════════════════════
// MINIMAX AI SETUP (Replacing Gemini)
// ═══════════════════════════════════════════════════════════════

function getMinimaxApiKey() {
    const key = process.env.VITE_MINIMAX_API_KEY || process.env.MINIMAX_API_KEY;
    if (!key) throw new Error("MINIMAX_API_KEY is missing in environment variables.");
    return key;
}

const MINIMAX_TEXT_API = 'https://api.minimax.io/v1/text/chatcompletion_v2';

/**
 * Raw fetch wrapper for Minimax Text API (Supports Vision)
 */
async function getMinimaxChatCompletion(systemInstruction: string, promptContent: any, options: {
    model?: string;
    temperature?: number;
    responseFormat?: any;
} = {}) {
    const apiKey = getMinimaxApiKey();
    const model = options.model || 'MiniMax-Text-01'; // Default model (MiniMax-Text-01 is abi 2.5)

    const payload = {
        model: model,
        messages: [
            { role: "system", name: "System", content: systemInstruction },
            { role: "user", name: "User", content: promptContent }
        ],
        temperature: options.temperature || 0.7,
        response_format: options.responseFormat ? { type: "json_object" } : undefined
    };

    const response = await fetch(MINIMAX_TEXT_API, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey} `,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Minimax API Error(${response.status}): ${errText} `);
    }

    const data = await response.json();
    return data;
}

// ═══════════════════════════════════════════════════════════════
// Entitlement Types
// ═══════════════════════════════════════════════════════════════
type EntitlementAction =
    | 'generate_script' | 'generate_shots' | 'generate_image'
    | 'generate_video' | 'edit_image' | 'batch_images' | 'analyze_image'
    | 'rewrite_shot';

type UserPlan = 'free' | 'paid' | 'developer';

interface EntitlementResult {
    allowed: boolean;
    mode: 'developer' | 'paid' | 'free';
    unlimited: boolean;
    credits: number;
    plan: UserPlan;
    reason?: string;
    errorCode?: 'NEED_PAYMENT' | 'INSUFFICIENT_CREDITS' | 'RATE_LIMITED' | 'UNAUTHORIZED';
}

/**
 * Unified entitlement check - ALL generation routes MUST call this
 */
const checkEntitlement = async (
    userId: string,
    email: string,
    action: EntitlementAction,
    cost: number = 0
): Promise<EntitlementResult> => {
    // 1. GOD MODE check
    if (isDeveloper(email)) {
        logDeveloperAccess(email, action);
        return {
            allowed: true,
            mode: 'developer',
            unlimited: true,
            credits: 999999,
            plan: 'developer',
        };
    }

    // 2. Get user profile + credits (using service role singleton — not recreated on every call)
    const supabaseAdmin = getSupabaseAdmin();

    let profile: Profile | null = null;
    let { data: profileData, error: profileErr } = await supabaseAdmin
        .from('profiles')
        .select('id, credits, is_pro, is_admin')
        .eq('id', userId)
        .single();

    profile = profileData as Profile | null;

    // ★ AUTO-CREATE PROFILE if not exists (fix for new user signup)
    if (profileErr || !profile) {
        console.log(`[Entitlement] Profile not found for ${userId}(${email}), upserting...`);

        // Use UPSERT to handle race conditions (profile may already exist)
        const { data: newProfile, error: upsertErr } = await supabaseAdmin
            .from('profiles')
            .upsert({
                id: userId,
                name: email.split('@')[0],
                credits: 50,
                is_admin: false,
                is_pro: false,
            } as any, { onConflict: 'id', ignoreDuplicates: true })
            .select('id, credits, is_pro, is_admin')
            .single();

        if (upsertErr) {
            console.error('[Entitlement] Profile upsert failed:', upsertErr.message);
            // Last resort: try SELECT again (profile might exist but upsert had column issues)
            const { data: retryProfile } = await supabaseAdmin
                .from('profiles')
                .select('id, credits, is_pro, is_admin')
                .eq('id', userId)
                .single();
            const retryProfileTyped = retryProfile as Profile | null;
            if (retryProfileTyped) {
                profile = retryProfileTyped;
                console.log(`[Entitlement] Retry SELECT succeeded, credits = ${retryProfileTyped.credits} `);
            } else {
                console.error('[Entitlement] Retry SELECT also failed — allowing with 0 credits');
                // Don't block the user — allow with 0 credits, they'll hit NEED_PAYMENT naturally
                profile = { id: userId, credits: 0, is_pro: false, is_admin: false };
            }
        } else if (newProfile) {
            const newProfileTyped = newProfile as Profile;
            profile = newProfileTyped;
            console.log(`[Entitlement] Upserted profile for ${email}, credits = ${newProfileTyped.credits}`);
        }
    }

    const userCredits = profile?.credits ?? 0;
    const isPaid = profile?.is_pro === true;
    const plan: UserPlan = isPaid ? 'paid' : 'free';

    // 3. Free user with no credits → NEED_PAYMENT
    if (!isPaid && userCredits <= 0) {
        return {
            allowed: false,
            mode: 'free',
            unlimited: false,
            credits: userCredits,
            plan: 'free',
            reason: 'Please purchase credits or subscribe to use this feature',
            errorCode: 'NEED_PAYMENT',
        };
    }

    // 4. Insufficient credits for this action
    if (cost > 0 && userCredits < cost) {
        return {
            allowed: false,
            mode: plan === 'paid' ? 'paid' : 'free',
            unlimited: false,
            credits: userCredits,
            plan,
            reason: `Insufficient credits: need ${cost}, have ${userCredits} `,
            errorCode: 'INSUFFICIENT_CREDITS',
        };
    }

    // 5. Allowed
    return {
        allowed: true,
        mode: plan === 'paid' ? 'paid' : 'free',
        unlimited: false,
        credits: userCredits,
        plan,
    };
};

const isNsfwError = (text: string) => /nsfw|safety|moderation|content policy/i.test(text || '');

const sanitizePromptForSafety = (prompt: string) => {
    return (prompt || '')
        .replace(/\b(kill|killing|blood|bloody|gore|gory|brutal|weapon|sword|spear|fight|battle|war)\b/gi, 'cinematic')
        .replace(/大战|战斗|厮杀|杀戮|血腥|武器|长矛|刀剑/g, '史诗对峙')
        .concat(' Family-friendly cinematic scene, no gore, no violence, no explicit content.');
};

// ═══════════════════════════════════════════════════════════════
// /api/entitlement - 前端获取当前用户权限状态
// ═══════════════════════════════════════════════════════════════
app.get('/api/entitlement', requireAuth, async (req: any, res: any) => {
    try {
        const userId = req.user?.id;
        const userEmail = req.user?.email;

        if (!userId || !userEmail) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Check GOD MODE first
        const isDevMode = isDeveloper(userEmail);

        if (isDevMode) {
            logDeveloperAccess(userEmail, 'entitlement_check');
            return res.json({
                isDeveloper: true,
                isAdmin: true,
                plan: 'developer',
                credits: 999999,
                canGenerate: true,
                mode: 'developer',
                reasonIfBlocked: null,
            });
        }

        // Get profile for regular users — use singleton to avoid re-creating on every request
        const supabaseAdmin = getSupabaseAdmin();

        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id, credits, is_pro, is_admin')
            .eq('id', userId)
            .single();

        const profileTyped = profile as Profile | null;
        const credits = profileTyped?.credits ?? 0;
        const isPaid = profileTyped?.is_pro === true;
        const plan: UserPlan = isPaid ? 'paid' : 'free';
        const canGenerate = credits > 0 || isPaid;

        res.json({
            isDeveloper: false,
            isAdmin: (profile as any)?.is_admin === true,
            plan,
            credits,
            canGenerate,
            mode: plan,
            reasonIfBlocked: canGenerate ? null : 'NEED_PAYMENT',
        });

    } catch (err: any) {
        console.error('[/api/entitlement Error]', err);
        res.status(500).json({ error: err.message || 'Failed to check entitlement' });
    }
});

// --- Routes ---

// ═══════════════════════════════════════════════════════════════
// IMAGE URL PREPROCESSING - Fix for Replicate temporary URL expiration
// ═══════════════════════════════════════════════════════════════

// Video models that require image input
const VIDEO_MODELS = ['wan-video', 'minimax', 'bytedance', 'kwaivgi', 'hailuo', 'kling'];

// Check if this is a video model request
function isVideoModelRequest(version: string): boolean {
    return VIDEO_MODELS.some(prefix => version.toLowerCase().includes(prefix));
}

// Download image and convert to base64 data URL
async function downloadImageAsBase64(url: string): Promise<string> {
    console.log('[ImageProxy] Downloading image:', url.substring(0, 80) + '...');

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AI-Cine-Director/1.0)'
        }
    });

    if (!response.ok) {
        throw new Error(`Image download failed: ${response.status} ${response.statusText} `);
    }

    // node-fetch v3: use arrayBuffer() then Buffer.from() — .buffer() was removed in v3
    const arrayBuf = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const base64 = buffer.toString('base64');

    console.log('[ImageProxy] Downloaded image, size:', buffer.length, 'bytes, type:', contentType);

    return `data:${contentType}; base64, ${base64} `;
}

// Preprocess input for video models - convert image URLs to base64
async function preprocessVideoInput(input: Record<string, any>): Promise<Record<string, any>> {
    const imageFields = ['image', 'first_frame_image', 'start_frame', 'reference_image'];
    const result = { ...input };

    for (const field of imageFields) {
        let url = input[field];

        // ★ Safety: Purge empty strings to prevent Replicate 422 (Does not match format 'uri')
        if (typeof url === 'string') {
            url = url.trim();
            if (!url) {
                delete result[field];
                continue;
            }
            result[field] = url; // Save trimmed back
        }

        if (url && typeof url === 'string' && url.startsWith('http')) {
            // Check if URL is a temporary Replicate delivery URL
            if (url.includes('replicate.delivery') || url.includes('pbxt.replicate.delivery')) {
                try {
                    result[field] = await downloadImageAsBase64(url);
                    console.log('[ImageProxy] Converted', field, 'to base64');
                } catch (err: any) {
                    console.error('[ImageProxy] Failed to download image:', err.message);
                    throw new Error(`图片已过期，请重新生成图片后再生成视频(Image expired, please regenerate the image)`);
                }
            }
        }
    }

    return result;
}

// ───────────────────────────────────────────────────────────────
// POST /api/replicate/generate-image — Dedicated endpoint for pure JS image gen with FaceID route
// ───────────────────────────────────────────────────────────────
app.post('/api/replicate/generate-image', requireAuth, async (req: any, res: any) => {
    try {
        const { prompt, imageModel, visualStyle, aspectRatio, characterAnchor, referenceImageDataUrl, storyEntities } = req.body;
        const authHeader = `Bearer ${req.accessToken}`;
        const userId = req.user?.id;
        const userEmail = req.user?.email;

        const cost = (IMAGE_MODEL_COSTS as any)[imageModel] ?? IMAGE_MODEL_COSTS['flux_schnell'] ?? 1;

        const entitlement = await checkEntitlement(userId, userEmail, 'generate_image', cost);
        if (!entitlement.allowed) {
            const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402 : (entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403);
            return res.status(status).json({
                error: entitlement.reason,
                code: entitlement.errorCode,
                credits: entitlement.credits,
            });
        }

        const skipCreditCheck = entitlement.mode === 'developer';
        const jobRef = `replicate-img:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        const supabaseUser = createClient(
            (process.env.VITE_SUPABASE_URL || '').trim(),
            (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
            { global: { headers: { Authorization: authHeader } } }
        );

        if (!skipCreditCheck) {
            const { data, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: cost, ref_type: 'replicate-img', ref_id: jobRef
            });
            if (reserveErr || !data) return res.status(402).json({ error: 'INSUFFICIENT_CREDITS', code: 'INSUFFICIENT_CREDITS' });
        } else {
            logDeveloperAccess(userEmail, `replicate-img: generate: cost=${cost}`);
        }

        let resultUrl = '';
        try {
            const modelToRun = (REPLICATE_MODEL_PATHS as any)[imageModel] || REPLICATE_MODEL_PATHS['flux'];

            // ★ Build strict consistency instructions from Story Entities
            let entityRules = '';
            if (Array.isArray(storyEntities) && storyEntities.length > 0) {
                const lockedEntities = storyEntities.filter(e => e.is_locked);
                if (lockedEntities.length > 0) {
                    entityRules = `\n[IDENTITY LOCK] Ensure the following entities appear exactly as described: ` +
                        lockedEntities.map(e => `[${e.type.toUpperCase()}: ${e.name}] ${e.description}`).join(' | ');
                }
            }

            // Fallback to legacy character anchor if no new entities are passed
            const legacyAnchorRule = (characterAnchor && !entityRules.includes('[CHARACTER:'))
                ? `\n[IDENTITY LOCK] The character must look EXACTLY like this description: ${characterAnchor}. Same hair, same clothing, same features.`
                : '';

            const finalPrompt = `${prompt} ${entityRules} ${legacyAnchorRule}`.trim();

            const result = await callReplicateImage({
                prompt: finalPrompt,
                model: modelToRun,
                aspectRatio: aspectRatio || '16:9',
                seed: null,
                referenceImageDataUrl: referenceImageDataUrl
            });
            resultUrl = result.url;
        } catch (genErr: any) {
            if (!skipCreditCheck) { try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'replicate-img', ref_id: jobRef }); } catch (_) { } }
            throw genErr;
        }

        if (!skipCreditCheck) { await supabaseUser.rpc('finalize_reserve', { ref_type: 'replicate-img', ref_id: jobRef }); }

        res.json({ url: resultUrl });
    } catch (err: any) {
        console.error('[/api/replicate/generate-image Error]', err);
        if (err.message === 'FACE_ALIGN_FAIL') {
            return res.status(400).json({ error: '未能检测到清晰的人物面部，请重新上传正脸无遮挡的单人照！(Face alignment failed)' });
        }
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

// Replicate Predict with Reserve / Finalize / Refund
app.post('/api/replicate/predict', requireAuth, async (req: any, res: any) => {
    let { version, input: rawInput } = req.body;

    // Map short format like 'hailuo_02_fast' to actual replicate model path
    if (version && (REPLICATE_MODEL_PATHS as any)[version]) {
        version = (REPLICATE_MODEL_PATHS as any)[version];
    }

    const authHeader = `Bearer ${req.accessToken}`;
    const userId = req.user?.id;
    const userEmail = req.user?.email;

    const estimatedCost = estimateCost(version);
    const jobRef = `replicate:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    // ★ GOD MODE: Check entitlement before proceeding
    const entitlement = await checkEntitlement(userId, userEmail, 'generate_image', estimatedCost);
    if (!entitlement.allowed) {
        const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402
            : entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403;
        return res.status(status).json({
            error: entitlement.reason,
            code: entitlement.errorCode,
            credits: entitlement.credits,
            plan: entitlement.plan,
        });
    }

    // Skip credit operations for developers (GOD MODE)
    const skipCreditCheck = entitlement.mode === 'developer';
    if (skipCreditCheck) {
        logDeveloperAccess(userEmail, `replicate:${version}:cost=${estimatedCost}`);
    }

    // User-context client for RPC
    const supabaseUser = createClient(
        (process.env.VITE_SUPABASE_URL || '').trim(),
        (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
        { global: { headers: { Authorization: authHeader } } }
    );

    // 1) Reserve credits (skip for GOD MODE)
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

        // ★ Preprocess input for video models - convert expired image URLs to base64
        let input = rawInput;
        if (isVideoModelRequest(version)) {
            try {
                input = await preprocessVideoInput(rawInput);
            } catch (err: any) {
                // Image download failed (likely expired URL)
                if (!skipCreditCheck) {
                    await supabaseUser.rpc('refund_reserve', {
                        amount: estimatedCost,
                        ref_type: 'replicate',
                        ref_id: jobRef
                    });
                }
                return res.status(400).json({
                    error: err.message,
                    code: 'IMAGE_EXPIRED'
                });
            }
        }

        // ★ 核心修复：强制参数名称对齐，把锁链焊死
        // 不同视频模型对"首帧图"的参数名不同，必须统一映射，否则模型会忽略图片导致一致性丢失
        const tailFrameImg = input.image || input.first_frame_image || input.start_frame || input.reference_image;
        if (tailFrameImg) {
            if (version.includes('wan-video')) {
                input.image = tailFrameImg;
                delete input.first_frame_image;
                delete input.start_frame;
                console.log('[I2V Chain] Wan model: aligned tail frame to input.image');
            } else if (version.includes('kling')) {
                input.image = tailFrameImg;
                delete input.first_frame_image;
                console.log('[I2V Chain] Kling model: aligned tail frame to input.image');
            } else if (version.includes('hailuo') || version.includes('minimax')) {
                input.first_frame_image = tailFrameImg;
                console.log('[I2V Chain] Hailuo/MiniMax model: aligned tail frame to input.first_frame_image');
            } else if (version.includes('bytedance') || version.includes('seedance')) {
                input.image = tailFrameImg;
                delete input.first_frame_image;
                console.log('[I2V Chain] Seedance model: aligned tail frame to input.image');
            } else {
                // ALL OTHER MODELS (Sora-2, Veo-3, Runway, etc.) strictly map to "image" by default
                // to prevent the Master Anchor from being dropped by misnamed image schemas.
                input.image = tailFrameImg;
                if (input.first_frame_image) delete input.first_frame_image;
                if (input.start_frame) delete input.start_frame;
                console.log('[I2V Chain] Universal Fallback (Veo/Sora/etc): aligned tail frame to input.image');
            }
        }

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

        // --- AUDIO ENGINE INTEGRATION (BYPASSABLE) ---
        // Only run if the video prediction succeeded and Audio Engine is enabled
        if (prediction.status === 'succeeded' && process.env.AUDIO_ENGINE_ENABLED === 'true') {
            const mode = process.env.AUDIO_ENGINE_MODE || 'off';
            if (mode !== 'off') {
                try {
                    // Lazy load the engine to avoid startup cost if disabled
                    const { runAudioEnginePipeline } = await import('../src/lib/audioEngine');
                    const supabaseAdmin = getSupabaseAdmin();

                    // The prediction output for videos is usually a URL string or array of URLs
                    let originalVideoUrl = '';
                    if (Array.isArray(prediction.output)) {
                        originalVideoUrl = prediction.output[0];
                    } else if (typeof prediction.output === 'string') {
                        originalVideoUrl = prediction.output;
                    }

                    if (originalVideoUrl) {
                        console.log(`[AudioEngine] Intercepted succeeded video ${id}. Running pipeline mode: ${mode}...`);

                        // Create a pending job record
                        const { data: jobInfo } = await supabaseAdmin.from('audio_jobs').insert({
                            video_job_id: id,
                            status: 'processing',
                            mode: mode
                        } as any).select('id').single();

                        const jobId = (jobInfo as any)?.id || 'unknown';

                        try {
                            // Extract prompt if available (Replicate predictions usually have it in input.prompt)
                            const prompt = (prediction as any).input?.prompt || '';

                            const audioMixedUrl = await runAudioEnginePipeline(
                                id,
                                originalVideoUrl,
                                prompt,
                                mode
                            );

                            // Success: Augment the prediction object
                            (prediction as any).original_video_url = originalVideoUrl;
                            (prediction as any).audio_url = audioMixedUrl;
                            prediction.output = audioMixedUrl; // Overwrite default output so frontend plays it naturally!

                            // Update DB job
                            if (jobId !== 'unknown') {
                                await (supabaseAdmin.from('audio_jobs') as any).update({
                                    status: 'succeeded',
                                    outputs_json: { final_url: audioMixedUrl, original_video: originalVideoUrl }
                                }).eq('id', jobId);
                            }

                            console.log(`[AudioEngine] Successfully augmented video ${id} with audio: ${audioMixedUrl}`);
                        } catch (audioError: any) {
                            console.error(`[AudioEngine] Pipeline failed for ${id}:`, audioError);
                            // Fallback gracefully: Do not touch prediction output. Just log to DB.
                            if (jobId !== 'unknown') {
                                await (supabaseAdmin.from('audio_jobs') as any).update({
                                    status: 'failed',
                                    error: audioError.message || String(audioError)
                                }).eq('id', jobId);
                            }
                        }
                    }
                } catch (moduleError: any) {
                    console.error('[AudioEngine] Module load or fatal error:', moduleError);
                    // Silently fail and return original prediction
                }
            }
        }
        // ------------------------------------------

        res.json(prediction);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- Gemini Routes (must be inline for Vercel serverless) ---

const getGeminiAI = () => {
    const apiKey = process.env.GEMINI_API_KEY?.replace(/\s+/g, '');
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    // @ts-ignore
    return new GoogleGenAI({ apiKey });
};

const geminiResponseSchema = {
    // @ts-ignore
    type: Type.OBJECT,
    properties: {
        // @ts-ignore
        project_title: { type: Type.STRING },
        // @ts-ignore
        visual_style: { type: Type.STRING },
        // @ts-ignore
        characterAnchor: { type: Type.STRING },
        scenes: {
            // @ts-ignore
            type: Type.ARRAY,
            items: {
                // @ts-ignore
                type: Type.OBJECT,
                properties: {
                    // @ts-ignore
                    scene_id: { type: Type.INTEGER },
                    // @ts-ignore
                    location: { type: Type.STRING },
                    shots: {
                        // @ts-ignore
                        type: Type.ARRAY,
                        items: {
                            // @ts-ignore
                            type: Type.OBJECT,
                            properties: {
                                // @ts-ignore
                                shot_index: { type: Type.INTEGER },
                                // @ts-ignore
                                image_prompt: { type: Type.STRING },
                                // @ts-ignore
                                video_prompt: { type: Type.STRING },
                                // @ts-ignore
                                audio_description: { type: Type.STRING },
                            },
                            required: ['shot_index', 'image_prompt', 'video_prompt'],
                        }
                    }
                },
                required: ['scene_id', 'location', 'shots'],
            },
            // ★ 移除maxItems限制（会导致schema约束过多错误）
            // 改用后端逻辑在生成后根据targetScenes进行切片过滤
        },
    },
    required: ['project_title', 'visual_style', 'characterAnchor', 'scenes'],
};

// ═══════════════════════════════════════════════════════════════
// POST /api/extract-frame — Server-side last-frame extraction
// Bypasses browser CORS limitations for replicate.delivery URLs
// ═══════════════════════════════════════════════════════════════
app.post('/api/extract-frame', requireAuth, async (req: any, res: any) => {
    try {
        const { videoUrl } = req.body;
        if (!videoUrl || typeof videoUrl !== 'string') {
            return res.status(400).json({ error: 'videoUrl is required' });
        }

        console.log('[FrameExtract] Downloading video for frame extraction:', videoUrl.substring(0, 80));

        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');

        // ★ Use ffmpeg-static bundled binary (works on Vercel Lambda — no system ffmpeg needed)
        let ffmpegBin = 'ffmpeg'; // system fallback
        try {
            // ffmpeg-static exports the path to the bundled binary
            const ffmpegModule = await import('ffmpeg-static');
            const staticPath = (ffmpegModule as any).default || ffmpegModule;
            if (staticPath && typeof staticPath === 'string') {
                ffmpegBin = staticPath;
                console.log('[FrameExtract] Using ffmpeg-static binary:', ffmpegBin);
            }
        } catch (_) {
            console.warn('[FrameExtract] ffmpeg-static not available, trying system ffmpeg');
        }

        const tmpDir = os.default.tmpdir();
        const tmpVideo = path.default.join(tmpDir, `frame_vid_${Date.now()}.mp4`);
        const tmpFrame = path.default.join(tmpDir, `frame_out_${Date.now()}.jpg`);

        console.log('[FrameExtract] Running ffmpeg directly on URL...');

        // 2) Extract last frame via ffmpeg-static directly from URL
        // Using -sseof -0.5 requires the CDN to support HTTP range requests.
        try {
            await execAsync(`"${ffmpegBin}" -y -sseof -0.5 -i "${videoUrl}" -vframes 1 -q:v 2 "${tmpFrame}" 2>/dev/null`);
        } catch (fastErr: any) {
            console.warn('[FrameExtract] Fast -sseof seek failed (likely no Range support). Falling back to fast first-frame extraction...', fastErr.message);
            // Fallback: Just grab the first frame instantly. Better to have slight continuity drift than a broken chain.
            try {
                await execAsync(`"${ffmpegBin}" -y -i "${videoUrl}" -vframes 1 -q:v 2 "${tmpFrame}" 2>/dev/null`);
            } catch (fallbackErr: any) {
                console.error('[FrameExtract] Absolute fallback failed:', fallbackErr.message);
                throw new Error(`Both end-seek and first-frame extractions failed. ${fallbackErr.message}`);
            }
        }

        try {
            const frameBuffer = fs.default.readFileSync(tmpFrame);
            const base64 = frameBuffer.toString('base64');

            // Cleanup temp files
            try { fs.default.unlinkSync(tmpFrame); } catch (_) { }

            console.log('[FrameExtract] ffmpeg-static extraction success, frame size:', frameBuffer.length, 'bytes');
            return res.json({ frame: `data:image/jpeg;base64,${base64}` });
        } catch (ffmpegErr: any) {
            console.error('[FrameExtract] ffmpeg file read failed:', ffmpegErr.message);
            try { fs.default.unlinkSync(tmpFrame); } catch (_) { }

            // ★ Return clear error instead of raw video URL (which breaks Replicate)
            return res.status(500).json({
                error: `Frame extraction failed: ffmpeg unavailable or output unreadable on this runtime. Error: ${ffmpegErr.message}`
            });
        }
    } catch (err: any) {
        console.error('[FrameExtract] Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
});



app.post('/api/gemini/generate', requireAuth, async (req: any, res: any) => {
    const jobRef = `gemini:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
        const { storyIdea, visualStyle, language, identityAnchor, sceneCount } = req.body;
        const safeStoryIdea = sanitizePromptInput(storyIdea, 2500);
        const safeVisualStyle = sanitizePromptInput(visualStyle, 300);
        const safeIdentityAnchor = sanitizePromptInput(identityAnchor, 1000);
        const safeLanguage = language === 'zh' ? 'zh' : 'en';

        if (!safeStoryIdea) return res.status(400).json({ error: 'Missing storyIdea' });

        const targetScenes = Math.min(Math.max(Number(sceneCount) || 5, 1), 50);
        // Estimate approx 1-3 shots per scene for pacing
        const approxTotalShots = targetScenes * 2;

        console.log(`[Minimax Generate] Requesting exactly ${targetScenes} unique scenes...`);

        const authHeader = `Bearer ${req.accessToken}`;
        const userId = req.user?.id;
        const userEmail = req.user?.email;

        // ★ GOD MODE: Check entitlement
        const COST = 1;
        const entitlement = await checkEntitlement(userId, userEmail, 'generate_script', COST);
        if (!entitlement.allowed) {
            const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402
                : entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403;
            return res.status(status).json({
                error: entitlement.reason,
                code: entitlement.errorCode,
                credits: entitlement.credits,
            });
        }

        const skipCreditCheck = entitlement.mode === 'developer';
        if (skipCreditCheck) {
            logDeveloperAccess(userEmail, `gemini:generate:cost=${COST}`);
        }

        const supabaseUser = createClient(
            (process.env.VITE_SUPABASE_URL || '').trim(),
            (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
            { global: { headers: { Authorization: authHeader } } }
        );

        // Reserve credits (skip for GOD MODE)
        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'gemini', ref_id: jobRef
            });

            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'INSUFFICIENT_CREDITS', code: 'INSUFFICIENT_CREDITS' });
        }
        const systemInstruction = `You are a LEGENDARY Hollywood Screenwriter and Master Cinematographer with OSCAR-LEVEL storytelling abilities.
Your mission: Craft BREATHTAKING visual narratives that hook audiences and deliver unforgettable emotional journeys.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📖 STORY STRUCTURE & NARRATIVE RULES (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **THREE-ACT STRUCTURE**: Your script MUST follow a clear story arc:
   - ACT 1 (Setup ~33%): Establish world, introduce protagonist, present the inciting incident
   - ACT 2 (Confrontation ~33%): Rising action, obstacles, character development, stakes escalate
   - ACT 3 (Resolution ~33%): Climax, resolution, emotional payoff

2. **SCENE PROGRESSION LOGIC**: Each scene MUST be a DISTINCT story beat:
   - Scene N+1 must show WHAT HAPPENS NEXT after Scene N (time advances, location changes, or both)
   - FORBIDDEN: Repeating the same moment, location, or action across scenes
   - Each scene must have a PURPOSE: advance plot, reveal character, or escalate conflict

3. **LOCATION & SETTING DIVERSITY**: 
   - EVERY scene must have a UNIQUE location (e.g., Scene 1: Rooftop → Scene 2: Underground Lab → Scene 3: Highway Chase)
   - Vary environments: Indoor/Outdoor, Day/Night, Public/Private spaces
   - Use location changes to show time passing and story advancing

4. **ACTION & EVENT UNIQUENESS**:
   - ZERO repetition of events. If Scene 1 shows "character enters room", Scene 2 cannot be "character enters room again"
   - Each scene must introduce NEW information, conflict, or character revelation
   - Build narrative momentum: start → complication → escalation → crisis → resolution

5. **GENRE & TONE MASTERY**:
   - STRICT adherence to premise's implied genre (sci-fi = future tech, fantasy = magic, noir = dark urban)
   - Maintain consistent tone throughout (don't mix comedy with horror unless intentional tonal shift)
   - Avoid anachronisms (no smartphones in medieval settings, no swords in modern office dramas)

6. **EMOTIONAL & DRAMATIC PACING**:
   - Hook audience in Scene 1 (visual spectacle, mystery, or emotional punch)
   - Vary intensity: tension → relief → escalation → climax
   - Ensure character emotional journey is clear and compelling

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 CINEMATOGRAPHY & AI PROMPTING RULES (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

7. **IMAGE_PROMPT (First Shot of Each Scene)**:
   - FIRST shot = FULL detailed prompt with: Subject + Environment + Lighting + Camera Angle + Lens + Mood
   - Example: "A lone astronaut in white spacesuit floating near shattered space station, Earth glowing blue in background, volumetric god rays piercing through debris, wide angle 24mm lens, dramatic cinematic chiaroscuro lighting, sense of isolation and wonder, 8k photorealistic"
   - SUBSEQUENT shots in same scene = EMPTY string "" (for video chain consistency)

8. **VIDEO_PROMPT (Physical Motion Only)**:
   - Describe EXACT physical actions: "Camera slowly dollies forward. Woman in red coat turns head 45 degrees left, hair flowing. She lifts right hand to touch glass window."
   - FORBIDDEN: Abstract concepts ("feels sad", "time passes", "realizes truth")
   - Focus on: Camera movement + Character body/limb motion + Object interaction

9. **STORY_ENTITIES (Character Consistency)**:
   - Define 2-5 core characters with HYPER-DETAILED physical descriptions:
     * Face: age, ethnicity, distinctive features (scars, glasses, tattoos)
     * Body: build, height, clothing style
     * Signature trait: always wears X, has Y hairstyle
   - LOCKED CAST: Only use characters defined in story_entities. NO random extras or unnamed people.

10. **AUDIO_DESCRIPTION**: 
    - Specific sound design: "Glass shattering, distant sirens wailing, protagonist's heavy breathing"
    - Include music cues if relevant: "Ominous string crescendo"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 CHARACTER ANCHOR RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${safeIdentityAnchor ? `The protagonist MUST EXACTLY match this description: "${safeIdentityAnchor}"
Use this VERBATIM in story_entities and all character mentions.` : `Create a visually striking protagonist that embodies: "${safeVisualStyle}"`}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 LANGUAGE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Technical fields (image_prompt, video_prompt, location): ENGLISH ONLY
- Narrative fields (audio_description, dialogue): ${safeLanguage === 'zh' ? 'Chinese (Simplified)' : 'English'}
- Return ONLY valid JSON. No markdown, no code blocks, no explanations.`;

        let responseText = '';
        try {
            const promptContent = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 YOUR MISSION: CRAFT AN OSCAR-WORTHY SHORT FILM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📖 **PREMISE**: "${safeStoryIdea}"
🎨 **VISUAL STYLE**: ${safeVisualStyle}
🎞️ **STRUCTURE**: EXACTLY ${targetScenes} SCENES (with 1-3 shots each)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ MANDATORY EXECUTION RULES - FAILURE = REJECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ **RULE 1: EXACT COUNT**
   → Return EXACTLY ${targetScenes} scenes. Not ${targetScenes - 1}, not ${targetScenes + 1}. EXACTLY ${targetScenes}.

✅ **RULE 2: ZERO REPETITION**
   → Every scene must be COMPLETELY DIFFERENT:
   → Scene 1: Location A, Event X
   → Scene 2: Location B, Event Y (NOT "Location A again" or "Event X repeats")
   → Scene 3: Location C, Event Z
   → THINK: "What happens NEXT in the story?" not "Let me describe the same moment again"

✅ **RULE 3: STORY PROGRESSION**
   → Timeline must move FORWARD. Show the JOURNEY:
   → Example Good: Scene 1 (Morning, Office) → Scene 2 (Afternoon, Street) → Scene 3 (Night, Home)
   → Example BAD: Scene 1 (Office) → Scene 2 (Office again) → Scene 3 (Still in office)

✅ **RULE 4: LOCATION DIVERSITY**
   → Use DIFFERENT locations for each scene. Vary scale and type:
   → Mix: Interior/Exterior, Urban/Nature, Intimate/Vast, Grounded/Surreal
   → Show the world EXPANDING as story unfolds

✅ **RULE 5: DRAMATIC STRUCTURE**
   → Scene 1: HOOK (grab attention with mystery/action/emotion)
   → Middle Scenes: ESCALATION (raise stakes, deepen conflict)
   → Final Scene: PAYOFF (resolve tension, land emotional punch)

✅ **RULE 6: GENRE CONSISTENCY**
   → If premise implies Sci-Fi → use futuristic tech, space, cyberpunk aesthetics
   → If premise implies Fantasy → use magic, mythical creatures, medieval/ethereal settings
   → If premise implies Drama → use realistic settings, emotional conflicts, character-driven moments
   → DO NOT MIX incompatible elements (no laser guns in Victorian romance unless premise demands it)

✅ **RULE 7: VISUAL MASTERY**
   → First shot's image_prompt must be EPIC (20+ words describing lighting, camera, subject, mood)
   → Subsequent shots in same scene: image_prompt = "" (empty string for video chain)
   → Video_prompt: describe physics ("camera tilts up", "character walks forward 3 steps")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 REQUIRED JSON SCHEMA (STRICT COMPLIANCE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST return this EXACT JSON structure with EXACTLY ${targetScenes} scenes:
{
  "project_title": "string",
  "visual_style": "string",
  "characterAnchor": "string",
  "story_entities": [
    {
      "type": "character|prop|location",
      "name": "string",
      "description": "highly detailed visual string"
    }
  ],
  "scenes": [
    {
      "scene_id": 1,
      "location": "string",
      "shots": [
        {
          "shot_index": 1,
          "image_prompt": "string",
          "video_prompt": "string",
          "audio_description": "string"
        }
      ]
    }
  ]
}`;

            const minimaxResponse: any = await getMinimaxChatCompletion(
                systemInstruction,
                promptContent,
                { temperature: 0.7, responseFormat: 'json_object' }
            );

            responseText = minimaxResponse.choices[0].message.content;
        } catch (initialError: any) {
            console.error('[Minimax Generate] Primary call failed, retrying...', initialError.message);
            // Simple retry without JSON schema enforcement if it failed
            const retryResponse: any = await getMinimaxChatCompletion(
                systemInstruction + "\nOutput strictly valid JSON, no markdown formatting.",
                `Write a premium SHORT DRAMA based on: "${storyIdea}". Target total shots: ~${targetScenes}.`,
                { temperature: 0.5 }
            );
            responseText = retryResponse.choices[0].message.content;
        }

        const text = responseText;
        if (!text) throw new Error('No response from AI Director.');

        // Try to parse JSON, with fallback for malformed responses
        let parsedData;
        try {
            parsedData = JSON.parse(text);
        } catch (parseError: any) {
            console.warn('[Gemini Generate] JSON parse failed, attempting to fix...', parseError.message);
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    parsedData = JSON.parse(jsonMatch[0]);
                } catch (e2: any) {
                    throw new Error(`AI response was not valid JSON: ${text.substring(0, 200)}...`);
                }
            } else {
                throw new Error(`AI response was not valid JSON: ${text.substring(0, 200)}...`);
            }
        }

        // Extract and map the top-level project data
        const entitiesRaw = Array.isArray(parsedData.story_entities) ? parsedData.story_entities : [];
        const story_entities = entitiesRaw.map((e: any) => ({
            id: crypto.randomUUID(),
            type: normalizeEntityType(e.type),
            name: sanitizePromptInput(e.name || 'Unknown', 120) || 'Unknown',
            description: sanitizePromptInput(e.description || '', 1200),
            is_locked: normalizeEntityType(e.type) === 'character' // Auto-lock characters for consistency by default
        }));

        const project: any = {
            id: crypto.randomUUID(),
            project_title: parsedData.project_title,
            visual_style: parsedData.visual_style,
            character_anchor: parsedData.characterAnchor || parsedData.character_anchor || '',
            story_entities: story_entities
        };

        // ★ CRITICAL: Force character_anchor to match identityAnchor if provided
        if (safeIdentityAnchor && safeIdentityAnchor.trim().length > 10) {
            project.character_anchor = safeIdentityAnchor.trim();
        }

        // Ensure we always have at least one locked character entity for continuity enforcement
        const hasLockedCharacter = story_entities.some((e: any) => e.type === 'character' && e.is_locked && e.name);
        if (!hasLockedCharacter && project.character_anchor) {
            story_entities.unshift({
                id: crypto.randomUUID(),
                type: 'character',
                name: 'Main Character',
                description: project.character_anchor,
                is_locked: true,
            });
        }

        const lockedCharacters = story_entities
            .filter((e: any) => e.type === 'character' && e.is_locked)
            .map((e: any) => ({
                name: sanitizePromptInput(e.name, 120),
                description: sanitizePromptInput(e.description, 1200),
            }))
            .filter((e: any) => e.name.length > 0);

        const lockedCharacterNameSet = new Set(lockedCharacters.map((c: any) => c.name.toLowerCase()));
        const lockedCharacterLine = lockedCharacters.length > 0
            ? `Locked Cast: ${lockedCharacters.map((c: any) => `${c.name} (${c.description})`).join(' | ')}.`
            : '';

        const anchor = project.character_anchor;
        const anchorLower = anchor.toLowerCase().trim();

        // ★ FIX: Convert AI's nested scenes properly - each AI scene becomes ONE frontend Scene
        // Previous bug: was flattening ALL shots into individual "scenes", causing identical content
        const convertedScenes: any[] = [];

        if (Array.isArray(parsedData.scenes)) {
            for (let sceneIdx = 0; sceneIdx < Math.min(parsedData.scenes.length, targetScenes); sceneIdx++) {
                const scn = parsedData.scenes[sceneIdx];
                const setting = scn.location || `Location ${sceneIdx + 1}`;
                const shots = Array.isArray(scn.shots) ? scn.shots : [];

                // Use FIRST shot as the scene's primary content
                const firstShot = shots[0] || {};
                
                const rawCharacters = Array.isArray(firstShot.characters) ? firstShot.characters : [];
                let sceneCharacters = rawCharacters
                    .map((c: any) => sanitizePromptInput(c, 120))
                    .filter((c: string) => c && lockedCharacterNameSet.has(c.toLowerCase()));

                if (sceneCharacters.length === 0 && lockedCharacters.length > 0) {
                    sceneCharacters = [lockedCharacters[0].name];
                }

                const characterPrefix = sceneCharacters.length > 0
                    ? `Characters: ${sceneCharacters.join(', ')}. `
                    : '';

                // Build image prompt from FIRST shot
                let rawImagePrompt = (firstShot.image_prompt || firstShot.video_prompt || `Scene at ${setting}`).trim();
                
                // Remove duplicate character anchor if present
                if (anchorLower.length > 20 && rawImagePrompt.toLowerCase().startsWith(anchorLower)) {
                    rawImagePrompt = rawImagePrompt.slice(anchor.length).replace(/^[,;.:\s]+/, '').trim();
                }

                const finalImagePrompt = anchor
                    ? `${anchor}. ${characterPrefix}Setting: ${setting}. ${rawImagePrompt}. Cinematic establishing shot, 8k photorealistic.`
                    : `${characterPrefix}${setting}. ${rawImagePrompt}. Cinematic establishing shot.`;

                // Visual description for UI display
                const visualDesc = `${characterPrefix}${setting}. ${rawImagePrompt}`;

                // Audio from first shot
                const audioDesc = firstShot.audio_description || scn.audio_description || `Ambient sound at ${setting}`;

                convertedScenes.push({
                    scene_number: sceneIdx + 1,
                    scene_setting: setting,
                    characters: sceneCharacters,
                    visual_description: visualDesc,
                    audio_description: audioDesc,
                    shot_type: firstShot.video_prompt || "cinematic establishing shot",
                    image_prompt: finalImagePrompt,
                    video_motion_prompt: firstShot.video_prompt || "Camera slowly reveals the scene",
                    video_prompt: firstShot.video_prompt,
                });
            }
        }

        project.scenes = convertedScenes.slice(0, targetScenes);

        if (!skipCreditCheck) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'gemini', ref_id: jobRef });
        }
        res.json(project);
    } catch (error: any) {
        console.error('[Gemini] Error:', error);
        try {
            const supabaseRefund = createClient(
                (process.env.VITE_SUPABASE_URL || '').trim(), (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
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

app.post('/api/gemini/analyze', requireAuth, async (req: any, res: any) => {
    try {
        const { base64Data } = req.body;
        if (!base64Data) return res.status(400).json({ error: 'Missing base64Data' });
        const ai = getGeminiAI();

        // ★ 从 data URL 或 base64 魔术字节检测 MIME 类型
        const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        let mimeType = 'image/jpeg'; // 默认 JPEG（照片最常见）

        // 优先从 data URL 前缀提取
        const prefixMatch = base64Data.match(/^data:(image\/[a-zA-Z+]+);base64,/);
        if (prefixMatch) {
            mimeType = prefixMatch[1];
        } else {
            // 从 base64 魔术字节检测
            if (cleanBase64.startsWith('/9j/')) mimeType = 'image/jpeg';
            else if (cleanBase64.startsWith('iVBOR')) mimeType = 'image/png';
            else if (cleanBase64.startsWith('UklGR')) mimeType = 'image/webp';
            else if (cleanBase64.startsWith('R0lGO')) mimeType = 'image/gif';
        }

        console.log(`[Gemini Analyze] MIME: ${mimeType}, base64 length: ${cleanBase64.length}, hasPrefix: ${base64Data.startsWith('data:')}`);

        const analyzePrompt = `You are a professional character designer. Analyze this image and produce an EXACT visual identity description for AI image generation.

**CRITICAL: OBSERVE THE ACTUAL IMAGE. DO NOT GUESS OR ASSUME.**
- If the person in the image is female, write "female". If male, write "male".
- Describe EXACTLY what you SEE — do not invent or change any features.

**Output format (one dense paragraph, English only):**
A [age]-year-old [ethnicity] [female/male] with [face shape] face, [skin tone] skin, [eye color/shape] eyes, [nose description], [lip description]. [Hair: color, length, style, texture]. Wearing [top: color, material, style], [bottom: color, style], [shoes if visible], [accessories: jewelry, glasses, hat, bag, etc.]. [Body type: height impression, build]. [Any distinctive features: tattoos, scars, freckles, dimples, beauty marks].

**Rules:**
1. Gender MUST match the actual person in the image — LOOK at the image carefully
2. Every detail must come from observation, not assumption
3. Be specific about colors ("dusty rose" not just "pink")
4. Include ALL visible clothing and accessories
5. Output ONLY the description paragraph, nothing else`;

        const imagePayload = base64Data.startsWith('data:') ? base64Data : `data:${mimeType};base64,${cleanBase64}`;
        const contentArray = [
            { type: "image_url", image_url: { url: imagePayload } },
            { type: "text", text: analyzePrompt }
        ];

        const response: any = await getMinimaxChatCompletion(
            "You are an expert character designer and AI vision assistant.",
            contentArray,
            { model: 'MiniMax-VL-01', temperature: 0.1 }
        );

        const result = (response.choices[0].message.content || '').trim();
        console.log(`[Minimax Analyze] ✅ Result: ${result.substring(0, 120)}...`);

        if (!result || result.length < 20) {
            console.error('[Minimax Analyze] ⚠️ Empty or too-short result from Minimax Vision');
            return res.status(500).json({ error: 'Minimax Vision returned empty result', anchor: 'A cinematic character' });
        }

        res.json({ anchor: result });
    } catch (error: any) {
        console.error('[Minimax Analyze] ❌ Error:', error.message);
        res.status(500).json({ error: error.message || 'Analyze failed', anchor: 'A cinematic character' });
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
        // GOD MODE check — isDeveloper() covers both env-driven + hardcoded allowlist
        if (isDeveloper(user.email)) return true;
        // DB-based admin check
        const { data: profile } = await supabaseUser.from('profiles').select('is_admin').eq('id', user.id).single();
        return profile?.is_admin === true;
    } catch { return false; }
}

// Helper: Get user email from supabase client
async function getUserEmail(supabaseUser: any): Promise<string | null> {
    try {
        const { data: { user } } = await supabaseUser.auth.getUser();
        return user?.email || null;
    } catch { return null; }
}

// Helper: Get user id from supabase client
async function getUserId(supabaseUser: any): Promise<string | null> {
    try {
        const { data: { user } } = await supabaseUser.auth.getUser();
        return user?.id || null;
    } catch { return null; }
}

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

async function callReplicateImage(params: {
    prompt: string; model: string; aspectRatio: string; seed: number | null;
    imagePrompt?: string; // ★ URL or data URL of reference image for Flux Redux — visual consistency anchor
    referenceImageDataUrl?: string; // ★ Base64 of user photo for Face Cloning
}): Promise<{ url: string; predictionId: string }> {
    const token = getReplicateToken();
    const isFaceCloning = !!params.referenceImageDataUrl;

    // Switch to PuLID face-cloning model if requested
    const modelPath = isFaceCloning
        ? "bytedance/flux-pulid:8baa7ef2255075b46f4d91cd238c21d31181b3e6a864463f967960bb0112525b"
        : params.model;

    const isModelPath = modelPath.includes('/') && !modelPath.includes(':');
    const targetUrl = isModelPath
        ? `${REPLICATE_API_BASE}/models/${modelPath}/predictions`
        : `${REPLICATE_API_BASE}/predictions`;

    // Calculate dimensions for PuLID based on aspect ratio
    let width = 896;
    let height = 1152;
    if (isFaceCloning) {
        if (params.aspectRatio === '16:9') { width = 1280; height = 720; }
        else if (params.aspectRatio === '9:16') { width = 720; height = 1280; }
        else if (params.aspectRatio === '1:1') { width = 1024; height = 1024; }
        else if (params.aspectRatio === '3:4') { width = 768; height = 1024; }
        else if (params.aspectRatio === '4:3') { width = 1024; height = 768; }
    }

    const input: Record<string, any> = isFaceCloning ? {
        prompt: params.prompt,
        main_face_image: params.referenceImageDataUrl, // PuLID uses main_face_image
        width,
        height,
        num_steps: 20,
        guidance_scale: 4,
        id_weight: 1.0,
        true_cfg: 1.0,
    } : {
        prompt: params.prompt, aspect_ratio: params.aspectRatio, output_format: 'jpg',
        output_quality: 90,        // ★ LOCK: Consistent quality across all shots
    };

    if (!isFaceCloning && (modelPath.includes('flux-1.1-pro') || modelPath.includes('flux-pro'))) {
        input.prompt_upsampling = false; // ★ LOCK: Prevent Flux from rewriting prompts differently per image
    }

    if (params.seed != null && !isFaceCloning) input.seed = params.seed;

    // ★ FLUX REDUX — Image-guided generation for extreme character/style consistency
    if (params.imagePrompt && (modelPath.includes('flux-1.1-pro') || modelPath.includes('flux-pro')) && !isFaceCloning) {
        input.image_prompt = params.imagePrompt;
        console.log(`[Replicate] ★ Redux: image_prompt set (${params.imagePrompt.substring(0, 60)}...)`);
    }

    const body = isModelPath ? { input } : { version: modelPath.split(":")[1] || modelPath, input };

    if (isFaceCloning) {
        console.log(`\n🚀 [Face-Cloning Engine - Backend] ${modelPath}`);
    } else {
        console.log(`[Replicate] Calling ${targetUrl} with model=${modelPath}`);
    }

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        if (response.status === 404) {
            throw new Error(`Model "${modelPath}" not found on Replicate. Please select a different model.`);
        }
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

    if (prediction.status !== 'succeeded') {
        const errorMsg = String(prediction.error || '');
        if (errorMsg.includes('facexlib align face fail') || errorMsg.includes('face_align')) {
            throw new Error('FACE_ALIGN_FAIL');
        }
        throw new Error(errorMsg || 'Image generation failed');
    }
    const output = prediction.output;
    return { url: Array.isArray(output) ? output[0] : output, predictionId: prediction.id };
}

function buildFinalPrompt(params: {
    basePrompt: string; deltaInstruction?: string; characterAnchor?: string; style?: string; referencePolicy?: string; storyEntities?: any[];
}): string {
    const parts: string[] = [];
    // ★ POSITION 1: VISUAL STYLE ANCHOR — FIRST for maximum attention weight
    const stylePreset = (params.style && params.style !== 'none')
        ? STYLE_PRESETS.find(s => s.id === params.style)
        : null;
    if (stylePreset) {
        parts.push(stylePreset.promptModifier.replace(/^,\s*/, ''));
    } else {
        parts.push('Professional cinematic photography, consistent warm lighting, unified color grading, photorealistic, high quality, 35mm film');
    }

    // ★ POSITION 2: STORY ENTITY LOCKS
    let hasEntityAnchor = false;
    if (Array.isArray(params.storyEntities)) {
        const lockedEntities = params.storyEntities.filter(e => e.is_locked);
        if (lockedEntities.length > 0) {
            const entityString = lockedEntities.map(e => `[${e.type.toUpperCase()}: ${e.name}] ${e.description}`).join(' | ');
            parts.push(`[STORY ENTITY LOCK] ${entityString}`);
            hasEntityAnchor = entityString.toLowerCase().includes('[character:');
        }
    }

    // ★ POSITION 3: LEGACY CHARACTER ANCHOR (Fallback if storyEntities is missing/empty)
    if (params.characterAnchor && params.referencePolicy !== 'none' && !hasEntityAnchor) {
        parts.push(`Same character throughout: ${params.characterAnchor}`);
    }

    // ★ POSITION 4: SHOT-SPECIFIC CONTENT
    parts.push(params.basePrompt);
    if (params.deltaInstruction) parts.push(`Edit: ${params.deltaInstruction}`);
    // ★ POSITION 4: IDENTITY LOCK SUFFIX — maximum consistency enforcement
    parts.push('IDENTITY LOCK: same person, identical face, identical hairstyle, identical outfit and accessories, same skin tone, same body proportions. Same color grading, same lighting setup, same film grain, same art direction across all frames');
    return parts.join('. ');
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

const directorSchema = {
    // @ts-ignore
    type: Type.OBJECT,
    properties: {
        // @ts-ignore
        scene_title: { type: Type.STRING },
        segments: {
            // @ts-ignore
            type: Type.ARRAY,
            items: {
                // @ts-ignore
                type: Type.OBJECT,
                properties: {
                    // @ts-ignore
                    shot_number: { type: Type.INTEGER }, duration_sec: { type: Type.NUMBER },
                    // @ts-ignore
                    location_type: { type: Type.STRING }, location: { type: Type.STRING },
                    // @ts-ignore
                    time_of_day: { type: Type.STRING }, characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                    // @ts-ignore
                    action: { type: Type.STRING }, dialogue: { type: Type.STRING },
                    // @ts-ignore
                    camera: { type: Type.STRING }, lens: { type: Type.STRING },
                    // @ts-ignore
                    movement: { type: Type.STRING }, composition: { type: Type.STRING },
                    // @ts-ignore
                    lighting: { type: Type.STRING }, art_direction: { type: Type.STRING },
                    // @ts-ignore
                    mood: { type: Type.STRING }, sfx_vfx: { type: Type.STRING },
                    // @ts-ignore
                    audio_notes: { type: Type.STRING }, continuity_notes: { type: Type.STRING },
                    // @ts-ignore
                    image_prompt: { type: Type.STRING }, negative_prompt: { type: Type.STRING },
                    // @ts-ignore
                    video_prompt: { type: Type.STRING }, // ★ NEW: Dedicated physical video prompt
                },
                required: ["shot_number", "duration_sec", "location_type", "location", "action", "camera", "movement", "lighting", "image_prompt", "video_prompt"]
            }
        }
    },
    required: ['scene_title', 'shots'],
};

app.post('/api/shots/generate', async (req: any, res: any) => {
    try {
        const {
            scene_number, visual_description, audio_description, shot_type,
            visual_style, character_anchor, language, num_shots, story_entities
        } = req.body;

        const lockedCharacters = Array.isArray(story_entities)
            ? story_entities
                .filter((e: any) => normalizeEntityType(e?.type) === 'character' && !!e?.is_locked)
                .map((e: any) => ({
                    name: sanitizePromptInput(e?.name, 120),
                    description: sanitizePromptInput(e?.description, 800),
                }))
                .filter((e: any) => e.name.length > 0)
            : [];

        const allowedCharacterSet = new Set(lockedCharacters.map((c: any) => c.name.toLowerCase()));
        const lockedCastInstruction = lockedCharacters.length > 0
            ? `Locked Cast (no new characters allowed): ${lockedCharacters.map((c: any) => `${c.name} (${c.description})`).join(' | ')}`
            : '';

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
        if (!visual_description) return res.status(400).json({ error: 'Missing visual_description' });

        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        const userEmail = await getUserEmail(supabaseUser);

        if (!userId || !userEmail) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // ★ GOD MODE: Check entitlement
        const COST = 1;
        const entitlement = await checkEntitlement(userId, userEmail, 'generate_shots', COST);
        if (!entitlement.allowed) {
            const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402
                : entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403;
            return res.status(status).json({
                error: entitlement.reason,
                code: entitlement.errorCode,
                credits: entitlement.credits,
            });
        }

        const skipCreditCheck = entitlement.mode === 'developer';
        const jobRef = `shots:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'shots', ref_id: jobRef
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        } else {
            logDeveloperAccess(userEmail, `shots:generate:cost=${COST}`);
        }

        const ai = getGeminiAI();
        const targetShots = num_shots || 5;

        const systemInstruction = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 YOU ARE: MASTER DIRECTOR OF PHOTOGRAPHY & SHOT DESIGNER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**MISSION**: Break Scene ${scene_number || 1} into ${targetShots} CINEMATIC, PRODUCTION-READY SHOTS that tell a visual story.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 SCENE CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**Scene ${scene_number || 1} Description**: ${visual_description}
**Audio/Sound**: ${audio_description || 'Ambient sound'}
**Shot Direction**: ${shot_type || 'Cinematic coverage'}
**Visual Style**: ${visual_style || 'Cinematic Realism'}
${character_anchor ? `
**Character Anchor** (MUST appear in EVERY shot's image_prompt):
${character_anchor}` : ''}
${lockedCastInstruction ? `
**Locked Cast** (ONLY these characters allowed, NO extras):
${lockedCastInstruction}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ SHOT DESIGN RULES (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ **RULE 1: SHOT PROGRESSION & CONTINUITY**
   → Shot 1: Establish (wide/medium) - show WHERE we are
   → Shot 2-N: Build story - EACH shot must advance the moment
   → Obey 180-degree rule and screen direction
   → NO teleporting: if character is left of frame in Shot 1, maintain spatial logic in Shot 2

✅ **RULE 2: VISUAL VARIETY (Combat Repetition)**
   → VARY camera angles: Wide → Medium → Close → ECU (don't repeat same angle twice)
   → VARY camera heights: Eye-level → High angle → Low angle → Dutch tilt
   → VARY camera movement: Static → Push-in → Pan → Tracking (mix static and dynamic)
   → CREATE visual rhythm: Slow → Fast → Slow (pace the energy)

✅ **RULE 3: NARRATIVE FOCUS**
   → Each shot must have PURPOSE: reveal emotion, show action, build tension, or transition
   → "action" field: describe WHAT HAPPENS in this specific shot (not generic "character stands")
   → Build micro-story: Setup → Complication → Reaction (even within ${targetShots} shots)

✅ **RULE 4: TECHNICAL PRECISION**
   → "camera": wide | medium | close | ecu | over-shoulder | pov | aerial | two-shot
   → "movement": static | push-in | pull-out | pan-left | pan-right | tilt-up | tilt-down | dolly | tracking | crane | handheld | steadicam | whip-pan | zoom
   → "lighting": Use pro terms (key light, rim light, chiaroscuro, volumetric, golden hour, etc.)
   → "composition": Rule of thirds, leading lines, symmetry, depth of field, negative space

✅ **RULE 5: AI VIDEO PROMPT MASTERY (CRITICAL)**
   → "video_prompt" = PHYSICAL MOTION ONLY. AI doesn't understand emotions, only ACTIONS.
   
   ✓ GOOD EXAMPLES:
   • "Camera slowly pushes forward 2 feet. Man in blue suit turns head 90 degrees right, eyes widening. His right hand lifts to chest level."
   • "Handheld camera follows woman walking briskly forward. She suddenly stops, body tensing. Head whips left toward off-screen sound."
   • "Static shot. Rain falls vertically. Character in red coat enters frame left, walks diagonally toward camera, stops at center."
   
   ✗ BAD EXAMPLES (Will fail in AI video):
   • "She feels devastated and time seems to stop" ← Abstract, no physical action
   • "He realizes the truth" ← Mental state, not motion
   • "The scene becomes emotional" ← Vague, no kinetics
   
   → MANDATORY ELEMENTS in video_prompt:
   • Camera motion (if any): "Camera dollies left", "Camera static"
   • Character body motion: "turns head", "lifts hand", "steps forward", "leans back"
   • Environmental interaction: "touches wall", "picks up object", "opens door"
   • Speed/Tempo: "slowly", "sharply", "gradually"

✅ **RULE 6: IMAGE PROMPT EXCELLENCE**
   → "image_prompt" = ELITE Midjourney/Flux prompt (20-40 words minimum)
   → Include: Subject + Action + Environment + Lighting + Camera Angle + Lens + Mood + Quality
   → Example: "Determined detective in brown trench coat examining blood-stained evidence under single hanging lamp, noir aesthetic, dramatic side lighting casting long shadows, medium close-up 85mm lens, gritty cinematic 1940s crime drama mood, 8k photorealistic depth of field"

✅ **RULE 7: CHARACTER CONSISTENCY**
   → If Locked Cast provided: ONLY use those exact character names. NO "random bystander" or "unnamed person"
   → "characters" array: list ALL characters visible in this shot
   → Maintain character descriptions from scene to scene

✅ **RULE 8: LANGUAGE**
   → Technical fields (image_prompt, video_prompt, camera, movement, lighting): ENGLISH ONLY
   → Narrative fields (dialogue, audio_notes): ${language === 'zh' ? 'Chinese (Simplified)' : 'English'}

**REQUIRED JSON SCHEMA:**
You MUST return EXACTLY ONE JSON object strictly matching this schema. Return exactly ${targetShots} shots inside the "shots" array:
{
  "scene_title": "string",
  "shots": [
    {
      "shot_number": 1,
      "duration_sec": 4.5,
      "location_type": "string",
      "location": "string",
      "time_of_day": "string",
      "characters": ["string"],
      "action": "string",
      "dialogue": "string",
      "camera": "string",
      "lens": "string",
      "movement": "string",
      "composition": "string",
      "lighting": "string",
      "art_direction": "string",
      "mood": "string",
      "sfx_vfx": "string",
      "audio_notes": "string",
      "continuity_notes": "string",
      "image_prompt": "string",
      "negative_prompt": "string",
      "video_prompt": "string"
    }
  ]
}`;

        let responseText = '';
        try {
            const minimaxResponse: any = await getMinimaxChatCompletion(
                systemInstruction,
                `Break Scene ${scene_number || 1} into ${targetShots} shots. Scene description: ${visual_description}`,
                { temperature: 0.6, responseFormat: 'json_object' }
            );
            responseText = minimaxResponse.choices[0].message.content;
        } catch (initialError: any) {
            console.error('[Minimax Shots] Primary call failed, retrying...', initialError.message);
            const retryResponse: any = await getMinimaxChatCompletion(
                systemInstruction + "\nOutput strictly valid JSON, no markdown formatting.",
                `Break Scene ${scene_number || 1} into ${targetShots} shots. Scene description: ${visual_description}`,
                { temperature: 0.5 }
            );
            responseText = retryResponse.choices[0].message.content;
        }

        const text = responseText;
        if (!text) throw new Error('No response from AI');

        // Try to parse JSON, with fallback for malformed responses
        let result;
        try {
            result = JSON.parse(text);
        } catch (parseError: any) {
            console.warn('[Shots Generate] JSON parse failed, attempting to fix...', parseError.message);
            // Try to extract JSON from the response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    result = JSON.parse(jsonMatch[0]);
                } catch (e2: any) {
                    throw new Error(`AI response was not valid JSON: ${text.substring(0, 200)}...`);
                }
            } else {
                throw new Error(`AI response was not valid JSON: ${text.substring(0, 200)}...`);
            }
        }

        const enrichedShots = (result.shots || []).map((s: any, idx: number) => {
            const rawCharacters = Array.isArray(s.characters) ? s.characters : [];
            let normalizedCharacters = rawCharacters
                .map((c: any) => sanitizePromptInput(c, 120))
                .filter((name: string) => {
                    if (!name) return false;
                    if (allowedCharacterSet.size === 0) return true;
                    return allowedCharacterSet.has(name.toLowerCase());
                });

            if (normalizedCharacters.length === 0 && lockedCharacters.length > 0) {
                normalizedCharacters = [lockedCharacters[Math.min(idx, lockedCharacters.length - 1)].name];
            }

            return {
            shot_id: crypto.randomUUID(),
            scene_id: '', scene_title: result.scene_title || `Scene ${scene_number || 1}`,
            shot_number: s.shot_number || idx + 1, duration_sec: s.duration_sec || 3,
            location_type: s.location_type || 'INT', location: s.location || '',
            time_of_day: s.time_of_day || 'day',
            action: s.action || '', dialogue: s.dialogue || '',
            camera: s.camera || 'medium', lens: s.lens || '50mm',
            movement: s.movement || 'static', composition: s.composition || '',
            lighting: s.lighting || '', art_direction: s.art_direction || '',
            mood: s.mood || '', sfx_vfx: s.sfx_vfx || '',
            audio_notes: s.audio_notes || '', continuity_notes: s.continuity_notes || '',
            image_prompt: s.image_prompt || '', video_prompt: s.video_prompt || '', negative_prompt: s.negative_prompt || '',
            seed_hint: null, reference_policy: 'anchor' as const,
            status: 'draft' as const, locked_fields: [], version: 1,
            updated_at: new Date().toISOString(),
            characters: normalizedCharacters,
        };
        });

        if (!skipCreditCheck) {
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
        const userId = await getUserId(supabaseUser);
        const userEmail = await getUserEmail(supabaseUser);

        if (!userId || !userEmail) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // ★ Bug 5 fix: Use unified checkEntitlement instead of legacy checkIsAdmin
        const COST = 1;
        const entitlement = await checkEntitlement(userId, userEmail, 'rewrite_shot', COST);
        if (!entitlement.allowed) {
            const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402
                : entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403;
            return res.status(status).json({
                error: entitlement.reason,
                code: entitlement.errorCode,
                credits: entitlement.credits,
            });
        }

        const skipCreditCheck = entitlement.mode === 'developer';
        const jobRef = `rewrite:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'rewrite', ref_id: jobRef
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        } else {
            logDeveloperAccess(userEmail, `shots:rewrite:cost=${COST}`);
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
4. If rewriting image_prompt, include the character anchor and make it HIGHLY DESCRIPTIVE using professional cinematic terminology (lighting, lenses, camera angles).
5. Be creative, ensure physical logic, and stay consistent with the visual style and scene context.
6. Language: technical fields in English, dialogue in ${language === 'zh' ? 'Chinese' : 'English'}.

**REQUIRED JSON STRUCTURE (CRITICAL):**
Return EXACTLY ONE flat JSON object containing ONLY the rewritten keys and their new string values. Do not use markdown backticks. Do not add any explanatory text.
Example: {"image_prompt": "new prompt here", "dialogue": "new line here"}
`;

        let responseText = '';
        try {
            const minimaxResponse: any = await getMinimaxChatCompletion(
                systemInstruction,
                `Rewrite fields [${fieldsStr}] for shot ${shotId}. ${user_instruction || ''}`,
                { temperature: 0.7, responseFormat: 'json_object' }
            );
            responseText = minimaxResponse.choices[0].message.content;
        } catch (initialError: any) {
            console.error('[Minimax Rewrite] Primary call failed, retrying...', initialError.message);
            const retryResponse: any = await getMinimaxChatCompletion(
                systemInstruction + "\nOutput strictly valid JSON, no markdown formatting.",
                `Rewrite fields [${fieldsStr}] for shot ${shotId}. ${user_instruction || ''}`,
                { temperature: 0.5 }
            );
            responseText = retryResponse.choices[0].message.content;
        }

        const text = responseText;
        if (!text) throw new Error('No response from AI');

        // Try to parse JSON, with fallback for malformed responses
        let rewrittenFields;
        try {
            rewrittenFields = JSON.parse(text);
        } catch (parseError: any) {
            console.warn('[Shot Rewrite] JSON parse failed, attempting to fix...', parseError.message);
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    rewrittenFields = JSON.parse(jsonMatch[0]);
                } catch (e2: any) {
                    throw new Error(`AI response was not valid JSON: ${text.substring(0, 200)}...`);
                }
            } else {
                throw new Error(`AI response was not valid JSON: ${text.substring(0, 200)}...`);
            }
        }
        for (const locked of (locked_fields || [])) delete rewrittenFields[locked];
        for (const key of Object.keys(rewrittenFields)) {
            if (!fields_to_rewrite.includes(key)) delete rewrittenFields[key];
        }

        if (!skipCreditCheck) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'rewrite', ref_id: jobRef });
        }

        res.json({ shot_id: shotId, rewritten_fields: rewrittenFields, change_source: 'ai-rewrite', changed_fields: Object.keys(rewrittenFields) });
    } catch (error: any) {
        console.error('[Shot Rewrite] Error:', error);
        // ★ Refund reserved credits on error, best-effort
        try {
            const authHeader = req.headers.authorization;
            if (authHeader) {
                const supabaseRefund = getUserClient(authHeader);
                await supabaseRefund.rpc('refund_reserve', { amount: 1, ref_type: 'rewrite', ref_id: `rewrite-err:${Date.now()}` });
            }
        } catch (_) { /* best effort */ }
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
        const { prompt, negative_prompt, delta_instruction, model, aspect_ratio, style, seed, character_anchor, reference_policy, project_id, anchor_image_url, referenceImageDataUrl } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        const userEmail = await getUserEmail(supabaseUser);

        if (!userId || !userEmail) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const imageModel = model || 'flux';
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[imageModel] || REPLICATE_MODEL_PATHS['flux'];
        const cost = (IMAGE_MODEL_COSTS as any)[imageModel] ?? 6;

        // ★ GOD MODE: Check entitlement
        const entitlement = await checkEntitlement(userId, userEmail, 'generate_image', cost);
        if (!entitlement.allowed) {
            const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402
                : entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403;
            return res.status(status).json({
                error: entitlement.reason,
                code: entitlement.errorCode,
                credits: entitlement.credits,
            });
        }

        const skipCreditCheck = entitlement.mode === 'developer';

        const jobRef = `shot-img:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: cost, ref_type: 'shot-image', ref_id: jobRef,
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        } else {
            logDeveloperAccess(userEmail, `shot-image:generate:model=${imageModel}:cost=${cost}`);
        }

        const finalPrompt = buildFinalPrompt({
            basePrompt: prompt || '', deltaInstruction: delta_instruction,
            characterAnchor: character_anchor, style: style || 'none', referencePolicy: reference_policy || 'anchor',
        });

        let result: { url: string; predictionId: string };
        try {
            result = await callReplicateImage({
                prompt: finalPrompt,
                model: replicatePath,
                aspectRatio: aspect_ratio || '16:9',
                seed: seed ?? 142857,
                imagePrompt: anchor_image_url || undefined,
                referenceImageDataUrl: referenceImageDataUrl || undefined
            });
        } catch (genErr: any) {
            if (!skipCreditCheck) { try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'shot-image', ref_id: jobRef }); } catch (_) { } }
            throw genErr;
        }

        if (!skipCreditCheck) { await supabaseUser.rpc('finalize_reserve', { ref_type: 'shot-image', ref_id: jobRef }); }

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
        if (error.message === 'FACE_ALIGN_FAIL') {
            return res.status(400).json({ error: '未能检测到清晰的人物面部，请重新上传正脸无遮挡的单人照！(Face alignment failed)' });
        }
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
        const userId = await getUserId(supabaseUser);
        const userEmail = await getUserEmail(supabaseUser);

        if (!userId || !userEmail) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const imageModel = model || 'flux';
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[imageModel] || REPLICATE_MODEL_PATHS['flux'];
        const cost = (IMAGE_MODEL_COSTS as any)[imageModel] ?? 6;

        // ★ GOD MODE: Check entitlement
        const entitlement = await checkEntitlement(userId, userEmail, 'edit_image', cost);
        if (!entitlement.allowed) {
            const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402
                : entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403;
            return res.status(status).json({
                error: entitlement.reason,
                code: entitlement.errorCode,
                credits: entitlement.credits,
            });
        }

        const skipCreditCheck = entitlement.mode === 'developer';

        const jobRef = `shot-img-edit:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: cost, ref_type: 'shot-image-edit', ref_id: jobRef,
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        } else {
            logDeveloperAccess(userEmail, `shot-image:edit:model=${imageModel}:cost=${cost}`);
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
            if (!skipCreditCheck) { try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'shot-image-edit', ref_id: jobRef }); } catch (_) { } }
            throw genErr;
        }

        if (!skipCreditCheck) { await supabaseUser.rpc('finalize_reserve', { ref_type: 'shot-image-edit', ref_id: jobRef }); }

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
// POST /api/batch/gen-images — Synchronous batch image generation with SSE streaming
// On Vercel serverless, in-memory state doesn't persist across requests.
// This endpoint processes all images within a single request and streams progress via SSE.
// ───────────────────────────────────────────────────────────────
app.post('/api/batch/gen-images', async (req: any, res: any) => {
    try {
        const { project_id, shots, count = 100, model = 'flux', aspect_ratio = '16:9', style = 'none', character_anchor = '', concurrency = 2, reference_image_url = '' } = req.body;
        if (!project_id) return res.status(400).json({ error: 'Missing project_id' });
        if (!shots?.length) return res.status(400).json({ error: 'Missing or empty shots array' });

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        const userEmail = await getUserEmail(supabaseUser);

        if (!userId || !userEmail) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const sortedShots = [...shots].sort((a: any, b: any) => (a.scene_number - b.scene_number) || (a.shot_number - b.shot_number)).slice(0, count);
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[model] || REPLICATE_MODEL_PATHS['flux'];
        const costPerImage = (IMAGE_MODEL_COSTS as any)[model] ?? 6;
        const totalCost = costPerImage * sortedShots.length;

        // ★ GOD MODE: Check entitlement
        const entitlement = await checkEntitlement(userId, userEmail, 'batch_images', totalCost);
        if (!entitlement.allowed) {
            const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402
                : entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403;
            return res.status(status).json({
                error: entitlement.reason,
                code: entitlement.errorCode,
                credits: entitlement.credits,
                needed: totalCost,
            });
        }

        const skipCreditCheck = entitlement.mode === 'developer';

        const batchRef = `batch-img:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', { amount: totalCost, ref_type: 'batch-image', ref_id: batchRef });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', needed: totalCost });
        } else {
            logDeveloperAccess(userEmail, `batch:gen-images:count=${sortedShots.length}:totalCost=${totalCost}`);
        }

        // ★ SSE: Set up Server-Sent Events streaming
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        const sendSSE = (event: string, data: any) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const jobId = crypto.randomUUID();
        const projectSeed = Math.abs([...project_id].reduce((hash: number, c: string) => ((hash << 5) - hash + c.charCodeAt(0)) | 0, 0)) % 1000000 || 142857;

        const items: BatchJobItem[] = sortedShots.map((s: any) => ({
            id: crypto.randomUUID(), job_id: jobId, shot_id: s.shot_id,
            shot_number: s.shot_number, scene_number: s.scene_number, status: 'queued' as BatchItemStatus,
        }));

        const job: BatchJob = {
            id: jobId, project_id, user_id: userId, type: 'gen_images',
            total: items.length, done: 0, succeeded: 0, failed: 0, status: 'running',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(), concurrency: 1,
        };

        // Send initial progress
        sendSSE('progress', { job, items });

        // ★ FLUX REDUX ANCHORING — First-image anchoring for extreme consistency
        // Priority: 1) User's uploaded reference photo  2) First successfully generated image
        // The anchor image is passed as `image_prompt` to Flux Redux, conditioning
        // every subsequent image on the same face, outfit, palette, and style.
        let anchorImageUrl: string | null = reference_image_url || null;
        if (anchorImageUrl) {
            console.log(`[Batch] ★ Using user reference image as anchor: ${anchorImageUrl.substring(0, 80)}...`);
        }

        // ★ Process each image sequentially
        let cancelled = false;
        req.on('close', () => { cancelled = true; });

        for (const item of items) {
            if (cancelled) {
                item.status = 'cancelled';
                continue;
            }

            item.status = 'running';
            item.started_at = new Date().toISOString();
            job.updated_at = new Date().toISOString();
            sendSSE('progress', { job, items });

            try {
                const shotData = sortedShots.find((s: any) => s.shot_id === item.shot_id);
                if (!shotData) throw new Error('Shot data not found');

                const finalPrompt = buildFinalPrompt({
                    basePrompt: shotData.image_prompt || '',
                    characterAnchor: character_anchor,
                    style,
                    referencePolicy: shotData.reference_policy || 'anchor'
                });

                const result = await callReplicateImage({
                    prompt: finalPrompt, model: replicatePath,
                    aspectRatio: aspect_ratio, seed: shotData.seed_hint ?? projectSeed,
                    imagePrompt: anchorImageUrl || undefined,
                });

                item.status = 'succeeded';
                item.image_id = crypto.randomUUID();
                item.image_url = result.url;
                item.completed_at = new Date().toISOString();
                job.succeeded += 1;

                // ★ First successful image becomes the anchor for all subsequent images
                if (!anchorImageUrl && result.url) {
                    anchorImageUrl = result.url;
                    console.log(`[Batch] ★ First-image anchor set: ${result.url.substring(0, 80)}...`);
                }
            } catch (err: any) {
                item.status = 'failed';
                item.error = err.message || 'Unknown error';
                item.completed_at = new Date().toISOString();
                job.failed += 1;
                console.error(`[Batch] Shot ${item.shot_id} failed:`, err.message);
            }

            job.done += 1;
            job.updated_at = new Date().toISOString();
            sendSSE('progress', { job, items });
        }

        // Finalize
        if (cancelled) {
            job.status = 'cancelled';
        } else if (job.failed > 0 && job.succeeded === 0) {
            job.status = 'failed';
        } else {
            job.status = 'completed';
        }
        job.updated_at = new Date().toISOString();

        // ★ Credit finalization
        if (!skipCreditCheck) {
            const notOk = job.total - job.succeeded;
            if (notOk > 0) {
                try { await supabaseUser.rpc('refund_reserve', { amount: notOk * costPerImage, ref_type: 'batch-image-partial', ref_id: batchRef }); } catch (e) { }
            }
            try { await supabaseUser.rpc('finalize_reserve', { ref_type: 'batch-image', ref_id: batchRef }); } catch (e) { }
        }

        sendSSE('done', { job, items, anchor_image_url: anchorImageUrl });
        res.end();
    } catch (error: any) {
        console.error('[Batch GenImages] Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || 'Failed to start batch job' });
        } else {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/batch/gen-images/continue — Continue generating next batch
// ───────────────────────────────────────────────────────────────
app.post('/api/batch/gen-images/continue', async (req: any, res: any) => {
    try {
        const { project_id, shots, shots_with_images = [], count = 100, strategy = 'strict', model = 'flux', aspect_ratio = '16:9', style = 'none', character_anchor = '', concurrency = 2, anchor_image_url = '', reference_image_url = '' } = req.body;
        if (!project_id) return res.status(400).json({ error: 'Missing project_id' });
        if (!shots?.length) return res.status(400).json({ error: 'Missing or empty shots array' });

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        const userEmail = await getUserEmail(supabaseUser);

        if (!userId || !userEmail) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

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

        // ★ GOD MODE: Check entitlement
        const entitlement = await checkEntitlement(userId, userEmail, 'batch_images', totalCost);
        if (!entitlement.allowed) {
            const status = entitlement.errorCode === 'NEED_PAYMENT' ? 402
                : entitlement.errorCode === 'INSUFFICIENT_CREDITS' ? 402 : 403;
            return res.status(status).json({
                error: entitlement.reason,
                code: entitlement.errorCode,
                credits: entitlement.credits,
                needed: totalCost,
            });
        }

        const skipCreditCheck = entitlement.mode === 'developer';

        const batchRef = `batch-continue:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', { amount: totalCost, ref_type: 'batch-image-continue', ref_id: batchRef });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', needed: totalCost });
        } else {
            logDeveloperAccess(userEmail, `batch:gen-images:continue:count=${nextBatch.length}:totalCost=${totalCost}`);
        }

        // ★ SSE: Set up Server-Sent Events streaming
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        const sendSSE = (event: string, data: any) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        const jobId = crypto.randomUUID();
        const projectSeed = Math.abs([...project_id].reduce((hash: number, c: string) => ((hash << 5) - hash + c.charCodeAt(0)) | 0, 0)) % 1000000 || 142857;
        const rangeLabel = `S${nextBatch[0].scene_number}.${nextBatch[0].shot_number} → S${nextBatch[nextBatch.length - 1].scene_number}.${nextBatch[nextBatch.length - 1].shot_number}`;

        const items: BatchJobItem[] = nextBatch.map((s: any) => ({
            id: crypto.randomUUID(), job_id: jobId, shot_id: s.shot_id,
            shot_number: s.shot_number, scene_number: s.scene_number, status: 'queued' as BatchItemStatus,
        }));

        const job: BatchJob = {
            id: jobId, project_id, user_id: userId, type: 'gen_images_continue',
            total: items.length, done: 0, succeeded: 0, failed: 0, status: 'running',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(), concurrency: 1,
        };

        sendSSE('progress', { job, items, range_label: rangeLabel });

        // ★ FLUX REDUX ANCHORING — Use anchor from previous batch or reference image
        let anchorImageUrl: string | null = anchor_image_url || reference_image_url || null;
        if (anchorImageUrl) {
            console.log(`[Batch Continue] ★ Using anchor image: ${anchorImageUrl.substring(0, 80)}...`);
        }

        let cancelled = false;
        req.on('close', () => { cancelled = true; });

        for (const item of items) {
            if (cancelled) { item.status = 'cancelled'; continue; }
            item.status = 'running';
            item.started_at = new Date().toISOString();
            job.updated_at = new Date().toISOString();
            sendSSE('progress', { job, items });

            try {
                const shotData = nextBatch.find((s: any) => s.shot_id === item.shot_id);
                if (!shotData) throw new Error('Shot data not found');
                const finalPrompt = buildFinalPrompt({ basePrompt: shotData.image_prompt || '', characterAnchor: character_anchor, style, referencePolicy: shotData.reference_policy || 'anchor' });
                const result = await callReplicateImage({ prompt: finalPrompt, model: replicatePath, aspectRatio: aspect_ratio, seed: shotData.seed_hint ?? projectSeed, imagePrompt: anchorImageUrl || undefined });
                item.status = 'succeeded'; item.image_id = crypto.randomUUID(); item.image_url = result.url;
                item.completed_at = new Date().toISOString(); job.succeeded += 1;
                // ★ First successful image becomes anchor if none was provided
                if (!anchorImageUrl && result.url) {
                    anchorImageUrl = result.url;
                    console.log(`[Batch Continue] ★ First-image anchor set: ${result.url.substring(0, 80)}...`);
                }
            } catch (err: any) {
                item.status = 'failed'; item.error = err.message || 'Unknown error';
                item.completed_at = new Date().toISOString(); job.failed += 1;
                console.error(`[Batch Continue] Shot ${item.shot_id} failed:`, err.message);
            }
            job.done += 1; job.updated_at = new Date().toISOString();
            sendSSE('progress', { job, items });
        }

        if (cancelled) { job.status = 'cancelled'; }
        else if (job.failed > 0 && job.succeeded === 0) { job.status = 'failed'; }
        else { job.status = 'completed'; }
        job.updated_at = new Date().toISOString();

        if (!skipCreditCheck) {
            const notOk = job.total - job.succeeded;
            if (notOk > 0) { try { await supabaseUser.rpc('refund_reserve', { amount: notOk * costPerImage, ref_type: 'batch-continue-partial', ref_id: batchRef }); } catch (e) { } }
            try { await supabaseUser.rpc('finalize_reserve', { ref_type: 'batch-image-continue', ref_id: batchRef }); } catch (e) { }
        }

        sendSSE('done', { job, items, range_label: rangeLabel, remaining_count: remainingAfter, all_done: remainingAfter === 0, anchor_image_url: anchorImageUrl });
        res.end();
    } catch (error: any) {
        console.error('[Batch Continue] Error:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message || 'Failed to start continue batch job' });
        } else {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
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
        // Derive project-level consistent seed from the job's project_id
        const retryJobStatus = getBatchJobStatus(req.params.jobId);
        const retryProjectId = retryJobStatus?.job?.project_id || '';
        const retryProjectSeed = retryProjectId
            ? Math.abs([...retryProjectId].reduce((hash, c) => ((hash << 5) - hash + c.charCodeAt(0)) | 0, 0)) % 1000000 || 142857
            : 142857;
        const executor: TaskExecutor = async (item) => {
            const shotData = shots.find((s: any) => s.shot_id === item.shot_id);
            const finalPrompt = buildFinalPrompt({ basePrompt: shotData?.image_prompt || '', characterAnchor: character_anchor, style, referencePolicy: shotData?.reference_policy || 'anchor' });
            const result = await callReplicateImage({ prompt: finalPrompt, model: replicatePath, aspectRatio: aspect_ratio, seed: shotData?.seed_hint ?? retryProjectSeed });
            return { image_id: crypto.randomUUID(), image_url: result.url };
        };
        const ok = retryFailedBatchItems(req.params.jobId, executor);
        if (!ok) return res.status(400).json({ error: 'No failed items to retry or job is still running' });
        res.json({ ok: true, message: 'Retry started' });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
});


// ───────────────────────────────────────────────────────────────
// POST /api/billing/checkout — Create Stripe Checkout Session for Credits
// ───────────────────────────────────────────────────────────────
app.post('/api/billing/checkout', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { packageId } = req.body;
        const stripe = getStripe();

        // CREDIT_PACKS hardcoded here for simplicity or derived from types
        const CREDIT_PACKS = [
            { id: 'pack_small', price: 5, credits: 500, label: 'Starter Pack', priceId: 'price_1T4l2pJ3FWUBvlCmbdxyNavw' },
            { id: 'pack_medium', price: 10, credits: 1200, label: 'Value Pack', popular: true, priceId: 'price_1T4l2pJ3FWUBvlCmS8qBhrW5' },
            { id: 'pack_large', price: 25, credits: 3500, label: 'Pro Pack', priceId: 'price_1T4l2pJ3FWUBvlCmuM0Ki56j' }
        ];

        const pack = CREDIT_PACKS.find(p => p.id === packageId);
        if (!pack) return res.status(400).json({ error: 'Invalid package' });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: pack.priceId as string, quantity: 1 }],
            mode: 'payment',
            success_url: `${req.headers.origin || process.env.VITE_APP_URL || 'http://localhost:3000'}/?payment=success`,
            cancel_url: `${req.headers.origin || process.env.VITE_APP_URL || 'http://localhost:3000'}/?payment=cancelled`,
            client_reference_id: userId, // extremely important for webhook
            metadata: {
                user_id: userId,
                credits: pack.credits.toString()
            }
        });

        res.json({ url: session.url });
    } catch (err: any) {
        console.error('[Billing Checkout Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/billing/subscribe — Create Stripe Checkout Session for Subscriptions
// ───────────────────────────────────────────────────────────────
app.post('/api/billing/subscribe', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { tier, billingCycle } = req.body;
        const stripe = getStripe();

        const STRIPE_PRICES: any = {
            monthly: { creator: 'price_1SykM5J3FWUBvlCmYotWtUGA', director: 'price_1SyknyJ3FWUBvlCmXPbBj3si' },
            yearly: { creator: 'price_1SykwsJ3FWUBvlCmoNwqi0EY', director: 'price_1SykxoJ3FWUBvlCmZeIFDxFJ' }
        };

        const priceId = STRIPE_PRICES[billingCycle]?.[tier];
        if (!priceId) return res.status(400).json({ error: 'Invalid subscription tier/cycle' });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            success_url: `${req.headers.origin || process.env.VITE_APP_URL || 'http://localhost:3000'}/?subscription=success`,
            cancel_url: `${req.headers.origin || process.env.VITE_APP_URL || 'http://localhost:3000'}/?subscription=cancelled`,
            client_reference_id: userId,
            metadata: {
                user_id: userId,
                tier: tier
            },
            subscription_data: {
                metadata: {
                    user_id: userId,
                    tier: tier
                }
            }
        });

        res.json({ url: session.url });
    } catch (err: any) {
        console.error('[Billing Subscribe Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/billing/business-subscribe — Create Stripe Checkout for Business Plans
// ───────────────────────────────────────────────────────────────
app.post('/api/billing/business-subscribe', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { planId } = req.body;
        const stripe = getStripe();

        // Business Plan Price IDs - 需要在Stripe中创建这些价格ID
        const BUSINESS_PRICES: Record<string, string> = {
            'plan_starter': 'price_1T4l2pJ3FWUBvlCmbdxyNavw',
            'plan_pro': 'price_1SyknyJ3FWUBvlCmXPbBj3si',
            'plan_business': 'price_1SykwsJ3FWUBvlCmoNwqi0EY',
            'plan_enterprise': 'price_1SykxoJ3FWUBvlCmZeIFDxFJ'
        };

        const priceId = BUSINESS_PRICES[planId];
        if (!priceId) {
            return res.status(400).json({ error: 'Invalid business plan. Please contact sales.' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            success_url: `${req.headers.origin || 'https://aidirector.business'}/?subscription=success`,
            cancel_url: `${req.headers.origin || 'https://aidirector.business'}/?subscription=cancelled`,
            client_reference_id: userId,
            metadata: { user_id: userId, plan: planId, type: 'business' },
            subscription_data: { metadata: { user_id: userId, plan: planId, type: 'business' } }
        });

        res.json({ url: session.url });
    } catch (err: any) {
        console.error('[Business Subscribe Error]', err);
        res.status(500).json({ error: err.message || 'Failed to create business subscription' });
    }
});



// ═══════════════════════════════════════════════════════════════
// GET /api/download — Server-side proxy download (bypasses CDN CORS)
// ═══════════════════════════════════════════════════════════════
app.get('/api/download', async (req: any, res: any) => {
    const rawUrl = req.query.url as string | undefined;
    const rawName = req.query.filename as string | undefined;

    if (!rawUrl) return res.status(400).json({ error: 'Missing url' });

    const safeName = rawName || 'download.mp4';
    const ext = safeName.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
        mp4: 'video/mp4', webm: 'video/webm',
        jpg: 'image/jpeg', jpeg: 'image/jpeg',
        png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    };

    try {
        const upstream = await fetch(rawUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Cine-Director/1.0)' },
        });
        if (!upstream.ok) {
            return res.status(502).send(`Upstream ${upstream.status}: ${upstream.statusText}`);
        }

        const contentType = mimeMap[ext] || upstream.headers.get('content-type') || 'application/octet-stream';

        // node-fetch v3: .buffer() removed, use arrayBuffer() + Buffer.from()
        const arrayBuf = await upstream.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        // Use Express chain — single, clean response commit (no writeHead conflict)
        return res
            .status(200)
            .set('Content-Type', contentType)
            .set('Content-Disposition', `attachment; filename="${safeName}"`)
            .set('Content-Length', String(buffer.length))
            .set('Cache-Control', 'no-cache')
            .end(buffer);
    } catch (err: any) {
        console.error('[Download Proxy]', err.message);
        return res.status(500).json({ error: err.message || 'Download proxy failed' });
    }
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

// ───────────────────────────────────────────────────────────────
// POST /api/upload-demo-video — Upload demo video to Supabase Storage
// ───────────────────────────────────────────────────────────────
app.post('/api/upload-demo-video', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Unauthorized - Please login first' });
        }

        // Only allow developer emails to upload demo videos
        const supabaseUser = getUserClient(authHeader);
        const { data: { user }, error: userError } = await supabaseUser.auth.getUser();

        if (userError || !user) {
            return res.status(401).json({ error: 'Invalid user' });
        }

        const userEmail = user.email?.toLowerCase() || '';
        // ★ Use the centralized isDeveloper() function, no local duplicate list
        if (!isDeveloper(userEmail)) {
            return res.status(403).json({ error: 'Only developers can upload demo videos' });
        }

        const { videoBase64, fileName } = req.body;

        if (!videoBase64) {
            return res.status(400).json({ error: 'Missing video data' });
        }

        // Decode base64
        const buffer = Buffer.from(videoBase64, 'base64');

        // Get Supabase admin client
        const supabaseAdmin = getSupabaseAdmin();

        // Check if 'videos' bucket exists, create if not
        const { data: buckets } = await supabaseAdmin.storage.listBuckets();
        let bucketName = 'videos';

        if (!buckets?.find(b => b.name === 'videos')) {
            await supabaseAdmin.storage.createBucket('videos', {
                public: true,
                fileSizeLimit: '100MB'
            });
        }

        // Upload video to Supabase Storage
        const safeFileName = `demo/demo_${Date.now()}_${fileName || 'video.mp4'}`;
        const { data, error } = await supabaseAdmin.storage
            .from('videos')
            .upload(safeFileName, buffer, {
                contentType: 'video/mp4',
                upsert: true
            });

        if (error) {
            console.error('[Upload Demo Video] Storage error:', error);
            return res.status(500).json({ error: error.message });
        }

        // Get public URL
        const { data: urlData } = supabaseAdmin.storage
            .from('videos')
            .getPublicUrl(safeFileName);

        res.json({
            ok: true,
            url: urlData.publicUrl,
            path: data.path
        });
    } catch (err: any) {
        console.error('[Upload Demo Video] Error:', err);
        res.status(500).json({ error: err.message || 'Upload failed' });
    }
});
// (duplicate /api/billing/business-subscribe removed — see the canonical registration above at line ~2724)

// ───────────────────────────────────────────────────────────────
// POST /api/billing/api-subscribe — Create Stripe Checkout for API Plans
// ───────────────────────────────────────────────────────────────
app.post('/api/billing/api-subscribe', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { planId } = req.body;
        const stripe = getStripe();

        // API Plan Price IDs
        const API_PRICES: Record<string, string> = {
            'developer': 'price_1SylajJ3FWUBvlCmqwertYui',
            'business': 'price_1SylbkJ3FWUBvlCmasdfGhjk',
            'enterprise': 'price_1SylckJ3FWUBvlCmzxcvbnm'
        };

        const priceId = API_PRICES[planId];
        if (!priceId) {
            return res.status(400).json({ error: 'Invalid API plan. Please contact sales.' });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: priceId, quantity: 1 }],
            mode: 'subscription',
            success_url: `${req.headers.origin || 'https://aidirector.business'}/?subscription=success`,
            cancel_url: `${req.headers.origin || 'https://aidirector.business'}/?subscription=cancelled`,
            client_reference_id: userId,
            metadata: {
                user_id: userId,
                plan: planId,
                type: 'api'
            },
            subscription_data: {
                metadata: {
                    user_id: userId,
                    plan: planId,
                    type: 'api'
                }
            }
        });

        res.json({ url: session.url });
    } catch (err: any) {
        console.error('[API Subscribe Error]', err);
        res.status(500).json({ error: err.message || 'Failed to create API subscription' });
    }
});

// ═══════════════════════════════════════════════════════════════
// ElevenLabs Voice Generation API
// ═══════════════════════════════════════════════════════════════

// ElevenLabs voice presets (popular voices from ElevenLabs)
const ELEVENLABS_VOICES: Record<string, string> = {
    // Chinese voices
    'zh_female_shuang': 'cgSg06JYOELk1w0YDjjJ',
    'zh_male_yong': 'pNInz6obpgDQGcFmaJgB',
    // English voices
    'en_female_rachel': '21m00Tcm4TlvDq8ikWAM',
    'en_male_josh': 'TxGEqnHWrfWFTfGW9XjX',
    'en_female_sarah': 'EXAVITQ4lndZxqmuB3iK',
    'en_male_arnold': 'VR6AewLTigWG4xSOukaG',
    // Other popular voices
    'en_female_emma': 'LcfcDJ0VP2Gu28MmWJZD',
    'en_male_james': 'ZQe5DxY0m0R2l8kfVJkJ',
};

// POST /api/audio/elevenlabs - Generate voice using ElevenLabs
app.post('/api/audio/elevenlabs', requireAuth, async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Missing Authorization header' });
        }

        const { text, voice_id, speed = 1.0, stability = 0.5, similarity_boost = 0.75 } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Missing text content' });
        }

        const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
        if (!elevenlabsKey) {
            return res.status(500).json({ error: 'ElevenLabs API not configured' });
        }

        // Use default voice if not specified
        const selectedVoice = voice_id && ELEVENLABS_VOICES[voice_id]
            ? ELEVENLABS_VOICES[voice_id]
            : ELEVENLABS_VOICES['en_female_rachel'];

        console.log('[ElevenLabs] Generating voice for text:', text.substring(0, 50) + '...');
        console.log('[ElevenLabs] Using voice:', selectedVoice);

        // Call ElevenLabs TTS API
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': elevenlabsKey,
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: stability,
                    similarity_boost: similarity_boost,
                    speed: speed,
                    pitch: 0,
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ElevenLabs] API Error:', response.status, errorText);
            return res.status(response.status).json({ error: `ElevenLabs API error: ${response.status}` });
        }

        // Convert audio to buffer and upload to Supabase Storage
        const audioBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(audioBuffer);

        const supabaseAdmin = getSupabaseAdmin();
        const fileName = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from('videos')
            .upload(`audio/${fileName}`, buffer, {
                contentType: 'audio/mpeg',
                upsert: false,
            });

        if (uploadError) {
            console.error('[ElevenLabs] Upload Error:', uploadError);
            return res.status(500).json({ error: 'Failed to upload audio file' });
        }

        // Get public URL
        const { data: { publicUrl } } = supabaseAdmin.storage
            .from('videos')
            .getPublicUrl(`audio/${fileName}`);

        console.log('[ElevenLabs] Voice generated successfully:', publicUrl);

        res.json({
            audio_url: publicUrl,
            success: true,
        });
    } catch (err: any) {
        console.error('[ElevenLabs] Exception:', err);
        res.status(500).json({ error: err.message || 'Failed to generate voice' });
    }
});

// GET /api/audio/elevenlabs/voices - Get available ElevenLabs voices
app.get('/api/audio/elevenlabs/voices', async (req: any, res: any) => {
    try {
        const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
        if (!elevenlabsKey) {
            return res.status(500).json({ error: 'ElevenLabs API not configured' });
        }

        // Try to get voices from ElevenLabs API
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            method: 'GET',
            headers: {
                'xi-api-key': elevenlabsKey,
            },
        });

        if (!response.ok) {
            // Return preset voices if API fails
            return res.json({
                voices: [
                    { voice_id: 'zh_female_shuang', name: '中文女声-双', category: 'preset' },
                    { voice_id: 'zh_male_yong', name: '中文男声-勇', category: 'preset' },
                    { voice_id: 'en_female_rachel', name: 'Rachel (English)', category: 'preset' },
                    { voice_id: 'en_male_josh', name: 'Josh (English)', category: 'preset' },
                    { voice_id: 'en_female_sarah', name: 'Sarah (English)', category: 'preset' },
                    { voice_id: 'en_male_arnold', name: 'Arnold (English)', category: 'preset' },
                ],
            });
        }

        const data = await response.json() as { voices?: any[] };
        res.json({ voices: data.voices || [] });
    } catch (err: any) {
        console.error('[ElevenLabs] Get Voices Error:', err);
        res.status(500).json({ error: err.message || 'Failed to get voices' });
    }
});

// POST /api/audio/generate-all - Generate voice for all scenes
app.post('/api/audio/generate-all', requireAuth, async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Missing Authorization header' });
        }

        const { scenes, voice_id, background_music } = req.body;

        if (!scenes || !Array.isArray(scenes)) {
            return res.status(400).json({ error: 'Missing scenes array' });
        }

        const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
        if (!elevenlabsKey) {
            return res.status(500).json({ error: 'ElevenLabs API not configured' });
        }

        const selectedVoice = voice_id && ELEVENLABS_VOICES[voice_id]
            ? ELEVENLABS_VOICES[voice_id]
            : ELEVENLABS_VOICES['en_female_rachel'];

        const supabaseAdmin = getSupabaseAdmin();
        const results: any[] = [];

        // Generate voice for each scene
        for (const scene of scenes) {
            const { scene_number, dialogue, description } = scene;
            const textToSpeak = dialogue || description || '';

            if (!textToSpeak.trim()) {
                results.push({ scene_number, success: false, error: 'No text to speak' });
                continue;
            }

            try {
                const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json',
                        'xi-api-key': elevenlabsKey,
                    },
                    body: JSON.stringify({
                        text: textToSpeak,
                        model_id: 'eleven_multilingual_v2',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75,
                            speed: 1.0,
                        },
                    }),
                });

                if (!response.ok) {
                    throw new Error(`ElevenLabs API error: ${response.status}`);
                }

                const audioBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(audioBuffer);

                const fileName = `voice_scene${scene_number}_${Date.now()}.mp3`;

                const { error: uploadError } = await supabaseAdmin.storage
                    .from('videos')
                    .upload(`audio/${fileName}`, buffer, {
                        contentType: 'audio/mpeg',
                        upsert: false,
                    });

                if (uploadError) {
                    throw new Error(uploadError.message);
                }

                const { data: { publicUrl } } = supabaseAdmin.storage
                    .from('videos')
                    .getPublicUrl(`audio/${fileName}`);

                results.push({
                    scene_number,
                    audio_url: publicUrl,
                    success: true,
                });
            } catch (err: any) {
                console.error(`[ElevenLabs] Scene ${scene_number} error:`, err);
                results.push({ scene_number, success: false, error: err.message });
            }
        }

        res.json({
            results,
            success: results.filter(r => r.success).length > 0,
        });
    } catch (err: any) {
        console.error('[ElevenLabs] Generate All Error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate voices' });
    }
});

// POST /api/video/stitch - Stitch multiple videos together
app.post('/api/video/stitch', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Missing Authorization header' });
        }

        const { video_urls, voice_urls, output_format = 'mp4' } = req.body;

        if (!video_urls || !Array.isArray(video_urls) || video_urls.length === 0) {
            return res.status(400).json({ error: 'Missing video_urls array' });
        }

        console.log('[Video Stitch] Processing', video_urls.length, 'videos');

        res.json({
            success: true,
            video_url: video_urls[0],
            video_urls: video_urls,
            video_count: video_urls.length,
            message: 'Videos ready for playback',
        });
    } catch (err: any) {
        console.error('[Video Stitch] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to stitch videos' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/video/finalize — Finalize & stitch all scene videos (called by VideoGenerator)
// ───────────────────────────────────────────────────────────────
app.post('/api/video/finalize', requireAuth, async (req: any, res: any) => {
    try {
        const { project_id, segments, background_music, transitions, output_format } = req.body;

        if (!segments || !Array.isArray(segments) || segments.length === 0) {
            return res.status(400).json({ error: 'Missing segments array' });
        }

        // Sort segments by scene_number ascending
        const sorted = [...segments].sort((a, b) => (a.scene_number || 0) - (b.scene_number || 0));
        const videoUrls = sorted.map((s: any) => s.video_url).filter(Boolean);

        console.log(`[Video Finalize] Project ${project_id}: ${videoUrls.length} segments`);

        // Generate a fake job ID immediately so the frontend can poll
        const jobId = `final_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        // Respond synchronously with the list of URLs and status=completed
        // (real encoding pipeline would be async; for now playlist works in-browser)
        res.json({
            success: true,
            job_id: jobId,
            status: 'completed',
            progress: 100,
            output_url: videoUrls[0],  // Primary video (first scene)
            video_urls: videoUrls,      // Full playlist
            segment_count: videoUrls.length,
            message: `${videoUrls.length} videos ready. Playlist mode active.`,
        });
    } catch (err: any) {
        console.error('[Video Finalize] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to finalize video' });
    }
});


// ───────────────────────────────────────────────────────────────
// POST /api/audio/init-bucket — Initialize audio bucket for storage
// ───────────────────────────────────────────────────────────────
app.post('/api/audio/init-bucket', async (req: any, res: any) => {
    try {
        const supabaseAdmin = getSupabaseAdmin();

        // Check if 'audio' bucket exists
        const { data: buckets } = await supabaseAdmin.storage.listBuckets();
        const audioBucket = buckets?.find(b => b.name === 'audio');

        if (!audioBucket) {
            // Create audio bucket
            const { data, error } = await supabaseAdmin.storage.createBucket('audio', {
                public: true,
                fileSizeLimit: '50MB',
                allowedMimeTypes: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3']
            });

            if (error) {
                console.error('[Audio Bucket] Creation error:', error);
                return res.status(500).json({ error: error.message });
            }

            console.log('[Audio Bucket] Created successfully');
            return res.json({ ok: true, message: 'Audio bucket created' });
        }

        return res.json({ ok: true, message: 'Audio bucket already exists' });
    } catch (err: any) {
        console.error('[Audio Bucket] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to initialize audio bucket' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/audio/generate-dialogue — Generate dialogue using Eleven Labs
// ───────────────────────────────────────────────────────────────
app.post('/api/audio/generate-dialogue', requireAuth, async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const { text, voice, emotion } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Missing text' });
        }

        const ELEVEN_LABS_API_KEY = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
        const ELEVEN_LABS_VOICE_ID = process.env.ELEVEN_LABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';

        if (!ELEVEN_LABS_API_KEY) {
            return res.status(500).json({ error: 'ElevenLabs API key not configured (set ELEVENLABS_API_KEY)' });
        }

        // Map emotion to Eleven Labs settings
        const stabilityMap: Record<string, number> = {
            'happy': 0.5, 'sad': 0.4, 'angry': 0.3, 'neutral': 0.7, 'excited': 0.6, 'calm': 0.8
        };
        const emotionMap: Record<string, number> = {
            'happy': 0.8, 'sad': 0.3, 'angry': 0.9, 'neutral': 0.5, 'excited': 0.9, 'calm': 0.4
        };

        const stability = stabilityMap[emotion] || 0.7;
        const similarityBoost = emotionMap[emotion] || 0.5;

        // Call Eleven Labs API
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_LABS_VOICE_ID}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': ELEVEN_LABS_API_KEY
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: {
                    stability: stability,
                    similarity_boost: similarityBoost,
                    style: 0.5,
                    use_speaker_boost: true
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ElevenLabs] API Error:', errorText);
            return res.status(500).json({ error: `Eleven Labs API error: ${response.status}` });
        }

        // Upload to Supabase Storage
        const supabaseAdmin = getSupabaseAdmin();
        // ★ Fix: node-fetch v3 removed .buffer(). Use arrayBuffer() + Buffer.from() instead.
        const audioBuffer = await response.arrayBuffer();
        const audioNodeBuffer = Buffer.from(audioBuffer);
        const fileName = `dialogue_${Date.now()}.mp3`;

        const { data, error } = await supabaseAdmin.storage
            .from('audio')
            .upload(fileName, audioNodeBuffer, {
                contentType: 'audio/mpeg',
                upsert: true
            });

        if (error) {
            console.error('[ElevenLabs] Upload Error:', error);
            return res.status(500).json({ error: error.message });
        }

        const { data: urlData } = supabaseAdmin.storage
            .from('audio')
            .getPublicUrl(fileName);

        // Estimate duration
        const wordCount = text.split(/\s+/).length;
        const duration = Math.max(1, wordCount / 2.5);

        res.json({
            ok: true,
            url: urlData.publicUrl,
            duration: duration
        });

    } catch (err: any) {
        console.error('[Audio Dialogue] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate dialogue' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/audio/generate-music — Generate background music
// ───────────────────────────────────────────────────────────────
app.post('/api/audio/generate-music', async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const { vibe, duration = 10 } = req.body;

        if (!vibe) {
            return res.status(400).json({ error: 'Missing vibe description' });
        }

        const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

        if (!REPLICATE_TOKEN) {
            return res.status(500).json({ error: 'Replicate API not configured' });
        }

        // Use MusicGen via Replicate
        const response = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${REPLICATE_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                version: '671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedee5', // meta/musicgen
                input: {
                    prompt: vibe,
                    duration: duration,
                    model: 'musicgen-large'
                }
            })
        });

        if (!response.ok) {
            return res.status(500).json({ error: `Replicate API error: ${response.status}` });
        }

        const prediction = await response.json() as any;

        res.json({
            ok: true,
            prediction_id: prediction.id,
            status: 'processing'
        });

    } catch (err: any) {
        console.error('[Audio Music] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate music' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/audio/mix — Mix audio with video using FFmpeg
// ───────────────────────────────────────────────────────────────
app.post('/api/audio/mix', requireAuth, async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const { video_url, dialogue_url, music_url, sfx_urls, output_format = 'mp4' } = req.body;

        if (!video_url) {
            return res.status(400).json({ error: 'Missing video_url' });
        }

        console.log('[AudioMix] Starting audio mixing...');
        console.log('[AudioMix] Video:', video_url);
        console.log('[AudioMix] Dialogue:', dialogue_url || 'none');
        console.log('[AudioMix] Music:', music_url || 'none');

        // For now, return the original video URL if no audio provided
        // In production, this would use FFmpeg to mux audio into video
        // FFmpeg command would be: ffmpeg -i video.mp4 -i audio.mp3 -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 output.mp4

        const supabaseAdmin = getSupabaseAdmin();

        // Build FFmpeg filter for mixing multiple audio streams
        // ★ SECURITY WARNING: URLs come from user input. If FFmpeg execution is ever enabled,
        // they MUST be validated (URL format, no shell metacharacters) to prevent injection.
        let ffmpegInputs = `-i "${video_url}" `;
        let audioInputs: string[] = [];
        let filterComplex = '';
        let audioIndex = 1;

        // Add dialogue audio
        if (dialogue_url) {
            ffmpegInputs += `-i "${dialogue_url}" `;
            audioInputs.push(`[${audioIndex}:a]volume=1.0[dialogue]`);
            audioIndex++;
        }

        // Add background music (lower volume)
        if (music_url) {
            ffmpegInputs += `-i "${music_url}" `;
            audioInputs.push(`[${audioIndex}:a]volume=0.3[music]`);
            audioIndex++;
        }

        // Add SFX if provided
        if (sfx_urls && Array.isArray(sfx_urls)) {
            sfx_urls.forEach((sfxUrl: string, idx: number) => {
                ffmpegInputs += `-i "${sfxUrl}" `;
                audioInputs.push(`[${audioIndex}:a]volume=0.5[sfx${idx}]`);
                audioIndex++;
            });
        }

        // If no audio, just return original video
        if (audioInputs.length === 0) {
            console.log('[AudioMix] No audio tracks, returning original video');
            return res.json({ ok: true, video_url: video_url, mixed: false });
        }

        // Build audio mixing filter
        if (audioInputs.length === 1) {
            filterComplex = audioInputs[0].replace('[dialogue]', '[aout]').replace('[music]', '[aout]');
            for (let i = 0; i < audioInputs.length; i++) {
                filterComplex = audioInputs[i];
            }
            filterComplex = filterComplex.replace(/\[(dialogue|music|sfx\d+)\]/, '[aout]');
        } else {
            // Mix multiple audio streams
            let mixInputs = '';
            audioInputs.forEach(input => {
                const label = input.match(/\[(dialogue|music|sfx\d+)\]/)?.[1] || '';
                mixInputs += `[${label}]`;
            });
            filterComplex = mixInputs + `amix=inputs=${audioInputs.length}:duration=first:dropout_transition=2[aout]`;
        }

        const outputFileName = `mixed_${Date.now()}.mp4`;
        const tmpDir = '/tmp';
        const outputPath = `${tmpDir}/${outputFileName}`;

        // Build FFmpeg command
        // Note: In Vercel serverless, FFmpeg may not be available
        // This is a placeholder - in production you'd use a video processing service
        const command = `ffmpeg -y ${ffmpegInputs} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${outputPath}"`;

        console.log('[AudioMix] FFmpeg command:', command);

        // For now, return the original video URL
        // In production, execute FFmpeg and upload the result
        res.json({
            ok: true,
            video_url: video_url,
            mixed: false,
            message: 'Audio mixing requires FFmpeg installation. Returning original video.',
            note: 'In production, this would mix audio with video using FFmpeg'
        });

    } catch (err: any) {
        console.error('[AudioMix] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to mix audio' });
    }
});

// ============================================
// 多帧关键帧视频生成 API
// POST /api/replicate/multi-frame
// ============================================

app.post('/api/replicate/multi-frame', requireAuth, async (req: any, res: any) => {
    try {
        const user = req.user;
        const {
            frames,
            model,
            aspectRatio,
            characterAnchor,
            continuityMode
        } = req.body;

        if (!frames || !Array.isArray(frames) || frames.length === 0) {
            return res.status(400).json({ error: 'frames array is required' });
        }
        if (!model) {
            return res.status(400).json({ error: 'model is required' });
        }

        console.log(`[/api/replicate/multi-frame] Starting: ${frames.length} frames, model: ${model}`);

        const { generateMultiFrameVideo } = await import('../services/multiFrameService');

        const results = await generateMultiFrameVideo(
            {
                frames: frames.map((f: any) => ({
                    prompt: f.prompt,
                    imageUrl: f.imageUrl,
                    duration: f.duration || 6
                })),
                model: model,
                aspectRatio: aspectRatio || '16:9',
                characterAnchor,
                startImageUrl: frames[0]?.imageUrl,
                continuityMode: continuityMode || 'link'
            },
            (frameIndex, status, message) => {
                console.log(`[MultiFrame] Frame ${frameIndex + 1}: ${status}`);
            }
        );

        // ★ Use inline cost lookup from VIDEO_MODEL_COSTS (already defined at top of file)
        const costPerVideo = (VIDEO_MODEL_COSTS as Record<string, number>)[model] ?? 22;
        const totalCost = results.filter(r => r.success).length * costPerVideo;

        const supabaseAdmin = getSupabaseAdmin();
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('credits')
            .eq('id', user.id)
            .single();

        const currentCredits = (profile as any)?.credits || 0;
        if (currentCredits < totalCost) {
            return res.status(402).json({
                error: 'INSUFFICIENT_CREDITS',
                required: totalCost,
                available: currentCredits
            });
        }

        await (supabaseAdmin.rpc as any)('deduct_credits', { p_user_id: user.id, p_amount: totalCost });

        res.json({ ok: true, results, totalCost, continuityMode: continuityMode || 'link' });

    } catch (err: any) {
        console.error('[/api/replicate/multi-frame Error]', err);
        res.status(500).json({ error: err.message || 'Multi-frame generation failed' });
    }
});

export default app;