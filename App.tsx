import React, { useState, useEffect, useRef } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { generateStoryboard, analyzeImageForAnchor } from './services/geminiService';
import { saveStoryboard } from './services/storyboardService';
import { StoryboardProject, PipelineStage, DirectorControls, DEFAULT_DIRECTOR_CONTROLS } from './types';
import Header from './components/Header';
import SettingsModal from './components/SettingsModal';
import PricingModal from './components/PricingModal';
import LandingPage from './components/LandingPage';
import VideoGenerator from './components/VideoGenerator';
import ShotListView from './components/ShotListView';
import AuthPage from './components/AuthPage';
import ReferenceImageUploader from './components/ReferenceImageUploader';
import CastPhotoGenerator from './components/CastPhotoGenerator';
import OneClickDirector from './components/OneClickDirector';
import DirectorControlsPanel from './components/DirectorControlsPanel';
import ProjectDashboard from './components/ProjectDashboard';
import ExportButton from './components/ExportButton';
import { LoaderIcon } from './components/IconComponents';
import DirectorBrainPanel from './components/DirectorBrainPanel';
import DirectorOSStatus from './components/DirectorOSStatus';
import ShotTimeline from './components/ShotTimeline';
import VerificationPanel from './components/VerificationPanel';
import FinalCutPanel from './components/FinalCutPanel';
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

  const [workflowStage, setWorkflowStageRaw] = useState<'dashboard' | 'input' | 'scripting' | 'shots' | 'production' | 'finalcut' | 'oneclick'>('dashboard');
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('script_ready');
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
  const [forceHasCast, setForceHasCast] = useState<boolean | undefined>(undefined);
  const [projectType, setProjectType] = useState<string>('');
  const [showAdvancedProjectSettings, setShowAdvancedProjectSettings] = useState<boolean>(false);
  const [directorControls, setDirectorControls] = useState<DirectorControls>(() => {
    try {
      const saved = localStorage.getItem('directorControls');
      return saved ? { ...DEFAULT_DIRECTOR_CONTROLS, ...JSON.parse(saved) } : DEFAULT_DIRECTOR_CONTROLS;
    } catch { return DEFAULT_DIRECTOR_CONTROLS; }
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [paymentNotification, setPaymentNotification] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // ★ Browser history management — pressing back navigates within workflow
  const setWorkflowStage = (stage: 'dashboard' | 'input' | 'scripting' | 'shots' | 'production' | 'finalcut' | 'oneclick') => {
    setWorkflowStageRaw(stage);
    workflowStageRef.current = stage;
    window.history.pushState({ stage }, '', `#${stage}`);
  };

  useEffect(() => {
    // Set initial history state
    window.history.replaceState({ stage: 'dashboard' }, '', `#dashboard`);

    const handlePopState = (e: PopStateEvent) => {
      const stage = e.state?.stage;
      if (stage && ['dashboard', 'input', 'scripting', 'shots', 'production', 'finalcut'].includes(stage)) {
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

  // ★ Safety guard: if a project-dependent stage is active but project is gone
  // (e.g. browser back/forward restored old hash after page reload), redirect to dashboard.
  useEffect(() => {
    const projectRequiredStages = ['scripting', 'shots', 'production', 'finalcut'];
    if (projectRequiredStages.includes(workflowStage) && !project) {
      setWorkflowStage('dashboard');
    }
  }, [workflowStage, project]);

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
        setPaymentNotification({ type: 'success', msg: '✅ Payment successful! Credits added to your account.' });
        setTimeout(() => setPaymentNotification(null), 6000);
      }, 1500); // Wait a bit for webhook to process
    }
    if (isCanceled) {
      window.history.replaceState({ stage: 'input' }, '', window.location.pathname + '#input');
      setPaymentNotification({ type: 'error', msg: '❌ Payment cancelled' });
      setTimeout(() => setPaymentNotification(null), 4000);
    }
  }, [refreshBalance]);

  const handleDirectorControlsChange = (updated: DirectorControls) => {
    setDirectorControls(updated);
    try { localStorage.setItem('directorControls', JSON.stringify(updated)); } catch { /* quota */ }
  };

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
      const data = await generateStoryboard(storyIdea, settings.videoStyle, settings.lang, settings.generationMode, extractedAnchor, sceneCount, forceHasCast, projectType, directorControls);
      setProject(data);
      setPipelineStage((data as any)?.pipeline_state?.current_stage || 'shots_ready');

      // ★ Auto-populate anchor from story entities if still empty
      if (!extractedAnchor && data.story_entities?.length > 0) {
        const mainCharacter = data.story_entities.find(e => e.type === 'character' && e.is_locked);
        if (mainCharacter?.description) {
          setExtractedAnchor(mainCharacter.description);
        }
      } else if (!extractedAnchor && data.character_anchor) {
        setExtractedAnchor(data.character_anchor);
      }

      // ★ Auto-save to Supabase immediately so the project appears in the dashboard
      // and survives a page refresh. Non-blocking — failure doesn't prevent scripting.
      if (profile?.id) {
        saveStoryboard(profile.id, data).then(saved => {
          if (saved && saved.id && saved.id !== data.id) {
            setProject(saved); // sync id if DB assigned a new one
          }
        }).catch(e => console.warn('[App] Auto-save failed:', e.message));
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
      alert(t(settings.lang, 'loginRequired'));
      return;
    }

    // Save to Supabase
    // We don't block UI for saving, but maybe show a toast or small indicator if needed
    // For now, fire and forget or simple await
    try {
      const saved = await saveStoryboard(profile.id, project);
      // Sync project state: if Supabase returned a different ID (shouldn't happen after our
      // storyboardService fix, but be defensive), update so pipeline APIs use the correct key.
      if (saved && saved.id && saved.id !== project.id) {
        setProject(saved);
      }
    } catch (e) {
      console.error("Failed to save storyboard", e);
    }

    setWorkflowStage('production');
    setPipelineStage('video_generating');
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
          onGetStarted={() => { /* handled inside LandingPage via setShowLogin */ }}
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

        {/* ★ Stage Navigation Pills */}
        {workflowStage !== 'oneclick' && (
          <div className="mb-6 flex items-center gap-1 overflow-x-auto pb-1">
            {(['dashboard', 'input', 'scripting', 'shots', 'production', 'finalcut'] as const).map((stage, idx) => {
              const labels: Record<string, string> = {
                dashboard: settings.lang === 'zh' ? '我的项目' : 'Projects',
                input: settings.lang === 'zh' ? '创意输入' : 'Concept',
                scripting: settings.lang === 'zh' ? '剧本' : 'Script',
                shots: settings.lang === 'zh' ? '分镜' : 'Shots',
                production: settings.lang === 'zh' ? '制作' : 'Production',
                finalcut: settings.lang === 'zh' ? '最终剪辑' : 'Final Cut',
              };
              const icons: Record<string, string> = { dashboard: '📂', input: '✍️', scripting: '📝', shots: '🎞️', production: '🎬', finalcut: '✂️' };
              const isActive = workflowStage === stage;
              const isReachable = stage === 'dashboard' || stage === 'input' ||
                (stage === 'scripting' && !!project) ||
                (stage === 'shots' && !!project) ||
                (stage === 'production' && !!project) ||
                (stage === 'finalcut' && !!project);

              return (
                <button
                  key={stage}
                  onClick={() => isReachable && setWorkflowStage(stage)}
                  disabled={!isReachable}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : isReachable
                        ? 'text-slate-400 hover:text-white hover:bg-slate-800'
                        : 'text-slate-700 cursor-not-allowed'
                  }`}
                >
                  <span>{icons[stage]}</span>
                  {labels[stage]}
                </button>
              );
            })}
          </div>
        )}

        <div className="mb-8 flex items-center justify-between animate-in fade-in duration-700">
          <div>
            <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest">{t(settings.lang, 'welcomeBack')}</p>
            <h2 className="text-xl font-bold text-white">{profile?.name || profile?.email || 'Director'} <span className="text-slate-500 font-normal">| {profile?.role || 'Creator'}</span></h2>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Pipeline</p>
            <p className={`text-[11px] font-bold px-2 py-0.5 rounded-full inline-block ${
              pipelineStage === 'final_ready' || pipelineStage === 'assembly_ready'
                ? 'bg-emerald-500/20 text-emerald-300'
                : pipelineStage === 'storyboard_approved'
                  ? 'bg-teal-500/20 text-teal-300'
                  : pipelineStage === 'storyboard_review'
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : pipelineStage === 'video_generating' || pipelineStage === 'storyboard_generating'
                      ? 'bg-amber-500/20 text-amber-300 animate-pulse'
                      : pipelineStage === 'storyboard_partial_failed' || pipelineStage === 'video_partial_failed'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-slate-700/50 text-slate-400'
            }`}>
              {{
                script_ready: t(settings.lang, 'stageScriptReady'),
                bible_ready: t(settings.lang, 'stageBibleReady'),
                shots_ready: t(settings.lang, 'stageShotsReady'),
                storyboard_generating: t(settings.lang, 'stageGenerating'),
                storyboard_review: t(settings.lang, 'stageReview'),
                storyboard_partial_failed: t(settings.lang, 'stagePartialFailed'),
                storyboard_approved: t(settings.lang, 'stageApproved'),
                video_generating: t(settings.lang, 'stageRendering'),
                video_partial_failed: t(settings.lang, 'stageRenderPartialFailed'),
                assembly_ready: t(settings.lang, 'stageAssemblyReady'),
                final_ready: t(settings.lang, 'stageFinalReady'),
              }[pipelineStage] ?? pipelineStage}
            </p>
          </div>
        </div>

        {/* ★ PROJECT DASHBOARD */}
        {workflowStage === 'dashboard' && profile?.id && (
          <div className="animate-in fade-in duration-300">
            <ProjectDashboard
              userId={profile.id}
              lang={settings.lang}
              onNewProject={() => setWorkflowStage('input')}
              onResumeProject={(loadedProject) => {
                setProject(loadedProject);
                setPipelineStage((loadedProject as any)?.pipeline_state?.current_stage || 'shots_ready');
                // Restore director controls from the saved project if available
                if (loadedProject.director_controls) {
                  setDirectorControls({ ...loadedProject.director_controls });
                }
                setWorkflowStage('scripting');
              }}
            />
          </div>
        )}

        {/* ★ ONE-CLICK DIRECTOR MODE */}
        {workflowStage === 'oneclick' && (
          <div className="fixed inset-0 z-40">
            <OneClickDirector onBack={() => setWorkflowStage('input')} />
          </div>
        )}

        {workflowStage === 'input' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl animate-in fade-in zoom-in-95 duration-300">
            {/* ★ One-Click Director Banner */}
            <button
              onClick={() => setWorkflowStage('oneclick')}
              className="w-full mb-6 p-4 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-red-500/10 border border-amber-500/20 rounded-xl hover:from-amber-500/20 hover:via-orange-500/20 hover:to-red-500/20 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="text-left">
                  <div className="text-sm font-bold text-amber-300 group-hover:text-amber-200 transition-colors">{t(settings.lang, 'oneClickBannerTitle')}</div>
                  <div className="text-xs text-white/40 mt-0.5">{t(settings.lang, 'oneClickBannerDesc')}</div>
                </div>
                <span className="text-amber-400/60 group-hover:text-amber-300 text-lg transition-colors">→</span>
              </div>
            </button>

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

            {/* 场景数量选择 */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-3">{t(settings.lang, 'sceneCountLabel2')}</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">{t(settings.lang, 'sceneCountQuickSelect')}</span>
                {[5, 10, 15, 20, 25, 30].map((count) => (
                  <button
                    key={count}
                    onClick={() => setSceneCount(count)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all border ${sceneCount === count
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                      }`}
                  >
                    {count}
                  </button>
                ))}
                <span className="text-xs text-slate-500">(optional)</span>
              </div>
            </div>

            {/* ★ 镜头数量快速选择 */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-300 mb-3">🎬 {settings.lang === 'zh' ? '镜头数量' : 'Number of Shots'}</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">{t(settings.lang, 'sceneCountQuickSelect')}</span>
                {[5, 10, 15, 20, 25, 30].map((count) => (
                  <button
                    key={count}
                    onClick={() => setShotCount(count)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all border ${shotCount === count
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500'
                      }`}
                  >
                    {count}
                  </button>
                ))}
                <span className="text-xs text-slate-500">(optional)</span>
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

            {/* 高级项目设置 / Advanced Project Settings */}
            <div className="mb-6">
              <button
                onClick={() => setShowAdvancedProjectSettings(!showAdvancedProjectSettings)}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
                type="button"
              >
                <span>{showAdvancedProjectSettings ? '▼' : '▶'}</span>
                <span>⚙️ {settings.lang === 'zh' ? '高级项目设定' : 'Advanced Project Settings'}</span>
              </button>

              {showAdvancedProjectSettings && (
                <div className="mt-4 p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{settings.lang === 'zh' ? '项目类型' : 'Project Type'}</label>
                    <select
                      value={projectType}
                      onChange={e => setProjectType(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-sm focus:border-indigo-500 outline-none"
                    >
                      <option value="">🔮 Auto Detect</option>
                      <option value="character_driven">👤 Character Driven</option>
                      <option value="environment_driven">🌄 Environment Driven</option>
                      <option value="destruction_driven">💥 Destruction Driven</option>
                      <option value="architecture_driven">🏙️ Architecture Driven</option>
                      <option value="object_driven">🚗 Object Driven</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{settings.lang === 'zh' ? '强制拥有主角' : 'Force Character Presence'}</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" checked={forceHasCast === undefined} onChange={() => setForceHasCast(undefined)} className="accent-indigo-500 w-4 h-4 cursor-pointer" />
                        <span className="text-slate-300">Auto</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" checked={forceHasCast === true} onChange={() => setForceHasCast(true)} className="accent-indigo-500 w-4 h-4 cursor-pointer" />
                        <span className="text-slate-300">Yes</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="radio" checked={forceHasCast === false} onChange={() => setForceHasCast(false)} className="accent-indigo-500 w-4 h-4 cursor-pointer" />
                        <span className="text-slate-300">No Cast</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ★ Director Controls Panel */}
            <div className="mb-6">
              <DirectorControlsPanel
                controls={directorControls}
                onChange={handleDirectorControlsChange}
                lang={settings.lang}
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

        {workflowStage === 'scripting' && !project && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 animate-in fade-in duration-300">
            <span className="text-4xl mb-4">📝</span>
            <p className="text-sm">{settings.lang === 'zh' ? '项目未加载，正在返回项目列表…' : 'No project loaded, returning to dashboard…'}</p>
          </div>
        )}

        {workflowStage === 'scripting' && project && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-white">{t(settings.lang, 'writersRoom')}</h2>
              <div className="flex gap-3 items-center">
                <ExportButton project={project} lang={settings.lang} />
                <button onClick={() => { setWorkflowStage('input'); setPipelineStage('script_ready'); }} className="text-slate-400 hover:text-white px-4 py-2 text-sm">{t(settings.lang, 'backToConcept')}</button>
                <button onClick={() => { setWorkflowStage('shots'); setPipelineStage('storyboard_generating'); }} className="px-6 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-white font-bold shadow-lg shadow-amber-500/20">
                  {t(settings.lang, 'splitShots')}
                </button>
                <button onClick={handleGoToProduction} className="px-6 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-bold shadow-lg shadow-green-500/20">
                  {t(settings.lang, 'enterProduction')}
                </button>
              </div>
            </div>

            {/* Director Brain Panel — logline, world_setting, character_bible, style_bible */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <DirectorBrainPanel project={project} lang={settings.lang} />
            </div>
            {/* Director OS Layer Status — visible warning if any layer failed */}
            {(project as any).director_os_layers && (
              <DirectorOSStatus
                layers={(project as any).director_os_layers}
                degraded={!!(project as any).director_os_degraded}
                criticalFailures={(project as any).director_os_critical_failures ?? []}
              />
            )}

            {/* Director Brain Panel — logline, world_setting, character_bible, style_bible */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <DirectorBrainPanel project={project} lang={settings.lang} />
            </div>
            {/* Cast Photo Generator Plugin */}
            <CastPhotoGenerator
              project={project}
              currentGlobalAnchor={referenceImageDataUrl}
              onSetGlobalAnchor={handleSetGlobalAnchor}
              autoGenerate={true}
            />

            {/* ★ 修复：手动设定/修改锚点的区域，防止因被自动折叠而“丢失功能” */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-slate-400 uppercase tracking-widest text-xs">{t(settings.lang, 'globalCastAnchor')}</span>
              </div>
              <textarea
                value={project.character_anchor || ''}
                onChange={(e) => setProject({ ...project, character_anchor: e.target.value })}
                placeholder={t(settings.lang, 'castAnchorPlaceholder')}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm h-16 focus:border-indigo-500 outline-none transition-colors"
              />
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
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">🎵 Audio</label>
                      <input
                        value={scene.audio_description}
                        onChange={(e) => handleScriptUpdate(i, 'audio_description', e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded p-3 text-sm focus:border-indigo-500 outline-none"
                        placeholder={t(settings.lang, 'audioPlaceholder')}
                      />
                      {/* 智能对话系统 */}
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={scene.dialogue_speaker || ''}
                          onChange={(e) => handleScriptUpdate(i, 'dialogue_speaker', e.target.value)}
                          className="bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:border-indigo-500 outline-none"
                          placeholder={t(settings.lang, 'dialogueSpeaker')}
                        />
                        <input
                          value={scene.dialogue_text || ''}
                          onChange={(e) => handleScriptUpdate(i, 'dialogue_text', e.target.value)}
                          className="bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:border-indigo-500 outline-none"
                          placeholder={t(settings.lang, 'dialogueText')}
                        />
                      </div>
                      <input
                        value={scene.voice_characteristics || ''}
                        onChange={(e) => handleScriptUpdate(i, 'voice_characteristics', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs focus:border-indigo-500 outline-none"
                        placeholder={t(settings.lang, 'voiceCharacteristics')}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {workflowStage === 'shots' && !project && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 animate-in fade-in duration-300">
            <span className="text-4xl mb-4">🎞️</span>
            <p className="text-sm">{settings.lang === 'zh' ? '项目未加载，正在返回项目列表…' : 'No project loaded, returning to dashboard…'}</p>
          </div>
        )}

        {workflowStage === 'shots' && project && (
          <div className="space-y-6">
            {/* Shot Timeline — visual overview of all scenes + shots */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <ShotTimeline project={project} lang={settings.lang} />
            </div>

            {/* Verification Panel — pipeline health check */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <VerificationPanel project={project} lang={settings.lang} />
            </div>

            {/* Shot List — main production view */}
            <ShotListView
              project={project}
              referenceImageDataUrl={referenceImageDataUrl}
              shotCount={shotCount}
              onBack={() => { setWorkflowStage('scripting'); setPipelineStage('shots_ready'); }}
              onUpdateScene={handleSceneSync}
              onSetGlobalAnchor={handleSetGlobalAnchor}
            />
          </div>
        )}

        {workflowStage === 'production' && !project && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-500 animate-in fade-in duration-300">
            <span className="text-4xl mb-4">🎬</span>
            <p className="text-sm">{settings.lang === 'zh' ? '项目未加载，正在返回项目列表…' : 'No project loaded, returning to dashboard…'}</p>
          </div>
        )}

        {workflowStage === 'production' && project && (
          <div className="space-y-4">
            <VideoGenerator
              project={project}
              referenceImageDataUrl={referenceImageDataUrl}
              onBackToScript={() => { setWorkflowStage('scripting'); setPipelineStage('storyboard_review'); }}
              onUpdateScene={handleSceneSync}
            />
            {/* Quick shortcut to Final Cut once clips exist */}
            <div className="flex justify-end">
              <button
                onClick={() => setWorkflowStage('finalcut')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                  bg-indigo-900/50 border border-indigo-700/50 hover:bg-indigo-800/60 transition-all text-indigo-300"
              >
                ✂️ {settings.lang === 'zh' ? '进入最终剪辑' : 'Go to Final Cut'}
              </button>
            </div>
          </div>
        )}

        {workflowStage === 'finalcut' && project && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <FinalCutPanel project={project} lang={settings.lang} />
          </div>
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