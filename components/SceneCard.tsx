
import React, { useState, useEffect } from 'react';
import { Scene, Language, ImageModel, VideoModel, VideoStyle, AspectRatio, GenerationMode, VideoQuality, VideoDuration, VideoFps, VideoResolution, CREDIT_COSTS, STYLE_PRESETS, MODEL_COSTS, MODEL_MULTIPLIERS } from '../types';
import { PhotoIcon, VideoCameraIcon, LoaderIcon } from './IconComponents';
import { generateImage } from '../services/replicateService';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';

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
  } catch {
    // Fallback: open in new tab
    window.open(url, '_blank');
  }
};

// Simulated terminal output logs
const LOADING_LOGS = [
  "Initializing generative context...",
  "Analyzing visual consistency anchor...",
  "Injecting style modifier vectors...",
  "Rendering wireframe structure...",
  "Calculating ray-traced lighting...",
  "Refining detailed textures...",
  "Finalizing color grading..."
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
        <span className="text-xs font-bold text-sky-400 uppercase tracking-widest">Processing</span>
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
  onDeductCredits,
  userCredits,
  isAuthenticated
}) => {
  const { openPricingModal, userState, hasEnoughCredits } = useAppContext();
  const [isImageLoading, setIsImageLoading] = useState(false);

  // Calculate costs
  const videoBaseCost = MODEL_COSTS[videoModel] || 28;
  const videoCost = videoBaseCost;
  const imgCost = imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;

  // ★ Credit guard for individual buttons
  const canAffordImage = userState.isAdmin || hasEnoughCredits(imgCost);
  const canAffordVideo = userState.isAdmin || hasEnoughCredits(videoCost);

  const handleGenerateImage = async () => {
    if (!isAuthenticated) {
      alert("Please sign in to generate images.");
      return;
    }

    const cost = imageModel === 'flux_schnell' ? CREDIT_COSTS.IMAGE_FLUX_SCHNELL : CREDIT_COSTS.IMAGE_FLUX;

    // ★ Atomic deduct via ref — auto-opens pricing modal if insufficient
    if (!userState.isAdmin) {
      const canDeduct = await onDeductCredits(cost);
      if (!canDeduct) {
        return; // deductCredits already opened the pricing modal
      }
    }

    setIsImageLoading(true);
    try {
      let prompt = `${scene.visual_description}, ${scene.shot_type}`;
      if (videoStyle !== 'none') {
        const preset = STYLE_PRESETS.find(p => p.id === videoStyle);
        if (preset) prompt += preset.promptModifier;
      }

      const resultImageUrl = await generateImage(
        prompt,
        imageModel,
        videoStyle,
        aspectRatio,
        characterAnchor
      );

      // Credits already deducted above
      onImageGenerated(resultImageUrl);
    } catch (e: any) {
      if (e.message === "Insufficient credits" || e.code === 'INSUFFICIENT_CREDITS') {
        openPricingModal();
        return;
      }
      console.error("Image Gen Error:", e);
      alert(`Generation Failed: ${e.message}`);
    } finally {
      setIsImageLoading(false);
    }
  };

  const handleGenerateVideoClick = () => {
    // ★ Use hasEnoughCredits (ref-based) — auto-opens pricing modal if insufficient
    if (!hasEnoughCredits(videoCost)) {
      return; // hasEnoughCredits already opened the pricing modal
    }
    if (onGenerateVideo) onGenerateVideo();
  };

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 relative group/card transition-all duration-300 hover:border-slate-600 hover:shadow-2xl hover:shadow-black/50">
      <div className="flex justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
            SEQ {String(scene.scene_number).padStart(2, '0')}
          </span>
          {predictionId && <span className="text-[10px] font-mono text-slate-600">#{predictionId.slice(0, 6)}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* IMAGE SECTION */}
        <div className="flex flex-col gap-3 relative group/image">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span> Source Frame
            </span>
          </div>

          <div className="aspect-video bg-black rounded-lg border border-slate-800 flex items-center justify-center overflow-hidden relative shadow-inner">
            {isImageLoading ? (
              <TerminalLoader />
            ) : imageUrl ? (
              <>
                <img src={imageUrl} className="w-full h-full object-cover transition-transform duration-700 group-hover/image:scale-105" alt="Scene Frame" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover/image:opacity-100 transition-opacity duration-300">
                  <div className="absolute top-3 right-3 flex gap-2">
                    <button
                      onClick={() => downloadFile(imageUrl!, `scene-${scene.scene_number}-image.jpg`)}
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
                  <span className="text-xs font-bold tracking-widest">{canAffordImage ? 'GENERATE FRAME' : `RECHARGE (${imgCost} 💎)`}</span>
                </div>
              </button>
            )}
          </div>
        </div>

        {/* VIDEO SECTION */}
        <div className="flex flex-col gap-3 relative group/video">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Motion Output
            </span>
            {externalVideoStatus === 'success' && <span className="text-[10px] text-green-500 font-mono">DONE</span>}
          </div>

          <div className="aspect-video bg-black rounded-lg border border-slate-800 flex items-center justify-center overflow-hidden relative shadow-inner">
            {externalVideoStatus === 'loading' ? (
              <div className="flex flex-col items-center gap-4 w-full px-8">
                <div className="w-full h-1 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500/80 animate-[progress_2s_ease-in-out_infinite] w-1/3 rounded-full"></div>
                </div>
                <div className="font-mono text-[10px] text-rose-300 animate-pulse">
                  Rendering Motion Vectors...
                </div>
              </div>
            ) : externalVideoUrl ? (
              <div className="relative w-full h-full group/vidplay">
                <video src={externalVideoUrl} controls className="w-full h-full object-cover" />
                <button
                  onClick={() => downloadFile(externalVideoUrl!, `scene-${scene.scene_number}-video.mp4`)}
                  title="Download Video"
                  className="absolute top-3 right-3 p-2 bg-black/60 hover:bg-emerald-500 hover:text-white text-white rounded-full backdrop-blur-md transition-all border border-white/10 opacity-0 group-hover/vidplay:opacity-100"
                >
                  <DownloadIcon />
                </button>
              </div>
            ) : (
              <button
                onClick={canAffordVideo ? handleGenerateVideoClick : openPricingModal}
                disabled={!imageUrl || isImageLoading}
                className={`relative group/btn w-full h-full flex flex-col items-center justify-center gap-3 transition-all
                  ${!imageUrl || isImageLoading
                    ? 'opacity-30 cursor-not-allowed'
                    : !canAffordVideo
                      ? 'opacity-80 hover:opacity-100 bg-red-950/20'
                      : 'opacity-60 hover:opacity-100 hover:bg-slate-900/50'}
                `}
              >
                <VideoCameraIcon className={`w-8 h-8 transition-colors ${!canAffordVideo ? 'text-red-400' : 'text-slate-500 group-hover/btn:text-rose-500'}`} />
                {!imageUrl ? (
                  <span className="text-[10px] font-mono text-slate-600">Waiting for source image...</span>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    <span className={`text-xs font-bold tracking-widest uppercase transition-colors ${!canAffordVideo ? 'text-red-300' : 'group-hover/btn:text-white'}`}>
                      {canAffordVideo ? 'Generate Motion' : 'Recharge First'}
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
    </div>
  );
};

export default SceneCard;
