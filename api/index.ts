import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import { GoogleGenAI, Type } from '@google/genai';
import { logger, generateTraceId } from '../utils/logger.js';
import { 
    createSuccessResponse, 
    createErrorResponse, 
    ApiError, 
    createError 
} from '../utils/apiError.js';
import {
    traceIdMiddleware,
    metricsMiddleware,
    errorHandlerMiddleware,
    asyncHandler,
    rateLimitMiddleware,
    slowQueryLogMiddleware,
} from '../utils/middleware.js';
import {
    buildContinuityProfile,
    applyContinuityLocks,
    buildContinuityNegativePrompt,
    scoreContinuityPrompt,
    continuityThreshold,
    strengthenPromptForRetry,
    registerApprovedFrame,
    getContinuityReference,
} from '../lib/continuity.js';
import {
    initProjectRuntime,
    getProjectRuntime,
    setProjectStage,
    buildShotContextPack,
    scoreStoryboardCandidate,
    registerStoryboardCandidate,
    approveStoryboardShot,
    markShotRegenerated,
    controlStoryboardQueue,
    hasApprovedStoryboard,
    getApprovedStoryboardFrame,
    serializePipelineState,
    deserializePipelineState,
    restorePipelineState,
} from '../lib/storyPipeline.js';
import {
    buildShotImagePrompt,
    buildShotGenerationPayload,
} from '../lib/shotPromptCompiler.js';
import {
    buildDirectorBrainLayer,
    build12PanelStoryboard,
    buildShotGraph,
    buildCharacterIdentityLaw,
    buildEditPlan,
    buildVerificationReport,
    buildSequenceContext,
    validateContinuityAgainstPrevNext,
} from '../lib/directorOS.js';


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

function parseReplicateErrorText(raw: string): {
    message: string;
    code?: string;
    retryAfter?: number;
    detail?: any;
} {
    const fallback = (raw || '').trim() || 'Replicate request failed';

    try {
        const parsed = JSON.parse(raw || '{}');
        const detail = parsed?.detail;
        const detailObj = typeof detail === 'string'
            ? (() => {
                try { return JSON.parse(detail); } catch { return null; }
            })()
            : detail;

        const retryAfterRaw =
            parsed?.retry_after ??
            detailObj?.retry_after ??
            parsed?.retryAfter ??
            detailObj?.retryAfter;
        const retryAfter = Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : undefined;

        const msg =
            parsed?.error ||
            parsed?.message ||
            detailObj?.detail ||
            detailObj?.message ||
            fallback;

        return {
            message: String(msg),
            code: parsed?.code || detailObj?.code,
            retryAfter,
            detail: detailObj ?? detail,
        };
    } catch {
        return { message: fallback };
    }
}

function buildReplicateClientError(status: number, raw: string): {
    error: string;
    code?: string;
    retry_after?: number;
    detail?: any;
} {
    const parsed = parseReplicateErrorText(raw);
    const isRateLimited = status === 429 || /throttle|rate\s*limit|too many/i.test(parsed.message);

    if (isRateLimited) {
        const retryHint = parsed.retryAfter ? ` 请在 ${parsed.retryAfter} 秒后重试。` : ' 请稍后重试。';
        return {
            error: `请求过于频繁，触发上游限流。${retryHint}`,
            code: 'RATE_LIMITED',
            retry_after: parsed.retryAfter,
            detail: parsed.detail,
        };
    }

    return {
        error: parsed.message,
        code: parsed.code,
        retry_after: parsed.retryAfter,
        detail: parsed.detail,
    };
}

function sanitizePromptInput(value: unknown, maxLength: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function detectNonHumanCharacterGuide(...inputs: Array<string | undefined>): {
    hasNonHuman: boolean;
    species: string[];
    guidance: string;
} {
    const text = inputs.filter(Boolean).join(' ').toLowerCase();
    const keywordMap: Array<{ label: string; patterns: RegExp[] }> = [
        { label: 'cat', patterns: [/\bcat\b/, /\bkitten\b/, /猫/g, /小猫/g, /猫咪/g] },
        { label: 'dog', patterns: [/\bdog\b/, /\bpuppy\b/, /狗/g, /小狗/g, /狗狗/g] },
        { label: 'rabbit', patterns: [/\brabbit\b/, /\bbunny\b/, /兔/g, /小兔/g] },
        { label: 'bear', patterns: [/\bbear\b/, /熊/g, /小熊/g] },
        { label: 'fox', patterns: [/\bfox\b/, /狐狸/g] },
        { label: 'wolf', patterns: [/\bwolf\b/, /狼/g] },
        { label: 'tiger', patterns: [/\btiger\b/, /老虎/g] },
        { label: 'lion', patterns: [/\blion\b/, /狮子/g] },
        { label: 'mouse', patterns: [/\bmouse\b/, /\bmice\b/, /老鼠/g] },
        { label: 'bird', patterns: [/\bbird\b/, /小鸟/g, /鸟/g] },
        { label: 'duck', patterns: [/\bduck\b/, /鸭/g, /小鸭/g] },
        { label: 'penguin', patterns: [/\bpenguin\b/, /企鹅/g] },
        { label: 'dragon', patterns: [/\bdragon\b/, /龙/g] },
        { label: 'animal', patterns: [/\banimal\b/, /动物/g, /萌宠/g, /宠物/g] },
    ];

    const species = keywordMap
        .filter((item) => item.patterns.some((pattern) => pattern.test(text)))
        .map((item) => item.label);

    const hasNonHuman = species.length > 0;
    return {
        hasNonHuman,
        species,
        guidance: hasNonHuman
            ? `NON-HUMAN CHARACTER LOCK: The protagonist/cast are ${species.join(', ')} characters. They MUST remain clearly non-human in every scene and prompt. Never replace them with human actors, realistic people, or generic human faces. Preserve obvious species anatomy such as fur, ears, paws, muzzles, tails, beaks, or species silhouettes.`
            : '',
    };
}

function isRemoteImageReference(value: unknown): boolean {
    const text = String(value || '').trim();
    return /^https?:\/\//i.test(text);
}

function extractCriticalKeywordsFromAnchor(anchor: string): string[] {
    const cleaned = sanitizePromptInput(anchor, 1000).toLowerCase();
    if (!cleaned) return [];

    const segments = cleaned
        .split(/[,;|]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^(a|an|the)\s+/i, ''));

    if (segments.length > 0) {
        return Array.from(new Set(segments)).slice(0, 8);
    }

    return [cleaned.slice(0, 80)];
}

function normalizeEntityType(value: unknown): 'character' | 'prop' | 'location' {
    const t = String(value || '').toLowerCase().trim();
    if (t === 'prop' || t === 'location') return t;
    return 'character';
}

function getLockedCastFromEntities(storyEntities: any): Array<{ name: string; description: string }> {
    if (!Array.isArray(storyEntities)) return [];
    return storyEntities
        .filter((e: any) => normalizeEntityType(e?.type) === 'character' && !!e?.is_locked)
        .map((e: any) => ({
            name: sanitizePromptInput(e?.name || 'Character', 80),
            description: sanitizePromptInput(e?.description || '', 400),
        }))
        .filter((e: any) => !!e.name || !!e.description)
        .slice(0, 8);
}

function buildLockedCastDirective(storyEntities: any): string {
    const cast = getLockedCastFromEntities(storyEntities);
    if (cast.length === 0) return '';
    const castLine = cast
        .map((c) => `${c.name}${c.description ? `: ${c.description}` : ''}`)
        .join(' | ');
    return `[CAST LOCK - MUST FOLLOW EXACTLY] Start Cast Bible: ${castLine}. All generated scenes and videos must match this cast identity. Do not replace, morph, age-swap, gender-swap, or wardrobe-swap the locked cast.`;
}

function appendLockedCastToPrompt(prompt: string, storyEntities: any): string {
    const base = sanitizePromptInput(prompt || '', 4000);
    const directive = buildLockedCastDirective(storyEntities);
    if (!directive) return base;
    if (base.includes('[CAST LOCK - MUST FOLLOW EXACTLY]')) return base;
    return `${base} ${directive}`.trim();
}

function parseAiJsonWithRepair(rawText: string, contextLabel: string): any {
    const input = String(rawText || '').trim();
    if (!input) throw new Error(`[${contextLabel}] Empty AI response`);

    const extractJsonBody = (text: string) => {
        const noFence = text
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();
        const start = noFence.indexOf('{');
        const end = noFence.lastIndexOf('}');
        if (start >= 0 && end > start) return noFence.slice(start, end + 1);
        return noFence;
    };

    const normalizeBase = (text: string) => text
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .trim();

    const toQuotedKeys = (text: string) => text.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\-]*)(\s*:)/g, '$1"$2"$3');
    const dropTrailingCommas = (text: string) => text.replace(/,\s*([}\]])/g, '$1');
    const singleQuoteKeys = (text: string) => text.replace(/([{,]\s*)'([^'\\]+?)'\s*:/g, '$1"$2":');
    const singleQuoteValues = (text: string) => text.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, v) => {
        const escaped = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `: "${escaped}"`;
    });

    const body = extractJsonBody(input);
    const candidates = [
        body,
        normalizeBase(body),
        dropTrailingCommas(normalizeBase(body)),
        toQuotedKeys(dropTrailingCommas(normalizeBase(body))),
        singleQuoteValues(singleQuoteKeys(toQuotedKeys(dropTrailingCommas(normalizeBase(body))))),
    ];

    let lastError = '';
    for (const candidate of candidates) {
        if (!candidate || !candidate.trim()) continue;
        try {
            return JSON.parse(candidate);
        } catch (err: any) {
            lastError = err?.message || String(err);
        }
    }

    throw new Error(`AI response was not valid JSON: ${body.substring(0, 240)}... (${lastError})`);
}

function buildFallbackShotResult(params: {
    sceneNumber: number;
    targetShots: number;
    visualDescription: string;
    audioDescription?: string;
    shotType?: string;
    characterAnchor?: string;
    lockedCharacters: Array<{ name: string; description: string }>;
}) {
    const cameras = ['wide', 'medium', 'over-shoulder', 'close', 'ecu', 'tracking', 'two-shot'];
    const movements = ['static', 'push-in', 'pan-left', 'dolly', 'tilt-up', 'tracking', 'pull-out'];
    const lenses = ['24mm anamorphic', '35mm', '50mm', '85mm', '100mm macro', '70mm'];
    const beats = [
        'establishes spatial relationship and threat distance',
        'detective shifts weight and circles half-step clockwise',
        'rival raises left hand and glances to rooftop edge',
        'both characters close distance by one step and pause',
        'detective reaches coat pocket while rival leans back',
        'wind intensifies, coat fabric whips, both reframe stance',
        'final pre-action freeze with micro head-turn and breath hold',
    ];

    const charNames = params.lockedCharacters.length > 0
        ? params.lockedCharacters.map((c) => c.name)
        : ['Main Character'];

    const shots = Array.from({ length: Math.max(1, params.targetShots) }).map((_, idx) => {
        const shotNo = idx + 1;
        const camera = cameras[idx % cameras.length];
        const movement = movements[idx % movements.length];
        const lens = lenses[idx % lenses.length];
        const beat = beats[idx % beats.length];
        const primaryChar = charNames[idx % charNames.length];

        const imagePrompt = [
            params.characterAnchor || params.lockedCharacters[0]?.description || primaryChar,
            `Scene ${params.sceneNumber}, shot ${shotNo}`,
            params.visualDescription,
            `camera ${camera}, lens ${lens}, movement ${movement}`,
            'cinematic contrast lighting, high detail, coherent continuity',
        ].filter(Boolean).join('. ');

        return {
            shot_number: shotNo,
            duration_sec: 3 + (idx % 3),
            location_type: 'EXT',
            location: `Scene ${params.sceneNumber} location`,
            time_of_day: 'dusk',
            characters: charNames,
            action: `Shot ${shotNo}: ${primaryChar} ${beat}.`,
            dialogue: '',
            camera,
            lens,
            movement,
            composition: `Shot ${shotNo} framing with depth layering and clear eyeline continuity`,
            lighting: 'noir rim light with practical city neon spill',
            art_direction: params.shotType || 'cinematic staging',
            mood: 'high tension',
            sfx_vfx: 'subtle atmosphere haze',
            audio_notes: params.audioDescription || 'wind and distant traffic',
            continuity_notes: `Shot ${shotNo} must preserve costume, face, and spatial axis from shot ${Math.max(1, shotNo - 1)}.`,
            image_prompt: imagePrompt,
            negative_prompt: 'blurry, duplicate pose, extra limbs, identity drift',
            video_prompt: `Shot ${shotNo}. Camera ${movement}. ${primaryChar} performs a distinct physical beat: ${beat}. Maintain exact character identity and rooftop blocking continuity.`,
        };
    });

    return {
        scene_title: `Scene ${params.sceneNumber}`,
        shots,
    };
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
        logger.payment.error('stripe_signature_failed', err.message);
        return res.status(400).send(`Webhook Error: ${err.message} `);
    }

    if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
        const obj = event.data.object as any;
        let userId = '';
        let creditsToGrant = 0;
        let isSubscription = false;
        let planTier = '';
        const eventRefId = String(event.id || obj.id || '');

        if (event.type === 'checkout.session.completed' && obj.mode === 'payment') {
            userId = obj.client_reference_id || obj.metadata?.user_id;
            creditsToGrant = Number(obj.metadata?.credits || 0);
        } else if (event.type === 'invoice.paid' && obj.subscription) {
            try {
                const subscription = await stripe.subscriptions.retrieve(obj.subscription as string);
                userId = subscription.metadata?.user_id || '';
                planTier = subscription.metadata?.plan || subscription.metadata?.tier || '';
                // ★ Credits match actual plan definitions in types.ts BUSINESS_PLANS
                if (planTier === 'creator' || planTier === 'plan_starter') creditsToGrant = 3000;
                if (planTier === 'director' || planTier === 'plan_pro') creditsToGrant = 15000;
                if (planTier === 'business' || planTier === 'plan_business') creditsToGrant = 50000;
                if (planTier === 'enterprise' || planTier === 'plan_enterprise') creditsToGrant = 300000;
                isSubscription = true;
            } catch (err: any) {
                logger.payment.error('stripe_subscription_fetch_failed', err.message || 'Unknown');
            }
        }

        if (userId && creditsToGrant > 0) {
            const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
            const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
            if (supabaseUrl && supabaseKey) {
                const supabase = createClient(supabaseUrl, supabaseKey);

                const { data: existingLedger } = await supabase
                    .from('credits_ledger')
                    .select('id')
                    .eq('ref_type', 'stripe')
                    .eq('ref_id', eventRefId)
                    .maybeSingle();

                if (existingLedger?.id) {
                    logger.payment.warn('stripe_event_duplicate', { eventRef: eventRefId, userId });
                    return res.json({ received: true, duplicate: true });
                }

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
                    ref_id: eventRefId,
                    status: 'settled'
                });
                logger.payment.info('credits_granted', { userId, amount: creditsToGrant, isSubscription, planTier, eventRef: eventRefId });
            }
        }
    }
    res.json({ received: true });
});

// 其它路由用json parser
app.use(express.json({ limit: '10mb' }));
// Stripe订阅checkout

// 全局中间件堆栈
app.use(traceIdMiddleware);                        // 生成 traceId
app.use(metricsMiddleware);                        // API 指标
app.use(rateLimitMiddleware(1000, 60000));        // 60s 内 1000 请求
app.use(slowQueryLogMiddleware(2000));            // 慢请求监控

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

let _supabaseAnonSingleton: ReturnType<typeof createClient> | null = null;
const getSupabaseAnon = () => {
    const url = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
    if (!url || !anonKey) throw new Error('Supabase URL or Anon Key missing');
    if (!_supabaseAnonSingleton) {
        _supabaseAnonSingleton = createClient(url, anonKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        });
    }
    return _supabaseAnonSingleton;
};

const requestRateLimitStore = new Map<string, { count: number; resetAt: number }>();

const getClientIp = (req: any): string => {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.ip || 'unknown';
    return String(raw).split(',')[0].trim() || 'unknown';
};

const isValidEmailFormat = (value: string): boolean => {
    if (!value) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const enforceRateLimit = (req: any, res: any, options: {
    key: string;
    maxRequests: number;
    windowMs: number;
    scope?: string;
}): boolean => {
    const scope = options.scope || '';
    const bucketKey = `${options.key}:${getClientIp(req)}:${scope}`;
    const now = Date.now();
    const current = requestRateLimitStore.get(bucketKey);

    if (!current || current.resetAt <= now) {
        requestRateLimitStore.set(bucketKey, { count: 1, resetAt: now + options.windowMs });
        return true;
    }

    if (current.count >= options.maxRequests) {
        const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        res.set('Retry-After', String(retryAfter));
        res.status(429).json({ error: 'Too many requests, please try again later', code: 'RATE_LIMITED', retryAfter });
        return false;
    }

    current.count += 1;
    requestRateLimitStore.set(bucketKey, current);
    return true;
};

const computeDeterministicShotSeed = (projectSeed: number, shotId: string, shotNumber: number): number => {
    const base = `${projectSeed}:${shotId || ''}:${shotNumber || 0}`;
    let hash = 0;
    for (let i = 0; i < base.length; i += 1) {
        hash = (hash * 31 + base.charCodeAt(i)) >>> 0;
    }
    const normalized = Math.abs(hash % 900000) + 100000;
    return normalized;
};

// ★ Replicate Request Queue (prevent 429 rate limit errors)
// Queues all Replicate API calls to limit concurrency and retry with backoff
interface ReplicateQueuedRequest {
    id: string;
    fn: () => Promise<Response>;
    resolve: (val: Response) => void;
    reject: (err: any) => void;
    retries: number;
}

const replicateQueue: ReplicateQueuedRequest[] = [];
let replicateProcessing = false;
const MAX_CONCURRENT_REPLICATE = 2;  // 2 concurrent requests max
const REPLICATE_RETRY_DELAY_MS = 2000; // 2 second base delay
const MAX_REPLICATE_RETRIES = 3;

const enqueueReplicateRequest = async (fn: () => Promise<Response>): Promise<Response> => {
    return new Promise((resolve, reject) => {
        replicateQueue.push({
            id: `req-${Date.now()}-${Math.random()}`,
            fn,
            resolve,
            reject,
            retries: 0,
        });
        processReplicateQueue();
    });
};

const processReplicateQueue = async () => {
    if (replicateProcessing || replicateQueue.length === 0) {
        return;
    }

    replicateProcessing = true;

    try {
        while (replicateQueue.length > 0) {
            // Process up to MAX_CONCURRENT_REPLICATE at a time
            const batch = replicateQueue.splice(0, MAX_CONCURRENT_REPLICATE);
            const promises = batch.map(async (req) => {
                try {
                    const response = await req.fn();

                    // 429 = rate limited, 503 = service unavailable
                    if (response.status === 429 || response.status === 503) {
                        if (req.retries < MAX_REPLICATE_RETRIES) {
                            req.retries += 1;
                            const delay = REPLICATE_RETRY_DELAY_MS * Math.pow(2, req.retries - 1);
                            console.log(`[Replicate Queue] 429/503 detected, retry ${req.retries}/${MAX_REPLICATE_RETRIES} after ${delay}ms`);

                            // Re-queue with exponential backoff
                            await new Promise(r => setTimeout(r, delay));
                            replicateQueue.unshift(req);
                            return;
                        } else {
                            // Max retries exceeded, return 429 response
                            req.resolve(response);
                            return;
                        }
                    }

                    req.resolve(response);
                } catch (err) {
                    req.reject(err);
                }
            });

            await Promise.all(promises);
        }
    } finally {
        replicateProcessing = false;
        // If new requests were added during processing, continue
        if (replicateQueue.length > 0) {
            processReplicateQueue();
        }
    }
};

const isDuplicateKeyError = (errorLike: any): boolean => {
    const msg = String(errorLike?.message || errorLike || '').toLowerCase();
    return msg.includes('duplicate key')
        || msg.includes('already exists')
        || msg.includes('violates unique constraint');
};

const ensureProfileExists = async (supabaseAdmin: any, userId: string, email: string) => {
    const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

    if (existingProfile?.id) return;

    const fullPayload = {
        id: userId,
        name: email,
        role: 'Director',
        credits: 50,
        is_pro: false,
        plan_type: 'free',
        monthly_credits_used: 0
    } as any;

    const basicPayload = {
        id: userId,
        name: email,
        credits: 50,
    } as any;

    const { error: insertErr } = await supabaseAdmin.from('profiles').insert(fullPayload);
    if (!insertErr || isDuplicateKeyError(insertErr)) return;

    const { error: fallbackErr } = await supabaseAdmin.from('profiles').insert(basicPayload);
    if (fallbackErr && !isDuplicateKeyError(fallbackErr)) {
        logger.auth.error('ensure_profile_insert_failed', fallbackErr.message || String(fallbackErr));
    }
};

const isPrivateHostname = (hostname: string): boolean => {
    const host = hostname.toLowerCase();
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    if (host === '::1' || host === '[::1]') return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    if (/^(fc|fd|fe80):/i.test(host)) return true;
    return false;
};

const assertSafePublicUrl = (rawUrl: string): URL => {
    let parsed: URL;
    try {
        parsed = new URL(String(rawUrl || '').trim());
    } catch {
        throw new Error('Invalid url');
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('Only http(s) URLs are allowed');
    }

    if (isPrivateHostname(parsed.hostname)) {
        throw new Error('Private network URLs are not allowed');
    }

    return parsed;
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
        logger.auth.error('token_invalid', error?.message || 'No user found');
        return res.status(401).json(createErrorResponse(createError.unauthorized('无效的认证令牌'), req.traceId));
    }

    // ★ Extract email with fallbacks (in case user.email is undefined)
    const emailFromUser = user.email ||
        user.user_metadata?.email ||
        user.app_metadata?.email ||
        (user.identities?.[0] as any)?.identity_data?.email ||
        null;

    // Enrich user object with extracted email as top-level field if needed
    if (!user.email && emailFromUser) {
        user.email = emailFromUser;
    }

    req.user = user;
    logger.auth.debug('user_validated', { userId: user?.id, emailConfirmed: !!user?.email_confirmed_at });
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
        if (!isValidEmailFormat(email)) {
            return res.status(400).json({ error: 'Invalid email format', code: 'INVALID_EMAIL' });
        }

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
            await ensureProfileExists(supabaseAdmin, userId, email);
        }

        return res.json({ ok: true });
    } catch (err: any) {
        console.error('[Auth Ensure User] Exception:', err);
        return res.status(500).json({ error: err.message || 'Failed to ensure user' });
    }
});

