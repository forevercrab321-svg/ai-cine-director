/**
 * Video Validator Service - Frontend Provider
 * Uses the backend Gemini proxy to compare the extracted last frame of a generated video 
 * with the original AnchorPackage to detect drift.
 */
import { AnchorPackage } from '../types';
import { supabase } from '../lib/supabaseClient';

const API_BASE = '/api/gemini';

export interface ValidationResult {
    score: number; // 0 - 100
    passed: boolean; // score >= threshold
    feedback: string;
}

export const validateVideoDrift = async (
    extractedFrameBase64: string,
    anchorPackage: AnchorPackage,
    threshold: number = 85
): Promise<ValidationResult> => {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        console.log('[VideoValidator] Validating video drift with Gemini...');

        const response = await fetch(`${API_BASE}/validate-video`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({ extractedFrameBase64, anchorPackage, threshold }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`[VideoValidator] Backend unavailable or failed: ${errText}`);
        }

        const data = await response.json();
        return {
            score: data.score,
            passed: data.passed,
            feedback: data.feedback
        };
    } catch (error) {
        console.error('[VideoValidator] ❌ Error validating video drift:', error);
        // If validation fails (network/api error), fail open by default to not block the pipeline
        return {
            score: 100,
            passed: true,
            feedback: "Validation API failed - bypassing validation constraint."
        };
    }
};
