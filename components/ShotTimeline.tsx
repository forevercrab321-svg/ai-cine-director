import React, { useState } from 'react';
import { Scene, StoryboardProject, Language } from '../types';
import { t } from '../i18n';

interface Props {
    project: StoryboardProject;
    lang: Language;
    onShotClick?: (scene: Scene) => void;
}

const CAMERA_COLOR: Record<string, string> = {
    wide:           'from-blue-500   to-blue-700',
    medium:         'from-violet-500 to-violet-700',
    close:          'from-amber-500  to-amber-700',
    ecu:            'from-rose-500   to-rose-700',
    'over-shoulder':'from-teal-500   to-teal-700',
    pov:            'from-emerald-500 to-emerald-700',
    aerial:         'from-sky-500    to-sky-700',
};

const FUNCTION_DOT: Record<string, string> = {
    setup:          'bg-blue-400',
    confrontation:  'bg-rose-400',
    revelation:     'bg-amber-400',
    climax:         'bg-red-500',
    resolution:     'bg-emerald-400',
    transition:     'bg-slate-400',
};

const MOVEMENT_ICON: Record<string, string> = {
    static:     '⊞',
    'push-in':  '▶',
    'pull-out': '◀',
    'pan-left': '↩',
    'pan-right':'↪',
    'tilt-up':  '↑',
    'tilt-down':'↓',
    dolly:      '⟶',
    tracking:   '⟿',
    handheld:   '〜',
    crane:      '↗',
    steadicam:  '◉',
};

interface SceneGroup {
    scene_id: string;
    scene_title: string;
    dramatic_function: string;
    tension_level: number;
    shots: Scene[];
}

function groupByScene(scenes: Scene[]): SceneGroup[] {
    const groups: Map<string, SceneGroup> = new Map();
    for (const scene of scenes) {
        const sid = (scene as any).scene_id || String(scene.scene_number);
        if (!groups.has(sid)) {
            groups.set(sid, {
                scene_id: sid,
                scene_title: scene.scene_title || (scene as any).scene_setting || `Scene`,
                dramatic_function: (scene as any).dramatic_function || '',
                tension_level: scene.tension_level || 5,
                shots: [],
            });
        }
        groups.get(sid)!.shots.push(scene);
    }
    return Array.from(groups.values());
}

const TensionBar: React.FC<{ level: number }> = ({ level }) => {
    const pct = Math.min(100, Math.max(0, (level / 10) * 100));
    const color = level >= 8 ? '#ef4444' : level >= 5 ? '#f59e0b' : '#22d3ee';
    return (
        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        </div>
    );
};

const ShotChip: React.FC<{ shot: Scene; idx: number; onPress?: () => void }> = ({ shot, idx, onPress }) => {
    const [hovered, setHovered] = useState(false);
    const cameraKey = (shot as any).camera_angle || 'medium';
    const gradient = CAMERA_COLOR[cameraKey] || 'from-slate-500 to-slate-700';
    const moveIcon = MOVEMENT_ICON[(shot as any).camera_motion || 'static'] || '⊞';

    // Width proportional to duration_sec — real Gemini value or tension-aware fallback (set in api/index.ts)
    const duration = Math.max(2, shot.duration_sec || 4);
    const widthPx = Math.min(120, Math.max(48, duration * 14));

    const hasVideo = !!(shot.video_url);
    const hasImage = !!(shot.image_url);

    return (
        <div
            className="relative flex-shrink-0 cursor-pointer group"
            style={{ width: widthPx }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={onPress}
        >
            {/* Shot block */}
            <div className={`h-14 rounded-lg bg-gradient-to-b ${gradient} flex flex-col items-center justify-center relative overflow-hidden border border-white/10 hover:border-white/30 transition-all shadow-md`}>
                {/* Thumbnail overlay */}
                {hasImage && shot.image_url && (
                    <img src={shot.image_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity" />
                )}
                {/* Status dot */}
                <div className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${hasVideo ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : hasImage ? 'bg-amber-400' : 'bg-slate-500'}`} />
                {/* Shot number */}
                <span className="text-[10px] font-bold text-white/80 z-10">{idx + 1}</span>
                {/* Movement icon */}
                <span className="text-[10px] text-white/60 z-10">{moveIcon}</span>
                {/* Duration */}
                <span className="text-[9px] text-white/40 z-10">{duration}s</span>
            </div>

            {/* Connector line to next shot */}
            <div className="absolute top-7 -right-1.5 w-3 h-px bg-slate-600 z-20" />

            {/* Hover tooltip */}
            {hovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 min-w-48 max-w-64 pointer-events-none">
                    <div className="bg-slate-900 border border-slate-600 rounded-lg shadow-2xl p-2.5 text-[10px] space-y-1">
                        <p className="text-slate-200 font-bold text-xs capitalize">{cameraKey} shot</p>
                        <p className="text-slate-400 leading-relaxed">{shot.visual_description?.substring(0, 100) || (shot as any).action || '—'}</p>
                        {shot.dialogue_text && (
                            <p className="text-amber-300/80 italic">"{shot.dialogue_text.substring(0, 60)}"</p>
                        )}
                        {shot.emotional_beat && (
                            <p className="text-rose-400/70">🎭 {shot.emotional_beat.substring(0, 60)}</p>
                        )}
                    </div>
                    {/* Arrow */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-600" />
                </div>
            )}
        </div>
    );
};

const ShotTimeline: React.FC<Props> = ({ project, lang, onShotClick }) => {
    const scenes = project.scenes || [];
    if (scenes.length === 0) return null;

    const groups = groupByScene(scenes);
    const totalDuration = scenes.reduce((acc, s) => acc + Math.max(2, (s as any).duration_sec || 4), 0);

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-1 h-6 rounded-full bg-gradient-to-b from-amber-500 to-rose-600" />
                    <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300">
                        🎞 {t(lang, 'shotTimeline')}
                    </h3>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-slate-500">
                    <span>{scenes.length} {t(lang, 'shots')}</span>
                    <span>≈ {Math.round(totalDuration)}s total</span>
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 px-1 text-[9px] text-slate-600 uppercase tracking-wider">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Video done</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />Image done</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-slate-500 inline-block" />Pending</span>
            </div>

            {/* Scene groups */}
            <div className="space-y-4">
                {groups.map((group, gIdx) => (
                    <div key={group.scene_id} className="bg-slate-900/60 border border-slate-700/50 rounded-xl overflow-hidden">
                        {/* Scene header */}
                        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/40">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-500 font-mono">S{gIdx + 1}</span>
                                {group.dramatic_function && (
                                    <span className={`inline-block w-2 h-2 rounded-full ${FUNCTION_DOT[group.dramatic_function] || 'bg-slate-500'}`} />
                                )}
                                <span className="text-xs text-slate-300 font-medium truncate max-w-48">{group.scene_title}</span>
                                {group.dramatic_function && (
                                    <span className="text-[9px] uppercase text-slate-600 tracking-wider">{group.dramatic_function}</span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <TensionBar level={group.tension_level} />
                                <span className="text-[9px] text-slate-600 w-8 text-right">T{group.tension_level}</span>
                                <span className="text-[9px] text-slate-500">{group.shots.length} shots</span>
                            </div>
                        </div>

                        {/* Shot chips row */}
                        <div className="px-4 py-3 overflow-x-auto">
                            <div className="flex items-center gap-2 min-w-max">
                                {group.shots.map((shot, sIdx) => (
                                    <ShotChip
                                        key={(shot as any).shot_id || sIdx}
                                        shot={shot}
                                        idx={sIdx}
                                        onPress={() => onShotClick?.(shot)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ShotTimeline;