app.post('/api/auth/generate-link', requireAuth, async (req: any, res: any) => {
    try {
        const requesterEmail = String(req.user?.email || '').trim().toLowerCase();
        if (!isDeveloper(requesterEmail)) {
            return res.status(403).json({ error: 'This endpoint is restricted to developer accounts' });
        }

        const email = String(req.body?.email || '').trim().toLowerCase();
        const redirectTo = String(req.body?.redirectTo || '').trim();
        if (!email) return res.status(400).json({ error: 'Missing email' });
        if (!isValidEmailFormat(email)) {
            return res.status(400).json({ error: 'Invalid email format', code: 'INVALID_EMAIL' });
        }

        if (!enforceRateLimit(req, res, {
            key: 'auth-generate-link',
            maxRequests: 5,
            windowMs: 10 * 60 * 1000,
            scope: email,
        })) {
            return;
        }

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
        if (!isValidEmailFormat(email)) {
            return res.status(400).json({ error: 'Invalid email format', code: 'INVALID_EMAIL' });
        }

        if (!enforceRateLimit(req, res, {
            key: 'auth-send-otp',
            maxRequests: 5,
            windowMs: 10 * 60 * 1000,
            scope: email,
        })) {
            return;
        }

        const resendKey = process.env.RESEND_API_KEY;
        if (!resendKey) {
            logger.auth.error('otp_config_missing', 'RESEND_API_KEY not configured');
            return res.status(500).json({ 
                error: 'Authentication service not configured (RESEND_API_KEY missing)', 
                code: 'AUTH_CONFIG_MISSING' 
            });
        }

        const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
        const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
        if (!supabaseUrl || !supabaseKey) {
            logger.auth.error('otp_config_missing', 'Supabase admin config missing');
            return res.status(500).json({ 
                error: 'Authentication service not configured (SUPABASE_CONFIG_MISSING)', 
                code: 'AUTH_CONFIG_MISSING' 
            });
        }

        const supabaseAdmin = getSupabaseAdmin();

        // 1) Ensure user exists (fast path for serverless: avoid listUsers scan)
        let userId: string | undefined;
        const { data: createdUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            email_confirm: true,
        });
        if (createErr && !isUserAlreadyExistsError(createErr)) {
            logger.auth.error('otp_create_user_failed', createErr.message);
            return res.status(500).json({ error: createErr.message });
        }
        userId = createdUser?.user?.id;

        // 2) Generate magic link (Admin API — does NOT send email)
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email,
        });

        if (linkError || !linkData) {
            logger.auth.error('otp_generate_link_failed', linkError?.message || 'No linkData');
            return res.status(500).json({ error: linkError?.message || 'Failed to generate link' });
        }

        const actionLink = linkData.properties?.action_link || '';
        const emailOtp = (linkData as any).properties?.email_otp
            || (linkData.properties as any)?.verification_token
            || '';

        logger.auth.info('otp_generated', { hasToken: !!emailOtp, hasLink: !!actionLink });

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
                logger.auth.info('otp_email_sent', { from: fromAddr, id: resendData?.id });
                break;
            }

            lastErr = await resendResp.text();
            logger.auth.warn('otp_resend_failed', { from: fromAddr, status: resendResp.status });
            if (resendResp.status === 403) continue;
            break;
        }

        if (!resendData) {
            logger.auth.error('otp_all_senders_failed', lastErr);
            return res.status(500).json({ error: 'Failed to send verification email', code: 'EMAIL_SEND_FAILED' });
        }

        // Ensure profile
        if (userId) {
            await ensureProfileExists(supabaseAdmin, userId, email);
        }

        return res.json({ ok: true, message: 'Verification email sent' });
    } catch (err: any) {
        logger.auth.error('otp_exception', err.message || String(err));
        return res.status(500).json({ error: err.message || 'Failed to send OTP' });
    }
});

// POST /api/auth/verify-otp — Verify the OTP code from email and create session
app.post('/api/auth/verify-otp', async (req: any, res: any) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const code = String(req.body?.code || '').trim();

        if (!email || !code) {
            return res.status(400).json({ error: 'Missing email or code' });
        }
        if (!isValidEmailFormat(email)) {
            return res.status(400).json({ error: 'Invalid email format', code: 'INVALID_EMAIL' });
        }

        if (!enforceRateLimit(req, res, {
            key: 'auth-verify-otp',
            maxRequests: 10,
            windowMs: 10 * 60 * 1000,
            scope: email,
        })) {
            return;
        }

        const supabaseAuth = getSupabaseAnon();
        let verifyResult = await supabaseAuth.auth.verifyOtp({
            email,
            token: code,
            type: 'email'
        });

        if (verifyResult.error) {
            verifyResult = await supabaseAuth.auth.verifyOtp({
                email,
                token: code,
                type: 'magiclink'
            });
        }

        if (verifyResult.error || !verifyResult.data.user) {
            logger.auth.warn('otp_verify_failed', { error: verifyResult.error?.message });
            return res.status(400).json({ error: verifyResult.error?.message || 'Invalid or expired code' });
        }

        const supabaseAdmin = getSupabaseAdmin();
        await ensureProfileExists(supabaseAdmin, verifyResult.data.user.id, email);

        return res.json({
            ok: true,
            message: 'Verification successful',
            userId: verifyResult.data.user.id,
            session: verifyResult.data.session
                ? {
                    access_token: verifyResult.data.session.access_token,
                    refresh_token: verifyResult.data.session.refresh_token,
                    expires_at: verifyResult.data.session.expires_at,
                }
                : null,
        });

    } catch (err: any) {
        logger.auth.error('otp_verify_exception', err.message || String(err));
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
    // Trim whitespace and lowercase to handle potential formatting issues
    return allowlist.includes(email.trim().toLowerCase());
};

const logDeveloperAccess = (email: string, action: string) => {
    logger.api.info('god_mode_action', { action, env: process.env.NODE_ENV });
    if (process.env.NODE_ENV !== 'production') { console.log(`[GOD MODE] ${email} | ${action}`); }
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
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    let data: any;
    try {
        data = JSON.parse(rawText);
    } catch {
        throw new Error(`Minimax API returned non-JSON response(${response.status}): ${rawText.slice(0, 300)}`);
    }

    if (!response.ok) {
        throw new Error(`Minimax API Error(${response.status}): ${rawText.slice(0, 500)}`);
    }

    const statusCode = Number(data?.base_resp?.status_code ?? 0);
    if (statusCode && statusCode !== 0) {
        const statusMsg = data?.base_resp?.status_msg || data?.base_resp?.status_message || 'Unknown error';
        throw new Error(`Minimax API business error(${statusCode}): ${statusMsg}`);
    }

    return data;
}

