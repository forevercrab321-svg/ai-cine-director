import React, { useState, useEffect } from "react";
import {
  StoryboardProject,
  Scene,
  MODEL_COSTS,
  CREDIT_COSTS,
  MODEL_MULTIPLIERS,
} from "../types";
import { useAppContext } from "../context/AppContext";
import {
  startVideoTask,
  generateImage,
  checkPredictionStatus,
} from "../services/replicateService";
import { generateSceneChain } from "../services/director-pipeline";
import SceneCard from "./SceneCard";
import { LoaderIcon, PhotoIcon, VideoCameraIcon } from "./IconComponents";
import { t } from "../i18n";
import { forceDownload } from "../utils/download";

const DownloadIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className="w-4 h-4"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
    />
  </svg>
);

interface VideoGeneratorProps {
  project: StoryboardProject;
  onBackToScript: () => void;
}

const ProgressBar = ({
  current,
  total,
  label,
}: {
  current: number;
  total: number;
  label: string;
}) => (
  <div className="w-full max-w-md mx-auto mb-8 animate-in fade-in slide-in-from-top-4">
    <div className="flex justify-between text-xs text-slate-400 mb-2 uppercase tracking-widest font-bold">
      <span>{label}</span>
      <span>
        {current} / {total}
      </span>
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

const VideoGenerator: React.FC<VideoGeneratorProps> = ({
  project,
  onBackToScript,
}) => {
  const {
    settings,
    userState,
    isAuthenticated,
    openPricingModal,
    hasEnoughCredits,
    refreshBalance,
    deductCredits,
  } = useAppContext();

  const imageCost =
    settings.imageModel === "flux_schnell"
      ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL
      : CREDIT_COSTS.IMAGE_FLUX;
  const videoCostPerScene = MODEL_COSTS[settings.videoModel] || 28;



  const [activeVideoJobs, setActiveVideoJobs] = useState<
    Record<number, { id: string; startTime: number }>
  >({});
  const [sceneStatus, setSceneStatus] = useState<
    Record<number, { status: string; message?: string; error?: string }>
  >({});
  const [sceneImages, setSceneImages] = useState<Record<number, string>>({});
  const [sceneVideoUrls, setSceneVideoUrls] = useState<Record<number, string>>(
    {},
  );
  const [scenePredictionIds, setScenePredictionIds] = useState<
    Record<number, string>
  >({});

  // ★ 核心状态锁
  const [isRenderingChain, setIsRenderingChain] = useState(false);
  const [chainProgress, setChainProgress] = useState({
    completed: 0,
    total: 0,
  });

  // Poll for video status
  useEffect(() => {
    const interval = setInterval(async () => {
      const activeSceneNums = Object.keys(activeVideoJobs).map(Number);
      if (activeSceneNums.length === 0) return;

      for (const sNum of activeSceneNums) {
        const jobId = activeVideoJobs[sNum].id;
        try {
          const statusRes = await checkPredictionStatus(jobId);

          if (statusRes.status === "succeeded" && statusRes.output) {
            // ★ Fix: Handle both array and string output formats
            const videoUrl = Array.isArray(statusRes.output)
              ? statusRes.output[0]
              : String(statusRes.output);
            setSceneVideoUrls((prev) => ({ ...prev, [sNum]: videoUrl }));
            setSceneStatus((prev) => ({
              ...prev,
              [sNum]: { status: "done", message: "✅ 渲染完成" },
            }));
            setActiveVideoJobs((prev) => {
              const next = { ...prev };
              delete next[sNum];
              return next;
            });
          } else if (
            statusRes.status === "failed" ||
            statusRes.status === "canceled"
          ) {
            setSceneStatus((prev) => ({
              ...prev,
              [sNum]: {
                status: "failed",
                error: statusRes.error,
                message: friendlyError(statusRes.error || "Failed"),
              },
            }));
            setActiveVideoJobs((prev) => {
              const next = { ...prev };
              delete next[sNum];
              return next;
            });
          } else {
            const elapsed = Math.floor(
              (Date.now() - activeVideoJobs[sNum].startTime) / 1000,
            );
            setSceneStatus((prev) => ({
              ...prev,
              [sNum]: {
                status: statusRes.status,
                message: `正在生成中 ${elapsed}秒...`,
              },
            }));
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [activeVideoJobs]);

  const handleRenderChain = async () => {
    if (!isAuthenticated) return alert("请先登录以生成分镜序列。");
    if (isRenderingChain) return;

    // 1. Check if user has enough credits.
    const totalVideosCost = (MODEL_COSTS[settings.videoModel] || 28) * project.scenes.length;
    let totalImagesCost = settings.imageModel === "flux_schnell" ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;

    if (!userState.isAdmin && userState.balance < (totalVideosCost + totalImagesCost)) {
      openPricingModal();
      return;
    }

    setIsRenderingChain(true);
    setChainProgress({ completed: 0, total: project.scenes.length });

    try {
      const FALLBACK_ANCHOR = "A cinematic character consistent with the scene context.";
      let finalAnchor = project.character_anchor;
      if (!finalAnchor || finalAnchor.trim() === "" || finalAnchor === "EMPTY") {
        console.warn("⚠️ [Director Warning] 检测到空锚点！已启用兜底安全锚点。");
        finalAnchor = FALLBACK_ANCHOR;
      }

      await generateSceneChain(
        project.id,
        project.scenes,
        finalAnchor,
        (progress) => {
          const sNum = project.scenes[progress.index].scene_number;
          if (progress.stage === "image_done") {
            setSceneImages(prev => ({ ...prev, [sNum]: progress.imageUrl }));
            setSceneStatus(prev => ({
              ...prev,
              [sNum]: { status: "ready", message: "✅ 尾帧/图片已就绪" },
            }));
          } else if (progress.stage === "video_starting") {
            setSceneStatus(prev => ({
              ...prev,
              [sNum]: { status: "starting", message: "🚀 正在请求视频..." }
            }));
          } else if (progress.stage === "video_polling") {
            setActiveVideoJobs(prev => ({
              ...prev,
              [sNum]: { id: progress.predictionId, startTime: Date.now() }
            }));
            setScenePredictionIds(prev => ({ ...prev, [sNum]: progress.predictionId }));
            setSceneStatus(prev => ({
              ...prev,
              [sNum]: { status: "processing", message: "⏳ 正在生成中..." }
            }));
          } else if (progress.stage === "video_done") {
            setSceneVideoUrls(prev => ({ ...prev, [sNum]: progress.videoUrl }));
            setSceneStatus(prev => ({
              ...prev,
              [sNum]: { status: "done", message: "✅ 渲染完成" }
            }));
            setActiveVideoJobs(prev => {
              const next = { ...prev };
              delete next[sNum];
              return next;
            });
            setChainProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
          }
        }
      );
    } catch (e: any) {
      console.error("[Chain] ❌ Pipeline Error:", e);
      alert(e.message || "生成途中发生严重错误：链条断裂。");
    } finally {
      setIsRenderingChain(false);
      await refreshBalance();
    }
  };



  // 批量下载所有图片
  const handleDownloadAllImages = async () => {
    const imageEntries = Object.entries(sceneImages).filter(([_, url]) => url);
    if (imageEntries.length === 0) {
      alert("没有可下载的图片");
      return;
    }

    for (const [sceneNum, url] of imageEntries) {
      await forceDownload(url as string, `scene-${sceneNum}-image.jpg`);
      await new Promise((resolve) => setTimeout(resolve, 300)); // 避免过快下载
    }
  };

  // 批量下载所有视频
  const handleDownloadAllVideos = async () => {
    const videoEntries = Object.entries(sceneVideoUrls).filter(
      ([_, url]) => url,
    );
    if (videoEntries.length === 0) {
      alert("没有可下载的视频");
      return;
    }

    for (const [sceneNum, url] of videoEntries) {
      await forceDownload(url as string, `scene-${sceneNum}-video.mp4`);
      await new Promise((resolve) => setTimeout(resolve, 500)); // 避免过快下载
    }
  };

  // 下载所有内容（图片+视频）
  const handleDownloadAll = async () => {
    const hasImages = Object.keys(sceneImages).length > 0;
    const hasVideos = Object.keys(sceneVideoUrls).length > 0;

    if (!hasImages && !hasVideos) {
      alert("没有可下载的内容");
      return;
    }

    if (hasImages) await handleDownloadAllImages();
    if (hasVideos) await handleDownloadAllVideos();
  };

  const handleGenerateSingleVideo = async (sceneNum: number) => {
    if (!isAuthenticated) return alert("请先登录以生成视频。");

    const scene = project.scenes.find((s) => s.scene_number === sceneNum);
    const imgUrl = sceneImages[sceneNum];
    if (!scene || !imgUrl) return;

    const baseCost = MODEL_COSTS[settings.videoModel] || 28;

    if (!userState.isAdmin && !hasEnoughCredits(baseCost)) {
      openPricingModal();
      return;
    }

    setSceneStatus((prev) => ({
      ...prev,
      [sceneNum]: { status: "queued", message: "准备中..." },
    }));

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
        settings.aspectRatio, // ★ Fix: Pass aspectRatio for Hailuo model
      );

      setActiveVideoJobs((prev) => ({
        ...prev,
        [sceneNum]: { id: res.id, startTime: Date.now() },
      }));
      setScenePredictionIds((prev) => ({ ...prev, [sceneNum]: res.id }));
      setSceneStatus((prev) => ({
        ...prev,
        [sceneNum]: { status: "starting", message: "🚀 已发送请求" },
      }));

      // ★ 后台异步确认余额
      refreshBalance().catch((e) => {
        console.error("[Video Gen] Balance sync failed (non-critical):", e);
      });
    } catch (e: any) {
      // ★ 失败时重新同步真实余额
      console.error("[Video Gen] Generation failed, syncing balance from DB");
      await refreshBalance();

      if (
        e.code === "INSUFFICIENT_CREDITS" ||
        e.message === "INSUFFICIENT_CREDITS"
      ) {
        openPricingModal();
      } else {
        setSceneStatus((prev) => ({
          ...prev,
          [sceneNum]: {
            status: "failed",
            error: e.message,
            message: friendlyError(e.message),
          },
        }));
      }
    }
  };

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700 relative pb-20">
      <div className="sticky top-4 z-40 space-y-4">
        <div className="bg-slate-950/80 p-4 rounded-xl backdrop-blur border border-slate-800 shadow-2xl flex flex-col md:flex-row gap-4 items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">
              {project.project_title}
            </h2>
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
              onClick={isRenderingChain ? undefined : handleRenderChain}
              disabled={isRenderingChain}
              className={`flex-1 md:flex-none px-6 py-3 rounded-lg text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2 text-sm
                ${isRenderingChain
                  ? "bg-indigo-900/50 text-indigo-300 cursor-not-allowed shadow-none"
                  : "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20"
                }
              `}
            >
              {isRenderingChain ? (
                <LoaderIcon className="w-4 h-4 animate-spin" />
              ) : (
                <VideoCameraIcon className="w-4 h-4" />
              )}
              {isRenderingChain
                ? "锁链生成中..."
                : "🚀 串行生成全剧"}
            </button>

            {/* 下载按钮 */}
            {(Object.keys(sceneImages).length > 0 ||
              Object.keys(sceneVideoUrls).length > 0) && (
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

      {isRenderingChain && (
        <ProgressBar
          current={chainProgress.completed}
          total={chainProgress.total}
          label="正在执行连续锁链生成 (图片/首尾帧提取/视频)..."
        />
      )}



      <div className="space-y-8">
        {project.scenes.map((scene, index) => (
          <div key={scene.scene_number} className="relative">
            <SceneCard
              scene={scene}
              sceneIndex={index}
              lang={settings.lang}
              imageModel={settings.imageModel}
              videoModel={settings.videoModel}
              videoStyle={settings.videoStyle}
              aspectRatio={settings.aspectRatio}
              userCredits={userState.balance}
              onDeductCredits={() => true}
              generationMode={settings.generationMode}
              globalVideoQuality={settings.videoQuality}
              globalVideoDuration={settings.videoDuration}
              globalVideoFps={settings.videoFps}
              globalVideoResolution={settings.videoResolution}
              imageUrl={sceneImages[scene.scene_number] || null}
              previousImage={sceneImages[scene.scene_number - 1] || null}
              onImageGenerated={(url) =>
                setSceneImages((prev) => ({
                  ...prev,
                  [scene.scene_number]: url,
                }))
              }
              onGenerateVideo={() =>
                handleGenerateSingleVideo(scene.scene_number)
              }
              externalVideoUrl={sceneVideoUrls[scene.scene_number]}
              externalVideoStatus={
                sceneStatus[scene.scene_number]?.status === "processing" ||
                  sceneStatus[scene.scene_number]?.status === "starting"
                  ? "loading"
                  : sceneStatus[scene.scene_number]?.status === "done"
                    ? "success"
                    : undefined
              }
              predictionId={scenePredictionIds[scene.scene_number]}
              errorDetails={sceneStatus[scene.scene_number]?.error}
              characterAnchor={project.character_anchor}
            />
          </div>
        ))}
      </div>

      <div className="text-center">
        <button
          onClick={onBackToScript}
          className="text-slate-500 hover:text-white text-sm underline decoration-slate-700 hover:decoration-white underline-offset-4 transition-all"
        >
          &larr; {t(settings.lang, "backToWriter")}
        </button>
      </div>
    </div>
  );
};

export default VideoGenerator;
