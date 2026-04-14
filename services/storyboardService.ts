/**
 * storyboardService.ts
 * Source of truth: Supabase (auth-gated, multi-device)
 * localStorage: settings + directorControls only (handled in App.tsx)
 *
 * DB column mapping:
 *   storyboards.title            ↔  StoryboardProject.project_title
 *   storyboards.director_controls ↔ StoryboardProject.director_controls (JSONB)
 *   storyboards.story_entities   ↔  StoryboardProject.story_entities (JSONB)
 *   storyboards.logline          ↔  StoryboardProject.logline
 *   storyboards.world_setting    ↔  StoryboardProject.world_setting
 *   storyboards.updated_at       ↔  used by dashboard for sort/display
 */
import { supabase } from '../lib/supabaseClient';
import { StoryboardProject, Scene } from '../types';

const formatError = (error: any): string => {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    try { return JSON.stringify(error); } catch { return String(error); }
};

// ─── Map DB row → StoryboardProject ──────────────────────────────────────────
function dbRowToProject(row: any, scenes: Scene[] = []): StoryboardProject {
    return {
        id:               row.id,
        project_title:    row.title || row.project_title || 'Untitled Project',
        visual_style:     row.visual_style || '',
        character_anchor: row.character_anchor || '',
        story_entities:   row.story_entities   ?? undefined,
        director_controls: row.director_controls ?? undefined,
        logline:          row.logline          ?? undefined,
        world_setting:    row.world_setting    ?? undefined,
        pipeline_state:   row.pipeline_state   ?? undefined,
        identity_strength: row.identity_strength ?? undefined,
        style_bible:      row.style_bible      ?? undefined,
        scenes,
    } as StoryboardProject;
}

// ─── Map Scene → DB payload ───────────────────────────────────────────────────
function sceneToDbPayload(scene: Scene, storyboardId: string): any {
    const payload: any = {
        storyboard_id:       storyboardId,
        scene_number:        scene.scene_number || 1,
        visual_description:  scene.visual_description || '',
        audio_description:   scene.audio_description  || '',
        shot_type:           scene.shot_type          || '',
        image_prompt:        scene.image_prompt        || '',
        image_url:           scene.image_url           || null,
        video_url:           scene.video_url           || null,
        video_motion_prompt: scene.video_motion_prompt || (scene as any).video_prompt || null,
        scene_title:         (scene as any).scene_title        || null,
        dramatic_function:   (scene as any).dramatic_function  || null,
        tension_level:       (scene as any).tension_level      ?? null,
        emotional_beat:      (scene as any).emotional_beat     || null,
        dialogue_text:       scene.dialogue_text               || null,
        dialogue_speaker:    scene.dialogue_speaker            || null,
    };
    if (scene.id && scene.id.includes('-')) {
        payload.id = scene.id;
    }
    return payload;
}

// ─── Map DB scene row → Scene ─────────────────────────────────────────────────
function dbRowToScene(row: any): Scene {
    return {
        id:                  row.id,
        scene_number:        row.scene_number,
        visual_description:  row.visual_description || '',
        audio_description:   row.audio_description  || '',
        shot_type:           row.shot_type          || '',
        image_prompt:        row.image_prompt        || '',
        image_url:           row.image_url           || undefined,
        video_url:           row.video_url           || undefined,
        video_motion_prompt: row.video_motion_prompt || undefined,
        scene_title:         row.scene_title         || undefined,
        dramatic_function:   row.dramatic_function   || undefined,
        tension_level:       row.tension_level       ?? undefined,
        emotional_beat:      row.emotional_beat      || undefined,
        dialogue_text:       row.dialogue_text        || undefined,
        dialogue_speaker:    row.dialogue_speaker     || undefined,
    } as Scene;
}