function extractMinimaxText(responseData: any): string {
    const content = responseData?.choices?.[0]?.message?.content;

    if (typeof content === 'string' && content.trim()) {
        return content.trim();
    }

    if (Array.isArray(content)) {
        const merged = content
            .map((part: any) => {
                if (typeof part === 'string') return part;
                if (typeof part?.text === 'string') return part.text;
                return '';
            })
            .join(' ')
            .trim();
        if (merged) return merged;
    }

    const fallbackCandidates = [
        responseData?.choices?.[0]?.text,
        responseData?.reply,
        responseData?.output_text,
        responseData?.output?.text,
        typeof responseData?.response === 'string' ? responseData.response : '',
    ];

    const fallback = fallbackCandidates.find((v) => typeof v === 'string' && v.trim().length > 0);
    if (fallback) return fallback.trim();

    throw new Error(`Minimax response missing text payload: ${JSON.stringify(responseData).slice(0, 500)}`);
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
        logger.auth.info('profile_upsert_needed', { userId, email: email?.split('@')[0] + '@...' });

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
            logger.auth.error('profile_upsert_failed', upsertErr.message, { userId });
            // Last resort: try SELECT again (profile might exist but upsert had column issues)
            const { data: retryProfile } = await supabaseAdmin
                .from('profiles')
                .select('id, credits, is_pro, is_admin')
                .eq('id', userId)
                .single();
            const retryProfileTyped = retryProfile as Profile | null;
            if (retryProfileTyped) {
                profile = retryProfileTyped;
                logger.auth.debug('profile_retry_select_ok', { credits: retryProfileTyped.credits, userId });
            } else {
                logger.auth.warn('profile_retry_select_failed', { userId, fallback: '0_credits' });
                // Don't block the user — allow with 0 credits, they'll hit NEED_PAYMENT naturally
                profile = { id: userId, credits: 0, is_pro: false, is_admin: false };
            }
        } else if (newProfile) {
            const newProfileTyped = newProfile as Profile;
            profile = newProfileTyped;
            logger.auth.info('profile_upserted', { credits: newProfileTyped.credits });
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
        const userId = req.user?.id;
        const userEmail = req.user?.email;

        if (!userId || !userEmail) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Check entitlement
        try {
            const supabaseAdmin = getSupabaseAdmin();
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

            // Get profile for regular users
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
            logger.auth.error('entitlement_check_failed', (err as any)?.message || 'Unknown error');
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
    const safeUrl = assertSafePublicUrl(url);
    console.log('[ImageProxy] Downloading image:', url.substring(0, 80) + '...');

    const response = await fetch(safeUrl.toString(), {
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

    return `data:${contentType};base64,${base64}`;
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

        // ★ Diagnostic logging for developer credit issues
        console.log(`[generate-image] userId=${userId}, email="${userEmail}", isDev=${isDeveloper(userEmail)}`);

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

            const promptWithLocks = `${prompt} ${entityRules} ${legacyAnchorRule}`.trim();
            const finalPrompt = appendLockedCastToPrompt(promptWithLocks, storyEntities);
            const nonHumanGuide = detectNonHumanCharacterGuide(
                finalPrompt,
                characterAnchor,
                ...(Array.isArray(storyEntities) ? storyEntities.map((e: any) => `${e?.name || ''} ${e?.description || ''}`) : [])
            );
            const useUniversalGuide = !!referenceImageDataUrl;
            const disableFaceCloning = nonHumanGuide.hasNonHuman || isRemoteImageReference(referenceImageDataUrl);

            const result = await callReplicateImage({
                prompt: finalPrompt,
                model: modelToRun,
                aspectRatio: aspectRatio || '16:9',
                seed: null,
                imagePrompt: useUniversalGuide ? referenceImageDataUrl : undefined,
                referenceImageDataUrl: referenceImageDataUrl,
                disableFaceCloning,
                allowReferenceFallback: true,
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
            return res.status(400).json({ error: '未能检测到清晰的人物面部；如果你在做动物或非人类动画，系统现已自动回退到物种安全模式。若仍失败，请尝试更清晰的参考图或直接使用文本锚点。' });
        }
        const status = Number(err?.status) || 500;
        const isRateLimited = status === 429 || /throttle|rate\s*limit|too many/i.test(String(err?.message || ''));
        if (isRateLimited) {
            return res.status(429).json({
                error: err?.message || '请求过于频繁，触发上游限流，请稍后重试。',
                code: err?.code || 'RATE_LIMITED',
                retry_after: err?.retryAfter,
                detail: err?.detail,
            });
        }
        res.status(status).json({ error: err.message || 'Server error', code: err?.code, retry_after: err?.retryAfter });
    }
});

// Replicate Predict with Reserve / Finalize / Refund
app.post('/api/replicate/predict', requireAuth, async (req: any, res: any) => {
    const traceId: string = req.traceId || generateTraceId();
    let { version, input: rawInput, storyEntities, continuity, project_id, shot_id } = req.body;
    const requireApprovedStoryboard = req.body?.require_approved_storyboard === true;

    // --- Input Validation ---
    if (!version) {
        return res.status(400).json(createErrorResponse(createError.missingField('version'), traceId));
    }

    if (!storyEntities && rawInput && Array.isArray((rawInput as any).storyEntities)) {
        storyEntities = (rawInput as any).storyEntities;
    }

    if (requireApprovedStoryboard && project_id && shot_id) {
        if (!getProjectRuntime(project_id)) {
            await restorePipelineStateFromDB(project_id);
        }
    }
    if (requireApprovedStoryboard && project_id && shot_id && !hasApprovedStoryboard(project_id, shot_id)) {
        logger.pipeline.warn('storyboard_not_approved', { project_id, shot_id }, traceId);
        return res.status(409).json(createErrorResponse(
            createError.storyboardNotApproved(project_id), traceId
        ));
    }

    if (project_id && shot_id && hasApprovedStoryboard(project_id, shot_id)) {
        setProjectStage(project_id, 'video_generating');
    }

    // Log story entities for debugging character consistency
    if (storyEntities && Array.isArray(storyEntities)) {
        const lockedCount = storyEntities.filter((e: any) => e.is_locked && e.type === 'character').length;
        logger.replicate.debug('entities_received', { total: storyEntities.length, locked: lockedCount, project_id, shot_id }, traceId);
    }

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
            logger.payment.error('reserve_failed', reserveErr.message || 'Reserve error', { userId, jobRef }, traceId);
            return res.status(500).json(createErrorResponse(createError.internalError('Credit reserve failed'), traceId));
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
        let input = { ...(rawInput || {}) };

        let continuityProfile = buildContinuityProfile(continuity, {
            characterAnchor: continuity?.project_context?.character_anchor || '',
            visualStyle: continuity?.project_context?.visual_style || '',
            sceneMemory: continuity?.scene_memory || continuity?.shot_context || {},
        });

        const basePromptForLockCheck = [
            typeof input?.prompt === 'string' ? input.prompt : '',
            typeof input?.motion_prompt === 'string' ? input.motion_prompt : '',
            typeof input?.video_prompt === 'string' ? input.video_prompt : '',
        ].join(' ');
        const suppressCharacterLock = shouldSuppressCharacterLock(
            basePromptForLockCheck,
            rawInput?.character_anchor || continuity?.project_context?.character_anchor || '',
            storyEntities || continuity?.project_context?.story_entities
        );
        if (suppressCharacterLock) {
            continuityProfile = {
                ...continuityProfile,
                lockCharacter: false,
                identityAnchorLine: '',
                lockedCastLine: '',
            };
            logger.replicate.debug('continuity_lock_suppressed', { project_id, shot_id }, traceId);
        }

        // Hard-lock to start cast bible (if provided by frontend)
        // BUG FIX #2 & #3: Embed character anchor in BOTH text prompt and video motion prompt
        if (typeof input?.prompt === 'string') {
            if (!suppressCharacterLock) {
                input.prompt = appendLockedCastToPrompt(input.prompt, storyEntities);
            }
            input.prompt = applyContinuityLocks(input.prompt, continuityProfile);
        }

        // BUG FIX #1,#2,#3: Ensure video_prompt includes character identity
        if (typeof input?.motion_prompt === 'string' || typeof input?.video_prompt === 'string') {
            const videoPromptField = input?.motion_prompt ? 'motion_prompt' : 'video_prompt';
            let videoPrompt = input[videoPromptField] || '';
            const characterAnchor = extractCriticalKeywordsFromAnchor(
                rawInput?.character_anchor || continuity?.project_context?.character_anchor || ''
            );
            // Prepend character anchor to video prompt if not already present
            if (!suppressCharacterLock && characterAnchor.length > 0 && videoPrompt) {
                const anchorText = characterAnchor.join(' ');
                if (!videoPrompt.toLowerCase().includes(anchorText.toLowerCase().split(' ')[0])) {
                    videoPrompt = `[CHARACTER: ${anchorText}] ${videoPrompt}`;
                }
            }
            videoPrompt = applyContinuityLocks(videoPrompt, continuityProfile);
            input[videoPromptField] = videoPrompt;
            logger.replicate.debug('i2v_anchor_embedded', { field: videoPromptField, project_id }, traceId);
        }

        // Video continuity safeguard: enforce approved keyframe reference when requested
        if (continuityProfile.usePreviousApprovedAsReference && project_id) {
            const approvedRef = getContinuityReference(project_id, shot_id || '', { preferPrevious: true });
            if (approvedRef && isVideoModelRequest(version)) {
                const currentImage = input.image || input.first_frame_image || input.start_frame || input.reference_image;
                if (!currentImage) {
                    input.first_frame_image = approvedRef;
                    logger.replicate.info('keyframe_injected', { project_id, shot_id }, traceId);
                }
            }
        }
        if (isVideoModelRequest(version)) {
            try {
                input = await preprocessVideoInput(input);
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
                logger.replicate.debug('i2v_frame_aligned', { model: 'wan', field: 'image' }, traceId);
            } else if (version.includes('kling')) {
                input.image = tailFrameImg;
                delete input.first_frame_image;
                logger.replicate.debug('i2v_frame_aligned', { model: 'kling', field: 'image' }, traceId);
            } else if (version.includes('hailuo') || version.includes('minimax')) {
                input.first_frame_image = tailFrameImg;
                logger.replicate.debug('i2v_frame_aligned', { model: 'hailuo', field: 'first_frame_image' }, traceId);
            } else if (version.includes('bytedance') || version.includes('seedance')) {
                input.image = tailFrameImg;
                delete input.first_frame_image;
                logger.replicate.debug('i2v_frame_aligned', { model: 'seedance', field: 'image' }, traceId);
            } else {
                // ALL OTHER MODELS (Sora-2, Veo-3, Runway, etc.) strictly map to "image" by default
                // to prevent the Master Anchor from being dropped by misnamed image schemas.
                input.image = tailFrameImg;
                if (input.first_frame_image) delete input.first_frame_image;
                if (input.start_frame) delete input.start_frame;
                logger.replicate.debug('i2v_frame_aligned', { model: 'universal_fallback', field: 'image' }, traceId);
            }
        }

        const isModelPath = version.includes('/') && !version.match(/^[a-f0-9]{64}$/);
        const targetUrl = isModelPath ? `${base}/models/${version}/predictions` : `${base}/predictions`;

        // BUG FIX #5: Pass negative_prompt to Replicate for identity protection
        // Ensure negative prompt includes character consistency constraints
        if (typeof rawInput?.negative_prompt === 'string' && rawInput.negative_prompt.trim()) {
            input.negative_prompt = buildContinuityNegativePrompt(rawInput.negative_prompt, continuityProfile);
            logger.replicate.debug('negative_prompt_applied', { length: input.negative_prompt.length }, traceId);
        } else if (!input.negative_prompt) {
            // Default negative prompt for character consistency
            input.negative_prompt = buildContinuityNegativePrompt('altered identity, different person, age change, morphing, identity drift, wrong character', continuityProfile);
        }

        const promptField = typeof input?.prompt === 'string' ? 'prompt' : (typeof input?.motion_prompt === 'string' ? 'motion_prompt' : (typeof input?.video_prompt === 'string' ? 'video_prompt' : null));
        if (promptField) {
            const score = scoreContinuityPrompt(String(input[promptField] || ''), continuityProfile);
            const threshold = continuityThreshold(continuityProfile.strictness);
            if (score.overall < threshold) {
                input[promptField] = strengthenPromptForRetry(String(input[promptField] || ''), continuityProfile, 1, score.failures);
                logger.replicate.warn('prompt_strengthened', { score: score.overall.toFixed(2), threshold: threshold.toFixed(2), project_id }, traceId);
            }
        }

        // ★ Heavily restricted: 1 action/shot
        if (promptField && isVideoModelRequest(version)) {
            const strictMotionRule = " CRITICAL MOTION RULE: Perform ONLY ONE single, continuous, and minimal physical action or camera movement. Do NOT change scenes, do NOT jump cut, do NOT perform multiple complex actions, do NOT morph identities. Maintain absolute visual consistency with the first frame.";
            if (!String(input[promptField] || '').includes('CRITICAL MOTION RULE')) {
                input[promptField] = String(input[promptField] || '') + strictMotionRule;
            }
        }

        // ★ Use request queue to avoid Replicate 429 rate limits
        const response = await enqueueReplicateRequest(() =>
            fetch(targetUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    Prefer: 'wait',
                },
                body: JSON.stringify(isModelPath ? { input } : { version, input }),
            })
        );

        if (!response.ok) {
            const errText = await response.text();
            // NSFW fallback retry (sanitized prompt + flux_schnell)
            if (isNsfwError(errText) && input?.prompt) {
                const safePrompt = sanitizePromptForSafety(input.prompt);
                const keepModelForContinuity = continuityProfile.lockStyle && continuityProfile.strictness !== 'low';
                const fallbackVersion = keepModelForContinuity
                    ? version
                    : 'black-forest-labs/flux-schnell';
                const fallbackTargetUrl = `${base}/models/${fallbackVersion}/predictions`;
                const fallbackResponse = await enqueueReplicateRequest(() =>
                    fetch(fallbackTargetUrl, {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                            Prefer: 'wait',
                        },
                        body: JSON.stringify({ input: { ...input, prompt: safePrompt } })
                    })
                );

                if (fallbackResponse.ok) {
                    const prediction = await fallbackResponse.json() as ReplicateResponse;
                    if (keepModelForContinuity) {
                        logger.replicate.warn('nsfw_fallback_kept_model', { reason: 'continuity_lock' }, traceId);
                    }
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
            return res.status(response.status).json(buildReplicateClientError(response.status, errText));
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
        logger.replicate.error('predict_error', (err as any)?.message || String(err));
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

        const response = await enqueueReplicateRequest(() =>
            fetch(`https://api.replicate.com/v1/predictions/${id}`, {
                headers: { Authorization: `Bearer ${token}` }
            })
        );

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

const GEMINI_TEXT_MODEL = 'gemini-2.0-flash';

const getGeminiTextCompletion = async (promptContent: any, options: {
    systemInstruction?: string;
    temperature?: number;
    responseMimeType?: string;
    responseSchema?: any;
    model?: string;
    maxOutputTokens?: number;
} = {}): Promise<string> => {
    const ai = getGeminiAI();
    const modelName = options.model || GEMINI_TEXT_MODEL;

    const generationConfig: any = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    if (options.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = options.maxOutputTokens;
    if (options.responseMimeType) generationConfig.responseMimeType = options.responseMimeType;
    if (options.responseSchema) generationConfig.responseSchema = options.responseSchema;

    const requestConfig: any = { generationConfig };
    if (options.systemInstruction) {
        requestConfig.systemInstruction = options.systemInstruction;
    }

    // @ts-ignore
    const model = ai.models;
    // @ts-ignore
    const result = await ai.models.generateContent({
        model: modelName,
        contents: typeof promptContent === 'string'
            ? [{ role: 'user', parts: [{ text: promptContent }] }]
            : promptContent,
        ...requestConfig,
    });

    // @ts-ignore
    return result?.candidates?.[0]?.content?.parts?.[0]?.text ?? result?.text ?? '';
};

const storyBrainSchema = {
    // @ts-ignore
    type: Type.OBJECT,
    properties: {
        // @ts-ignore
        logline: { type: Type.STRING },
        // @ts-ignore
        world_setting: { type: Type.STRING },
        character_bible: {
            // @ts-ignore
            type: Type.ARRAY,
            items: {
                // @ts-ignore
                type: Type.OBJECT,
                properties: {
                    // @ts-ignore
                    character_id: { type: Type.STRING },
                    // @ts-ignore
                    name: { type: Type.STRING },
                    // @ts-ignore
                    face_traits: { type: Type.STRING },
                    // @ts-ignore
                    hair: { type: Type.STRING },
                    // @ts-ignore
                    outfit: { type: Type.STRING },
                    // @ts-ignore
                    age: { type: Type.STRING },
                    // @ts-ignore
                    body_type: { type: Type.STRING },
                    // @ts-ignore
                    props: { type: Type.STRING },
                },
                required: ['character_id', 'name', 'face_traits'],
            },
        },
        style_bible: {
            // @ts-ignore
            type: Type.OBJECT,
            properties: {
                // @ts-ignore
                color_palette: { type: Type.STRING },
                // @ts-ignore
                lens_language: { type: Type.STRING },
                // @ts-ignore
                lighting: { type: Type.STRING },
            },
        },
        scenes: {
            // @ts-ignore
            type: Type.ARRAY,
            items: {
                // @ts-ignore
                type: Type.OBJECT,
                properties: {
                    // @ts-ignore
                    scene_id: { type: Type.STRING },
                    // @ts-ignore
                    scene_number: { type: Type.INTEGER },
                    // @ts-ignore
                    location: { type: Type.STRING },
                    // @ts-ignore
                    time_of_day: { type: Type.STRING },
                    // @ts-ignore
                    synopsis: { type: Type.STRING },
                    // @ts-ignore
                    emotional_goal: { type: Type.STRING },
                },
                required: ['scene_id', 'scene_number', 'location', 'synopsis'],
            },
        },
    },
    required: ['logline', 'world_setting', 'character_bible', 'style_bible', 'scenes'],
};

const shotListSchema = {
    // @ts-ignore
    type: Type.OBJECT,
    properties: {
        shots: {
            // @ts-ignore
            type: Type.ARRAY,
            items: {
                // @ts-ignore
                type: Type.OBJECT,
                properties: {
                    // @ts-ignore
                    shot_id: { type: Type.STRING },
                    // @ts-ignore
                    shot_number: { type: Type.INTEGER },
                    characters: {
                        // @ts-ignore
                        type: Type.ARRAY,
                        // @ts-ignore
                        items: { type: Type.STRING },
                    },
                    // @ts-ignore
                    action: { type: Type.STRING },
                    // @ts-ignore
                    camera_angle: { type: Type.STRING },
                    // @ts-ignore
                    camera_movement: { type: Type.STRING },
                    // @ts-ignore
                    composition: { type: Type.STRING },
                    // @ts-ignore
                    lighting: { type: Type.STRING },
                    // @ts-ignore
                    duration_sec: { type: Type.INTEGER },
                    // @ts-ignore
                    emotional_beat: { type: Type.STRING },
                    // @ts-ignore
                    transition: { type: Type.STRING },
                    dialogue: {
                        // @ts-ignore
                        type: Type.OBJECT,
                        properties: {
                            // @ts-ignore
                            speaker: { type: Type.STRING },
                            // @ts-ignore
                            line: { type: Type.STRING },
                            // @ts-ignore
                            subtext: { type: Type.STRING },
                        },
                    },
                },
                required: ['shot_id', 'shot_number', 'action', 'camera_movement'],
            },
        },
    },
    required: ['shots'],
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
    const traceId: string = req.traceId || generateTraceId();
    const jobRef = `gemini:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
        const { storyIdea, visualStyle, language, identityAnchor, sceneCount, directorControls } = req.body;
        const safeStoryIdea = sanitizePromptInput(storyIdea, 2500);
        const safeVisualStyle = sanitizePromptInput(visualStyle, 300);
        const safeIdentityAnchor = sanitizePromptInput(identityAnchor, 1000);
        const safeLanguage = language === 'zh' ? 'zh' : 'en';

        // Sanitize director controls (pass through as-is, already typed on client)
        const safeDirectorControls = directorControls && typeof directorControls === 'object'
            ? directorControls
            : undefined;

        if (!safeStoryIdea) {
            return res.status(400).json(createErrorResponse(createError.missingField('storyIdea'), traceId));
        }

        const targetScenes = Math.min(Math.max(Number(sceneCount) || 5, 1), 50);
        const nonHumanGuide = detectNonHumanCharacterGuide(safeStoryIdea, safeIdentityAnchor);

        logger.gemini.info('generate_start', { sceneCount: targetScenes, userId: req.user?.id, hasAnchor: !!safeIdentityAnchor }, traceId);

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
        // ==========================================
        // NEW PIPELINE: STAGE 1 - STORY BRAIN
        // ==========================================
        const { generateStoryBrainPrompt, generateShotListPrompt, buildVideoPrompt, buildImagePrompt } = await import('./promptTemplates.js');

        const storyBrainPrompt = generateStoryBrainPrompt({
            storyIdea: safeStoryIdea,
            visualStyle: safeVisualStyle,
            identityAnchor: safeIdentityAnchor,
            sceneCount: targetScenes,
            directorControls: safeDirectorControls,
        });

        const systemInstruction = `You are an elite cinematic AI director capable of pre-visualizing both character-driven narratives and zero-character sequences.
Output strictly valid JSON according to the schema. No markdown formatting.`;

        let storyBrainResponse = '';
        try {
            storyBrainResponse = await getGeminiTextCompletion(
                storyBrainPrompt,
                {
                    systemInstruction,
                    temperature: 0.7,
                    responseMimeType: 'application/json',
                    responseSchema: storyBrainSchema,
                }
            );
        } catch (initialError: any) {
            logger.gemini.warn('story_brain_retry', { error: initialError.message }, traceId);
            storyBrainResponse = await getGeminiTextCompletion(
                storyBrainPrompt,
                {
                    systemInstruction: systemInstruction + " Ensure strict JSON output.",
                    temperature: 0.5,
                    responseMimeType: 'application/json',
                }
            );
        }

        if (!storyBrainResponse) throw new Error('No response from AI Director (Story Brain).');

        let parsedBrain;
        try {
            parsedBrain = parseAiJsonWithRepair(storyBrainResponse, 'Story Brain');
        } catch (parseError: any) {
            logger.gemini.error('story_brain_parse_failed', parseError.message, {}, traceId);
            throw parseError;
        }

        const project_id = crypto.randomUUID();

        // Build locked characters
        const rawBible = Array.isArray(parsedBrain.character_bible) ? parsedBrain.character_bible : [];
        const story_entities = rawBible.map((c: any) => ({
            id: crypto.randomUUID(),
            type: 'character',
            name: sanitizePromptInput(c.name || 'Unknown', 120),
            description: sanitizePromptInput(
                `${c.face_traits || ''}. Age: ${c.age || 'N/A'}, Body: ${c.body_type || 'N/A'}. Hair: ${c.hair || 'N/A'}. Outfit: ${c.outfit || 'N/A'}. Props: ${c.props || 'none'}.`,
                1200
            ),
            is_locked: true,
            structured_data: c // Save the structured bible for later
        }));

        // Derive a short project title from the story idea (first 60 chars) or logline
        const derivedTitle = safeStoryIdea.length > 0
            ? safeStoryIdea.substring(0, 60).trim()
            : (sanitizePromptInput(parsedBrain.logline || '', 60) || 'Untitled AI Film');

        const project: any = {
            id: project_id,
            project_title: derivedTitle,
            logline: sanitizePromptInput(parsedBrain.logline || '', 260),
            world_setting: sanitizePromptInput(parsedBrain.world_setting || '', 600),
            director_controls: safeDirectorControls || null,
            visual_style: safeVisualStyle,
            project_type: nonHumanGuide.hasNonHuman ? 'hybrid' : 'character_driven',
            has_cast: story_entities.length > 0,
            character_anchor: safeIdentityAnchor || (story_entities[0]?.description) || '',
            story_entities: story_entities,
            style_bible: parsedBrain.style_bible,
            character_bible: parsedBrain.character_bible || [],
            scene_bible: [],
            costume_bible: [],
            prop_bible: [],
            story_plan: {
                logline: sanitizePromptInput(parsedBrain.logline || '', 260),
                short_synopsis: sanitizePromptInput(parsedBrain.world_setting || '', 600),
                beat_sheet: Array.isArray(parsedBrain?.beats) ? parsedBrain.beats : [],
                scene_goals: [],
                role_map: story_entities.map((c: any) => ({
                    character_id: c?.structured_data?.character_id || c.id,
                    name: c.name,
                    function_in_story: 'core narrative role',
                    relationships: [],
                })),
            },
            pipeline_state: {
                current_stage: 'shots_ready',
                stage_history: ['script_ready', 'bible_ready', 'shots_ready'],
            },
            director_brain: null,
            storyboard_12panel: [],
            shot_graph: [],
            character_identity_law: null,
            edit_timeline_plan: null,
            verifier_report: null,
            scenes: []
        };

        // ==========================================
        // NEW PIPELINE: STAGE 2 - SHOT PLANNER
        // ==========================================
        const rawScenes = Array.isArray(parsedBrain.scenes) ? parsedBrain.scenes : [];
        logger.gemini.info('story_brain_done', { scenes: rawScenes.length, targetScenes }, traceId);

        // Director OS layer: build formal directorial planning outputs before shot execution.
        const directorBrain = buildDirectorBrainLayer({
            scenes: rawScenes,
            style_bible: parsedBrain.style_bible || {},
            character_bible: parsedBrain.character_bible || [],
            director_controls: safeDirectorControls || {},
            logline: parsedBrain.logline || '',
        });
        const storyboard12 = build12PanelStoryboard({
            scenes: rawScenes,
            directorBrain,
        });
        const characterIdentityLaw = buildCharacterIdentityLaw({
            character_bible: parsedBrain.character_bible || [],
            character_anchor: project.character_anchor,
            story_entities,
        });

        project.director_brain = directorBrain;
        project.storyboard_12panel = storyboard12;
        project.character_identity_law = characterIdentityLaw;

        const convertedScenes: any[] = [];
        let globalShotIndex = 1;

        // Process scenes sequentially or in small batches to respect rate limits
        for (let i = 0; i < Math.min(rawScenes.length, targetScenes); i++) {
            const scn = rawScenes[i];
            logger.gemini.debug('shot_planner_scene', { scene: i + 1, total: rawScenes.length, location: scn.location }, traceId);
            const fallbackShotCountRaw = Number((scn as any)?.shot_count);
            const fallbackShotCount = Number.isFinite(fallbackShotCountRaw) && fallbackShotCountRaw > 0
                ? Math.min(8, Math.max(1, Math.floor(fallbackShotCountRaw)))
                : 5;

            const shotPrompt = generateShotListPrompt({
                scene: scn,
                characterBible: parsedBrain.character_bible,
                styleBible: parsedBrain.style_bible,
                directorControls: safeDirectorControls,
            });

            let shotResponse = '';
            let parsedShots: any;
            try {
                shotResponse = await getGeminiTextCompletion(
                    shotPrompt,
                    {
                        systemInstruction: "You are a master storyboard artist. Break the scene down into a precise cinematic shot list. Output strict JSON.",
                        temperature: 0.6,
                        responseMimeType: 'application/json',
                        responseSchema: shotListSchema,
                    }
                );
            } catch (shotErr: any) {
                logger.gemini.error('shot_planner_scene_failed', shotErr.message, { scene: i + 1 }, traceId);
                parsedShots = buildFallbackShotResult({
                    sceneNumber: Number(scn?.scene_number) || i + 1,
                    targetShots: fallbackShotCount,
                    visualDescription: sanitizePromptInput(scn?.synopsis || scn?.location || 'Cinematic scene', 600),
                    audioDescription: sanitizePromptInput(scn?.audio_hint || '', 220),
                    shotType: 'cinematic',
                    characterAnchor: safeIdentityAnchor,
                    lockedCharacters: story_entities.map((c: any) => ({
                        name: c.name,
                        description: c.description,
                    })),
                });
            }

            if (!parsedShots) {
                try {
                    parsedShots = parseAiJsonWithRepair(shotResponse, `Shot Planner Scene ${i + 1}`);
                } catch (e) {
                    logger.gemini.warn('shot_planner_parse_failed', { scene: i + 1 }, traceId);
                    parsedShots = buildFallbackShotResult({
                        sceneNumber: Number(scn?.scene_number) || i + 1,
                        targetShots: fallbackShotCount,
                        visualDescription: sanitizePromptInput(scn?.synopsis || scn?.location || 'Cinematic scene', 600),
                        audioDescription: sanitizePromptInput(scn?.audio_hint || '', 220),
                        shotType: 'cinematic',
                        characterAnchor: safeIdentityAnchor,
                        lockedCharacters: story_entities.map((c: any) => ({
                            name: c.name,
                            description: c.description,
                        })),
                    });
                }
            }

            const shots = Array.isArray(parsedShots.shots) ? parsedShots.shots : [];
            logger.gemini.debug('shot_planner_result', {
                scene: i + 1,
                shotsCount: shots.length,
                usedFallback: !shotResponse || !Array.isArray((parsedShots as any)?.shots) || false,
            }, traceId);

            for (let j = 0; j < shots.length; j++) {
                const shot = shots[j];

                // Construct the visual description & image prompt
                const setting = scn.location || 'Unknown Location';
                const timeStr = scn.time_of_day || 'Day';

                // Map character IDs back to names for the UI
                const charNames = Array.isArray(shot.characters)
                    ? shot.characters.map((cid: string) => {
                        const found = parsedBrain.character_bible?.find((c: any) => c.character_id === cid);
                        return found ? found.name : cid;
                    }).filter(Boolean)
                    : [];

                const characterPrefix = charNames.length > 0 ? `Characters: ${charNames.join(', ')}. ` : '';

                // For the UI, we just need to return these as flat "scenes" arrays, because 
                // the frontend App.tsx handles them as `Shot` objects mapped 1:1 to frontend "scenes".
                // We'll mimic the old structure so App.tsx doesn't break initially,
                // while storing the richer metadata.

                const isFirstShotInScene = (j === 0);
                const visualDesc = `${characterPrefix}${setting}, ${timeStr}. ${shot.action}. Camera: ${shot.camera_angle}, ${shot.composition}.`;

                // Generate a rich image prompt for EVERY shot (not just first-in-scene)
                // Use buildImagePrompt from promptTemplates for full richness
                const imagePrompt = buildImagePrompt({
                    shot,
                    scene: scn,
                    characterBible: parsedBrain.character_bible || [],
                    styleBible: parsedBrain.style_bible || {},
                    directorControls: safeDirectorControls,
                });

                // Prepend character anchor to EVERY shot for identity consistency,
                // while shot-specific sections still drive per-shot variance.
                const finalImagePrompt = project.character_anchor
                    ? `${project.character_anchor}. ${imagePrompt}`
                    : imagePrompt;

                // Build a rich video prompt using buildVideoPrompt
                const videoPrompt = buildVideoPrompt({
                    shot,
                    scene: scn,
                    styleBible: parsedBrain.style_bible || {},
                    directorControls: safeDirectorControls,
                    temporalGuidance: (shot as any).temporal_guidance,
                });

                // Build character consistency metadata for every shot
                const anchorKeywords: string[] = project.character_anchor
                    ? project.character_anchor.toLowerCase().split(/[,\s]+/).filter((w: string) => w.length > 3)
                    : [];
                const promptLower = finalImagePrompt.toLowerCase();
                const anchorKeywordsPresent = anchorKeywords.filter((kw: string) => promptLower.includes(kw)).length;
                const consistencyMeta = project.character_anchor
                    ? {
                        has_anchor_prefix: promptLower.startsWith(project.character_anchor.toLowerCase().substring(0, 20)),
                        critical_keywords_present: anchorKeywordsPresent,
                        total_critical_keywords: anchorKeywords.length || 1,
                        anchor_applied: true,
                    }
                    : undefined;

                const sequenceOrder = globalShotIndex++;
                const scenePurpose = i === 0
                    ? 'world_building'
                    : (i === rawScenes.length - 1 ? 'resolution' : 'conflict_escalation');

                if (!project.scene_bible.some((b: any) => b.scene_id === scn.scene_id)) {
                    project.scene_bible.push({
                        scene_id: scn.scene_id,
                        location: setting,
                        architecture_traits: sanitizePromptInput(scn.synopsis || setting, 280),
                        time_of_day: timeStr,
                        weather: 'inferred from scene context',
                        lighting_style: sanitizePromptInput(parsedBrain.style_bible?.lighting || shot.lighting || '', 180),
                        palette: sanitizePromptInput(parsedBrain.style_bible?.color_palette || safeVisualStyle, 180),
                        texture_material: 'cinematic realistic materials',
                        atmosphere: sanitizePromptInput(scn.emotional_goal || '', 180),
                        lens_language: sanitizePromptInput(parsedBrain.style_bible?.lens_language || '', 180),
                        forbidden_scene_drift: ['do not change set geometry', 'do not change lighting motivation'],
                    });
                }

                project.story_plan.scene_goals.push({
                    scene_id: scn.scene_id,
                    scene_number: Number(scn.scene_number) || i + 1,
                    purpose: scenePurpose,
                    narrative_goal: sanitizePromptInput(scn.emotional_goal || scn.synopsis || '', 260),
                    pacing_note: `shot_count:${shots.length}`,
                });

                // duration_sec: prefer Gemini's value; fallback: inverse tension (high tension → shorter shot)
                const tensionFallback = typeof scn.tension_level === 'number'
                    ? Math.max(2, Math.round(8 - (scn.tension_level / 10) * 5))  // tension 10→3s, tension 1→7s
                    : 4;
                const shotDuration = (typeof shot.duration_sec === 'number' && shot.duration_sec > 0)
                    ? shot.duration_sec
                    : tensionFallback;

                convertedScenes.push({
                    scene_number: sequenceOrder, // Frontend expects a flat ordinal
                    scene_setting: setting,
                    characters: charNames,
                    visual_description: visualDesc,
                    audio_description: `Sound of ${shot.action}`,
                    shot_type: `${shot.camera_angle} shot, ${shot.camera_movement}`,
                    shot_id: shot.shot_id || crypto.randomUUID(),
                    scene_id: scn.scene_id,
                    sequence_order: sequenceOrder,
                    duration_sec: shotDuration,          // ★ real Gemini value or tension-aware fallback
                    _duration_is_fallback: typeof shot.duration_sec !== 'number', // debug flag
                    narrative_purpose: sanitizePromptInput(scn.emotional_goal || shot.action || '', 220),
                    // Director beat arc fields — from AI scene data
                    scene_title: sanitizePromptInput(scn.location || `Scene ${i + 1}`, 120),
                    dramatic_function: sanitizePromptInput(scn.dramatic_function || '', 80),
                    tension_level: typeof scn.tension_level === 'number' ? scn.tension_level : null,
                    framing: sanitizePromptInput(shot.composition || '', 220),
                    camera_angle: sanitizePromptInput(shot.camera_angle || 'medium', 80),
                    camera_motion: sanitizePromptInput(shot.camera_movement || 'static', 80),
                    lens_hint: sanitizePromptInput(parsedBrain.style_bible?.lens_language || '', 120),
                    subject_focus: charNames[0] || 'main subject',
                    transition_in: sequenceOrder === 1 ? 'fade_in' : 'cut',
                    transition_out: shot.transition || (sequenceOrder === 1 ? 'fade' : 'cut'),
                    continuity_from_previous: sequenceOrder === 1 ? 'N/A' : 'inherit previous shot appearance and screen direction',
                    continuity_to_next: 'preserve scene memory',
                    validation_rules: {
                        min_continuity_score: 78,
                        min_narrative_score: 70,
                        min_visual_match_score: 75,
                    },

                    // Every shot gets a full image prompt for standalone generation
                    image_prompt: finalImagePrompt,
                    // Flag so the UI can still apply domino chaining for non-first shots
                    is_first_shot_in_scene: isFirstShotInScene,

                    video_motion_prompt: videoPrompt,
                    video_prompt: videoPrompt,

                    // Dialogue + emotional beat fields from Gemini shot planner
                    dialogue_speaker: shot.dialogue?.speaker || null,
                    dialogue_text: shot.dialogue?.line || null,
                    dialogue_subtext: shot.dialogue?.subtext || null,
                    emotional_beat: sanitizePromptInput(shot.emotional_beat || scn.emotional_goal || '', 200),

                    // Store the rich structured data for later API usage
                    _bible_context: {
                        scene_id: scn.scene_id,
                        shot_action: shot.action,
                        lighting: shot.lighting,
                        composition: shot.composition
                    },

                    // Character consistency validation metadata (only on first shot of each scene where image_prompt is set)
                    ...(consistencyMeta ? { _consistency_check: consistencyMeta } : {}),
                });
            }
        }

        project.scenes = convertedScenes;

        // ==========================================
        // DIRECTOR OS — Per-layer tracked execution
        // Each layer is independent. Failures are recorded, not thrown.
        // CRITICAL layers (character_identity, temporal_guidance, verifier)
        // emit loud warnings and are exposed on the response.
        // ==========================================
        const osLayers: Record<string, { pass: boolean; error?: string }> = {
            director_brain:     { pass: false },
            storyboard_12panel: { pass: false },
            character_identity: { pass: false },
            shot_graph:         { pass: false },
            temporal_guidance:  { pass: false },
            edit_plan:          { pass: false },
            verifier:           { pass: false },
        };

        // Layer 1 — Director Brain
        try {
            const directorBrain = buildDirectorBrainLayer({
                scenes: rawScenes,
                style_bible: parsedBrain.style_bible,
                character_bible: parsedBrain.character_bible,
                director_controls: safeDirectorControls,
                logline: parsedBrain.logline,
            });
            project.director_brain = directorBrain;
            osLayers.director_brain = { pass: true };
        } catch (e: any) {
            osLayers.director_brain = { pass: false, error: e.message };
            logger.gemini.warn('director_os_layer_fail', { layer: 'director_brain', error: e.message }, traceId);
        }

        // Layer 2 — 12-Panel Storyboard
        let ospanels: any[] = [];
        try {
            ospanels = build12PanelStoryboard({
                scenes: rawScenes,
                shots: convertedScenes,
                directorBrain: project.director_brain,
            });
            project.storyboard_12panel = ospanels;
            osLayers.storyboard_12panel = { pass: true };
        } catch (e: any) {
            osLayers.storyboard_12panel = { pass: false, error: e.message };
            logger.gemini.warn('director_os_layer_fail', { layer: 'storyboard_12panel', error: e.message }, traceId);
        }

        // Layer 3 — Character Identity Law (CRITICAL)
        try {
            const identityLaw = buildCharacterIdentityLaw({
                character_bible: parsedBrain.character_bible,
                character_anchor: safeIdentityAnchor,
                story_entities,
            });
            project.character_identity_law = identityLaw;
            osLayers.character_identity = { pass: true };
        } catch (e: any) {
            osLayers.character_identity = { pass: false, error: e.message };
            logger.gemini.warn('director_os_CRITICAL_layer_fail', { layer: 'character_identity', error: e.message }, traceId);
        }

        // Layer 4 — Shot Graph + temporal guidance injection (CRITICAL)
        let osShotGraph: any[] = [];
        try {
            osShotGraph = buildShotGraph({ shots: convertedScenes, panels: ospanels });
            project.shot_graph = osShotGraph;
            let linkedCount = 0;
            osShotGraph.forEach((node) => {
                const scene = project.scenes.find((s: any) => s.shot_id === node.shot_id);
                if (scene) {
                    scene.panel_id           = node.panel_id;
                    scene.panel_index        = node.panel_index;
                    scene.prev_shot_id       = node.prev_shot_id;
                    scene.next_shot_id       = node.next_shot_id;
                    scene.entering_state     = node.entering_state;
                    scene.exiting_state      = node.exiting_state;
                    scene.continuity_in      = node.continuity_in;
                    scene.continuity_out     = node.continuity_out;
                    scene.motion_bridge      = node.motion_bridge;
                    scene.expression_bridge  = node.expression_bridge;
                    scene.environment_bridge = node.environment_bridge;
                    scene.object_bridge      = node.object_bridge;
                    scene.temporal_guidance  = node.temporal_guidance;
                    if (node.temporal_guidance) linkedCount += 1;
                }
            });
            osLayers.shot_graph = { pass: true };
            if (linkedCount > 0) {
                osLayers.temporal_guidance = { pass: true };
            } else {
                osLayers.temporal_guidance = { pass: false, error: 'zero shots received temporal_guidance — check buildShotGraph output' };
                logger.gemini.warn('director_os_CRITICAL_layer_fail', { layer: 'temporal_guidance', linkedCount }, traceId);
            }
        } catch (e: any) {
            osLayers.shot_graph        = { pass: false, error: e.message };
            osLayers.temporal_guidance = { pass: false, error: e.message };
            logger.gemini.warn('director_os_CRITICAL_layer_fail', { layer: 'shot_graph', error: e.message }, traceId);
        }

        // Layer 5 — Edit Plan
        try {
            const editPlan = buildEditPlan({ project_id, shots: convertedScenes });
            project.edit_timeline_plan = editPlan;
            osLayers.edit_plan = { pass: true };
        } catch (e: any) {
            osLayers.edit_plan = { pass: false, error: e.message };
            logger.gemini.warn('director_os_layer_fail', { layer: 'edit_plan', error: e.message }, traceId);
        }

        // Layer 6 — Verifier (CRITICAL — must detect identity/continuity/audio-video errors)
        try {
            const verifier = buildVerificationReport({
                project,
                shots: convertedScenes,
                shotGraph: osShotGraph,
                timelinePlan: project.edit_timeline_plan,
            });
            project.verifier_report = verifier;
            osLayers.verifier = { pass: true };
            if (!verifier.pass) {
                logger.gemini.warn('director_os_verifier_fail', {
                    score: verifier.overall_score,
                    failures: verifier.failures,
                    repair_count: verifier.repair_entries?.length ?? 0,
                }, traceId);
            }
        } catch (e: any) {
            osLayers.verifier = { pass: false, error: e.message };
            logger.gemini.warn('director_os_CRITICAL_layer_fail', { layer: 'verifier', error: e.message }, traceId);
        }

        // Expose layer status + degraded-mode flags on the response object
        const degradedLayers = Object.entries(osLayers)
            .filter(([, v]) => !v.pass)
            .map(([k]) => k);
        const criticalFailed = ['character_identity', 'temporal_guidance', 'verifier']
            .filter(k => !osLayers[k]?.pass);
        (project as any).director_os_layers          = osLayers;
        (project as any).director_os_degraded        = degradedLayers.length > 0;
        (project as any).director_os_critical_failures = criticalFailed;

        logger.gemini.info('director_os_summary', {
            layers: osLayers,
            degraded: (project as any).director_os_degraded,
            critical_failures: criticalFailed,
        }, traceId);

        logger.gemini.info('generate_complete', {
            project_id,
            convertedScenes: convertedScenes.length,
            targetScenes,
        }, traceId);
        initProjectRuntime({
            projectId: project_id,
            shots: convertedScenes.map((s: any) => ({
                shot_id: s.shot_id || `shot-${s.scene_number}`,
                scene_id: s.scene_id,
                sequence_order: s.sequence_order || s.scene_number,
                shot_number: s.scene_number,
            })),
            stage: 'shots_ready',
        });
        setProjectStage(project_id, 'shots_ready');
        project.pipeline_state.current_stage = 'shots_ready';

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

        console.log(`[MiniMax Analyze] MIME: ${mimeType}, base64 length: ${cleanBase64.length}, hasPrefix: ${base64Data.startsWith('data:')}`);

        const analyzePrompt = `You are a professional character designer. Analyze the provided image and produce an EXACT visual identity description for AI image generation.

    **CRITICAL: OBSERVE THE ACTUAL IMAGE. DO NOT GUESS.**
    - Determine if the subject is human, animal, creature, or toy.
    - Describe EXACTLY what you SEE.
    - Paragraph format.

    **Rules:**
    - Output ONLY the description paragraph.
    - Use English.`;

        // MiniMax Vision uses ChatCompletion V2 with base64 content
        const apiKey = getMinimaxApiKey();
        const payload = {
            model: "MiniMax-Text-01",
            messages: [
                { role: "system", name: "System", content: "You are a vision analysis assistant." },
                {
                    role: "user",
                    name: "User",
                    content: [
                        { type: "text", text: analyzePrompt },
                        {
                            type: "image_url",
                            image_url: {
                                url: base64Data.startsWith('data:') ? base64Data : `data:${mimeType};base64,${cleanBase64}`
                            }
                        }
                    ]
                }
            ]
        };

        const response = await fetch(MINIMAX_TEXT_API, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const rawText = await response.text();
        if (!response.ok) throw new Error(`MiniMax Vision Error: ${rawText.slice(0, 500)}`);

        const data = await response.json();
        const anchor = extractMinimaxText(data);
        res.json({ anchor });
    } catch (error: any) {
        console.error('[Gemini Analyze] ❌ Error:', (error as any).message);
        res.status(500).json({ error: (error as any).message || 'Analyze failed', anchor: 'A cinematic character' });
    }
});

app.post('/api/gemini/analyze-bible', requireAuth, async (req: any, res: any) => {
    try {
        const { base64Data } = req.body;
        if (!base64Data) return res.status(400).json({ error: 'Missing base64Data' });

        const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        let mimeType = 'image/jpeg';

        const prefixMatch = base64Data.match(/^data:(image\/[a-zA-Z+]+);base64,/);
        if (prefixMatch) {
            mimeType = prefixMatch[1];
        } else {
            if (cleanBase64.startsWith('/9j/')) mimeType = 'image/jpeg';
            else if (cleanBase64.startsWith('iVBOR')) mimeType = 'image/png';
            else if (cleanBase64.startsWith('UklGR')) mimeType = 'image/webp';
            else if (cleanBase64.startsWith('R0lGO')) mimeType = 'image/gif';
        }

        console.log(`[Gemini Analyze Bible] MIME: ${mimeType}, base64 length: ${cleanBase64.length}`);

        const analyzePrompt = `You are a professional cinematographer and AI generation expert. Analyze this image to produce an EXACT visual identity guide.

    Output a JSON object with two top-level keys: \`bible\` and \`anchorPackage\`.
    
    \`bible\` MUST have these keys: 
    - (strings) main_subject, subject_shape, key_facial_features, wardrobe, environment_type, building_geometry, skyline_composition, camera_angle, lens_feeling, time_of_day, lighting_direction, motion_intention, forbidden_changes
    - (strings) architecture_signature, composition_signature, camera_signature, lighting_signature
    - (numbers 0-100) motion_budget (how much motion the subject implies), drift_budget (how much the background can reasonably change without breaking continuity)

    \`anchorPackage\` MUST have these keys:
    - reference_image_path: "" (leave empty)
    - anchor_subject_description: (string describing the subject exactly)
    - anchor_environment_description: (string describing the exact environment)
    - anchor_camera_description: (string describing camera setup)
    - anchor_style_description: (style details)
    - negative_constraints: (A comma-separated string of what to avoid to prevent drift from this image)
    - immutable_elements: (array of strings, e.g. ["character face", "background skyline", "jacket color"])
    - allowed_motion_only: (string detailing what subtle motion is acceptable, like "subtle camera push-in, clothes rustling in wind")

    **Rules:**
    - Output ONLY valid JSON. Do not include markdown formatting or backticks around the json.
    - Be exhaustive and hyper-detailed in describing physical aspects to prevent AI models from hallucinating new details.`;

        const result = await getGeminiTextCompletion(
            [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType, data: cleanBase64 } },
                    { text: analyzePrompt }
                ]
            }],
            {
                systemInstruction: 'You are an exacting cinematic analyst. Return strictly valid JSON.',
                model: GEMINI_TEXT_MODEL,
                temperature: 0.1,
            }
        );

        const data = parseAiJsonWithRepair(result, 'analyze-bible');
        res.json(data);
    } catch (error: any) {
        console.error('[Gemini Analyze Bible] ❌ Error:', error.message);
        res.status(500).json({ error: error.message || 'Analyze bible failed' });
    }
});

