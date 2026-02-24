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
                    scene_setting: { type: Type.STRING },
                    visual_description: { type: Type.STRING },
                    audio_description: { type: Type.STRING },
                    shot_type: { type: Type.STRING },
                },
                required: ['scene_number', 'scene_setting', 'visual_description', 'audio_description', 'shot_type'],
            },
        },
    },
    required: ['project_title', 'visual_style', 'character_anchor', 'scenes'],
};

// POST /api/gemini/generate - 生成故事板
geminiRouter.post('/generate', async (req, res) => {
    const jobRef = `gemini:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    try {
        const { storyIdea, visualStyle, language, mode, identityAnchor, sceneCount } = req.body;
        const targetScenes = Math.min(Math.max(Number(sceneCount) || 5, 1), 50);
        
        console.log(`[Gemini Generate] identityAnchor present: ${!!identityAnchor}, length: ${identityAnchor?.length || 0}, first100: ${identityAnchor?.substring(0, 100) || 'NONE'}`);

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
**Role:** Professional Short Drama Screenwriter & Director of Photography.

**★★★ CORE CONCEPT — SHORT DRAMA CONTINUITY ★★★**
You are writing a SHORT DRAMA (短剧). The ${targetScenes} scenes are like TRAIN CARRIAGES — they connect end-to-end into ONE continuous story. Scene 1's ending leads directly into Scene 2's beginning, Scene 2's ending leads into Scene 3, and so on.

**CONTINUITY RULES (MANDATORY):**
1. **One Continuous Story:** All ${targetScenes} scenes tell a SINGLE coherent story from start to finish. They are NOT independent vignettes.
2. **Scene Transitions:** The END of each scene must naturally connect to the BEGINNING of the next scene. Think of it as cutting from one shot to the next in a movie — the viewer should feel the story flowing forward.
3. **Progressive Plot:** The story must progress: introduction → development → turning point → climax → ending. Each scene pushes the plot forward.
4. **Same World:** Scenes can share locations if the story calls for it (e.g., a character walks through a park, then sits on a bench in the same park). Do NOT force random unrelated locations.
5. **Cause & Effect:** What happens in Scene N should have consequences visible in Scene N+1.

**★ SCENE_SETTING FIELD:**
Describe WHERE and WHEN this scene takes place. Settings can recur or evolve naturally (e.g., "Same café, 10 minutes later" or "The park from Scene 1, now at sunset"). The goal is story logic, not forced variety.

**★ VISUAL_DESCRIPTION FIELD:**
This field describes what the character is DOING in this specific moment — their action, expression, body language, and how they interact with the environment.

**FORMAT REQUIREMENT:**
visual_description must START with an ACTION VERB or descriptive phrase of the scene:
✅ GOOD: "stands at the mountain peak, gazing at the sunrise with determination"
✅ GOOD: "carves through fresh powder, spraying snow behind"
✅ GOOD: "crashes into a snowdrift, laughing and struggling to stand up"
❌ BAD: "A 25-year-old Han Chinese man with... [repeating character_anchor]"
❌ BAD: Starting with character appearance description

**CRITICAL RULE: DO NOT COPY character_anchor INTO visual_description.**
The character_anchor is ALREADY stored separately at the top level.
Each scene's visual_description shows ONLY the unique action/moment that advances the plot.

Each scene must show a DIFFERENT moment in the story — the character doing something new that advances the plot.
This should read like a movie shot description focusing on ACTION and EMOTION.

**★ CHARACTER CONSISTENCY:**
The "character_anchor" is the protagonist's frozen visual identity — same face, same outfit, same person across all scenes.
${identityAnchor
                ? `Character is LOCKED to: "${identityAnchor}". Copy this EXACTLY into character_anchor.`
                : `Invent a detailed character_anchor: ethnicity, age, face shape, eye color, hair (color/length/style), outfit (colors/materials), body type. Must match the "${visualStyle}" art style.`}
The character_anchor is stored ONCE at the top level. Each scene's visual_description should focus on what the character is DOING, not re-describe their appearance.

**Technical Precision:** Specify camera work (dolly, tracking, crane, handheld, pan), lighting, and composition per scene.

**Language Rule:**
* **visual_description**, **scene_setting** & **shot_type**: ALWAYS in English.
* **audio_description** & **project_title**: ${language === 'zh' ? "Chinese (Simplified)" : "English"}.

**Output Format:** JSON strictly following the provided schema.
`;

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `Write a ${targetScenes}-scene SHORT DRAMA (短剧) for: ${storyIdea}. Style: ${visualStyle}. The ${targetScenes} scenes must connect like train carriages — Scene 1 flows into Scene 2, Scene 2 flows into Scene 3, etc. Tell ONE continuous story with the SAME character throughout. Each scene shows a different moment that advances the plot forward.`,
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
                    contents: `Write a ${targetScenes}-scene SHORT DRAMA (短剧) for: ${storyIdea}. Style: ${visualStyle}. The ${targetScenes} scenes must connect like train carriages — Scene 1 flows into Scene 2, Scene 2 flows into Scene 3, etc. Tell ONE continuous story with the SAME character throughout. Each scene shows a different moment that advances the plot forward.`,
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
        
        // ★ Generate unique project ID for batch operations
        project.id = crypto.randomUUID();
        
        // ★ CRITICAL: Force character_anchor to match identityAnchor if provided
        // Gemini sometimes rewrites/changes the locked identity (e.g., changing gender).
        // We override at the code level to guarantee consistency.
        if (identityAnchor && identityAnchor.trim().length > 10) {
            project.character_anchor = identityAnchor.trim();
        }

        const anchor = project.character_anchor || '';

        // ★ CRITICAL POST-PROCESSING: Strip repeated character_anchor prefix from visual_description
        // Gemini stubbornly prefixes every visual_description with the character_anchor text.
        // This makes all scenes look identical when truncated in the UI.
        // We strip the anchor prefix so visual_description shows ONLY the unique action/scene content.
        const anchorLower = anchor.toLowerCase().trim();

        project.scenes = project.scenes.map((s: any, idx: number) => {
            const setting = s.scene_setting || '';
            let rawDesc = (s.visual_description || '').trim();

            // ★ Strip character_anchor prefix from visual_description if Gemini repeated it
            if (anchorLower.length > 20) {
                const descLower = rawDesc.toLowerCase();
                // Try exact prefix match
                if (descLower.startsWith(anchorLower)) {
                    rawDesc = rawDesc.slice(anchor.length).replace(/^[,;.:\s]+/, '').trim();
                } else {
                    // Try fuzzy match: find where the anchor-like text ends
                    // Look for first 30 chars of anchor as prefix indicator
                    const anchorStart = anchorLower.slice(0, Math.min(30, anchorLower.length));
                    if (descLower.startsWith(anchorStart)) {
                        // Find the divergence point after the anchor-like prefix
                        // Scan for common action verbs or scene transition markers
                        const actionMarkers = /\b(is |are |was |stands |standing |walks |walking |runs |running |sits |sitting |looks |looking |holds |holding |reaches |reaching |turns |turning |steps |stepping |enters |entering |exits |leaving |opens |opening |closes |fights |fighting |rides |riding |drives |driving |picks |picking |carries |carrying |gazes |gazing |smiles |smiling |cries |crying |laughs |laughing |struggles |struggling |discovers |examining |the camera |camera |she |he |they |who |while )/.exec(descLower);
                        if (actionMarkers && actionMarkers.index > 20) {
                            rawDesc = rawDesc.slice(actionMarkers.index).trim();
                            // Capitalize first letter
                            rawDesc = rawDesc.charAt(0).toUpperCase() + rawDesc.slice(1);
                        }
                    }
                }
            }

            // Fallback: if rawDesc is still empty or too short after stripping
            if (rawDesc.length < 10) {
                rawDesc = s.visual_description || `Scene ${idx + 1}`;
            }

            // Build image prompt: anchor (for character consistency) + setting + unique action
            const actionForPrompt = rawDesc;
            const prompt = anchor
                ? `${anchor}. ${setting ? 'Setting: ' + setting + '. ' : ''}${actionForPrompt}. ${s.shot_type}. Single cinematic frame.`
                : `${s.visual_description}, ${setting}, ${s.shot_type}`;

            return {
                ...s,
                visual_description: rawDesc,  // ★ Now shows ONLY the unique action, not the repeated anchor
                image_prompt: prompt,
                video_motion_prompt: s.shot_type,
            };
        });

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

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: {
                parts: [
                    { inlineData: { mimeType, data: cleanBase64 } },
                    { text: `You are a professional character designer. Analyze this image and produce an EXACT visual identity description for AI image generation.

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
5. Output ONLY the description paragraph, nothing else` },
                ],
            },
        });

        const result = (response.text || '').trim();
        console.log(`[Gemini Analyze] ✅ Result: ${result.substring(0, 120)}...`);
        
        if (!result || result.length < 20) {
            console.error('[Gemini Analyze] ⚠️ Empty or too-short result from Gemini Vision');
            return res.status(500).json({ error: 'Gemini Vision returned empty result', anchor: 'A cinematic character' });
        }
        
        res.json({ anchor: result });
    } catch (error: any) {
        console.error('[Gemini Analyze] ❌ Error:', error.message);
        // ★ 返回 500 状态码让前端知道分析失败了，而非静默返回 fallback
        res.status(500).json({ error: error.message || 'Analyze failed', anchor: 'A cinematic character' });
    }
});
