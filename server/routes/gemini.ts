/**
 * Gemini API 代理路由
 * 安全地在服务器端调用 Gemini API
 */
import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

export const geminiRouter = Router();

// ★ DEVELOPER EMAILS - admin bypass list (must match AppContext.tsx)
const DEVELOPER_EMAILS = new Set(['forevercrab321@gmail.com']);

// ★ Helper: check if user is admin (by email or db flag)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkIsAdmin(supabaseUser: any): Promise<boolean> {
    try {
        const { data: { user } } = await supabaseUser.auth.getUser();
        if (!user) return false;

        if (user.email && DEVELOPER_EMAILS.has(user.email.toLowerCase())) {
            console.log(`[ADMIN CHECK] Developer email detected: ${user.email}`);
            return true;
        }

        const { data: profile } = await supabaseUser
            .from('profiles')
            .select('is_admin')
            .eq('id', user.id)
            .single();

        return profile != null && profile.is_admin === true;
    } catch {
        return false;
    }
}

const getAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured on server');
    return new GoogleGenAI({ apiKey });
};

const responseSchema = {
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

// POST /api/gemini/generate - 生成故事板
geminiRouter.post('/generate', async (req, res) => {
    const jobRef = `gemini:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
        const { storyIdea, visualStyle, language, mode, identityAnchor } = req.body;

        // ★ 1. Auth & Credit Check
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: "Missing Authorization header" });
        }

        // We use the ANON key + User Token to act as the user for RLS/RPC
        const supabaseUserClient = createClient(
            process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: authHeader } } }
        );

        // ★ 1b. Validate inputs FIRST — before reserving credits to prevent credit lock-up
        if (!storyIdea || typeof storyIdea !== 'string') {
            return res.status(400).json({ error: 'Missing storyIdea' });
        }
        if (storyIdea.length > 2000) {
            return res.status(400).json({ error: 'storyIdea too long (max 2000 characters)' });
        }
        if (visualStyle && typeof visualStyle === 'string' && visualStyle.length > 200) {
            return res.status(400).json({ error: 'visualStyle too long (max 200 characters)' });
        }

        // ★ Check admin status — admins bypass all credit checks
        const isAdmin = await checkIsAdmin(supabaseUserClient);

        // Deduct 1 credit for Storyboard via ledger (normal users only)
        const COST = 1;

        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUserClient.rpc('reserve_credits', {
                amount: COST,
                ref_type: 'gemini',
                ref_id: jobRef
            });

            if (reserveErr) {
                console.error('Gemini credit reserve error:', reserveErr);
                return res.status(500).json({ error: 'Credit verification failed' });
            }

            if (!reserved) {
                return res.status(402).json({ error: "Insufficient credits", code: "INSUFFICIENT_CREDITS" });
            }
        } else {
            console.log(`[ADMIN BYPASS] Skipping credit reserve for admin user`);
        }

        const ai = getAI();

        const systemInstruction = `
**Role:** Professional Hollywood Screenwriter & Director of Photography.
**Task:** Break down the User's Story Concept into a production-ready script with 5 distinct scenes.

**★ CRITICAL — CHARACTER CONSISTENCY RULES (MANDATORY):**
The "character_anchor" field is the SINGLE SOURCE OF TRUTH for the protagonist's appearance.
It MUST be an extremely detailed, frozen visual identity containing ALL of the following:
- Exact ethnicity and age range (e.g., "East Asian male, early 20s")
- Face shape, eye color, eye shape, eyebrow style
- Hair: exact color, length, style (e.g., "jet black spiky hair, shoulder length")
- Outfit: exact clothing with colors and materials (e.g., "red silk scarf, golden armor plates, dark leather boots")
- Body type and posture
- Art style lock (e.g., "3D donghua style" or "photorealistic" — MUST match the user's chosen visual style)

${identityAnchor
                ? `The character is HARD-LOCKED to: "${identityAnchor}". Copy this identity EXACTLY into character_anchor. Do NOT modify it.`
                : `You MUST invent a highly specific, unique character_anchor. Be extremely detailed — face, hair, skin, outfit, accessories, art style. The more detail, the better.`}

**★ SCENE CONSISTENCY RULE:**
EVERY scene's "visual_description" MUST begin with the EXACT character_anchor text, word for word, followed by the scene-specific action and environment. This ensures the same character appears in every frame. Do NOT paraphrase or abbreviate the anchor.

**Technical Precision:** Describe camera movements (dolly, tracking, crane), lighting (golden hour, neon, overcast), and composition.

**Language Rule:**
* **visual_description** & **shot_type**: ALWAYS in English.
* **audio_description** & **project_title**: ${language === 'zh' ? "Chinese (Simplified)" : "English"}.

**Output Format:** JSON strictly following the provided schema.
`;

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `Draft a 5-scene storyboard for: ${storyIdea}. Style: ${visualStyle}`,
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema,
                    temperature: 0.7,
                },
            });
        } catch (initialError: any) {
            // Check for 429 Resource Exhausted or 503 Service Unavailable
            if (initialError.message?.includes('429') || initialError.message?.includes('Resource exhausted') || initialError.status === 429) {
                console.warn('[Gemini] Quota exhausted on 2.0-flash, falling back to 1.5-flash...');
                response = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: `Draft a 5-scene storyboard for: ${storyIdea}. Style: ${visualStyle}`,
                    config: {
                        systemInstruction,
                        responseMimeType: 'application/json',
                        responseSchema,
                        temperature: 0.7,
                    },
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

        // Attach lightweight consistency metadata per scene so tests and UI can
        // validate anchor prefix and keyword coverage. This is a heuristic: we
        // extract token candidates from the anchor and count how many appear in
        // each scene's description or motion prompt.
        try {
            const anchorText = (project.character_anchor || '').toLowerCase();
            const stopwords = new Set(['a','an','the','with','and','wearing','holding','short','long','male','female','man','woman','young','old','in','of','his','her']);
            const tokens = (anchorText.match(/\b[a-z0-9]{2,}\b/g) || []).filter(t => !stopwords.has(t));
            const criticalKeywords = Array.from(new Set(tokens));

            project.scenes = project.scenes.map((s: any) => {
                const desc = (s.visual_description || '').toLowerCase();
                const motion = (s.video_motion_prompt || '').toLowerCase();

                const critical_present = criticalKeywords.filter(k => desc.includes(k) || motion.includes(k)).length;
                const total_critical = criticalKeywords.length || 1;
                const has_prefix = anchorText.length > 0 && desc.startsWith(anchorText.slice(0, Math.min(40, anchorText.length)));

                return {
                    ...s,
                    _consistency_check: {
                        has_anchor_prefix: !!has_prefix,
                        critical_keywords_present: critical_present,
                        total_critical_keywords: total_critical
                    }
                };
            });
        } catch (metaErr) {
            console.warn('[Gemini] Consistency metadata generation failed:', metaErr);
        }

        // Finalize the reserve (credits are consumed) — normal users only
        if (!isAdmin) {
            await supabaseUserClient.rpc('finalize_reserve', {
                ref_type: 'gemini',
                ref_id: jobRef
            });
        }

        res.json(project);
    } catch (error: any) {
        console.error('[Gemini] Error:', error);

        // Refund reserved credits on failure (normal users only)
        try {
            const supabaseRefund = createClient(
                process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                { global: { headers: { Authorization: req.headers.authorization as string } } }
            );
            const refundIsAdmin = await checkIsAdmin(supabaseRefund);
            if (!refundIsAdmin) {
                await supabaseRefund.rpc('refund_reserve', {
                    amount: 1,
                    ref_type: 'gemini',
                    ref_id: jobRef
                });
            }
        } catch (refundErr) {
            console.error('[Gemini] Refund failed:', refundErr);
        }

        const isQuotaError = error.message?.includes('429') ||
            error.message?.includes('Resource exhausted') ||
            error.status === 429;

        res.status(isQuotaError ? 429 : 500).json({
            error: isQuotaError ? 'System is busy (Quota Exceeded). Please try again in a moment.' : (error.message || 'Gemini generation failed'),
            details: error.toString(),
        });
    }
});

// POST /api/gemini/analyze - 分析角色锚点
geminiRouter.post('/analyze', async (req, res) => {
    try {
        // ★ SECURITY: Require authentication to prevent unauthorized Gemini API abuse
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'Missing Authorization header' });
        }

        const { base64Data } = req.body;
        if (!base64Data) {
            return res.status(400).json({ error: 'Missing base64Data' });
        }

        const ai = getAI();
        const cleanBase64 = base64Data.split(',')[1] || base64Data;
        const mimeType = base64Data.match(/:(.*?);/)?.[1] || 'image/png';

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: {
                parts: [
                    { inlineData: { mimeType, data: cleanBase64 } },
                    { text: 'Analyze this character and extract a dense Identity Anchor description: face, hair, and key outfit elements.' },
                ],
            },
        });

        const result = (response.text || 'A cinematic character').trim();
        res.json({ anchor: result });
    } catch (error: any) {
        console.error('[Gemini Analyze] Error:', error.message);
        res.json({ anchor: 'A cinematic character' });
    }
});
