
import { MotionIntensity, VideoResolution, VideoDuration, VideoFps } from "../types";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

const INTENSITY_CONFIG = {
  low: { scale: 1.02, drift: 5, particles: 20 },
  medium: { scale: 1.05, drift: 15, particles: 40 },
  high: { scale: 1.08, drift: 25, particles: 80 },
};

export const generateStableVideo = (
  imageUrl: string,
  durationSec: VideoDuration,
  fps: VideoFps,
  resolution: VideoResolution,
  intensity: MotionIntensity
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;

    img.onload = () => {
      const canvas = document.createElement("canvas");
      // Set resolution
      if (resolution === '1080p') {
        canvas.width = 1920;
        canvas.height = 1080;
      } else {
        canvas.width = 1280;
        canvas.height = 720;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      // Setup MediaRecorder
      const stream = canvas.captureStream(fps);
      // Try to use H.264 (mp4) if available, fall back to vp9/vp8 (webm)
      const mimeTypes = [
        "video/mp4; codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
        "video/webm; codecs=vp9",
        "video/webm"
      ];
      
      let selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMimeType,
        videoBitsPerSecond: resolution === '1080p' ? 8000000 : 5000000 // High bitrate
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: selectedMimeType });
        const url = URL.createObjectURL(blob);
        resolve(url);
      };

      // --- Animation Logic ---
      const totalFrames = durationSec * fps;
      let frameCount = 0;
      
      const config = INTENSITY_CONFIG[intensity];
      
      // Calculate image fitting (Cover mode)
      const ratio = Math.max(canvas.width / img.width, canvas.height / img.height);
      const drawWidth = img.width * ratio;
      const drawHeight = img.height * ratio;
      const startX = (canvas.width - drawWidth) / 2;
      const startY = (canvas.height - drawHeight) / 2;

      // Initialize Particles (Dust/Mist)
      const particles: Particle[] = [];
      for (let i = 0; i < config.particles; i++) {
        particles.push(createParticle(canvas.width, canvas.height));
      }

      mediaRecorder.start();

      const renderFrame = () => {
        if (frameCount >= totalFrames) {
          mediaRecorder.stop();
          return;
        }

        const progress = frameCount / totalFrames; // 0 to 1
        
        // --- 1. Draw Background (Ken Burns) ---
        // Smooth sine ease-in-out for more natural feel, or linear for simple drift
        const ease = progress; 
        
        // Scale: 1.0 -> 1.0 + intensity
        const currentScale = 1 + (config.scale - 1) * ease;
        
        // Pan: Slight diagonal drift
        const panX = (config.drift * ease); 
        const panY = (config.drift * 0.5 * ease);

        ctx.save();
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Translate to center to zoom from center
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(currentScale, currentScale);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
        
        // Apply Pan
        ctx.translate(panX, panY);

        ctx.drawImage(img, startX, startY, drawWidth, drawHeight);
        ctx.restore();

        // --- 2. Draw Overlays (Particles/Mist) ---
        ctx.save();
        particles.forEach(p => {
            // Move
            p.x += p.vx;
            p.y += p.vy;
            p.life++;

            // Fade in/out
            const fade = Math.sin((p.life / p.maxLife) * Math.PI); // 0 -> 1 -> 0
            const currentAlpha = p.alpha * fade;

            ctx.globalAlpha = currentAlpha;
            ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();

            // Reset dead particles
            if (p.life >= p.maxLife) {
                Object.assign(p, createParticle(canvas.width, canvas.height));
            }
        });
        
        // --- 3. Vignette (Optional Cinematic touch) ---
        const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, canvas.height/2, canvas.width/2, canvas.height/2, canvas.height);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(1, "rgba(0,0,0,0.3)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.restore();

        frameCount++;
        
        // Use timeout to match FPS roughly (MediaRecorder handles timing, but drawing speed matters)
        setTimeout(() => {
            requestAnimationFrame(renderFrame);
        }, 1000 / fps);
      };

      renderFrame();
    };

    img.onerror = () => {
      reject(new Error("Failed to load image for stable video generation."));
    };
  });
};

function createParticle(w: number, h: number): Particle {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    size: Math.random() * 2 + 0.5, // Tiny dust
    alpha: Math.random() * 0.3 + 0.1,
    life: Math.random() * 50,
    maxLife: 100 + Math.random() * 100
  };
}
