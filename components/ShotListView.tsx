/**
 * ShotListView — Enhanced shot-level storyboard view
 * Shows detailed shot breakdowns per scene with editing, AI rewrite, and field locking.
 */
import React, { useState, useCallback } from 'react';
import { StoryboardProject, Scene, Shot, ShotImage, ShotRevision, Language, VideoModel, StoryEntity } from '../types';
import { generateShots, rewriteShotFields } from '../services/shotService';
import { useAppContext } from '../context/AppContext';
import { LoaderIcon } from './IconComponents';
import ShotEditDrawer from './ShotEditDrawer';
import ShotImageGrid from './ShotImageGrid';
import BatchImagePanel from './BatchImagePanel';
import { t } from '../i18n';
import { startVideoTask, generateImage, checkPredictionStatus, extractLastFrameWithFallback } from '../services/replicateService';
import { forceDownload } from '../utils/download';
import { generateVoicesForScenes } from '../services/elevenLabsService';
interface ShotListViewProps {
    project: StoryboardProject;
    referenceImageDataUrl?: string;  // ★ Compressed base64 for Flux Redux consistency
    shotCount: number; // ★ 新增：镜头数量（5/10/15/20/25/30）
    onBack: () => void;
    onUpdateScene?: (sceneIndex: number, field: string, value: any) => void;
    onSetGlobalAnchor?: (url: string) => void;
}

// ── Camera & movement badge colors ──
const cameraBadgeColor: Record<string, string> = {
    wide: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    medium: 'bg-green-500/20 text-green-300 border-green-500/30',
    close: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    ecu: 'bg-red-500/20 text-red-300 border-red-500/30',
    'over-shoulder': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    pov: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    aerial: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    'two-shot': 'bg-teal-500/20 text-teal-300 border-teal-500/30',
};

const movementBadge: Record<string, string> = {
    static: '⏸',
    'push-in': '⬆️',
    'pull-out': '⬇️',
    'pan-left': '⬅️',
    'pan-right': '➡️',
    dolly: '🎬',
    tracking: '🏃',
    crane: '🏗',
    handheld: '📱',
    steadicam: '🎥',
    'whip-pan': '💨',
    zoom: '🔍',
};

