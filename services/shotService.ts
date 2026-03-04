/**
 * Shot Service — Frontend proxy for shot-level API calls
 * All requests go through backend server, no API keys exposed.
 * Supports mock mode when backend is unavailable.
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

// Mock shot generator for offline mode
function generateMockShots(params: {
    scene_number: number;
    visual_description: string;
    shot_type: string;
    num_shots?: number;
}): { scene_title: string; shots: Shot[] } {
    const numShots = params.num_shots || 5;
    const shots: Shot[] = [];
    
    const shotTypes = [
        { camera: 'wide', movement: 'static' as const, lens: '35mm' },
        { camera: 'medium', movement: 'push-in' as const, lens: '50mm' },
        { camera: 'close', movement: 'static' as const, lens: '85mm' },
        { camera: 'ecu', movement: 'pull-out' as const, lens: '135mm' },
        { camera: 'over-shoulder', movement: 'tracking' as const, lens: '70mm' },
    ];
    
    for (let i = 0; i < numShots; i++) {
        const shotType = shotTypes[i % shotTypes.length];
        shots.push({
            shot_id: `shot-${params.scene_number}-${i + 1}`,
            scene_id: `scene-${params.scene_number}`,
            scene_title: `Scene ${params.scene_number}`,
            shot_number: i + 1,
            duration_sec: 4,
            location_type: 'INT',
            location: 'Location to be determined',
            time_of_day: 'day',
            characters: ['Character'],
            action: params.visual_description.slice(0, 100),
            dialogue: '',
            camera: shotType.camera,
            lens: shotType.lens,
            movement: shotType.movement,
            composition: 'Rule of thirds',
            lighting: 'Natural daylight',
            art_direction: 'Clean and modern',
            mood: 'Cinematic',
            sfx_vfx: 'None',
            audio_notes: 'Ambient sound',
            continuity_notes: '',
            image_prompt: `${params.visual_description}, ${params.shot_type}, shot ${i + 1}`,
            negative_prompt: '',
            seed_hint: null,
            reference_policy: 'none',
            status: 'draft' as const,
            locked_fields: [],
            version: 1,
            updated_at: new Date().toISOString(),
        });
    }
    
    return {
        scene_title: `Scene ${params.scene_number}`,
        shots,
    };
}

/**
 * Generate detailed shots from a scene description via Gemini
 * Falls back to mock mode when backend is unavailable
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

    try {
        const response = await fetch(`${API_BASE}/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            // Fallback to mock mode
            console.warn('[ShotService] Backend unavailable, using mock mode');
            return generateMockShots(params);
        }

        return await response.json();
    } catch (error) {
        console.error('[ShotService] Error:', error);
        // Fallback to mock mode
        console.log('[ShotService] Using mock mode as fallback');
        return generateMockShots(params);
    }
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

    try {
        const response = await fetch(`${API_BASE}/${params.shot_id}/rewrite`, {
            method: 'POST',
            headers,
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            console.warn('[ShotService] Rewrite backend unavailable, using mock');
            return {
                shot_id: params.shot_id,
                rewritten_fields: params.current_shot,
                change_source: 'ai-rewrite',
                changed_fields: params.fields_to_rewrite,
            };
        }

        return await response.json();
    } catch (error) {
        console.error('[ShotService] Rewrite error:', error);
        return {
            shot_id: params.shot_id,
            rewritten_fields: params.current_shot,
            change_source: 'ai-rewrite',
            changed_fields: params.fields_to_rewrite,
        };
    }
}