// ─── saveStoryboard ───────────────────────────────────────────────────────────
export const saveStoryboard = async (
    userId: string,
    project: StoryboardProject
): Promise<StoryboardProject | null> => {
    try {
        let storyboardId = project.id;
        let projectRow: any = null;

        // Full payload including new columns (requires migration applied)
        const storyboardPayloadFull: any = {
            title:             project.project_title || 'Untitled Project',
            visual_style:      project.visual_style  || '',
            character_anchor:  project.character_anchor || '',
            logline:           project.logline           ?? null,
            world_setting:     project.world_setting     ?? null,
            story_entities:    project.story_entities    ?? null,
            director_controls: project.director_controls ?? null,
        };
        // Minimal payload for pre-migration DBs (only original columns)
        const storyboardPayloadBase: any = {
            title:            storyboardPayloadFull.title,
            visual_style:     storyboardPayloadFull.visual_style,
            character_anchor: storyboardPayloadFull.character_anchor,
        };

        const isColumnMissing = (e: any) =>
            e?.code === '42703' || e?.message?.includes('column') && e?.message?.includes('does not exist');

        const tryUpsert = async (payload: any, isInsert: boolean, id?: string) => {
            if (isInsert) {
                const insertPayload: any = { user_id: userId, ...payload };
                if (id) insertPayload.id = id;
                const { data, error } = await supabase.from('storyboards').insert(insertPayload).select().single();
                return { data, error };
            } else {
                const { data, error } = await supabase.from('storyboards').update(payload).eq('id', id!).select().maybeSingle();
                return { data, error };
            }
        };

        const runWithFallback = async (isInsert: boolean, id?: string) => {
            let { data, error } = await tryUpsert(storyboardPayloadFull, isInsert, id);
            if (error && isColumnMissing(error)) {
                console.warn('[storyboardService] New columns missing — migration not applied. Saving with base columns only.');
                ({ data, error } = await tryUpsert(storyboardPayloadBase, isInsert, id));
            }
            if (error) throw error;
            return data;
        };

        if (storyboardId) {
            projectRow = await runWithFallback(false, storyboardId);
            if (!projectRow) storyboardId = undefined;
        }

        if (!projectRow || !storyboardId) {
            projectRow = await runWithFallback(true, project.id);
            storyboardId = projectRow.id;
        }

        if (!storyboardId) throw new Error('Failed to obtain storyboard ID');

        const scenesPayload = (project.scenes || []).map(s => sceneToDbPayload(s, storyboardId!));
        const toUpdate = scenesPayload.filter(s => s.id);
        const toInsert = scenesPayload.filter(s => !s.id);

        let savedScenes: any[] = [];

        // Columns added by migration — strip them if column-missing error
        const newSceneColumns = ['scene_title','dramatic_function','tension_level','emotional_beat','dialogue_text','dialogue_speaker'];
        const stripNewSceneColumns = (rows: any[]) => rows.map(r => {
            const clean = { ...r };
            newSceneColumns.forEach(k => delete clean[k]);
            return clean;
        });

        if (toUpdate.length > 0) {
            let { data, error } = await supabase.from('scenes').upsert(toUpdate, { onConflict: 'id' }).select();
            if (error && isColumnMissing(error)) {
                console.warn('[storyboardService] Scene new columns missing — saving base columns only.');
                ({ data, error } = await supabase.from('scenes').upsert(stripNewSceneColumns(toUpdate), { onConflict: 'id' }).select());
            }
            if (error) throw error;
            if (data) savedScenes = savedScenes.concat(data);
        }

        if (toInsert.length > 0) {
            let { data, error } = await supabase.from('scenes').insert(toInsert).select();
            if (error && isColumnMissing(error)) {
                console.warn('[storyboardService] Scene new columns missing — saving base columns only.');
                ({ data, error } = await supabase.from('scenes').insert(stripNewSceneColumns(toInsert)).select());
            }
            if (error) throw error;
            if (data) savedScenes = savedScenes.concat(data);
        }

        const sortedScenes = savedScenes
            .map(dbRowToScene)
            .sort((a, b) => a.scene_number - b.scene_number);

        return dbRowToProject(projectRow, sortedScenes);

    } catch (error) {
        console.error('[storyboardService] saveStoryboard error:', formatError(error));
        return null;
    }
};

// ─── updateSceneMedia ─────────────────────────────────────────────────────────
export const updateSceneMedia = async (
    sceneId: string,
    mediaType: 'image' | 'video',
    url: string
): Promise<boolean> => {
    if (!sceneId) return false;
    const update = mediaType === 'image' ? { image_url: url } : { video_url: url };
    const { error } = await supabase.from('scenes').update(update).eq('id', sceneId);
    if (error) {
        console.error('[storyboardService] updateSceneMedia error:', error);
        return false;
    }
    return true;
};

// ─── fetchUserStoryboards ─────────────────────────────────────────────────────
export const fetchUserStoryboards = async (userId: string) => {
    // Try ordering by updated_at first (requires migration applied).
    // Fall back to created_at if updated_at column doesn't exist yet.
    let { data, error } = await supabase
        .from('storyboards')
        .select('id, title, logline, created_at, updated_at, visual_style')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false, nullsFirst: false });

    if (error) {
        // updated_at column missing (migration not applied) — fall back gracefully
        if (error.message?.includes('updated_at') || error.code === '42703') {
            const fallback = await supabase
                .from('storyboards')
                .select('id, title, logline, created_at, visual_style')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            if (fallback.error) throw fallback.error;
            data = (fallback.data || []).map((r: any) => ({ ...r, updated_at: r.created_at }));
        } else {
            throw error;
        }
    }

    return (data || []).map((row: any) => ({
        ...row,
        project_title: row.title || 'Untitled Project',
    }));
};

// ─── fetchStoryboardDetails ───────────────────────────────────────────────────
export const fetchStoryboardDetails = async (
    storyboardId: string
): Promise<StoryboardProject | null> => {
    const { data: projectRow, error: projectError } = await supabase
        .from('storyboards')
        .select('*')
        .eq('id', storyboardId)
        .maybeSingle();

    if (projectError) throw projectError;
    if (!projectRow) return null;

    const { data: scenesData, error: scenesError } = await supabase
        .from('scenes')
        .select('*')
        .eq('storyboard_id', storyboardId)
        .order('scene_number', { ascending: true });

    if (scenesError) throw scenesError;

    const scenes = (scenesData || []).map(dbRowToScene);
    return dbRowToProject(projectRow, scenes);
};

// ─── deleteStoryboard ─────────────────────────────────────────────────────────
export const deleteStoryboard = async (storyboardId: string): Promise<boolean> => {
    // Scenes are cascade-deleted by FK constraint
    const { error } = await supabase.from('storyboards').delete().eq('id', storyboardId);
    if (error) {
        console.error('[storyboardService] deleteStoryboard error:', error);
        return false;
    }
    return true;
};