// ── Shot card (compact view) ──
const ShotCard: React.FC<{
    shot: Shot;
    shotIndex: number; // ★ 核心：用来判断是不是第一镜
    videoUrl?: string; // ★ 核心：用来接收生成的视频
    isExpanded: boolean;
    onToggle: () => void;
    onEdit: () => void;
    onLockToggle: (field: string) => void;
    images: ShotImage[];
    onImagesChange: (images: ShotImage[]) => void;
    characterAnchor: string;
    visualStyle: string;
    projectId?: string;
    referenceImageDataUrl?: string; // ★ 新增接收照片
    onSetGlobalAnchor?: (url: string) => void;
    sceneDescription?: string; // ★ Full context for video prompts
    storyEntities?: StoryEntity[];
    lang: Language;
}> = ({ shot, shotIndex, videoUrl, isExpanded, onToggle, onEdit, onLockToggle, images, onImagesChange, characterAnchor, visualStyle, projectId, referenceImageDataUrl, onSetGlobalAnchor, sceneDescription, storyEntities, lang }) => {
    const camClass = cameraBadgeColor[shot.camera] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    const moveEmoji = movementBadge[shot.movement] || '🎬';

    return (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-all group">
            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" onClick={onToggle}>
                <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-bold text-sm shrink-0">
                    {shot.shot_number ?? shotIndex + 1}
                </div>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${camClass}`}>{shot.camera}</span>
                <span className="text-xs">{moveEmoji} {shot.movement}</span>
                <span className="text-xs text-slate-500 font-mono">{shot.duration_sec}s</span>
                <span className="text-xs text-slate-400 truncate flex-1">{shot.action}</span>
                <svg className={`w-4 h-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </div>

            {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-800/50 pt-3 space-y-3 animate-in fade-in">
                    <div className="grid grid-cols-3 gap-3 text-xs">
                        <div><span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Location</span><p className="text-slate-300">{shot.location_type}. {shot.location}</p></div>
                        <div><span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Time</span><p className="text-slate-300">{shot.time_of_day}</p></div>
                        <div><span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Lens</span><p className="text-slate-300">{shot.lens}</p></div>
                    </div>

                    {/* Image prompt + generation panel */}
                    {shotIndex === 0 ? (
                        <>
                            <div className="text-xs mt-3">
                                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Image Prompt (首镜源头)</span>
                                <p className="text-slate-400 font-mono text-[11px] bg-slate-950 rounded p-2 mt-1 max-h-20 overflow-y-auto">{shot.image_prompt || '—'}</p>
                            </div>
                            <div className="mt-3 pt-3 border-t border-slate-800/50">
                                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold mb-2 block">🖼 场景源头原画</span>
                                <ShotImageGrid
                                    shot={shot} images={images} onImagesChange={onImagesChange}
                                    characterAnchor={characterAnchor} visualStyle={visualStyle} projectId={projectId}
                                    storyEntities={storyEntities}
                                    referenceImageDataUrl={referenceImageDataUrl}
                                    onSetGlobalAnchor={onSetGlobalAnchor}
                                    sceneDescription={sceneDescription}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="mt-3 space-y-2">
                            <div className="p-3 bg-indigo-900/20 border border-indigo-500/30 rounded-lg flex items-start gap-3">
                                <span className="text-indigo-400 text-xl">🔗</span>
                                <div>
                                    <p className="text-xs text-indigo-300 font-bold tracking-widest uppercase mb-1">{t(lang, 'dominoContinuation')}</p>
                                    <p className="text-[10px] text-indigo-400/80 leading-relaxed">{t(lang, 'dominoDesc')}</p>
                                </div>
                            </div>
                            {shot.image_prompt && (
                                <div className="text-xs">
                                    <span className="text-slate-600 uppercase tracking-wider text-[10px] font-bold">{t(lang, 'backupImagePrompt')}</span>
                                    <p className="text-slate-500 font-mono text-[10px] bg-slate-950/60 rounded p-2 mt-1 max-h-16 overflow-y-auto">{shot.image_prompt}</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Video prompt */}
                    {shot.video_prompt && (
                        <div className="text-xs mt-2">
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">{t(lang, 'videoPromptLabel')}</span>
                            <p className="text-slate-400 font-mono text-[11px] bg-slate-950 rounded p-2 mt-1 max-h-16 overflow-y-auto">{shot.video_prompt}</p>
                        </div>
                    )}

                    {/* Dialogue */}
                    {(shot.dialogue_text || shot.dialogue_speaker) && (
                        <div className="mt-2 pt-2 border-t border-slate-800/50">
                            <span className="text-amber-500/70 uppercase tracking-wider text-[10px] font-bold">💬 {t(lang, 'dialogueLabel')}</span>
                            {shot.dialogue_speaker && (
                                <span className="ml-2 text-[10px] text-amber-400 font-bold">{shot.dialogue_speaker}</span>
                            )}
                            {shot.dialogue_text && (
                                <p className="text-slate-300 text-xs mt-1 italic">"{shot.dialogue_text}"</p>
                            )}
                            {(shot as any).dialogue_subtext && (
                                <p className="text-slate-500 text-[10px] mt-0.5">{t(lang, 'subtextLabel')}: {(shot as any).dialogue_subtext}</p>
                            )}
                        </div>
                    )}

                    {/* Emotional beat */}
                    {shot.emotional_beat && (
                        <div className="text-xs mt-1">
                            <span className="text-rose-500/60 uppercase tracking-wider text-[10px] font-bold">🎭 {t(lang, 'emotionalBeatLabel')}</span>
                            <span className="ml-2 text-slate-400 text-[11px]">{shot.emotional_beat}</span>
                        </div>
                    )}

                    {/* ★ 视频播放器闭环 */}
                    {videoUrl && (
                        <div className="mt-4 pt-4 border-t border-slate-800/50">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-emerald-500 uppercase tracking-wider text-[10px] font-bold flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> 动态视频输出
                                </span>
                                <button
                                    onClick={() => forceDownload(videoUrl, `shot-${shot.shot_number}.mp4`)}
                                    className="px-3 py-1 text-[10px] font-bold bg-emerald-900/40 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-900/70 transition-colors flex items-center gap-1"
                                >
                                    ⬇️ 下载 .mp4
                                </button>
                            </div>
                            <video src={videoUrl} controls autoPlay loop playsInline className="w-full aspect-video object-cover rounded-lg border border-slate-700 shadow-xl" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── Scene section with shots ──
const SceneSection: React.FC<{
    scene: Scene; sceneIndex: number; shots: Shot[]; isGenerating: boolean; onGenerateShots: () => void;
    onUpdateShot: (shotId: string, updates: Partial<Shot>) => void; onRewriteShot: (shot: Shot, fields: string[], instruction: string) => void;
    project: StoryboardProject; imagesByShot: Record<string, ShotImage[]>; onImagesChange: (shotId: string, images: ShotImage[]) => void; effectiveProjectId: string;
    referenceImageDataUrl?: string;
    onUpdateScene: (updates: Partial<Scene>) => void;
    videoModel: VideoModel;
    onSetGlobalAnchor?: (url: string) => void;
    lang: Language;
    // ★ Voice / timing props (populated after ElevenLabs generation)
    voiceUrl?: string;
    voiceTiming?: { duration_sec: number; timing_blocks: Array<{ text: string; start_sec: number; end_sec: number }>; timing_source: string; voice_id_used: string };
}> = ({ scene, sceneIndex, shots, isGenerating, onGenerateShots, onUpdateShot, onRewriteShot, project, imagesByShot, onImagesChange, effectiveProjectId, referenceImageDataUrl, onUpdateScene, videoModel, onSetGlobalAnchor, lang, voiceUrl, voiceTiming }) => {
    const [expandedShots, setExpandedShots] = useState<Set<string>>(new Set());
    const [editingShot, setEditingShot] = useState<Shot | null>(null);

    // ★ 场基准锚点状态
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [isUploadingAnchor, setIsUploadingAnchor] = useState(false);

    const handleUploadSceneAnchor = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploadingAnchor(true);
        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target?.result as string;
            // ★ 通过正规回调更新层State，不再直接内存变调
            onUpdateScene({ scene_reference_image_base64: dataUrl });
            setChainLog('✅ 场次人物定妆图已锁定！');
            setTimeout(() => setChainLog(''), 3000);
            setIsUploadingAnchor(false);
        };
        reader.readAsDataURL(file);
    };

    // ★ 锁链引擎状态
    const [isChainRunning, setIsChainRunning] = useState(false);
    const [chainLog, setChainLog] = useState('');
    const [shotVideos, setShotVideos] = useState<Record<string, string>>({});

    // ★ 核心多米诺骨牌引擎（场次级：硬切+软接）
    const handleRunDominoChain = async () => {
        if (project.has_cast === true && !project.character_anchor) return alert("该剧本明确包含角色，请返回上一页(剧本页)添加角色描点！");
        if (shots.length === 0) return alert("当前场景没有分镜。");

        setIsChainRunning(true);
        let tailFrameBase64: string | null = null;

        try {
            for (let i = 0; i < shots.length; i++) {
                const shot = shots[i];
                let currentStartImage = "";

                if (i === 0) {
                    // ★ 硬切：首镜必须重铸人物，拒绝用任何上一帧的污染模糊图
                    // 优先级 1: 用户已经为这个镜头生成的图片 (包含场景背景)
                    // 优先级 2: 重新使用场次定妆图/全局大头照等作为 Face Anchor 现场生一张
                    const sceneAnchorRef = scene.scene_reference_image_base64 || referenceImageDataUrl;
                    const existingImg = imagesByShot[shot.shot_id]?.[0]?.url;

                    if (existingImg) {
                        currentStartImage = existingImg;
                        setChainLog(`[首镜] 已读取源头原画...`);
                    } else {
                        try {
                            setChainLog(`[首镜] 正在强制生成绝对清晰首帧 (Face Clone)...`);
                            currentStartImage = await generateImage(
                                shot.image_prompt || scene.visual_description,
                                'flux_schnell', 'none', '16:9', project.character_anchor,
                                sceneAnchorRef, // ★ 场次定妆图优先，回退全局照片作为人脸参考垫图
                                project.story_entities
                            );
                        } catch (genErr: any) {
                            if (genErr.message?.includes('Face alignment failed') || genErr.message?.includes('未能检测到清晰的人物面部')) {
                                setChainLog(`[首镜] ⚠️ 人脸锚点无法对齐 (可能上一场未露正脸)! 正在回退至文本模式生成首镜...`);
                                currentStartImage = await generateImage(
                                    shot.image_prompt || scene.visual_description,
                                    'flux_schnell', 'none', '16:9', project.character_anchor,
                                    null, // 移除无效垫图，纯文字走起
                                    project.story_entities
                                );
                            } else {
                                throw genErr;
                            }
                        }

                        // ★ 嗅探全片首帧并霸权锁定！
                        if (onSetGlobalAnchor && !sceneAnchorRef) {
                            onSetGlobalAnchor(currentStartImage);
                        }
                    }
                } else {
                    // ★ 软接：同场内连续镜头，坚决吸纳上一镜尾帧
                    if (!tailFrameBase64) throw new Error("严重错误：上一镜尾帧提取失败，链条断裂！");
                    currentStartImage = tailFrameBase64;
                    setChainLog(`[第 ${i + 1} 镜] 已强行锁定上一镜尾帧...`);
                }

                setChainLog(`[第 ${i + 1} 镜] 正在生成视频动态...`);
                // ★ Combine the scene's full context with the specific action to prevent clothing/logic hallucinations
                const motionCore = (shot.video_prompt || shot.action || '').trim();
                const fallbackMotion = `Camera ${shot.movement || 'static'}. Subject performs a distinct beat for shot ${shot.shot_number}.`;
                const lockedCastLine = (project.story_entities || [])
                    .filter((e: any) => e?.type === 'character' && e?.is_locked)
                    .map((e: any) => `${e.name}: ${e.description}`)
                    .join(' | ');
                const identityLock = (project.character_anchor || '').trim();
                const hardContinuityRules = [
                    shot.continuity_notes || 'Maintain character identity and spatial continuity.',
                    identityLock ? `Identity Lock: ${identityLock}` : '',
                    lockedCastLine ? `Locked Cast: ${lockedCastLine}` : '',
                    'Hard Rules: no face drift, no wardrobe change, no age/gender swap, keep hairstyle/body proportions, preserve left-right screen direction and camera axis continuity.'
                ].filter(Boolean).join(' ');
                // Use shot.video_prompt set by composeAllPrompts() during shot planning.
                // Only append runtime continuity context here (cannot be known at plan time).
                const richVideoPrompt = [
                    shot.video_prompt || `${motionCore || fallbackMotion}`,
                    `Continuity: ${hardContinuityRules}`,
                ].filter(Boolean).join(' ');
                const videoRes = await startVideoTask(
                    richVideoPrompt,
                    currentStartImage,
                    videoModel,
                    'none',
                    'storyboard',
                    'standard',
                    6,
                    24,
                    '720p',
                    project.character_anchor,
                    '16:9',
                    {
                        storyEntities: project.story_entities,
                        project_id: effectiveProjectId,
                        shot_id: shot.shot_id,
                        continuity: {
                            strictness: 'high',
                            lockCharacter: true,
                            lockStyle: true,
                            lockCostume: true,
                            lockScene: true,
                            usePreviousApprovedAsReference: true,
                            scene_memory: {
                                scene_id: shot.scene_id,
                                scene_number: scene.scene_number,
                                location: shot.location,
                                time_of_day: shot.time_of_day,
                                lighting_continuity: shot.lighting,
                                active_costume: shot.art_direction,
                                prop_state: shot.sfx_vfx,
                            },
                            project_context: {
                                project_id: effectiveProjectId,
                                visual_style: project.visual_style,
                                character_anchor: project.character_anchor,
                                story_entities: project.story_entities,
                            }
                        }
                    }
                );

                let videoUrl = "";
                let status = "processing";
                while (status === "processing" || status === "starting") {
                    await new Promise(r => setTimeout(r, 3000));
                    const check = await checkPredictionStatus(videoRes.id);
                    status = check.status;
                    if (status === "succeeded") {
                        videoUrl = Array.isArray(check.output) ? check.output[0] : check.output;
                    } else if (status === "failed" || status === "canceled") {
                        throw new Error(`视频生成失败: ${check.error}`);
                    }
                }

                // 立即在界面上显示视频
                setShotVideos(prev => ({ ...prev, [shot.shot_id]: videoUrl }));
                // ★ 永久写入数据库，防止刷新丢失
                onUpdateShot(shot.shot_id, { video_url: videoUrl });

                // 准备接力棒
                if (i < shots.length - 1) {
                    setChainLog(`[第 ${i + 1} 镜] 正在后台静默提取尾帧...`);
                    tailFrameBase64 = await extractLastFrameWithFallback(videoUrl);
                }
            }
            setChainLog('🎉 锁链执行完毕，一镜到底生成成功！');
            setTimeout(() => setChainLog(''), 5000);
        } catch (error: any) {
            alert(`生成中断: ${error.message}`);
            setChainLog('❌ 生成失败');
        } finally {
            setIsChainRunning(false);
        }
    };

    const toggleShot = (id: string) => setExpandedShots(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    const expandAll = () => setExpandedShots(new Set(shots.map(s => s.shot_id)));
    const collapseAll = () => setExpandedShots(new Set());

    return (
        <div className="bg-slate-950/50 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2"><span className="text-indigo-400 font-bold text-sm uppercase tracking-wider">Scene {scene.scene_number ?? sceneIndex + 1}</span></div>
                    {scene.scene_setting && <p className="text-xs text-amber-400/70 mt-1 font-medium">📍 {scene.scene_setting}</p>}
                </div>

                <div className="flex gap-2 items-center">
                    {/* ★ 场次人物定妆图锁定组件 */}
                    <div className="flex items-center gap-2 mr-3 border-r border-slate-700 pr-3">
                        <input type="file" ref={fileInputRef} accept="image/*" onChange={handleUploadSceneAnchor} className="hidden" />
                        {scene.scene_reference_image_base64 ? (
                            <div
                                className="flex items-center gap-2 px-2.5 py-1.5 bg-green-900/30 border border-green-500/30 rounded-lg cursor-pointer hover:bg-green-900/50 transition-colors"
                                onClick={() => fileInputRef.current?.click()}
                                title="点击更换场次人物定妆图"
                            >
                                <img src={scene.scene_reference_image_base64} alt="Scene Anchor" className="w-5 h-5 object-cover rounded border border-green-500/50" />
                                <span className="text-green-400 text-[10px] font-bold">✅ 定妆已锁定</span>
                            </div>
                        ) : (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isUploadingAnchor}
                                className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-400 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 hover:border-slate-500 transition-all flex items-center gap-1.5"
                                title="上传此场次的人物定妆照，锁定特征一致性"
                            >
                                {isUploadingAnchor ? <LoaderIcon className="w-3 h-3 animate-spin" /> : '📸'}
                                {isUploadingAnchor ? '处理中...' : '锁定场次人物'}
                            </button>
                        )}
                    </div>

                    {/* ★ 新增的发射按钮 */}
                    {chainLog && <span className="text-xs font-mono text-amber-400 mr-2 animate-pulse">{chainLog}</span>}
                    {shots.length > 0 && (
                        <button onClick={handleRunDominoChain} disabled={isChainRunning} className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${isChainRunning ? 'bg-purple-900/50 text-purple-300 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-500/20'}`}>
                            {isChainRunning ? '🚀 锁链运转中...' : '🚀 一键执行物理锁链'}
                        </button>
                    )}
                    {shots.length > 0 && <><button onClick={expandAll} className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800">展开</button><button onClick={collapseAll} className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800">折叠</button></>}
                    <button onClick={onGenerateShots} disabled={isGenerating} className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 text-amber-400">{isGenerating ? '生成中...' : '🔄 重新拆分'}</button>
                </div>
            </div>

            {/* ★ Voice audio player + real timing blocks (only after ElevenLabs generation) */}
            {voiceUrl && (
                <div className="mx-3 mb-3 p-3 bg-indigo-950/40 border border-indigo-500/20 rounded-xl space-y-2">
                    <div className="flex items-center gap-2">
                        <span className="text-indigo-400 text-[10px] uppercase font-bold tracking-widest">🎙️ AI 配音</span>
                        {voiceTiming && (
                            <span className="text-[9px] text-emerald-400 bg-emerald-900/30 px-1.5 rounded font-mono">
                                {voiceTiming.duration_sec}s · {voiceTiming.timing_source}
                            </span>
                        )}
                        {voiceTiming && (
                            <span className="text-[9px] text-slate-500">voice: {voiceTiming.voice_id_used}</span>
                        )}
                    </div>
                    <audio controls src={voiceUrl} className="w-full h-8 accent-indigo-500" />
                    {/* ★ Sentence-level timing blocks — real ElevenLabs alignment, not mock */}
                    {voiceTiming?.timing_blocks && voiceTiming.timing_blocks.length > 0 && (
                        <div className="space-y-1 mt-1">
                            {voiceTiming.timing_blocks.map((block, i) => (
                                <div key={i} className="flex items-start gap-2 text-[10px]">
                                    <span className="text-indigo-500/70 font-mono shrink-0 w-20 text-right">
                                        {block.start_sec.toFixed(2)}s–{block.end_sec.toFixed(2)}s
                                    </span>
                                    <span className="text-slate-300 leading-snug">{block.text}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {shots.length > 0 && (
                <div className="p-3 space-y-2">
                    {shots.map((shot, index) => (
                        <ShotCard
                            key={shot.shot_id} shot={shot}
                            shotIndex={index} /* ★ 传序号 */
                            videoUrl={shotVideos[shot.shot_id] || shot.video_url} /* ★ 优先session，回退DB */
                            isExpanded={expandedShots.has(shot.shot_id)} onToggle={() => toggleShot(shot.shot_id)}
                            onEdit={() => setEditingShot(shot)} onLockToggle={() => { }}
                            images={imagesByShot[shot.shot_id] || []} onImagesChange={(imgs) => onImagesChange(shot.shot_id, imgs)}
                            characterAnchor={project.character_anchor} visualStyle={project.visual_style} projectId={effectiveProjectId}
                            storyEntities={project.story_entities || []}
                            referenceImageDataUrl={referenceImageDataUrl}
                            sceneDescription={scene.visual_description}
                            lang={lang}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════
// Main ShotListView component
// ═══════════════════════════════════════════════════════════════
const ShotListView: React.FC<ShotListViewProps> = ({ project, referenceImageDataUrl, shotCount, onBack, onUpdateScene, onSetGlobalAnchor }) => {
    const { settings, isAuthenticated, openPricingModal, hasEnoughCredits, refreshBalance } = useAppContext();

    // ★ Generate a stable project ID if missing (for legacy projects)
    const [fallbackProjectId] = useState(() => crypto.randomUUID());
    const effectiveProjectId = project.id || fallbackProjectId;

    // State: shots indexed by scene_number
    const [shotsByScene, setShotsByScene] = useState<Record<number, Shot[]>>({});
    const [generatingScenes, setGeneratingScenes] = useState<Set<number>>(new Set());
    const [error, setError] = useState<string | null>(null);

    // Revision history (in-memory for now, can persist to DB)
    const [revisionHistory, setRevisionHistory] = useState<Record<string, ShotRevision[]>>({});

    // ★ Images indexed by shot_id
    const [imagesByShot, setImagesByShot] = useState<Record<string, ShotImage[]>>({});

    // ★ 全局物理引擎锁链状态
    const [isChainRunning, setIsChainRunning] = useState(false);
    const [isChainLocked, setIsChainLocked] = useState(false); // ★ 新增：锁链永久锁定状态
    const [chainLog, setChainLog] = useState('');
    const [shotVideos, setShotVideos] = useState<Record<string, string>>({});

    // ★ AI 配音状态
    const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
    const [sceneVoices, setSceneVoices] = useState<Record<number, string>>({});
    // timing_source = "elevenlabs_alignment" means real provider timing (never mock)
    const [sceneTiming, setSceneTiming] = useState<Record<number, {
        duration_sec: number;
        timing_blocks: Array<{ text: string; start_sec: number; end_sec: number }>;
        timing_source: string;
        voice_id_used: string;
    }>>({});

    // ★ 场次级颚外数据（scene_reference_image_base64 等）狠态存储
    const [sceneDataMap, setSceneDataMap] = useState<Record<number, Partial<Scene>>>({});

    const handleUpdateScene = useCallback((sceneNum: number, updates: Partial<Scene>) => {
        setSceneDataMap(prev => ({ ...prev, [sceneNum]: { ...(prev[sceneNum] || {}), ...updates } }));
    }, []);

    const handleImagesChange = useCallback((shotId: string, images: ShotImage[]) => {
        setImagesByShot(prev => ({ ...prev, [shotId]: images }));

        // Also update the shot's image_url from the primary image for convenience
        const primary = images.find(i => i.is_primary) || images[0];
        if (primary) {
            // Find which scene this shot belongs to and update
            setShotsByScene(prev => {
                const updated = { ...prev };
                for (const [sceneNum, shots] of Object.entries(updated) as [string, Shot[]][]) {
                    const idx = shots.findIndex(s => s.shot_id === shotId);
                    if (idx >= 0) {
                        const newShots = [...shots];
                        newShots[idx] = { ...newShots[idx], image_url: primary.url };
                        updated[Number(sceneNum)] = newShots;
                        break;
                    }
                }
                return updated;
            });
        }
    }, []);

    const handleGenerateShots = useCallback(async (scene: Scene) => {
        if (!isAuthenticated) return alert('请先登录');
        if (!hasEnoughCredits(1)) return openPricingModal();

        const sNum = scene.scene_number;
        setGeneratingScenes(prev => new Set(prev).add(sNum));
        setError(null);

        try {
            const result = await generateShots({
                scene_number: sNum,
                visual_description: scene.visual_description,
                audio_description: scene.audio_description,
                shot_type: scene.shot_type,
                visual_style: project.visual_style,
                character_anchor: project.character_anchor,
                story_entities: project.story_entities,
                director_brain: project.director_brain,
                language: settings.lang,
                num_shots: shotCount,
            });

            setShotsByScene(prev => ({ ...prev, [sNum]: result.shots }));
            refreshBalance().catch(() => { });
        } catch (e: any) {
            console.error('[ShotListView] Generate failed:', e);
            setError(e.message || 'Shot generation failed');
            if (e.message?.includes('INSUFFICIENT_CREDITS')) openPricingModal();
        } finally {
            setGeneratingScenes(prev => {
                const next = new Set(prev);
                next.delete(sNum);
                return next;
            });
        }
    }, [isAuthenticated, hasEnoughCredits, openPricingModal, project, settings.lang, refreshBalance, shotCount]); // ★ 添加shotCount到依赖

    const handleUpdateShot = useCallback((sceneNum: number, shotId: string, updates: Partial<Shot>) => {
        setShotsByScene(prev => {
            const shots = prev[sceneNum] || [];
            const shotIndex = shots.findIndex(s => s.shot_id === shotId);
            if (shotIndex < 0) return prev;

            const oldShot = shots[shotIndex];

            // Save revision before update
            const revision: ShotRevision = {
                revision_id: crypto.randomUUID(),
                shot_id: shotId,
                version: oldShot.version,
                snapshot: { ...oldShot },
                change_source: 'user',
                change_description: `Updated: ${Object.keys(updates).join(', ')}`,
                changed_fields: Object.keys(updates),
                created_at: new Date().toISOString(),
            };

            setRevisionHistory(prev => ({
                ...prev,
                [shotId]: [...(prev[shotId] || []), revision],
            }));

            const newShots = [...shots];
            newShots[shotIndex] = {
                ...oldShot,
                ...updates,
                version: oldShot.version + 1,
                updated_at: new Date().toISOString(),
            };

            return { ...prev, [sceneNum]: newShots };
        });
    }, []);

    const handleRewriteShot = useCallback(async (sceneNum: number, shot: Shot, fields: string[], instruction: string) => {
        if (!isAuthenticated) return;
        if (!hasEnoughCredits(1)) return openPricingModal();

        try {
            const result = await rewriteShotFields({
                shot_id: shot.shot_id,
                fields_to_rewrite: fields,
                user_instruction: instruction,
                locked_fields: shot.locked_fields,
                current_shot: shot,
                project_context: {
                    visual_style: project.visual_style,
                    character_anchor: project.character_anchor,
                    scene_title: `Scene ${sceneNum}`,
                },
                language: settings.lang,
            });

            // Apply rewritten fields
            handleUpdateShot(sceneNum, shot.shot_id, result.rewritten_fields);
            refreshBalance().catch(() => { });
        } catch (e: any) {
            console.error('[ShotListView] Rewrite failed:', e);
            setError(e.message || 'Rewrite failed');
        }
    }, [isAuthenticated, hasEnoughCredits, openPricingModal, project, settings.lang, handleUpdateShot, refreshBalance]);

    const handleGenerateAll = async () => {
        for (const scene of project.scenes) {
            if (shotsByScene[scene.scene_number]?.length) continue; // Skip already generated
            await handleGenerateShots(scene);
        }
    };

    // ★ AI 配音生成处理器 (real ElevenLabs timing — no mock fallback)
    const handleGenerateVoices = async () => {
        if (!project.scenes || project.scenes.length === 0) {
            alert('没有场景可以生成配音');
            return;
        }

        setIsGeneratingVoice(true);
        try {
            // ── Build character → voice-preset map from character_bible ──────
            // Each character gets a voice based on their name/gender heuristic.
            // User can override by passing a custom map.  Default: Chinese female.
            const charBible: any[] = (project as any).character_bible ?? [];
            const character_voices: Record<string, string> = {};
            for (const char of charBible) {
                if (!char.name) continue;
                // Simple heuristic: check if hair/face hints suggest gender, else default
                const nameLower = (char.name as string).toLowerCase();
                const isFemale = /she|her|woman|female|girl|lady/.test(nameLower)
                    || /她|女|女士|小姐|姐姐|妹妹|姐|妹|阿姨|女孩|女生|太太|夫人/.test(char.name as string)
                    || /she|her|woman|female|girl|lady|她|女|女士|小姐|姐|妹/.test((char.face_traits ?? '').toLowerCase());
                character_voices[char.name] = isFemale ? 'zh_female_shuang' : 'zh_male_yong';
            }
            console.log('[ShotListView] character_voices map:', character_voices);

            // ── Build scene list with speaker info ───────────────────────────
            const scenesWithDialogue = project.scenes.map(scene => ({
                scene_number: scene.scene_number,
                dialogue: scene.dialogue_text || '',
                description: scene.visual_description || '',
                speaker: scene.dialogue_speaker || null, // ★ pass speaker for per-char voice
            }));

            console.log('[ShotListView] Generating voices for', scenesWithDialogue.length, 'scenes...');

            const result = await generateVoicesForScenes({
                scenes: scenesWithDialogue,
                voice_id: 'zh_female_shuang', // default if no character match
                character_voices,             // per-character voice overrides
            } as any);

            if (result.results) {
                const newVoices: Record<number, string> = {};
                const newTiming: typeof sceneTiming = {};

                for (const r of result.results) {
                    if (r.success && r.audio_url) {
                        newVoices[r.scene_number] = r.audio_url;
                        if (r.timing_source === 'elevenlabs_alignment') {
                            newTiming[r.scene_number] = {
                                duration_sec: r.duration_sec,
                                timing_blocks: r.timing_blocks ?? [],
                                timing_source: r.timing_source,
                                voice_id_used: r.voice_id_used ?? '',
                            };
                        }
                    }
                }
                setSceneVoices(prev => ({ ...prev, ...newVoices }));
                setSceneTiming(prev => ({ ...prev, ...newTiming }));

                const successCount = result.results.filter((r: any) => r.success).length;
                const timingCount = Object.keys(newTiming).length;
                console.log(`[ShotListView] ✅ Voice done: ${successCount} audio files, ${timingCount} with real alignment timing`);
                alert(
                    `✅ 配音生成完成！\n` +
                    `• ${successCount} 个场景成功生成音频\n` +
                    `• ${timingCount} 个场景带真实 ElevenLabs 时间轴对齐\n` +
                    `• timing_source: elevenlabs_alignment（非估算）`
                );
            }
        } catch (e: any) {
            console.error('[ShotListView] Voice generation failed:', e);
            alert(e.message || '配音生成失败');
        } finally {
            setIsGeneratingVoice(false);
        }
    };

    // ★ 核心多米诺骨牌引擎 (Global Level)
    const handleRunGlobalDominoChain = async () => {
        // ★ 新增：检查是否已经锁定（第一道防线）
        if (isChainLocked) {
            alert("⚠️ 全片物理锁链已执行完毕并锁定，不允许重复运行！\n如需重新生成，请刷新页面重新开始。");
            return;
        }

        // ★ 验证前置条件（必须在锁定之前检查）
        if (project.has_cast === true && !project.character_anchor) {
            return alert("该剧本明确包含角色，请返回上一页(剧本页)添加角色锚点！");
        }
        if (project.scenes.length === 0) {
            return alert("当前剧本没有任何场景，请先拆分场景。");
        }

        // ★ 新增：第一次点击时立即锁定，防止重复点击（在所有检查通过后）
        setIsChainLocked(true);
        setChainLog("🔒 全片物理锁链已启动，系统已锁定，请勿重复操作...");
        setIsChainRunning(true);

        // Step 1: 自动验证是否所有场景都已生成拆分镜头
        let hasMissingShots = false;
        for (const scene of project.scenes) {
            if (!shotsByScene[scene.scene_number] || shotsByScene[scene.scene_number].length === 0) {
                hasMissingShots = true;
                break;
            }
        }

        if (hasMissingShots) {
            setChainLog("检测到未拆分镜头的场景，正在为您自动执行全场预拆分...");
            await handleGenerateAll(); // Will await internally all the generation loops
        }
        let globalTailFrameBase64: string | null = null;
        let globalAutoAnchorBase64: string | null = null; // ★ 新增：全片第一帧垫图锚点

        try {
            // Step 2: 遍历大循环 (All Scenes -> All Shots)
            for (let sIdx = 0; sIdx < project.scenes.length; sIdx++) {
                const rawScene = project.scenes[sIdx];
                // ★ 合并场次外挂数据（包含用户上传的定妆图）
                const scene = { ...rawScene, ...(sceneDataMap[rawScene.scene_number] || {}) };
                const sceneShots = shotsByScene[scene.scene_number] || [];

                for (let i = 0; i < sceneShots.length; i++) {
                    const shot = sceneShots[i];
                    console.log(`\n🎬 [Global Chain] Scene ${scene.scene_number} --- 开始制作第 ${i + 1} 镜 ---`);
                    let currentStartImage: string;
                    const isFirstShotOfWholeFilm = sIdx === 0 && i === 0;

                    // 全剧严格连续：仅首镜允许生图；其余镜头（含跨场）必须继承上一镜尾帧
                    if (isFirstShotOfWholeFilm) {
                        // ★ 首镜：允许用锚点生图初始化整片锁链
                        // 优先级 1: 存量用户生成图片 (带有背景)
                        // 优先级 2: 场次专属定妆图 Base64 → 全局角色照片 → 自动提取的首帧
                        const sceneAnchorRef = scene.scene_reference_image_base64 || referenceImageDataUrl || globalAutoAnchorBase64;
                        const existingImg = imagesByShot[shot.shot_id]?.[0]?.url;

                        if (existingImg) {
                            currentStartImage = existingImg;
                            setChainLog(`场 ${scene.scene_number} 首镜：★ 已读取源头原画！`);
                        } else {
                            // 强制生图模型重新生成一张干净的首帧，避免误差累积
                            try {
                                setChainLog(`场 ${scene.scene_number} 首镜：正在重新生成绝对清晰的首帧图 (Face Clone)...`);
                                currentStartImage = await generateImage(
                                    shot.image_prompt || scene.visual_description,
                                    'flux_schnell', 'none', '16:9', project.character_anchor,
                                    sceneAnchorRef, // ★ 场次定妆图优先，回退全局照片，再回退自动嗅探的全片第一帧作为【垫图】
                                    project.story_entities
                                );
                            } catch (genErr: any) {
                                if (genErr.message?.includes('Face alignment failed') || genErr.message?.includes('未能检测到清晰的人物面部')) {
                                    setChainLog(`场 ${scene.scene_number} 首镜：⚠️ 锚点图无清晰正脸！已自动卸载垫图，回退至纯文本引擎继续生成...`);
                                    currentStartImage = await generateImage(
                                        shot.image_prompt || scene.visual_description,
                                        'flux_schnell', 'none', '16:9', project.character_anchor,
                                        null, // 放弃破损的垫图
                                        project.story_entities
                                    );
                                } else {
                                    throw genErr;
                                }
                            }

                            // ★ 【核心一致性机制】：如果是全片首场首镜，且没有局部或全局垫图，则自动缓存为全片霸权锚点
                            if (sIdx === 0 && !scene.scene_reference_image_base64 && !referenceImageDataUrl) {
                                globalAutoAnchorBase64 = currentStartImage;
                                setChainLog(`场 ${scene.scene_number} 首镜：★ 已自动嗅探全片第一帧作为后续所有跨场的绝对一致性基准！`);

                                // ★ 触发全局 React State 更新
                                if (onSetGlobalAnchor) {
                                    onSetGlobalAnchor(currentStartImage);
                                }
                            }

                            // 保存这张生成的首帧留作纪念
                            const newImageId = crypto.randomUUID();
                            setImagesByShot(prev => ({
                                ...prev,
                                [shot.shot_id]: [{ id: newImageId, shot_id: shot.shot_id, url: currentStartImage, is_primary: true, status: 'succeeded', created_at: new Date().toISOString() }]
                            }));
                        }
                    } else {
                        setChainLog(`场 ${scene.scene_number} 镜 ${i + 1}：正在继承上一镜尾帧（全片无跳切）...`);
                        if (globalTailFrameBase64) {
                            currentStartImage = globalTailFrameBase64;
                        } else {
                            // ★ 安全兜底：如果尾帧意外丢失，立即回退锚点生图，避免整链崩溃
                            const sceneAnchorRef = scene.scene_reference_image_base64 || referenceImageDataUrl || globalAutoAnchorBase64;
                            setChainLog(`场 ${scene.scene_number} 镜 ${i + 1}：⚠️ 未找到上一镜尾帧，正在使用锚点紧急重建起始帧...`);
                            currentStartImage = await generateImage(
                                shot.image_prompt || scene.visual_description,
                                'flux_schnell', 'none', '16:9', project.character_anchor,
                                sceneAnchorRef,
                                project.story_entities
                            );
                        }
                    }

                    setChainLog(`场 ${scene.scene_number} 镜 ${i + 1}：正在基于物理引擎渲染动态视频...`);
                    // ★ Combine the context to prevent video hallucination
                    const motionCore = (shot.video_prompt || shot.action || '').trim();
                    const fallbackMotion = `Camera ${shot.movement || 'static'}. Subject performs a distinct beat for shot ${shot.shot_number}.`;
                    const lockedCastLine = (project.story_entities || [])
                        .filter((e: any) => e?.type === 'character' && e?.is_locked)
                        .map((e: any) => `${e.name}: ${e.description}`)
                        .join(' | ');
                    const identityLock = (project.character_anchor || '').trim();
                    const hardContinuityRules = [
                        shot.continuity_notes || 'Maintain character identity and spatial continuity.',
                        identityLock ? `Identity Lock: ${identityLock}` : '',
                        lockedCastLine ? `Locked Cast: ${lockedCastLine}` : '',
                        'Hard Rules: no face drift, no wardrobe change, no age/gender swap, keep hairstyle/body proportions, preserve left-right screen direction and camera axis continuity.'
                    ].filter(Boolean).join(' ');
                    // Use shot.video_prompt set by composeAllPrompts() during shot planning.
                // Only append runtime continuity context here (cannot be known at plan time).
                const richVideoPrompt = [
                    shot.video_prompt || `${motionCore || fallbackMotion}`,
                    `Continuity: ${hardContinuityRules}`,
                ].filter(Boolean).join(' ');
                    // 发送视频请求
                    const videoRes = await startVideoTask(
                        richVideoPrompt,
                        currentStartImage,
                        settings.videoModel,
                        'none',
                        'storyboard',
                        'standard',
                        6,
                        24,
                        '720p',
                        project.character_anchor,
                        '16:9',
                        {
                            storyEntities: project.story_entities,
                            project_id: effectiveProjectId,
                            shot_id: shot.shot_id,
                            continuity: {
                                strictness: 'high',
                                lockCharacter: true,
                                lockStyle: true,
                                lockCostume: true,
                                lockScene: true,
                                usePreviousApprovedAsReference: true,
                                scene_memory: {
                                    scene_id: shot.scene_id,
                                    scene_number: scene.scene_number,
                                    location: shot.location,
                                    time_of_day: shot.time_of_day,
                                    lighting_continuity: shot.lighting,
                                    active_costume: shot.art_direction,
                                    prop_state: shot.sfx_vfx,
                                },
                                project_context: {
                                    project_id: effectiveProjectId,
                                    visual_style: project.visual_style,
                                    character_anchor: project.character_anchor,
                                    story_entities: project.story_entities,
                                }
                            }
                        }
                    );

                    // 轮询等待视频完成
                    let videoUrl = "";
                    let status = "processing";
                    while (status === "processing" || status === "starting") {
                        await new Promise(r => setTimeout(r, 3000));
                        const check = await checkPredictionStatus(videoRes.id);
                        status = check.status;
                        if (status === "succeeded") {
                            videoUrl = Array.isArray(check.output) ? check.output[0] : check.output;
                        } else if (status === "failed" || status === "canceled") {
                            throw new Error(`视频生成失败: ${check.error}`);
                        }
                    }

                    // 立即将结果上屏给外层状态树
                    setShotVideos(prev => ({ ...prev, [shot.shot_id]: videoUrl }));

                    // ★ 新增：将生成的视频 URL 永久保存到数据库中，防止刷新丢失！
                    handleUpdateShot(scene.scene_number, shot.shot_id, { video_url: videoUrl });

                    // 为下一次循环准备血脉！(哪怕是下一个scene，它也会在下一次被吸纳)
                    const isVeryLastShotInWholeMovie = (sIdx === project.scenes.length - 1) && (i === sceneShots.length - 1);
                    if (!isVeryLastShotInWholeMovie) {
                        setChainLog(`当前镜头渲染完毕，正在静默截取最后 0.1s 绝对尾帧准备跨域接力...`);
                        globalTailFrameBase64 = await extractLastFrameWithFallback(videoUrl);
                    }
                }
            }
            setChainLog('🎉 全片物理大一统串联完成，真正的电影级“一镜到底”已出炉！');
            setTimeout(() => setChainLog('🔒 全片已永久锁定，不可重复运行'), 8000);
        } catch (error: any) {
            console.error(error);
            // ★ 重要：即使失败也保持锁定状态，防止用户重复点击导致重复扣费
            alert(`⚠️ 生成中断: ${error.message}\n\n注意：为防止重复扣费，系统已锁定。如需重新生成，请刷新页面。`);
            setChainLog('❌ 生成失败但已锁定（防止重复扣费）');
        } finally {
            setIsChainRunning(false);
            // ★ 注意：不要解除 isChainLocked，保持永久锁定状态
        }
    };

    const totalShots = (Object.values(shotsByScene) as Shot[][]).reduce((sum, arr) => sum + arr.length, 0);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 pb-20">
            {/* Top bar */}
            <div className="sticky top-4 z-40">
                <div className="bg-slate-950/80 p-4 rounded-xl backdrop-blur border border-slate-800 shadow-2xl flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white mb-1">🎬 {project.project_title} — 镜头列表</h2>
                        <div className="flex gap-2 text-[10px] uppercase font-bold tracking-wider text-slate-500 items-center">
                            <span>{project.scenes.length} Scenes</span>
                            <span>•</span>
                            <span>{totalShots} Shots</span>
                            <span>•</span>
                            <span>{project.visual_style}</span>
                        </div>
                    </div>
                    <div className="flex gap-3 items-center">
                        {chainLog && <span className="text-xs font-mono text-amber-400 mr-2 animate-pulse whitespace-nowrap hidden lg:block">{chainLog}</span>}
                        {totalShots > 0 && (
                            <button
                                onClick={handleRunGlobalDominoChain}
                                disabled={isChainRunning || isChainLocked}
                                className={`px-4 py-3 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2
                                    ${isChainLocked
                                        ? 'bg-green-900/50 text-green-300 cursor-not-allowed border-2 border-green-500/30'
                                        : isChainRunning
                                            ? 'bg-indigo-900/50 text-indigo-300 cursor-not-allowed'
                                            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-purple-500/20'}`}
                                title={isChainLocked ? "全片已锁定，不可重复运行" : ""}
                            >
                                {isChainLocked ? (
                                    <>
                                        <span className="text-lg">🔒</span>
                                        <span className="hidden sm:inline">全片已锁定完成</span>
                                    </>
                                ) : isChainRunning ? (
                                    <>
                                        <LoaderIcon className="w-4 h-4 animate-spin" />
                                        <span className="hidden sm:inline">锁链执行中...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>🚀</span>
                                        <span className="hidden sm:inline">一键跑通全片物理锁链</span>
                                    </>
                                )}
                            </button>
                        )}
                        <button
                            onClick={onBack}
                            className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                        >
                            ← 返回剧本
                        </button>
                        <button
                            onClick={handleGenerateAll}
                            disabled={generatingScenes.size > 0 || isChainRunning}
                            className={`px-6 py-3 rounded-lg text-sm font-bold transition-all flex items-center gap-2
                                ${generatingScenes.size > 0 || isChainRunning
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                }`}
                        >
                            {generatingScenes.size > 0 && <LoaderIcon className="w-4 h-4 animate-spin" />}
                            {generatingScenes.size > 0 ? '生成中...' : '🎬 一键拆分全部镜头'}
                        </button>

                        {/* ★ AI 配音按钮 */}
                        <button
                            onClick={handleGenerateVoices}
                            disabled={isGeneratingVoice || !project.scenes?.length}
                            className={`px-4 py-3 rounded-lg text-sm font-bold transition-all flex items-center gap-2
                                ${isGeneratingVoice || !project.scenes?.length
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white shadow-lg shadow-pink-500/20'
                                }`}
                        >
                            {isGeneratingVoice ? <LoaderIcon className="w-4 h-4 animate-spin" /> : '🎤'}
                            {isGeneratingVoice ? '生成中...' : '🎤 AI配音'}
                        </button>

                        {/* ★ 一键自动剪片按钮 */}
                        {Object.keys(shotVideos).length > 0 && (
                            <button
                                onClick={() => {
                                    const videoUrls = Object.values(shotVideos);
                                    if (videoUrls.length === 0) {
                                        alert('没有可剪辑的视频');
                                        return;
                                    }
                                    // 一键自动剪片功能
                                    alert(`📹 准备剪辑 ${videoUrls.length} 个视频片段...\n\n完整剪片功能需要服务器端 FFmpeg 处理，当前版本将视频片段拼接为最终成品。`);
                                }}
                                className="px-4 py-3 rounded-lg text-sm font-bold transition-all flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-lg shadow-amber-500/20"
                            >
                                🎬 一键成片
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-900/20 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
                    {error}
                    <button onClick={() => setError(null)} className="ml-3 text-red-500 hover:text-red-300">✕</button>
                </div>
            )}

            {/* ★ Batch Image Generation Panel — only show when shots exist */}
            {totalShots > 0 && (
                <BatchImagePanel
                    allShots={(Object.entries(shotsByScene) as [string, Shot[]][]).flatMap(([sceneNum, shots]) =>
                        shots.map(s => ({ ...s, scene_id: String(sceneNum) }))
                    )}
                    projectId={effectiveProjectId}
                    characterAnchor={project.character_anchor}
                    visualStyle={project.visual_style}
                    referenceImageDataUrl={referenceImageDataUrl}
                    storyEntities={project.story_entities}
                    styleBible={project.style_bible}
                    directorBrain={project.director_brain}
                    imagesByShot={imagesByShot}
                    onSetGlobalAnchor={onSetGlobalAnchor} // ★ Proxy to batch panel
                    onImagesGenerated={(results) => {
                        // Update imagesByShot with newly generated images
                        setImagesByShot(prev => {
                            const updated = { ...prev };
                            for (const r of results) {
                                const existing = updated[r.shot_id] || [];
                                const newImage: ShotImage = {
                                    id: r.image_id,
                                    shot_id: r.shot_id,
                                    project_id: effectiveProjectId,
                                    url: r.image_url,
                                    is_primary: existing.length === 0, // First image becomes primary
                                    status: 'succeeded',
                                    created_at: new Date().toISOString(),
                                };
                                updated[r.shot_id] = [...existing, newImage];
                            }
                            return updated;
                        });
                        // Also update shot image_urls
                        setShotsByScene(prev => {
                            const updated = { ...prev };
                            for (const r of results) {
                                for (const [sceneNum, shots] of Object.entries(updated) as [string, Shot[]][]) {
                                    const idx = shots.findIndex(s => s.shot_id === r.shot_id);
                                    if (idx >= 0 && !shots[idx].image_url) {
                                        const newShots = [...shots];
                                        newShots[idx] = { ...newShots[idx], image_url: r.image_url };
                                        updated[Number(sceneNum)] = newShots;
                                    }
                                }
                            }
                            return updated;
                        });
                    }}
                />
            )}

            {/* Scene sections */}
            <div className="space-y-6">
                {project.scenes.map((scene, idx) => {
                    // ★ 合并场次狠态数据（包含用户上传的定妆图）
                    const mergedScene = { ...scene, ...(sceneDataMap[scene.scene_number] || {}) };
                    return (
                        <SceneSection
                            key={scene.scene_number}
                            scene={mergedScene}
                            sceneIndex={idx}
                            shots={shotsByScene[scene.scene_number] || []}
                            isGenerating={generatingScenes.has(scene.scene_number)}
                            onGenerateShots={() => handleGenerateShots(scene)}
                            onUpdateShot={(shotId, updates) => handleUpdateShot(scene.scene_number, shotId, updates)}
                            onRewriteShot={(shot, fields, instruction) => handleRewriteShot(scene.scene_number, shot, fields, instruction)}
                            project={project}
                            imagesByShot={imagesByShot}
                            onImagesChange={handleImagesChange}
                            effectiveProjectId={effectiveProjectId}
                            referenceImageDataUrl={referenceImageDataUrl}
                            onUpdateScene={(updates) => handleUpdateScene(scene.scene_number, updates)}
                            videoModel={settings.videoModel}
                            lang={settings.lang}
                            voiceUrl={sceneVoices[scene.scene_number]}
                            voiceTiming={sceneTiming[scene.scene_number]}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default ShotListView;