app.post('/api/gemini/validate-video', requireAuth, async (req: any, res: any) => {
    try {
        const { extractedFrameBase64, anchorPackage, threshold = 85 } = req.body;
        if (!extractedFrameBase64 || !anchorPackage) return res.status(400).json({ error: 'Missing required fields' });

        const cleanBase64 = extractedFrameBase64.includes(',') ? extractedFrameBase64.split(',')[1] : extractedFrameBase64;
        let mimeType = 'image/jpeg';
        const prefixMatch = extractedFrameBase64.match(/^data:(image\/[a-zA-Z+]+);base64,/);
        if (prefixMatch) mimeType = prefixMatch[1];

        const analyzePrompt = `You are a strict cinematic continuity supervisor.
        You are given an extracted frame from an AI generated video.
        You must compare this frame against the original Anchor Package constraints.
        
        Anchor Package Constraints:
        Subject: ${anchorPackage.anchor_subject_description}
        Environment: ${anchorPackage.anchor_environment_description}
        Camera: ${anchorPackage.anchor_camera_description}
        Lighting/Style: ${anchorPackage.anchor_style_description}
        Immutable Elements: ${anchorPackage.immutable_elements?.join(', ')}
        Negative Constraints (Things to avoid): ${anchorPackage.negative_constraints}

        Task:
        1. Evaluate if the subject in the image strictly matches the Anchor Package subject.
        2. Evaluate if the environment/background architecture matches exactly or has drifted.
        3. Evaluate if the styling and lighting match.
        4. Give a score from 0 to 100 on how identical this frame is to the exact parameters of the Anchor Package.
           (100 = perfect match, 85 = minor acceptable variance, <85 = drifted subject, drifted background, or lost architecture).
        
        Output a JSON object with these keys:
        - score: number (0-100)
        - feedback: string (reasoning for the score, pointing out any specific drift in geometry, subject, or lighting)
        - passed: boolean (true if score >= ${threshold})
        
        ONLY output valid JSON without markdown wrapping.`;

        const result = await getGeminiTextCompletion(
            [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType, data: cleanBase64 } },
                    { text: analyzePrompt }
                ]
            }],
            {
                systemInstruction: 'You are a highly critical VFX continuity supervisor. Output strictly JSON.',
                model: GEMINI_TEXT_MODEL,
                temperature: 0.1,
            }
        );

        const data = parseAiJsonWithRepair(result, 'validate-video');
        res.json(data);
    } catch (error: any) {
        console.error('[Gemini Validate Video] ❌ Error:', error.message);
        res.status(500).json({ error: error.message || 'Validation failed' });
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
    negativePrompt?: string;
    imagePrompt?: string; // ★ URL or data URL of reference image for Flux Redux — visual consistency anchor
    referenceImageDataUrl?: string; // ★ Base64 of user photo for Face Cloning
    disableFaceCloning?: boolean; // ★ For animals / non-human characters: avoid human-only face alignment
    allowReferenceFallback?: boolean; // ★ Retry with image-guided/text mode if face alignment fails
}): Promise<{ url: string; predictionId: string }> {
    const token = getReplicateToken();
    const normalizedReference = String(params.referenceImageDataUrl || '').trim() || undefined;
    const hasUniversalReference = !!normalizedReference;
    const shouldPreferGuideReference = hasUniversalReference && isRemoteImageReference(normalizedReference);
    const isFaceCloning = !!normalizedReference && !params.disableFaceCloning && !shouldPreferGuideReference;
    const referenceGuideImage = params.imagePrompt || normalizedReference;

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

    if (!isFaceCloning && params.negativePrompt) {
        input.negative_prompt = params.negativePrompt;
    }

    if (!isFaceCloning && (modelPath.includes('flux-1.1-pro') || modelPath.includes('flux-pro'))) {
        input.prompt_upsampling = false; // ★ LOCK: Prevent Flux from rewriting prompts differently per image
    }

    if (params.seed != null && !isFaceCloning) input.seed = params.seed;

    // ★ FLUX REDUX — Image-guided generation for extreme character/style consistency
    if (referenceGuideImage && (modelPath.includes('flux-1.1-pro') || modelPath.includes('flux-pro')) && !isFaceCloning) {
        input.image_prompt = referenceGuideImage;
        console.log(`[Replicate] ★ Redux: image_prompt set (${referenceGuideImage.substring(0, 60)}...)`);
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
        const parsed = parseReplicateErrorText(errText);
        const isRateLimited = response.status === 429 || /throttle|rate\s*limit|too many/i.test(parsed.message);
        const error: any = new Error(
            isRateLimited
                ? (parsed.retryAfter ? `请求过于频繁，请在 ${parsed.retryAfter} 秒后重试。` : '请求过于频繁，请稍后重试。')
                : (parsed.message || `Replicate error ${response.status}`)
        );
        error.status = response.status;
        error.code = isRateLimited ? 'RATE_LIMITED' : parsed.code;
        error.retryAfter = parsed.retryAfter;
        error.detail = parsed.detail;
        throw error;
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
            if (params.referenceImageDataUrl && params.allowReferenceFallback !== false) {
                console.warn('[Replicate] Face alignment failed, retrying with species-safe reference fallback');
                return await callReplicateImage({
                    ...params,
                    disableFaceCloning: true,
                    allowReferenceFallback: false,
                });
            }
            throw new Error('FACE_ALIGN_FAIL');
        }
        throw new Error(errorMsg || 'Image generation failed');
    }
    const output = prediction.output;
    return { url: Array.isArray(output) ? output[0] : output, predictionId: prediction.id };
}

