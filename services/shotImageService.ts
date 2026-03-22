/**
 * Shot Image Service — Frontend proxy for shot-level image generation & editing.
 * All requests proxied through backend server (no API keys exposed).
 */
import {
    ShotImage, ImageGeneration, ImageModel, AspectRatio, VideoStyle,
    ImageEditMode, CREDIT_COSTS, IMAGE_MODEL_COSTS, ContinuityConfig,
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

export interface StoryboardValidationResult {
    shot_context_pack: any;
    continuity_report: {
        shot_id: string;
        continuity_score: number;
        narrative_score: number;
        visual_match_score: number;
        violation_tags: string[];
        regen_recommendation: string;
        validated_at: string;
    };
    candidate_id: string;
    stage: string;
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
    anchor_image_url?: string;  // ★ Reference image URL for Flux Redux consistency
    referenceImageDataUrl?: string; // ★ NEW: Fast forwarding base64 image reference to backend
    continuity?: ContinuityConfig;
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
    continuity?: ContinuityConfig;
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

export async function validateStoryboardShot(params: {
    project_id: string;
    shot_id: string;
    image_url?: string;
    shot?: any;
    previous_shot?: any;
    scene_state?: any;
    character_state?: any;
}): Promise<StoryboardValidationResult> {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/storyboard/${params.project_id}/shots/${params.shot_id}/validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Storyboard validation failed (${response.status})`);
    }
    return await response.json();
}

export async function approveStoryboardShot(params: {
    project_id: string;
    shot_id: string;
    image_url?: string;
}): Promise<any> {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/storyboard/${params.project_id}/shots/${params.shot_id}/approve`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
    });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Storyboard approval failed (${response.status})`);
    }
    return await response.json();
}

export async function regenerateStoryboardShot(params: {
    project_id: string;
    shot_id: string;
    mode:
    | 'regenerate_same_shot_keep_bible'
    | 'regenerate_same_shot_change_framing'
    | 'regenerate_same_shot_fix_face'
    | 'regenerate_same_shot_fix_costume'
    | 'regenerate_same_shot_fix_scene'
    | 'regenerate_from_shot_forward'
    | 'freeze_approved_shots';
    reason?: string;
}): Promise<any> {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/storyboard/${params.project_id}/shots/${params.shot_id}/regenerate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
    });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Storyboard regeneration failed (${response.status})`);
    }
    return await response.json();
}

export async function getPipelineStatus(projectId: string): Promise<any> {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/pipeline/${projectId}/status`, { method: 'GET', headers });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Pipeline status failed (${response.status})`);
    }
    return await response.json();
}

export async function getAssemblyManifest(projectId: string): Promise<any> {
    const headers = await getAuthHeaders();
    const response = await fetch(`/api/storyboard/${projectId}/assembly-manifest`, { method: 'GET', headers });
    if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(errData.error || `Assembly manifest failed (${response.status})`);
    }
    return await response.json();
}
