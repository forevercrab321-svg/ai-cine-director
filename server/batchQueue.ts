/**
 * BatchQueue — In-process concurrent task queue for batch image generation.
 *
 * Design:
 *   - Jobs are stored in-memory (Map<jobId, BatchJobState>)
 *   - Each job has N items; up to `concurrency` items run simultaneously
 *   - Cancellation is cooperative: sets a flag, checked between tasks
 *   - Progress is queryable at any time via getJobStatus()
 *
 * This is an MVP in-process solution. For production scale, replace with
 * a persistent queue (BullMQ, pg-boss, etc.)
 */

import type { BatchJob, BatchJobItem, BatchJobStatus, BatchItemStatus } from '../types';

// ── Internal types ──

export interface BatchJobState {
    job: BatchJob;
    items: BatchJobItem[];
    cancelRequested: boolean;
    /** The async worker task for executing this job's items */
    workerPromise?: Promise<void>;
}

export type TaskExecutor = (item: BatchJobItem, job: BatchJob) => Promise<{
    image_id: string;
    image_url: string;
}>;

// ── Singleton queue store ──
const jobs = new Map<string, BatchJobState>();

/**
 * Create a new batch job with items and start processing.
 */
export function createBatchJob(params: {
    jobId: string;
    projectId: string;
    userId: string;
    items: Array<{ shotId: string; shotNumber: number; sceneNumber: number }>;
    concurrency: number;
    executor: TaskExecutor;
}): BatchJob {
    const now = new Date().toISOString();

    const job: BatchJob = {
        id: params.jobId,
        project_id: params.projectId,
        user_id: params.userId,
        type: 'gen_images',
        total: params.items.length,
        done: 0,
        succeeded: 0,
        failed: 0,
        status: 'pending',
        created_at: now,
        updated_at: now,
        concurrency: params.concurrency,
    };

    const batchItems: BatchJobItem[] = params.items.map((item, _idx) => ({
        id: crypto.randomUUID(),
        job_id: params.jobId,
        shot_id: item.shotId,
        shot_number: item.shotNumber,
        scene_number: item.sceneNumber,
        status: 'queued' as BatchItemStatus,
    }));

    const state: BatchJobState = {
        job,
        items: batchItems,
        cancelRequested: false,
    };

    jobs.set(params.jobId, state);

    // Start processing asynchronously
    state.workerPromise = runJobWorker(state, params.executor);

    return job;
}

/**
 * Get current status of a batch job (snapshot).
 */
export function getJobStatus(jobId: string): { job: BatchJob; items: BatchJobItem[] } | null {
    const state = jobs.get(jobId);
    if (!state) return null;
    return {
        job: { ...state.job },
        items: state.items.map(i => ({ ...i })),
    };
}

/**
 * Request cancellation of a running batch job.
 * Running items will complete, but no new items will start.
 */
export function cancelJob(jobId: string): boolean {
    const state = jobs.get(jobId);
    if (!state) return false;
    if (state.job.status === 'completed' || state.job.status === 'cancelled') return false;

    state.cancelRequested = true;
    return true;
}

/**
 * Retry all failed items in a batch job.
 */
export function retryFailedItems(jobId: string, executor: TaskExecutor): boolean {
    const state = jobs.get(jobId);
    if (!state) return false;
    if (state.job.status === 'running') return false; // Can't retry while running

    // Reset failed items to queued
    let hasRetries = false;
    for (const item of state.items) {
        if (item.status === 'failed') {
            item.status = 'queued';
            item.error = undefined;
            item.started_at = undefined;
            item.completed_at = undefined;
            item.image_id = undefined;
            item.image_url = undefined;
            hasRetries = true;
        }
    }

    if (!hasRetries) return false;

    // Reset job counters
    state.job.failed = 0;
    state.job.done = state.items.filter(i => i.status === 'succeeded').length;
    state.job.status = 'pending';
    state.cancelRequested = false;
    state.job.updated_at = new Date().toISOString();

    // Restart worker
    state.workerPromise = runJobWorker(state, executor);
    return true;
}

/**
 * Clean up a completed/cancelled/failed job from memory.
 */
export function removeJob(jobId: string): void {
    jobs.delete(jobId);
}

/**
 * List all jobs (for debugging).
 */
export function listJobs(): BatchJob[] {
    return Array.from(jobs.values()).map(s => ({ ...s.job }));
}

// ═══════════════════════════════════════════════════════════════
// Internal: Concurrent worker
// ═══════════════════════════════════════════════════════════════

async function runJobWorker(state: BatchJobState, executor: TaskExecutor): Promise<void> {
    state.job.status = 'running';
    state.job.updated_at = new Date().toISOString();

    const queue = state.items.filter(i => i.status === 'queued');
    let queueIndex = 0;

    // Semaphore-style concurrency control
    const runNext = async (): Promise<void> => {
        while (queueIndex < queue.length) {
            // Check cancellation
            if (state.cancelRequested) return;

            const item = queue[queueIndex++];
            if (!item || item.status !== 'queued') continue;

            // Check cancellation again right before starting
            if (state.cancelRequested) {
                item.status = 'cancelled';
                continue;
            }

            item.status = 'running';
            item.started_at = new Date().toISOString();
            state.job.updated_at = new Date().toISOString();

            try {
                const result = await executor(item, state.job);
                item.status = 'succeeded';
                item.image_id = result.image_id;
                item.image_url = result.image_url;
                item.completed_at = new Date().toISOString();
                state.job.succeeded += 1;
            } catch (err: any) {
                item.status = 'failed';
                item.error = err.message || 'Unknown error';
                item.completed_at = new Date().toISOString();
                state.job.failed += 1;
                console.error(`[BatchQueue] Item ${item.id} (shot ${item.shot_id}) failed:`, err.message);
            }

            state.job.done += 1;
            state.job.updated_at = new Date().toISOString();
        }
    };

    // Launch `concurrency` workers in parallel
    const workers: Promise<void>[] = [];
    for (let i = 0; i < state.job.concurrency; i++) {
        workers.push(runNext());
    }

    await Promise.all(workers);

    // Final status
    if (state.cancelRequested) {
        // Mark remaining queued items as cancelled
        for (const item of state.items) {
            if (item.status === 'queued') {
                item.status = 'cancelled';
            }
        }
        state.job.status = 'cancelled';
    } else if (state.job.failed > 0 && state.job.succeeded === 0) {
        state.job.status = 'failed';
    } else {
        state.job.status = 'completed';
    }

    state.job.updated_at = new Date().toISOString();
}
