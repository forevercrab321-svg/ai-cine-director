
import React, { useState, useEffect } from 'react';
import { Scene, Language, ImageModel, VideoModel, VideoStyle, AspectRatio, GenerationMode, VideoQuality, VideoDuration, VideoFps, VideoResolution, CREDIT_COSTS, STYLE_PRESETS, MODEL_COSTS, MODEL_MULTIPLIERS, StoryEntity } from '../types';
import { PhotoIcon, VideoCameraIcon, LoaderIcon } from './IconComponents';
import { generateImage } from '../services/replicateService';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';
import { forceDownload } from '../utils/download';

interface SceneCardProps {
  scene: Scene;
  lang: Language;
  imageModel: ImageModel;
  videoModel: VideoModel;
  videoStyle: VideoStyle;
  aspectRatio: AspectRatio;
  userCredits: number;
  onDeductCredits: (amount: number) => boolean;
  generationMode: GenerationMode;
  globalVideoQuality: VideoQuality;
  globalVideoDuration: VideoDuration;
  globalVideoFps: VideoFps;
  globalVideoResolution: VideoResolution;

  imageUrl: string | null;
  previousImage: string | null;
  onImageGenerated: (url: string) => void;
  onGenerateVideo?: () => void;

  externalVideoUrl?: string;
  externalVideoStatus?: 'idle' | 'loading' | 'success' | 'error';
  predictionId?: string;
  errorDetails?: string;
  characterAnchor?: string;
  storyEntities?: StoryEntity[];
  sceneIndex: number;
}

const RefreshIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ExpandIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m11.25-5.25h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25v-4.5m0 4.5h-4.5m4.5 0L15 15M3.75 20.25h4.5m-4.5 0v-4.5m0 4.5L9 15" />
  </svg>
);



