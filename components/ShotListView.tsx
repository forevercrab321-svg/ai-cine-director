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

interface ShotListViewProps {
    project: StoryboardProject;
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
    isExpanded: boolean;
    onToggle: () => void;
    onEdit: () => void;
    onLockToggle: (field: string) => void;
    images: ShotImage[];
    onImagesChange: (images: ShotImage[]) => void;
    characterAnchor: string;
    visualStyle: string;
    projectId?: string;
}> = ({ shot, isExpanded, onToggle, onEdit, onLockToggle, images, onImagesChange, characterAnchor, visualStyle, projectId }) => {
    const camClass = cameraBadgeColor[shot.camera] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    const moveEmoji = movementBadge[shot.movement] || '🎬';

    return (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden hover:border-slate-700 transition-all group">
            {/* Header row — always visible */}
            <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                onClick={onToggle}
            >
                {/* Thumbnail */}
                {(() => {
                    const primary = images.find(i => i.is_primary) || images[0];
                    return primary ? (
                        <img src={primary.url} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-700 shrink-0" />
                    ) : (
                        <div className="w-10 h-10 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-bold text-sm shrink-0">
                            {shot.shot_number}
                        </div>
                    );
                })()}

                {/* Camera + Movement badges */}
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${camClass}`}>
                    {shot.camera}
                </span>
                <span className="text-xs" title={shot.movement}>
                    {moveEmoji} {shot.movement}
                </span>

                {/* Duration */}
                <span className="text-xs text-slate-500 font-mono">{shot.duration_sec}s</span>

                {/* Action preview */}
                <span className="text-xs text-slate-400 truncate flex-1">{shot.action}</span>

                {/* Locked indicator */}
                {shot.locked_fields.length > 0 && (
                    <span className="text-[10px] text-amber-400" title={`Locked: ${shot.locked_fields.join(', ')}`}>
                        🔒 {shot.locked_fields.length}
                    </span>
                )}

                {/* Edit button */}
                <button
                    onClick={(e) => { e.stopPropagation(); onEdit(); }}
                    className="opacity-0 group-hover:opacity-100 text-xs text-indigo-400 hover:text-indigo-300 transition-all px-2 py-1 rounded hover:bg-indigo-500/10"
                >
                    ✏️ Edit
                </button>

                {/* Expand chevron */}
                <svg
                    className={`w-4 h-4 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </div>

            {/* Expanded detail panel */}
            {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-800/50 pt-3 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Row 1: Location + Time */}
                    <div className="grid grid-cols-3 gap-3 text-xs">
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Location</span>
                            <p className="text-slate-300">{shot.location_type}. {shot.location}</p>
                        </div>
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Time</span>
                            <p className="text-slate-300">{shot.time_of_day}</p>
                        </div>
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Lens</span>
                            <p className="text-slate-300">{shot.lens}</p>
                        </div>
                    </div>

                    {/* Row 2: Characters + Dialogue */}
                    {(shot.characters.length > 0 || shot.dialogue) && (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                                <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Characters</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                    {shot.characters.map((c, i) => (
                                        <span key={i} className="bg-violet-500/15 text-violet-300 border border-violet-500/20 px-2 py-0.5 rounded text-[10px]">{c}</span>
                                    ))}
                                </div>
                            </div>
                            {shot.dialogue && (
                                <div>
                                    <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Dialogue</span>
                                    <p className="text-slate-300 italic">"{shot.dialogue}"</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Row 3: Composition + Lighting + Mood */}
                    <div className="grid grid-cols-3 gap-3 text-xs">
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Composition</span>
                            <p className="text-slate-300">{shot.composition || '—'}</p>
                        </div>
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Lighting</span>
                            <p className="text-slate-300">{shot.lighting || '—'}</p>
                        </div>
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Mood</span>
                            <p className="text-slate-300">{shot.mood || '—'}</p>
                        </div>
                    </div>

                    {/* Row 4: Art Direction + SFX */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Art Direction</span>
                            <p className="text-slate-300">{shot.art_direction || '—'}</p>
                        </div>
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">SFX / VFX</span>
                            <p className="text-slate-300">{shot.sfx_vfx || '—'}</p>
                        </div>
                    </div>

                    {/* Row 5: Audio + Continuity */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Audio Notes</span>
                            <p className="text-slate-300">{shot.audio_notes || '—'}</p>
                        </div>
                        <div>
                            <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Continuity</span>
                            <p className="text-slate-300">{shot.continuity_notes || '—'}</p>
                        </div>
                    </div>

                    {/* Image prompt preview */}
                    <div className="text-xs">
                        <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold">Image Prompt</span>
                        <p className="text-slate-400 font-mono text-[11px] bg-slate-950 rounded p-2 mt-1 leading-relaxed max-h-20 overflow-y-auto">
                            {shot.image_prompt || '—'}
                        </p>
                    </div>

                    {/* ★ Shot Image Grid — generate / edit / manage images */}
                    <div className="mt-3 pt-3 border-t border-slate-800/50">
                        <span className="text-slate-500 uppercase tracking-wider text-[10px] font-bold mb-2 block">🖼 Images</span>
                        <ShotImageGrid
                            shot={shot}
                            images={images}
                            onImagesChange={onImagesChange}
                            characterAnchor={characterAnchor}
                            visualStyle={visualStyle}
                            projectId={projectId}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

// ── Scene section with shots ──
const SceneSection: React.FC<{
    scene: Scene;
    sceneIndex: number;
    shots: Shot[];
    isGenerating: boolean;
    onGenerateShots: () => void;
    onUpdateShot: (shotId: string, updates: Partial<Shot>) => void;
    onRewriteShot: (shot: Shot, fields: string[], instruction: string) => void;
    project: StoryboardProject;
    imagesByShot: Record<string, ShotImage[]>;
    onImagesChange: (shotId: string, images: ShotImage[]) => void;
    effectiveProjectId: string;  // ★ 添加 projectId prop
}> = ({ scene, sceneIndex, shots, isGenerating, onGenerateShots, onUpdateShot, onRewriteShot, project, imagesByShot, onImagesChange, effectiveProjectId }) => {
    const [expandedShots, setExpandedShots] = useState<Set<string>>(new Set());
    const [editingShot, setEditingShot] = useState<Shot | null>(null);

    const toggleShot = (id: string) => {
        setExpandedShots(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const expandAll = () => setExpandedShots(new Set(shots.map(s => s.shot_id)));
    const collapseAll = () => setExpandedShots(new Set());

    return (
        <div className="bg-slate-950/50 border border-slate-800 rounded-2xl overflow-hidden">
            {/* Scene header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="text-indigo-400 font-bold text-sm uppercase tracking-wider">Scene {scene.scene_number}</span>
                        {shots.length > 0 && (
                            <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                                {shots.length} shots
                            </span>
                        )}
                    </div>
                    {scene.scene_setting && (
                        <p className="text-xs text-amber-400/70 mt-1 font-medium">📍 {scene.scene_setting}</p>
                    )}
                    <p className="text-xs text-slate-500 mt-1 max-w-xl truncate">{scene.visual_description}</p>
                </div>

                <div className="flex gap-2">
                    {shots.length > 0 && (
                        <>
                            <button onClick={expandAll} className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800">展开全部</button>
                            <button onClick={collapseAll} className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800">折叠全部</button>
                        </>
                    )}
                    <button
                        onClick={onGenerateShots}
                        disabled={isGenerating}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2
                            ${isGenerating
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                : shots.length > 0
                                    ? 'bg-slate-800 hover:bg-amber-600/20 text-amber-400 border border-amber-500/20 hover:border-amber-500/40'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                            }`}
                    >
                        {isGenerating && <LoaderIcon className="w-3 h-3 animate-spin" />}
                        {isGenerating ? '生成中...' : shots.length > 0 ? '🔄 重新拆分' : '🎬 AI 拆分镜头'}
                    </button>
                </div>
            </div>

            {/* Shot list */}
            {shots.length > 0 ? (
                <div className="p-3 space-y-2">
                    {shots.map(shot => (
                        <ShotCard
                            key={shot.shot_id}
                            shot={shot}
                            isExpanded={expandedShots.has(shot.shot_id)}
                            onToggle={() => toggleShot(shot.shot_id)}
                            onEdit={() => setEditingShot(shot)}
                            onLockToggle={(field) => {
                                const isLocked = shot.locked_fields.includes(field);
                                onUpdateShot(shot.shot_id, {
                                    locked_fields: isLocked
                                        ? shot.locked_fields.filter(f => f !== field)
                                        : [...shot.locked_fields, field]
                                });
                            }}
                            images={imagesByShot[shot.shot_id] || []}
                            onImagesChange={(imgs) => onImagesChange(shot.shot_id, imgs)}
                            characterAnchor={project.character_anchor}
                            visualStyle={project.visual_style}
                            projectId={effectiveProjectId}
                        />
                    ))}
                </div>
            ) : (
                <div className="p-8 text-center text-slate-600 text-sm">
                    <p>点击 "AI 拆分镜头" 将此场景细分为详细镜头列表</p>
                    <p className="text-[10px] mt-2 text-slate-700">每个镜头包含 25+ 字段：机位、运镜、灯光、美术、台词、音效等</p>
                </div>
            )}

            {/* Shot edit drawer */}
            {editingShot && (
                <ShotEditDrawer
                    shot={editingShot}
                    onClose={() => setEditingShot(null)}
                    onSave={(updates) => {
                        onUpdateShot(editingShot.shot_id, updates);
                        setEditingShot(null);
                    }}
                    onRewrite={(fields, instruction) => {
                        onRewriteShot(editingShot, fields, instruction);
                    }}
                    projectContext={{
                        visual_style: project.visual_style,
                        character_anchor: project.character_anchor,
                        scene_title: `Scene ${scene.scene_number}`,
                    }}
                />
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════
// Main ShotListView component
// ═══════════════════════════════════════════════════════════════
const ShotListView: React.FC<ShotListViewProps> = ({ project, onBack }) => {
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
            refreshBalance().catch(() => {});
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
            refreshBalance().catch(() => {});
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
                    <div className="flex gap-3">
                        <button
                            onClick={onBack}
                            className="px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                        >
                            ← 返回剧本
                        </button>
                        <button
                            onClick={handleGenerateAll}
                            disabled={generatingScenes.size > 0}
                            className={`px-6 py-3 rounded-lg text-sm font-bold transition-all flex items-center gap-2
                                ${generatingScenes.size > 0
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                }`}
                        >
                            {generatingScenes.size > 0 && <LoaderIcon className="w-4 h-4 animate-spin" />}
                            {generatingScenes.size > 0 ? '生成中...' : '🎬 一键拆分全部镜头'}
                        </button>
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
                {project.scenes.map((scene, idx) => (
                    <SceneSection
                        key={scene.scene_number}
                        scene={scene}
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
                    />
                ))}
            </div>
        </div>
    );
};

export default ShotListView;
