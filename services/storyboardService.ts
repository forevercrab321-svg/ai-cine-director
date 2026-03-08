
import { supabase } from '../lib/supabaseClient';
import { StoryboardProject, Scene } from '../types';

export const saveStoryboard = async (
    userId: string,
    project: StoryboardProject
): Promise<StoryboardProject | null> => {
    try {
        let storyboardId = project.id;
        let projectData;

        if (storyboardId) {
            // Update existing project
            const { data, error } = await supabase
                .from('storyboards')
                .update({
                    title: project.project_title,
                    visual_style: project.visual_style,
                    character_anchor: project.character_anchor
                })
                .eq('id', storyboardId)
                .select() // Returning updated row
                .single();

            if (error) throw error;
            projectData = data;
        } else {
            // Create new project
            const { data, error } = await supabase
                .from('storyboards')
                .insert({
                    user_id: userId,
                    title: project.project_title,
                    visual_style: project.visual_style,
                    character_anchor: project.character_anchor
                })
                .select()
                .single();

            if (error) throw error;
            projectData = data;
            storyboardId = data.id;
        }

        if (!storyboardId) throw new Error("Failed to get storyboard ID");

        // 2. Insert or Update Scenes
        // Supabase upsert works best when we provide the PK for existing rows
        // For new rows, we MUST omit the 'id' field entirely to let the DB generate it.
        const scenesPayload = project.scenes.map(scene => {
            const payload: any = {
                storyboard_id: storyboardId,
                scene_number: scene.scene_number || 1,
                visual_description: scene.visual_description || '',
                audio_description: scene.audio_description || '',
                shot_type: scene.shot_type || '',
                image_prompt: scene.image_prompt || '',
                image_url: scene.image_url || null,
                video_url: scene.video_url || null,
                video_motion_prompt: scene.video_motion_prompt || scene.video_prompt || null
            };

            // PostgREST strict schema: all objects in array must have same keys.
            // If it's a new scene, we still need to provide 'id' but as undefined/omitted. 
            // Wait, JSON.stringify removes undefined, so the key vanishes.
            // If we omit it for new, we must omit it for ALL new. But if it's a mix of new and old,
            // we MUST separate them or provide undefined. The safest way is to just let Supabase JS handle it, 
            // but we must ensure we don't selectively add keys to some objects.
            if (scene.id && scene.id.includes('-')) {
                payload.id = scene.id;
            }
            return payload;
        });

        // Supabase bulk upsert requires uniform keys for all objects. If some have 'id' and some don't, it fails.
        // It's safer to split into updates (with id) and inserts (without id)
        const scenesToUpdate = scenesPayload.filter(s => s.id);
        const scenesToInsert = scenesPayload.filter(s => !s.id);

        let scenesData: any[] = [];

        if (scenesToUpdate.length > 0) {
            const { data, error } = await supabase
                .from('scenes')
                .upsert(scenesToUpdate, { onConflict: 'id' })
                .select();
            if (error) throw error;
            if (data) scenesData = scenesData.concat(data);
        }

        if (scenesToInsert.length > 0) {
            const { data, error } = await supabase
                .from('scenes')
                .insert(scenesToInsert)
                .select();
            if (error) throw error;
            if (data) scenesData = scenesData.concat(data);
        }

        // Sort scenes by scene_number
        const sortedScenes = (scenesData as Scene[]).sort((a, b) => a.scene_number - b.scene_number);

        return {
            ...project,
            id: storyboardId,
            scenes: sortedScenes
        };

    } catch (error) {
        console.error('Error saving storyboard:', error);
        return null;
    }
};

export const updateSceneMedia = async (sceneId: string, mediaType: 'image' | 'video', url: string) => {
    if (!sceneId) return false;
    const update = mediaType === 'image' ? { image_url: url } : { video_url: url };
    const { error } = await supabase
        .from('scenes')
        .update(update)
        .eq('id', sceneId);

    if (error) {
        console.error(`Error updating scene ${mediaType}:`, error);
        return false;
    }
    return true;
};

export const fetchUserStoryboards = async (userId: string) => {
    const { data, error } = await supabase
        .from('storyboards')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
};

export const fetchStoryboardDetails = async (storyboardId: string) => {
    const { data: project, error: projectError } = await supabase
        .from('storyboards')
        .select('*')
        .eq('id', storyboardId)
        .single();

    if (projectError) throw projectError;

    const { data: scenes, error: scenesError } = await supabase
        .from('scenes')
        .select('*')
        .eq('storyboard_id', storyboardId)
        .order('scene_number', { ascending: true });

    if (scenesError) throw scenesError;

    return {
        ...project,
        scenes: scenes as Scene[]
    };
};
