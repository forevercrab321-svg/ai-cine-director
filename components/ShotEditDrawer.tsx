/**
 * ShotEditDrawer — Slide-out panel for editing a single shot's fields.
 * Supports field-level locking, AI rewrite, and inline editing.
 */
import React, { useState, useCallback } from 'react';
import { Shot, CameraType, CameraMovement, TimeOfDay, LocationType } from '../types';
import { LoaderIcon } from './IconComponents';

interface ShotEditDrawerProps {
    shot: Shot;
    onClose: () => void;
    onSave: (updates: Partial<Shot>) => void;
    onRewrite: (fields: string[], instruction: string) => void;
    projectContext: {
        visual_style: string;
        character_anchor: string;
        scene_title: string;
    };
}

// Field definitions for rendering the edit form
type FieldDef = {
    key: keyof Shot;
    label: string;
    group: string;
    type: 'text' | 'textarea' | 'number' | 'select' | 'tags';
    options?: string[];
    placeholder?: string;
};

const FIELD_DEFS: FieldDef[] = [
    // Camera & Movement
    { key: 'camera', label: '机位 Camera', group: '📷 Camera', type: 'select', options: ['wide','medium','close','ecu','over-shoulder','pov','aerial','two-shot'] },
    { key: 'lens', label: '镜头 Lens', group: '📷 Camera', type: 'text', placeholder: 'e.g. 35mm anamorphic' },
    { key: 'movement', label: '运镜 Movement', group: '📷 Camera', type: 'select', options: ['static','push-in','pull-out','pan-left','pan-right','tilt-up','tilt-down','dolly','tracking','crane','handheld','steadicam','whip-pan','zoom'] },
    { key: 'composition', label: '构图 Composition', group: '📷 Camera', type: 'text', placeholder: 'Rule of thirds, center frame...' },
    { key: 'duration_sec', label: '时长 (秒)', group: '📷 Camera', type: 'number' },

    // Location
    { key: 'location_type', label: '场景类型', group: '📍 Location', type: 'select', options: ['INT','EXT','INT/EXT'] },
    { key: 'location', label: '地点 Location', group: '📍 Location', type: 'text', placeholder: 'Rooftop garden, Tokyo' },
    { key: 'time_of_day', label: '时间 Time', group: '📍 Location', type: 'select', options: ['dawn','morning','noon','afternoon','golden-hour','dusk','night','blue-hour'] },

    // Characters & Action
    { key: 'characters', label: '角色 Characters', group: '🎭 Action', type: 'tags', placeholder: 'Enter character names' },
    { key: 'action', label: '动作描述 Action', group: '🎭 Action', type: 'textarea', placeholder: 'What happens in this shot' },
    { key: 'dialogue', label: '台词 Dialogue', group: '🎭 Action', type: 'textarea', placeholder: 'Character dialogue (optional)' },

    // Visual
    { key: 'lighting', label: '灯光 Lighting', group: '🎨 Visual', type: 'textarea', placeholder: 'Key light, color temp, practicals...' },
    { key: 'art_direction', label: '美术 Art Direction', group: '🎨 Visual', type: 'textarea', placeholder: 'Set dressing, props, wardrobe...' },
    { key: 'mood', label: '氛围 Mood', group: '🎨 Visual', type: 'text', placeholder: 'Tense, melancholic, euphoric...' },
    { key: 'sfx_vfx', label: '特效 SFX/VFX', group: '🎨 Visual', type: 'text', placeholder: 'Rain, fog, sparks...' },

    // Audio
    { key: 'audio_notes', label: '音效 Audio Notes', group: '🔊 Audio', type: 'textarea', placeholder: 'Sound design, music cues...' },
    { key: 'continuity_notes', label: '连续性 Continuity', group: '🔊 Audio', type: 'textarea', placeholder: 'Match with previous/next shot...' },

    // Image Generation
    { key: 'image_prompt', label: '图片提示词 Image Prompt', group: '🖼 Generation', type: 'textarea', placeholder: 'Full image generation prompt...' },
    { key: 'negative_prompt', label: '负面提示词 Negative', group: '🖼 Generation', type: 'textarea', placeholder: 'What to avoid...' },
];

