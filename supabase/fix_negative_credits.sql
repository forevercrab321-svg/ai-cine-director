-- ★ FIX: Reset any negative credits to 0
-- Run this once in Supabase SQL Editor
UPDATE public.profiles
SET credits = 0
WHERE credits < 0;

-- ★ PREVENT: Add CHECK constraint so credits can NEVER go below 0
-- This makes the DB the ultimate safety net
ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS credits_non_negative;

ALTER TABLE public.profiles
ADD CONSTRAINT credits_non_negative CHECK (credits >= 0);
