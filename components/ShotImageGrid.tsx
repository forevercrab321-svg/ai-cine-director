/**
 * ShotImageGrid — Displays images for a shot in a grid layout.
 * Shows primary image prominently, other images as thumbnails.
 * Includes generate/reroll/edit buttons per image.
 */
import React, { useState } from 'react';
import { Shot, ShotImage, ImageModel, AspectRatio, VideoStyle } from '../types';
import { generateShotImage, editShotImage, getImageCost, GenerateImageResult } from '../services/shotImageService';
import { useAppContext } from '../context/AppContext';
import { LoaderIcon } from './IconComponents';
import ShotImageEditor from './ShotImageEditor';

interface ShotImageGridProps {
    shot: Shot;
    images: ShotImage[];
    onImagesChange: (images: ShotImage[]) => void;
    characterAnchor: string;
    visualStyle: string;
    projectId?: string;
}

const ShotImageGrid: React.FC<ShotImageGridProps> = ({
    shot, images, onImagesChange, characterAnchor, visualStyle, projectId,
}) => {
    const { settings, userState, isAuthenticated, hasEnoughCredits, openPricingModal, refreshBalance, deductCredits } = useAppContext();
    const [isGenerating, setIsGenerating] = useState(false);
    const [editingImage, setEditingImage] = useState<ShotImage | null>(null);
    const [error, setError] = useState<string | null>(null);

    const primaryImage = images.find(i => i.is_primary) || images[0];
    const otherImages = images.filter(i => i.id !== primaryImage?.id);

    const imageCost = getImageCost(settings.imageModel);

    const handleGenerate = async (deltaInstruction?: string) => {
        if (!isAuthenticated) return alert('请先登录');
        if (!userState.isAdmin && !hasEnoughCredits(imageCost)) return openPricingModal();

        setIsGenerating(true);
        setError(null);

        // Optimistic deduct
        if (!userState.isAdmin) deductCredits(imageCost);

        try {
            const result = await generateShotImage({
                shot_id: shot.shot_id,
                prompt: shot.image_prompt,
                negative_prompt: shot.negative_prompt,
                delta_instruction: deltaInstruction,
                model: settings.imageModel,
                aspect_ratio: settings.aspectRatio,
                style: settings.videoStyle,
                seed: shot.seed_hint,
                character_anchor: characterAnchor,
                reference_policy: shot.reference_policy,
                project_id: projectId,
            });

            const newImage: ShotImage = {
                ...result.image,
                is_primary: images.length === 0, // First image becomes primary
                generation: result.generation,
            };

            onImagesChange([...images, newImage]);
            refreshBalance().catch(() => {});
        } catch (e: any) {
            await refreshBalance();
            if (e.code === 'INSUFFICIENT_CREDITS') {
                openPricingModal();
            } else {
                setError(e.message || 'Generation failed');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleReroll = async (img: ShotImage) => {
        if (!isAuthenticated) return;
        if (!userState.isAdmin && !hasEnoughCredits(imageCost)) return openPricingModal();

        setIsGenerating(true);
        setError(null);

        if (!userState.isAdmin) deductCredits(imageCost);

        try {
            const result = await editShotImage({
                image_id: img.id,
                edit_mode: 'reroll',
                delta_instruction: '',
                original_prompt: img.generation?.prompt || shot.image_prompt,
                negative_prompt: shot.negative_prompt,
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

            onImagesChange([...images, newImage]);
            refreshBalance().catch(() => {});
        } catch (e: any) {
            await refreshBalance();
            if (e.code === 'INSUFFICIENT_CREDITS') openPricingModal();
            else setError(e.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSetPrimary = (imageId: string) => {
        onImagesChange(images.map(img => ({
            ...img,
            is_primary: img.id === imageId,
        })));
    };

    const handleEditComplete = (newImage: ShotImage) => {
        onImagesChange([...images, newImage]);
        setEditingImage(null);
    };

    const handleDeleteImage = (imageId: string) => {
        const filtered = images.filter(i => i.id !== imageId);
        // If we deleted the primary, promote the first remaining
        if (filtered.length > 0 && !filtered.some(i => i.is_primary)) {
            filtered[0].is_primary = true;
        }
        onImagesChange(filtered);
    };

    return (
        <div className="space-y-3">
            {/* Error */}
            {error && (
                <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-500/20 flex justify-between items-center">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300 ml-2">✕</button>
                </div>
            )}

            {/* No images yet */}
            {images.length === 0 && (
                <div className="border-2 border-dashed border-slate-700 rounded-xl p-6 text-center">
                    <p className="text-slate-500 text-sm mb-3">尚未生成图片</p>
                    <button
                        onClick={() => handleGenerate()}
                        disabled={isGenerating}
                        className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 mx-auto
                            ${isGenerating
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                : 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-500/20'
                            }`}
                    >
                        {isGenerating && <LoaderIcon className="w-3 h-3 animate-spin" />}
                        {isGenerating ? '生成中...' : `🎨 生成图片 (${imageCost} credits)`}
                    </button>
                </div>
            )}

            {/* Primary image (large) */}
            {primaryImage && (
                <div className="relative group rounded-xl overflow-hidden border border-slate-700 bg-slate-900">
                    <img
                        src={primaryImage.url}
                        alt={`Shot ${shot.shot_number} primary`}
                        className="w-full h-auto max-h-64 object-cover"
                        loading="lazy"
                    />
                    {/* Overlay controls */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                            onClick={() => handleReroll(primaryImage)}
                            disabled={isGenerating}
                            className="px-3 py-1.5 bg-slate-800/90 hover:bg-sky-600 text-white text-xs rounded-lg font-bold transition-all disabled:opacity-50"
                        >
                            🎲 Re-roll
                        </button>
                        <button
                            onClick={() => setEditingImage(primaryImage)}
                            className="px-3 py-1.5 bg-slate-800/90 hover:bg-amber-600 text-white text-xs rounded-lg font-bold transition-all"
                        >
                            ✏️ Edit
                        </button>
                        <button
                            onClick={() => handleGenerate()}
                            disabled={isGenerating}
                            className="px-3 py-1.5 bg-slate-800/90 hover:bg-green-600 text-white text-xs rounded-lg font-bold transition-all disabled:opacity-50"
                        >
                            ➕ New
                        </button>
                    </div>
                    {/* Primary badge */}
                    <div className="absolute top-2 left-2 bg-indigo-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                        Primary
                    </div>
                    {isGenerating && (
                        <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                            <LoaderIcon className="w-8 h-8 text-sky-400 animate-spin" />
                        </div>
                    )}
                </div>
            )}

            {/* Other images (thumbnail grid) */}
            {otherImages.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                    {otherImages.map(img => (
                        <div key={img.id} className="relative group rounded-lg overflow-hidden border border-slate-800 bg-slate-900 cursor-pointer aspect-video">
                            <img
                                src={img.url}
                                alt={img.label || `Take`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                                <button
                                    onClick={() => handleSetPrimary(img.id)}
                                    className="px-1.5 py-1 bg-indigo-600/90 text-white text-[9px] rounded font-bold"
                                    title="设为主图"
                                >
                                    ⭐
                                </button>
                                <button
                                    onClick={() => setEditingImage(img)}
                                    className="px-1.5 py-1 bg-amber-600/90 text-white text-[9px] rounded font-bold"
                                    title="编辑"
                                >
                                    ✏️
                                </button>
                                <button
                                    onClick={() => handleDeleteImage(img.id)}
                                    className="px-1.5 py-1 bg-red-600/90 text-white text-[9px] rounded font-bold"
                                    title="删除"
                                >
                                    🗑
                                </button>
                            </div>
                            {img.label && (
                                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-slate-300 px-1.5 py-0.5 truncate">
                                    {img.label}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Image editor modal */}
            {editingImage && (
                <ShotImageEditor
                    image={editingImage}
                    shot={shot}
                    characterAnchor={characterAnchor}
                    projectId={projectId}
                    onClose={() => setEditingImage(null)}
                    onEditComplete={handleEditComplete}
                />
            )}
        </div>
    );
};

export default ShotImageGrid;