function buildFinalPrompt(params: {
    basePrompt: string; deltaInstruction?: string; characterAnchor?: string; style?: string; referencePolicy?: string; storyEntities?: any[]; suppressCharacterLock?: boolean;
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
    if (!params.suppressCharacterLock && Array.isArray(params.storyEntities)) {
        const lockedEntities = params.storyEntities.filter(e => e.is_locked);
        if (lockedEntities.length > 0) {
            const entityString = lockedEntities.map(e => `[${e.type.toUpperCase()}: ${e.name}] ${e.description}`).join(' | ');
            parts.push(`[STORY ENTITY LOCK] ${entityString}`);
            hasEntityAnchor = entityString.toLowerCase().includes('[character:');
        }
    }

    // ★ POSITION 3: LEGACY CHARACTER ANCHOR (Fallback if storyEntities is missing/empty)
    if (!params.suppressCharacterLock && params.characterAnchor && params.referencePolicy !== 'none' && !hasEntityAnchor) {
        parts.push(`Same character throughout: ${params.characterAnchor}`);
    }

    // ★ POSITION 4: SHOT-SPECIFIC CONTENT
    parts.push(params.basePrompt);
    if (params.deltaInstruction) parts.push(`Edit: ${params.deltaInstruction}`);
    // ★ POSITION 4: IDENTITY LOCK SUFFIX — maximum consistency enforcement
    if (!params.suppressCharacterLock) {
        parts.push('IDENTITY LOCK: same person, identical face, identical hairstyle, identical outfit and accessories, same skin tone, same body proportions. Same color grading, same lighting setup, same film grain, same art direction across all frames');
    }
    return parts.join('. ');
}

function shouldSuppressCharacterLock(basePrompt: string, characterAnchor?: string, storyEntities?: any[]): boolean {
    const p = sanitizePromptInput(basePrompt || '', 2400).toLowerCase();
    if (!p) return false;

    const explicitNoCharacter = /\b(no\s+(people|person|characters?|humans?)|without\s+(people|person|characters?|humans?)|environment\s*only|architecture\s*only|cityscape\s*only|empty\s+street)\b/i.test(p);
    if (explicitNoCharacter) return true;

    const disasterKeywords = [
        'meteor', 'meteorite', 'explosion', 'blast', 'shockwave', 'skyscraper', 'building', 'city street',
        'debris', 'smoke', 'fireball', 'burning sky', 'falling meteors', 'disaster', 'collapse', 'evacuation',
        'apocalypse', 'earthquake', 'tsunami', 'wildfire'
    ];
    const disasterHits = disasterKeywords.reduce((acc, kw) => acc + (p.includes(kw) ? 1 : 0), 0);

    const anchorTokens = extractCriticalKeywordsFromAnchor(characterAnchor || '')
        .map((t) => t.toLowerCase())
        .filter((t) => t.length > 2);
    const mentionAnchor = anchorTokens.some((t) => p.includes(t));

    const lockedNames = Array.isArray(storyEntities)
        ? storyEntities
            .filter((e: any) => !!e?.is_locked && normalizeEntityType(e?.type) === 'character')
            .map((e: any) => String(e?.name || '').toLowerCase().trim())
            .filter(Boolean)
        : [];
    const mentionLockedName = lockedNames.some((n: string) => p.includes(n));

    return disasterHits >= 2 && !mentionAnchor && !mentionLockedName;
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

const countWords = (text: string): number =>
    sanitizePromptInput(text || '', 4000).split(/\s+/).filter(Boolean).length;

const normalizeShotScale = (camera: string): string => {
    const c = String(camera || '').toLowerCase();
    if (c.includes('ecu')) return 'extreme close-up';
    if (c.includes('close')) return 'close-up';
    if (c.includes('medium')) return 'medium shot';
    if (c.includes('over-shoulder')) return 'over-shoulder medium shot';
    if (c.includes('pov')) return 'POV shot';
    if (c.includes('aerial')) return 'aerial wide shot';
    if (c.includes('two-shot')) return 'two-shot';
    return 'wide shot';
};

function buildProfessionalImagePrompt(params: {
    rawPrompt?: string;
    visualStyle?: string;
    characterAnchor?: string;
    sceneDescription?: string;
    shot: any;
}): string {
    const base = sanitizePromptInput(params.rawPrompt || '', 1200);
    const shot = params.shot || {};
    const shotScale = normalizeShotScale(shot.camera || 'wide');
    const lens = sanitizePromptInput(shot.lens || '35mm cinematic prime lens', 120);
    const movement = sanitizePromptInput(shot.movement || 'static', 80);
    const location = sanitizePromptInput(shot.location || 'cinematic environment', 180);
    const tod = sanitizePromptInput(shot.time_of_day || 'night', 80);
    const action = sanitizePromptInput(shot.action || 'subject performs a meaningful physical action', 220);
    const composition = sanitizePromptInput(shot.composition || 'foreground-midground-background depth layering, leading lines, negative space balance', 220);
    const lighting = sanitizePromptInput(shot.lighting || 'motivated key light, subtle rim light, volumetric atmosphere, realistic contrast rolloff', 220);
    const mood = sanitizePromptInput(shot.mood || 'cinematic dramatic mood', 120);
    const style = sanitizePromptInput(params.visualStyle || 'cinematic live-action realism', 120);
    const anchor = sanitizePromptInput(params.characterAnchor || '', 400);
    const scene = sanitizePromptInput(params.sceneDescription || '', 260);

    const enforced = [
        base,
        `[SHOT DESIGN]: ${shotScale}, eye-line coherent camera placement, lens choice ${lens}, camera motion ${movement}.`,
        anchor ? `[IDENTITY LOCK]: ${anchor}. NO HALLUCINATION. DO NOT change facial features, race, gender, body proportions, or wardrobe.` : '',
        `[BLOCKING]: ${action}.`,
        `[SCENE TOPOLOGY LOCK]: ${location}, ${tod}, atmospheric continuity with scene context ${scene || 'consistent set geography'}. Keep exact architectural geometry, room layout, and background elements stable. DO NOT drift or hallucinate new environment structures.`,
        `[COMPOSITION]: ${composition}.`,
        `[LIGHTING & COLOR]: ${lighting}, color script aligned with ${style}. Maintain exact color temperature and shadow direction.`,
        `[TEXTURE & RENDER]: photoreal cinematic image, micro-texture detail, physically plausible reflections, high dynamic range.`
    ].filter(Boolean).join(' ');

    return sanitizePromptInput(enforced, 1800);
}

function buildProfessionalVideoPrompt(params: {
    rawPrompt?: string;
    shot: any;
    characterAnchor?: string;
}): string {
    const base = sanitizePromptInput(params.rawPrompt || '', 1000);
    const shot = params.shot || {};
    const shotScale = normalizeShotScale(shot.camera || 'medium');
    const movement = sanitizePromptInput(shot.movement || 'static', 120);
    const action = sanitizePromptInput(shot.action || 'subject shifts weight, turns head, then takes one decisive step', 260);
    const location = sanitizePromptInput(shot.location || 'same scene location', 140);
    const lighting = sanitizePromptInput(shot.lighting || 'consistent motivated lighting', 160);
    const anchor = sanitizePromptInput(params.characterAnchor || '', 300);

    const enforced = [
        base,
        `[CAMERA PLAN]: ${shotScale}, ${movement}.`,
        `[TIMED BLOCKING]: second 0-1 settle frame and breathing micro-motion; second 1-2 ${action}; second 2-3 add a clear head/hand/body secondary action; final beat hold for edit point.`,
        anchor ? `[IDENTITY LOCK]: KEEP EXACT SAME SUBJECT IDENTITY AND WARDROBE. ZERO TOLERANCE FOR FACE/BODY DRIFT - ${anchor}.` : '[IDENTITY LOCK]: keep exact same subject identity and wardrobe.',
        `[SCENE TOPOLOGY LOCK]: remain in exact same ${location}, keep lighting logic ${lighting}. DO NOT hallucinate new geometry. NO environment jump. NO costume drift. DO NOT change background.`
    ].filter(Boolean).join(' ');

    return sanitizePromptInput(enforced, 1600);
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
        shots: {
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
    → MUST include: camera operation + actor blocking + timing beats + environment continuity.
    → Minimum detail density: 35+ words, with explicit body mechanics.
   
   ✓ GOOD EXAMPLES:
   • "Camera slowly pushes forward 2 feet. Man in blue suit turns head 90 degrees right, eyes widening. His right hand lifts to chest level."
   • "Handheld camera follows woman walking briskly forward. She suddenly stops, body tensing. Head whips left toward off-screen sound."
   • "Static shot. Rain falls vertically. Character in red coat enters frame left, walks diagonally toward camera, stops at center."
   
   ✗ BAD EXAMPLES (Will fail in AI video):
   • "She feels devastated and time seems to stop" ← Abstract, no physical action
   • "He realizes the truth" ← Mental state, not motion
   • "The scene becomes emotional" ← Vague, no kinetics
   
    → MANDATORY ELEMENTS in video_prompt:
    • Camera operation: move direction + speed + stability (e.g. "slow steadicam push-in")
    • Blocking path: where subject starts, how subject moves, where subject ends
    • Body mechanics: torso/head/hand/foot actions, eye-line change
    • Environmental interaction: touches, grabs, opens, avoids, reacts to concrete object
    • Timing language: "0-1s", "1-2s", "final beat hold" style sequencing
    • Continuity locks: same location, same wardrobe, same identity, no scene jump

✅ **RULE 6: IMAGE PROMPT EXCELLENCE**
    → "image_prompt" = ELITE Midjourney/Flux prompt (minimum 70 words, no generic filler)
    → Must include ALL: Shot scale + camera height + lens + subject blocking + foreground/midground/background design + light source logic + contrast/color script + texture realism + production mood
    → Must explicitly declare near/mid/far planes, e.g. foreground object, subject plane, deep background architecture
    → Must include professional optics language: focal length feel, depth-of-field behavior, perspective compression/stretch
    → Example structure:
      [SHOT SCALE] [CAMERA HEIGHT/ANGLE] [LENS LOOK] [SUBJECT ACTION] [FG/MG/BG DEPTH] [LIGHTING SETUP] [COLOR PALETTE] [MATERIAL TEXTURE] [FINAL CINEMA QUALITY TAGS]

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
        let result: any = null;
        try {
            responseText = await getGeminiTextCompletion(
                `Break Scene ${scene_number || 1} into ${targetShots} shots. Scene description: ${visual_description}`,
                {
                    systemInstruction,
                    temperature: 0.6,
                    responseMimeType: 'application/json',
                    responseSchema: directorSchema,
                }
            );
        } catch (initialError: any) {
            logger.gemini.warn('shots_primary_retry', { error: initialError.message });
            try {
                responseText = await getGeminiTextCompletion(
                    `Break Scene ${scene_number || 1} into ${targetShots} shots. Scene description: ${visual_description}`,
                    {
                        systemInstruction: systemInstruction + "\nOutput strictly valid JSON, no markdown formatting.",
                        temperature: 0.5,
                        responseMimeType: 'application/json',
                    }
                );
            } catch (retryError: any) {
                logger.gemini.warn('shots_fallback_planner', { reason: 'gemini_unavailable', error: retryError?.message || String(retryError) });
                result = buildFallbackShotResult({
                    sceneNumber: Number(scene_number) || 1,
                    targetShots,
                    visualDescription: sanitizePromptInput(visual_description, 1800),
                    audioDescription: sanitizePromptInput(audio_description, 400),
                    shotType: sanitizePromptInput(shot_type, 200),
                    characterAnchor: sanitizePromptInput(character_anchor, 1000),
                    lockedCharacters,
                });
            }
        }

        if (!result) {
            const text = responseText;

            if (!text) {
                logger.gemini.warn('shots_fallback_planner', { reason: 'empty_response' });
                result = buildFallbackShotResult({
                    sceneNumber: Number(scene_number) || 1,
                    targetShots,
                    visualDescription: sanitizePromptInput(visual_description, 1800),
                    audioDescription: sanitizePromptInput(audio_description, 400),
                    shotType: sanitizePromptInput(shot_type, 200),
                    characterAnchor: sanitizePromptInput(character_anchor, 1000),
                    lockedCharacters,
                });
            } else {
                try {
                    result = parseAiJsonWithRepair(text, 'Shots Generate');
                } catch (parseError: any) {
                    logger.gemini.warn('shots_fallback_planner', { reason: 'json_parse_failed', error: parseError.message });
                    result = buildFallbackShotResult({
                        sceneNumber: Number(scene_number) || 1,
                        targetShots,
                        visualDescription: sanitizePromptInput(visual_description, 1800),
                        audioDescription: sanitizePromptInput(audio_description, 400),
                        shotType: sanitizePromptInput(shot_type, 200),
                        characterAnchor: sanitizePromptInput(character_anchor, 1000),
                        lockedCharacters,
                    });
                }
            }
        }

        const shotArray = Array.isArray(result?.shots) ? result.shots : [];
        const sourceShots = shotArray.length > 0 ? shotArray : buildFallbackShotResult({
            sceneNumber: Number(scene_number) || 1,
            targetShots,
            visualDescription: sanitizePromptInput(visual_description, 1800),
            audioDescription: sanitizePromptInput(audio_description, 400),
            shotType: sanitizePromptInput(shot_type, 200),
            characterAnchor: sanitizePromptInput(character_anchor, 1000),
            lockedCharacters,
        }).shots;

        const enrichedShots = sourceShots.map((s: any, idx: number) => {
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

            const professionalImagePrompt = buildProfessionalImagePrompt({
                rawPrompt: s.image_prompt || '',
                visualStyle: visual_style,
                characterAnchor: character_anchor || lockedCharacters.map((c: any) => c.description).filter(Boolean).join(' | '),
                sceneDescription: visual_description,
                shot: s,
            });

            const professionalVideoPrompt = buildProfessionalVideoPrompt({
                rawPrompt: s.video_prompt || '',
                shot: s,
                characterAnchor: character_anchor || lockedCharacters.map((c: any) => c.description).filter(Boolean).join(' | '),
            });

            const baseNegative = sanitizePromptInput(s.negative_prompt || '', 900);
            const enforcedNegative = sanitizePromptInput(
                `${baseNegative} identity drift, face swap, age shift, body proportion change, wardrobe drift, style drift, environment jump, extra fingers, distorted anatomy, low detail texture, flat lighting, cartoon stylization`,
                1100
            );

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
                audio_notes: s.audio_notes || '',
                continuity_notes: s.continuity_notes || `Maintain exact identity lock. ${character_anchor || lockedCharacters.map(c => c.description).join(' | ') || 'Keep same protagonist face, hairstyle, body proportions, and wardrobe.'} Preserve left-right screen direction and no costume drift.`,
                image_prompt: countWords(professionalImagePrompt) < 35
                    ? buildProfessionalImagePrompt({ rawPrompt: '', visualStyle: visual_style, characterAnchor: character_anchor, sceneDescription: visual_description, shot: s })
                    : professionalImagePrompt,
                video_prompt: countWords(professionalVideoPrompt) < 22
                    ? buildProfessionalVideoPrompt({ rawPrompt: '', shot: s, characterAnchor: character_anchor })
                    : professionalVideoPrompt,
                negative_prompt: enforcedNegative,
                seed_hint: null, reference_policy: 'anchor' as const,
                status: 'draft' as const, locked_fields: [], version: 1,
                updated_at: new Date().toISOString(),
                characters: normalizedCharacters,
            };
        });

        if (!skipCreditCheck) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'shots', ref_id: jobRef });
        }

        const inferredProjectId = sanitizePromptInput(req.body?.project_id || req.body?.projectId || '', 100);
        if (inferredProjectId) {
            initProjectRuntime({
                projectId: inferredProjectId,
                shots: enrichedShots.map((s: any) => ({
                    shot_id: s.shot_id,
                    scene_id: s.scene_id,
                    sequence_order: s.shot_number,
                    shot_number: s.shot_number,
                })),
                stage: 'shots_ready',
            });
            setProjectStage(inferredProjectId, 'shots_ready');
        }

        res.json({ scene_title: result.scene_title || `Scene ${scene_number || 1}`, shots: enrichedShots });
    } catch (error: any) {
        logger.gemini.error('shots_generate_error', (error as any)?.message || String(error));
        res.status(500).json({ error: error.message || 'Shot generation failed' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/shots/:shotId/rewrite — AI-rewrite specific fields
// ───────────────────────────────────────────────────────────────
app.post('/api/shots/:shotId/rewrite', async (req: any, res: any) => {
    const COST = 1;
    let jobRef = '';
    let reservedCredits = false;
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
        jobRef = `rewrite:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        if (!skipCreditCheck) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'rewrite', ref_id: jobRef
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
            reservedCredits = true;
        } else {
            logDeveloperAccess(userEmail, `shots:rewrite:cost=${COST}`);
        }

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
4. If rewriting image_prompt, include the character anchor and write a production-grade prompt with explicit shot scale, camera height, focal length feel, foreground/midground/background depth, lighting motivation, color script, and material texture realism (minimum 70 words).
5. If rewriting video_prompt, output concrete physical blocking and camera choreography only (minimum 35 words), including timing beats and body mechanics.
6. Be creative, ensure physical logic, and stay consistent with the visual style and scene context.
7. Language: technical fields in English, dialogue in ${language === 'zh' ? 'Chinese' : 'English'}.

**REQUIRED JSON STRUCTURE (CRITICAL):**
Return EXACTLY ONE flat JSON object containing ONLY the rewritten keys and their new string values. Do not use markdown backticks. Do not add any explanatory text.
Example: {"image_prompt": "new prompt here", "dialogue": "new line here"}
`;

        let responseText = '';
        try {
            responseText = await getGeminiTextCompletion(
                `Rewrite fields [${fieldsStr}] for shot ${shotId}. ${user_instruction || ''}`,
                {
                    systemInstruction,
                    temperature: 0.7,
                    responseMimeType: 'application/json',
                }
            );
        } catch (initialError: any) {
            logger.gemini.warn('shot_rewrite_retry', { error: initialError.message });
            responseText = await getGeminiTextCompletion(
                `Rewrite fields [${fieldsStr}] for shot ${shotId}. ${user_instruction || ''}`,
                {
                    systemInstruction: systemInstruction + "\nOutput strictly valid JSON, no markdown formatting.",
                    temperature: 0.5,
                    responseMimeType: 'application/json',
                }
            );
        }

        const text = responseText;
        if (!text) throw new Error('No response from AI');

        let rewrittenFields;
        try {
            rewrittenFields = parseAiJsonWithRepair(text, 'Shot Rewrite');
        } catch (parseError: any) {
            logger.gemini.warn('shot_rewrite_parse_failed', { error: parseError.message });
            throw parseError;
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
        logger.gemini.error('shot_rewrite_error', (error as any)?.message || String(error));
        // ★ Refund reserved credits on error, best-effort
        try {
            const authHeader = req.headers.authorization;
            if (authHeader && reservedCredits && jobRef) {
                const supabaseRefund = getUserClient(authHeader);
                await supabaseRefund.rpc('refund_reserve', { amount: COST, ref_type: 'rewrite', ref_id: jobRef });
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
        const {
            prompt,
            negative_prompt,
            delta_instruction,
            model,
            aspect_ratio,
            style,
            seed,
            character_anchor,
            reference_policy,
            project_id,
            anchor_image_url,
            referenceImageDataUrl,
            continuity,
            shot_payload,
            scene_payload,
            previous_shot,
            previous_prompt,
        } = req.body;

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

        const suppressCharacterLock = shouldSuppressCharacterLock(
            `${prompt || ''} ${delta_instruction || ''}`,
            character_anchor,
            continuity?.project_context?.story_entities
        );

        const continuityInput = suppressCharacterLock
            ? { ...(continuity || {}), lockCharacter: false }
            : continuity;

        let continuityProfile = buildContinuityProfile(continuityInput, {
            characterAnchor: character_anchor,
            visualStyle: style || 'none',
            sceneMemory: continuityInput?.scene_memory || continuityInput?.shot_context || {},
        });
        if (suppressCharacterLock) {
            continuityProfile = {
                ...continuityProfile,
                lockCharacter: false,
                identityAnchorLine: '',
                lockedCastLine: '',
            };
            console.log(`[Continuity] shot=${shotId} auto-suppressed character lock for non-cast scene prompt`);
        }

        let promptCandidate = buildFinalPrompt({
            basePrompt: prompt || '',
            deltaInstruction: delta_instruction,
            characterAnchor: suppressCharacterLock ? '' : character_anchor,
            style: style || 'none',
            referencePolicy: reference_policy || 'anchor',
            storyEntities: suppressCharacterLock ? [] : continuity?.project_context?.story_entities,
            suppressCharacterLock,
        });

        let compiledPromptMeta: any = null;
        if (shot_payload) {
            const compiledShot = buildShotImagePrompt({
                shot: shot_payload,
                scene: scene_payload || {},
                styleBible: continuity?.style_bible || {},
                continuityState: continuity,
                previousShot: previous_shot,
                previousPrompt: previous_prompt,
                characterAnchor: suppressCharacterLock ? '' : character_anchor,
                styleLabel: style || 'none',
                shotGraphNode: shot_payload,
            });

            if (compiledShot.variance_report.requires_substantive_change && !compiledShot.variance_report.pass) {
                return res.status(422).json({
                    error: '该镜头未充分响应剧本内容，请重新编译 prompt',
                    code: 'PROMPT_VARIANCE_FAIL',
                    variance_report: compiledShot.variance_report,
                });
            }

            promptCandidate = compiledShot.model_prompt;
            compiledPromptMeta = compiledShot;
        }

        promptCandidate = applyContinuityLocks(promptCandidate, continuityProfile);

        const continuityNegative = buildContinuityNegativePrompt(negative_prompt, continuityProfile);
        const nonHumanGuide = detectNonHumanCharacterGuide(promptCandidate, character_anchor);

        const memoryReference = getContinuityReference(project_id || '', shotId, {
            preferPrevious: continuityProfile.usePreviousApprovedAsReference,
        });

        const effectiveGuideImage = anchor_image_url || referenceImageDataUrl || memoryReference || undefined;
        const disableFaceCloning = nonHumanGuide.hasNonHuman || isRemoteImageReference(referenceImageDataUrl);

        let result: { url: string; predictionId: string } | null = null;
        const maxAttempts = continuityProfile.strictness === 'high' ? 3 : (continuityProfile.strictness === 'medium' ? 2 : 1);
        const threshold = continuityThreshold(continuityProfile.strictness);
        let finalContinuityScore: any = null;

        try {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const scored = scoreContinuityPrompt(promptCandidate, continuityProfile);
                finalContinuityScore = scored;

                if (scored.overall < threshold) {
                    console.warn(`[Continuity] shot=${shotId} prompt score ${scored.overall.toFixed(2)} < ${threshold.toFixed(2)}; failures=${scored.failures.join(',')}`);
                    promptCandidate = strengthenPromptForRetry(promptCandidate, continuityProfile, attempt, scored.failures);
                }

                result = await callReplicateImage({
                    prompt: promptCandidate,
                    negativePrompt: continuityNegative,
                    model: replicatePath,
                    aspectRatio: aspect_ratio || '16:9',
                    seed: seed ?? 142857,
                    imagePrompt: effectiveGuideImage,
                    referenceImageDataUrl: referenceImageDataUrl || undefined,
                    disableFaceCloning,
                    allowReferenceFallback: true,
                });

                if (scored.overall >= threshold || attempt === maxAttempts) {
                    break;
                }

                promptCandidate = strengthenPromptForRetry(promptCandidate, continuityProfile, attempt + 1, scored.failures);
            }
        } catch (genErr: any) {
            if (!skipCreditCheck) { try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'shot-image', ref_id: jobRef }); } catch (_) { } }
            throw genErr;
        }

        if (!result?.url) {
            throw new Error('Continuity generation failed to produce output');
        }
        const resolvedResult = result;

        if (!skipCreditCheck) { await supabaseUser.rpc('finalize_reserve', { ref_type: 'shot-image', ref_id: jobRef }); }

        if (project_id && resolvedResult.url) {
            registerApprovedFrame(project_id, {
                shotId,
                sceneId: continuity?.scene_memory?.scene_id || continuity?.shot_context?.scene_id,
                sceneNumber: continuity?.scene_memory?.scene_number || continuity?.shot_context?.scene_number,
                shotNumber: continuity?.shot_context?.shot_number,
                imageUrl: resolvedResult.url,
                prompt: promptCandidate,
                createdAt: Date.now(),
            });

            registerStoryboardCandidate({
                projectId: project_id,
                shotId,
                candidateId: crypto.randomUUID(),
                imageUrl: resolvedResult.url,
                continuityScore: Number(finalContinuityScore?.overall || 70),
                narrativeScore: Math.max(60, Number(finalContinuityScore?.overall || 70) - 5),
                visualMatchScore: Math.max(60, Number(finalContinuityScore?.overall || 70) - 2),
                violations: finalContinuityScore?.failures || [],
            });
            setProjectStage(project_id, 'storyboard_review');
        }

        const now = new Date().toISOString();
        const imageId = crypto.randomUUID();
        res.json({
            image: { id: imageId, shot_id: shotId, project_id: project_id || null, url: resolvedResult.url, is_primary: false, status: 'succeeded', label: null, created_at: now },
            generation: {
                id: crypto.randomUUID(), image_id: imageId, shot_id: shotId, project_id: project_id || null,
                prompt: promptCandidate, negative_prompt: continuityNegative || '', delta_instruction: delta_instruction || null,
                model: imageModel, aspect_ratio: aspect_ratio || '16:9', style: style || 'none', seed: seed ?? 142857,
                anchor_refs: character_anchor ? [character_anchor] : [], reference_policy: reference_policy || 'anchor',
                edit_mode: null, status: 'succeeded', output_url: resolvedResult.url, replicate_prediction_id: resolvedResult.predictionId,
                created_at: now, completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime,
                continuity_score: finalContinuityScore?.overall ?? null,
                continuity_failures: finalContinuityScore?.failures || [],
                compiler: compiledPromptMeta ? {
                    shot_summary: compiledPromptMeta.shot_summary,
                    continuity_notes: compiledPromptMeta.continuity_notes,
                    variance_report: compiledPromptMeta.variance_report,
                } : null,
            },
        });
    } catch (error: any) {
        logger.shot.error('shot_image_generate_error', error.message);
        if (error.message === 'FACE_ALIGN_FAIL') {
            return res.status(400).json({ error: '未能检测到清晰的人物面部；如果你在生成动物或非人角色，系统已自动切换为非人参考模式。若仍失败，请换更清晰参考图或直接使用文本提示。' });
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
        const {
            edit_mode,
            delta_instruction,
            original_prompt,
            negative_prompt,
            reference_image_url,
            locked_attributes,
            model,
            aspect_ratio,
            style,
            seed,
            character_anchor,
            reference_policy,
            shot_id,
            project_id,
            continuity,
        } = req.body;

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

        const suppressCharacterLock = shouldSuppressCharacterLock(
            `${basePrompt || ''} ${delta_instruction || ''}`,
            character_anchor,
            continuity?.project_context?.story_entities
        );

        const continuityInput = suppressCharacterLock
            ? { ...(continuity || {}), lockCharacter: false }
            : continuity;

        let continuityProfile = buildContinuityProfile(continuityInput, {
            characterAnchor: character_anchor,
            visualStyle: style || 'none',
            sceneMemory: continuityInput?.scene_memory || continuityInput?.shot_context || {},
        });
        if (suppressCharacterLock) {
            continuityProfile = {
                ...continuityProfile,
                lockCharacter: false,
                identityAnchorLine: '',
                lockedCastLine: '',
            };
            console.log(`[Continuity] shot=${shot_id || imageId} auto-suppressed character lock for non-cast edit prompt`);
        }

        let finalPrompt = buildFinalPrompt({
            basePrompt,
            characterAnchor: suppressCharacterLock ? '' : character_anchor,
            style: style || 'none',
            referencePolicy: reference_policy || 'anchor',
            storyEntities: suppressCharacterLock ? [] : continuity?.project_context?.story_entities,
            suppressCharacterLock,
        });
        finalPrompt = applyContinuityLocks(finalPrompt, continuityProfile);
        const continuityNegative = buildContinuityNegativePrompt(negative_prompt, continuityProfile);

        const editSeed = edit_mode === 'reroll' ? Math.floor(Math.random() * 999999) : (seed ?? 142857);
        const memoryReference = reference_image_url || getContinuityReference(project_id || '', shot_id || '', {
            preferPrevious: continuityProfile.usePreviousApprovedAsReference,
        });

        let result: { url: string; predictionId: string } | null = null;
        try {
            const maxAttempts = continuityProfile.strictness === 'high' ? 3 : (continuityProfile.strictness === 'medium' ? 2 : 1);
            const threshold = continuityThreshold(continuityProfile.strictness);
            let candidate = finalPrompt;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                const scored = scoreContinuityPrompt(candidate, continuityProfile);
                if (scored.overall < threshold) {
                    candidate = strengthenPromptForRetry(candidate, continuityProfile, attempt, scored.failures);
                }
                result = await callReplicateImage({
                    prompt: candidate,
                    negativePrompt: continuityNegative,
                    model: replicatePath,
                    aspectRatio: aspect_ratio || '16:9',
                    seed: editSeed,
                    imagePrompt: memoryReference || undefined,
                });
                if (scored.overall >= threshold || attempt === maxAttempts) {
                    finalPrompt = candidate;
                    break;
                }
                candidate = strengthenPromptForRetry(candidate, continuityProfile, attempt + 1, scored.failures);
            }
        } catch (genErr: any) {
            if (!skipCreditCheck) { try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'shot-image-edit', ref_id: jobRef }); } catch (_) { } }
            throw genErr;
        }

        if (!result?.url) {
            throw new Error('Continuity edit failed to produce output');
        }
        const resolvedResult = result;

        if (!skipCreditCheck) { await supabaseUser.rpc('finalize_reserve', { ref_type: 'shot-image-edit', ref_id: jobRef }); }

        const now = new Date().toISOString();
        const newImageId = crypto.randomUUID();
        if (project_id && resolvedResult.url && shot_id) {
            registerApprovedFrame(project_id, {
                shotId: shot_id,
                sceneId: continuity?.scene_memory?.scene_id || continuity?.shot_context?.scene_id,
                sceneNumber: continuity?.scene_memory?.scene_number || continuity?.shot_context?.scene_number,
                shotNumber: continuity?.shot_context?.shot_number,
                imageUrl: resolvedResult.url,
                prompt: finalPrompt,
                createdAt: Date.now(),
            });

            registerStoryboardCandidate({
                projectId: project_id,
                shotId: shot_id,
                candidateId: crypto.randomUUID(),
                imageUrl: resolvedResult.url,
                continuityScore: 75,
                narrativeScore: 72,
                visualMatchScore: 74,
                violations: [],
            });
            setProjectStage(project_id, 'storyboard_review');
        }

        res.json({
            image: { id: newImageId, shot_id: shot_id || '', project_id: project_id || null, url: resolvedResult.url, is_primary: false, status: 'succeeded', label: `Edit (${edit_mode})`, created_at: now },
            generation: {
                id: crypto.randomUUID(), image_id: newImageId, shot_id: shot_id || '', project_id: project_id || null,
                prompt: finalPrompt, negative_prompt: continuityNegative || '', delta_instruction: delta_instruction || null,
                model: imageModel, aspect_ratio: aspect_ratio || '16:9', style: style || 'none', seed: editSeed,
                anchor_refs: character_anchor ? [character_anchor] : [], reference_image_url: reference_image_url || null,
                reference_policy: reference_policy || 'anchor', edit_mode, status: 'succeeded',
                output_url: resolvedResult.url, replicate_prediction_id: resolvedResult.predictionId,
                created_at: now, completed_at: new Date().toISOString(), duration_ms: Date.now() - startTime,
                parent_image_id: imageId,
            },
        });
    } catch (error: any) {
        logger.shot.error('shot_image_edit_error', error.message);
        res.status(500).json({ error: error.message || 'Image edit failed' });
    }
});

