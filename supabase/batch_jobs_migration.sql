-- ═══════════════════════════════════════════════════════════════
-- Batch Jobs Migration
-- Tables for tracking batch image generation jobs
-- Run AFTER shots_migration.sql
-- ═══════════════════════════════════════════════════════════════

-- 1) batch_jobs — top-level job tracking
CREATE TABLE IF NOT EXISTS batch_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'gen_images',
    total INT NOT NULL DEFAULT 0,
    done INT NOT NULL DEFAULT 0,
    succeeded INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    concurrency INT NOT NULL DEFAULT 2,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) batch_job_items — individual shot tasks within a batch
CREATE TABLE IF NOT EXISTS batch_job_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
    shot_id UUID NOT NULL,
    shot_number INT NOT NULL DEFAULT 0,
    scene_number INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    image_id UUID,
    image_url TEXT,
    error TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_batch_jobs_project ON batch_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_user ON batch_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_job_items_job ON batch_job_items(job_id);
CREATE INDEX IF NOT EXISTS idx_batch_job_items_status ON batch_job_items(status);

-- RLS
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_job_items ENABLE ROW LEVEL SECURITY;

-- Users can only see their own batch jobs
CREATE POLICY "Users read own batch jobs"
    ON batch_jobs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users insert own batch jobs"
    ON batch_jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own batch jobs"
    ON batch_jobs FOR UPDATE
    USING (auth.uid() = user_id);

-- Items inherit access via job ownership
CREATE POLICY "Users read own batch items"
    ON batch_job_items FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM batch_jobs WHERE batch_jobs.id = batch_job_items.job_id AND batch_jobs.user_id = auth.uid()
    ));

CREATE POLICY "Users insert own batch items"
    ON batch_job_items FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM batch_jobs WHERE batch_jobs.id = batch_job_items.job_id AND batch_jobs.user_id = auth.uid()
    ));

CREATE POLICY "Users update own batch items"
    ON batch_job_items FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM batch_jobs WHERE batch_jobs.id = batch_job_items.job_id AND batch_jobs.user_id = auth.uid()
    ));

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_batch_job_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_batch_jobs_updated
    BEFORE UPDATE ON batch_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_batch_job_timestamp();
