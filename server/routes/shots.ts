/**
 * Shot System API Routes
 * - POST /generate — Generate detailed shots from a scene via Gemini
 * - GET  /:projectId — List all shots for a project
 * - PUT  /:shotId — Update a single shot (with optimistic locking)
 * - POST /:shotId/rewrite — AI-rewrite specific fields (respects locked_fields)
 * - GET  /:shotId/revisions — Revision history for a shot
 * - POST /:shotId/rollback/:version — Rollback to a previous version
 */
import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

export const shotsRouter = Router();

// ★ DEVELOPER EMAILS - admin bypass list
const DEVELOPER_EMAILS = new Set(['forevercrab321@gmail.com']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkIsAdmin(supabaseUser: any): Promise<boolean> {
    try {
        const { data: { user } } = await supabaseUser.auth.getUser();
        if (!user) return false;
        if (user.email && DEVELOPER_EMAILS.has(user.email.toLowerCase())) return true;
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

const getUserClient = (authHeader: string) => createClient(
    process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
);

// ───────────────────────────────────────────────────────────────
// Enhanced shot schema for Gemini structured output
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
                    shot_number: { type: Type.INTEGER },
                    duration_sec: { type: Type.NUMBER },
                    location_type: { type: Type.STRING },
                    location: { type: Type.STRING },
                    time_of_day: { type: Type.STRING },
                    characters: { type: Type.ARRAY, items: { type: Type.STRING } },
                    action: { type: Type.STRING },
                    dialogue: { type: Type.STRING },
                    camera: { type: Type.STRING },
                    lens: { type: Type.STRING },
                    movement: { type: Type.STRING },
                    composition: { type: Type.STRING },
                    lighting: { type: Type.STRING },
                    art_direction: { type: Type.STRING },
                    mood: { type: Type.STRING },
                    sfx_vfx: { type: Type.STRING },
                    audio_notes: { type: Type.STRING },
                    continuity_notes: { type: Type.STRING },
                    image_prompt: { type: Type.STRING },
                    negative_prompt: { type: Type.STRING },
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

// ═══════════════════════════════════════════════════════════════
// POST /api/shots/generate — Break a scene down into detailed shots
// ═══════════════════════════════════════════════════════════════
shotsRouter.post('/generate', async (req, res) => {
    try {
        const {
            scene_number,
            visual_description,
            audio_description,
            shot_type,
            visual_style,
            character_anchor,
            language,
            num_shots
        } = req.body;

        // Auth
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        if (!visual_description) return res.status(400).json({ error: 'Missing visual_description' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);

        // Credit check (1 credit for shot generation)
        const COST = 1;
        const jobRef = `shots:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'shots', ref_id: jobRef
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        }

        const ai = getAI();
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
10. "continuity_notes" should note what must match between adjacent shots (wardrobe, props, time of day, etc.)
11. Language: image_prompt, negative_prompt, and technical fields ALWAYS in English. dialogue and audio_notes in ${language === 'zh' ? 'Chinese (Simplified)' : 'English'}.

**Output:** JSON strictly following the provided schema. Return exactly ${targetShots} shots.
`;

        let response;
        try {
            response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: `Break Scene ${scene_number || 1} into ${targetShots} shots. Scene description: ${visual_description}`,
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: shotResponseSchema,
                    temperature: 0.6,
                },
            });
        } catch (initialError: any) {
            if (initialError.message?.includes('429') || initialError.status === 429) {
                console.warn('[Shots] Quota exhausted, falling back to gemini-1.5-flash...');
                response = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: `Break Scene ${scene_number || 1} into ${targetShots} shots. Scene description: ${visual_description}`,
                    config: {
                        systemInstruction,
                        responseMimeType: 'application/json',
                        responseSchema: shotResponseSchema,
                        temperature: 0.6,
                    },
                });
            } else {
                throw initialError;
            }
        }

        const text = response.text;
        if (!text) throw new Error('No response from AI');

        const result = JSON.parse(text);

        // Enrich shots with defaults
        const enrichedShots = (result.shots || []).map((s: any, idx: number) => ({
            shot_id: crypto.randomUUID(),
            scene_id: '', // Will be set by client
            scene_title: result.scene_title || `Scene ${scene_number || 1}`,
            shot_number: s.shot_number || idx + 1,
            duration_sec: s.duration_sec || 3,
            location_type: s.location_type || 'INT',
            location: s.location || '',
            time_of_day: s.time_of_day || 'day',
            characters: s.characters || [],
            action: s.action || '',
            dialogue: s.dialogue || '',
            camera: s.camera || 'medium',
            lens: s.lens || '50mm',
            movement: s.movement || 'static',
            composition: s.composition || '',
            lighting: s.lighting || '',
            art_direction: s.art_direction || '',
            mood: s.mood || '',
            sfx_vfx: s.sfx_vfx || '',
            audio_notes: s.audio_notes || '',
            continuity_notes: s.continuity_notes || '',
            image_prompt: s.image_prompt || '',
            negative_prompt: s.negative_prompt || '',
            seed_hint: null,
            reference_policy: 'anchor' as const,
            status: 'draft' as const,
            locked_fields: [],
            version: 1,
            updated_at: new Date().toISOString(),
        }));

        // Finalize credits
        if (!isAdmin) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'shots', ref_id: jobRef });
        }

        res.json({
            scene_title: result.scene_title || `Scene ${scene_number || 1}`,
            shots: enrichedShots,
        });

    } catch (error: any) {
        console.error('[Shots Generate] Error:', error);
        res.status(500).json({ error: error.message || 'Shot generation failed' });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/shots/:shotId/rewrite — AI-rewrite specific fields
// ═══════════════════════════════════════════════════════════════
shotsRouter.post('/:shotId/rewrite', async (req, res) => {
    try {
        const { shotId } = req.params;
        const {
            fields_to_rewrite,
            user_instruction,
            locked_fields,
            current_shot,
            project_context,
            language
        } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        if (!fields_to_rewrite?.length) return res.status(400).json({ error: 'No fields specified for rewrite' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);

        // 1 credit for AI rewrite
        const COST = 1;
        const jobRef = `rewrite:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: COST, ref_type: 'rewrite', ref_id: jobRef
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        }

        const ai = getAI();

        // Build context of locked vs unlocked fields
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
                config: {
                    systemInstruction,
                    responseMimeType: 'application/json',
                    temperature: 0.7,
                },
            });
        } catch (initialError: any) {
            if (initialError.message?.includes('429') || initialError.status === 429) {
                response = await ai.models.generateContent({
                    model: 'gemini-1.5-flash',
                    contents: `Rewrite fields [${fieldsStr}] for shot ${shotId}. ${user_instruction || ''}`,
                    config: {
                        systemInstruction,
                        responseMimeType: 'application/json',
                        temperature: 0.7,
                    },
                });
            } else {
                throw initialError;
            }
        }

        const text = response.text;
        if (!text) throw new Error('No response from AI');

        const rewrittenFields = JSON.parse(text);

        // Remove any locked fields that AI might have included
        for (const locked of (locked_fields || [])) {
            delete rewrittenFields[locked];
        }

        // Remove any fields not in the requested list
        for (const key of Object.keys(rewrittenFields)) {
            if (!fields_to_rewrite.includes(key)) {
                delete rewrittenFields[key];
            }
        }

        if (!isAdmin) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'rewrite', ref_id: jobRef });
        }

        res.json({
            shot_id: shotId,
            rewritten_fields: rewrittenFields,
            change_source: 'ai-rewrite',
            changed_fields: Object.keys(rewrittenFields),
        });

    } catch (error: any) {
        console.error('[Shot Rewrite] Error:', error);
        res.status(500).json({ error: error.message || 'Shot rewrite failed' });
    }
});
