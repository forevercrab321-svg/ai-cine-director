-- Migration: Create Audio Jobs Table
-- Description: Stores metadata and status for audio engine jobs

CREATE TABLE IF NOT EXISTS public.audio_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_job_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, succeeded, failed, skipped
    mode TEXT NOT NULL DEFAULT 'off',
    audio_plan_json JSONB DEFAULT '{}'::jsonb,
    outputs_json JSONB DEFAULT '{}'::jsonb,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add an index on video_job_id for quick lookups
CREATE INDEX IF NOT EXISTS audio_jobs_video_job_id_idx ON public.audio_jobs (video_job_id);

-- Enable RLS
ALTER TABLE public.audio_jobs ENABLE ROW LEVEL SECURITY;

-- Create policies (assuming service role will mostly write, but let's be safe)
CREATE POLICY "Enable read access for all users" ON public.audio_jobs FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users only" ON public.audio_jobs FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Enable update for authenticated users only" ON public.audio_jobs FOR UPDATE USING (auth.role() = 'authenticated');

-- Trigger to update updated_at column
CREATE OR REPLACE FUNCTION update_modified_column() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_audio_jobs_modtime ON public.audio_jobs;

CREATE TRIGGER update_audio_jobs_modtime
    BEFORE UPDATE ON public.audio_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
