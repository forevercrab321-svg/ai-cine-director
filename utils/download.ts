import { supabase } from '../lib/supabaseClient';

/**
 * 强制下载器 (经过后端代理，彻底绕过 CORS 和无后缀 Bug)
 */
export const forceDownload = async (fileUrl: string, filename: string) => {
    if (!fileUrl) {
        console.error("下载失败：没有提供文件 URL");
        return;
    }

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            throw new Error('请先登录后再下载');
        }

        const proxyUrl = `/api/download?url=${encodeURIComponent(fileUrl)}&filename=${encodeURIComponent(filename)}`;
        const response = await fetch(proxyUrl, {
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
            },
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
            throw new Error(err.error || '下载失败');
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
    } catch (error) {
        console.error('下载失败：', error);
    }
};
