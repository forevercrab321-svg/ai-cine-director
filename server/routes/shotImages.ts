/**
 * Shot Images API Routes
 * - POST   /api/shot-images/:shotId/generate  — Generate an image for a shot
 * - POST   /api/shot-images/:imageId/edit     — Edit an existing image (reroll/ref-edit/attr-edit)
 * - GET    /api/shot-images/:shotId           — List images for a shot
 * - PATCH  /api/shot-images/:imageId          — Update image metadata (set primary, label)
 */
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { getCostForReplicatePath, REPLICATE_MODEL_PATHS, STYLE_PRESETS, IMAGE_MODEL_COSTS } from '../../types';

export const shotImagesRouter = Router();

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

const DEVELOPER_EMAILS = new Set(['forevercrab321@gmail.com']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkIsAdmin(supabaseUser: any): Promise<boolean> {
    try {
        const { data: { user } } = await supabaseUser.auth.getUser();
        if (!user) return false;
        if (user.email && DEVELOPER_EMAILS.has(user.email.toLowerCase())) return true;
        const { data: profile } = await supabaseUser.from('profiles').select('is_admin').eq('id', user.id).single();
        return profile?.is_admin === true;
    } catch { return false; }
}

const getUserClient = (authHeader: string) => createClient(
    process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
);

const getReplicateToken = () => {
    const t = process.env.REPLICATE_API_TOKEN;
    if (!t) throw new Error('REPLICATE_API_TOKEN not configured');
    return t;
};

// ── Helper: Call Replicate to generate an image and poll until complete ──
async function callReplicateImage(params: {
    prompt: string;
    model: string;       // Replicate model path
    aspectRatio: string;
    seed: number | null;
}): Promise<{ url: string; predictionId: string }> {
    const token = getReplicateToken();
    const modelPath = params.model;
    const isModelPath = modelPath.includes('/') && !modelPath.match(/^[a-f0-9]{64}$/);
    const targetUrl = isModelPath
        ? `${REPLICATE_API_BASE}/models/${modelPath}/predictions`
        : `${REPLICATE_API_BASE}/predictions`;

    const input: Record<string, any> = {
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio,
        output_format: 'jpg',
        prompt_upsampling: false,  // ★ LOCK: Prevent Flux from rewriting prompts differently per image
        output_quality: 90,        // ★ LOCK: Consistent quality across all shots
    };
    if (params.seed != null) input.seed = params.seed;

    const body = isModelPath ? { input } : { version: modelPath, input };

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Prefer: 'wait',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Replicate error ${response.status}: ${errText}`);
    }

    let prediction = await response.json();

    // Poll if not done
    while (['starting', 'processing'].includes(prediction.status)) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch(`${REPLICATE_API_BASE}/predictions/${prediction.id}`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        prediction = await pollRes.json();
    }

    if (prediction.status !== 'succeeded') {
        throw new Error(prediction.error || 'Image generation failed');
    }

    const output = prediction.output;
    const url = Array.isArray(output) ? output[0] : output;
    return { url, predictionId: prediction.id };
}

// ── Helper: Build final prompt with consistency injection ──
function buildFinalPrompt(params: {
    basePrompt: string;
    deltaInstruction?: string;
    characterAnchor?: string;
    style?: string;
    referencePolicy?: string;
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

    // ★ POSITION 2: CHARACTER ANCHOR
    if (params.characterAnchor && params.referencePolicy !== 'none') {
        parts.push(`Same character throughout: ${params.characterAnchor}`);
    }

    // ★ POSITION 3: SHOT-SPECIFIC CONTENT
    parts.push(params.basePrompt);

    // ★ EDIT INSTRUCTION (if any)
    if (params.deltaInstruction) {
        parts.push(`Edit: ${params.deltaInstruction}`);
    }

    // ★ POSITION 4: CONSISTENCY SUFFIX
    parts.push('consistent visual style, same color palette, same lighting, same character appearance');

    return parts.join('. ');
}

// ═══════════════════════════════════════════════════════════════
// POST /api/shot-images/:shotId/generate
// Generate a new image for a shot
// ═══════════════════════════════════════════════════════════════
shotImagesRouter.post('/:shotId/generate', async (req, res) => {
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
        } = req.body;

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);

        // Resolve model
        const imageModel = model || 'flux';
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[imageModel] || REPLICATE_MODEL_PATHS['flux'];
        const cost = (IMAGE_MODEL_COSTS as any)[imageModel] ?? 6;

        // Credit reserve
        const jobRef = `shot-img:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: cost, ref_type: 'shot-image', ref_id: jobRef,
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' });
        }

        const basePrompt = prompt || '';
        const finalPrompt = buildFinalPrompt({
            basePrompt,
            deltaInstruction: delta_instruction,
            characterAnchor: character_anchor,
            style: style || 'none',
            referencePolicy: reference_policy || 'anchor',
        });

        // Call Replicate
        let result: { url: string; predictionId: string };
        try {
            result = await callReplicateImage({
                prompt: finalPrompt,
                model: replicatePath,
                aspectRatio: aspect_ratio || '16:9',
                seed: seed ?? 142857,
            });
        } catch (genErr: any) {
            // Refund on failure
            if (!isAdmin) {
                try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'shot-image', ref_id: jobRef }); } catch (_) { /* best-effort */ }
            }
            throw genErr;
        }

        // Finalize credits
        if (!isAdmin) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'shot-image', ref_id: jobRef });
        }

        const durationMs = Date.now() - startTime;

        // Build response (client-side state — no DB persistence required for MVP)
        const imageId = crypto.randomUUID();
        const generationId = crypto.randomUUID();
        const now = new Date().toISOString();

        const image = {
            id: imageId,
            shot_id: shotId,
            project_id: project_id || null,
            url: result.url,
            is_primary: false, // Caller decides
            status: 'succeeded',
            label: null,
            created_at: now,
        };

        const generation = {
            id: generationId,
            image_id: imageId,
            shot_id: shotId,
            project_id: project_id || null,
            prompt: basePrompt,
            negative_prompt: negative_prompt || '',
            delta_instruction: delta_instruction || null,
            model: imageModel,
            aspect_ratio: aspect_ratio || '16:9',
            style: style || 'none',
            seed: seed ?? 142857,
            anchor_refs: character_anchor ? [character_anchor] : [],
            reference_policy: reference_policy || 'anchor',
            edit_mode: null,
            status: 'succeeded',
            output_url: result.url,
            replicate_prediction_id: result.predictionId,
            created_at: now,
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
        };

        res.json({ image, generation });

    } catch (error: any) {
        console.error('[ShotImage Generate] Error:', error.message);
        res.status(500).json({ error: error.message || 'Image generation failed' });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/shot-images/:imageId/edit
// Edit an existing image (reroll / reference edit / attribute edit)
// ═══════════════════════════════════════════════════════════════
shotImagesRouter.post('/:imageId/edit', async (req, res) => {
    const startTime = Date.now();
    try {
        const { imageId } = req.params;
        const {
            edit_mode,        // 'reroll' | 'reference_edit' | 'attribute_edit'
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
        } = req.body;

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

        // Build prompt based on edit mode
        let basePrompt = original_prompt || '';
        if (edit_mode === 'reroll') {
            // Same prompt, different seed
            // Keep basePrompt as is
        } else if (edit_mode === 'attribute_edit') {
            // Append locked attributes instruction
            const lockedStr = (locked_attributes || []).join(', ');
            if (lockedStr) {
                basePrompt = `${basePrompt}. [KEEP UNCHANGED: ${lockedStr}]. [CHANGE: ${delta_instruction || ''}]`;
            } else {
                basePrompt = `${basePrompt}. [EDIT: ${delta_instruction || ''}]`;
            }
        } else if (edit_mode === 'reference_edit') {
            basePrompt = `Based on reference image, ${delta_instruction || 'maintain composition and subject'}. ${basePrompt}`;
        }

        const finalPrompt = buildFinalPrompt({
            basePrompt,
            characterAnchor: character_anchor,
            style: style || 'none',
            referencePolicy: reference_policy || 'anchor',
        });

        // Determine seed: reroll uses random, others keep seed
        const editSeed = edit_mode === 'reroll' ? Math.floor(Math.random() * 999999) : (seed ?? 142857);

        let result: { url: string; predictionId: string };
        try {
            result = await callReplicateImage({
                prompt: finalPrompt,
                model: replicatePath,
                aspectRatio: aspect_ratio || '16:9',
                seed: editSeed,
            });
        } catch (genErr: any) {
            if (!isAdmin) {
                try { await supabaseUser.rpc('refund_reserve', { amount: cost, ref_type: 'shot-image-edit', ref_id: jobRef }); } catch (_) { /* best-effort */ }
            }
            throw genErr;
        }

        if (!isAdmin) {
            await supabaseUser.rpc('finalize_reserve', { ref_type: 'shot-image-edit', ref_id: jobRef });
        }

        const durationMs = Date.now() - startTime;
        const newImageId = crypto.randomUUID();
        const generationId = crypto.randomUUID();
        const now = new Date().toISOString();

        const image = {
            id: newImageId,
            shot_id: shot_id || '',
            project_id: project_id || null,
            url: result.url,
            is_primary: false,
            status: 'succeeded',
            label: `Edit (${edit_mode})`,
            created_at: now,
        };

        const generation = {
            id: generationId,
            image_id: newImageId,
            shot_id: shot_id || '',
            project_id: project_id || null,
            prompt: basePrompt,
            negative_prompt: negative_prompt || '',
            delta_instruction: delta_instruction || null,
            model: imageModel,
            aspect_ratio: aspect_ratio || '16:9',
            style: style || 'none',
            seed: editSeed,
            anchor_refs: character_anchor ? [character_anchor] : [],
            reference_image_url: reference_image_url || null,
            reference_policy: reference_policy || 'anchor',
            edit_mode,
            status: 'succeeded',
            output_url: result.url,
            replicate_prediction_id: result.predictionId,
            created_at: now,
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            // Link to parent image
            parent_image_id: imageId,
        };

        res.json({ image, generation });

    } catch (error: any) {
        console.error('[ShotImage Edit] Error:', error.message);
        res.status(500).json({ error: error.message || 'Image edit failed' });
    }
});
