/**
 * Shot Bible Service - Frontend Provider
 * Uses the backend Gemini proxy to analyze an image and return an AnchorPackage and ShotBible.
 */
import { AnchorPackage, ShotBible } from '../types';
import { supabase } from '../lib/supabaseClient';

const API_BASE = '/api/gemini';

/**
 * 压缩 base64 图片以避免 413 错误（Vercel 限制 4.5MB）
 */
const compressBase64Image = (base64Data: string, maxSizeKB: number = 500): Promise<string> => {
    return new Promise((resolve) => {
        const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
        const sizeKB = (rawBase64.length * 3) / 4 / 1024;

        if (sizeKB <= maxSizeKB) {
            resolve(base64Data);
            return;
        }

        const dataUrl = base64Data.includes(',') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
        const img = new Image();

        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;

            const maxDim = 800;
            if (width > maxDim || height > maxDim) {
                const ratio = Math.min(maxDim / width, maxDim / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };

        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
};

export const extractShotBible = async (
    base64Data: string
): Promise<{ bible: ShotBible; anchorPackage: AnchorPackage }> => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        console.log('[ShotBible] Analyzing image with Gemini Pro Vision...');
        const compressedData = await compressBase64Image(base64Data, 400);

        const response = await fetch(`${API_BASE}/analyze-bible`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({ base64Data: compressedData }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`[ShotBible] Backend unavailable or failed: ${errText}`);
        }

        const data = await response.json();
        return {
            bible: data.bible,
            anchorPackage: data.anchorPackage
        };
    } catch (error) {
        console.error('[ShotBible] ❌ Error extracting shot bible:', error);
        throw error;
    }
};
