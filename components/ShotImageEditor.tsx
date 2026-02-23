/**
 * ShotImageEditor — Modal for editing an existing shot image.
 * Supports 3 edit modes: reroll, reference edit, attribute edit.
 * Shows current prompt and allows delta instructions.
 */
import React, { useState } from 'react';
import { Shot, ShotImage, ImageEditMode } from '../types';
import { editShotImage, getImageCost } from '../services/shotImageService';
import { useAppContext } from '../context/AppContext';
import { LoaderIcon } from './IconComponents';

interface ShotImageEditorProps {
    image: ShotImage;
    shot: Shot;
    characterAnchor: string;
    projectId?: string;
    onClose: () => void;
    onEditComplete: (newImage: ShotImage) => void;
}

const EDIT_MODES: { id: ImageEditMode; label: string; icon: string; desc: string }[] = [
    { id: 'reroll', label: 'Re-roll', icon: '🎲', desc: '相同提示词，不同随机种子' },
    { id: 'reference_edit', label: '参考编辑', icon: '🖼', desc: '保持构图/主体，修改指定属性' },
    { id: 'attribute_edit', label: '属性修改', icon: '🎨', desc: '只改灯光/色彩/服装/背景等' },
];

const LOCKABLE_ATTRIBUTES = [
    'character', 'composition', 'background', 'lighting', 'color_palette',
    'costume', 'pose', 'expression', 'art_style', 'camera_angle',
];

const ShotImageEditor: React.FC<ShotImageEditorProps> = ({
    image, shot, characterAnchor, projectId, onClose, onEditComplete,
}) => {
    const { settings, userState, hasEnoughCredits, openPricingModal, refreshBalance, deductCredits } = useAppContext();

    const [editMode, setEditMode] = useState<ImageEditMode>('attribute_edit');
    const [deltaInstruction, setDeltaInstruction] = useState('');
    const [lockedAttributes, setLockedAttributes] = useState<Set<string>>(new Set(['character', 'composition']));
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const cost = getImageCost(settings.imageModel);

    const toggleAttribute = (attr: string) => {
        setLockedAttributes(prev => {
            const next = new Set(prev);
            next.has(attr) ? next.delete(attr) : next.add(attr);
            return next;
        });
    };

    const handleEdit = async () => {
        if (editMode !== 'reroll' && !deltaInstruction.trim()) {
            setError('请输入修改指令');
            return;
        }
        if (!userState.isAdmin && !hasEnoughCredits(cost)) return openPricingModal();

        setIsProcessing(true);
        setError(null);

        if (!userState.isAdmin) deductCredits(cost);

        try {
            const result = await editShotImage({
                image_id: image.id,
                edit_mode: editMode,
                delta_instruction: deltaInstruction,
                original_prompt: image.generation?.prompt || shot.image_prompt,
                negative_prompt: shot.negative_prompt,
                reference_image_url: editMode === 'reference_edit' ? image.url : undefined,
                locked_attributes: editMode === 'attribute_edit' ? Array.from(lockedAttributes) : undefined,
                model: settings.imageModel,
                aspect_ratio: settings.aspectRatio,
                style: settings.videoStyle,
                character_anchor: characterAnchor,
                reference_policy: shot.reference_policy,
                shot_id: shot.shot_id,
                project_id: projectId,
            });

            const newImage: ShotImage = {
                ...result.image,
                is_primary: false,
                generation: result.generation,
            };

            setPreviewUrl(newImage.url);
            refreshBalance().catch(() => {});

            // Auto-close after a short delay
            setTimeout(() => onEditComplete(newImage), 500);

        } catch (e: any) {
            await refreshBalance();
            if (e.code === 'INSUFFICIENT_CREDITS') {
                openPricingModal();
            } else {
                setError(e.message || 'Edit failed');
            }
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-white">编辑图片</h3>
                        <p className="text-xs text-slate-500">Shot {shot.shot_number} • {image.label || `Image ${image.id.slice(0, 6)}`}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none px-2">×</button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Current image preview */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1 block">原图</span>
                            <img src={image.url} alt="Original" className="w-full rounded-lg border border-slate-800" />
                        </div>
                        {previewUrl && (
                            <div>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1 block">新图</span>
                                <img src={previewUrl} alt="Edited" className="w-full rounded-lg border border-green-500/30" />
                            </div>
                        )}
                    </div>

                    {/* Current prompt display */}
                    <div>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">当前 Prompt</span>
                        <p className="text-xs text-slate-400 font-mono bg-slate-900 rounded-lg p-3 mt-1 max-h-20 overflow-y-auto leading-relaxed">
                            {image.generation?.prompt || shot.image_prompt || '—'}
                        </p>
                    </div>

                    {/* Edit mode selection */}
                    <div>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-2 block">编辑模式</span>
                        <div className="grid grid-cols-3 gap-2">
                            {EDIT_MODES.map(mode => (
                                <button
                                    key={mode.id}
                                    onClick={() => setEditMode(mode.id)}
                                    className={`px-3 py-2.5 rounded-lg text-left transition-all border
                                        ${editMode === mode.id
                                            ? 'bg-indigo-600/20 border-indigo-500/40 text-white'
                                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                                        }`}
                                >
                                    <span className="text-lg">{mode.icon}</span>
                                    <p className="text-xs font-bold mt-1">{mode.label}</p>
                                    <p className="text-[10px] text-slate-500 mt-0.5">{mode.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Delta instruction (not needed for reroll) */}
                    {editMode !== 'reroll' && (
                        <div>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1 block">
                                修改指令 {editMode === 'attribute_edit' ? '(描述要改变的部分)' : '(描述新的效果)'}
                            </span>
                            <textarea
                                value={deltaInstruction}
                                onChange={e => setDeltaInstruction(e.target.value)}
                                placeholder={editMode === 'attribute_edit'
                                    ? '例: 改为黄金时段光线、添加雨滴效果、换成红色礼服...'
                                    : '例: 保持角色和构图，将背景改为雪景...'
                                }
                                rows={3}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-indigo-500 outline-none resize-none"
                            />
                        </div>
                    )}

                    {/* Locked attributes (for attribute_edit mode) */}
                    {editMode === 'attribute_edit' && (
                        <div>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-2 block">
                                🔒 保持不变的属性（AI 不会修改这些）
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                                {LOCKABLE_ATTRIBUTES.map(attr => (
                                    <button
                                        key={attr}
                                        onClick={() => toggleAttribute(attr)}
                                        className={`text-[10px] px-2.5 py-1 rounded-full border transition-all font-medium
                                            ${lockedAttributes.has(attr)
                                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                                : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600'
                                            }`}
                                    >
                                        {lockedAttributes.has(attr) ? '🔒 ' : ''}{attr}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-500/20">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-[10px] text-slate-600">
                        费用: {cost} credits • 模型: {settings.imageModel}
                    </span>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleEdit}
                            disabled={isProcessing}
                            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2
                                ${isProcessing
                                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                                }`}
                        >
                            {isProcessing && <LoaderIcon className="w-3 h-3 animate-spin" />}
                            {isProcessing
                                ? '处理中...'
                                : editMode === 'reroll'
                                    ? `🎲 Re-roll (${cost} cr)`
                                    : `✨ 应用修改 (${cost} cr)`
                            }
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ShotImageEditor;
