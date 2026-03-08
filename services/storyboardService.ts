
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
                video_url: scene.video_url || null
            };

            // 只有当 video_motion_prompt 有值时才添加
            if (scene.video_motion_prompt) {
                payload.video_motion_prompt = scene.video_motion_prompt;
            } else if (scene.video_prompt) {
                payload.video_motion_prompt = scene.video_prompt;
            }

            // Only attach ID if it's a valid existing UUID
            if (scene.id && scene.id.includes('-')) {
                payload.id = scene.id;
            }
            return payload;
        });

        // Use upsert on the 'id' column constraint
        const { data: scenesData, error: scenesError } = await supabase
            .from('scenes')
            .upsert(scenesPayload, { onConflict: 'id' })
            .select();

        if (scenesError) {
            console.error('[Supabase Upsert] Error saving scenes:', scenesError);
            throw scenesError;
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
