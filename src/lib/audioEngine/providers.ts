// src/lib/audioEngine/providers.ts

// Since this is a bypassable and generic engine, we will provide a mocked implementation
// for the basic tier if no actual TTS provider is configured, and real implementation placeholders.

export interface AudioAsset {
    id: string;
    type: 'dialogue' | 'sfx' | 'ambience' | 'music';
    url: string; // Remote URL or local file path
    durationSec?: number;
}

/**
 * Generate Dialogue (TTS)
 */
export async function generateDialogue(text: string, character: string, emotion: string): Promise<AudioAsset> {
    const ttsProvider = process.env.TTS_PROVIDER || 'mock';

    if (ttsProvider === 'mock') {
        console.log(`[AudioEngine:Providers] Mocking TTS for: "${text}" [Voice: ${character}, Emotion: ${emotion}]`);
        // In a real app we would call OpenAI TTS or ElevenLabs here.
        // For the mock, we simulate returning a generic dialogue MP3.
        // Ensure we use a valid path for testing if possible.
        return {
            id: `dlg_${Date.now()}`,
            type: 'dialogue',
            url: 'https://actions.google.com/sounds/v1/human_voices/human_snoring.ogg', // generic placeholder
            durationSec: 2
        };
    }

    // Placeholder for real OpenAI or ElevenLabs call
    throw new Error(`TTS provider ${ttsProvider} not fully implemented yet.`);
}

/**
 * Generate Sound Effects
 */
export async function generateSFX(description: string): Promise<AudioAsset> {
    const sfxMode = process.env.SFX_MODE || 'none';

    if (sfxMode === 'mock') {
        console.log(`[AudioEngine:Providers] Mocking SFX for: "${description}"`);
        return {
            id: `sfx_${Date.now()}`,
            type: 'sfx',
            url: 'https://actions.google.com/sounds/v1/impacts/crash.ogg', // generic placeholder
            durationSec: 1
        };
    }

    if (sfxMode === 'none') {
        throw new Error('SFX generation requested but SFX_MODE is none.');
    }

    throw new Error(`SFX provider for mode ${sfxMode} not implemented.`);
}

/**
 * Get Background Music
 */
export async function getMusicTrack(vibe: string): Promise<AudioAsset> {
    const musicMode = process.env.MUSIC_MODE || 'none';

    if (musicMode === 'mock') {
        console.log(`[AudioEngine:Providers] Mocking Music for vibe: "${vibe}"`);
        return {
            id: `bgm_${Date.now()}`,
            type: 'music',
            url: 'https://actions.google.com/sounds/v1/ambiences/coffee_shop.ogg', // generic placeholder
            durationSec: 10
        };
    }

    if (musicMode === 'none') {
        throw new Error('Music requested but MUSIC_MODE is none.');
    }

    throw new Error(`Music provider for mode ${musicMode} not implemented.`);
}
