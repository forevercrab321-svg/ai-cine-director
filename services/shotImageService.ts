/**
 * Shot Image Service — Frontend proxy for shot-level image generation & editing.
 * All requests proxied through backend server (no API keys exposed).
 */
import {
    ShotImage, ImageGeneration, ImageModel, AspectRatio, VideoStyle,
    ImageEditMode, CREDIT_COSTS, IMAGE_MODEL_COSTS,
} from '../types';
import { supabase } from '../lib/supabaseClient';

const API_BASE = '/api/shot-images';

async function getAuthHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('请先登录以生成内容。');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
    };
}

// ── Types for service responses ──
export interface GenerateImageResult {
    image: ShotImage;
    generation: ImageGeneration;
}

export interface EditImageResult {
    image: ShotImage;
    generation: ImageGeneration;
}

/**
 * Generate a new image for a specific shot.
 * Uses the shot's image_prompt by default, with optional overrides.
 */
export async function generateShotImage(params: {
    shot_id: string;
    prompt: string;
    negative_prompt?: string;
    delta_instruction?: string;
    model?: ImageModel;
    aspect_ratio?: AspectRatio;
    style?: VideoStyle;
    seed?: number | null;
    character_anchor?: string;
    reference_policy?: 'none' | 'anchor' | 'first-frame' | 'previous-frame';
    project_id?: string;
}): Promise<GenerateImageResult> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/${params.shot_id}/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
    });

    if (response.status === 402) {
        const err: any = new Error('INSUFFICIENT_CREDITS');
        err.code = 'INSUFFICIENT_CREDITS';
        throw err;
    }

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Image generation failed (${response.status})`);
    }

    return await response.json();
}

/**
 * Edit an existing image (reroll / reference edit / attribute edit).
 */
export async function editShotImage(params: {
    image_id: string;
    edit_mode: ImageEditMode;
    delta_instruction: string;
    original_prompt: string;
    negative_prompt?: string;
    reference_image_url?: string;
    locked_attributes?: string[];
    model?: ImageModel;
    aspect_ratio?: AspectRatio;
    style?: VideoStyle;
    seed?: number | null;
    character_anchor?: string;
    reference_policy?: 'none' | 'anchor' | 'first-frame' | 'previous-frame';
    shot_id: string;
    project_id?: string;
}): Promise<EditImageResult> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/${params.image_id}/edit`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
    });

    if (response.status === 402) {
        const err: any = new Error('INSUFFICIENT_CREDITS');
        err.code = 'INSUFFICIENT_CREDITS';
        throw err;
    }

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Image edit failed (${response.status})`);
    }

    return await response.json();
}

/**
 * Get estimated cost for an image operation.
 */
export function getImageCost(model: ImageModel = 'flux'): number {
    return IMAGE_MODEL_COSTS[model] ?? CREDIT_COSTS.IMAGE_FLUX;
}