// ─── Shot Inspector Panel (Task 5 — Canonical Prompt Traceability) ────────────
// Displayed below each shot card when verifier data is available.
// Shows: screenplay beat · must-show checklist · verifier score · approved prompt.
const ShotInspectorPanel = ({ scene }: { scene: any }) => {
  const [expanded, setExpanded] = useState(false);
  const score    = scene.verifier_score ?? null;
  const passes   = scene.verifier_pass  ?? null;
  const beat     = scene.screenplay_beat || '';
  const mustShow = Array.isArray(scene.must_show) ? scene.must_show : [];
  const dims     = Array.isArray(scene.verifier_dimensions) ? scene.verifier_dimensions : [];
  const failReasons = Array.isArray(scene.verifier_fail_reasons) ? scene.verifier_fail_reasons : [];
  const canonical   = scene.canonical_prompt || scene.image_prompt || '';
  const rewrites    = scene.rewrite_count ?? 0;

  if (!beat && score == null) return null;

  const scoreColor = passes === true  ? 'text-emerald-400 border-emerald-500/40'
                   : passes === false ? 'text-red-400 border-red-500/40'
                   : 'text-slate-400 border-slate-600/40';

  return (
    <div className="mt-3 border-t border-slate-800/40 pt-3">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full text-left group"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">
            Shot Inspector
          </span>
          {score != null && (
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${scoreColor}`}>
              {score}/35 {passes === true ? '✓' : passes === false ? '✗' : ''}
            </span>
          )}
          {passes === false && (
            <span className="text-[10px] text-red-400 font-mono">FAILED</span>
          )}
          {rewrites > 0 && (
            <span className="text-[10px] text-amber-400 font-mono">↺ rewritten</span>
          )}
        </div>
        <span className="text-slate-600 text-[10px]">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Screenplay Beat */}
          {beat && (
            <div className="bg-indigo-950/30 border border-indigo-500/20 rounded p-2">
              <p className="text-[9px] text-indigo-400 font-mono uppercase tracking-widest mb-1">Screenplay Beat</p>
              <p className="text-[11px] text-slate-300 leading-snug">{beat}</p>
            </div>
          )}

          {/* Must-show checklist */}
          {mustShow.length > 0 && (
            <div className="bg-slate-900/50 border border-slate-700/30 rounded p-2">
              <p className="text-[9px] text-slate-500 font-mono uppercase tracking-widest mb-1">Must Show</p>
              <ul className="space-y-0.5">
                {mustShow.map((item: string, idx: number) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-emerald-500 text-[10px] mt-0.5">◆</span>
                    <span className="text-[10px] text-slate-300">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verifier dimension scores */}
          {dims.length > 0 && (
            <div className="bg-slate-900/50 border border-slate-700/30 rounded p-2">
              <p className="text-[9px] text-slate-500 font-mono uppercase tracking-widest mb-1.5">Verifier Scores</p>
              <div className="space-y-1">
                {dims.map((d: any) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(n => (
                        <div key={n} className={`w-2 h-2 rounded-sm ${n <= d.score ? (d.score >= 4 ? 'bg-emerald-500' : d.score >= 2 ? 'bg-amber-500' : 'bg-red-500') : 'bg-slate-700'}`} />
                      ))}
                    </div>
                    <span className={`text-[9px] font-mono ${d.score >= 4 ? 'text-emerald-400' : d.score >= 2 ? 'text-amber-400' : 'text-red-400'}`}>
                      {d.name.replace(/_/g,' ')}
                    </span>
                    {d.score < 4 && (
                      <span className="text-[9px] text-slate-500 italic truncate max-w-[180px]">{d.reason}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fail reasons */}
          {failReasons.length > 0 && (
            <div className="bg-red-950/30 border border-red-500/20 rounded p-2">
              <p className="text-[9px] text-red-400 font-mono uppercase tracking-widest mb-1">Fail Reasons</p>
              {failReasons.map((r: string, idx: number) => (
                <p key={idx} className="text-[10px] text-red-300">• {r}</p>
              ))}
            </div>
          )}

          {/* Approved canonical prompt */}
          {canonical && (
            <div className="bg-slate-950/60 border border-slate-700/20 rounded p-2">
              <p className="text-[9px] text-slate-500 font-mono uppercase tracking-widest mb-1">
                Approved Prompt Sent to Model
              </p>
              <pre className="text-[9px] text-slate-400 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                {canonical}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Simulated terminal output logs
const LOADING_LOGS = [
  "正在初始化生成上下文...",
  "正在分析角色一致性锚点...",
  "正在注入风格修改向量...",
  "正在渲染线框结构...",
  "正在计算光线追踪照明...",
  "正在精细化纹理细节...",
  "正在完成色彩分级..."
];

const TerminalLoader = () => {
  const [logIndex, setLogIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setLogIndex(prev => (prev + 1) % LOADING_LOGS.length);
    }, 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-start gap-2 w-full px-8">
      <div className="flex items-center gap-2 mb-2">
        <LoaderIcon className="w-5 h-5 text-sky-500" />
        <span className="text-xs font-bold text-sky-400 uppercase tracking-widest">处理中</span>
      </div>
      <div className="font-mono text-[10px] text-slate-500 space-y-1 w-full opacity-80">
        <p className="opacity-40">root@ai-director:~$ start-render --hq</p>
        <p className="text-sky-300/80">&gt; {LOADING_LOGS[logIndex]}</p>
        {logIndex > 0 && <p className="opacity-60">&gt; {LOADING_LOGS[logIndex - 1]} <span className="text-green-500">[OK]</span></p>}
      </div>
    </div>
  );
}

const SceneCard: React.FC<SceneCardProps> = ({
  scene,
  imageModel,
  videoModel,
  videoStyle,
  aspectRatio,
  imageUrl,
  onImageGenerated,
  onGenerateVideo,
  externalVideoUrl,
  externalVideoStatus,
  predictionId,
  errorDetails,
  characterAnchor,
  storyEntities,
  onDeductCredits,
  userCredits,
  sceneIndex
}) => {
  const { openPricingModal, userState, hasEnoughCredits, isAuthenticated } = useAppContext();
  const [isImageLoading, setIsImageLoading] = useState(false);
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

  // ESC key to close video modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVideoModalOpen) {
        setIsVideoModalOpen(false);
      }
    };
    if (isVideoModalOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden'; // Prevent scroll when modal open
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isVideoModalOpen]);

  // Calculate costs
  const videoBaseCost = MODEL_COSTS[videoModel] || 28;
  const videoCost = videoBaseCost;
  const imgCost = imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;

  // ★ Credit guard for individual buttons (pure check, no side effects during render)
  const canAffordImage = userState.isAdmin || userState.balance >= imgCost;
  const canAffordVideo = userState.isAdmin || userState.balance >= videoCost;

  const handleGenerateImage = async () => {
    if (!isAuthenticated) {
      alert("请先登录以生成图片。");
      return;
    }

    const cost = imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;

    // ★ GUARD ONLY — do NOT call onDeductCredits here!
    // The backend API (/api/replicate/predict) handles the actual DB deduction.
    // Calling onDeductCredits would cause DOUBLE DEDUCTION (frontend ref + backend RPC).
    if (!userState.isAdmin && !hasEnoughCredits(cost)) {
      // hasEnoughCredits auto-opens pricing modal
      return;
    }

    setIsImageLoading(true);
    try {
      // ── Use scene.image_prompt (set by Gemini shot planner via composeAllPrompts)
      // Fallback: scene.visual_description + shot_type for legacy scenes without image_prompt
      // Do NOT inline-build prompts here — that logic lives in lib/shotPromptCompiler.ts
      let prompt = scene.image_prompt || scene.visual_description || scene.shot_type || '';
      if (!prompt) prompt = `${scene.visual_description || ''}, ${scene.shot_type || ''}`.trim();
      if (videoStyle !== 'none') {
        const preset = STYLE_PRESETS.find(p => p.id === videoStyle);
        if (preset) prompt += preset.promptModifier;
      }

      const resultImageUrl = await generateImage(
        prompt,
        imageModel,
        videoStyle,
        aspectRatio,
        characterAnchor,
        null,
        storyEntities || []
      );

      onImageGenerated(resultImageUrl);
    } catch (e: any) {
      if (e.code === 'INSUFFICIENT_CREDITS' || e.message === 'INSUFFICIENT_CREDITS') {
        openPricingModal();
        return;
      }
      console.error("Image Gen Error:", e);
      alert(`生成失败：${e.message}`);
    } finally {
      setIsImageLoading(false);
    }
  };

  const handleGenerateVideoClick = () => {
    // ★ GUARD ONLY — actual deduction done by VideoGenerator via backend
    if (!userState.isAdmin && !hasEnoughCredits(videoCost)) {
      // hasEnoughCredits auto-opens pricing modal
      return;
    }
    if (onGenerateVideo) onGenerateVideo();
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 relative group/card transition-all duration-300 hover:border-slate-600 hover:shadow-2xl hover:shadow-black/50">
      <div className="flex justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
            SEQ {String(scene.scene_number).padStart(2, '0')}
          </span>
          {scene.scene_setting && (
            <span className="text-xs text-amber-400/80 font-medium truncate max-w-[300px]" title={scene.scene_setting}>
              📍 {scene.scene_setting}
            </span>
          )}
          {scene.verifier_pass === false && (
            <span className="bg-red-900/40 text-red-400 border border-red-500/40 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
              ✗ VERIFIER FAILED
            </span>
          )}
          {predictionId && <span className="text-[10px] font-mono text-slate-600">#{predictionId.slice(0, 6)}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* IMAGE SECTION */}
        <div className="flex flex-col gap-3 relative group/image">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span> 原画帧
            </span>
          </div>

          <div className="aspect-video bg-black rounded-lg border border-slate-800 flex items-center justify-center overflow-hidden relative shadow-inner">
            {sceneIndex > 0 ? (
              <div className="flex flex-col items-center justify-center h-full w-full text-slate-500 opacity-80 gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-indigo-500/50">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                </svg>
                <span className="text-xs font-medium tracking-widest">🔗 延续镜头：将自动使用上一镜尾帧</span>
              </div>
            ) : isImageLoading ? (
              <TerminalLoader />
            ) : imageUrl ? (
              <>
                <img src={imageUrl} className="w-full h-full object-cover transition-transform duration-700 group-hover/image:scale-105" alt="Scene Frame" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover/image:opacity-100 transition-opacity duration-300">
                  <div className="absolute top-3 right-3 flex gap-2">
                    <button
                      onClick={() => forceDownload(imageUrl!, `scene-${scene.scene_number}-image.jpg`)}
                      title="Download Image"
                      className="p-2 bg-black/60 hover:bg-emerald-500 hover:text-white text-white rounded-full backdrop-blur-md transition-all border border-white/10"
                    >
                      <DownloadIcon />
                    </button>
                    <button
                      onClick={handleGenerateImage}
                      title="Regenerate Frame"
                      className="p-2 bg-black/60 hover:bg-white hover:text-black text-white rounded-full backdrop-blur-md transition-all border border-white/10"
                    >
                      <RefreshIcon />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <button
                onClick={canAffordImage ? handleGenerateImage : openPricingModal}
                className={`group/btn relative px-6 py-3 border rounded-lg transition-all overflow-hidden
                  ${canAffordImage
                    ? 'bg-slate-900 border-slate-700 hover:border-sky-500/50 text-slate-400 hover:text-white'
                    : 'bg-red-950/30 border-red-500/30 text-red-300 hover:bg-red-900/40'}
                `}
              >
                <div className="absolute inset-0 bg-sky-500/10 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300"></div>
                <div className="relative flex flex-col items-center gap-2">
                  <PhotoIcon className="w-6 h-6" />
                  <span className="text-xs font-bold tracking-widest">{canAffordImage ? '生成原画帧' : `充值 (${imgCost} 💎)`}</span>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* VIDEO SECTION */}
        <div className="flex flex-col gap-3 relative group/video">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> 动态输出
            </span>
            {externalVideoStatus === 'success' && <span className="text-[10px] text-green-500 font-mono">完成</span>}
          </div>

          <div className="aspect-video bg-black rounded-lg border border-slate-800 flex items-center justify-center overflow-hidden relative shadow-inner">
            {externalVideoStatus === 'loading' ? (
              <div className="flex flex-col items-center gap-4 w-full px-8">
                <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500/80 animate-[progress_2s_ease-in-out_infinite] w-1/3 rounded-full"></div>
                </div>
                <div className="font-mono text-[10px] text-rose-300 animate-pulse">
                  正在渲染运动向量...
                </div>
              </div>
            ) : externalVideoUrl ? (
              <>
                {/* Video preview - clicking opens modal */}
                <div
                  className="relative w-full h-full group/vidplay cursor-pointer"
                  onClick={() => setIsVideoModalOpen(true)}
                >
                  {/* Video preview with custom overlay instead of native controls */}
                  <video
                    src={externalVideoUrl}
                    className="w-full h-full object-cover pointer-events-none"
                    muted
                    loop
                    autoPlay
                    playsInline
                  />

                  {/* Play overlay - indicates clickable */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors">
                    <div className="w-16 h-16 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center border-2 border-white/50">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-white ml-1">
                        <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>

                  {/* Action buttons overlay */}
                  <div className="absolute top-3 right-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsVideoModalOpen(true);
                      }}
                      title="全屏播放"
                      className="p-2 bg-slate-800/90 hover:bg-slate-700 text-white rounded-full backdrop-blur-md transition-all border border-white/20 shadow-lg"
                    >
                      <ExpandIcon />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        forceDownload(externalVideoUrl!, `scene-${scene.scene_number}-video.mp4`);
                      }}
                      title="下载视频"
                      className="p-2.5 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-full backdrop-blur-md transition-all border border-white/20 shadow-lg flex items-center gap-1"
                    >
                      <DownloadIcon />
                      <span className="text-xs font-bold pr-1">下载</span>
                    </button>
                  </div>

                  {/* Bottom hint */}
                  <div className="absolute bottom-2 left-0 right-0 text-center">
                    <span className="text-xs text-white/70 bg-black/50 px-3 py-1 rounded-full backdrop-blur-sm">
                      点击播放视频
                    </span>
                  </div>
                </div>

                {/* Video Fullscreen Modal */}
                {isVideoModalOpen && (
                  <div
                    className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
                    onClick={() => setIsVideoModalOpen(false)}
                  >
                    {/* Top bar with buttons */}
                    <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent z-10">
                      {/* Back/Close button - LEFT side, very prominent */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsVideoModalOpen(false);
                        }}
                        className="flex items-center gap-2 px-5 py-3 bg-white/20 hover:bg-white/30 text-white rounded-full backdrop-blur-md transition-all border border-white/30 shadow-xl"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                        </svg>
                        <span className="text-base font-bold">返回</span>
                      </button>

                      {/* Right side buttons */}
                      <div className="flex gap-3">
                        {/* Download button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            forceDownload(externalVideoUrl!, `scene-${scene.scene_number}-video.mp4`);
                          }}
                          className="flex items-center gap-2 px-4 py-3 bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-full backdrop-blur-md transition-all border border-white/20 shadow-xl"
                        >
                          <DownloadIcon />
                          <span className="text-sm font-bold">下载视频</span>
                        </button>

                        {/* Close X button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsVideoModalOpen(false);
                          }}
                          className="p-3 bg-red-600/80 hover:bg-red-500 text-white rounded-full backdrop-blur-md transition-all border border-white/20 shadow-xl"
                          title="关闭"
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    </div>

                    {/* Video player */}
                    <video
                      src={externalVideoUrl}
                      controls
                      autoPlay
                      className="max-w-[90vw] max-h-[80vh] rounded-lg shadow-2xl"
                      onClick={(e) => e.stopPropagation()}
                    />

                    {/* Hint text */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/50 text-sm">
                      点击任意位置或按 ESC 关闭
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={scene.verifier_pass === false ? undefined : (canAffordVideo ? handleGenerateVideoClick : openPricingModal)}
                disabled={!imageUrl || isImageLoading || scene.verifier_pass === false}
                title={scene.verifier_pass === false ? 'Shot failed screenplay verifier — regenerate or use retrofit endpoint before generating video' : undefined}
                className={`relative group/btn w-full h-full flex flex-col items-center justify-center gap-3 transition-all
                  ${scene.verifier_pass === false
                    ? 'opacity-60 cursor-not-allowed bg-red-950/30'
                    : !imageUrl || isImageLoading
                      ? 'opacity-30 cursor-not-allowed'
                      : !canAffordVideo
                        ? 'opacity-80 hover:opacity-100 bg-red-950/20'
                        : 'opacity-60 hover:opacity-100 hover:bg-slate-900/50'}
                `}
              >
                {scene.verifier_pass === false ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-red-500/70">
                      <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 0 0-5.25 5.25v3a3 3 0 0 0-3 3v6.75a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3v-6.75a3 3 0 0 0-3-3v-3c0-2.9-2.35-5.25-5.25-5.25Zm3.75 8.25v-3a3.75 3.75 0 1 0-7.5 0v3h7.5Z" clipRule="evenodd" />
                    </svg>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xs font-bold tracking-widest uppercase text-red-400">VIDEO LOCKED</span>
                      <span className="text-[10px] text-red-500/70 text-center px-2 leading-tight">Verifier failed — fix prompt first</span>
                    </div>
                  </>
                ) : (
                  <>
                    <VideoCameraIcon className={`w-8 h-8 transition-colors ${!canAffordVideo ? 'text-red-400' : 'text-slate-500 group-hover/btn:text-rose-500'}`} />
                    {!imageUrl ? (
                      <span className="text-[10px] font-mono text-slate-600">等待原画图片...</span>
                    ) : (
                      <div className="flex flex-col items-center gap-1">
                        <span className={`text-xs font-bold tracking-widest uppercase transition-colors ${!canAffordVideo ? 'text-red-300' : 'group-hover/btn:text-white'}`}>
                          {canAffordVideo ? '生成动态' : '请先充值'}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border transition-all
                          ${!canAffordVideo
                            ? 'bg-red-900/30 text-red-300 border-red-500/30'
                            : 'bg-slate-800 text-slate-300 border-slate-700 group-hover/btn:border-rose-500/50 group-hover/btn:text-rose-400'}
                        `}>
                          {videoCost} 💎
                        </span>
                      </div>
                    )}
                  </>
                )}
              </button>
            )}
          </div>
          {errorDetails && (
            <div className="mt-2 bg-red-950/30 border border-red-500/20 p-3 rounded-lg flex items-start gap-2">
              <span className="text-red-500 text-xs mt-0.5">⚠️</span>
              <p className="text-[10px] text-red-400 font-mono break-all leading-relaxed">{errorDetails}</p>
            </div>
          )}
        </div>
      </div>
      <div className="mt-5 border-t border-slate-800/50 pt-4">
        <p className="text-xs text-slate-400 font-serif leading-relaxed italic opacity-80 pl-2 border-l-2 border-indigo-500/30">
          "{scene.visual_description}"
        </p>
      </div>

      {/* ── Shot Inspector (Task 5: Canonical Prompt Traceability) ─────────── */}
      {(scene.screenplay_beat || scene.verifier_score != null) && (
        <ShotInspectorPanel scene={scene} />
      )}
    </div>
  );
};

export default SceneCard;
