import React, { useState, useEffect } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { generateStoryboard, analyzeImageForAnchor } from './services/geminiService';
import { saveStoryboard } from './services/storyboardService';
import { StoryboardProject } from './types';
import Header from './components/Header';
import SettingsModal from './components/SettingsModal';
import PricingModal from './components/PricingModal';
import VideoGenerator from './components/VideoGenerator';
import AuthPage from './components/AuthPage';
import { LoaderIcon } from './components/IconComponents';
import { t } from './i18n';

const MainLayout: React.FC = () => {
  const {
    settings,
    userState,
    isAuthenticated,
    profile,
    login,
    completeProfile,
    logout,
    toggleLang,
    updateSettings,
    upgradeUser,
    enableGodMode,
    isPricingOpen,
    openPricingModal,
    closePricingModal,
    hasEnoughCredits
  } = useAppContext();

  const [workflowStage, setWorkflowStage] = useState<'input' | 'scripting' | 'production'>('input');
  const [storyIdea, setStoryIdea] = useState('A cyberpunk cat delivering pizza in Neo-Tokyo');
  const [project, setProject] = useState<StoryboardProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedAnchor, setExtractedAnchor] = useState<string>("");

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // const [isPricingOpen, setIsPricingOpen] = useState(false); // Moved to Context

  // ★ Stripe Payment Success Callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true') {
      // Clean URL to remove query params
      window.history.replaceState({}, '', window.location.pathname);
      // Credits are added by backend webhook (add_credits RPC).
      // The profile will auto-refresh via Supabase auth listener.
      // Show confirmation to user.
      setTimeout(() => {
        alert('✅ 支付成功！额度已添加到您的账户。');
      }, 500);
    }
    if (params.get('canceled') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleGenerateScript = async () => {
    if (!storyIdea.trim()) return;

    // ★ Credit Guard: Storyboard generation costs 1 credit (or adjust as needed)
    const STORYBOARD_COST = 1;
    if (!hasEnoughCredits(STORYBOARD_COST)) {
      openPricingModal();
      return;
    }

    setLoading(true);
    setError(null);
    setProject(null);

    try {
      const data = await generateStoryboard(storyIdea, settings.videoStyle, settings.lang, settings.generationMode, extractedAnchor);
      setProject(data);
      setWorkflowStage('scripting');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScriptUpdate = (index: number, field: any, value: string) => {
    if (!project) return;
    const newScenes = [...project.scenes];
    newScenes[index] = { ...newScenes[index], [field]: value };
    setProject({ ...project, scenes: newScenes });
  };

  const handleGoToProduction = async () => {
    if (!project) return;

    if (!profile?.id) {
      alert("请登入以保存项目。");
      return;
    }

    // Save to Supabase
    // We don't block UI for saving, but maybe show a toast or small indicator if needed
    // For now, fire and forget or simple await
    try {
      await saveStoryboard(profile.id, project);
    } catch (e) {
      console.error("Failed to save storyboard", e);
    }

    setWorkflowStage('production');
  };

  // Auth & Profile Guard
  if (!isAuthenticated || !profile) {
    return (
      <AuthPage
        lang={settings.lang}
        onLogin={login}
        onCompleteProfile={completeProfile}
        hasProfile={!!profile}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-20 font-sans">
      <SettingsModal
        isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)}
        lang={settings.lang}
        imageModel={settings.imageModel} setImageModel={m => updateSettings({ imageModel: m })}
        videoModel={settings.videoModel} setVideoModel={m => updateSettings({ videoModel: m })}
        videoStyle={settings.videoStyle} setVideoStyle={s => updateSettings({ videoStyle: s })}
        aspectRatio={settings.aspectRatio} setAspectRatio={r => updateSettings({ aspectRatio: r })}
        videoQuality={settings.videoQuality} setVideoQuality={q => updateSettings({ videoQuality: q })}
        videoDuration={settings.videoDuration} setVideoDuration={d => updateSettings({ videoDuration: d })}
        videoFps={settings.videoFps} setVideoFps={f => updateSettings({ videoFps: f })}
        videoResolution={settings.videoResolution} setVideoResolution={r => updateSettings({ videoResolution: r })}
        onEnableGodMode={enableGodMode}
      />

      <PricingModal
        isOpen={isPricingOpen} onClose={closePricingModal}
        onUpgrade={() => { }}
      />

      <div className="max-w-5xl mx-auto px-6 pt-12">
        <Header
          lang={settings.lang}
          toggleLang={toggleLang}
          onOpenSettings={() => setIsSettingsOpen(true)}
          userState={userState}
          onUpgrade={openPricingModal}
          onLogout={logout}
        />

        <div className="mb-8 flex items-center justify-between animate-in fade-in duration-700">
          <div>
            <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest">{t(settings.lang, 'welcomeBack')}</p>
            <h2 className="text-xl font-bold text-white">{profile.name} <span className="text-slate-500 font-normal">| {profile.role}</span></h2>
          </div>
        </div>

        {workflowStage === 'input' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl animate-in fade-in zoom-in-95 duration-300">
            <div className="mb-6 flex justify-between items-center">
              <label className="text-sm font-semibold text-slate-300">{t(settings.lang, 'storyConcept')}</label>
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-700">
                <button onClick={() => updateSettings({ generationMode: 'storyboard' })} className={`px-3 py-1 text-xs rounded ${settings.generationMode === 'storyboard' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Storyboard</button>
                <button onClick={() => updateSettings({ generationMode: 'story' })} className={`px-3 py-1 text-xs rounded ${settings.generationMode === 'story' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>Story Mode</button>
              </div>
            </div>

            <textarea
              value={storyIdea}
              onChange={e => setStoryIdea(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-4 h-32 text-white mb-6 focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder={t(settings.lang, 'storyPlaceholder')}
            />

            <button
              onClick={handleGenerateScript}
              disabled={loading}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-bold transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2"
            >
              {loading ? <LoaderIcon className="w-5 h-5 text-white" /> : t(settings.lang, 'generateButton')}
            </button>

            {error && <div className="mt-4 text-red-400 text-sm bg-red-900/20 p-3 rounded border border-red-500/20">{error}</div>}
          </div>
        )}

        {workflowStage === 'scripting' && project && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-white">{t(settings.lang, 'writersRoom')}</h2>
              <div className="flex gap-3">
                <button onClick={() => setWorkflowStage('input')} className="text-slate-400 hover:text-white px-4 py-2 text-sm">{t(settings.lang, 'backToConcept')}</button>
                <button onClick={handleGoToProduction} className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-bold shadow-lg shadow-green-500/20">
                  进入制片环节 &rarr;
                </button>
              </div>
            </div>

            {project.scenes.map((scene, i) => (
              <div key={i} className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                <div className="flex justify-between mb-2">
                  <span className="font-bold text-indigo-400 text-sm uppercase tracking-wide">Scene {scene.scene_number}</span>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Visual</label>
                    <textarea
                      value={scene.visual_description}
                      onChange={(e) => handleScriptUpdate(i, 'visual_description', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-sm h-24 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Shot / Camera</label>
                    <input
                      value={scene.shot_type}
                      onChange={(e) => handleScriptUpdate(i, 'shot_type', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-sm focus:border-indigo-500 outline-none mb-4"
                    />
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Audio</label>
                    <input
                      value={scene.audio_description}
                      onChange={(e) => handleScriptUpdate(i, 'audio_description', e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-sm focus:border-indigo-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {workflowStage === 'production' && project && (
          <VideoGenerator
            project={project}
            onBackToScript={() => setWorkflowStage('scripting')}
          />
        )}
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
};

export default App;