/**
 * ReferenceImageUploader - 参考图片上传组件
 * 用户上传角色参考图，系统通过 Gemini Vision 分析生成角色锚点描述
 */
import React, { useState, useRef } from 'react';
import { analyzeImageForAnchor } from '../services/geminiService';
import { LoaderIcon } from './IconComponents';

interface ReferenceImageUploaderProps {
    onAnchorGenerated: (anchor: string, imagePreview: string) => void;
    currentAnchor?: string;
}

const ReferenceImageUploader: React.FC<ReferenceImageUploaderProps> = ({
    onAnchorGenerated,
    currentAnchor,
}) => {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // 验证文件类型
        if (!file.type.startsWith('image/')) {
            setError('请上传图片文件（JPG、PNG、WebP）');
            return;
        }

        // 验证文件大小 (最大 10MB)
        if (file.size > 10 * 1024 * 1024) {
            setError('图片文件大小不能超过 10MB');
            return;
        }

        setError(null);
        setIsAnalyzing(true);

        try {
            // 生成预览
            const reader = new FileReader();
            reader.onload = (e) => {
                setPreviewUrl(e.target?.result as string);
            };
            reader.readAsDataURL(file);

            // 转换为 base64 用于分析 — 保留完整 data URL 前缀以正确识别 MIME 类型
            const base64 = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => {
                    const result = r.result as string;
                    // ★ 保留完整 data URL (data:image/jpeg;base64,...) 
                    // 用于 compressBase64Image 正确加载图片 + 服务端正确识别 MIME 类型
                    resolve(result);
                };
                r.onerror = reject;
                r.readAsDataURL(file);
            });

            // 调用 Gemini Vision 分析
            console.log('[RefImage] Analyzing image with Gemini Vision...');
            const anchor = await analyzeImageForAnchor(base64);

            // 回调父组件
            onAnchorGenerated(anchor, URL.createObjectURL(file));

            console.log('[RefImage] Analysis complete:', anchor);
        } catch (err: any) {
            console.error('[RefImage] Analysis error:', err);
            setError(err.message || '分析失败，请重试');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleClear = () => {
        setPreviewUrl(null);
        setError(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-lg">🖼️</span>
                    <div>
                        <h4 className="text-sm font-bold text-white">上传角色参考图</h4>
                        <p className="text-[10px] text-slate-500">
                            系统将自动分析并生成角色一致性描述
                        </p>
                    </div>
                </div>
                {previewUrl && !isAnalyzing && (
                    <button
                        onClick={handleClear}
                        className="text-xs text-slate-400 hover:text-red-400 px-2 py-1 rounded hover:bg-slate-800 transition-colors"
                    >
                        ✕ 清除
                    </button>
                )}
            </div>

            {/* 上传区域 */}
            {!previewUrl ? (
                <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 hover:bg-slate-800/50 transition-all group"
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileSelect}
                        className="hidden"
                        disabled={isAnalyzing}
                    />
                    <div className="space-y-2">
                        <div className="text-4xl opacity-50 group-hover:opacity-100 transition-opacity">
                            📸
                        </div>
                        <p className="text-sm text-slate-400 group-hover:text-indigo-400">
                            点击上传角色参考图
                        </p>
                        <p className="text-[10px] text-slate-600">
                            支持 JPG、PNG、WebP，最大 10MB
                        </p>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {/* 预览图 */}
                    <div className="relative rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
                        <img
                            src={previewUrl}
                            alt="Reference"
                            className="w-full h-48 object-cover"
                        />
                        {isAnalyzing && (
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                                <div className="text-center space-y-2">
                                    <LoaderIcon className="mx-auto text-indigo-400" />
                                    <p className="text-xs text-white font-bold">
                                        🤖 AI 正在分析角色特征...
                                    </p>
                                    <p className="text-[10px] text-slate-400">
                                        识别面部、发型、服装、风格
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 生成的锚点描述 */}
                    {currentAnchor && !isAnalyzing && (
                        <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-green-400 font-bold">✓ 分析完成</span>
                            </div>
                            <div className="text-xs text-slate-300 leading-relaxed">
                                {currentAnchor}
                            </div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full text-[10px] text-slate-400 hover:text-indigo-400 py-2 rounded-lg hover:bg-slate-800 transition-colors"
                            >
                                重新上传分析
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* 错误提示 */}
            {error && (
                <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                    <span className="text-red-400 text-xs">⚠️</span>
                    <div className="flex-1">
                        <p className="text-xs text-red-400">{error}</p>
                    </div>
                    <button
                        onClick={() => setError(null)}
                        className="text-red-400 hover:text-red-300"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* 使用说明 */}
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
                <p className="text-[10px] text-indigo-300 leading-relaxed">
                    💡 <strong>提示</strong>：上传清晰的角色图片，系统会自动识别：
                    <br />• 面部特征（五官、肤色）
                    <br />• 发型和发色
                    <br />• 服装和配饰
                    <br />• 艺术风格
                    <br />生成的描述将用于所有场景，确保角色一致性。
                </p>
            </div>
        </div>
    );
};

export default ReferenceImageUploader;
