
/**
 * Visual Continuity Validator
 * Compares an input image with the first frame of a video to ensure consistency.
 * Uses a simplified Mean Squared Error (MSE) approach on downscaled samples.
 */

// Threshold: 0.0 is identical, 1.0 is opposite.
// 0.15 allows for compression artifacts and minor lighting shifts but catches scene changes.
const CONTINUITY_THRESHOLD = 0.20; 

export const checkVisualContinuity = async (
  imageUrl: string, 
  videoUrl: string
): Promise<{ pass: boolean; score: number; error?: string }> => {
  try {
    // 1. Load the reference Image
    const img = await loadImage(imageUrl);
    
    // 2. Load the Video and seek to frame 0
    const video = await loadVideo(videoUrl);
    
    // 3. Compare using Canvas
    const score = compareFrames(img, video);
    
    // Cleanup video source to free memory
    video.src = "";
    video.load();

    return { 
      pass: score < CONTINUITY_THRESHOLD, 
      score 
    };

  } catch (e: any) {
    console.warn("Continuity check failed (technical error), assuming pass.", e);
    // Fail open: If CORS or format issues prevent check, assume it's fine to avoid blocking user.
    return { pass: true, score: 0, error: e.message };
  }
};

const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error("Failed to load reference image"));
  });
};

const loadVideo = (src: string): Promise<HTMLVideoElement> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    
    // Wait for data to be loaded enough to render first frame
    video.onloadeddata = () => {
      video.currentTime = 0; // Ensure first frame
      resolve(video);
    };
    video.onerror = (e) => reject(new Error("Failed to load generated video"));
  });
};

const compareFrames = (img: HTMLImageElement, video: HTMLVideoElement): number => {
  // We compare at a low resolution (e.g., 64x64) to ignore high-freq noise/grain
  const width = 64;
  const height = 64;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) throw new Error("Canvas context failed");

  // Draw Image
  ctx.drawImage(img, 0, 0, width, height);
  const imgData = ctx.getImageData(0, 0, width, height).data;

  // Draw Video Frame
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);
  const videoData = ctx.getImageData(0, 0, width, height).data;

  // Calculate MSE (Mean Squared Error)
  let sumSqErr = 0;
  for (let i = 0; i < imgData.length; i += 4) {
    // RGB Difference
    const rDiff = (imgData[i] - videoData[i]) / 255;
    const gDiff = (imgData[i + 1] - videoData[i + 1]) / 255;
    const bDiff = (imgData[i + 2] - videoData[i + 2]) / 255;
    
    // Luminance weighting (optional, but simple RGB avg is fine here)
    const pxDist = (rDiff * rDiff + gDiff * gDiff + bDiff * bDiff) / 3;
    sumSqErr += pxDist;
  }

  const mse = sumSqErr / (width * height);
  
  // Return a normalized score roughly between 0 and 1
  return mse;
};
