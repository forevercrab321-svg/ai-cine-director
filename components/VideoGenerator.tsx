import React, { useState, useEffect } from 'react';
import { StoryboardProject, Scene, MODEL_COSTS, CREDIT_COSTS, MODEL_MULTIPLIERS } from '../types';
import { useAppContext } from '../context/AppContext';
import { startVideoTask, generateImage, checkPredictionStatus } from '../services/replicateService';
import SceneCard from './SceneCard';
import { LoaderIcon, PhotoIcon, VideoCameraIcon } from './IconComponents';
import { t } from '../i18n';

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

interface VideoGeneratorProps {
    project: StoryboardProject;
    onBackToScript: () => void;
}

const ProgressBar = ({ current, total, label }: { current: number, total: number, label: string }) => (
    <div className="w-full max-w-md mx-auto mb-8 animate-in fade-in slide-in-from-top-4">
        <div className="flex justify-between text-xs text-slate-400 mb-2 uppercase tracking-widest font-bold">
            <span>{label}</span>
            <span>{current} / {total}</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
            <div
                className="h-full bg-indigo-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                style={{ width: `${total === 0 ? 0 : (current / total) * 100}%` }}
            />
        </div>
    </div>
);

const friendlyError = (msg: string) => {
    if (!msg) return "⚠️ 生成失败";
    if (msg.includes("NSFW")) return "⚠️ 包含违规内容";
    if (msg.toLowerCase().includes("credit")) return "⚠️ 额度不足";
    return "⚠️ 生成失败";
};