// ───────────────────────────────────────────────────────────────
// Storyboard-First Runtime APIs (Phase 1 MVP)
// ───────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────
// Helper: persist in-memory pipeline state → storyboards.pipeline_state
// Fails silently if column doesn't exist yet (pre-migration).
// ───────────────────────────────────────────────────────────────
async function persistPipelineState(projectId: string): Promise<void> {
    const runtime = getProjectRuntime(projectId);
    if (!runtime) return;
    try {
        const serialized = serializePipelineState(runtime);
        const supabaseAdmin = getSupabaseAdmin();
        await (supabaseAdmin as any)
            .from('storyboards')
            .update({ pipeline_state: serialized })
            .eq('id', projectId);
    } catch (e: any) {
        // Non-fatal: column may not exist until migration is applied
        logger.pipeline.warn('persist_failed', { projectId, error: e?.message });
    }
}

// Helper: restore pipeline state from Supabase if runtime is missing
async function restorePipelineStateFromDB(projectId: string): Promise<boolean> {
    try {
        const supabaseAdmin = getSupabaseAdmin();
        const { data, error } = await (supabaseAdmin as any)
            .from('storyboards')
            .select('pipeline_state')
            .eq('id', projectId)
            .single();
        if (error || !data?.pipeline_state) return false;
        const state = deserializePipelineState(data.pipeline_state);
        restorePipelineState(state);
        return true;
    } catch (e: any) {
        logger.pipeline.warn('restore_failed', { projectId, error: e?.message });
        return false;
    }
}

app.get('/api/pipeline/:projectId/status', requireAuth, async (req: any, res: any) => {
    const { projectId } = req.params;
    let runtime = getProjectRuntime(projectId);

    // Auto-restore from Supabase if in-memory state was lost (server restart)
    if (!runtime) {
        const restored = await restorePipelineStateFromDB(projectId);
        if (restored) runtime = getProjectRuntime(projectId);
    }

    if (!runtime) {
        return res.status(404).json({ error: 'Pipeline runtime not found for project' });
    }

    return res.json({
        project_id: projectId,
        stage: runtime.stage,
        paused: runtime.paused,
        skipped_shot_ids: [...runtime.skippedShotIds.values()],
        shots: [...runtime.shots.values()],
        created_at: runtime.createdAt,
        updated_at: runtime.updatedAt,
    });
});

app.post('/api/pipeline/:projectId/queue/control', requireAuth, async (req: any, res: any) => {
    const { projectId } = req.params;
    const { action, shot_id } = req.body || {};
    if (!['pause', 'resume', 'skip'].includes(action)) {
        return res.status(400).json({ error: 'Invalid queue action' });
    }

    const state = controlStoryboardQueue(projectId, action, shot_id);
    if (!state) return res.status(404).json({ error: 'Pipeline runtime not found for project' });

    return res.json({
        ok: true,
        stage: state.stage,
        paused: state.paused,
        skipped_shot_ids: [...state.skippedShotIds.values()],
    });
});

app.post('/api/storyboard/:projectId/shots/:shotId/validate', requireAuth, async (req: any, res: any) => {
    try {
        const { projectId, shotId } = req.params;
        const {
            image_url,
            shot,
            previous_shot,
            scene_state,
            character_state,
        } = req.body || {};

        const contextPack = buildShotContextPack({
            projectId,
            shotId,
            currentShot: shot || {},
            previousShot: previous_shot || {},
            sceneState: scene_state || {},
            characterState: character_state || {},
        });

        // ★ Gemini Vision scoring: when an image_url is provided, use actual vision analysis
        let report = scoreStoryboardCandidate({
            imagePrompt: shot?.image_prompt || shot?.imagePrompt,
            action: shot?.action,
            framing: shot?.composition || shot?.framing,
            lighting: shot?.lighting,
            imageUrl: image_url,
        });

        if (image_url) {
            try {
                // Fetch the image server-side (avoids CORS) and encode as base64
                let imageBase64: string;
                let mimeType = 'image/jpeg';
                if (image_url.startsWith('data:')) {
                    const prefixMatch = image_url.match(/^data:(image\/[a-zA-Z+]+);base64,/);
                    if (prefixMatch) mimeType = prefixMatch[1];
                    imageBase64 = image_url.split(',')[1];
                } else {
                    const imgResp = await fetch(image_url);
                    const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
                    mimeType = contentType.split(';')[0].trim();
                    const arrayBuffer = await imgResp.arrayBuffer();
                    imageBase64 = Buffer.from(arrayBuffer).toString('base64');
                }

                const shotContext = [
                    shot?.action && `Action: ${shot.action}`,
                    shot?.image_prompt && `Visual Description: ${shot.image_prompt}`,
                    (shot?.composition || shot?.framing) && `Framing: ${shot.composition || shot.framing}`,
                    shot?.lighting && `Lighting: ${shot.lighting}`,
                    shot?.mood && `Mood: ${shot.mood}`,
                    shot?.characters?.length && `Characters: ${Array.isArray(shot.characters) ? shot.characters.join(', ') : shot.characters}`,
                    previous_shot?.action && `Previous shot action: ${previous_shot.action}`,
                ].filter(Boolean).join('\n');

                const visionPrompt = `You are a strict cinematic storyboard continuity supervisor scoring a generated storyboard frame.

Shot Bible Requirements:
${shotContext || 'No shot bible provided.'}

Evaluate this storyboard frame image on three dimensions (each 0-100):
1. continuity_score: Does the image maintain visual continuity (character identity, costume, scene architecture, lighting) with the shot requirements?
2. narrative_score: Does the image clearly communicate the intended narrative action and emotional beat?
3. visual_match_score: Does the framing, composition, lens language, and mood visually match the shot brief?

Also list any specific violation_tags from: [face_drift, costume_inconsistency, background_drift, lighting_mismatch, wrong_framing, wrong_shot_size, missing_subject, action_mismatch, mood_mismatch]

Output ONLY a valid JSON object with this exact shape:
{
  "continuity_score": <number 0-100>,
  "narrative_score": <number 0-100>,
  "visual_match_score": <number 0-100>,
  "violation_tags": [<string>, ...],
  "regen_recommendation": "<none|regenerate_same_shot_keep_bible|regenerate_same_shot_fix_face|regenerate_same_shot_fix_costume|regenerate_same_shot_fix_scene|regenerate_same_shot_change_framing>"
}`;

                const ai = getGeminiAI();
                const visionResult: any = await ai.models.generateContent({
                    model: GEMINI_TEXT_MODEL,
                    contents: [{
                        role: 'user',
                        parts: [
                            { inlineData: { mimeType, data: imageBase64 } },
                            { text: visionPrompt },
                        ],
                    }],
                    config: { temperature: 0.1 },
                });

                const rawText = typeof visionResult?.text === 'string'
                    ? visionResult.text.trim()
                    : visionResult?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

                const parsed = parseAiJsonWithRepair(rawText, 'storyboard-validate');
                if (parsed && typeof parsed.continuity_score === 'number') {
                    report = {
                        continuity_score: Math.min(100, Math.max(0, parsed.continuity_score)),
                        narrative_score: Math.min(100, Math.max(0, parsed.narrative_score ?? report.narrative_score)),
                        visual_match_score: Math.min(100, Math.max(0, parsed.visual_match_score ?? report.visual_match_score)),
                        violation_tags: Array.isArray(parsed.violation_tags) ? parsed.violation_tags : report.violation_tags,
                        regen_recommendation: parsed.regen_recommendation || report.regen_recommendation,
                    };
                }
            } catch (visionErr: any) {
                logger.gemini.warn('vision_scoring_fallback', { error: visionErr?.message });
                // Fall through — keep the heuristic report
            }
        }

        const candidateId = crypto.randomUUID();
        const runtimeShot = registerStoryboardCandidate({
            projectId,
            shotId,
            candidateId,
            imageUrl: image_url,
            continuityScore: report.continuity_score,
            narrativeScore: report.narrative_score,
            visualMatchScore: report.visual_match_score,
            violations: report.violation_tags,
        });

        const runtime = getProjectRuntime(projectId);

        // Persist to Supabase (non-blocking)
        persistPipelineState(projectId).catch(() => {});

        return res.json({
            shot_context_pack: contextPack,
            continuity_report: {
                shot_id: shotId,
                ...report,
                validated_at: new Date().toISOString(),
            },
            candidate_id: candidateId,
            runtime_shot: runtimeShot,
            stage: runtime?.stage || 'storyboard_review',
        });
    } catch (error: any) {
        logger.pipeline.error('storyboard_validate_error', error?.message || String(error));
        return res.status(500).json({ error: error?.message || 'Storyboard validation failed' });
    }
})

app.post('/api/storyboard/:projectId/shots/:shotId/approve', requireAuth, async (req: any, res: any) => {
    const { projectId, shotId } = req.params;
    const { image_url } = req.body || {};
    const runtimeShot = approveStoryboardShot(projectId, shotId, image_url);
    if (!runtimeShot) return res.status(404).json({ error: 'Shot runtime not found' });

    const runtime = getProjectRuntime(projectId);
    if (runtime?.stage === 'storyboard_approved') {
        setProjectStage(projectId, 'storyboard_approved');
    }

    // Persist to Supabase (non-blocking)
    persistPipelineState(projectId).catch(() => {});

    return res.json({
        ok: true,
        shot_id: shotId,
        approved_frame: getApprovedStoryboardFrame(projectId, shotId),
        version: runtimeShot.version,
        stage: runtime?.stage || 'storyboard_review',
    });
});

app.post('/api/storyboard/:projectId/shots/:shotId/regenerate', requireAuth, async (req: any, res: any) => {
    const { projectId, shotId } = req.params;
    const { mode, reason } = req.body || {};

    const allowModes = new Set([
        'regenerate_same_shot_keep_bible',
        'regenerate_same_shot_change_framing',
        'regenerate_same_shot_fix_face',
        'regenerate_same_shot_fix_costume',
        'regenerate_same_shot_fix_scene',
        'regenerate_from_shot_forward',
        'freeze_approved_shots',
    ]);

    if (!allowModes.has(mode)) {
        return res.status(400).json({ error: 'Invalid regeneration mode' });
    }

    const runtimeShot = markShotRegenerated({
        projectId,
        shotId,
        mode,
        reason,
    });

    if (!runtimeShot) return res.status(404).json({ error: 'Shot runtime not found' });
    const runtime = getProjectRuntime(projectId);

    // Persist to Supabase (non-blocking)
    persistPipelineState(projectId).catch(() => {});

    return res.json({
        ok: true,
        shot_id: shotId,
        mode,
        reason: reason || '',
        version: runtimeShot.version,
        stage: runtime?.stage || 'storyboard_review',
    });
});

app.get('/api/storyboard/:projectId/ready-for-video', requireAuth, async (req: any, res: any) => {
    const { projectId } = req.params;

    // Auto-restore if runtime was lost
    if (!getProjectRuntime(projectId)) {
        await restorePipelineStateFromDB(projectId);
    }

    const ready = hasApprovedStoryboard(projectId);
    return res.json({
        project_id: projectId,
        storyboard_approved: ready,
        stage: ready ? 'storyboard_approved' : 'storyboard_review',
    });
});

// ───────────────────────────────────────────────────────────────
// GET /api/storyboard/:projectId/assembly-manifest
// Returns a full shot-level status manifest for the project pipeline
// ───────────────────────────────────────────────────────────────
app.get('/api/storyboard/:projectId/assembly-manifest', requireAuth, async (req: any, res: any) => {
    const { projectId } = req.params;
    let runtime = getProjectRuntime(projectId);

    // Auto-restore from Supabase on miss
    if (!runtime) {
        await restorePipelineStateFromDB(projectId);
        runtime = getProjectRuntime(projectId);
    }

    if (!runtime) {
        // Gracefully return empty manifest if runtime not initialised yet
        return res.json({
            project_id: projectId,
            stage: 'shots_ready',
            total_shots: 0,
            approved_shots: 0,
            ready_for_video: false,
            shots: [],
            error_report: [],
            remaining_weak_shots: [],
        });
    }

    const shotsArray = [...runtime.shots.values()].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    const approvedShots = shotsArray.filter(s => s.status === 'approved');
    const failedShots = shotsArray.filter(s => s.status === 'failed');
    const weakShots = shotsArray.filter(s =>
        s.status !== 'approved' && (
            (s.continuityScore !== undefined && s.continuityScore < 75) ||
            s.violationTags.length > 0
        )
    );

    const errorReport = failedShots.map(s => ({
        shot_id: s.shotId,
        sequence_order: s.sequenceOrder,
        reason: s.regenerateReason || 'generation_failed',
        violation_tags: s.violationTags,
    }));

    const shotManifest = shotsArray.map(s => ({
        shot_id: s.shotId,
        scene_id: s.sceneId,
        sequence_order: s.sequenceOrder,
        status: s.status,
        version: s.version,
        approved_image_url: s.approvedImageUrl,
        last_image_url: s.lastImageUrl,
        continuity_score: s.continuityScore,
        narrative_score: s.narrativeScore,
        visual_match_score: s.visualMatchScore,
        violation_tags: s.violationTags,
        regen_reason: s.regenerateReason,
        has_approved_storyboard: s.status === 'approved',
        history_count: s.history.length,
    }));

    return res.json({
        project_id: projectId,
        stage: runtime.stage,
        paused: runtime.paused,
        total_shots: shotsArray.length,
        approved_shots: approvedShots.length,
        failed_shots: failedShots.length,
        weak_shots: weakShots.length,
        ready_for_video: approvedShots.length === shotsArray.length && shotsArray.length > 0,
        shots: shotManifest,
        error_report: errorReport,
        remaining_weak_shots: weakShots.map(s => ({
            shot_id: s.shotId,
            sequence_order: s.sequenceOrder,
            violation_tags: s.violationTags,
            continuity_score: s.continuityScore,
            suggested_action: s.violationTags.includes('face_drift') || s.violationTags.includes('face_inconsistency')
                ? 'regenerate_same_shot_fix_face'
                : s.violationTags.includes('costume_inconsistency')
                    ? 'regenerate_same_shot_fix_costume'
                    : s.violationTags.includes('background_drift')
                        ? 'regenerate_same_shot_fix_scene'
                        : 'regenerate_same_shot_keep_bible',
        })),
        created_at: runtime.createdAt,
        updated_at: runtime.updatedAt,
    });
});

