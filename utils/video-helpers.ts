export async function extractLastFrameFromVideo(videoUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous'; // 解决跨域限制
        video.muted = true; // 确保视频可以后台静音自动处理
        video.playsInline = true;

        // 标记跳转完成状态，避免重复触发
        let hasSeeked = false;

        const handleLoadedMetadata = () => {
            if (video.duration) {
                // 跳转到最后一帧（为防止黑屏，这里取 duration - 0.1s）
                video.currentTime = Math.max(0, video.duration - 0.1);
            } else {
                reject(new Error("Unable to read video duration."));
            }
        };

        const handleSeeked = () => {
            if (hasSeeked) return;
            hasSeeked = true;

            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error("Unable to get 2D context from canvas."));
                    return;
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                // 转换为 JPEG 格式的 Base64
                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                resolve(dataUrl);

                // 清理资源
                cleanUp();
            } catch (err) {
                reject(err);
                cleanUp();
            }
        };

        const handleError = (e: Event | string) => {
            reject(new Error(typeof e === 'string' ? e : "Failed to load video or process frame."));
            cleanUp();
        };

        const cleanUp = () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('seeked', handleSeeked);
            video.removeEventListener('error', handleError);
            video.src = '';
            video.removeAttribute('src');
            video.load();
        };

        // 绑定事件
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('seeked', handleSeeked);
        video.addEventListener('error', handleError);

        // 开始加载视频
        video.src = videoUrl;
        video.load();
    });
}

