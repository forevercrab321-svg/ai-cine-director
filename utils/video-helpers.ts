export async function extractLastFrameFromVideo(videoUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        // ★ MUST be set BEFORE src to prevent CORS tainted canvas
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';

        // 30s timeout protection
        const timeoutId = setTimeout(() => {
            cleanUp();
            reject(new Error("Video frame extraction timed out after 30s."));
        }, 30000);

        const cleanUp = () => {
            clearTimeout(timeoutId);
            video.onloadedmetadata = null;
            video.onseeked = null;
            video.onerror = null;
            video.src = '';
            video.removeAttribute('src');
            video.load();
        };

        video.onloadedmetadata = () => {
            if (video.duration && video.duration > 0) {
                // ★ Seek to near-last frame (avoid black frames at exact end)
                video.currentTime = Math.max(0, video.duration - 0.05);
            } else {
                cleanUp();
                reject(new Error("Unable to read video duration — video may not be loaded."));
            }
        };

        video.onseeked = () => {
            try {
                const canvas = document.createElement('canvas');
                // ★ Use native video resolution, not CSS size
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                if (canvas.width === 0 || canvas.height === 0) {
                    cleanUp();
                    return reject(new Error(`Video has zero dimensions (${canvas.width}x${canvas.height}) — likely CORS blocked.`));
                }

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    cleanUp();
                    return reject(new Error("Unable to get 2D context from canvas."));
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // ★ Export at maximum JPEG quality (1.0) — no compression loss
                const dataUrl = canvas.toDataURL('image/jpeg', 1.0);

                // Sanity check: a valid JPEG base64 should be at least a few KB
                if (dataUrl.length < 5000) {
                    cleanUp();
                    return reject(new Error(`Canvas produced near-empty output (${dataUrl.length} chars) — probable CORS SecurityError (Tainted Canvas). Use server-side extraction instead.`));
                }

                cleanUp();
                resolve(dataUrl);
            } catch (err: any) {
                cleanUp();
                // Surface the actual error — do NOT swallow SecurityError silently
                reject(new Error(`Canvas extraction failed: ${err.message || err}`));
            }
        };

        video.onerror = (e) => {
            cleanUp();
            reject(new Error(`Video load failed: ${typeof e === 'string' ? e : 'CORS or network error loading ' + videoUrl.substring(0, 60)}`));
        };

        // ★ Set src AFTER crossOrigin attribute
        video.src = videoUrl;
        video.load();
    });
}
