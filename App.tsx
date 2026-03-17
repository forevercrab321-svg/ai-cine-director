import React, { useState, useEffect, useRef } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { generateStoryboard, analyzeImageForAnchor } from './services/geminiService';
import { saveStoryboard } from './services/storyboardService';
import { StoryboardProject } from './types';
import Header from './components/Header';
import SettingsModal from './components/SettingsModal';
import PricingModal from './components/PricingModal';
import LandingPage from './components/LandingPage';
import VideoGenerator from './components/VideoGenerator';
import ShotListView from './components/ShotListView';
import AuthPage from './components/AuthPage';
import ReferenceImageUploader from './components/ReferenceImageUploader';
import CastPhotoGenerator from './components/CastPhotoGenerator';
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
    hasEnoughCredits,
    refreshBalance
  } = useAppContext();

  const [workflowStage, setWorkflowStageRaw] = useState<'input' | 'scripting' | 'shots' | 'production'>('input');
  const workflowStageRef = useRef(workflowStage);
  const [storyIdea, setStoryIdea] = useState('A cyberpunk cat delivering pizza in Neo-Tokyo');
  const [project, setProject] = useState<StoryboardProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extractedAnchor, setExtractedAnchor] = useState<string>("");
  const [referenceImagePreview, setReferenceImagePreview] = useState<string | null>(null);
  const [referenceImageDataUrl, setReferenceImageDataUrl] = useState<string>('');  // ★ Compressed base64 for Flux Redux
  const [sceneCount, setSceneCount] = useState<number>(5);
  const [shotCount, setShotCount] = useState<number>(5); // ★ 新增：镜头数量快速选择

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [paymentNotification, setPaymentNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // ★ Browser history management — pressing back navigates within workflow
  const setWorkflowStage = (stage: 'input' | 'scripting' | 'shots' | 'production') => {
    setWorkflowStageRaw(stage);
    workflowStageRef.current = stage;
    window.history.pushState({ stage }, '', `#${stage}`);
  };

  useEffect(() => {
    // Set initial history state
    window.history.replaceState({ stage: 'input' }, '', `#input`);

    const handlePopState = (e: PopStateEvent) => {
      const stage = e.state?.stage;
      if (stage && ['input', 'scripting', 'shots', 'production'].includes(stage)) {
        setWorkflowStageRaw(stage);
        workflowStageRef.current = stage;
      } else {
        // No valid state — stay where we are, re-push current stage
        const current = workflowStageRef.current;
        window.history.pushState({ stage: current }, '', `#${current}`);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // ★ Stripe Payment Success Callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Handle multiple parameter formats:
    // - Stripe default: success=true, canceled=true
    // - API custom: payment=success, subscription=success, subscription=cancelled
    const isSuccess = params.get('success') === 'true' ||
      params.get('payment') === 'success' ||
      params.get('subscription') === 'success';
    const isCanceled = params.get('canceled') === 'true' ||
      params.get('subscription') === 'cancelled' ||
      params.get('payment') === 'cancelled';

    if (isSuccess) {
      window.history.replaceState({ stage: 'input' }, '', window.location.pathname + '#input');
      // Credits are added by backend webhook (add_credits RPC).
      // Force refresh balance to reflect new credits immediately
      setTimeout(async () => {
        await refreshBalance().catch(() => { });
        setPaymentNotification({ type: 'success', msg: '✅ 支付成功！额度已添加到您的账户。' });
        setTimeout(() => setPaymentNotification(null), 6000);
      }, 1500); // Wait a bit for webhook to process
    }
    if (isCanceled) {
      window.history.replaceState({ stage: 'input' }, '', window.location.pathname + '#input');
      setPaymentNotification({ type: 'error', msg: '❌ 支付已取消' });
      setTimeout(() => setPaymentNotification(null), 4000);
    }
  }, [refreshBalance]);

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
      console.log(`[App] Generating with extractedAnchor: "${extractedAnchor?.substring(0, 80) || 'EMPTY'}..." (length: ${extractedAnchor?.length || 0})`);
      const data = await generateStoryboard(storyIdea, settings.videoStyle, settings.lang, settings.generationMode, extractedAnchor, sceneCount);
      setProject(data);
      
      // ★ Auto-populate anchor from story entities if still empty
      if (!extractedAnchor && data.story_entities?.length > 0) {
        // Try to find the main locked character
        const mainCharacter = data.story_entities.find(e => e.type === 'character' && e.is_locked);
        if (mainCharacter?.description) {
          console.log(`[App] Auto-populated anchor from story_entities: "${mainCharacter.name}"`);
          setExtractedAnchor(mainCharacter.description);
        }
      } else if (!extractedAnchor && data.character_anchor) {
        // Fallback to character_anchor from Gemini
        console.log(`[App] Auto-populated anchor from character_anchor`);
        setExtractedAnchor(data.character_anchor);
      }
      
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

  const handleSceneSync = async (sceneIndex: number, field: string, value: any) => {
    if (!project || !profile?.id) return;
    const newScenes = [...project.scenes];
    if (newScenes[sceneIndex]) {
      newScenes[sceneIndex] = { ...newScenes[sceneIndex], [field]: value };
      const updatedProject = { ...project, scenes: newScenes };
      setProject(updatedProject);
      try {
        await saveStoryboard(profile.id, updatedProject);
      } catch (e) {
        console.error("Failed to sync storyboard to db", e);
      }
    }
  };

  const handleSetGlobalAnchor = (url: string) => {
    if (!referenceImageDataUrl) {
      console.log('🌟 [Master Anchor] Auto-locking first generated frame as 全片霸权一致性准星！');
      setReferenceImageDataUrl(url);
    }
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

  // Authentication flow:
  // 1. No session at all → Show LandingPage (marketing page)
  // 2. Has session but no profile → Show AuthPage (complete profile)
  // 3. Has session and profile → Show main app

  if (!isAuthenticated) {
    // Completely new user - show marketing landing page
    return (
      <>
        <PricingModal
          isOpen={isPricingOpen} onClose={closePricingModal}
          onUpgrade={() => { }}
        />
        <LandingPage
          lang={settings.lang}
          onGetStarted={() => {
            // Scroll to login section or show login modal
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          }}
          onOpenPricing={openPricingModal}
        />
      </>
    );
  }

  if (!profile) {
    // Has session but needs to complete profile
    return (
      <>
        <PricingModal
          isOpen={isPricingOpen} onClose={closePricingModal}
          onUpgrade={() => { }}
        />
        <AuthPage
          lang={settings.lang}
          onLogin={() => { }}
          onCompleteProfile={completeProfile}
          hasProfile={false}
        />
      </>
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
        voice={settings.voice} setVoice={v => updateSettings({ voice: v })}
        onEnableGodMode={enableGodMode}
      />

      <PricingModal
        isOpen={isPricingOpen} onClose={closePricingModal}
        onUpgrade={() => { }}
      />

      <div className="max-w-5xl mx-auto px-6 pt-12">
        {/* ★ Payment notification toast — replaces browser alert() */}
        {paymentNotification && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl text-sm font-semibold animate-in fade-in slide-in-from-top-2 duration-300 ${paymentNotification.type === 'success'
            ? 'bg-emerald-600 text-white border border-emerald-400/40'
            : 'bg-red-600 text-white border border-red-400/40'
            }`}>
            <span>{paymentNotification.msg}</span>
            <button onClick={() => setPaymentNotification(null)} className="ml-2 opacity-70 hover:opacity-100 text-lg leading-none">&times;</button>
          </div>
        )}
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
            <h2 className="text-xl font-bold text-white">{profile?.name || profile?.email || '导演'} <span className="text-slate-500 font-normal">| {profile?.role || 'Creator'}</span></h2>
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
              placeholder={t(settings.lang, 'storyPlaceholder') || "例如：一只赛博朋克猫在的未来城市送披萨..."}
            />

            {/* 场景数量选择 */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-3">📽️ 场景数量 / Number of Scenes</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">快速选择：</span>
                {[5, 10, 15, 20, 25, 30].map((count) => (
                  <button
                    key={count}
                    onClick={() => setSceneCount(count)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all border ${sceneCount === count
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                      }`}
                  >
                    {count} 场景
                  </button>
                ))}
                <span className="text-xs text-slate-500">(可选)</span>
              </div>
            </div>

            {/* ★ 镜头数量快速选择 */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-3">🎬 镜头数量 / Number of Shots</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">快速选择：</span>
                {[5, 10, 15, 20, 25, 30].map((count) => (
                  <button
                    key={count}
                    onClick={() => setShotCount(count)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all border ${shotCount === count
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                      }`}
                  >
                    {count} 镜头
                  </button>
                ))}
                <span className="text-xs text-slate-500">(可选)</span>
              </div>
            </div>

            {/* 参考图片上传 */}
            <div className="mb-6">
              <ReferenceImageUploader
                onAnchorGenerated={(anchor, preview) => {
                  setExtractedAnchor(anchor);
                  setReferenceImagePreview(preview);
                }}
                onImageDataUrl={(dataUrl) => setReferenceImageDataUrl(dataUrl)}
                currentAnchor={extractedAnchor}
              />
            </div>

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
                <button onClick={() => setWorkflowStage('shots')} className="px-6 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-white font-bold shadow-lg shadow-amber-500/20">
                  🎬 拆分镜头 &rarr;
                </button>
                <button onClick={handleGoToProduction} className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-bold shadow-lg shadow-green-500/20">
                  进入制片环节 &rarr;
                </button>
              </div>
            </div>

            {/* Cast Photo Generator Plugin */}
            <CastPhotoGenerator
              project={project}
              currentGlobalAnchor={referenceImageDataUrl}
              onSetGlobalAnchor={handleSetGlobalAnchor}
              autoGenerate={true}
            />

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
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">🎵 Audio</label>
                      <input
                        value={scene.audio_description}
                        onChange={(e) => handleScriptUpdate(i, 'audio_description', e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-sm focus:border-indigo-500 outline-none"
                        placeholder="背景音乐/环境音效描述"
                      />
                      {/* 智能对话系统 */}
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={scene.dialogue_speaker || ''}
                          onChange={(e) => handleScriptUpdate(i, 'dialogue_speaker', e.target.value)}
                          className="bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:border-indigo-500 outline-none"
                          placeholder="说话者"
                        />
                        <input
                          value={scene.dialogue_text || ''}
                          onChange={(e) => handleScriptUpdate(i, 'dialogue_text', e.target.value)}
                          className="bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:border-indigo-500 outline-none"
                          placeholder="对话文本"
                        />
                      </div>
                      <input
                        value={scene.voice_characteristics || ''}
                        onChange={(e) => handleScriptUpdate(i, 'voice_characteristics', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:border-indigo-500 outline-none"
                        placeholder="声音特征 (AI自动匹配)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {workflowStage === 'shots' && project && (
          <ShotListView
            project={project}
            referenceImageDataUrl={referenceImageDataUrl}
            shotCount={shotCount}
            onBack={() => setWorkflowStage('scripting')}
            onUpdateScene={handleSceneSync}
            onSetGlobalAnchor={handleSetGlobalAnchor}
          />
        )}

        {workflowStage === 'production' && project && (
          <VideoGenerator
            project={project}
            referenceImageDataUrl={referenceImageDataUrl}
            onBackToScript={() => setWorkflowStage('scripting')}
            onUpdateScene={handleSceneSync}
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