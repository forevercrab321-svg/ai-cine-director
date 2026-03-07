/**
 * BatchImagePanel — UI for batch image generation with continue support.
 *
 * Features:
 * - Initial batch: "Generate First N Shots Images" button
 * - Continue: "Continue Next N" button (appears after first batch completes)
 * - Strategy selector: strict (fill gaps first) vs skip_failed (jump ahead)
 * - Progress bar + per-shot thumbnail grid
 * - Cancel batch + retry failed items
 * - Range label: "S1.1 → S3.5"
 * - All-done indicator when every shot has a primary image
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shot, ShotImage, BatchJob, BatchJobItem, ImageModel, ContinueStrategy } from '../types';
import {
    startBatchGenImagesSSE,
    continueBatchGenImagesSSE,
    cancelBatchJob,
    retryBatchJob,
    getBatchCost,
    computeShotImageStatus,
    type ShotForBatch,
    type BatchProgressResult,
} from '../services/batchService';
import { useAppContext } from '../context/AppContext';
import { LoaderIcon } from './IconComponents';

interface BatchImagePanelProps {
    /** All shots flattened (must include scene_id) */
    allShots: Shot[];
    projectId?: string;
    characterAnchor: string;
    visualStyle: string;
    /** ★ Compressed reference image data URL for Flux Redux consistency */
    referenceImageDataUrl?: string;
    /** Current images for each shot — used to determine which shots need generation */
    imagesByShot: Record<string, ShotImage[]>;
    /** Called when images are generated — parent updates imagesByShot */
    onImagesGenerated: (results: Array<{ shot_id: string; image_id: string; image_url: string }>) => void;
    onSetGlobalAnchor?: (url: string) => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
    queued: { label: '等待中', color: 'text-slate-400', bg: 'bg-slate-700/50' },
    running: { label: '生成中', color: 'text-blue-400', bg: 'bg-blue-500/20' },
    succeeded: { label: '✓ 完成', color: 'text-green-400', bg: 'bg-green-500/20' },
    failed: { label: '✗ 失败', color: 'text-red-400', bg: 'bg-red-500/20' },
    cancelled: { label: '已取消', color: 'text-amber-400', bg: 'bg-amber-500/20' },
};

