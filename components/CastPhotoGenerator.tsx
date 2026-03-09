import React, { useState } from 'react';
import { StoryboardProject, StoryEntity } from '../types';
import { generateImage } from '../services/replicateService';
import { useAppContext } from '../context/AppContext';
import { PhotoIcon, LoaderIcon, CheckCircleIcon } from './IconComponents';
import { t } from '../i18n';

interface CastPhotoGeneratorProps {
    project: StoryboardProject;
    onSetGlobalAnchor: (dataUrl: string) => void;
    currentGlobalAnchor: string | null;
}

const CastPhotoGenerator: React.FC<CastPhotoGeneratorProps> = ({ project, onSetGlobalAnchor, currentGlobalAnchor }) => {
    const { settings, hasEnoughCredits, deductCredits, openPricingModal } = useAppContext();
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filter only for characters to build the cast list
    const characters = project.story_entities?.filter(e => e.type === 'character' && e.is_locked) || [];

    if (characters.length === 0) {
        return null; // Don't show the generator if there are no characters defined
    }

    const handleGenerateCastPhoto = async () => {
        // generating an image costs 1 credit
        if (!hasEnoughCredits(1)) {
            openPricingModal();
            return;
        }

        setIsGenerating(true);
        setError(null);

        // Deduct credits optimistically
        deductCredits(1);

        try {
            // Build an ensemble group photo prompt
            const characterDescriptions = characters.map(c => `[${c.name}]: ${c.description}`).join(' | ');
            const groupPrompt = `A cinematic, highly detailed wide shot ensemble cast group portrait photograph of the following characters standing together. CHARACTERS: ${characterDescriptions}. ${project.visual_style || "Extremely high quality cinematic masterpiece"}, beautifully lit, sharp focus, 8k resolution.`;

            const generatedUrl = await generateImage(
                groupPrompt,
                settings.imageModel || "flux_schnell",
                "none", // Visual style is baked into the prompt
                "16:9",
                "", // no anchor text as we are generating the anchor itself
                null, // no reference photo yet 
                characters // pass the entities to satisfy the new schema although it's generating the anchor
            );

            // Lock this image in as the whole project's visual master anchor using App.tsx callback
            onSetGlobalAnchor(generatedUrl);
        } catch (err: any) {
            if (err.message === "INSUFFICIENT_CREDITS" || err.code === "INSUFFICIENT_CREDITS") {
                openPricingModal();
            } else {
                setError(err.message || 'Failed to generate cast photo');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 mb-8 group relative overflow-hidden">
            {/* Decorative background glow */}
            <div className="absolute top-0 right-0 -m-8 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all"></div>

            <div className="flex items-start justify-between relative z-10">
                <div className="flex gap-4">
                    <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-lg h-fit">
                        <PhotoIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            演员阵容合照
                            <span className="text-xs px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded-full font-medium">Cast Master Anchor</span>
                        </h3>
                        <p className="text-sm text-slate-400 mt-1 max-w-xl">
                            系统检测到了 {characters.length} 名核心角色。为他们生成一张全家福合照作为「全片最高优先级人脸锚点」，可确保这批演员在后续所有分镜中锁定特征，绝不换人。
                        </p>

                        <div className="flex flex-wrap gap-2 mt-3">
                            {characters.map(c => (
                                <span key={c.id} className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded border border-slate-700 font-medium truncate max-w-[200px]">
                                    {c.name}
                                </span>
                            ))}
                        </div>

                        {error && <p className="text-red-400 text-xs mt-3 bg-red-900/20 p-2 rounded border border-red-900/50">{error}</p>}
                    </div>
                </div>

                <div className="flex flex-col items-end gap-3 min-w-[200px]">
                    {currentGlobalAnchor ? (
                        <div className="relative group/img cursor-pointer w-full rounded-lg overflow-hidden border-2 border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                            <img src={currentGlobalAnchor} alt="Cast Photo" className="w-full h-auto object-cover aspect-video" />
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                                <button onClick={handleGenerateCastPhoto} className="text-white text-xs font-bold bg-black/50 px-3 py-1.5 rounded-full hover:bg-indigo-600 transition-colors">
                                    重新冲洗合照
                                </button>
                            </div>
                            <div className="absolute top-2 right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg flex items-center gap-1">
                                <CheckCircleIcon className="w-3 h-3" /> 演员特征已锁定
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={handleGenerateCastPhoto}
                            disabled={isGenerating}
                            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-white font-bold transition-all shadow-lg shadow-indigo-500/20 flex flex-col items-center justify-center gap-1 group/btn"
                        >
                            {isGenerating ? (
                                <div className="flex items-center gap-2"><LoaderIcon className="w-4 h-4" /> 正在召唤演员...</div>
                            ) : (
                                <>
                                    <span className="flex items-center gap-2"><PhotoIcon className="w-4 h-4" /> 马上拍全家福</span>
                                    <span className="text-[10px] font-normal text-indigo-200">消耗 1 算力</span>
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CastPhotoGenerator;
