import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { generateStoryboard } from '../services/geminiService';
import { StoryboardProject, Scene, Language } from '../types';
import { supabase } from '../lib/supabaseClient';
import { t } from '../i18n';
import {
  buildConsistencyProfile,
  composeConsistentPrompt,
  getConsistencyParams,
  type ConsistencyConfig as CEngineConfig,
} from '../services/consistencyEngine';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

type PipelineStep = 
  | 'idle'
  | 'script_parsing'
  | 'scene_breakdown'
  | 'image_generation'
  | 'video_generation'
  | 'stitching'
  | 'completed'
  | 'error';

interface StepStatus {
  step: PipelineStep;
  label: string;
  icon: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  detail?: string;
  progress?: number; // 0-100
}

interface GeneratedAsset {
  scene_number: number;
  image_url?: string;
  video_url?: string;
  status: 'pending' | 'generating' | 'done' | 'error';
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// Pipeline steps definition
// ═══════════════════════════════════════════════════════════════

const STEP_DEFS: Array<{ step: PipelineStep; label: string; icon: string }> = [
  { step: 'script_parsing', label: 'stepScriptParsing', icon: '📝' },
  { step: 'scene_breakdown', label: 'stepSceneBreakdown', icon: '📋' },
  { step: 'image_generation', label: 'stepImageGeneration', icon: '🎨' },
  { step: 'video_generation', label: 'stepVideoGeneration', icon: '🎬' },
  { step: 'stitching', label: 'stepStitching', icon: '🔗' },
  { step: 'completed', label: 'stepCompleted', icon: '✅' },
];

// Video model key mapping: settings key → version key the backend expects
const VIDEO_MODEL_MAP: Record<string, string> = {
  'wan': 'wan_2_2_fast',
  'wan_2_2_fast': 'wan_2_2_fast',
  'kling': 'kling_2_5_pro',
  'kling_2_5_pro': 'kling_2_5_pro',
  'veo_3': 'veo_3',
  'seedance_pro': 'seedance_pro',
  'sora_2': 'sora_2',
};

// ═══════════════════════════════════════════════════════════════
// FinalFilmPlayer — handles both single merged video and playlist
// ═══════════════════════════════════════════════════════════════

const FinalFilmPlayer: React.FC<{
  singleUrl: string | null;
  playlistUrls: string[];
  lang: string;
  onReset: () => void;
}> = ({ singleUrl, playlistUrls, lang, onReset }) => {
  const { t: _t } = { t };
  const [playlistIdx, setPlaylistIdx] = React.useState(0);
  const [isDownloadingAll, setIsDownloadingAll] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  // Decide which URLs to use
  const urls = singleUrl ? [singleUrl] : playlistUrls;
  const isPlaylist = !singleUrl && playlistUrls.length > 1;
  const currentUrl = urls[playlistIdx] || '';

  const handleEnded = () => {
    if (playlistIdx < urls.length - 1) {
      setPlaylistIdx(i => i + 1);
    }
  };

  // When playlist index changes, force reload
  React.useEffect(() => {
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  }, [playlistIdx]);

  const downloadAll = async () => {
    setIsDownloadingAll(true);
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = `scene-${i + 1}.mp4`;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Small delay between downloads so browser doesn't block them
        await new Promise(r => setTimeout(r, 600));
      } catch (_) {}
    }
    setIsDownloadingAll(false);
  };

  return (
    <div className="bg-white/3 border border-white/5 rounded-2xl p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white/80">🎬 {t(lang as any, 'finalFilm')}</h2>
        {isPlaylist && (
          <span className="text-xs text-white/40 font-mono">
            {playlistIdx + 1} / {urls.length}
          </span>
        )}
      </div>

      {/* Video player */}
      <div className="aspect-video rounded-xl overflow-hidden bg-black border border-white/10 relative">
        <video
          ref={videoRef}
          src={currentUrl}
          controls
          autoPlay
          className="w-full h-full"
          onEnded={handleEnded}
        />
        {/* Playlist nav overlay (bottom bar) */}
        {isPlaylist && urls.length > 1 && (
          <div className="absolute bottom-0 left-0 right-0 flex gap-1 p-2 bg-gradient-to-t from-black/70 to-transparent">
            {urls.map((_, i) => (
              <button
                key={i}
                onClick={() => setPlaylistIdx(i)}
                className={`h-1 flex-1 rounded-full transition-all ${i === playlistIdx ? 'bg-white' : 'bg-white/30 hover:bg-white/60'}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Playlist thumbnails (if multiple) */}
      {isPlaylist && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {urls.map((url, i) => (
            <button
              key={i}
              onClick={() => setPlaylistIdx(i)}
              className={`flex-shrink-0 w-16 h-10 rounded-lg border-2 transition-all flex items-center justify-center text-xs font-bold ${
                i === playlistIdx
                  ? 'border-white/70 bg-white/20 text-white'
                  : 'border-white/10 bg-white/5 text-white/40 hover:border-white/40'
              }`}
            >
              S{i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        {/* Single video: direct download. Playlist: download all */}
        {!isPlaylist ? (
          <a
            href={currentUrl}
            download={`film.mp4`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-3 bg-gradient-to-r from-green-600 to-emerald-600 rounded-xl text-center text-white font-bold hover:from-green-500 hover:to-emerald-500 transition-all"
          >
            ⬇️ {t(lang as any, 'downloadVideo')}
          </a>
        ) : (
          <button
            onClick={downloadAll}
            disabled={isDownloadingAll}
            className="flex-1 py-3 bg-gradient-to-r from-green-600 to-emerald-600 rounded-xl text-center text-white font-bold hover:from-green-500 hover:to-emerald-500 transition-all disabled:opacity-50"
          >
            {isDownloadingAll
              ? `⏳ Downloading... (${urls.length} clips)`
              : `⬇️ Download All ${urls.length} Clips`}
          </button>
        )}
        <button
          onClick={onReset}
          className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl text-white/60 font-bold hover:bg-white/10 transition-all"
        >
          {t(lang as any, 'doAgain')}
        </button>
      </div>

      {isPlaylist && (
        <p className="text-xs text-white/30 text-center">
          {urls.length} clips auto-play in sequence · click scene bar to jump · Download All saves each clip separately
        </p>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════

interface Props {
  onBack: () => void;
}

const OneClickDirector: React.FC<Props> = ({ onBack }) => {
  const { settings, hasEnoughCredits, openPricingModal, refreshBalance } = useAppContext();

  // Input state
  const [scriptInput, setScriptInput] = useState('');
  const [sceneCount, setSceneCount] = useState(4);
  const [visualStyle, setVisualStyle] = useState('cinematic');

  // Pipeline state
  const [currentStep, setCurrentStep] = useState<PipelineStep>('idle');
  const [steps, setSteps] = useState<StepStatus[]>(
    STEP_DEFS.map(d => ({ ...d, status: 'pending' as const }))
  );
  const [project, setProject] = useState<StoryboardProject | null>(null);
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [finalVideoUrls, setFinalVideoUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef(false);
  const currentStepRef = useRef<PipelineStep>('idle');

  // Style presets
  const STYLE_PRESETS = [
    { id: 'cinematic', label: 'Cinematic', emoji: '🎥' },
    { id: 'anime', label: 'Anime', emoji: '🌸' },
    { id: 'pixar', label: 'Pixar 3D', emoji: '🧸' },
    { id: 'noir', label: 'Film Noir', emoji: '🌑' },
    { id: 'watercolor', label: 'Watercolor', emoji: '🎨' },
    { id: 'cyberpunk', label: 'Cyberpunk', emoji: '🤖' },
  ];

  // ─── Step status management ────────────────────────────────
  const updateStep = useCallback((step: PipelineStep, update: Partial<StepStatus>) => {
    setSteps(prev => prev.map(s => 
      s.step === step ? { ...s, ...update } : s
    ));
  }, []);

  const activateStep = useCallback((step: PipelineStep, detail?: string) => {
    setCurrentStep(step);
    currentStepRef.current = step;
    setSteps(prev => prev.map(s => {
      if (s.step === step) return { ...s, status: 'active' as const, detail, progress: 0 };
      return s;
    }));
  }, []);

  const completeStep = useCallback((step: PipelineStep, detail?: string) => {
    setSteps(prev => prev.map(s => {
      if (s.step === step) return { ...s, status: 'completed' as const, detail, progress: 100 };
      return s;
    }));
  }, []);

  const failStep = useCallback((step: PipelineStep, error: string) => {
    setSteps(prev => prev.map(s => {
      if (s.step === step) return { ...s, status: 'error' as const, detail: error };
      return s;
    }));
  }, []);

  // ─── Auth helper ───────────────────────────────────────────
  const getAuthToken = async (): Promise<string> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error(t(settings.lang, 'errorLoginRequired'));
    return session.access_token;
  };

  // ─── Image generation for a single scene (REAL API contract) ───
  const generateImageForScene = async (
    scene: Scene,
    sceneIndex: number,
    token: string,
    storyData: StoryboardProject,
    previousImageUrl?: string,
  ): Promise<string> => {
    // Build consistency profile for this scene
    const consistencyConfig: CEngineConfig = {
      story_entities: storyData.story_entities,
      character_anchor: storyData.character_anchor,
      visual_style: visualStyle,
      reference_image_url: previousImageUrl,
    };

    const profile = buildConsistencyProfile(
      consistencyConfig,
      scene.scene_number || sceneIndex + 1,
      1, // shot 1
      scene,
    );

    // Compose prompt with consistency locks
    const basePrompt = scene.image_prompt || scene.visual_description;
    const enhancedPrompt = composeConsistentPrompt(basePrompt, profile);
    const consistencyParams = getConsistencyParams(profile);

    // Use correct API contract: imageModel, characterAnchor, storyEntities
    const imageModelKey = settings.imageModel || 'flux';
    
    const response = await fetch('/api/replicate/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        prompt: enhancedPrompt,
        imageModel: imageModelKey,
        aspectRatio: settings.aspectRatio || '16:9',
        visualStyle: visualStyle,
        characterAnchor: storyData.character_anchor || '',
        storyEntities: storyData.story_entities || [],
        referenceImageDataUrl: previousImageUrl || '',
        seed: consistencyParams.seed,
        negative_prompt: consistencyParams.negative_prompt,
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Image generation failed' }));
      throw new Error(err.error || `Image failed (${response.status})`);
    }

    const data = await response.json();
    const url = data.url || data.output;
    if (!url) throw new Error('Image generation returned no URL');
    return url;
  };

  // ─── Video generation for a single scene (REAL API contract) ───
  const generateVideoForScene = async (
    scene: Scene,
    imageUrl: string,
    token: string,
    storyData: StoryboardProject,
  ): Promise<string> => {
    // Map settings.videoModel to the version key backend expects
    const settingsModel = settings.videoModel || 'wan';
    const versionKey = VIDEO_MODEL_MAP[settingsModel] || 'wan_2_2_fast';

    // Build input object matching what /api/replicate/predict expects
    const prompt = scene.video_motion_prompt || scene.video_prompt || scene.visual_description || '';
    
    const input: Record<string, any> = {
      prompt: prompt,
      image: imageUrl,
      first_frame_image: imageUrl,
    };

    // Add duration if available
    if (settings.videoDuration) {
      input.duration = typeof settings.videoDuration === 'string' 
        ? parseInt(settings.videoDuration) 
        : settings.videoDuration;
    }

    const response = await fetch('/api/replicate/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        version: versionKey,
        input,
        storyEntities: storyData.story_entities || [],
        continuity: {
          project_context: {
            character_anchor: storyData.character_anchor || '',
            visual_style: visualStyle,
            story_entities: storyData.story_entities || [],
          },
        },
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Video generation failed' }));
      throw new Error(err.error || `Video failed (${response.status})`);
    }

    const prediction = await response.json();
    
    // If immediate result (sync models)
    if (prediction.output) {
      const output = prediction.output;
      return Array.isArray(output) ? output[0] : output;
    }

    // If async — poll for completion
    if (prediction.id) {
      return await pollPrediction(prediction.id, token);
    }

    // Replicate prediction response format
    if (prediction.urls?.get) {
      return await pollReplicateUrl(prediction.urls.get, token);
    }

    throw new Error('Video API returned no output or prediction ID');
  };

  // ─── Poll prediction status via /api/replicate/status/:id ─────
  const pollPrediction = async (predictionId: string, token: string): Promise<string> => {
    const maxAttempts = 120; // ~6 minutes
    for (let i = 0; i < maxAttempts; i++) {
      if (abortRef.current) throw new Error('Pipeline cancelled');
      
      await new Promise(r => setTimeout(r, 3000));
      
      const response = await fetch(`/api/replicate/status/${predictionId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (data.status === 'succeeded') {
        const output = data.output;
        if (!output) throw new Error('Video completed but returned no output');
        return Array.isArray(output) ? output[0] : output;
      }
      if (data.status === 'failed' || data.status === 'canceled') {
        throw new Error(data.error || data.logs?.substring(0, 200) || 'Video generation failed');
      }
    }
    throw new Error('Video generation timed out (6 minutes)');
  };

  // ─── Poll via direct Replicate webhook URL ─────────────────
  const pollReplicateUrl = async (getUrl: string, token: string): Promise<string> => {
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      if (abortRef.current) throw new Error('Pipeline cancelled');
      await new Promise(r => setTimeout(r, 3000));
      
      try {
        const response = await fetch(`/api/replicate/poll`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ url: getUrl })
        });
        if (!response.ok) continue;
        const data = await response.json();
        if (data.status === 'succeeded' && data.output) {
          return Array.isArray(data.output) ? data.output[0] : data.output;
        }
        if (data.status === 'failed' || data.status === 'canceled') {
          throw new Error(data.error || 'Failed');
        }
      } catch (err: any) {
        if (err.message === 'Pipeline cancelled') throw err;
        // Keep polling on network errors
      }
    }
    throw new Error('Video generation timed out');
  };

  // ═══════════════════════════════════════════════════════════════
  // MAIN PIPELINE
  // ═══════════════════════════════════════════════════════════════

  const runPipeline = async () => {
    if (!scriptInput.trim()) {
      setError(t(settings.lang, 'enterScript'));
      return;
    }

    if (!hasEnoughCredits(5)) {
      openPricingModal();
      return;
    }

    setIsRunning(true);
    setError(null);
    setFinalVideoUrl(null);
    setFinalVideoUrls([]);
    setAssets([]);
    abortRef.current = false;

    // Reset all steps
    setSteps(STEP_DEFS.map(d => ({ ...d, status: 'pending' as const })));

    try {
      const token = await getAuthToken();

      // ═══ STEP 1: Script Parsing ═══
      activateStep('script_parsing', t(settings.lang, 'parsingScript'));
      await new Promise(r => setTimeout(r, 500)); // Brief visual delay
      if (abortRef.current) throw new Error('Pipeline cancelled');
      completeStep('script_parsing', t(settings.lang, 'scriptParsed'));

      // ═══ STEP 2: Scene Breakdown ═══
      activateStep('scene_breakdown', t(settings.lang, 'breakingDownScenes'));
      
      const storyData = await generateStoryboard(
        scriptInput,
        visualStyle,
        settings.lang as Language,
        settings.generationMode || 'storyboard',
        undefined,
        sceneCount
      );
      
      setProject(storyData);
      
      if (!storyData.scenes || storyData.scenes.length === 0) {
        throw new Error(t(settings.lang, 'noValidScenes'));
      }

      completeStep('scene_breakdown', `${storyData.scenes.length} ${t(settings.lang, 'scenesReady')}`);
      if (abortRef.current) throw new Error('Pipeline cancelled');

      // ═══ STEP 3: Image Generation (with consistency chaining) ═══
      activateStep('image_generation', `${t(settings.lang, 'generatingImages')} ${storyData.scenes.length} ${t(settings.lang, 'scenes')}`);
      
      const sceneAssets: GeneratedAsset[] = storyData.scenes.map((s, i) => ({
        scene_number: s.scene_number || i + 1,
        status: 'pending' as const,
      }));
      setAssets(sceneAssets);

      let previousImageUrl: string | undefined = undefined;

      for (let i = 0; i < storyData.scenes.length; i++) {
        if (abortRef.current) throw new Error('Pipeline cancelled');
        
        const scene = storyData.scenes[i];
        sceneAssets[i] = { ...sceneAssets[i], status: 'generating' };
        setAssets([...sceneAssets]);
        updateStep('image_generation', {
          detail: `${t(settings.lang, 'generatingImage')} ${i + 1}/${storyData.scenes.length}`,
          progress: Math.round(((i) / storyData.scenes.length) * 100)
        });

        try {
          // ★ Chain: pass previous scene's image as reference for consistency
          const imageUrl = await generateImageForScene(scene, i, token, storyData, previousImageUrl);
          sceneAssets[i] = { ...sceneAssets[i], image_url: imageUrl, status: 'done' };
          storyData.scenes[i] = { ...scene, image_url: imageUrl };
          previousImageUrl = imageUrl; // Chain for next scene
        } catch (err: any) {
          sceneAssets[i] = { ...sceneAssets[i], status: 'error', error: err.message };
          console.error(`[OneClick] Image gen failed for scene ${i + 1}:`, err.message);
          // Don't break chain — keep using last successful image
        }

        setAssets([...sceneAssets]);
      }

      const successfulImages = sceneAssets.filter(a => a.image_url);
      if (successfulImages.length === 0) {
        throw new Error(t(settings.lang, 'allImagesFailed'));
      }

      completeStep('image_generation', `${successfulImages.length}/${storyData.scenes.length} ${t(settings.lang, 'imagesGenerated')}`);

      // ═══ STEP 4: Video Generation ═══
      activateStep('video_generation', `${t(settings.lang, 'generatingVideos')} ${successfulImages.length} ${t(settings.lang, 'scenes')}`);

      let videoCount = 0;
      for (let i = 0; i < sceneAssets.length; i++) {
        if (abortRef.current) throw new Error('Pipeline cancelled');
        if (!sceneAssets[i].image_url) continue; // Skip failed images

        videoCount++;
        sceneAssets[i] = { ...sceneAssets[i], status: 'generating' };
        setAssets([...sceneAssets]);
        updateStep('video_generation', {
          detail: `${t(settings.lang, 'generatingVideo')} ${videoCount}/${successfulImages.length}`,
          progress: Math.round(((videoCount - 1) / successfulImages.length) * 100)
        });

        try {
          const videoUrl = await generateVideoForScene(
            storyData.scenes[i],
            sceneAssets[i].image_url!,
            token,
            storyData,
          );
          sceneAssets[i] = { ...sceneAssets[i], video_url: videoUrl, status: 'done' };
          storyData.scenes[i] = { ...storyData.scenes[i], video_url: videoUrl };
        } catch (err: any) {
          sceneAssets[i] = { ...sceneAssets[i], status: 'error', error: err.message };
          console.error(`[OneClick] Video gen failed for scene ${i + 1}:`, err.message);
        }

        setAssets([...sceneAssets]);
      }

      const successfulVideos = sceneAssets.filter(a => a.video_url);
      if (successfulVideos.length === 0) {
        throw new Error(t(settings.lang, 'allVideosFailed'));
      }

      completeStep('video_generation', `${successfulVideos.length}/${successfulImages.length} ${t(settings.lang, 'videosGenerated')}`);

      // ═══ STEP 5: Stitch ═══
      activateStep('stitching', t(settings.lang, 'stitchingVideo'));

      const segments = successfulVideos.map(a => ({
        scene_number: a.scene_number,
        video_url: a.video_url!,
      }));

      // Store all video URLs for playlist fallback
      setFinalVideoUrls(segments.map(s => s.video_url));

      const stitchResponse = await fetch('/api/video/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          project_id: storyData.id || `oneclick_${Date.now()}`,
          segments,
        })
      });

      if (!stitchResponse.ok) {
        const err = await stitchResponse.json().catch(() => ({ error: 'Stitch failed' }));
        throw new Error(err.error || 'Video stitching failed');
      }

      const stitchResult = await stitchResponse.json();
      const finalUrl = stitchResult.output_url || stitchResult.video_urls?.[0];
      setFinalVideoUrl(finalUrl);

      completeStep('stitching', stitchResult.stitched
        ? `${t(settings.lang, 'stitchComplete')} (${stitchResult.total_duration_sec?.toFixed(0) || '?'}s)`
        : `${t(settings.lang, 'playlistMode')} — ${segments.length} ${t(settings.lang, 'segments')}`);

      // ═══ STEP 6: Done ═══
      setCurrentStep('completed');
      currentStepRef.current = 'completed';
      setSteps(prev => prev.map(s => 
        s.step === 'completed' ? { ...s, status: 'completed' as const, detail: t(settings.lang, 'pipelineComplete') } : s
      ));

      refreshBalance();

    } catch (err: any) {
      console.error('[OneClick] Pipeline error:', err);
      setError(err.message);
      failStep(currentStepRef.current, err.message);
      setCurrentStep('error');
    } finally {
      setIsRunning(false);
    }
  };

  const cancelPipeline = () => {
    abortRef.current = true;
  };

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      
      {/* Header Bar */}
      <div className="border-b border-white/5 bg-black/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <button
            onClick={onBack}
            className="text-white/50 hover:text-white flex items-center gap-2 transition-colors"
          >
            <span>←</span>
            <span className="text-sm">{settings.lang === 'zh' ? '返回' : 'Back'}</span>
          </button>
          <h1 className="text-lg font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
            {t(settings.lang, 'oneClickTitle')}
          </h1>
          <div className="w-16" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* ═══ INPUT SECTION ═══ */}
        {currentStep === 'idle' && (
          <div className="space-y-8 animate-in">
            
            {/* Script Input */}
            <div className="relative">
              <label className="block text-sm font-medium text-white/60 mb-2">{t(settings.lang, 'scriptInputLabel')}</label>
              <textarea
                value={scriptInput}
                onChange={e => setScriptInput(e.target.value)}
                placeholder={t(settings.lang, 'scriptPlaceholder')}
                className="w-full h-44 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white placeholder-white/25 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/40 transition-all text-base leading-relaxed"
              />
              <span className="absolute bottom-3 right-4 text-xs text-white/20">
                {scriptInput.length} {t(settings.lang, 'charCount')}
              </span>
            </div>

            {/* Controls Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Scene Count */}
              <div>
                <label className="block text-sm font-medium text-white/60 mb-2">{t(settings.lang, 'sceneCountLabel')}</label>
                <div className="flex gap-2">
                  {[2, 3, 4, 6, 8].map(n => (
                    <button
                      key={n}
                      onClick={() => setSceneCount(n)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                        sceneCount === n
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30'
                          : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white border border-white/5'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Style */}
              <div>
                <label className="block text-sm font-medium text-white/60 mb-2">{t(settings.lang, 'visualStyleLabel')}</label>
                <div className="flex flex-wrap gap-2">
                  {STYLE_PRESETS.map(style => (
                    <button
                      key={style.id}
                      onClick={() => setVisualStyle(style.id)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                        visualStyle === style.id
                          ? 'bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-lg shadow-violet-500/30'
                          : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white border border-white/5'
                      }`}
                    >
                      {style.emoji} {style.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Launch Button */}
            <button
              onClick={runPipeline}
              disabled={!scriptInput.trim()}
              className={`w-full py-4 rounded-2xl font-bold text-lg transition-all ${
                scriptInput.trim()
                  ? 'bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 hover:from-amber-400 hover:via-orange-400 hover:to-red-400 text-white shadow-2xl shadow-orange-500/30 hover:shadow-orange-500/50 active:scale-[0.99]'
                  : 'bg-white/5 text-white/20 cursor-not-allowed'
              }`}
            >
              {t(settings.lang, 'launchButton')}
            </button>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
                ❌ {error}
              </div>
            )}
          </div>
        )}

        {/* ═══ PIPELINE PROGRESS ═══ */}
        {currentStep !== 'idle' && (
          <div className="space-y-8 animate-in">
            
            {/* Pipeline Stepper */}
            <div className="bg-white/3 border border-white/5 rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-white/80">{t(settings.lang, 'pipelineTitle')}</h2>
                {isRunning && (
                  <button
                    onClick={cancelPipeline}
                    className="px-4 py-1.5 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-sm hover:bg-red-500/30 transition-all"
                  >
                    {t(settings.lang, 'cancelBtn')}
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {steps.map((step, idx) => (
                  <div
                    key={step.step}
                    className={`flex items-center gap-4 py-3 px-4 rounded-xl transition-all duration-500 ${
                      step.status === 'active' ? 'bg-amber-500/10 border border-amber-500/20' :
                      step.status === 'completed' ? 'bg-green-500/5 border border-green-500/10' :
                      step.status === 'error' ? 'bg-red-500/5 border border-red-500/10' :
                      'bg-white/2 border border-transparent'
                    }`}
                  >
                    {/* Step icon */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all ${
                      step.status === 'active' ? 'bg-amber-500/20 animate-pulse' :
                      step.status === 'completed' ? 'bg-green-500/20' :
                      step.status === 'error' ? 'bg-red-500/20' :
                      'bg-white/5'
                    }`}>
                      {step.status === 'completed' ? '✅' :
                       step.status === 'error' ? '❌' :
                       step.status === 'active' ? '⏳' :
                       step.icon}
                    </div>

                    {/* Step info */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold ${
                        step.status === 'active' ? 'text-amber-300' :
                        step.status === 'completed' ? 'text-green-400' :
                        step.status === 'error' ? 'text-red-400' :
                        'text-white/30'
                      }`}>
                        {t(settings.lang, step.label as any)}
                      </div>
                      {step.detail && (
                        <div className={`text-xs mt-0.5 ${
                          step.status === 'error' ? 'text-red-400/70' : 'text-white/40'
                        }`}>
                          {step.detail}
                        </div>
                      )}
                    </div>

                    {/* Progress bar */}
                    {step.status === 'active' && step.progress !== undefined && (
                      <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all duration-700"
                          style={{ width: `${step.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ═══ ASSET GRID ═══ */}
            {assets.length > 0 && (
              <div className="bg-white/3 border border-white/5 rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white/80 mb-4">{t(settings.lang, 'sceneAssets')}</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {assets.map((asset, idx) => (
                    <div
                      key={idx}
                      className={`relative aspect-video rounded-xl overflow-hidden border transition-all ${
                        asset.status === 'generating' ? 'border-amber-500/30 animate-pulse' :
                        asset.status === 'done' ? 'border-green-500/20' :
                        asset.status === 'error' ? 'border-red-500/20' :
                        'border-white/5'
                      }`}
                    >
                      {asset.video_url ? (
                        <video
                          src={asset.video_url}
                          className="w-full h-full object-cover"
                          muted
                          loop
                          playsInline
                          autoPlay
                        />
                      ) : asset.image_url ? (
                        <img
                          src={asset.image_url}
                          alt={`Scene ${asset.scene_number}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-white/5 flex items-center justify-center">
                          {asset.status === 'generating' ? (
                            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                          ) : asset.status === 'error' ? (
                            <span className="text-red-400 text-xs px-2 text-center">{asset.error?.substring(0, 40)}</span>
                          ) : (
                            <span className="text-white/20 text-xs">{t(settings.lang, 'waiting')}</span>
                          )}
                        </div>
                      )}
                      
                      {/* Scene number badge */}
                      <div className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-sm rounded-md px-1.5 py-0.5 text-[10px] text-white/70 font-mono">
                        S{asset.scene_number}
                      </div>

                      {/* Status indicator */}
                      {asset.status === 'done' && asset.video_url && (
                        <div className="absolute top-1.5 right-1.5 bg-green-500/80 rounded-md px-1.5 py-0.5 text-[10px] text-white font-bold">
                          🎬
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ FINAL VIDEO — single or playlist ═══ */}
            {(finalVideoUrl || finalVideoUrls.length > 0) && (
              <FinalFilmPlayer
                singleUrl={finalVideoUrl}
                playlistUrls={finalVideoUrls}
                lang={settings.lang}
                onReset={() => {
                  setCurrentStep('idle');
                  setSteps(STEP_DEFS.map(d => ({ ...d, status: 'pending' as const })));
                  setAssets([]);
                  setFinalVideoUrl(null);
                  setFinalVideoUrls([]);
                  setProject(null);
                }}
              />
            )}

            {/* Error display */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-3">
                <div className="text-red-400 text-sm">❌ {error}</div>
                <button
                  onClick={() => {
                    setCurrentStep('idle');
                    setError(null);
                    setSteps(STEP_DEFS.map(d => ({ ...d, status: 'pending' as const })));
                  }}
                  className="px-4 py-2 bg-red-500/20 rounded-lg text-red-300 text-sm hover:bg-red-500/30 transition-all"
                >
                  {t(settings.lang, 'startOver')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OneClickDirector;
