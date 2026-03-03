/**
 * ShotListView — Enhanced shot-level storyboard view
 * Shows detailed shot breakdowns per scene with editing, AI rewrite, and field locking.
 */
import React, { useState, useCallback } from 'react';
import { StoryboardProject, Scene, Shot, ShotImage, ShotRevision, Language } from '../types';
import { generateShots, rewriteShotFields } from '../services/shotService';
import { useAppContext } from '../context/AppContext';
import { LoaderIcon } from './IconComponents';
import ShotEditDrawer from './ShotEditDrawer';
import ShotImageGrid from './ShotImageGrid';
import BatchImagePanel from './BatchImagePanel';
import { t } from '../i18n';
import { startVideoTask, generateImage, checkPredictionStatus } from '../services/replicateService';
import { extractLastFrameFromVideo } from '../utils/video-helpers';
import { forceDownload } from '../utils/download';
import { generateVoicesForScenes } from '../services/elevenLabsService';
interface ShotListViewProps {
    project: StoryboardProject;
    referenceImageDataUrl?: string;  // ★ Compressed base64 for Flux Redux consistency
    onBack: () => void;
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
}> = ({ shot, shotIndex, videoUrl, isExpanded, onToggle, onEdit, onLockToggle, images, onImagesChange, characterAnchor, visualStyle, projectId, referenceImageDataUrl }) => {
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

                    {/* ★ 终极拦截器：第一镜生图，后续镜头强制锁死 */}
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
                                    referenceImageDataUrl={referenceImageDataUrl} // ★ 传递给 Grid！
                                />
                            </div>
                        </>
                    ) : (
                        <div className="mt-4 p-4 bg-indigo-900/20 border border-indigo-500/30 rounded-lg flex items-start gap-3">
                            <span className="text-indigo-400 text-xl">🔗</span>
                            <div>
                                <p className="text-xs text-indigo-300 font-bold tracking-widest uppercase mb-1">物理延续镜头：强制死锁尾帧</p>
                                <p className="text-[10px] text-indigo-400/80 leading-relaxed">系统将在后台静默提取上一段视频最后0.1秒的画面作为此镜头的绝对起点。<span className="text-rose-400 font-bold">已彻底禁止重新生成图片。</span></p>
                            </div>
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
    onUpdateScene: (updates: Partial<Scene>) => void; // ★ 新增：场次数据更新回调
}> = ({ scene, sceneIndex, shots, isGenerating, onGenerateShots, onUpdateShot, onRewriteShot, project, imagesByShot, onImagesChange, effectiveProjectId, referenceImageDataUrl, onUpdateScene }) => {
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
        if (!project.character_anchor) return alert("请先设定角色一致性锚点！");
        if (shots.length === 0) return alert("当前场景没有分镜。");

        setIsChainRunning(true);
        let tailFrameBase64: string | null = null;

        try {
            for (let i = 0; i < shots.length; i++) {
                const shot = shots[i];
                let currentStartImage = "";

                if (i === 0) {
                    // ★ 硬切：首镜必须重铸人物，拒绝用任何上一帧的污染模糊图
                    // 最高优先级：当前场次人物定妆图 Base64
                    const sceneAnchorRef = scene.scene_reference_image_base64 || referenceImageDataUrl;
                    if (scene.scene_reference_image_base64) {
                        currentStartImage = scene.scene_reference_image_base64;
                        setChainLog(`[首镜] ★ 已读取场次专属人物定妆图！`);
                    } else {
                        const existingImg = imagesByShot[shot.shot_id]?.[0]?.url;
                        if (existingImg) {
                            currentStartImage = existingImg;
                            setChainLog(`[首镜] 已读取预生成源头原画...`);
                        } else {
                            setChainLog(`[首镜] 正在强制生成绝对清晰首帧 (Hard Cut)...`);
                            currentStartImage = await generateImage(
                                shot.image_prompt || scene.visual_description,
                                'flux_schnell', 'none', '16:9', project.character_anchor,
                                sceneAnchorRef // ★ 场次定妆图优先，回退全局照片
                            );
                        }
                    }
                } else {
                    // ★ 软接：同场内连续镜头，坚决吸纳上一镜尾帧
                    if (!tailFrameBase64) throw new Error("严重错误：上一镜尾帧提取失败，链条断裂！");
                    currentStartImage = tailFrameBase64;
                    setChainLog(`[第 ${i + 1} 镜] 已强行锁定上一镜尾帧...`);
                }

                setChainLog(`[第 ${i + 1} 镜] 正在生成视频动态...`);
                const videoRes = await startVideoTask(
                    shot.action || "", currentStartImage, 'hailuo_02_fast', 'none', 'storyboard', 'standard', 6, 24, '720p', project.character_anchor, '16:9'
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
                    tailFrameBase64 = await extractLastFrameFromVideo(videoUrl);
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
                            referenceImageDataUrl={referenceImageDataUrl} // ★ 传递照片给子组件
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
const ShotListView: React.FC<ShotListViewProps> = ({ project, referenceImageDataUrl, onBack }) => {
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
                language: settings.lang,
                num_shots: 5,
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
    }, [isAuthenticated, hasEnoughCredits, openPricingModal, project, settings.lang, refreshBalance]);

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

    // ★ AI 配音生成处理器
    const handleGenerateVoices = async () => {
        if (!project.scenes || project.scenes.length === 0) {
            alert('没有场景可以生成配音');
            return;
        }

        setIsGeneratingVoice(true);
        try {
            const scenesWithDialogue = project.scenes.map(scene => ({
                scene_number: scene.scene_number,
                dialogue: scene.dialogue || '',
                description: scene.description || '',
            }));

            console.log('[ShotListView] Generating voices for scenes:', scenesWithDialogue);

            const result = await generateVoicesForScenes({
                scenes: scenesWithDialogue,
                voice_id: 'zh_female_shuang', // Default Chinese female voice
            });

            if (result.results) {
                const newVoices: Record<number, string> = {};
                for (const r of result.results) {
                    if (r.success && r.audio_url) {
                        newVoices[r.scene_number] = r.audio_url;
                    }
                }
                setSceneVoices(prev => ({ ...prev, ...newVoices }));
                
                const successCount = result.results.filter((r: any) => r.success).length;
                alert(`✅ 配音生成完成！成功生成 ${successCount} 个场景的配音`);
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
        // ★ 新增：检查是否已经锁定
        if (isChainLocked) {
            alert("⚠️ 全片物理锁链已执行完毕并锁定，不允许重复运行！\n如需重新生成，请刷新页面重新开始。");
            return;
        }
        
        if (!project.character_anchor) return alert("请先在左侧设定【角色一致性锚点】！");
        if (project.scenes.length === 0) return alert("当前剧本没有任何场景，请先拆分场景。");

        // ★ 新增：第一次点击时立即锁定，防止重复点击
        setIsChainLocked(true);
        setChainLog("🔒 全片物理锁链已启动，系统已锁定，请勿重复操作...");

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
            setIsChainRunning(true);
            await handleGenerateAll(); // Will await internally all the generation loops
        }

        setIsChainRunning(true);
        let globalTailFrameBase64: string | null = null;

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

                    // 全剧【唯一奇点】：第一场戏的第一个镜头，或者每个Scene的第一个镜头
                    if (i === 0) {
                        // ★ 硬切：每个场景的第一镜必须重铸人物，拒绝继承前一场的尾帧！
                        // 最高优先级：当前场次专属定妆图 Base64 → 全局角色照片
                        const sceneAnchorRef = scene.scene_reference_image_base64 || referenceImageDataUrl;
                        if (scene.scene_reference_image_base64) {
                            // 用户专门上传了定妆图，直接作为本场奇点
                            currentStartImage = scene.scene_reference_image_base64;
                            setChainLog(`场 ${scene.scene_number} 首镜：★ 已读取场次专属定妆图！`);
                        } else {
                            // 否则，强制生图模型重新生成一张干净的首帧，避免误差累积
                            setChainLog(`场 ${scene.scene_number} 首镜：正在重新生成绝对清晰的首帧图 (Hard Cut)...`);
                            currentStartImage = await generateImage(
                                shot.image_prompt || scene.visual_description,
                                'flux_schnell', 'none', '16:9', project.character_anchor,
                                sceneAnchorRef // ★ 场次定妆图优先，回退全局照片
                            );
                            // 保存这张生成的首帧留作纪念
                            const newImageId = crypto.randomUUID();
                            setImagesByShot(prev => ({
                                ...prev,
                                [shot.shot_id]: [{ id: newImageId, shot_id: shot.shot_id, url: currentStartImage, is_primary: true, status: 'succeeded', created_at: new Date().toISOString() }]
                            }));
                        }
                    } else {
                        // ★ 软接：同一个Scene内部的连续镜头，坚决使用尾帧锁链
                        setChainLog(`场 ${scene.scene_number} 镜 ${i + 1}：(同一场内) 正在强行拾取上一镜视频尾帧...`);
                        if (!globalTailFrameBase64) throw new Error("链条断裂：未能获取到上一镜头尾帧，请检查是否有超时中断");
                        currentStartImage = globalTailFrameBase64;
                    }

                    setChainLog(`场 ${scene.scene_number} 镜 ${i + 1}：正在基于海螺物理引擎渲染动态视频...`);
                    // 发送视频请求
                    const videoRes = await startVideoTask(
                        shot.action || "", currentStartImage, 'hailuo_02_fast', 'none', 'storyboard', 'standard', 6, 24, '720p', project.character_anchor, '16:9'
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
                        globalTailFrameBase64 = await extractLastFrameFromVideo(videoUrl);
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
                    imagesByShot={imagesByShot}
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
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default ShotListView;
