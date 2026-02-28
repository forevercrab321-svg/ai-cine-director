# Audio Engine (Optional & Bypassable)
## AI Cine Director - Extended Feature

The Audio Engine automatically mixes a generated dialogue, ambient sound, sound effects, and music tracks into the final video output without breaking the video generation flow or the user's interface.

### Principles:
1. **Zero Frontend Breakage**: If this engine fails, or is turned off, the frontend will simply receive and play the original generated video.
2. **Asynchronous Mixing**: The process hooks into the `/api/replicate/status/:id` intercept, pulling the successful video, extracting the audio plan, generating audio assets via TTS/Providers, and mixing them via `ffmpeg` before overriding the output URL.
3. **Fail-Safe**: Any exception during the pipeline returns the original video and logs the failure into the `audio_jobs` table.

### Prerequisites & Dependencies
- **FFmpeg**: The system running the backend must have `ffmpeg` installed globally and available in the `$PATH`. If not found, the Audio Engine will safely fail and fallback to mute video.
- **Fluent-Ffmpeg / Ffmpeg bindings (optional)**: The current module uses `child_process.exec` to natively invoke the `ffmpeg` cli. No extra npm dependencies are strictly required but `ffmpeg` must be present.

### Feature Flags / Environment Variables (`.env.local`)
Add the following variables to enable or test the Audio Engine:

```env
# Enable or Disable the Engine entirely
AUDIO_ENGINE_ENABLED=true

# Operating Mode: 
# "off" = Bypass completely
# "basic" = Dialogue only (TTS) mixed over video
# "pro" = Dialogue + SFX + Music + Mastering/Sidechain
AUDIO_ENGINE_MODE=basic

# Audio Providers
TTS_PROVIDER=mock   # Use 'mock' for local dev, 'openai' or 'elevenlabs' for prod
MUSIC_MODE=mock     # 'none', 'mock', 'generation'
SFX_MODE=mock       # 'none', 'mock', 'generation'
```

### Database Table requirement:
Ensure that `audio_jobs` is created using the provided Supabase migration (`20260228000000_create_audio_jobs.sql`).

### Developer Testing
To independently test the Audio Engine flow (Plan -> Asset Fetch -> Mix + FFMPEG -> Temp file output) without invoking Replicate video generation, run:
```bash
npx tsx scripts/test-audio-engine.ts
```

This will run a crude mockup mixer on a dummy remote MP4 video and produce a newly mixed MP4 in your OS temp directory.
