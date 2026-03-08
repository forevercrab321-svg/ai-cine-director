// src/lib/audioEngine/providers.ts

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// Eleven Labs API configuration
const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY;
const ELEVEN_LABS_VOICE_ID = process.env.ELEVEN_LABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // Default Adam voice

// Supabase for storing audio files
const getSupabaseAdmin = () => {
    const url = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !key) throw new Error('Supabase URL or Service Key missing');
    return createClient(url, key);
};

export interface AudioAsset {
    id: string;
    type: 'dialogue' | 'sfx' | 'ambience' | 'music';
    url: string; // Remote URL or local file path
    durationSec?: number;
}

/**
 * Generate Dialogue using Eleven Labs TTS
 */
export async function generateDialogue(text: string, character: string, emotion: string): Promise<AudioAsset> {
    console.log(`[AudioEngine:ElevenLabs] Generating TTS for: "${text.substring(0, 50)}..." [Voice: ${character}, Emotion: ${emotion}]`);

    // Check if Eleven Labs API key is configured
    if (!ELEVEN_LABS_API_KEY) {
        console.warn('[AudioEngine:ElevenLabs] No API key configured, using mock');
        return {
            id: `dlg_${Date.now()}`,
            type: 'dialogue',
            url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
            durationSec: 2
        };
    }

    try {
        // Map emotion to Eleven Labs stability settings
        const stabilityMap: Record<string, number> = {
            'happy': 0.5,
            'sad': 0.4,
'angry': 0.3,
            'neutral': 0.7,
            'excited': 0.6,
            'calm': 0.8
        };
        
        const emotionMap: Record<string, number> = {
            'happy': 0.8,
            'sad': 0.3,
            'angry': 0.9,
            'neutral': 0.5,
            'excited': 0.9,
            'calm': 0.4
        };

        const stability = stabilityMap[emotion] || 0.7;
        const similarityBoost = emotionMap[emotion] || 0.5;

        // Call Eleven Labs API
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_LABS_VOICE_ID}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': ELEVEN_LABS_API_KEY
            },
            body: JSON.stringify({
                text: text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: {
                    stability: stability,
                    similarity_boost: similarityBoost,
                    style: 0.5,
                    use_speaker_boost: true
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[AudioEngine:ElevenLabs] API Error:', errorText);
            throw new Error(`Eleven Labs API error: ${response.status}`);
        }

        // Get audio as buffer
        const audioBuffer = await response.buffer();
        
        // Upload to Supabase Storage
        const supabase = getSupabaseAdmin();
        const fileName = `audio/dialogue_${Date.now()}.mp3`;
        
        const { data, error } = await supabase.storage
            .from('audio')
            .upload(fileName, audioBuffer, {
                contentType: 'audio/mpeg',
                upsert: true
            });

        if (error) {
            console.error('[AudioEngine:ElevenLabs] Upload Error:', error);
            throw new Error(`Failed to upload audio: ${error.message}`);
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from('audio')
            .getPublicUrl(fileName);

        // Estimate duration (roughly 150 words per minute, ~2.5 words per second)
        const wordCount = text.split(/\s+/).length;
        const estimatedDuration = Math.max(1, wordCount / 2.5);

        console.log(`[AudioEngine:ElevenLabs] Success! Audio URL: ${urlData.publicUrl}`);

        return {
            id: `dlg_${Date.now()}`,
            type: 'dialogue',
            url: urlData.publicUrl,
            durationSec: estimatedDuration
        };

    } catch (error: any) {
        console.error('[AudioEngine:ElevenLabs] Error:', error.message);
        // Fallback to mock on error
        return {
            id: `dlg_${Date.now()}`,
            type: 'dialogue',
            url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
            durationSec: 2
        };
    }
}

/**
 * Generate Sound Effects using AI (placeholder for now)
 * Can integrate with services like Eleven Labs for sound effects or use built-in SFX
 */
export async function generateSFX(description: string): Promise<AudioAsset> {
    console.log(`[AudioEngine:SFX] Generating SFX for: "${description.substring(0, 50)}..."`);

    // For now, return a placeholder SFX
    // In production, you could integrate with services like:
    // - Eleven Labs SFX (if available)
    // - AudioShake
    // - Sonauto
    // - Built-in SFX library
    
    const sfxLibrary: Record<string, string> = {
        'explosion': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'gun': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'footstep': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'car': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'door': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'default': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3'
    };

    // Try to match description with SFX library
    const lowerDesc = description.toLowerCase();
    let selectedSfx = sfxLibrary.default;
    
    for (const [key, url] of Object.entries(sfxLibrary)) {
        if (lowerDesc.includes(key)) {
            selectedSfx = url;
            break;
        }
    }

    return {
        id: `sfx_${Date.now()}`,
        type: 'sfx',
        url: selectedSfx,
        durationSec: 2
    };
}

/**
 * Get Background Music using AI music generation
 * Integrates with Replicate for music generation (can use models like MusicGen, AudioCraft, etc.)
 */
export async function getMusicTrack(vibe: string): Promise<AudioAsset> {
    console.log(`[AudioEngine:Music] Generating music for vibe: "${vibe}"`);

    // Try to use Replicate for music generation
    const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
    
    if (!REPLICATE_TOKEN) {
        console.warn('[AudioEngine:Music] No Replicate token, using placeholder');
        return {
            id: `bgm_${Date.now()}`,
            type: 'music',
            url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
            durationSec: 10
        };
    }

    try {
        // Use Meta's MusicGen or AudioCraft via Replicate
        // This is a placeholder - you would need to set up the actual model
        const modelVersion = 'meta/musicgen-stereo-large'; // Example model
        
        const response = await fetch('https://api.replicate.com/v1/predictions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${REPLICATE_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                version: modelVersion,
                input: {
                    prompt: vibe,
                    duration: 10,
                    model: 'musicgen-large'
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Replicate API error: ${response.status}`);
        }

        const prediction = await response.json() as any;
        
        // Poll for completion
        let result: any = prediction;
        while (result.status !== 'succeeded' && result.status !== 'failed') {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
                headers: {
                    'Authorization': `Bearer ${REPLICATE_TOKEN}`
                }
            });
            result = await statusResponse.json();
        }

        if (result.status === 'succeeded') {
            const musicUrl = result.output;
            
            // Upload to Supabase for permanent storage
            const supabase = getSupabaseAdmin();
            const musicResponse = await fetch(musicUrl);
            const musicBuffer = await musicResponse.buffer();
            
            const fileName = `audio/music_${Date.now()}.mp3`;
            const { error } = await supabase.storage
                .from('audio')
                .upload(fileName, musicBuffer, {
                    contentType: 'audio/mpeg',
                    upsert: true
                });

            if (!error) {
                const { data: urlData } = supabase.storage
                    .from('audio')
                    .getPublicUrl(fileName);
                
                return {
                    id: `bgm_${Date.now()}`,
                    type: 'music',
                    url: urlData.publicUrl,
                    durationSec: 10
                };
            }
        }

        throw new Error('Music generation failed');

    } catch (error: any) {
        console.error('[AudioEngine:Music] Error:', error.message);
        // Fallback to royalty-free music
        return {
            id: `bgm_${Date.now()}`,
            type: 'music',
            url: 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
            durationSec: 10
        };
    }
}

/**
 * Generate ambience sound for scenes
 */
export async function generateAmbience(sceneDescription: string): Promise<AudioAsset> {
    console.log(`[AudioEngine:Ambience] Generating ambience for: "${sceneDescription.substring(0, 50)}..."`);

    // Map scene descriptions to ambience sounds
    const ambienceLibrary: Record<string, string> = {
        'rain': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'storm': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'wind': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'city': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'forest': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'ocean': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'fire': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
        'default': 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3'
    };

    const lowerDesc = sceneDescription.toLowerCase();
    let selectedAmbience = ambienceLibrary.default;
    
    for (const [key, url] of Object.entries(ambienceLibrary)) {
        if (lowerDesc.includes(key)) {
            selectedAmbience = url;
            break;
        }
    }

    return {
        id: `amb_${Date.now()}`,
        type: 'ambience',
        url: selectedAmbience,
        durationSec: 10
    };
}
