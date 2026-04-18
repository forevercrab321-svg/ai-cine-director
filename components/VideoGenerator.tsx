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
import { supabase } from "../lib/supabaseClient";

const FilmIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
);

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
  referenceImageDataUrl?: string;
  onBackToScript: () => void;
  onUpdateScene?: (sceneIndex: number, field: string, value: any) => void;
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
  referenceImageDataUrl,
  onBackToScript,
  onUpdateScene,
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
  const [sceneImages, setSceneImages] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    project.scenes?.forEach((s: any) => {
      if (s.image_url) init[s.scene_number || s.shot_number || s.shot_id] = s.image_url;
    });
    return init;
  });
  const [sceneVideoUrls, setSceneVideoUrls] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    project.scenes?.forEach((s: any) => {
      if (s.video_url) init[s.scene_number || s.shot_number || s.shot_id] = s.video_url;
    });
    return init;
  });
  const [sceneAudioUrls, setSceneAudioUrls] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    project.scenes?.forEach((s: any) => {
      if (s.audio_url) init[s.scene_number || s.shot_number || s.shot_id] = s.audio_url;
    });
    return init;
  });
  const [scenePredictionIds, setScenePredictionIds] = useState<Record<number, string>>({});
  const [chainError, setChainError] = useState<string | null>(null); // ★ replaces alert()

  // ★ 核心状态锁
  const [isRenderingChain, setIsRenderingChain] = useState(false);

  // ★ 一键成片状态
  const [videoEditJob, setVideoEditJob] = useState<{
    jobId: string;
    status: string;
    progress: number;
    outputUrl?: string;
  } | null>(null);
  const [isFinalizingVideo, setIsFinalizingVideo] = useState(false);
  const [chainProgress, setChainProgress] = useState({ completed: 0, total: 0 });

  // ★ Storyboard approval gate
  const [storyboardWarning, setStoryboardWarning] = useState<'not_approved' | null>(null);
  const [approvalChecked, setApprovalChecked] = useState(false);

  // ★ Verifier hard gate — shots that failed screenplay verifier (Task 2)
  const [verifierBlockedShots, setVerifierBlockedShots] = useState<Scene[]>([]);
  const [showVerifierBlockBanner, setShowVerifierBlockBanner] = useState(false);

  // ★ Auto-audio: called automatically when a video finishes generating
  const generateAutoAudio = async (sceneNum: number, scene: Scene) => {
    // ★ Use audio_description first, then shot_type (which holds video_motion_prompt), then visual_description
    const textToSpeak = (scene.audio_description || scene.shot_type || scene.visual_description || '').trim();
    if (!textToSpeak || textToSpeak.length < 5) return; // Skip if no meaningful text

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      console.log(`[AutoAudio] Scene ${sceneNum}: generating voice for "${textToSpeak.substring(0, 50)}..."`);

      const resp = await fetch('/api/audio/elevenlabs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          text: textToSpeak,
          voice_id: settings.lang === 'zh' ? 'zh_female_shuang' : 'en_female_rachel',
          speed: 1.0,
          stability: 0.55,
          similarity_boost: 0.75,
        }),
      });

      if (!resp.ok) {
        console.warn(`[AutoAudio] Scene ${sceneNum}: voice generation failed (${resp.status})`);
        return;
      }

      const data = await resp.json();
      if (data.audio_url) {
        setSceneAudioUrls(prev => ({ ...prev, [sceneNum]: data.audio_url }));
        const sceneIndex = project.scenes.findIndex(s => s.scene_number === sceneNum);
        if (onUpdateScene && sceneIndex !== -1) onUpdateScene(sceneIndex, 'audio_url', data.audio_url);
        console.log(`[AutoAudio] Scene ${sceneNum}: voice ready ✅ ${data.audio_url}`);
      }
    } catch (err) {
      console.warn(`[AutoAudio] Scene ${sceneNum}: error (non-fatal):`, err);
      // Non-fatal: audio failure should NOT break the video generation chain
    }
  };

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
            const sceneIndex = project.scenes.findIndex(s => s.scene_number === sNum);
            if (onUpdateScene && sceneIndex !== -1) onUpdateScene(sceneIndex, 'video_url', videoUrl);
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

  const handleRenderChain = async (force = false) => {
    if (!isAuthenticated) return alert("请先登录以生成分镜序列。");
    if (isRenderingChain) return;
    if (!project.scenes || project.scenes.length === 0) return alert("请先生成分镜脚本。");

    // 1. Check if user has enough credits.
    const totalVideosCost = (MODEL_COSTS[settings.videoModel] || 28) * project.scenes.length;
    let totalImagesCost = settings.imageModel === "flux_schnell" ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;

    if (!userState.isAdmin && userState.balance < (totalVideosCost + totalImagesCost)) {
      openPricingModal();
      return;
    }

    // ★ Pre-flight: check storyboard approval status (non-blocking soft gate)
    if (project.id && !approvalChecked && !force) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const resp = await fetch(`/api/storyboard/${project.id}/ready-for-video`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (resp.ok) {
          const readyData = await resp.json();
          if (!readyData.storyboard_approved) {
            setStoryboardWarning('not_approved');
            setApprovalChecked(true);
            return; // Block until user confirms
          }
        }
      } catch { /* non-fatal: skip if pipeline runtime not initialized yet */ }
      setApprovalChecked(true);
    }
    setStoryboardWarning(null);

    // ★ HARD VIDEO GATE — Task 2: block any shot with verifier_pass === false
    // verifier_pass is set by canonicalPromptRewriter; undefined = not yet verified (allow).
    const failedShots = project.scenes.filter(s => s.verifier_pass === false);
    if (failedShots.length > 0) {
      setVerifierBlockedShots(failedShots);
      setShowVerifierBlockBanner(true);
      return; // HARD STOP — do not continue chain generation
    }

    setIsRenderingChain(true);
    setChainProgress({ completed: 0, total: project.scenes.length });

    try {
      const FALLBACK_ANCHOR = "A cinematic character consistent with the scene context.";
      let finalAnchor = project.character_anchor;
      if (project.has_cast !== false && (!finalAnchor || finalAnchor.trim() === "" || finalAnchor === "EMPTY")) {
        console.warn("⚠️ [Director Warning] 检测到空锚点！已启用兜底安全锚点。");
        finalAnchor = FALLBACK_ANCHOR;
      } else if (project.has_cast === false) {
        finalAnchor = "";
      }

      setChainError(null); // Clear previous errors
      const newVideoUrls = await generateSceneChain(
        project.id,
        project.scenes,
        finalAnchor,
        settings.videoModel,
        settings.imageModel,
        referenceImageDataUrl,
        project.story_entities || [],
        sceneVideoUrls, // ★ Pass existing videos so the pipeline can resume gracefully
        (progress) => {
          const scene = project.scenes[progress.index];
          const sNum = scene.scene_number;
          if (progress.stage === "image_done") {
            setSceneImages(prev => ({ ...prev, [sNum]: progress.imageUrl }));
            const sceneIndex = project.scenes.findIndex(s => s.scene_number === sNum);
            if (onUpdateScene && sceneIndex !== -1) onUpdateScene(sceneIndex, 'image_url', progress.imageUrl);
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
            const sceneIndex = project.scenes.findIndex(s => s.scene_number === sNum);
            if (onUpdateScene && sceneIndex !== -1) onUpdateScene(sceneIndex, 'video_url', progress.videoUrl);
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
            // ★ AUTO-AUDIO: fire ElevenLabs in parallel (non-blocking — does not stall chain)
            generateAutoAudio(sNum, scene);
          }
        }
      );

      // ★ Auto-finalize the video into a full movie automatically after the chain is successfully completed.
      console.log("🎥 [Chain Complete] Auto-finalizing full movie...");
      await handleFinalizeVideo(newVideoUrls);

    } catch (e: any) {
      console.error("[Chain] ❌ Pipeline Error:", e);
      setChainError(e.message || "生成途中发生严重错误：链条断裂。");
    } finally {
      setIsRenderingChain(false);
      await refreshBalance();
    }
  };

  // ★ 一键成片 - 视频拼接合成
  const handleFinalizeVideo = async (overrideUrls?: string[]) => {
    if (!isAuthenticated) { setChainError("请先登录以使用一键成片功能。"); return; }

    let segments: { scene_number: number; video_url: string; audio_url?: string; subtitle_text?: string }[] = [];

    if (overrideUrls && overrideUrls.length > 0) {
      segments = overrideUrls.map((url, i) => {
        const scene = project.scenes[i];
        const sNum = scene?.scene_number || (i + 1);
        return {
          scene_number: sNum,
          video_url: url,
          audio_url: sceneAudioUrls[sNum],
          subtitle_text: scene ? (scene.audio_description || scene.dialogue_text || '').trim() : undefined
        };
      });
    } else {
      const videoEntries = Object.entries(sceneVideoUrls).filter(([_, url]) => url);
      if (videoEntries.length === 0) {
        setChainError("没有可用的视频片段，请先生成视频");
        return;
      }
      segments = videoEntries.map(([sceneNumStr, url]) => {
        const sNum = parseInt(sceneNumStr);
        const scene = project.scenes.find(s => s.scene_number === sNum);
        return {
          scene_number: sNum,
          video_url: url,
          audio_url: sceneAudioUrls[sNum],
          subtitle_text: scene ? (scene.audio_description || scene.dialogue_text || '').trim() : undefined
        };
      });
    }

    setIsFinalizingVideo(true);
    setVideoEditJob(null);

    try {

      // 调用视频合成 API
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setChainError("请先登录");
        return;
      }

      const response = await fetch('/api/video/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          project_id: project.id,
          segments: segments,
          background_music: {
            url: 'https://assets.mixkit.co/music/preview/mixkit-cinematic-movie-trailer-228.mp3',
            volume: 0.3,
            fade_in: 2,
            fade_out: 2,
          },
          transitions: {
            type: 'crossfade',
            duration: 0.5,
          },
          output_format: {
            resolution: '1080p',
            format: 'mp4',
            fps: 30,
          },
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setChainError(result.error || `视频合成失败 (${response.status})`);
        return;
      }

      if (result.success) {
        // ★ API returns immediately completed with video_urls playlist
        setVideoEditJob({
          jobId: result.job_id,
          status: result.status || 'completed',
          progress: result.progress ?? 100,
          outputUrl: result.output_url || result.video_urls?.[0],
        });
      } else {
        setChainError(result.error || "创建视频合成任务失败");
      }
    } catch (e: any) {
      console.error("[Finalize] Error:", e);
      setChainError("视频合成失败: " + e.message);
    } finally {
      setIsFinalizingVideo(false);
    }
  };

  // ★ 轮询视频编辑任务状态
  useEffect(() => {
    if (!videoEditJob || videoEditJob.status === 'completed' || videoEditJob.status === 'failed') {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const response = await fetch(`/api/video/status/${videoEditJob.jobId}`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });
        const status = await response.json();

        setVideoEditJob({
          jobId: videoEditJob.jobId,
          status: status.status,
          progress: status.progress,
          outputUrl: status.output_url,
        });

        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(pollInterval);
        }
      } catch (e) {
        console.error("[Poll] Error:", e);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [videoEditJob]);



  // 批量下载所有图片
  const handleDownloadAllImages = async () => {
    const imageEntries = Object.entries(sceneImages).filter(([_, url]) => url);
    if (imageEntries.length === 0) return;
    for (const [sceneNum, url] of imageEntries) {
      await forceDownload(url as string, `scene-${sceneNum}-image.jpg`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };

  // 批量下载所有视频
  const handleDownloadAllVideos = async () => {
    const videoEntries = Object.entries(sceneVideoUrls).filter(([_, url]) => url);
    if (videoEntries.length === 0) return;
    for (const [sceneNum, url] of videoEntries) {
      await forceDownload(url as string, `scene-${sceneNum}-video.mp4`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  // 下载所有内容（图片+视频）
  const handleDownloadAll = async () => {
    const hasImages = Object.keys(sceneImages).length > 0;
    const hasVideos = Object.keys(sceneVideoUrls).length > 0;
    if (!hasImages && !hasVideos) return;

    if (hasImages) await handleDownloadAllImages();
    if (hasVideos) await handleDownloadAllVideos();
  };

  const handleGenerateSingleVideo = async (sceneNum: number) => {
    if (!isAuthenticated) return alert("请先登录以生成视频。");

    const scene = project.scenes.find((s) => s.scene_number === sceneNum);
    const imgUrl = sceneImages[sceneNum];
    if (!scene || !imgUrl) return;

    // ★ HARD VIDEO GATE — Task 2: verifier_pass must not be explicitly false
    if (scene.verifier_pass === false) {
      setVerifierBlockedShots([scene]);
      setShowVerifierBlockBanner(true);
      return; // HARD STOP — no video from a failed shot
    }

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
      const promptEngineVersion = ((typeof process !== 'undefined' && process.env && process.env.PROMPT_ENGINE_VERSION) || 'v1') as 'v1' | 'v2';
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
        settings.aspectRatio,
        // 传递 options 给新版 prompt engine
        {
          stylePreset: settings.videoStyle,
          storyEntities: project.story_entities || [],
          continuity: {
            strictness: 'high',
            lockCharacter: true,
            lockStyle: true,
            lockCostume: true,
            lockScene: true,
            usePreviousApprovedAsReference: true,
            scene_memory: {
              scene_number: scene.scene_number,
              location: scene.scene_setting,
              time_of_day: 'night',
              lighting_continuity: scene.visual_description,
            },
            project_context: {
              project_id: project.id,
              visual_style: project.visual_style,
              character_anchor: project.character_anchor,
              story_entities: project.story_entities || [],
            }
          },
          project_id: project.id,
          shot_id: `scene-${scene.scene_number}`,
        },
        promptEngineVersion
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
              <span>{project.scenes?.length || 0} Scenes</span>
              <span>•</span>
              <span>{settings.videoStyle}</span>
              <span>•</span>
              <span className="text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                {MODEL_MULTIPLIERS[settings.videoModel]}x Rate
              </span>
            </div>
          </div>

          <div className="flex gap-3 w-full md:w-auto flex-wrap">
            {/* ★ 一键成片按钮 */}
            {Object.keys(sceneVideoUrls).length > 1 && (
              <button
                onClick={isFinalizingVideo ? undefined : () => handleFinalizeVideo()}
                disabled={isFinalizingVideo || (videoEditJob && videoEditJob.status === 'processing')}
                className={`flex-1 md:flex-none px-6 py-3 rounded-lg text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2 text-sm
                  ${isFinalizingVideo || (videoEditJob && videoEditJob.status === 'processing')
                    ? "bg-purple-900/50 text-purple-300 cursor-not-allowed shadow-none"
                    : "bg-purple-600 hover:bg-purple-500 shadow-purple-500/20"
                  }
                `}
              >
                {isFinalizingVideo || (videoEditJob && videoEditJob.status === 'processing') ? (
                  <LoaderIcon className="w-4 h-4 animate-spin" />
                ) : (
                  <FilmIcon />
                )}
                {isFinalizingVideo
                  ? "合成中..."
                  : videoEditJob?.status === 'processing'
                    ? `合成中 ${videoEditJob.progress}%`
                    : "🎬 一键成片"}
              </button>
            )}

            <button
              onClick={isRenderingChain || isFinalizingVideo ? undefined : () => handleRenderChain()}
              disabled={isRenderingChain || isFinalizingVideo}
              className={`flex-1 md:flex-none px-6 py-3 rounded-lg text-white font-bold transition-all shadow-lg flex items-center justify-center gap-2 text-sm
                ${isRenderingChain || isFinalizingVideo
                  ? "bg-indigo-900/50 text-indigo-300 cursor-not-allowed shadow-none"
                  : "bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20"
                }
              `}
            >
              {isRenderingChain || isFinalizingVideo ? (
                <LoaderIcon className="w-4 h-4 animate-spin" />
              ) : (
                <VideoCameraIcon className="w-4 h-4" />
              )}
              {isRenderingChain
                ? "锁链生成中..."
                : isFinalizingVideo
                  ? "自动合成全片中..."
                  : "🚀 一键锁链出全片"}
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

      {/* ★ VERIFIER HARD GATE BANNER — Task 2+3: blocks video gen for failed shots */}
      {showVerifierBlockBanner && verifierBlockedShots.length > 0 && (
        <div className="max-w-3xl mx-auto mb-4 p-4 bg-red-950/50 border border-red-500/50 rounded-xl animate-in fade-in">
          <div className="flex items-start gap-3">
            <span className="text-red-400 text-xl mt-0.5 shrink-0">🚫</span>
            <div className="flex-1">
              <p className="text-red-300 font-bold text-sm">VIDEO BLOCKED — Screenplay Verifier Failed</p>
              <p className="text-red-400/80 text-xs mt-1">
                {verifierBlockedShots.length} shot{verifierBlockedShots.length > 1 ? 's' : ''} failed the screenplay faithfulness verifier.
                No video may be generated from a shot that failed verification.
                Fix the canonical prompt first, then retry.
              </p>
              <div className="mt-2 space-y-1">
                {verifierBlockedShots.map((s) => (
                  <div key={s.scene_number} className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-red-500">✗</span>
                    <span className="text-red-300">Shot {s.scene_number}</span>
                    <span className="text-red-400/60">score: {s.verifier_score ?? '?'}/35</span>
                    {s.verifier_fail_reasons?.length ? (
                      <span className="text-red-400/50 truncate max-w-[300px]">— {s.verifier_fail_reasons[0]}</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="text-red-400/60 text-[10px] mt-2 font-mono">
                To fix: open Shot Inspector on each failed card → review fail reasons → use /api/shots/rewrite-canonical to retrofit, or regenerate the storyboard.
              </p>
            </div>
            <button
              onClick={() => setShowVerifierBlockBanner(false)}
              className="text-red-400/60 hover:text-red-300 text-lg leading-none shrink-0"
            >×</button>
          </div>
        </div>
      )}

      {/* ★ Chain error banner — replaces alert() */}
      {chainError && (
        <div className="max-w-2xl mx-auto mb-4 p-3 bg-red-900/30 border border-red-500/40 rounded-xl flex items-start gap-3 animate-in fade-in">
          <span className="text-red-400 text-lg mt-0.5 shrink-0">❌</span>
          <div className="flex-1">
            <p className="text-red-300 font-semibold text-sm">生成错误</p>
            <p className="text-red-400/80 text-xs mt-0.5 whitespace-pre-wrap">{chainError}</p>
          </div>
          <button
            onClick={() => setChainError(null)}
            className="text-red-400/60 hover:text-red-300 text-lg leading-none shrink-0"
          >×</button>
        </div>
      )}

      {/* ★ Storyboard approval gate warning */}
      {storyboardWarning === 'not_approved' && (
        <div className="max-w-2xl mx-auto mb-4 p-4 bg-amber-900/30 border border-amber-500/40 rounded-xl flex items-start gap-3 animate-in fade-in">
          <span className="text-amber-400 text-xl mt-0.5 shrink-0">⚠️</span>
          <div className="flex-1">
            <p className="text-amber-300 font-semibold text-sm">分镜故事板未全部通过审批</p>
            <p className="text-amber-400/80 text-xs mt-1">
              建议先在「镜头列表」中为每个镜头生成图片并点击 <strong>Approve</strong>，
              确保人物、服装、场景一致性后再生成视频，效果更佳。
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setStoryboardWarning(null); setApprovalChecked(true); handleRenderChain(true); }}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold"
              >
                强制继续生成
              </button>
              <button
                onClick={() => { setStoryboardWarning(null); onBackToScript(); }}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-bold"
              >
                返回审批故事板
              </button>
            </div>
          </div>
          <button onClick={() => setStoryboardWarning(null)} className="text-amber-400/60 hover:text-amber-300 text-lg leading-none shrink-0">×</button>
        </div>
      )}

      {/* ★ 视频合成进度条 */}
      {videoEditJob && videoEditJob.status === 'processing' && (
        <div className="max-w-md mx-auto mb-8 animate-in fade-in slide-in-from-top-4">
          <div className="flex justify-between text-xs text-purple-400 mb-2 uppercase tracking-widest font-bold">
            <span>🎬 视频合成中...</span>
            <span>{videoEditJob.progress}%</span>
          </div>
          <div className="h-2 bg-slate-800 rounded-full overflow-hidden border border-purple-500/30">
            <div
              className="h-full bg-purple-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(168,85,247,0.5)]"
              style={{ width: `${videoEditJob.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* ★ 视频合成完成 */}
      {videoEditJob && videoEditJob.status === 'completed' && videoEditJob.outputUrl && (
        <div className="max-w-md mx-auto mb-8 p-4 bg-green-900/20 border border-green-500/30 rounded-xl animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <span className="text-green-400">✅</span>
              </div>
              <div>
                <p className="text-green-400 font-bold">视频合成完成！</p>
                <p className="text-green-400/60 text-sm">点击下载最终成片</p>
              </div>
            </div>
            <a
              href={videoEditJob.outputUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold text-sm flex items-center gap-2"
            >
              <DownloadIcon />
              下载
            </a>
          </div>
        </div>
      )}

      {/* ★ 视频合成失败 */}
      {videoEditJob && videoEditJob.status === 'failed' && (
        <div className="max-w-md mx-auto mb-8 p-4 bg-red-900/20 border border-red-500/30 rounded-xl animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-red-400">❌</span>
            </div>
            <div>
              <p className="text-red-400 font-bold">视频合成失败</p>
              <p className="text-red-400/60 text-sm">请重试或联系客服</p>
            </div>
          </div>
        </div>
      )}



      <div className="space-y-8">
        {project.scenes && project.scenes.map((scene, index) => (
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
              onImageGenerated={(url) => {
                setSceneImages((prev) => ({
                  ...prev,
                  [scene.scene_number]: url,
                }));
                const sceneIndex = project.scenes.findIndex(s => s.scene_number === scene.scene_number);
                if (onUpdateScene && sceneIndex !== -1) onUpdateScene(sceneIndex, 'image_url', url);
              }}
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
              storyEntities={project.story_entities || []}
            />
            {/* ★ AUTO-AUDIO: Inline audio player — appears automatically when voice is ready */}
            {sceneAudioUrls[scene.scene_number] && (
              <div className="mt-2 mx-1 px-4 py-2.5 bg-slate-800/80 border border-indigo-500/20 rounded-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <span className="text-indigo-400 text-sm shrink-0">🎙️</span>
                <span className="text-indigo-300 text-xs font-semibold shrink-0">AI 配音就绪</span>
                <audio
                  controls
                  src={sceneAudioUrls[scene.scene_number]}
                  className="flex-1 h-8"
                  style={{ filter: 'invert(0.8) hue-rotate(180deg)' }}
                />
              </div>
            )}
            {/* Audio generating indicator */}
            {sceneVideoUrls[scene.scene_number] && !sceneAudioUrls[scene.scene_number] && (
              <div className="mt-2 mx-1 px-4 py-2 bg-slate-800/40 border border-slate-700/30 rounded-lg flex items-center gap-2">
                <span className="text-slate-500 text-xs animate-pulse">🎙️ AI 配音生成中...</span>
              </div>
            )}
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
