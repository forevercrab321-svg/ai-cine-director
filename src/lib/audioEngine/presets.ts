// src/lib/audioEngine/presets.ts

export const MIXING_PROFILES = {
    basic: {
        dialogueLevel: 0, // dB
        musicLevel: -15,   // dB
        sfxLevel: -10,     // dB
        musicDucking: false,
    },
    pro: {
        dialogueLevel: 0,
        musicLevel: -10, // Higher base but ducked
        sfxLevel: -6,
        ambienceLevel: -18,
        musicDucking: true, // duck by 10dB when dialogue plays
        targetLoudness: -14, // LUFS for web/social standards
    }
};

export const SCENE_AMBIENCE_MAP: Record<string, string> = {
    'INT': 'room_tone_quiet',
    'EXT': 'outdoor_city_ambient',
    'nature': 'forest_wind_birds',
    'cafe': 'coffee_shop_mutter',
    'cyberpunk': 'neon_city_rain_hum',
    // fallback
    'default': 'room_tone_quiet'
};

export const CHARACTER_EMOTION_HINTS = [
    "neutral", "happy", "sad", "angry", "fearful", "whisper", "shouting"
];
