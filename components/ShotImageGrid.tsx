/**
 * ShotImageGrid — Displays images for a shot in a grid layout.
 * Shows primary image prominently, other images as thumbnails.
 * Includes generate/reroll/edit/download/video buttons per image.
 */
import React, { useState, useRef } from 'react';
import { Shot, ShotImage, ImageModel, AspectRatio, VideoStyle, MODEL_COSTS } from '../types';
import { generateShotImage, editShotImage, getImageCost, GenerateImageResult } from '../services/shotImageService';
import { startVideoTask, checkPredictionStatus } from '../services/replicateService';
import { useAppContext } from '../context/AppContext';
import { LoaderIcon } from './IconComponents';
import ShotImageEditor from './ShotImageEditor';

// Icons
const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

const VideoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
);

interface ShotImageGridProps {
    shot: Shot;
    images: ShotImage[];
    onImagesChange: (images: ShotImage[]) => void;
    characterAnchor: string;
    visualStyle: string;
    projectId?: string;
    referenceImageDataUrl?: string; // ★ 新增：接收大哥照片的管道
}

const ShotImageGrid: React.FC<ShotImageGridProps> = ({
    shot, images, onImagesChange, characterAnchor, visualStyle, projectId, referenceImageDataUrl
}) => {
    const { settings, userState, isAuthenticated, hasEnoughCredits, openPricingModal, refreshBalance, deductCredits } = useAppContext();
    const [isGenerating, setIsGenerating] = useState(false);
    const [editingImage, setEditingImage] = useState<ShotImage | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Video generation state
    const [generatingVideoForImage, setGeneratingVideoForImage] = useState<string | null>(null);
    const [videoUrl, setVideoUrl] = useState<string | null>(shot.video_url || null);
    const [videoError, setVideoError] = useState<string | null>(null);
    const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const primaryImage = images.find(i => i.is_primary) || images[0];
    const otherImages = images.filter(i => i.id !== primaryImage?.id);

    const imageCost = getImageCost(settings.imageModel);
    const videoCost = MODEL_COSTS[settings.videoModel] || 28;

    // Download image helper (blob fetch - works cross-origin)
    const handleDownload = async (imageUrl: string, filename: string) => {
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (e) {
            console.error('Download failed:', e);
            window.open(imageUrl, '_blank');
        }
    };

    // Force download video with explicit video/mp4 MIME type (fixes cross-origin UUID filename bug)
    const forceDownloadVideo = async (fileUrl: string, filename: string) => {
        try {
            const res = await fetch(fileUrl, { mode: 'cors' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            const blob = new Blob([buf], { type: 'video/mp4' });
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        } catch (e) {
            console.error('Video download failed, fallback:', e);
            const a = document.createElement('a');
            a.href = fileUrl;
            a.download = filename;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }
    };

    // Generate video from image
    const handleGenerateVideo = async (img: ShotImage) => {
        if (!isAuthenticated) return alert('请先登录');
        if (!userState.isAdmin && !hasEnoughCredits(videoCost)) return openPricingModal();
        if (!img.url) return;

        setGeneratingVideoForImage(img.id);
        setVideoError(null);

        if (!userState.isAdmin) deductCredits(videoCost);

        try {
            const motionPrompt = shot.action || shot.image_prompt || 'Cinematic motion';
            const prediction = await startVideoTask(
                motionPrompt,
                img.url,
                settings.videoModel,
                settings.videoStyle,
                'storyboard',
                'standard',
                6,
                24,
                '720p',
                characterAnchor
            );

            // Poll for completion
            let result = prediction;
            while (['starting', 'processing'].includes(result.status)) {
                await new Promise(r => setTimeout(r, 3000));
                result = await checkPredictionStatus(result.id);
            }

            if (result.status === 'succeeded' && result.output) {
                const url = Array.isArray(result.output) ? result.output[0] : result.output;
                setVideoUrl(url);
            } else {
                throw new Error(result.error || 'Video generation failed');
            }

            refreshBalance().catch(() => { });
        } catch (e: any) {
            await refreshBalance();
            if (e.code === 'INSUFFICIENT_CREDITS') {
                openPricingModal();
            } else {
                setVideoError(e.message || 'Video generation failed');
            }
        } finally {
            setGeneratingVideoForImage(null);
        }
    };

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
                referenceImageDataUrl: referenceImageDataUrl, // ★ 把照片正式递给中间商！
            });

            const newImage: ShotImage = {
                ...result.image,
                is_primary: images.length === 0, // First image becomes primary
                generation: result.generation,
            };

            onImagesChange([...images, newImage]);
            refreshBalance().catch(() => { });
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
            refreshBalance().catch(() => { });
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
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                        {/* Row 1: Image operations */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleReroll(primaryImage)}
                                disabled={isGenerating || generatingVideoForImage !== null}
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
                                disabled={isGenerating || generatingVideoForImage !== null}
                                className="px-3 py-1.5 bg-slate-800/90 hover:bg-green-600 text-white text-xs rounded-lg font-bold transition-all disabled:opacity-50"
                            >
                                ➕ New
                            </button>
                        </div>
                        {/* Row 2: Download + Video */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => handleDownload(primaryImage.url, `shot-${shot.shot_number}-primary.jpg`)}
                                className="px-3 py-1.5 bg-slate-800/90 hover:bg-emerald-600 text-white text-xs rounded-lg font-bold transition-all flex items-center gap-1.5"
                            >
                                <DownloadIcon /> 下载
                            </button>
                            <button
                                onClick={() => handleGenerateVideo(primaryImage)}
                                disabled={isGenerating || generatingVideoForImage !== null}
                                className="px-3 py-1.5 bg-slate-800/90 hover:bg-violet-600 text-white text-xs rounded-lg font-bold transition-all disabled:opacity-50 flex items-center gap-1.5"
                            >
                                <VideoIcon /> {generatingVideoForImage === primaryImage.id ? '生成中...' : `生成视频 (${videoCost})`}
                            </button>
                        </div>
                    </div>
                    {/* Primary badge */}
                    <div className="absolute top-2 left-2 bg-indigo-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                        Primary
                    </div>
                    {(isGenerating || generatingVideoForImage === primaryImage.id) && (
                        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2">
                            <LoaderIcon className="w-8 h-8 text-sky-400 animate-spin" />
                            <span className="text-xs text-slate-300">{generatingVideoForImage === primaryImage.id ? '视频生成中...' : '图片生成中...'}</span>
                        </div>
                    )}
                </div>
            )}

            {/* Video preview */}
            {videoUrl && (
                <div className="rounded-xl overflow-hidden border border-violet-500/30 bg-slate-900">
                    <div className="flex items-center justify-between px-3 py-2 bg-violet-600/20 border-b border-violet-500/20">
                        <span className="text-xs font-bold text-violet-300">🎬 生成的视频</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); forceDownloadVideo(videoUrl, `shot-${shot.shot_number}-video.mp4`); }}
                            className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 bg-transparent border-0 cursor-pointer"
                        >
                            <DownloadIcon /> 下载视频
                        </button>
                    </div>
                    <div
                        className="relative cursor-pointer group"
                        onClick={() => setIsVideoModalOpen(true)}
                    >
                        <video
                            src={videoUrl}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full max-h-48 object-contain bg-black"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-white text-sm font-medium">🎬 点击全屏播放</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Video fullscreen modal */}
            {isVideoModalOpen && videoUrl && (
                <div
                    className="fixed inset-0 bg-black/95 z-[9999] flex flex-col"
                    onClick={() => setIsVideoModalOpen(false)}
                >
                    {/* Header with close and download buttons */}
                    <div className="flex items-center justify-between p-4 bg-black/80">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsVideoModalOpen(false);
                            }}
                            className="flex items-center gap-2 text-white hover:text-violet-300 transition-colors"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                            <span>返回</span>
                        </button>
                        <span className="text-white font-medium">镜头 {shot.shot_number} - 视频</span>
                        <button
                            onClick={(e) => { e.stopPropagation(); forceDownloadVideo(videoUrl, `shot-${shot.shot_number}-video.mp4`); }}
                            className="flex items-center gap-2 text-white hover:text-violet-300 transition-colors bg-violet-600/30 px-4 py-2 rounded-lg cursor-pointer border-0"
                        >
                            <DownloadIcon /> 下载
                        </button>
                    </div>

                    {/* Video player */}
                    <div
                        className="flex-1 flex items-center justify-center p-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <video
                            ref={videoRef}
                            src={videoUrl}
                            controls
                            autoPlay
                            loop
                            className="max-w-full max-h-full rounded-lg"
                            style={{ maxHeight: 'calc(100vh - 120px)' }}
                        />
                    </div>
                </div>
            )}

            {/* Video error */}
            {videoError && (
                <div className="text-xs text-red-400 bg-red-900/20 px-3 py-2 rounded border border-red-500/20 flex justify-between items-center">
                    <span>视频生成失败: {videoError}</span>
                    <button onClick={() => setVideoError(null)} className="text-red-500 hover:text-red-300 ml-2">✕</button>
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
