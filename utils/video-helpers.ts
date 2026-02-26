export async function extractLastFrameFromVideo(videoUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous'; // 解决跨域限制
        video.muted = true; // 确保视频可以后台静音自动处理
        video.playsInline = true;

        // 设置一个30秒的超时保护，防止死等
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
            if (video.duration) {
                // 跳转到最后一帧（为防止黑屏，这里取 duration - 0.1s）
                video.currentTime = Math.max(0, video.duration - 0.1);
            } else {
                cleanUp();
                reject(new Error("Unable to read video duration."));
            }
        };

        // 只有当进度条跳转完成后，才进行截图，这是最严格物理意义上的截帧
        video.onseeked = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    cleanUp();
                    return reject(new Error("Unable to get 2D context from canvas."));
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // 转换为 JPEG 格式的 Base64
                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                cleanUp();
                resolve(dataUrl);
            } catch (err) {
                cleanUp();
                reject(err);
            }
        };

        video.onerror = (e) => {
            cleanUp();
            reject(new Error(typeof e === 'string' ? e : "Failed to load video or process frame."));
        };

        // 开始加载视频
        video.src = videoUrl;
        video.load();
    });
}
