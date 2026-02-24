
import React, { useState, useEffect } from 'react';
import { Language, ImageModel, VideoModel, VideoStyle, AspectRatio, VideoQuality, VideoDuration, VideoFps, VideoResolution, MODEL_COSTS, MODEL_MULTIPLIERS, MODEL_METADATA, STYLE_PRESETS } from '../types';
import { useAppContext } from '../context/AppContext';
import { t } from '../i18n';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  imageModel: ImageModel;
  setImageModel: (m: ImageModel) => void;
  videoModel: VideoModel;
  setVideoModel: (m: VideoModel) => void;
  videoStyle: VideoStyle;
  setVideoStyle: (s: VideoStyle) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (ar: AspectRatio) => void;

  // New Specs
  videoQuality: VideoQuality;
  setVideoQuality: (q: VideoQuality) => void;
  videoDuration: VideoDuration;
  setVideoDuration: (d: VideoDuration) => void;
  videoFps: VideoFps;
  setVideoFps: (f: VideoFps) => void;
  videoResolution: VideoResolution;
  setVideoResolution: (r: VideoResolution) => void;

  // God Mode Injection
  onEnableGodMode: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  lang,
  imageModel,
  setImageModel,
  videoModel,
  setVideoModel,
  videoStyle,
  setVideoStyle,
  aspectRatio,
  setAspectRatio,
  videoQuality,
  setVideoQuality,
  videoDuration,
  setVideoDuration,
  videoFps,
  setVideoFps,
  videoResolution,
  setVideoResolution,
  onEnableGodMode
}) => {
  const { settings, updateSettings } = useAppContext();

  const [backendUrl, setBackendUrl] = useState(settings.backendUrl || '');
  const [useMockMode, setUseMockMode] = useState(settings.useMockMode);

  const [clickCount, setClickCount] = useState(0);
  const [showAdminInput, setShowAdminInput] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminError, setIsAdminError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setBackendUrl(settings.backendUrl);
      setUseMockMode(settings.useMockMode);
    } else {
      setClickCount(0);
      setShowAdminInput(false);
      setAdminPassword('');
      setIsAdminError(false);
    }
  }, [isOpen, settings]);

  const handleSave = () => {
    updateSettings({ backendUrl, useMockMode });
    onClose();
  };

  const handleVersionClick = () => {
    const newCount = clickCount + 1;
    setClickCount(newCount);
    if (newCount === 5) {
      setShowAdminInput(true);
    }
  };

  const submitAdminAuth = () => {
    if (adminPassword === 'admin2026') {
      onEnableGodMode();
      alert(t(lang, 'godModeActivated'));
      onClose();
    } else {
      setIsAdminError(true);
      setTimeout(() => setIsAdminError(false), 500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      submitAdminAuth();
    }
  };

  const groupedPresets = STYLE_PRESETS.reduce((acc, preset) => {
    if (!acc[preset.category]) acc[preset.category] = [];
    acc[preset.category].push(preset);
    return acc;
  }, {} as Record<string, typeof STYLE_PRESETS>);

  const getModelLabel = (modelId: VideoModel) => {
    const key = `model_${modelId}` as any;
    const trans = t(lang, key);
    if (trans === key) return MODEL_METADATA[modelId].label;
    return trans;
  };

  const getCategoryLabel = (category: string) => {
    if (category.includes("Chinese")) return t(lang, 'cat_chinese');
    if (category.includes("Cinema")) return t(lang, 'cat_cinema');
    if (category.includes("Anime")) return t(lang, 'cat_anime');
    return category;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">{t(lang, 'proSettings')}</h2>
          <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded border border-indigo-500/30">
            {t(lang, 'highValue')}
          </span>
        </div>

        {/* BACKEND CONFIGURATION SECTION */}
        <div className="mb-6 p-4 bg-slate-950 rounded-lg border border-slate-800 space-y-4">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">System Configuration</h3>

          {/* Mock Mode Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-semibold text-white block">Demo / Mock Mode</label>
              <p className="text-[10px] text-slate-500">Simulate backend APIs (Free, Fast, No Setup)</p>
            </div>
            <button
              onClick={() => setUseMockMode(!useMockMode)}
              className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ${useMockMode ? 'bg-green-500' : 'bg-slate-700'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform duration-300 ${useMockMode ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Backend URL Input */}
          <div className={`transition-all duration-300 ${useMockMode ? 'opacity-50 pointer-events-none grayscale' : 'opacity-100'}`}>
            <label className="block text-xs font-bold text-slate-400 mb-2">
              Backend API URL (Anigravity/External)
            </label>
            <input
              type="text"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://api.your-backend.com"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none placeholder-slate-700"
            />
          </div>
        </div>

        <div className="h-px bg-slate-800 mb-6" />

        <div className="space-y-5">
          {/* Image Model Selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">
              {t(lang, 'imageEngine')}
            </label>
            <select
              value={imageModel}
              onChange={(e) => setImageModel(e.target.value as ImageModel)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
            >
              <option value="flux">Flux 1.1 Pro ({t(lang, 'qualityPro')})</option>
              <option value="flux_schnell">Flux Schnell ({t(lang, 'qualityDraft')})</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Video Model Selector - TOP 5 BEST VALUE I2V MODELS */}
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-slate-200 mb-2">
                {t(lang, 'videoEngine')}
              </label>
              <select
                value={videoModel}
                onChange={(e) => setVideoModel(e.target.value as VideoModel)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none appearance-none font-mono text-sm"
              >
                {/* Budget Tier */}
                <optgroup label="💰 Budget (极速出片)">
                  <option value="wan_2_2_fast">
                    {getModelLabel('wan_2_2_fast')} (💎 {Math.ceil(MODEL_COSTS.wan_2_2_fast * (MODEL_MULTIPLIERS.wan_2_2_fast || 1))})
                  </option>
                  <option value="hailuo_02_fast">
                    {getModelLabel('hailuo_02_fast')} (💎 {Math.ceil(MODEL_COSTS.hailuo_02_fast * (MODEL_MULTIPLIERS.hailuo_02_fast || 1))})
                  </option>
                </optgroup>

                {/* Standard Tier */}
                <optgroup label="⭐ Standard (均衡之选)">
                  <option value="seedance_lite">
                    {getModelLabel('seedance_lite')} (💎 {Math.ceil(MODEL_COSTS.seedance_lite * (MODEL_MULTIPLIERS.seedance_lite || 1))})
                  </option>
                </optgroup>

                {/* Pro Tier */}
                <optgroup label="🔥 Pro (顶级画质)">
                  <option value="kling_2_5">
                    {getModelLabel('kling_2_5')} (💎 {Math.ceil(MODEL_COSTS.kling_2_5 * (MODEL_MULTIPLIERS.kling_2_5 || 1))})
                  </option>
                  <option value="hailuo_live">
                    {getModelLabel('hailuo_live')} (💎 {Math.ceil(MODEL_COSTS.hailuo_live * (MODEL_MULTIPLIERS.hailuo_live || 1))})
                  </option>
                </optgroup>
              </select>

              {/* Display Badges */}
              <div className="mt-2 flex flex-wrap gap-2">
                {MODEL_METADATA[videoModel].badge && (
                  <span className={`text-[10px] px-2 py-1 rounded font-bold border
                      ${videoModel === 'wan_2_2_fast' ? 'bg-green-500/10 text-green-400 border-green-500/20' : ''}
                      ${videoModel === 'hailuo_02_fast' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' : ''}
                      ${videoModel === 'kling_2_5' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : ''}
                      ${videoModel === 'hailuo_live' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : ''}
                    `}>
                    {MODEL_METADATA[videoModel].badge}
                  </span>
                )}
                {MODEL_METADATA[videoModel].tags.map(tag => (
                  <span key={tag} className="text-[10px] bg-slate-800 text-slate-400 px-2 py-1 rounded border border-slate-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Video Quality Preset */}
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-slate-200 mb-2">
                ✨ {t(lang, 'videoQuality')}
              </label>
              <select
                value={videoQuality}
                onChange={(e) => setVideoQuality(e.target.value as VideoQuality)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
              >
                <option value="draft">{t(lang, 'qualityDraft')}</option>
                <option value="standard">{t(lang, 'qualityStd')}</option>
                <option value="pro">{t(lang, 'qualityPro')}</option>
              </select>
            </div>
          </div>

          {/* Video Specs Section */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-3">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t(lang, 'videoSpecs')}</span>

            <div className="grid grid-cols-3 gap-3">
              {/* Duration */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">{t(lang, 'duration')}</label>
                <select
                  value={videoDuration}
                  onChange={(e) => setVideoDuration(Number(e.target.value) as VideoDuration)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                >
                  <option value={4}>4s</option>
                  <option value={6}>6s</option>
                  <option value={8}>8s</option>
                </select>
              </div>

              {/* FPS */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">{t(lang, 'fps')}</label>
                <select
                  value={videoFps}
                  onChange={(e) => setVideoFps(Number(e.target.value) as VideoFps)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                >
                  <option value={12}>12 fps</option>
                  <option value={24}>24 fps</option>
                </select>
              </div>

              {/* Resolution */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">{t(lang, 'resolution')}</label>
                <select
                  value={videoResolution}
                  onChange={(e) => setVideoResolution(e.target.value as VideoResolution)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
            </div>
          </div>

          {/* Aspect Ratio Selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">
              {t(lang, 'frameFormat')}
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
            >
              <option value="1:1">1:1 Square (Instagram)</option>
              <option value="3:4">3:4 Vertical</option>
              <option value="4:3">4:3 Landscape</option>
              <option value="9:16">9:16 Portrait (TikTok/Reels)</option>
              <option value="16:9">16:9 Landscape (YouTube/PC)</option>
            </select>
          </div>

          {/* Visual Style Preset */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">
              {t(lang, 'stylePreset')}
            </label>
            <div className="relative">
              <select
                value={videoStyle}
                onChange={(e) => setVideoStyle(e.target.value as VideoStyle)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
              >
                <option value="none">Default (Use Prompt As-Is)</option>
                {Object.keys(groupedPresets).map((category) => (
                  <optgroup key={category} label={getCategoryLabel(category)}>
                    {groupedPresets[category].map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-8 flex justify-between items-center gap-3">
          {/* HIDDEN BACKDOOR TRIGGER */}
          <div className="flex flex-col">
            <span
              onClick={handleVersionClick}
              className="text-[10px] text-slate-700 hover:text-slate-600 cursor-default select-none"
            >
              Version 3.1
            </span>
            {showAdminInput && (
              <div className="flex items-center gap-2 mt-2 animate-in fade-in slide-in-from-top-1">
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Admin Key"
                  autoFocus
                  className={`bg-transparent border-b text-xs w-28 outline-none placeholder-slate-700 transition-colors
                           ${isAdminError ? 'border-red-500 text-red-500' : 'border-indigo-500/50 text-indigo-400'}
                        `}
                />
                <button
                  onClick={submitAdminAuth}
                  className="text-[10px] bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded border border-indigo-500/20 transition-colors"
                >
                  {t(lang, 'adminUnlock')}
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              {t(lang, 'cancel')}
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/20"
            >
              {t(lang, 'save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
