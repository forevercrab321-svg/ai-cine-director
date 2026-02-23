/**
 * Shot Service — Frontend proxy for shot-level API calls
 * All requests go through backend server, no API keys exposed.
 */
import { Shot, ShotRevision, ShotRewriteRequest, Language } from '../types';
import { supabase } from '../lib/supabaseClient';

const API_BASE = '/api/shots';

async function getAuthHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
    };
}

/**
 * Generate detailed shots from a scene description via Gemini
 */
export async function generateShots(params: {
    scene_number: number;
    visual_description: string;
    audio_description: string;
    shot_type: string;
    visual_style: string;
    character_anchor: string;
    language: Language;
    num_shots?: number;
}): Promise<{ scene_title: string; shots: Shot[] }> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error || `Shot generation failed (${response.status})`);
    }

    return await response.json();
}

/**
 * AI-rewrite specific fields of a shot, respecting locked fields
 */
export async function rewriteShotFields(params: {
    shot_id: string;
    fields_to_rewrite: string[];
    user_instruction: string;
    locked_fields: string[];
    current_shot: Partial<Shot>;
    project_context: {
        visual_style: string;
        character_anchor: string;
        scene_title: string;
    };
    language: Language;
}): Promise<{
    shot_id: string;
    rewritten_fields: Partial<Shot>;
    change_source: 'ai-rewrite';
    changed_fields: string[];
}> {
    const headers = await getAuthHeaders();

    const response = await fetch(`${API_BASE}/${params.shot_id}/rewrite`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(err.error || `Shot rewrite failed (${response.status})`);
    }

    return await response.json();
}
