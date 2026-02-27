/**
 * 强制下载器 (经过后端代理，彻底绕过 CORS 和无后缀 Bug)
 */
export const forceDownload = (fileUrl: string, filename: string) => {
    if (!fileUrl) {
        console.error("下载失败：没有提供文件 URL");
        return;
    }

    // 1. 构建指向咱们后端代理的 URL，必须用 encodeURIComponent 保证链接安全
    const proxyUrl = `/api/download?url=${encodeURIComponent(fileUrl)}&filename=${encodeURIComponent(filename)}`;

    // 2. 利用浏览器最原始的机制触发下载，后端会强行压上 .mp4 后缀
    const a = document.createElement('a');
    a.href = proxyUrl;
    // download 属性在这里作为双保险，虽然主要靠后端的 Content-Disposition 罩着
    a.download = filename;

    document.body.appendChild(a);
    a.click();

    // 3. 功成身退，销毁现场
    document.body.removeChild(a);
};
