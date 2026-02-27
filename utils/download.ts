/**
 * forceDownload — Server-side proxy download helper
 * Routes the download through /api/download to bypass CORS restrictions
 * on cross-origin CDN files (Replicate, Hailuo, etc.)
 */
export const forceDownload = (fileUrl: string, filename: string): void => {
    const proxyUrl = `/api/download?url=${encodeURIComponent(fileUrl)}&filename=${encodeURIComponent(filename)}`;
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};