// ───────────────────────────────────────────────────────────────
// POST /api/batch/compile-prompts — Compile per-shot prompt previews before generation
// ───────────────────────────────────────────────────────────────
app.post('/api/batch/compile-prompts', async (req: any, res: any) => {
    const traceId: string = req.traceId || generateTraceId();
    try {
        const { project_id, shots, style = 'none', character_anchor = '', style_bible } = req.body;
        if (!project_id) return res.status(400).json(createErrorResponse(createError.missingField('project_id'), traceId));
        if (!Array.isArray(shots) || shots.length === 0) {
            return res.status(400).json(createErrorResponse(createError.invalidParameter('shots', '不能为空'), traceId));
        }

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json(createErrorResponse(createError.unauthorized(), traceId));

        const sortedShots = [...shots].sort((a: any, b: any) => (a.scene_number - b.scene_number) || (a.shot_number - b.shot_number));
        const compiled: any[] = [];

        for (let i = 0; i < sortedShots.length; i += 1) {
            const shot = sortedShots[i];
            const previousShot = i > 0 ? sortedShots[i - 1] : undefined;
            const previousPrompt = i > 0 ? compiled[i - 1]?.model_prompt : undefined;

            const compiledShot = buildShotImagePrompt({
                shot,
                scene: {
                    scene_id: shot.scene_id,
                    synopsis: shot.scene_summary || shot.visual_description || '',
                    location: shot.location || shot.scene_setting || '',
                    time_of_day: shot.time_of_day || '',
                },
                styleBible: style_bible || {},
                previousShot,
                previousPrompt,
                characterAnchor: character_anchor,
                styleLabel: style,
            });

            compiled.push(compiledShot);
        }

        const duplicateWarnings: any[] = [];
        for (let i = 2; i < compiled.length; i += 1) {
            const a = compiled[i - 2]?.variance_report?.similarity_score ?? 0;
            const b = compiled[i - 1]?.variance_report?.similarity_score ?? 0;
            if (a > 0.92 && b > 0.92) {
                duplicateWarnings.push({
                    code: 'PROMPT_REPEAT_ALERT',
                    shot_id: compiled[i]?.shot_id,
                    message: '该镜头未充分响应剧本内容，请重新编译 prompt',
                });
            }
        }

        return res.json({
            success: true,
            project_id,
            compiled_shots: compiled,
            duplicate_warnings: duplicateWarnings,
        });
    } catch (error: any) {
        logger.replicate.error('batch_compile_prompts_error', error?.message || String(error));
        return res.status(500).json({ error: error?.message || 'Failed to compile prompts' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/batch/gen-images — Synchronous batch image generation with SSE streaming
// On Vercel serverless, in-memory state doesn't persist across requests.
// This endpoint processes all images within a single request and streams progress via SSE.
// ───────────────────────────────────────────────────────────────
app.post('/api/batch/gen-images', async (req: any, res: any) => {
    const traceId: string = req.traceId || generateTraceId();
    try {
        const { project_id, shots, count = 100, model = 'flux', aspect_ratio = '16:9', style = 'none', character_anchor = '', concurrency = 2, reference_image_url = '', story_entities, style_bible } = req.body;
        if (!project_id) return res.status(400).json(createErrorResponse(createError.missingField('project_id'), traceId));
        if (!shots?.length) return res.status(400).json(createErrorResponse(createError.invalidParameter('shots', '不能为空'), traceId));

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json(createErrorResponse(createError.unauthorized(), traceId));

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

        // Compile prompts shot-by-shot (script/shot driven), then validate variance.
        const compiledMap = new Map<string, any>();
        const compiledOrdered: any[] = [];
        for (let i = 0; i < sortedShots.length; i += 1) {
            const shot = sortedShots[i];
            const previousShot = i > 0 ? sortedShots[i - 1] : undefined;
            const previousPrompt = i > 0 ? compiledOrdered[i - 1]?.model_prompt : undefined;

            const compiledShot = buildShotImagePrompt({
                shot,
                scene: {
                    scene_id: shot.scene_id,
                    synopsis: shot.scene_summary || shot.visual_description || '',
                    location: shot.location || shot.scene_setting || '',
                    time_of_day: shot.time_of_day || '',
                },
                styleBible: style_bible || {},
                previousShot,
                previousPrompt,
                characterAnchor: character_anchor,
                styleLabel: style,
                shotGraphNode: shot,
            });

            if (compiledShot.variance_report.requires_substantive_change && !compiledShot.variance_report.pass) {
                return res.status(422).json({
                    error: '该镜头未充分响应剧本内容，请重新编译 prompt',
                    code: 'PROMPT_VARIANCE_FAIL',
                    shot_id: compiledShot.shot_id,
                    variance_report: compiledShot.variance_report,
                });
            }

            compiledMap.set(shot.shot_id, compiledShot);
            compiledOrdered.push(compiledShot);
        }

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

        const anchorImageUrl: string | null = reference_image_url || null;
        if (anchorImageUrl) {
            console.log(`[Batch] Using user-provided anchor reference: ${anchorImageUrl.substring(0, 80)}...`);
        }

        sendSSE('compiled', {
            compiled_shots: compiledOrdered.map((c: any) => ({
                shot_id: c.shot_id,
                scene_id: c.scene_id,
                shot_summary: c.shot_summary,
                user_readable_prompt: c.user_readable_prompt,
                model_prompt: c.model_prompt,
                negative_prompt: c.negative_prompt,
                continuity_notes: c.continuity_notes,
                variance_report: c.variance_report,
            })),
        });

        // ★ Process each image sequentially
        let cancelled = false;
        req.on('close', () => { cancelled = true; });

        const generatedByShot = new Map<string, string>();
        const firstFrameByScene = new Map<string, string>();
        const generatedUrlOwner = new Map<string, string>();

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

                const continuityProfile = buildContinuityProfile({
                    strictness: 'high',
                    lockCharacter: true,
                    lockStyle: true,
                    lockCostume: true,
                    lockScene: true,
                    usePreviousApprovedAsReference: true,
                    scene_memory: {
                        scene_id: shotData.scene_id,
                        scene_number: shotData.scene_number,
                        environment: shotData.location,
                        time_of_day: shotData.time_of_day,
                        lighting: shotData.lighting,
                    },
                    character_bible: story_entities?.length ? story_entities[0] : undefined,
                    style_bible: style_bible,
                    project_context: {
                        project_id,
                        visual_style: style,
                        character_anchor,
                    }
                }, {
                    characterAnchor: character_anchor,
                    visualStyle: style,
                });

                const compiledShot = compiledMap.get(item.shot_id);
                if (!compiledShot) throw new Error('Compiled shot prompt missing');

                const shotIndex = sortedShots.findIndex((s: any) => s.shot_id === item.shot_id);
                const previousShotId = shotIndex > 0 ? sortedShots[shotIndex - 1]?.shot_id : undefined;
                const payload = buildShotGenerationPayload(compiledShot, {
                    anchorImage: anchorImageUrl || undefined,
                    previousFrame: previousShotId ? generatedByShot.get(previousShotId) : undefined,
                    firstFrameInScene: firstFrameByScene.get(String(shotData.scene_id || '')),
                });

                let finalPrompt = applyContinuityLocks(payload.prompt, continuityProfile);
                const continuityNegative = buildContinuityNegativePrompt(payload.negative_prompt || '', continuityProfile);

                const maxAttempts = 2;
                const threshold = continuityThreshold('high');
                let result: { url: string; predictionId: string } | null = null;
                let candidate = finalPrompt;
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    const scored = scoreContinuityPrompt(candidate, continuityProfile);
                    if (scored.overall < threshold) {
                        candidate = strengthenPromptForRetry(candidate, continuityProfile, attempt, scored.failures);
                    }
                    result = await callReplicateImage({
                        prompt: candidate,
                        negativePrompt: continuityNegative,
                        model: replicatePath,
                        aspectRatio: aspect_ratio,
                        seed: shotData.seed_hint ?? computeDeterministicShotSeed(projectSeed, shotData.shot_id, shotData.shot_number),
                        imagePrompt: payload.reference_image_url,
                    });
                    if (scored.overall >= threshold || attempt === maxAttempts) {
                        finalPrompt = candidate;
                        break;
                    }
                }

                if (result?.url) {
                    generatedByShot.set(item.shot_id, result.url);
                    if (!firstFrameByScene.has(String(shotData.scene_id || ''))) {
                        firstFrameByScene.set(String(shotData.scene_id || ''), result.url);
                    }

                    const existingOwner = generatedUrlOwner.get(result.url);
                    if (existingOwner && existingOwner !== item.shot_id) {
                        throw new Error('该镜头未充分响应剧本内容，请重新编译 prompt');
                    }
                    generatedUrlOwner.set(result.url, item.shot_id);
                }

                item.status = 'succeeded';
                item.image_id = crypto.randomUUID();
                item.image_url = result?.url;
                item.completed_at = new Date().toISOString();
                job.succeeded += 1;

                if (result?.url) {
                    registerApprovedFrame(project_id, {
                        shotId: item.shot_id,
                        sceneId: shotData.scene_id,
                        sceneNumber: shotData.scene_number,
                        shotNumber: shotData.shot_number,
                        imageUrl: result.url,
                        prompt: finalPrompt,
                        createdAt: Date.now(),
                    });
                }
            } catch (err: any) {
                item.status = 'failed';
                item.error = err.message || 'Unknown error';
                item.completed_at = new Date().toISOString();
                job.failed += 1;
                logger.replicate.error('batch_shot_failed', err.message, { shot_id: item.shot_id });
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
        logger.replicate.error('batch_gen_images_error', error.message);
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
        const { project_id, shots, shots_with_images = [], count = 100, strategy = 'strict', model = 'flux', aspect_ratio = '16:9', style = 'none', character_anchor = '', concurrency = 2, anchor_image_url = '', reference_image_url = '', story_entities, style_bible } = req.body;
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

        const compiledMap = new Map<string, any>();
        const compiledOrdered: any[] = [];
        for (let i = 0; i < nextBatch.length; i += 1) {
            const shot = nextBatch[i];
            const previousShot = i > 0 ? nextBatch[i - 1] : undefined;
            const previousPrompt = i > 0 ? compiledOrdered[i - 1]?.model_prompt : undefined;
            const compiledShot = buildShotImagePrompt({
                shot,
                scene: {
                    scene_id: shot.scene_id,
                    synopsis: shot.scene_summary || shot.visual_description || '',
                    location: shot.location || shot.scene_setting || '',
                    time_of_day: shot.time_of_day || '',
                },
                styleBible: style_bible || {},
                previousShot,
                previousPrompt,
                characterAnchor: character_anchor,
                styleLabel: style,
                shotGraphNode: shot,
            });

            if (compiledShot.variance_report.requires_substantive_change && !compiledShot.variance_report.pass) {
                return res.status(422).json({
                    error: '该镜头未充分响应剧本内容，请重新编译 prompt',
                    code: 'PROMPT_VARIANCE_FAIL',
                    shot_id: compiledShot.shot_id,
                    variance_report: compiledShot.variance_report,
                });
            }

            compiledMap.set(shot.shot_id, compiledShot);
            compiledOrdered.push(compiledShot);
        }

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

        // Use explicit user/previous-batch anchor only. Do not globally reuse first generated frame.
        let anchorImageUrl: string | null = anchor_image_url || reference_image_url || null;
        if (anchorImageUrl) {
            console.log(`[Batch Continue] ★ Using anchor image: ${anchorImageUrl.substring(0, 80)}...`);
        }

        let cancelled = false;
        req.on('close', () => { cancelled = true; });

        const generatedByShot = new Map<string, string>();
        const firstFrameByScene = new Map<string, string>();
        const generatedUrlOwner = new Map<string, string>();

        sendSSE('compiled', {
            compiled_shots: compiledOrdered.map((c: any) => ({
                shot_id: c.shot_id,
                scene_id: c.scene_id,
                shot_summary: c.shot_summary,
                user_readable_prompt: c.user_readable_prompt,
                model_prompt: c.model_prompt,
                negative_prompt: c.negative_prompt,
                continuity_notes: c.continuity_notes,
                variance_report: c.variance_report,
            })),
        });

        for (const item of items) {
            if (cancelled) { item.status = 'cancelled'; continue; }
            item.status = 'running';
            item.started_at = new Date().toISOString();
            job.updated_at = new Date().toISOString();
            sendSSE('progress', { job, items });

            try {
                const shotData = nextBatch.find((s: any) => s.shot_id === item.shot_id);
                if (!shotData) throw new Error('Shot data not found');

                const compiledShot = compiledMap.get(item.shot_id);
                if (!compiledShot) throw new Error('Compiled shot prompt missing');

                const shotIndex = nextBatch.findIndex((s: any) => s.shot_id === item.shot_id);
                const previousShotId = shotIndex > 0 ? nextBatch[shotIndex - 1]?.shot_id : undefined;
                const payload = buildShotGenerationPayload(compiledShot, {
                    anchorImage: anchorImageUrl || undefined,
                    previousFrame: previousShotId ? generatedByShot.get(previousShotId) : undefined,
                    firstFrameInScene: firstFrameByScene.get(String(shotData.scene_id || '')),
                });

                const result = await callReplicateImage({
                    prompt: payload.prompt,
                    negativePrompt: payload.negative_prompt,
                    model: replicatePath,
                    aspectRatio: aspect_ratio,
                    seed: shotData.seed_hint ?? computeDeterministicShotSeed(projectSeed, shotData.shot_id, shotData.shot_number),
                    imagePrompt: payload.reference_image_url,
                });
                if (result.url) {
                    generatedByShot.set(item.shot_id, result.url);
                    if (!firstFrameByScene.has(String(shotData.scene_id || ''))) {
                        firstFrameByScene.set(String(shotData.scene_id || ''), result.url);
                    }
                    const existingOwner = generatedUrlOwner.get(result.url);
                    if (existingOwner && existingOwner !== item.shot_id) {
                        throw new Error('该镜头未充分响应剧本内容，请重新编译 prompt');
                    }
                    generatedUrlOwner.set(result.url, item.shot_id);
                }

                item.status = 'succeeded'; item.image_id = crypto.randomUUID(); item.image_url = result.url;
                item.completed_at = new Date().toISOString(); job.succeeded += 1;
            } catch (err: any) {
                item.status = 'failed'; item.error = err.message || 'Unknown error';
                item.completed_at = new Date().toISOString(); job.failed += 1;
                logger.replicate.error('batch_continue_shot_failed', err.message, { shot_id: item.shot_id });
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
        logger.replicate.error('batch_continue_error', error.message);
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
            const continuityProfile = buildContinuityProfile({
                strictness: 'high',
                lockCharacter: true,
                lockStyle: true,
                lockCostume: true,
                lockScene: true,
                usePreviousApprovedAsReference: true,
                scene_memory: {
                    scene_id: shotData?.scene_id,
                    scene_number: shotData?.scene_number,
                    environment: shotData?.location,
                    time_of_day: shotData?.time_of_day,
                    lighting: shotData?.lighting,
                },
                project_context: {
                    project_id: retryProjectId,
                    visual_style: style,
                    character_anchor,
                }
            }, {
                characterAnchor: character_anchor,
                visualStyle: style,
            });

            let finalPrompt = buildFinalPrompt({ basePrompt: shotData?.image_prompt || '', characterAnchor: character_anchor, style, referencePolicy: shotData?.reference_policy || 'anchor' });
            finalPrompt = applyContinuityLocks(finalPrompt, continuityProfile);
            const continuityNegative = buildContinuityNegativePrompt('', continuityProfile);
            const result = await callReplicateImage({ prompt: finalPrompt, negativePrompt: continuityNegative, model: replicatePath, aspectRatio: aspect_ratio, seed: shotData?.seed_hint ?? retryProjectSeed });
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
        logger.payment.error('billing_checkout_error', (err as any)?.message || String(err));
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
        logger.payment.error('billing_subscribe_error', (err as any)?.message || String(err));
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
        logger.payment.error('business_subscribe_error', (err as any)?.message || String(err));
        res.status(500).json({ error: err.message || 'Failed to create business subscription' });
    }
});



// ═══════════════════════════════════════════════════════════════
// GET /api/download — Server-side proxy download (bypasses CDN CORS)
// ═══════════════════════════════════════════════════════════════
app.get('/api/download', requireAuth, async (req: any, res: any) => {
    const rawUrl = req.query.url as string | undefined;
    const rawName = req.query.filename as string | undefined;

    if (!rawUrl) return res.status(400).json({ error: 'Missing url' });

    const safeName = String(rawName || 'download.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = safeName.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
        mp4: 'video/mp4', webm: 'video/webm',
        jpg: 'image/jpeg', jpeg: 'image/jpeg',
        png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    };

    try {
        const safeUrl = assertSafePublicUrl(rawUrl);
        const upstream = await fetch(safeUrl.toString(), {
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

// Health with detailed diagnostics
app.get('/api/health/detailed', asyncHandler(async (req: any, res: any) => {
    const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
    const replicateToken = (process.env.REPLICATE_API_TOKEN || '').trim();
    const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const supabaseService = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const supabaseAnon = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

    logger.api.info('health_check', {
        hasGemini: !!geminiKey,
        hasReplicate: !!replicateToken,
        hasSupabaseUrl: !!supabaseUrl,
    }, req.traceId);

    res.json(createSuccessResponse({
        status: 'ok',
        timestamp: new Date().toISOString(),
        build: 'storyboard-first-pipeline-v2',
        version: '2.0.0',
        config: {
            gemini: geminiKey ? '✅ configured' : '❌ missing',
            replicate: replicateToken ? '✅ configured' : '❌ missing',
            supabase_url: supabaseUrl ? '✅ configured' : '❌ missing',
            supabase_service_key: supabaseService ? '✅ configured' : '❌ missing',
            supabase_anon_key: supabaseAnon ? '✅ configured' : '❌ missing',
        },
        environment: process.env.NODE_ENV || 'unknown',
        uptime: process.uptime(),
    }, undefined, req.traceId));
}));

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
            'api_startup': 'price_1SylajJ3FWUBvlCmqwertYui',
            'api_business': 'price_1SylbkJ3FWUBvlCmasdfGhjk',
            'api_enterprise': 'price_1SylckJ3FWUBvlCmzxcvbnm',
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

// ElevenLabs voice presets — using ONLY confirmed standard library IDs
// eleven_multilingual_v2 handles Chinese text with any of these voices
const ELEVENLABS_VOICES: Record<string, string> = {
    // Chinese aliases → use multilingual-capable standard voices
    'zh_female_shuang': '21m00Tcm4TlvDq8ikWAM',   // Rachel — confirmed valid, handles ZH
    'zh_male_yong':     'pNInz6obpgDQGcFmaJgB',    // Adam   — confirmed valid, handles ZH
    // English voices — confirmed standard ElevenLabs library IDs
    'en_female_rachel': '21m00Tcm4TlvDq8ikWAM',   // Rachel
    'en_male_adam':     'pNInz6obpgDQGcFmaJgB',    // Adam
    'en_male_josh':     'TxGEqnHWrfWFTfGW9XjX',   // Josh
    'en_female_sarah':  'EXAVITQu4vr4xnSDxMaL',   // Sarah (corrected ID)
    'en_male_arnold':   'VR6AewLTigWG4xSOukaG',   // Arnold
    'en_female_emma':   'LcfcDJ0VP2Gu28MmWJZD',   // Elli
    'en_male_james':    'onwK4e9ZLuTAKqWW03F9',   // Daniel
};

// ── Timing helper ────────────────────────────────────────────────
// Converts ElevenLabs character-level alignment into sentence-level
// timing blocks.  Returns [] if alignment is missing (fallback gracefully).
interface TimingBlock { text: string; start_sec: number; end_sec: number; }

function alignmentToTimingBlocks(
    text: string,
    alignment: {
        characters: string[];
        character_start_times_seconds: number[];
        character_end_times_seconds: number[];
    } | null | undefined
): TimingBlock[] {
    if (!alignment?.characters?.length) return [];

    // Split on sentence-ending punctuation, keeping the delimiter
    const sentences = text.match(/[^.!?！。？]+[.!?！。？]*/g) ?? [text];
    const blocks: TimingBlock[] = [];
    let charCursor = 0;

    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) { charCursor += sentence.length; continue; }

        // Find where this sentence's chars start/end in the alignment array
        const startIdx = Math.min(charCursor, alignment.characters.length - 1);
        const endIdx = Math.min(charCursor + sentence.length - 1, alignment.characters.length - 1);

        const startSec = alignment.character_start_times_seconds[startIdx] ?? 0;
        const endSec = alignment.character_end_times_seconds[endIdx] ?? startSec + 0.06 * trimmed.length;

        blocks.push({ text: trimmed, start_sec: Number(startSec.toFixed(3)), end_sec: Number(endSec.toFixed(3)) });
        charCursor += sentence.length;
    }

    return blocks;
}

// ── ElevenLabs /with-timestamps wrapper ─────────────────────────
// Returns { audioBuffer, alignment, durationSec, timingBlocks }
async function elevenLabsTTSWithTiming(params: {
    text: string;
    voiceId: string;
    apiKey: string;
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
    speed?: number;
    emotion?: string; // mapped to style_exaggeration
}): Promise<{
    audioBuffer: Buffer;
    alignment: any;
    durationSec: number;
    timingBlocks: TimingBlock[];
    timingSource: 'elevenlabs_alignment';
    voiceIdUsed: string;
}> {
    const { text, voiceId, apiKey, modelId = 'eleven_multilingual_v2',
        stability = 0.5, similarityBoost = 0.75, speed = 1.0, emotion } = params;

    // Map emotion → style_exaggeration (0–1)
    const styleMap: Record<string, number> = {
        happy: 0.7, sad: 0.4, angry: 0.9, excited: 0.85, calm: 0.2, neutral: 0.5
    };
    const style = emotion ? (styleMap[emotion] ?? 0.5) : 0.5;

    // ★ voice_settings only accepts: stability, similarity_boost, style, use_speaker_boost
    //    Do NOT pass speed or pitch here — ElevenLabs returns 422 for unknown fields
    const voiceSettings: Record<string, any> = {
        stability,
        similarity_boost: similarityBoost,
        use_speaker_boost: true,
    };
    // style (0–1) is only supported by v2 models; safe to include for eleven_multilingual_v2
    if (modelId.includes('v2') || modelId.includes('multilingual')) {
        voiceSettings.style = style;
    }

    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
        {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'xi-api-key': apiKey,
            },
            body: JSON.stringify({
                text,
                model_id: modelId,
                voice_settings: voiceSettings,
            }),
        }
    );

    if (!response.ok) {
        const errText = await response.text();
        console.error('[ElevenLabs/timestamps] Error:', response.status, errText);
        throw new Error(`ElevenLabs API ${response.status}: ${errText.substring(0, 200)}`);
    }

    const json = await response.json() as {
        audio_base64: string;
        alignment: {
            characters: string[];
            character_start_times_seconds: number[];
            character_end_times_seconds: number[];
        };
    };

    const audioBuffer = Buffer.from(json.audio_base64, 'base64');
    const alignment = json.alignment;

    // Real duration = last character's end time
    const chars = alignment?.character_end_times_seconds;
    const durationSec = chars?.length ? Number(chars[chars.length - 1].toFixed(3)) : Math.max(1, text.split(/\s+/).length / 2.5);

    const timingBlocks = alignmentToTimingBlocks(text, alignment);

    return { audioBuffer, alignment, durationSec, timingBlocks, timingSource: 'elevenlabs_alignment', voiceIdUsed: voiceId };
}

// POST /api/audio/elevenlabs - Generate voice using ElevenLabs (with real alignment timing)
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
            return res.status(500).json({ error: 'ElevenLabs API key not configured — add ELEVENLABS_API_KEY to Vercel env vars' });
        }

        // Use default voice if not specified
        const selectedVoice = voice_id && ELEVENLABS_VOICES[voice_id]
            ? ELEVENLABS_VOICES[voice_id]
            : ELEVENLABS_VOICES['en_female_rachel'];

        console.log('[ElevenLabs] Generating voice (with-timestamps) for:', text.substring(0, 60) + '...');
        console.log('[ElevenLabs] Voice preset:', voice_id, '→ EL ID:', selectedVoice);

        // ★ Use /with-timestamps to get real character-level alignment
        const { audioBuffer, durationSec, timingBlocks, timingSource, voiceIdUsed } = await elevenLabsTTSWithTiming({
            text, voiceId: selectedVoice, apiKey: elevenlabsKey,
            stability, similarityBoost: similarity_boost, speed,
        });

        const supabaseAdmin = getSupabaseAdmin();
        const fileName = `voice_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;

        const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
            .from('videos')
            .upload(`audio/${fileName}`, audioBuffer, {
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

        console.log('[ElevenLabs] ✅ Voice generated:', publicUrl, '| duration:', durationSec, 's | blocks:', timingBlocks.length);

        res.json({
            audio_url: publicUrl,
            success: true,
            duration_sec: durationSec,
            timing_blocks: timingBlocks,
            timing_source: timingSource,
            voice_id_used: voiceIdUsed,
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

// POST /api/audio/generate-all - Generate voice for all scenes (real timing from ElevenLabs alignment)
app.post('/api/audio/generate-all', requireAuth, async (req: any, res: any) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Missing Authorization header' });
        }

        // ★ character_voices: { "CharacterName": "voice_preset_key" } for per-char voice mapping
        const { scenes, voice_id, background_music, character_voices } = req.body;

        if (!scenes || !Array.isArray(scenes)) {
            return res.status(400).json({ error: 'Missing scenes array' });
        }

        const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
        if (!elevenlabsKey) {
            return res.status(500).json({ error: 'ElevenLabs API key not configured — add ELEVENLABS_API_KEY to Vercel env vars' });
        }

        const defaultVoice = voice_id && ELEVENLABS_VOICES[voice_id]
            ? ELEVENLABS_VOICES[voice_id]
            : ELEVENLABS_VOICES['en_female_rachel'];

        const supabaseAdmin = getSupabaseAdmin();
        const results: any[] = [];

        // Generate voice for each scene
        for (const scene of scenes) {
            const { scene_number, dialogue, description, speaker } = scene;
            const textToSpeak = dialogue || description || '';

            if (!textToSpeak.trim()) {
                results.push({ scene_number, success: false, error: 'No text to speak' });
                continue;
            }

            // ★ Per-character voice lookup: check character_voices map by speaker name
            let selectedVoice = defaultVoice;
            if (speaker && character_voices?.[speaker]) {
                const presetKey = character_voices[speaker];
                selectedVoice = ELEVENLABS_VOICES[presetKey] ?? defaultVoice;
                console.log(`[ElevenLabs] Scene ${scene_number}: char "${speaker}" → voice preset "${presetKey}" → EL ID "${selectedVoice}"`);
            }

            try {
                // ★ Use /with-timestamps for real alignment timing
                const { audioBuffer, durationSec, timingBlocks, timingSource, voiceIdUsed }
                    = await elevenLabsTTSWithTiming({ text: textToSpeak, voiceId: selectedVoice, apiKey: elevenlabsKey });

                const fileName = `voice_scene${scene_number}_${Date.now()}.mp3`;

                const { error: uploadError } = await supabaseAdmin.storage
                    .from('videos')
                    .upload(`audio/${fileName}`, audioBuffer, {
                        contentType: 'audio/mpeg',
                        upsert: false,
                    });

                if (uploadError) {
                    throw new Error(uploadError.message);
                }

                const { data: { publicUrl } } = supabaseAdmin.storage
                    .from('videos')
                    .getPublicUrl(`audio/${fileName}`);

                console.log(`[ElevenLabs] ✅ Scene ${scene_number}: ${publicUrl} | ${durationSec}s | ${timingBlocks.length} blocks`);

                results.push({
                    scene_number,
                    audio_url: publicUrl,
                    success: true,
                    duration_sec: durationSec,
                    timing_blocks: timingBlocks,
                    timing_source: timingSource,
                    voice_id_used: voiceIdUsed,
                    speaker: speaker || null,
                });
            } catch (err: any) {
                console.error(`[ElevenLabs] Scene ${scene_number} error:`, err.message);
                results.push({ scene_number, success: false, error: err.message });
            }
        }

        // Build timeline JSON: shot_id → { audio_url, duration_sec, timing_blocks }
        const timelineJson = results
            .filter(r => r.success)
            .reduce((acc: any, r: any) => {
                acc[`scene_${r.scene_number}`] = {
                    audio_url: r.audio_url,
                    duration_sec: r.duration_sec,
                    timing_blocks: r.timing_blocks,
                    timing_source: r.timing_source,
                    speaker: r.speaker,
                };
                return acc;
            }, {});

        res.json({
            results,
            timeline_json: timelineJson,
            success: results.filter(r => r.success).length > 0,
        });
    } catch (err: any) {
        console.error('[ElevenLabs] Generate All Error:', err);
        res.status(500).json({ error: err.message || 'Failed to generate voices' });
    }
});

// POST /api/video/stitch - Stitch multiple videos together (REAL FFmpeg implementation)
app.post('/api/video/stitch', requireAuth, async (req: any, res: any) => {
    try {
        const { video_urls, voice_urls, output_format = 'mp4' } = req.body;

        if (!video_urls || !Array.isArray(video_urls) || video_urls.length === 0) {
            return res.status(400).json({ error: 'Missing video_urls array' });
        }

        console.log('[Video Stitch] Processing', video_urls.length, 'videos with REAL FFmpeg stitching');

        const { stitchVideos } = await import('../lib/videoStitcher.js');

        const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
        const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

        const segments = video_urls.map((url: string, i: number) => ({
            scene_number: i + 1,
            video_url: url,
            audio_url: voice_urls?.[i],
        }));

        const result = await stitchVideos(
            { project_id: `stitch_${Date.now()}`, segments },
            supabaseUrl,
            supabaseKey,
        );

        res.json({
            success: result.success,
            video_url: result.output_url || video_urls[0],
            video_urls: result.video_urls || video_urls,
            video_count: video_urls.length,
            message: result.error || 'Videos stitched successfully',
            stitched: !!result.output_url && !result.error,
        });
    } catch (err: any) {
        console.error('[Video Stitch] Error:', err);
        res.status(500).json({ error: err.message || 'Failed to stitch videos' });
    }
});

// ───────────────────────────────────────────────────────────────
// POST /api/video/finalize — Finalize & stitch all scene videos (REAL FFmpeg stitching)
// ───────────────────────────────────────────────────────────────
app.post('/api/video/finalize', requireAuth, async (req: any, res: any) => {
    try {
        const { project_id, segments, background_music, transitions, output_format } = req.body;

        if (!segments || !Array.isArray(segments) || segments.length === 0) {
            return res.status(400).json({ error: 'Missing segments array' });
        }

        console.log(`[Video Finalize] Project ${project_id}: ${segments.length} segments — REAL FFmpeg stitching`);

        const { stitchVideos } = await import('../lib/videoStitcher.js');

        const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
        const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

        const result = await stitchVideos(
            {
                project_id: project_id || `project_${Date.now()}`,
                segments: segments.map((s: any) => ({
                    scene_number: s.scene_number || 0,
                    video_url: s.video_url,
                    audio_url: s.audio_url,
                    subtitle_text: s.subtitle_text,
                })),
                background_music: background_music || undefined,
                transitions: transitions || { type: 'cut', duration: 0 },
                output_format: output_format || { resolution: '1080p', format: 'mp4', fps: 30 },
            },
            supabaseUrl,
            supabaseKey,
        );

        res.json({
            success: result.success,
            job_id: result.job_id,
            status: result.status,
            progress: result.progress,
            output_url: result.output_url,
            video_urls: result.video_urls,
            segment_count: result.segment_count,
            total_duration_sec: result.total_duration_sec,
            stitched: !!result.output_url && !result.error,
            message: result.error
                ? `Playlist mode: ${result.error}`
                : `${result.segment_count} videos stitched into final cut`,
            timeline: result.timeline,
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
        // voice param can be a preset key (e.g. "zh_female_shuang") or a raw EL voice ID
        const voicePresetKey = voice || 'en_female_rachel';
        const ELEVEN_LABS_VOICE_ID = ELEVENLABS_VOICES[voicePresetKey]
            ?? process.env.ELEVEN_LABS_VOICE_ID
            ?? 'pNInz6obpgDQGcFmaJgB'; // fallback: Adam

        if (!ELEVEN_LABS_API_KEY) {
            return res.status(500).json({ error: 'ElevenLabs API key not configured — add ELEVENLABS_API_KEY to Vercel env vars' });
        }

        // Map emotion to ElevenLabs stability / similarity settings
        const stabilityMap: Record<string, number> = {
            'happy': 0.5, 'sad': 0.4, 'angry': 0.3, 'neutral': 0.7, 'excited': 0.6, 'calm': 0.8
        };
        const similarityMap: Record<string, number> = {
            'happy': 0.8, 'sad': 0.3, 'angry': 0.9, 'neutral': 0.5, 'excited': 0.9, 'calm': 0.4
        };
        const stability = stabilityMap[emotion] ?? 0.7;
        const similarityBoost = similarityMap[emotion] ?? 0.5;

        console.log(`[ElevenLabs/dialogue] voice="${voicePresetKey}"→"${ELEVEN_LABS_VOICE_ID}" emotion="${emotion}" text="${text.substring(0, 60)}..."`);

        // ★ Use /with-timestamps for real sentence-level timing (not word-count estimate)
        const { audioBuffer, durationSec, timingBlocks, timingSource, voiceIdUsed }
            = await elevenLabsTTSWithTiming({
                text, voiceId: ELEVEN_LABS_VOICE_ID, apiKey: ELEVEN_LABS_API_KEY,
                modelId: 'eleven_multilingual_v2',
                stability, similarityBoost, emotion,
            });

        // Upload to Supabase Storage — use 'videos' bucket (consistent with other voice endpoints)
        const supabaseAdmin = getSupabaseAdmin();
        const fileName = `dialogue_${Date.now()}.mp3`;

        const { data, error } = await supabaseAdmin.storage
            .from('videos')
            .upload(`audio/${fileName}`, audioBuffer, {
                contentType: 'audio/mpeg',
                upsert: true
            });

        if (error) {
            console.error('[ElevenLabs] Upload Error:', error);
            return res.status(500).json({ error: error.message });
        }

        const { data: urlData } = supabaseAdmin.storage
            .from('videos')
            .getPublicUrl(`audio/${fileName}`);

        console.log(`[ElevenLabs/dialogue] ✅ ${urlData.publicUrl} | ${durationSec}s | ${timingBlocks.length} blocks | timing_source: ${timingSource}`);

        res.json({
            ok: true,
            url: urlData.publicUrl,
            audio_url: urlData.publicUrl, // alias for consistency
            duration: durationSec,         // real duration from alignment
            duration_sec: durationSec,
            timing_blocks: timingBlocks,   // sentence-level [{text, start_sec, end_sec}]
            timing_source: timingSource,   // "elevenlabs_alignment" — never a mock estimate
            voice_id_used: voiceIdUsed,
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
        const supabaseUser = getUserClient(authHeader);
        const userId = await getUserId(supabaseUser);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

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
// GET /api/video/status/:id — Real status endpoint for finalize polling
// Uses in-memory cache from recent stitch results + DB check
// ───────────────────────────────────────────────────────────────
const _stitchJobCache = new Map<string, { status: string; progress: number; output_url?: string; error?: string }>();

// Store completed stitch jobs for status polling (called internally)
function cacheStitchResult(jobId: string, result: { status: string; progress: number; output_url?: string; error?: string }) {
    _stitchJobCache.set(jobId, result);
    // Auto-cleanup after 30 minutes
    setTimeout(() => _stitchJobCache.delete(jobId), 30 * 60 * 1000);
}

app.get('/api/video/status/:id', requireAuth, async (req: any, res: any) => {
    const jobId = req.params.id;
    
    // Check in-memory cache first
    const cached = _stitchJobCache.get(jobId);
    if (cached) {
        return res.json({
            job_id: jobId,
            status: cached.status,
            progress: cached.progress,
            output_url: cached.output_url,
            error: cached.error,
        });
    }

    // If job starts with 'stitch_' or 'final_', it was a stitching job
    // that completed synchronously and wasn't cached (old format or race)
    if (jobId.startsWith('stitch_') || jobId.startsWith('final_')) {
        return res.json({
            job_id: jobId,
            status: 'completed',
            progress: 100,
            message: 'Job completed (not found in cache, likely finished synchronously)',
        });
    }

    // Unknown job
    res.status(404).json({
        job_id: jobId,
        status: 'unknown',
        progress: 0,
        error: 'Job not found',
    });
});

// ───────────────────────────────────────────────────────────────
// POST /api/audio/mix — REAL FFmpeg audio mixing
// ───────────────────────────────────────────────────────────────
app.post('/api/audio/mix', requireAuth, async (req: any, res: any) => {
    try {
        const { video_url, dialogue_url, music_url, sfx_urls, output_format = 'mp4' } = req.body;

        if (!video_url) {
            return res.status(400).json({ error: 'Missing video_url' });
        }

        // If no audio tracks, return original video
        if (!dialogue_url && !music_url && (!sfx_urls || sfx_urls.length === 0)) {
            console.log('[AudioMix] No audio tracks provided, returning original video');
            return res.json({ ok: true, video_url: video_url, mixed: false });
        }

        console.log('[AudioMix] Starting REAL audio mixing...');

        // Resolve FFmpeg path
        let ffmpegPath = 'ffmpeg';
        try {
            const installer = require('@ffmpeg-installer/ffmpeg');
            if (installer?.path) ffmpegPath = installer.path;
        } catch { /* use system ffmpeg */ }

        const { existsSync, promises: fsPromises } = require('fs');
        const { join } = require('path');
        const { execFile: execFileFn } = require('child_process');
        const { promisify: promisifyFn } = require('util');
        const execFilePromise = promisifyFn(execFileFn);

        const workDir = join(process.cwd(), '.mix_tmp', `mix_${Date.now()}`);
        await fsPromises.mkdir(workDir, { recursive: true });

        // Download video
        const videoPath = join(workDir, 'input_video.mp4');
        const videoResponse = await fetch(video_url);
        if (!videoResponse.ok) throw new Error(`Failed to download video: ${videoResponse.status}`);
        await fsPromises.writeFile(videoPath, Buffer.from(await videoResponse.arrayBuffer()));

        // Download audio tracks
        const audioInputs: { path: string; volume: number; label: string }[] = [];

        if (dialogue_url) {
            const dialoguePath = join(workDir, 'dialogue.mp3');
            const resp = await fetch(dialogue_url);
            if (resp.ok) {
                await fsPromises.writeFile(dialoguePath, Buffer.from(await resp.arrayBuffer()));
                audioInputs.push({ path: dialoguePath, volume: 1.0, label: 'dialogue' });
            }
        }

        if (music_url) {
            const musicPath = join(workDir, 'music.mp3');
            const resp = await fetch(music_url);
            if (resp.ok) {
                await fsPromises.writeFile(musicPath, Buffer.from(await resp.arrayBuffer()));
                audioInputs.push({ path: musicPath, volume: 0.3, label: 'music' });
            }
        }

        if (sfx_urls && Array.isArray(sfx_urls)) {
            for (let i = 0; i < Math.min(sfx_urls.length, 5); i++) {
                const sfxPath = join(workDir, `sfx_${i}.mp3`);
                const resp = await fetch(sfx_urls[i]);
                if (resp.ok) {
                    await fsPromises.writeFile(sfxPath, Buffer.from(await resp.arrayBuffer()));
                    audioInputs.push({ path: sfxPath, volume: 0.5, label: `sfx${i}` });
                }
            }
        }

        if (audioInputs.length === 0) {
            await fsPromises.rm(workDir, { recursive: true, force: true }).catch(() => {});
            return res.json({ ok: true, video_url: video_url, mixed: false });
        }

        // Build FFmpeg args (using execFile for safety — no shell injection)
        const outputPath = join(workDir, 'mixed_output.mp4');
        const ffmpegArgs: string[] = ['-y', '-i', videoPath];

        for (const audio of audioInputs) {
            ffmpegArgs.push('-i', audio.path);
        }

        // Build filter_complex for mixing
        const filterParts: string[] = [];
        const mixLabels: string[] = [];

        for (let i = 0; i < audioInputs.length; i++) {
            const inputIdx = i + 1; // 0 is video
            const label = audioInputs[i].label;
            filterParts.push(`[${inputIdx}:a]volume=${audioInputs[i].volume}[${label}]`);
            mixLabels.push(`[${label}]`);
        }

        let filterComplex: string;
        if (mixLabels.length === 1) {
            filterComplex = filterParts[0].replace(`[${audioInputs[0].label}]`, '[aout]');
        } else {
            filterComplex = filterParts.join(';') + ';' +
                mixLabels.join('') + `amix=inputs=${mixLabels.length}:duration=first:dropout_transition=2[aout]`;
        }

        ffmpegArgs.push(
            '-filter_complex', filterComplex,
            '-map', '0:v',
            '-map', '[aout]',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            outputPath
        );

        console.log('[AudioMix] Running FFmpeg with', audioInputs.length, 'audio tracks');

        try {
            await execFilePromise(ffmpegPath, ffmpegArgs, {
                timeout: 120000,
                maxBuffer: 10 * 1024 * 1024,
            });
        } catch (ffErr: any) {
            console.error('[AudioMix] FFmpeg failed:', ffErr.message?.substring(0, 200));
            await fsPromises.rm(workDir, { recursive: true, force: true }).catch(() => {});
            return res.json({
                ok: true,
                video_url: video_url,
                mixed: false,
                message: 'Audio mixing failed, returning original video',
            });
        }

        // Upload mixed result
        const supabaseAdmin = getSupabaseAdmin();
        const outputBuffer = await fsPromises.readFile(outputPath);
        const fileName = `mixed_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
        const storagePath = `mixed/${fileName}`;

        const { error: uploadErr } = await supabaseAdmin.storage
            .from('videos')
            .upload(storagePath, outputBuffer, {
                contentType: 'video/mp4',
                upsert: true,
            });

        // Cleanup
        fsPromises.rm(workDir, { recursive: true, force: true }).catch(() => {});

        if (uploadErr) {
            console.error('[AudioMix] Upload failed:', uploadErr.message);
            return res.json({ ok: true, video_url: video_url, mixed: false, message: 'Upload failed' });
        }

        const { data: { publicUrl } } = supabaseAdmin.storage
            .from('videos')
            .getPublicUrl(storagePath);

        console.log('[AudioMix] ✅ Mixed video uploaded:', publicUrl);

        res.json({
            ok: true,
            video_url: publicUrl,
            mixed: true,
            message: `Audio mixed successfully with ${audioInputs.length} track(s)`,
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

        logger.replicate.info('multiframe_start', { frames: frames.length, model });

        const { generateMultiFrameVideo } = await import('../services/multiFrameService');

        const results = await generateMultiFrameVideo(
            {
                frames: frames.map((f: any) => ({
                    prompt: f.prompt,
                    imageUrl: f.imageUrl,
                    duration: f.duration || 4,
                    transitionType: f.transitionType || 'cut'
                })),
                model: model,
                aspectRatio: aspectRatio || '16:9',
                characterAnchor: characterAnchor,
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
        logger.replicate.error('multiframe_error', (err as any)?.message || String(err));
        res.status(500).json({ error: err.message || 'Multi-frame generation failed' });
    }
});

    // 全局错误处理中间件 (必须放在所有路由之后)
    app.use(errorHandlerMiddleware);

    // 启动日志
    const startupLogger = logger.api;
    const port = process.env.API_SERVER_PORT || 3002;

    // 记录启动信息
    if (process.env.NODE_ENV !== 'production') {
        startupLogger.info('server_startup', {
            port,
            environment: process.env.NODE_ENV,
            timestamp: new Date().toISOString(),
        });
    }

export default app;