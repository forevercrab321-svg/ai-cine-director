/**
 * Batch Service — Frontend proxy for batch image generation.
 * Handles starting jobs, polling progress, cancellation, and retry.
 */
import { BatchJob, BatchJobItem, ImageModel, AspectRatio, VideoStyle, IMAGE_MODEL_COSTS, CREDIT_COSTS } from '../types';
import { supabase } from '../lib/supabaseClient';

const API_BASE = '/api/batch';

async function getAuthHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('请先登录以生成内容。');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
    };
}

// ── Types ──

export interface StartBatchResult {
    job_id: string;
    status: string;
    total: number;
    cost_per_image: number;
    total_cost: number;
}

export interface BatchProgressResult {
    job: BatchJob;
    items: BatchJobItem[];
}

export interface ShotForBatch {
    shot_id: string;
    shot_number: number;
    scene_number: number;
    image_prompt: string;
    seed_hint?: number | null;
    reference_policy?: string;
}

/**
 * Start a batch image generation job.
 */
export async function startBatchGenImages(params: {
    project_id: string;
    shots: ShotForBatch[];
    count?: number;
    model?: ImageModel;
    aspect_ratio?: AspectRatio;
    style?: VideoStyle;
    character_anchor?: string;
    concurrency?: number;
}): Promise<StartBatchResult> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/gen-images`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            project_id: params.project_id,
            shots: params.shots,
            count: params.count ?? 9,
            model: params.model ?? 'flux',
            aspect_ratio: params.aspect_ratio ?? '16:9',
            style: params.style ?? 'none',
            character_anchor: params.character_anchor ?? '',
            concurrency: params.concurrency ?? 2,
        }),
    });

    if (response.status === 402) {
        const err: any = new Error('INSUFFICIENT_CREDITS');
        err.code = 'INSUFFICIENT_CREDITS';
        throw err;
    }

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Failed to start batch job (${response.status})`);
    }

    return await response.json();
}

/**
 * Poll a batch job's status and item progress.
 */
export async function getBatchProgress(jobId: string): Promise<BatchProgressResult> {
    const response = await fetch(`${API_BASE}/${jobId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Failed to get batch status (${response.status})`);
    }

    return await response.json();
}

/**
 * Cancel a running batch job.
 */
export async function cancelBatchJob(jobId: string): Promise<void> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/${jobId}/cancel`, {
        method: 'POST',
        headers,
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || 'Failed to cancel batch job');
    }
}

/**
 * Retry failed items in a batch job.
 */
export async function retryBatchJob(jobId: string, params: {
    model?: ImageModel;
    aspect_ratio?: AspectRatio;
    style?: VideoStyle;
    character_anchor?: string;
    shots: ShotForBatch[];
}): Promise<void> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/${jobId}/retry`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || 'Failed to retry batch job');
    }
}

// ── Continue generation ──

export interface ContinueBatchResult extends StartBatchResult {
    range_label: string;
    remaining_count: number;
    all_done: boolean;
    strategy: string;
}

/**
 * Continue generating images for the next batch of shots.
 * The backend determines which shots to generate based on strategy.
 */
export async function continueBatchGenImages(params: {
    project_id: string;
    shots: ShotForBatch[];
    shots_with_images: string[];   // shot_ids that already have primary images
    count?: number;
    strategy?: 'strict' | 'skip_failed';
    model?: ImageModel;
    aspect_ratio?: AspectRatio;
    style?: VideoStyle;
    character_anchor?: string;
    concurrency?: number;
}): Promise<ContinueBatchResult> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/gen-images/continue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            project_id: params.project_id,
            shots: params.shots,
            shots_with_images: params.shots_with_images,
            count: params.count ?? 9,
            strategy: params.strategy ?? 'strict',
            model: params.model ?? 'flux',
            aspect_ratio: params.aspect_ratio ?? '16:9',
            style: params.style ?? 'none',
            character_anchor: params.character_anchor ?? '',
            concurrency: params.concurrency ?? 2,
        }),
    });

    if (response.status === 402) {
        const err: any = new Error('INSUFFICIENT_CREDITS');
        err.code = 'INSUFFICIENT_CREDITS';
        throw err;
    }

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Failed to continue batch job (${response.status})`);
    }

    return await response.json();
}

/**
 * Get estimated total cost for batch generation.
 */
export function getBatchCost(count: number, model: ImageModel = 'flux'): number {
    const costPerImage = IMAGE_MODEL_COSTS[model] ?? CREDIT_COSTS.IMAGE_FLUX;
    return costPerImage * count;
}

/**
 * Client-side helper: compute which shots still need images.
 * Returns { missing, withImages, allDone } for the strategy UI.
 */
export function computeShotImageStatus(
    allShots: Array<{ shot_id: string; scene_id: string; shot_number: number }>,
    imagesByShot: Record<string, Array<{ is_primary?: boolean; url?: string }>>,
): { shotsWithImages: string[]; shotsMissing: string[]; allDone: boolean; generatedCount: number; totalCount: number } {
    const shotsWithImages: string[] = [];
    const shotsMissing: string[] = [];

    for (const shot of allShots) {
        const imgs = imagesByShot[shot.shot_id] || [];
        const hasPrimary = imgs.some(i => i.is_primary && i.url);
        if (hasPrimary || imgs.length > 0) {
            shotsWithImages.push(shot.shot_id);
        } else {
            shotsMissing.push(shot.shot_id);
        }
    }

    return {
        shotsWithImages,
        shotsMissing,
        allDone: shotsMissing.length === 0,
        generatedCount: shotsWithImages.length,
        totalCount: allShots.length,
    };
}
