/**
 * Batch Image Generation API Routes
 *
 * POST /api/batch/gen-images          — Start a batch job (generate images for N shots)
 * GET  /api/batch/:jobId              — Get job status & item progress
 * POST /api/batch/:jobId/cancel       — Cancel a running batch job
 * POST /api/batch/:jobId/retry        — Retry failed items in a batch job
 */
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import {
    REPLICATE_MODEL_PATHS,
    IMAGE_MODEL_COSTS,
    STYLE_PRESETS,
} from '../../types';
import {
    createBatchJob,
    getJobStatus,
    cancelJob,
    retryFailedItems,
    type TaskExecutor,
    type BatchJobState,
} from '../batchQueue';

export const batchRouter = Router();

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

// ── Replicate image generation (same logic as shotImages route) ──
async function callReplicateImage(params: {
    prompt: string;
    model: string;
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

function buildFinalPrompt(params: {
    basePrompt: string;
    deltaInstruction?: string;
    characterAnchor?: string;
    style?: string;
    referencePolicy?: string;
}): string {
    const parts: string[] = [];
    if (params.characterAnchor && params.referencePolicy !== 'none') {
        parts.push(`[CRITICAL: Maintain exact same character identity. Same face, hairstyle, costume, body proportions.] ${params.characterAnchor}.`);
    }
    parts.push(params.basePrompt);
    if (params.deltaInstruction) {
        parts.push(`[EDIT INSTRUCTION: ${params.deltaInstruction}]`);
    }
    if (params.style && params.style !== 'none') {
        const preset = STYLE_PRESETS.find(s => s.id === params.style);
        if (preset) parts.push(preset.promptModifier);
    }
    if (params.characterAnchor && params.referencePolicy !== 'none') {
        parts.push('[IMPORTANT: Character must look IDENTICAL to description above.]');
    }
    return parts.join(' ');
}

// ═══════════════════════════════════════════════════════════════
// POST /api/batch/gen-images
// Start batch image generation for N shots
// ═══════════════════════════════════════════════════════════════
batchRouter.post('/gen-images', async (req, res) => {
    try {
        const {
            project_id,
            shots,             // Array<{ shot_id, shot_number, scene_number, image_prompt, seed_hint?, reference_policy? }>
            count = 100,       // Default: up to 100 shots per batch
            model = 'flux',
            aspect_ratio = '16:9',
            style = 'none',
            character_anchor = '',
            concurrency = 3,
        } = req.body;

        if (!project_id) return res.status(400).json({ error: 'Missing project_id' });
        if (!shots || !Array.isArray(shots) || shots.length === 0) {
            return res.status(400).json({ error: 'Missing or empty shots array' });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);

        // Select the first `count` shots, sorted by scene_number + shot_number
        const sortedShots = [...shots]
            .sort((a: any, b: any) => (a.scene_number - b.scene_number) || (a.shot_number - b.shot_number))
            .slice(0, count);

        const imageModel = model;
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[imageModel] || REPLICATE_MODEL_PATHS['flux'];
        const costPerImage = (IMAGE_MODEL_COSTS as any)[imageModel] ?? 6;
        const totalCost = costPerImage * sortedShots.length;

        // Reserve credits for entire batch upfront
        const batchRef = `batch-img:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: totalCost,
                ref_type: 'batch-image',
                ref_id: batchRef,
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', needed: totalCost });
        }

        const jobId = crypto.randomUUID();

        // Build the executor function that will generate each image
        const executor: TaskExecutor = async (item) => {
            const shotData = sortedShots.find((s: any) => s.shot_id === item.shot_id);
            if (!shotData) throw new Error('Shot data not found');

            const basePrompt = shotData.image_prompt || '';
            const finalPrompt = buildFinalPrompt({
                basePrompt,
                characterAnchor: character_anchor,
                style,
                referencePolicy: shotData.reference_policy || 'anchor',
            });

            const result = await callReplicateImage({
                prompt: finalPrompt,
                model: replicatePath,
                aspectRatio: aspect_ratio,
                seed: shotData.seed_hint ?? null,
            });

            return {
                image_id: crypto.randomUUID(),
                image_url: result.url,
            };
        };

        // Create and start the batch job
        const job = createBatchJob({
            jobId,
            projectId: project_id,
            userId: '', // Will be set from auth context in production
            items: sortedShots.map((s: any) => ({
                shotId: s.shot_id,
                shotNumber: s.shot_number,
                sceneNumber: s.scene_number,
            })),
            concurrency: Math.min(concurrency, 3), // Cap at 3
            executor,
        });

        // Finalize credits when job completes (async)
        // For MVP, we finalize the full batch reservation on job start
        // (in production, finalize per-item)
        if (!isAdmin) {
            // Fire-and-forget: finalize after a delay to let things settle
            const checkAndFinalize = async () => {
                // Poll until job is done
                let attempts = 0;
                while (attempts < 600) { // Max ~30 min
                    await new Promise(r => setTimeout(r, 3000));
                    const status = getJobStatus(jobId);
                    if (!status) break;
                    if (['completed', 'failed', 'cancelled'].includes(status.job.status)) {
                        // If some failed or were cancelled, refund partial amount
                        const itemsNotSucceeded = status.job.total - status.job.succeeded;
                        if (itemsNotSucceeded > 0) {
                            const refundAmount = itemsNotSucceeded * costPerImage;
                            try {
                                await supabaseUser.rpc('refund_reserve', {
                                    amount: refundAmount,
                                    ref_type: 'batch-image-partial',
                                    ref_id: batchRef,
                                });
                            } catch (e) {
                                console.error('[Batch] Partial refund failed:', e);
                            }
                        }
                        // Finalize whatever was used
                        try {
                            await supabaseUser.rpc('finalize_reserve', {
                                ref_type: 'batch-image',
                                ref_id: batchRef,
                            });
                        } catch (e) {
                            console.error('[Batch] Finalize failed:', e);
                        }
                        break;
                    }
                    attempts++;
                }
            };
            checkAndFinalize().catch(e => console.error('[Batch] Credit finalization error:', e));
        }

        // Return immediately with job ID — client polls for progress
        res.json({
            job_id: jobId,
            status: job.status,
            total: job.total,
            cost_per_image: costPerImage,
            total_cost: totalCost,
        });

    } catch (error: any) {
        console.error('[Batch GenImages] Error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to start batch job' });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/batch/gen-images/continue
// Continue generating images for the next batch of shots
// Client sends the full shots array + which shots already have images
// ═══════════════════════════════════════════════════════════════
batchRouter.post('/gen-images/continue', async (req, res) => {
    try {
        const {
            project_id,
            shots,                  // ALL shots in the project
            shots_with_images = [], // Array of shot_ids that already have a primary image
            count = 100,            // Default: up to 100 shots per batch
            strategy = 'strict',    // 'strict' | 'skip_failed'
            model = 'flux',
            aspect_ratio = '16:9',
            style = 'none',
            character_anchor = '',
            concurrency = 3,
        } = req.body;

        if (!project_id) return res.status(400).json({ error: 'Missing project_id' });
        if (!shots || !Array.isArray(shots) || shots.length === 0) {
            return res.status(400).json({ error: 'Missing or empty shots array' });
        }

        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });

        const supabaseUser = getUserClient(authHeader);
        const isAdmin = await checkIsAdmin(supabaseUser);

        // Sort all shots by scene_number + shot_number
        const sortedAll = [...shots]
            .sort((a: any, b: any) => (a.scene_number - b.scene_number) || (a.shot_number - b.shot_number));

        const hasImageSet = new Set(shots_with_images as string[]);

        // Determine next batch based on strategy
        let nextBatch: typeof sortedAll;

        if (strategy === 'strict') {
            // Find the first shot without an image, then take `count` consecutive shots without images
            const firstMissingIdx = sortedAll.findIndex((s: any) => !hasImageSet.has(s.shot_id));
            if (firstMissingIdx < 0) {
                return res.json({
                    job_id: null,
                    all_done: true,
                    message: '所有镜头已有图片',
                    remaining_count: 0,
                });
            }
            // From firstMissingIdx, collect up to `count` shots that don't have images
            nextBatch = [];
            for (let i = firstMissingIdx; i < sortedAll.length && nextBatch.length < count; i++) {
                if (!hasImageSet.has(sortedAll[i].shot_id)) {
                    nextBatch.push(sortedAll[i]);
                }
            }
        } else {
            // skip_failed: find the LAST shot with an image, then take next `count` without images
            let lastSuccessIdx = -1;
            for (let i = sortedAll.length - 1; i >= 0; i--) {
                if (hasImageSet.has(sortedAll[i].shot_id)) {
                    lastSuccessIdx = i;
                    break;
                }
            }
            const startIdx = lastSuccessIdx + 1;
            nextBatch = [];
            for (let i = startIdx; i < sortedAll.length && nextBatch.length < count; i++) {
                if (!hasImageSet.has(sortedAll[i].shot_id)) {
                    nextBatch.push(sortedAll[i]);
                }
            }
        }

        if (nextBatch.length === 0) {
            return res.json({
                job_id: null,
                all_done: true,
                message: '所有镜头已有图片',
                remaining_count: 0,
            });
        }

        // Count remaining after this batch
        const totalMissing = sortedAll.filter((s: any) => !hasImageSet.has(s.shot_id)).length;
        const remainingAfter = totalMissing - nextBatch.length;

        const imageModel = model;
        const replicatePath = (REPLICATE_MODEL_PATHS as any)[imageModel] || REPLICATE_MODEL_PATHS['flux'];
        const costPerImage = (IMAGE_MODEL_COSTS as any)[imageModel] ?? 6;
        const totalCost = costPerImage * nextBatch.length;

        // Reserve credits
        const batchRef = `batch-continue:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        if (!isAdmin) {
            const { data: reserved, error: reserveErr } = await supabaseUser.rpc('reserve_credits', {
                amount: totalCost,
                ref_type: 'batch-image-continue',
                ref_id: batchRef,
            });
            if (reserveErr) return res.status(500).json({ error: 'Credit verification failed' });
            if (!reserved) return res.status(402).json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS', needed: totalCost });
        }

        const jobId = crypto.randomUUID();

        const executor: TaskExecutor = async (item) => {
            const shotData = nextBatch.find((s: any) => s.shot_id === item.shot_id);
            if (!shotData) throw new Error('Shot data not found');

            const basePrompt = shotData.image_prompt || '';
            const finalPrompt = buildFinalPrompt({
                basePrompt,
                characterAnchor: character_anchor,
                style,
                referencePolicy: shotData.reference_policy || 'anchor',
            });

            const result = await callReplicateImage({
                prompt: finalPrompt,
                model: replicatePath,
                aspectRatio: aspect_ratio,
                seed: shotData.seed_hint ?? null,
            });

            return {
                image_id: crypto.randomUUID(),
                image_url: result.url,
            };
        };

        const job = createBatchJob({
            jobId,
            projectId: project_id,
            userId: '',
            items: nextBatch.map((s: any) => ({
                shotId: s.shot_id,
                shotNumber: s.shot_number,
                sceneNumber: s.scene_number,
            })),
            concurrency: Math.min(concurrency, 3),
            executor,
        });

        // Update job metadata with range info
        const jobState = getJobStatus(jobId);
        if (jobState) {
            jobState.job.type = 'gen_images_continue';
            jobState.job.strategy = strategy;
            jobState.job.range_start_scene = nextBatch[0].scene_number;
            jobState.job.range_start_shot = nextBatch[0].shot_number;
            jobState.job.range_end_scene = nextBatch[nextBatch.length - 1].scene_number;
            jobState.job.range_end_shot = nextBatch[nextBatch.length - 1].shot_number;
            jobState.job.remaining_count = remainingAfter;
            jobState.job.all_done = remainingAfter === 0;
        }

        // Credit finalization (same pattern as gen-images)
        if (!isAdmin) {
            const checkAndFinalize = async () => {
                let attempts = 0;
                while (attempts < 600) {
                    await new Promise(r => setTimeout(r, 3000));
                    const status = getJobStatus(jobId);
                    if (!status) break;
                    if (['completed', 'failed', 'cancelled'].includes(status.job.status)) {
                        const itemsNotSucceeded = status.job.total - status.job.succeeded;
                        if (itemsNotSucceeded > 0) {
                            try {
                                await supabaseUser.rpc('refund_reserve', {
                                    amount: itemsNotSucceeded * costPerImage,
                                    ref_type: 'batch-continue-partial',
                                    ref_id: batchRef,
                                });
                            } catch (e) { console.error('[Batch Continue] Partial refund failed:', e); }
                        }
                        try {
                            await supabaseUser.rpc('finalize_reserve', {
                                ref_type: 'batch-image-continue',
                                ref_id: batchRef,
                            });
                        } catch (e) { console.error('[Batch Continue] Finalize failed:', e); }
                        break;
                    }
                    attempts++;
                }
            };
            checkAndFinalize().catch(e => console.error('[Batch Continue] Credit finalization error:', e));
        }

        const rangeLabel = `S${nextBatch[0].scene_number}.${nextBatch[0].shot_number} → S${nextBatch[nextBatch.length - 1].scene_number}.${nextBatch[nextBatch.length - 1].shot_number}`;

        res.json({
            job_id: jobId,
            status: job.status,
            total: job.total,
            cost_per_image: costPerImage,
            total_cost: totalCost,
            range_label: rangeLabel,
            remaining_count: remainingAfter,
            all_done: remainingAfter === 0,
            strategy,
        });

    } catch (error: any) {
        console.error('[Batch Continue] Error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to start continue batch job' });
    }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/batch/:jobId
// Get job status and items
// ═══════════════════════════════════════════════════════════════
batchRouter.get('/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const status = getJobStatus(jobId);

        if (!status) {
            return res.status(404).json({ error: 'Job not found' });
        }

        res.json(status);
    } catch (error: any) {
        console.error('[Batch Status] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/batch/:jobId/cancel
// Cancel a running batch job
// ═══════════════════════════════════════════════════════════════
batchRouter.post('/:jobId/cancel', async (req, res) => {
    try {
        const { jobId } = req.params;
        const cancelled = cancelJob(jobId);

        if (!cancelled) {
            return res.status(400).json({ error: 'Job cannot be cancelled (not found or already done)' });
        }

        res.json({ ok: true, message: 'Cancellation requested' });
    } catch (error: any) {
        console.error('[Batch Cancel] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/batch/:jobId/retry
// Retry failed items in a batch job
// ═══════════════════════════════════════════════════════════════
batchRouter.post('/:jobId/retry', async (req, res) => {
    try {
        const { jobId } = req.params;
        const {
            model = 'flux',
            aspect_ratio = '16:9',
            style = 'none',
            character_anchor = '',
            shots = [],        // Shot data for prompt building
        } = req.body;

        const replicatePath = (REPLICATE_MODEL_PATHS as any)[model] || REPLICATE_MODEL_PATHS['flux'];

        // Rebuild executor with same parameters
        const executor: TaskExecutor = async (item) => {
            const shotData = shots.find((s: any) => s.shot_id === item.shot_id);
            const basePrompt = shotData?.image_prompt || '';
            const finalPrompt = buildFinalPrompt({
                basePrompt,
                characterAnchor: character_anchor,
                style,
                referencePolicy: shotData?.reference_policy || 'anchor',
            });

            const result = await callReplicateImage({
                prompt: finalPrompt,
                model: replicatePath,
                aspectRatio: aspect_ratio,
                seed: shotData?.seed_hint ?? null,
            });

            return {
                image_id: crypto.randomUUID(),
                image_url: result.url,
            };
        };

        const retried = retryFailedItems(jobId, executor);
        if (!retried) {
            return res.status(400).json({ error: 'No failed items to retry or job is still running' });
        }

        res.json({ ok: true, message: 'Retry started' });
    } catch (error: any) {
        console.error('[Batch Retry] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