const ShotEditDrawer: React.FC<ShotEditDrawerProps> = ({ shot, onClose, onSave, onRewrite, projectContext }) => {
    // Local editable state (copy of shot fields)
    const [draft, setDraft] = useState<Record<string, any>>(() => {
        const d: Record<string, any> = {};
        for (const f of FIELD_DEFS) {
            d[f.key] = (shot as any)[f.key];
        }
        return d;
    });

    const [lockedFields, setLockedFields] = useState<Set<string>>(new Set(shot.locked_fields));
    const [rewriteInstruction, setRewriteInstruction] = useState('');
    const [selectedRewriteFields, setSelectedRewriteFields] = useState<Set<string>>(new Set());
    const [isRewriting, setIsRewriting] = useState(false);
    const [showRewritePanel, setShowRewritePanel] = useState(false);

    const toggleLock = (field: string) => {
        setLockedFields(prev => {
            const next = new Set(prev);
            next.has(field) ? next.delete(field) : next.add(field);
            return next;
        });
    };

    const toggleRewriteField = (field: string) => {
        if (lockedFields.has(field)) return; // Can't rewrite locked fields
        setSelectedRewriteFields(prev => {
            const next = new Set(prev);
            next.has(field) ? next.delete(field) : next.add(field);
            return next;
        });
    };

    const handleSave = () => {
        const updates: Partial<Shot> = {};
        for (const f of FIELD_DEFS) {
            if (JSON.stringify(draft[f.key]) !== JSON.stringify((shot as any)[f.key])) {
                (updates as any)[f.key] = draft[f.key];
            }
        }
        updates.locked_fields = Array.from(lockedFields);
        onSave(updates);
    };

    const handleRewrite = async () => {
        const fields = Array.from(selectedRewriteFields);
        if (!fields.length) return;

        setIsRewriting(true);
        try {
            onRewrite(fields, rewriteInstruction);
        } finally {
            setIsRewriting(false);
            setShowRewritePanel(false);
            setSelectedRewriteFields(new Set());
            setRewriteInstruction('');
        }
    };

    const updateField = (key: string, value: any) => {
        setDraft(prev => ({ ...prev, [key]: value }));
    };

    // Group fields
    const groups: Record<string, FieldDef[]> = {};
    for (const f of FIELD_DEFS) {
        (groups[f.group] = groups[f.group] || []).push(f);
    }

    // Tag input handler
    const handleTagInput = (key: string, value: string) => {
        const tags = value.split(',').map(s => s.trim()).filter(Boolean);
        updateField(key, tags);
    };

    return (
        <div className="fixed inset-0 z-50 flex">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            {/* Drawer */}
            <div className="relative ml-auto w-full max-w-lg bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 h-full overflow-hidden">
                {/* Header */}
                <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-lg font-bold text-white">
                            Shot {shot.shot_number}
                            <span className="text-sm text-slate-500 ml-2 font-normal">v{shot.version}</span>
                        </h3>
                        <p className="text-xs text-slate-500">{shot.scene_title}</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setShowRewritePanel(!showRewritePanel)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                showRewritePanel
                                    ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30'
                                    : 'bg-slate-800 text-slate-400 hover:text-amber-400 hover:bg-amber-600/10'
                            }`}
                        >
                            🤖 AI Rewrite
                        </button>
                        <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none px-2">×</button>
                    </div>
                </div>

                {/* AI Rewrite panel (collapsible) */}
                {showRewritePanel && (
                    <div className="px-5 py-3 border-b border-amber-500/20 bg-amber-900/10 shrink-0 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <p className="text-xs text-amber-300 font-bold uppercase tracking-wider">选择要重写的字段（🔒 已锁定字段不可重写）</p>
                        <div className="flex flex-wrap gap-1.5">
                            {FIELD_DEFS.map(f => {
                                const isLocked = lockedFields.has(f.key);
                                const isSelected = selectedRewriteFields.has(f.key);
                                return (
                                    <button
                                        key={f.key}
                                        onClick={() => toggleRewriteField(f.key)}
                                        disabled={isLocked}
                                        className={`text-[10px] px-2 py-1 rounded border transition-all
                                            ${isLocked
                                                ? 'bg-slate-800/50 text-slate-600 border-slate-700 cursor-not-allowed'
                                                : isSelected
                                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-amber-500/30'
                                            }`}
                                    >
                                        {isLocked && '🔒 '}{f.label}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex gap-2">
                            <input
                                value={rewriteInstruction}
                                onChange={e => setRewriteInstruction(e.target.value)}
                                placeholder="导演指令: 更戏剧化、更紧张..."
                                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-amber-500/50 outline-none"
                            />
                            <button
                                onClick={handleRewrite}
                                disabled={isRewriting || selectedRewriteFields.size === 0}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1
                                    ${isRewriting || selectedRewriteFields.size === 0
                                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                        : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                            >
                                {isRewriting && <LoaderIcon className="w-3 h-3 animate-spin" />}
                                {isRewriting ? '重写中...' : `重写 ${selectedRewriteFields.size} 个字段`}
                            </button>
                        </div>
                    </div>
                )}

                {/* Scrollable form */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
                    {Object.entries(groups).map(([groupName, fields]) => (
                        <div key={groupName}>
                            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">{groupName}</h4>
                            <div className="space-y-3">
                                {fields.map(f => {
                                    const isLocked = lockedFields.has(f.key);
                                    return (
                                        <div key={f.key} className={`relative ${isLocked ? 'opacity-60' : ''}`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <label className="text-[11px] text-slate-400 font-medium">{f.label}</label>
                                                <button
                                                    onClick={() => toggleLock(f.key)}
                                                    className={`text-[10px] px-1.5 py-0.5 rounded transition-all
                                                        ${isLocked
                                                            ? 'text-amber-400 bg-amber-500/10 hover:bg-amber-500/20'
                                                            : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
                                                        }`}
                                                    title={isLocked ? '点击解锁此字段' : '点击锁定此字段（AI 重写时不修改）'}
                                                >
                                                    {isLocked ? '🔒' : '🔓'}
                                                </button>
                                            </div>

                                            {f.type === 'select' ? (
                                                <select
                                                    value={draft[f.key] as string}
                                                    onChange={e => updateField(f.key, e.target.value)}
                                                    disabled={isLocked}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none disabled:cursor-not-allowed"
                                                >
                                                    {f.options?.map(opt => (
                                                        <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                </select>
                                            ) : f.type === 'textarea' ? (
                                                <textarea
                                                    value={draft[f.key] as string}
                                                    onChange={e => updateField(f.key, e.target.value)}
                                                    disabled={isLocked}
                                                    placeholder={f.placeholder}
                                                    rows={3}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none resize-none disabled:cursor-not-allowed"
                                                />
                                            ) : f.type === 'number' ? (
                                                <input
                                                    type="number"
                                                    value={draft[f.key] as number}
                                                    onChange={e => updateField(f.key, parseFloat(e.target.value) || 0)}
                                                    disabled={isLocked}
                                                    step={0.5}
                                                    min={0.5}
                                                    max={30}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none disabled:cursor-not-allowed"
                                                />
                                            ) : f.type === 'tags' ? (
                                                <input
                                                    value={Array.isArray(draft[f.key]) ? (draft[f.key] as string[]).join(', ') : ''}
                                                    onChange={e => handleTagInput(f.key, e.target.value)}
                                                    disabled={isLocked}
                                                    placeholder={f.placeholder}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none disabled:cursor-not-allowed"
                                                />
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={draft[f.key] as string}
                                                    onChange={e => updateField(f.key, e.target.value)}
                                                    disabled={isLocked}
                                                    placeholder={f.placeholder}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none disabled:cursor-not-allowed"
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-slate-800 flex justify-between items-center shrink-0">
                    <span className="text-[10px] text-slate-600">
                        🔒 {lockedFields.size} locked • v{shot.version}
                    </span>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg shadow-lg shadow-indigo-500/20 transition-all"
                        >
                            保存修改
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ShotEditDrawer;
