// src/lib/audioEngine/index.ts
import { generateDialogue, generateSFX, getMusicTrack, AudioAsset } from './providers';
import { mixAndMaster, TimelineTrack, MixPlan } from './mixer';

export interface AudioPlan {
    dialogueEnabled: boolean;
    dialogueText?: string;
    emotionHint?: string;

    sfxEnabled: boolean;
    sfxDescription?: string;

    musicEnabled: boolean;
    musicVibe?: string;
}

/**
 * buildAudioPlan
 * Extracts hints from the prompt or context to conditionally enable audio layers.
 */
export function buildAudioPlan(prompt: string, mode: string): AudioPlan {
    console.log(`[AudioEngine] Building Audio Plan for mode: ${mode}...`);
    const isBasic = mode === 'basic';

    // Very crude heuristic for MVP
    const plan: AudioPlan = {
        dialogueEnabled: true,
        dialogueText: prompt.substring(0, 50), // grab snippet for dialogue
        emotionHint: 'neutral',

        sfxEnabled: !isBasic, // Pro only
        sfxDescription: prompt,

        musicEnabled: !isBasic, // Pro only
        musicVibe: 'cinematic',
    };

    return plan;
}

/**
 * generateAudioAssets
 * Calls the providers based on the audio plan to get real files/URLs
 */
export async function generateAudioAssets(plan: AudioPlan, character: string): Promise<AudioAsset[]> {
    console.log('[AudioEngine] Generating Audio Assets...');
    const assets: AudioAsset[] = [];

    if (plan.dialogueEnabled && plan.dialogueText) {
        const asset = await generateDialogue(plan.dialogueText, character, plan.emotionHint || 'neutral');
        assets.push(asset);
    }

    if (plan.sfxEnabled && plan.sfxDescription) {
        const asset = await generateSFX(plan.sfxDescription);
        assets.push(asset);
    }

    if (plan.musicEnabled && plan.musicVibe) {
        const asset = await getMusicTrack(plan.musicVibe);
        assets.push(asset);
    }

    return assets;
}

/**
 * buildTimeline
 * Maps assets to the mixing timeline.
 */
export function buildTimeline(assets: AudioAsset[]): TimelineTrack[] {
    console.log(`[AudioEngine] Building Timeline for ${assets.length} assets...`);
    return assets.map((asset, index) => {
        return {
            id: asset.id,
            type: asset.type,
            filePath: asset.url,
            startTime: index * 0.5, // cascade stagger for demo
            duration: asset.durationSec || 5
        };
    });
}

/**
 * runAudioEnginePipeline
 * The main orchestrator directly called by the API.
 * @param predictionId Used as the reference ID in the DB
 * @param videoUrl Original raw video
 * @param prompt Prompt used to infer tone
 * @param mode 'basic' | 'pro' | 'off'
 */
export async function runAudioEnginePipeline(
    predictionId: string,
    videoUrl: string,
    prompt: string,
    mode: string
): Promise<string> {
    if (mode === 'off') {
        return videoUrl;
    }

    try {
        console.log(`[AudioEngine] Pipeline started for ${predictionId}`);
        const plan = buildAudioPlan(prompt, mode);
        const assets = await generateAudioAssets(plan, 'narrator');
        const timeline = buildTimeline(assets);

        const mixPlan: MixPlan = {
            timeline,
            mode: mode as 'basic' | 'pro'
        };

        const finalPath = await mixAndMaster(videoUrl, mixPlan);

        // Normally we would upload `finalPath` to Supabase Storage and return the public URL here!
        // For local dev/testing, we just return the local OS temp path.
        console.log(`[AudioEngine] Pipeline finished. Output: ${finalPath}`);
        return finalPath;
    } catch (error: any) {
        console.error(`[AudioEngine] Pipeline failed for ${predictionId}:`, error.message);
        // Explicitly throw so the caller knows it failed and can fallback
        throw error;
    }
}