const VideoGenerator: React.FC<VideoGeneratorProps> = ({ project, onBackToScript }) => {
    const {
        settings,
        userState,
        isAuthenticated,
        openPricingModal,
        hasEnoughCredits,
        refreshBalance,
        deductCredits
    } = useAppContext();

    const imageCost = settings.imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;
    const videoCostPerScene = MODEL_COSTS[settings.videoModel] || 28;

    const insufficientForImage = !userState.isAdmin && userState.balance < imageCost;
    const insufficientForVideo = !userState.isAdmin && userState.balance < videoCostPerScene;

    const [activeVideoJobs, setActiveVideoJobs] = useState<Record<number, { id: string, startTime: number }>>({});
    const [sceneStatus, setSceneStatus] = useState<Record<number, { status: string, message?: string, error?: string }>>({});
    const [sceneImages, setSceneImages] = useState<Record<number, string>>({});
    const [sceneVideoUrls, setSceneVideoUrls] = useState<Record<number, string>>({});
    const [scenePredictionIds, setScenePredictionIds] = useState<Record<number, string>>({});

    // ★ 核心状态锁
    const [isRenderingImages, setIsRenderingImages] = useState(false);
    const [isRenderingVideos, setIsRenderingVideos] = useState(false);
    const [imageProgress, setImageProgress] = useState({ completed: 0, total: 0 });

    // Poll for video status
    useEffect(() => {
        const interval = setInterval(async () => {
            const activeSceneNums = Object.keys(activeVideoJobs).map(Number);
            if (activeSceneNums.length === 0) return;

            for (const sNum of activeSceneNums) {
                const jobId = activeVideoJobs[sNum].id;
                try {
                    const statusRes = await checkPredictionStatus(jobId);

                    if (statusRes.status === 'succeeded' && statusRes.output) {
                        // ★ Fix: Handle both array and string output formats
                        const videoUrl = Array.isArray(statusRes.output) 
                            ? statusRes.output[0] 
                            : String(statusRes.output);
                        setSceneVideoUrls(prev => ({ ...prev, [sNum]: videoUrl }));
                        setSceneStatus(prev => ({ ...prev, [sNum]: { status: 'done', message: '✅ 渲染完成' } }));
                        setActiveVideoJobs(prev => {
                            const next = { ...prev };
                            delete next[sNum];
                            return next;
                        });
                    } else if (statusRes.status === 'failed' || statusRes.status === 'canceled') {
                        setSceneStatus(prev => ({
                            ...prev,
                            [sNum]: { status: 'failed', error: statusRes.error, message: friendlyError(statusRes.error || 'Failed') }
                        }));
                        setActiveVideoJobs(prev => {
                            const next = { ...prev };
                            delete next[sNum];
                            return next;
                        });
                    } else {
                        const elapsed = Math.floor((Date.now() - activeVideoJobs[sNum].startTime) / 1000);
                        setSceneStatus(prev => ({ ...prev, [sNum]: { status: statusRes.status, message: `正在生成中 ${elapsed}秒...` } }));
                    }
                } catch (e) {
                    console.error("Polling error", e);
                }
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [activeVideoJobs]);

    const executeImageGeneration = async (scene: Scene) => {
        if (!userState.isAdmin && !hasEnoughCredits(imageCost)) {
            throw Object.assign(new Error("INSUFFICIENT_CREDITS"), { code: "INSUFFICIENT_CREDITS" });
        }

        setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'image_gen', message: '🎨 正在生成图片...' } }));

        // ★ Bug Fix #2: 乐观更新 - 立即扣款显示，提升UX
        const optimisticCost = imageCost;
        deductCredits(optimisticCost);

        try {
            const prompt = `${scene.visual_description}, ${scene.shot_type}`;
            const url = await generateImage(
                prompt,
                settings.imageModel,
                settings.videoStyle,
                settings.aspectRatio,
                project.character_anchor
            );

            setSceneImages(prev => ({ ...prev, [scene.scene_number]: url }));
            setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'ready', message: '图片已就绪' } }));
            
            // ★ 后台异步确认余额，不阻塞UI
            refreshBalance().catch(e => {
                console.error('[Image Gen] Balance sync failed (non-critical):', e);
            });
            
            return url;
        } catch (e: any) {
            // ★ 失败时从数据库重新获取真实余额（确保正确）
            console.error('[Image Gen] Generation failed, syncing balance from DB');
            await refreshBalance();

            setSceneStatus(prev => ({
                ...prev,
                [scene.scene_number]: { status: 'failed', error: e.message, message: '图片生成失败' }
            }));
            throw e;
        }
    };

    const handleRenderImages = async () => {
        if (!isAuthenticated) return alert("请先登录以生成图片。");
        if (isRenderingImages || isRenderingVideos) return; // ★ 防止多重点击

        setIsRenderingImages(true);
        try {
            let completed = 0;
            const total = project.scenes.length;
            setImageProgress({ completed, total });

            for (const scene of project.scenes) {
                if (sceneImages[scene.scene_number]) {
                    completed++;
                    setImageProgress({ completed, total });
                    continue;
                }

                try {
                    await executeImageGeneration(scene);
                } catch (e: any) {
                    if (e.code === 'INSUFFICIENT_CREDITS' || e.message === 'INSUFFICIENT_CREDITS') {
                        openPricingModal();
                        break; // 低余额时立即停止后续排队
                    }
                    console.error(e);
                }

                completed++;
                setImageProgress({ completed, total });
            }
        } finally {
            // ★ 无论成功失败，确保状态解锁
            setIsRenderingImages(false);
            await refreshBalance();
        }
    };

    const handleRenderVideos = async () => {
        if (!isAuthenticated) return alert("请先登录以生成视频。");
        if (isRenderingVideos || isRenderingImages) return; // ★ 绝对锁定，防连击

        setIsRenderingVideos(true);
        try {
            for (const scene of project.scenes) {
                const sNum = scene.scene_number;
                if (activeVideoJobs[sNum] || sceneStatus[sNum]?.status === 'done') continue;

                let imgUrl = sceneImages[sNum];

                // 缺图则先补图
                if (!imgUrl) {
                    try {
                        imgUrl = await executeImageGeneration(scene);
                    } catch (e: any) {
                        if (e.code === 'INSUFFICIENT_CREDITS' || e.message === 'INSUFFICIENT_CREDITS') {
                            openPricingModal();
                            break;
                        }
                        console.error(e);
                        continue;
                    }
                }

                try {
                    const res = await startVideoTask(
                        scene.shot_type || "cinematic motion",
                        imgUrl!,
                        settings.videoModel,
                        settings.videoStyle,
                        settings.generationMode,
                        settings.videoQuality,
                        settings.videoDuration,
                        settings.videoFps,
                        settings.videoResolution,
                        project.character_anchor,
                        settings.aspectRatio  // ★ Fix: Pass aspectRatio for Hailuo model
                    );

                    setActiveVideoJobs(prev => ({ ...prev, [sNum]: { id: res.id, startTime: Date.now() } }));
                    setScenePredictionIds(prev => ({ ...prev, [sNum]: res.id }));
                    setSceneStatus(prev => ({ ...prev, [sNum]: { status: 'starting', message: '🚀 已发送请求' } }));
                } catch (e: any) {
                    if (e.code === 'INSUFFICIENT_CREDITS' || e.message === 'INSUFFICIENT_CREDITS') {
                        openPricingModal();
                        break; // 扣费失败立刻中止后续发车
                    }
                    console.error(e);
                    setSceneStatus(prev => ({ ...prev, [sNum]: { status: 'failed', error: e.message, message: friendlyError(e.message) } }));
                }
            }
        } finally {
            // ★ 释放锁
            setIsRenderingVideos(false);
            await refreshBalance();
        }
    };

    // 下载文件辅助函数
    const downloadFile = async (url: string, filename: string) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error('Download failed:', error);
            // Fallback: open in new tab
            window.open(url, '_blank');
        }
    };

    // 批量下载所有图片
    const handleDownloadAllImages = async () => {
        const imageEntries = Object.entries(sceneImages).filter(([_, url]) => url);
        if (imageEntries.length === 0) {
            alert('没有可下载的图片');
            return;
        }

        for (const [sceneNum, url] of imageEntries) {
            await downloadFile(url, `scene-${sceneNum}-image.jpg`);
            await new Promise(resolve => setTimeout(resolve, 300)); // 避免过快下载
        }
    };

    // 批量下载所有视频
    const handleDownloadAllVideos = async () => {
        const videoEntries = Object.entries(sceneVideoUrls).filter(([_, url]) => url);
        if (videoEntries.length === 0) {
            alert('没有可下载的视频');
            return;
        }

        for (const [sceneNum, url] of videoEntries) {
            await downloadFile(url, `scene-${sceneNum}-video.mp4`);
            await new Promise(resolve => setTimeout(resolve, 500)); // 避免过快下载
        }
    };

    // 下载所有内容（图片+视频）
    const handleDownloadAll = async () => {
        const hasImages = Object.keys(sceneImages).length > 0;
        const hasVideos = Object.keys(sceneVideoUrls).length > 0;

        if (!hasImages && !hasVideos) {
            alert('没有可下载的内容');
            return;
        }

        if (hasImages) await handleDownloadAllImages();
        if (hasVideos) await handleDownloadAllVideos();
    };

    const handleGenerateSingleVideo = async (sceneNum: number) => {
        if (!isAuthenticated) return alert("请先登录以生成视频。");

        const scene = project.scenes.find(s => s.scene_number === sceneNum);
        const imgUrl = sceneImages[sceneNum];
        if (!scene || !imgUrl) return;

        const baseCost = MODEL_COSTS[settings.videoModel] || 28;

        if (!userState.isAdmin && !hasEnoughCredits(baseCost)) {
            openPricingModal();
            return;
        }

        setSceneStatus(prev => ({ ...prev, [sceneNum]: { status: 'queued', message: '准备中...' } }));
        
        // ★ Bug Fix #2: 乐观更新 - 立即扣款
        deductCredits(baseCost);
        
        try {
            const res = await startVideoTask(
                scene.shot_type || "cinematic motion",
                imgUrl,
                settings.videoModel,
                settings.videoStyle,
                settings.generationMode,
                settings.videoQuality,
                settings.videoDuration,
                settings.videoFps,
                settings.videoResolution,
                project.character_anchor,
                settings.aspectRatio  // ★ Fix: Pass aspectRatio for Hailuo model
            );

            setActiveVideoJobs(prev => ({ ...prev, [sceneNum]: { id: res.id, startTime: Date.now() } }));
            setScenePredictionIds(prev => ({ ...prev, [sceneNum]: res.id }));
            setSceneStatus(prev => ({ ...prev, [sceneNum]: { status: 'starting', message: '🚀 已发送请求' } }));
            
            // ★ 后台异步确认余额
            refreshBalance().catch(e => {
                console.error('[Video Gen] Balance sync failed (non-critical):', e);
            });
        } catch (e: any) {
            // ★ 失败时重新同步真实余额
            console.error('[Video Gen] Generation failed, syncing balance from DB');
            await refreshBalance();
            
            if (e.code === 'INSUFFICIENT_CREDITS' || e.message === 'INSUFFICIENT_CREDITS') {
                openPricingModal();
            } else {
                setSceneStatus(prev => ({ ...prev, [sceneNum]: { status: 'failed', error: e.message, message: friendlyError(e.message) } }));
            }
        }
    };

    return (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700 relative pb-20">
            <div className="sticky top-4 z-40 space-y-4">
                <div className="bg-slate-950/80 p-4 rounded-xl backdrop-blur border border-slate-800 shadow-2xl flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white mb-1">{project.project_title}</h2>
                        <div className="flex gap-2 text-[10px] uppercase font-bold tracking-wider text-slate-500 items-center">
                            <span>{project.scenes.length} Scenes</span>
                            <span>•</span>
                            <span>{settings.videoStyle}</span>
                            <span>•</span>
                            <span className="text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                                {MODEL_MULTIPLIERS[settings.videoModel]}x Rate
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full md:w-auto flex-wrap">
                        <button
                            onClick={insufficientForImage ? openPricingModal : handleRenderImages}
                            disabled={isRenderingImages || isRenderingVideos}
                            className={`flex-1 md:flex-none px-6 py-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2 text-sm
                ${isRenderingImages ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : (insufficientForImage || isRenderingVideos) ? 'bg-red-900/40 border border-red-500/30 text-red-300 hover:bg-red-900/60'
                                        : 'bg-slate-800 hover:bg-sky-600 text-white hover:shadow-lg hover:shadow-sky-500/20'}
              `}
                        >
                            {isRenderingImages ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <PhotoIcon className="w-4 h-4" />}
                            {isRenderingImages ? '排队生成中...' : insufficientForImage ? `充值后渲染图片` : '一键生成全部图片'}
                        </button>

                        <button
                            onClick={insufficientForVideo ? openPricingModal : handleRenderVideos}
                            disabled={isRenderingVideos || isRenderingImages}
                            className={`flex-1 md:flex-none px-6 py-3 rounded-lg text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2 text-sm
                ${isRenderingVideos ? 'bg-indigo-900/50 text-indigo-300 cursor-not-allowed shadow-none'
                                    : (insufficientForVideo || isRenderingImages)
                                        ? 'bg-red-900/40 border border-red-500/30 text-red-300 hover:bg-red-900/60 shadow-red-500/10'
                                        : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20'}
              `}
                        >
                            {isRenderingVideos ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <VideoCameraIcon className="w-4 h-4" />}
                            {isRenderingVideos ? '视频请求列队中...' : insufficientForVideo ? `充值后渲染视频` : '一键生成全部视频'}
                        </button>

                        {/* 下载按钮 */}
                        {(Object.keys(sceneImages).length > 0 || Object.keys(sceneVideoUrls).length > 0) && (
                            <div className="relative group">
                                <button
                                    className="px-4 py-3 rounded-lg bg-green-600 hover:bg-green-500 text-white font-bold transition-all shadow-lg shadow-green-500/20 flex items-center justify-center gap-2 text-sm"
                                    onClick={handleDownloadAll}
                                >
                                    <DownloadIcon />
                                    下载全部
                                </button>
                                {/* 下拉菜单 */}
                                <div className="absolute top-full mt-2 right-0 bg-slate-800 border border-slate-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 min-w-[180px] z-50">
                                    <div className="py-1">
                                        {Object.keys(sceneImages).length > 0 && (
                                            <button
                                                onClick={handleDownloadAllImages}
                                                className="w-full px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2"
                                            >
                                                <PhotoIcon className="w-4 h-4" />
                                                下载所有图片 ({Object.keys(sceneImages).length})
                                            </button>
                                        )}
                                        {Object.keys(sceneVideoUrls).length > 0 && (
                                            <button
                                                onClick={handleDownloadAllVideos}
                                                className="w-full px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-700 hover:text-white flex items-center gap-2"
                                            >
                                                <VideoCameraIcon className="w-4 h-4" />
                                                下载所有视频 ({Object.keys(sceneVideoUrls).length})
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isRenderingImages && (
                <ProgressBar current={imageProgress.completed} total={imageProgress.total} label="正在渲染视频原画 (图片)..." />
            )}

            {!isRenderingImages && Object.keys(activeVideoJobs).length > 0 && (
                <ProgressBar
                    current={project.scenes.length - Object.keys(activeVideoJobs).length}
                    total={project.scenes.length}
                    label="正在批量等待并渲染视频帧..."
                />
            )}

            <div className="space-y-8">
                {project.scenes.map((scene) => (
                    <div key={scene.scene_number} className="relative">
                        <SceneCard
                            scene={scene}
                            lang={settings.lang}
                            imageModel={settings.imageModel}
                            videoModel={settings.videoModel}
                            videoStyle={settings.videoStyle}
                            aspectRatio={settings.aspectRatio}
                            userCredits={userState.balance}
                            onDeductCredits={async () => true}
                            generationMode={settings.generationMode}
                            globalVideoQuality={settings.videoQuality}
                            globalVideoDuration={settings.videoDuration}
                            globalVideoFps={settings.videoFps}
                            globalVideoResolution={settings.videoResolution}
                            imageUrl={sceneImages[scene.scene_number] || null}
                            previousImage={sceneImages[scene.scene_number - 1] || null}
                            onImageGenerated={(url) => setSceneImages(prev => ({ ...prev, [scene.scene_number]: url }))}
                            onGenerateVideo={() => handleGenerateSingleVideo(scene.scene_number)}
                            externalVideoUrl={sceneVideoUrls[scene.scene_number]}
                            externalVideoStatus={
                                sceneStatus[scene.scene_number]?.status === 'processing' || sceneStatus[scene.scene_number]?.status === 'starting'
                                    ? 'loading'
                                    : sceneStatus[scene.scene_number]?.status === 'done' ? 'success' : undefined
                            }
                            predictionId={scenePredictionIds[scene.scene_number]}
                            errorDetails={sceneStatus[scene.scene_number]?.error}
                            characterAnchor={project.character_anchor}
                            isAuthenticated={isAuthenticated}
                        />
                    </div>
                ))}
            </div>

            <div className="text-center">
                <button onClick={onBackToScript} className="text-slate-500 hover:text-white text-sm underline decoration-slate-700 hover:decoration-white underline-offset-4 transition-all">
                    &larr; {t(settings.lang, 'backToWriter')}
                </button>
            </div>
        </div>
    );
};

export default VideoGenerator;