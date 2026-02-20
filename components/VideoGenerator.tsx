import React, { useState, useEffect } from 'react';
import { StoryboardProject, Scene, MODEL_COSTS, CREDIT_COSTS, MODEL_MULTIPLIERS } from '../types';
import { useAppContext } from '../context/AppContext';
import { startVideoTask, generateImage, checkPredictionStatus } from '../services/replicateService';
import SceneCard from './SceneCard';
import { LoaderIcon, PhotoIcon, VideoCameraIcon } from './IconComponents';
import { t } from '../i18n';

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
                style={{ width: `${(current / total) * 100}%` }}
            />
        </div>
    </div>
);

const friendlyError = (msg: string) => {
    if (msg.includes("NSFW")) return "⚠️ NSFW Content Detected";
    if (msg.includes("credits")) return "⚠️ Insufficient Server Credits";
    return "⚠️ Generation Failed";
};

const VideoGenerator: React.FC<VideoGeneratorProps> = ({ project, onBackToScript }) => {
    const {
        settings,
        userState,
        isAuthenticated,
        deductCredits,
        openPricingModal,
        hasEnoughCredits
    } = useAppContext();

    // ★ Credit guard: compute whether user can afford at least one generation
    const imageCost = settings.imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;
    const videoCostPerScene = MODEL_COSTS[settings.videoModel] || 28;
    const insufficientForImage = !userState.isAdmin && !hasEnoughCredits(imageCost);
    const insufficientForVideo = !userState.isAdmin && !hasEnoughCredits(videoCostPerScene);

    // Local State Management
    const [activeVideoJobs, setActiveVideoJobs] = useState<Record<number, { id: string, startTime: number }>>({});
    const [sceneStatus, setSceneStatus] = useState<Record<number, { status: string, message?: string, error?: string }>>({});
    const [sceneImages, setSceneImages] = useState<Record<number, string>>({});
    const [sceneVideoUrls, setSceneVideoUrls] = useState<Record<number, string>>({});
    const [scenePredictionIds, setScenePredictionIds] = useState<Record<number, string>>({});

    const [isRenderingImages, setIsRenderingImages] = useState(false);
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
                        setSceneVideoUrls(prev => ({ ...prev, [sNum]: String(statusRes.output) }));
                        setSceneStatus(prev => ({ ...prev, [sNum]: { status: 'done', message: '✅ Complete' } }));
                        setActiveVideoJobs(prev => {
                            const next = { ...prev };
                            delete next[sNum];
                            return next;
                        });
                    } else if (statusRes.status === 'failed' || statusRes.status === 'canceled') {
                        setSceneStatus(prev => ({ ...prev, [sNum]: { status: 'failed', error: statusRes.error, message: friendlyError(statusRes.error || 'Failed') } }));
                        setActiveVideoJobs(prev => {
                            const next = { ...prev };
                            delete next[sNum];
                            return next;
                        });
                    } else {
                        // Still processing
                        const elapsed = Math.floor((Date.now() - activeVideoJobs[sNum].startTime) / 1000);
                        setSceneStatus(prev => ({ ...prev, [sNum]: { status: statusRes.status, message: `Running ${elapsed}s...` } }));
                    }
                } catch (e) {
                    console.error("Polling error", e);
                }
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [activeVideoJobs]);

    const executeImageGeneration = async (scene: Scene) => {
        const cost = settings.imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;

        // ★ Use deductCredits (which uses ref) as the ONLY credit check
        if (!userState.isAdmin) {
            const canDeduct = await deductCredits(cost);
            if (!canDeduct) {
                openPricingModal();
                throw new Error("Insufficient credits");
            }
        }

        setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'image_gen', message: '🎨 Generating Image...' } }));

        try {
            const prompt = `${scene.visual_description}, ${scene.shot_type}`;
            const url = await generateImage(
                prompt,
                settings.imageModel,
                settings.videoStyle,
                settings.aspectRatio,
                project.character_anchor
            );

            // Credits already deducted above
            setSceneImages(prev => ({ ...prev, [scene.scene_number]: url }));
            setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'ready', message: 'Image Ready' } }));
            return url;
        } catch (e: any) {
            setSceneStatus(prev => ({ ...prev, [scene.scene_number]: { status: 'failed', error: e.message, message: 'Image Gen Failed' } }));
            throw e;
        }
    };

    const handleRenderImages = async () => {
        if (!isAuthenticated) return alert("Please sign in to generate images.");

        // ★ Batch Pre-check
        // Calculate total cost for ALL remaining scenes
        const remainingScenes = project.scenes.filter(s => !sceneImages[s.scene_number]);
        const costPerImage = settings.imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;
        const totalEstCost = remainingScenes.length * costPerImage;

        if (!hasEnoughCredits(totalEstCost)) {
            // Optional: Allow partial? The user said "intercept... if < estimated".
            // Stricter interpretation: Block if ANY shortage.
            // Or at least block if < 1.
            // Let's block if balance < totalEstCost to prevent getting stuck halfway.
            // But if balance > 0 but < total, maybe let them process some?
            // User requirement: "If Current < Estimated, Intercept". So strictly block.
            if (!userState.isAdmin) { // Admin bypass
                openPricingModal();
                return;
            }
        }

        setIsRenderingImages(true);
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
                // executeImageGeneration now handles credit check atomically via ref
                await executeImageGeneration(scene);
            } catch (e: any) {
                if (e.message === "Insufficient credits" || e.code === 'INSUFFICIENT_CREDITS') {
                    console.warn("Credit limit reached, stopping batch.");
                    openPricingModal();
                    break; // Stop batch
                }
                console.error(e);
            }
            completed++;
            setImageProgress({ completed, total });
        }
        setIsRenderingImages(false);
    };

    const handleRenderVideos = async () => {
        if (!isAuthenticated) return alert("Please sign in to generate videos.");

        // ★ Batch Pre-check
        // We only check for video costs here. Images handled separately or inside loop?
        // Logic: The loop checks for image and generates if missing.
        // So we should estimate image + video cost.
        const scenesToProcess = project.scenes.filter(s =>
            !activeVideoJobs[s.scene_number] &&
            sceneStatus[s.scene_number]?.status !== 'done'
        );

        let totalEstCost = 0;
        const videoCost = MODEL_COSTS[settings.videoModel] || 28;
        const imageCost = settings.imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;

        scenesToProcess.forEach(s => {
            let sceneCost = videoCost;
            if (!sceneImages[s.scene_number]) {
                sceneCost += imageCost;
            }
            totalEstCost += sceneCost;
        });

        if (!hasEnoughCredits(totalEstCost)) {
            if (!userState.isAdmin) {
                openPricingModal();
                return;
            }
        }

        for (const scene of project.scenes) {
            const sNum = scene.scene_number;
            if (activeVideoJobs[sNum] || sceneStatus[sNum]?.status === 'done') continue;

            let imgUrl = sceneImages[sNum];
            if (!imgUrl) {
                try {
                    // executeImageGeneration handles credit check via ref
                    imgUrl = await executeImageGeneration(scene);
                } catch (e: any) {
                    if (e.message === "Insufficient credits" || e.code === 'INSUFFICIENT_CREDITS') {
                        openPricingModal();
                        break;
                    }
                    continue;
                }
            }

            const baseCost = MODEL_COSTS[settings.videoModel] || 28;
            // Removed redundant model multiplier that was inflating costs (e.g. 18 * 1.2 = 22)
            // The MODEL_COSTS values (18) are already the final intended price.
            const finalCost = baseCost;

            // ★ Atomic deduct via ref
            if (!userState.isAdmin) {
                // Double check individual cost (though batch checked already)
                const canDeduct = await deductCredits(finalCost, { model: settings.videoModel, base: baseCost, mult: 1 });
                if (!canDeduct) {
                    openPricingModal();
                    break;
                }
            }

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
                    project.character_anchor
                );

                // Credits already deducted above
                setActiveVideoJobs(prev => ({ ...prev, [sNum]: { id: res.id, startTime: Date.now() } }));
                setScenePredictionIds(prev => ({ ...prev, [sNum]: res.id }));
                setSceneStatus(prev => ({ ...prev, [sNum]: { status: 'starting', message: '🚀 Sent to Replicate' } }));
            } catch (e: any) {
                if (e.code === 'INSUFFICIENT_CREDITS') {
                    openPricingModal();
                    break;
                }
                console.error(e);
                setSceneStatus(prev => ({ ...prev, [sNum]: { status: 'failed', error: e.message, message: friendlyError(e.message) } }));
            }
        }
    };

    const handleGenerateSingleVideo = async (sceneNum: number) => {
        if (!isAuthenticated) return alert("Please sign in to generate video.");

        const scene = project.scenes.find(s => s.scene_number === sceneNum);
        const imgUrl = sceneImages[sceneNum];
        if (!scene || !imgUrl) return;

        const baseCost = MODEL_COSTS[settings.videoModel] || 28;
        // Removed redundant multiplier
        const finalCost = baseCost;

        // ★ Atomic deduct via ref
        if (!userState.isAdmin) {
            const canDeduct = await deductCredits(finalCost, { model: settings.videoModel, base: baseCost, mult: 1 });
            if (!canDeduct) {
                openPricingModal();
                return;
            }
        }

        setSceneStatus(prev => ({ ...prev, [sceneNum]: { status: 'queued', message: 'Starting...' } }));
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
                project.character_anchor
            );
            // Credits already deducted above
            setActiveVideoJobs(prev => ({ ...prev, [sceneNum]: { id: res.id, startTime: Date.now() } }));
            setScenePredictionIds(prev => ({ ...prev, [sceneNum]: res.id }));
            setSceneStatus(prev => ({ ...prev, [sceneNum]: { status: 'starting', message: '🚀 Started' } }));
        } catch (e: any) {
            if (e.code === 'INSUFFICIENT_CREDITS') {
                openPricingModal();
                return;
            }
            console.error(e);
            setSceneStatus(prev => ({ ...prev, [sceneNum]: { status: 'failed', error: e.message, message: friendlyError(e.message) } }));
        }
    };

    return (
        <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700 relative pb-20">

            {/* Sticky Header / Controls */}
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

                    <div className="flex gap-3 w-full md:w-auto">
                        <button
                            onClick={insufficientForImage ? openPricingModal : handleRenderImages}
                            disabled={isRenderingImages}
                            title={insufficientForImage ? `Need ${imageCost} 💎 per image (have ${userState.balance})` : undefined}
                            className={`flex-1 md:flex-none px-6 py-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2 text-sm
                                ${isRenderingImages ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : insufficientForImage ? 'bg-red-900/40 border border-red-500/30 text-red-300 hover:bg-red-900/60'
                                        : 'bg-slate-800 hover:bg-sky-600 text-white hover:shadow-lg hover:shadow-sky-500/20'}
                            `}
                        >
                            {isRenderingImages ? <LoaderIcon className="w-4 h-4" /> : <PhotoIcon className="w-4 h-4" />}
                            {insufficientForImage ? `Recharge to Render` : 'Render All Images'}
                        </button>
                        <button
                            onClick={insufficientForVideo ? openPricingModal : handleRenderVideos}
                            title={insufficientForVideo ? `Need ${videoCostPerScene} 💎 per video (have ${userState.balance})` : undefined}
                            className={`flex-1 md:flex-none px-6 py-3 rounded-lg text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2 text-sm
                                ${insufficientForVideo
                                    ? 'bg-red-900/40 border border-red-500/30 text-red-300 hover:bg-red-900/60 shadow-red-500/10'
                                    : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20'}
                            `}
                        >
                            <VideoCameraIcon className="w-4 h-4" />
                            {insufficientForVideo ? `Recharge to Render` : 'Render All Videos'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Global Progress Indicator */}
            {isRenderingImages && (
                <ProgressBar current={imageProgress.completed} total={imageProgress.total} label="Generating Source Frames..." />
            )}

            {/* Video Batch Progress (if many jobs active) */}
            {!isRenderingImages && Object.keys(activeVideoJobs).length > 0 && (
                <ProgressBar
                    current={project.scenes.length - Object.keys(activeVideoJobs).length}
                    total={project.scenes.length}
                    label="Rendering Video Batch..."
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
                            onDeductCredits={deductCredits}
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
                            isAuthenticated={isAuthenticated} // Changed: Pass auth state
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
