-- ═══════════════════════════════════════════════════════════════
-- video_edit_jobs 表 - 视频编辑任务
-- 用于存储一键成片功能的视频合成任务状态
-- ═══════════════════════════════════════════════════════════════

-- 创建视频编辑任务表
CREATE TABLE IF NOT EXISTS video_edit_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    user_id TEXT REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    output_url TEXT,
    error TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_video_edit_jobs_user_id ON video_edit_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_video_edit_jobs_project_id ON video_edit_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_video_edit_jobs_status ON video_edit_jobs(status);

-- 启用 RLS
ALTER TABLE video_edit_jobs ENABLE ROW LEVEL SECURITY;

-- 创建策略：用户只能查看自己的任务
CREATE POLICY "Users can view own video edit jobs"
    ON video_edit_jobs FOR SELECT
    USING (auth.uid() = user_id);

-- 创建策略：用户可以插入自己的任务
CREATE POLICY "Users can insert own video edit jobs"
    ON video_edit_jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 创建策略：用户可以更新自己的任务
CREATE POLICY "Users can update own video edit jobs"
    ON video_edit_jobs FOR UPDATE
    USING (auth.uid() = user_id);

-- 创建 updated_at 触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_video_edit_jobs_updated_at
    BEFORE UPDATE ON video_edit_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE video_edit_jobs IS '视频编辑任务表 - 存储一键成片功能的视频合成任务';
COMMENT ON COLUMN video_edit_jobs.status IS '任务状态: pending(待处理), processing(处理中), completed(完成), failed(失败)';
COMMENT ON COLUMN video_edit_jobs.progress IS '处理进度 0-100';
COMMENT ON COLUMN video_edit_jobs.metadata IS '任务元数据: 包含片段数量、总时长、音乐URL等信息';