// ── Strategy Selection Modal ──
const StrategyDialog: React.FC<{
    open: boolean;
    missingCount: number;
    nextCount: number;
    onConfirm: (strategy: ContinueStrategy) => void;
    onCancel: () => void;
}> = ({ open, missingCount, nextCount, onConfirm, onCancel }) => {
    const [strategy, setStrategy] = useState<ContinueStrategy>('strict');

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl space-y-5">
                <div>
                    <h3 className="text-lg font-bold text-white mb-1">🎯 选择续生成策略</h3>
                    <p className="text-xs text-slate-400">
                        当前有 <span className="text-amber-400 font-bold">{missingCount}</span> 个镜头尚未生成图片，本次将处理 <span className="text-indigo-400 font-bold">{nextCount}</span> 个
                    </p>
                </div>

                <div className="space-y-3">
                    {/* Strategy A: Strict */}
                    <label
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${strategy === 'strict'
                            ? 'border-indigo-500 bg-indigo-500/10'
                            : 'border-slate-700 hover:border-slate-600'
                            }`}
                    >
                        <input
                            type="radio"
                            name="strategy"
                            value="strict"
                            checked={strategy === 'strict'}
                            onChange={() => setStrategy('strict')}
                            className="mt-1 accent-indigo-500"
                        />
                        <div>
                            <div className="text-sm font-bold text-white">🔒 严格顺序（推荐）</div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                从第一个缺失图片的镜头开始，逐个补齐。确保顺序连续，不遗漏任何镜头。
                            </p>
                        </div>
                    </label>

                    {/* Strategy B: Skip Failed */}
                    <label
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${strategy === 'skip_failed'
                            ? 'border-indigo-500 bg-indigo-500/10'
                            : 'border-slate-700 hover:border-slate-600'
                            }`}
                    >
                        <input
                            type="radio"
                            name="strategy"
                            value="skip_failed"
                            checked={strategy === 'skip_failed'}
                            onChange={() => setStrategy('skip_failed')}
                            className="mt-1 accent-indigo-500"
                        />
                        <div>
                            <div className="text-sm font-bold text-white">⏭ 跳过失败</div>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                从最后一个成功生成图片的镜头之后开始，忽略中间失败/跳过的镜头。适合快速推进进度。
                            </p>
                        </div>
                    </label>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                    >
                        取消
                    </button>
                    <button
                        onClick={() => onConfirm(strategy)}
                        className="px-6 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-500/20 transition-all"
                    >
                        确认生成
                    </button>
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════
// Main BatchImagePanel
// ═══════════════════════════════════════════════════════════════
const BatchImagePanel: React.FC<BatchImagePanelProps> = ({
    allShots, projectId, characterAnchor, visualStyle, referenceImageDataUrl, imagesByShot, onImagesGenerated, onSetGlobalAnchor
}) => {
    const { settings, isAuthenticated, hasEnoughCredits, openPricingModal, refreshBalance } = useAppContext();

    // Config - Allow up to 100 images per batch
    const [count, setCount] = useState(Math.min(3, allShots.length));
    const [model, setModel] = useState<ImageModel>('flux');

    // Job state
    const [jobId, setJobId] = useState<string | null>(null);
    const [job, setJob] = useState<BatchJob | null>(null);
    const [items, setItems] = useState<BatchJobItem[]>([]);
    const [isStarting, setIsStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // ★ Anchor image URL from first batch — passed to continue batches for cross-batch consistency
    const [anchorImageUrl, setAnchorImageUrl] = useState<string | null>(null);

    // Continue state
    const [rangeLabel, setRangeLabel] = useState<string | null>(null);
    const [showStrategyDialog, setShowStrategyDialog] = useState(false);

    // Compute image status from props
    const imageStatus = computeShotImageStatus(
        allShots.map(s => ({ shot_id: s.shot_id, scene_id: s.scene_id, shot_number: s.shot_number })),
        imagesByShot,
    );

    const estimatedCost = getBatchCost(Math.min(count, imageStatus.shotsMissing.length || count), model);
    const allDone = imageStatus.allDone;

    // Sort shots for consistent ordering
    const sortedShots = [...allShots].sort((a, b) =>
        (a.scene_id === b.scene_id ? a.shot_number - b.shot_number : a.scene_id.localeCompare(b.scene_id))
    );

    // ── SSE Progress handler ──
    const handleSSEProgress = useCallback((data: BatchProgressResult & { anchor_image_url?: string }) => {
        setJob(data.job);
        setItems(data.items);

        // ★ Capture anchor image URL from server for cross-batch consistency
        if ((data as any).anchor_image_url) {
            setAnchorImageUrl((data as any).anchor_image_url);
        }

        // Emit partial results immediately as images complete
        if (data.job.status === 'completed' || data.job.status === 'failed' || data.job.status === 'cancelled') {
            const results = data.items
                .filter(i => i.status === 'succeeded' && i.image_url)
                .map(i => ({
                    shot_id: i.shot_id,
                    image_id: i.image_id!,
                    image_url: i.image_url!,
                }));
            if (results.length > 0) {
                onImagesGenerated(results);
            }
            refreshBalance().catch(() => { });
        }
    }, [onImagesGenerated, refreshBalance]);

    useEffect(() => {
        return () => {
            // Cleanup: abort any running SSE stream
            if (abortRef.current) {
                abortRef.current.abort();
            }
        };
    }, []);

    // ── Build ShotForBatch from shot ──
    const toShotForBatch = useCallback((s: Shot, idx: number): ShotForBatch => {
        const sceneNum = /^\d+$/.test(s.scene_id) ? parseInt(s.scene_id, 10) : (idx + 1);
        return {
            shot_id: s.shot_id,
            shot_number: s.shot_number,
            scene_number: sceneNum,
            image_prompt: s.image_prompt,
            seed_hint: s.seed_hint,
            reference_policy: s.reference_policy,
        };
    }, []);

    // ── Start initial batch (SSE) ──
    const handleStart = async () => {
        if (!isAuthenticated) return alert('请先登录');
        if (!hasEnoughCredits(estimatedCost)) return openPricingModal();
        if (allShots.length === 0) return;

        setIsStarting(true);
        setError(null);
        setRangeLabel(null);
        setJobId('streaming');

        try {
            const result = await startBatchGenImagesSSE({
                project_id: projectId || '',
                shots: sortedShots.map(toShotForBatch),
                count,
                model,
                aspect_ratio: '16:9',
                style: 'none',
                character_anchor: characterAnchor,
                concurrency: 1,
                reference_image_url: referenceImageDataUrl || '',
            }, handleSSEProgress);

            // SSE stream completed — final results already handled in handleSSEProgress
            setJobId(result.job.id);
        } catch (err: any) {
            console.error('[BatchPanel] Start error:', err);
            setError(err.message || 'Failed to start batch job');
            if (err.code === 'INSUFFICIENT_CREDITS') openPricingModal();
        } finally {
            setIsStarting(false);
        }
    };

    // ── Continue next batch (SSE) ──
    const handleContinue = (strategy: ContinueStrategy) => {
        setShowStrategyDialog(false);
        startContinueBatch(strategy);
    };

    const startContinueBatch = async (strategy: ContinueStrategy) => {
        if (!isAuthenticated) return alert('请先登录');
        const actualCount = Math.min(count, imageStatus.shotsMissing.length);
        const cost = getBatchCost(actualCount, model);
        if (!hasEnoughCredits(cost)) return openPricingModal();

        setIsStarting(true);
        setError(null);
        setJobId('streaming');

        try {
            const result = await continueBatchGenImagesSSE({
                project_id: projectId || '',
                shots: sortedShots.map(toShotForBatch),
                shots_with_images: imageStatus.shotsWithImages,
                count,
                strategy,
                model,
                aspect_ratio: '16:9',
                style: 'none',
                character_anchor: characterAnchor,
                concurrency: 1,
                anchor_image_url: anchorImageUrl || '',
                reference_image_url: referenceImageDataUrl || '',
            }, handleSSEProgress);

            setJobId(result.job?.id || null);
            setRangeLabel((result as any).range_label || null);
        } catch (err: any) {
            console.error('[BatchPanel] Continue error:', err);
            setError(err.message || 'Failed to continue batch job');
            if (err.code === 'INSUFFICIENT_CREDITS') openPricingModal();
        } finally {
            setIsStarting(false);
        }
    };

    // ── Cancel ──
    const handleCancel = async () => {
        // For SSE mode, abort the fetch request
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }
        if (jobId && jobId !== 'streaming') {
            try {
                await cancelBatchJob(jobId);
            } catch (err: any) {
                // Don't show error if job was already completed
                if (!err.message?.includes('404')) {
                    setError(err.message || 'Failed to cancel');
                }
            }
        }
    };

    // ── Retry (not available in SSE mode — user should restart batch) ──
    const handleRetry = async () => {
        // In SSE mode, retry = start a new batch with the failed shots
        handleStart();
    };

    // ── Reset (close progress panel, keep continue state) ──
    const handleReset = () => {
        if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
        }
        setJobId(null);
        setJob(null);
        setItems([]);
        setError(null);
        setRangeLabel(null);
    };

    const isRunning = job?.status === 'running' || job?.status === 'pending';
    const isDone = job?.status === 'completed' || job?.status === 'failed' || job?.status === 'cancelled';
    const progressPercent = job ? Math.round((job.done / job.total) * 100) : 0;
    const hasFailures = (job?.failed ?? 0) > 0;
    const isFirstBatch = imageStatus.generatedCount === 0 && !jobId;
    const canContinue = !isRunning && !allDone && imageStatus.generatedCount > 0;

    return (
        <div className="bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-slate-700/50 rounded-2xl p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="text-xl">🖼</span>
                    <div>
                        <h3 className="text-sm font-bold text-white">批量生成镜头图片</h3>
                        <p className="text-[10px] text-slate-500">
                            {allDone
                                ? '✅ 所有镜头均已生成图片'
                                : `已生成 ${imageStatus.generatedCount}/${imageStatus.totalCount}，剩余 ${imageStatus.shotsMissing.length} 个`
                            }
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Overall progress pill */}
                    {!allDone && imageStatus.totalCount > 0 && (
                        <div className="flex items-center gap-1.5 bg-slate-800 rounded-full px-3 py-1">
                            <div className="h-1.5 w-16 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-indigo-500 rounded-full transition-all"
                                    style={{ width: `${Math.round((imageStatus.generatedCount / imageStatus.totalCount) * 100)}%` }}
                                />
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">
                                {Math.round((imageStatus.generatedCount / imageStatus.totalCount) * 100)}%
                            </span>
                        </div>
                    )}
                    {isDone && (
                        <button
                            onClick={handleReset}
                            className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800"
                        >
                            ✕ 关闭
                        </button>
                    )}
                </div>
            </div>

            {/* All-done celebration */}
            {allDone && !jobId && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                    <span className="text-2xl block mb-1">🎉</span>
                    <p className="text-sm text-green-400 font-bold">全部镜头图片已生成完毕</p>
                    <p className="text-[10px] text-green-500/60 mt-1">共 {imageStatus.totalCount} 个镜头</p>
                </div>
            )}

            {/* Config bar — show when no active job and not all done */}
            {!jobId && !allDone && (
                <div className="flex flex-wrap items-end gap-4">
                    {/* Count selector */}
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
                            每批数量
                        </label>
                        <div className="flex gap-1">
                            {[3, 5, 6, 9, 12, 30].filter(n => n <= allShots.length || n === 3).map(n => {
                                const effectiveN = Math.min(n, allShots.length);
                                return (
                                    <button
                                        key={n}
                                        onClick={() => setCount(effectiveN)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${count === effectiveN
                                            ? 'bg-indigo-600 text-white border-indigo-500'
                                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600'
                                            }`}
                                    >
                                        {effectiveN}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Model selector */}
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase tracking-wider font-bold block mb-1">
                            模型
                        </label>
                        <select
                            value={model}
                            onChange={(e) => setModel(e.target.value as ImageModel)}
                            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:border-indigo-500 outline-none"
                        >
                            <option value="flux">Flux 1.1 Pro (6 credits)</option>
                            <option value="flux_schnell">Flux Schnell (1 credit)</option>
                            <option value="nano_banana">Nano Banana (2 credits) ✨</option>
                        </select>
                    </div>

                    {/* Cost display */}
                    <div className="text-xs text-slate-400 py-1.5">
                        预估: <span className="text-amber-400 font-bold">{estimatedCost} credits</span>
                        <span className="text-slate-600 ml-1">
                            ({Math.min(count, imageStatus.shotsMissing.length || count)} × {getBatchCost(1, model)})
                        </span>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                        {isFirstBatch ? (
                            <button
                                onClick={handleStart}
                                disabled={isStarting || allShots.length === 0}
                                className={`px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg ${isStarting
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-indigo-500/20'
                                    }`}
                            >
                                {isStarting && <LoaderIcon className="w-4 h-4 animate-spin" />}
                                {isStarting ? '启动中...' : `🚀 生成前 ${Math.min(count, allShots.length)} 张图`}
                            </button>
                        ) : (
                            <button
                                onClick={() => setShowStrategyDialog(true)}
                                disabled={isStarting || !canContinue}
                                className={`px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg ${isStarting || !canContinue
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/20'
                                    }`}
                            >
                                {isStarting && <LoaderIcon className="w-4 h-4 animate-spin" />}
                                {isStarting ? '启动中...' : `⏭ 继续生成下 ${Math.min(count, imageStatus.shotsMissing.length)} 张`}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Strategy Dialog */}
            <StrategyDialog
                open={showStrategyDialog}
                missingCount={imageStatus.shotsMissing.length}
                nextCount={Math.min(count, imageStatus.shotsMissing.length)}
                onConfirm={handleContinue}
                onCancel={() => setShowStrategyDialog(false)}
            />

            {/* Error */}
            {error && (
                <div className="bg-red-900/20 border border-red-500/20 rounded-xl p-3 text-xs text-red-400 flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300 ml-2">✕</button>
                </div>
            )}

            {/* Progress section */}
            {job && (
                <div className="space-y-3">
                    {/* Range label */}
                    {rangeLabel && (
                        <div className="bg-slate-800/50 rounded-lg px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
                            <span className="text-indigo-400">📍</span>
                            <span>本次生成范围: <span className="text-white font-bold">{rangeLabel}</span></span>
                            {job.strategy && (
                                <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full border ${job.strategy === 'strict'
                                    ? 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10'
                                    : 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                                    }`}>
                                    {job.strategy === 'strict' ? '🔒 严格顺序' : '⏭ 跳过失败'}
                                </span>
                            )}
                        </div>
                    )}

                    {/* Progress bar */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                                {isRunning && <LoaderIcon className="w-3 h-3 animate-spin text-indigo-400" />}
                                <span className={
                                    job.status === 'completed' ? 'text-green-400 font-bold' :
                                        job.status === 'failed' ? 'text-red-400 font-bold' :
                                            job.status === 'cancelled' ? 'text-amber-400 font-bold' :
                                                'text-indigo-400'
                                }>
                                    {job.status === 'completed' ? '✓ 本批完成' :
                                        job.status === 'failed' ? '✗ 执行失败' :
                                            job.status === 'cancelled' ? '⚠ 已取消' :
                                                `处理中 ${job.done}/${job.total}`}
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                {job.succeeded > 0 && <span className="text-green-400">✓ {job.succeeded}</span>}
                                {job.failed > 0 && <span className="text-red-400">✗ {job.failed}</span>}
                                <span className="text-slate-500 font-mono">{progressPercent}%</span>
                            </div>
                        </div>
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${job.status === 'completed' ? 'bg-green-500' :
                                    job.status === 'failed' ? 'bg-red-500' :
                                        job.status === 'cancelled' ? 'bg-amber-500' :
                                            'bg-gradient-to-r from-indigo-600 to-violet-500'
                                    }`}
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 flex-wrap">
                        {isRunning && (
                            <button
                                onClick={handleCancel}
                                className="px-4 py-1.5 rounded-lg text-xs font-bold text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-all"
                            >
                                ⏹ 取消批处理
                            </button>
                        )}
                        {isDone && hasFailures && (
                            <button
                                onClick={handleRetry}
                                className="px-4 py-1.5 rounded-lg text-xs font-bold text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 transition-all"
                            >
                                🔄 重试失败项
                            </button>
                        )}
                        {isDone && !allDone && (
                            <button
                                onClick={() => {
                                    handleReset();
                                    setTimeout(() => setShowStrategyDialog(true), 100);
                                }}
                                className="px-4 py-1.5 rounded-lg text-xs font-bold text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/10 transition-all flex items-center gap-1.5"
                            >
                                ⏭ 继续下一批
                            </button>
                        )}
                        {isDone && allDone && (
                            <div className="px-4 py-1.5 rounded-lg text-xs font-bold text-green-400 bg-green-500/10 border border-green-500/20">
                                🎉 全部完成！
                            </div>
                        )}
                        {isDone && (
                            <button
                                onClick={handleReset}
                                className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-400 border border-slate-700 hover:bg-slate-800 transition-all"
                            >
                                ✕ 关闭面板
                            </button>
                        )}
                    </div>

                    {/* Remaining info */}
                    {isDone && job.remaining_count != null && job.remaining_count > 0 && (
                        <div className="bg-slate-800/30 rounded-lg px-3 py-2 text-[11px] text-slate-500 flex items-center gap-2">
                            <span>📊</span>
                            <span>
                                本批已完成，还剩 <span className="text-amber-400 font-bold">{job.remaining_count}</span> 个镜头待生成。
                                点击"继续下一批"可持续推进。
                            </span>
                        </div>
                    )}

                    {/* Item grid — thumbnail-style cards */}
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-9 gap-2">
                        {items.map((item) => {
                            const statusInfo = STATUS_LABELS[item.status] || STATUS_LABELS.queued;

                            return (
                                <div
                                    key={item.id}
                                    className={`rounded-xl border overflow-hidden transition-all group/thumb ${item.status === 'succeeded' ? 'border-green-500/30' :
                                        item.status === 'failed' ? 'border-red-500/30' :
                                            item.status === 'running' ? 'border-indigo-500/50 ring-1 ring-indigo-500/20' :
                                                'border-slate-800'
                                        }`}
                                >
                                    <div className="aspect-video relative">
                                        {item.status === 'succeeded' && item.image_url ? (
                                            <>
                                                <img
                                                    src={item.image_url}
                                                    alt={`Shot ${item.shot_number}`}
                                                    className="w-full h-full object-cover"
                                                />
                                                {/* 下载按钮 - 悬停时显示 */}
                                                <button
                                                    onClick={async () => {
                                                        try {
                                                            const response = await fetch(item.image_url!);
                                                            const blob = await response.blob();
                                                            const url = URL.createObjectURL(blob);
                                                            const a = document.createElement('a');
                                                            a.href = url;
                                                            a.download = `scene-${item.scene_number}-shot-${item.shot_number}.jpg`;
                                                            document.body.appendChild(a);
                                                            a.click();
                                                            document.body.removeChild(a);
                                                            URL.revokeObjectURL(url);
                                                        } catch {
                                                            window.open(item.image_url, '_blank');
                                                        }
                                                    }}
                                                    className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                                                    title="下载图片"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-white">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                                    </svg>
                                                </button>
                                            </>
                                        ) : (
                                            <div className={`w-full h-full flex items-center justify-center ${statusInfo.bg}`}>
                                                {item.status === 'running' ? (
                                                    <LoaderIcon className="w-5 h-5 animate-spin text-indigo-400" />
                                                ) : item.status === 'failed' ? (
                                                    <span className="text-lg">✗</span>
                                                ) : item.status === 'cancelled' ? (
                                                    <span className="text-lg">⚠</span>
                                                ) : (
                                                    <span className="text-slate-600 text-lg font-bold">
                                                        {item.shot_number || '?'}
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        <div className={`absolute bottom-0 left-0 right-0 py-0.5 text-center text-[9px] font-bold ${statusInfo.bg} ${statusInfo.color} backdrop-blur-sm`}>
                                            {statusInfo.label}
                                        </div>
                                    </div>
                                    <div className="px-1.5 py-1 text-center">
                                        <span className="text-[10px] text-slate-500 truncate block">
                                            S{item.scene_number}.{item.shot_number}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchImagePanel;
