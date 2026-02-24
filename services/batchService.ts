/**
 * Batch Service — Frontend proxy for batch image generation.
 * Uses SSE (Server-Sent Events) for real-time progress streaming.
 * Handles starting jobs, progress tracking, cancellation, and retry.
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
 * Internal SSE stream reader.
 * Reads SSE events from a fetch response and calls onProgress for each progress event.
 * Returns the final 'done' event data.
 */
async function readSSEStream(
    response: Response,
    onProgress: (data: BatchProgressResult) => void,
    abortSignal?: AbortSignal,
): Promise<BatchProgressResult> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body stream');

    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult: BatchProgressResult | null = null;

    try {
        while (true) {
            if (abortSignal?.aborted) {
                reader.cancel();
                break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            // Parse SSE events from buffer
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete last line in buffer
            
            let currentEvent = '';
            let currentData = '';
            
            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                    currentData = line.slice(6);
                } else if (line === '' && currentEvent && currentData) {
                    // End of event block
                    try {
                        const parsed = JSON.parse(currentData);
                        if (currentEvent === 'progress') {
                            onProgress(parsed);
                        } else if (currentEvent === 'done') {
                            finalResult = parsed;
                            onProgress(parsed);
                        } else if (currentEvent === 'error') {
                            throw new Error(parsed.error || 'Batch processing error');
                        }
                    } catch (parseErr: any) {
                        if (parseErr.message?.includes('Batch processing error')) throw parseErr;
                        console.warn('[BatchService] Failed to parse SSE data:', parseErr);
                    }
                    currentEvent = '';
                    currentData = '';
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    if (!finalResult) {
        throw new Error('SSE stream ended without final result');
    }
    return finalResult;
}

/**
 * Start a batch image generation job with SSE streaming.
 * Returns a controller that provides progress updates and final results.
 */
export async function startBatchGenImagesSSE(params: {
    project_id: string;
    shots: ShotForBatch[];
    count?: number;
    model?: ImageModel;
    aspect_ratio?: AspectRatio;
    style?: VideoStyle;
    character_anchor?: string;
    concurrency?: number;
    reference_image_url?: string;  // ★ Compressed base64 data URL for Flux Redux consistency
}, onProgress: (data: BatchProgressResult) => void): Promise<BatchProgressResult> {
    const headers = await getAuthHeaders();
    const abortController = new AbortController();

    const response = await fetch(`${API_BASE}/gen-images`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            project_id: params.project_id,
            shots: params.shots,
            count: params.count ?? 100,
            model: params.model ?? 'flux',
            aspect_ratio: params.aspect_ratio ?? '16:9',
            style: params.style ?? 'none',
            character_anchor: params.character_anchor ?? '',
            concurrency: params.concurrency ?? 3,
        }),
        signal: abortController.signal,
    });

    // Check for non-SSE error responses (402, 401, etc.)
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
        if (response.status === 402) {
            const err: any = new Error('INSUFFICIENT_CREDITS');
            err.code = 'INSUFFICIENT_CREDITS';
            throw err;
        }
        if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(errData.error || `Failed to start batch job (${response.status})`);
        }
        // Fallback: if server returned JSON instead of SSE (shouldn't happen but be safe)
        const data = await response.json();
        return { job: data.job || data, items: data.items || [] };
    }

    return readSSEStream(response, onProgress, abortController.signal);
}

// Keep old function name for compatibility
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
    // Legacy compatibility — just return a mock start result
    // Callers should use startBatchGenImagesSSE instead
    return { job_id: 'sse-mode', status: 'running', total: params.shots.length, cost_per_image: 6, total_cost: params.shots.length * 6 };
}

/**
 * Poll a batch job's status (legacy — kept for backward compatibility but may 404 on Vercel).
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
 * Cancel a running batch job (legacy).
 */
export async function cancelBatchJob(jobId: string): Promise<void> {
    // For SSE mode, cancellation is handled by aborting the fetch request
    // This is kept for backward compatibility
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/${jobId}/cancel`, {
        method: 'POST',
        headers,
    });

    // Don't throw on 404 — the job may have already completed
    if (!response.ok && response.status !== 404) {
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

// ── Continue generation (SSE) ──

export interface ContinueBatchResult extends StartBatchResult {
    range_label: string;
    remaining_count: number;
    all_done: boolean;
    strategy: string;
}

/**
 * Continue generating images with SSE streaming.
 */
export async function continueBatchGenImagesSSE(params: {
    project_id: string;
    shots: ShotForBatch[];
    shots_with_images: string[];
    count?: number;
    strategy?: 'strict' | 'skip_failed';
    model?: ImageModel;
    aspect_ratio?: AspectRatio;
    style?: VideoStyle;
    character_anchor?: string;
    concurrency?: number;
    anchor_image_url?: string;     // ★ Anchor from previous batch for cross-batch consistency
    reference_image_url?: string;  // ★ User's reference photo for Flux Redux
}, onProgress: (data: BatchProgressResult) => void): Promise<BatchProgressResult & { range_label?: string; remaining_count?: number; all_done?: boolean }> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/gen-images/continue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            project_id: params.project_id,
            shots: params.shots,
            shots_with_images: params.shots_with_images,
            count: params.count ?? 100,
            strategy: params.strategy ?? 'strict',
            model: params.model ?? 'flux',
            aspect_ratio: params.aspect_ratio ?? '16:9',
            style: params.style ?? 'none',
            character_anchor: params.character_anchor ?? '',
            concurrency: params.concurrency ?? 3,
            anchor_image_url: params.anchor_image_url ?? '',
            reference_image_url: params.reference_image_url ?? '',
        }),
    });

    // Check for non-SSE responses (JSON for all_done case, or errors)
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
        if (response.status === 402) {
            const err: any = new Error('INSUFFICIENT_CREDITS');
            err.code = 'INSUFFICIENT_CREDITS';
            throw err;
        }
        if (!response.ok) {
            const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(errData.error || `Failed to continue batch job (${response.status})`);
        }
        // all_done JSON response
        const data = await response.json();
        return { job: data.job || {} as BatchJob, items: data.items || [], ...data };
    }

    return readSSEStream(response, onProgress);
}

// Legacy compatibility wrapper
export async function continueBatchGenImages(params: {
    project_id: string;
    shots: ShotForBatch[];
    shots_with_images: string[];
    count?: number;
    strategy?: 'strict' | 'skip_failed';
    model?: ImageModel;
    aspect_ratio?: AspectRatio;
    style?: VideoStyle;
    character_anchor?: string;
    concurrency?: number;
}): Promise<ContinueBatchResult> {
    // Legacy — callers should use continueBatchGenImagesSSE instead
    return { job_id: 'sse-mode', status: 'running', total: params.shots.length, cost_per_image: 6, total_cost: params.shots.length * 6, range_label: '', remaining_count: 0, all_done: false, strategy: params.strategy || 'strict' };
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
