-- Migration v6.2: Add secret_code to circles (separate from invite_code/URL slug)
--
-- invite_code = readable URL slug (e.g. "barkada2026") → /join/barkada2026
--   Respects approval mode — if circle requires approval, joining via URL submits a request
--
-- secret_code = private invite code (e.g. "X7kQ9m") → typed in "Join with code" form
--   Always auto-joins, bypassing approval — the code IS the invitation
--
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query → paste → Run)

-- Add column with a default random code
ALTER TABLE public.circles ADD COLUMN IF NOT EXISTS secret_code text;

-- Generate secret codes for existing circles that don't have one
UPDATE public.circles
SET secret_code = upper(substr(md5(random()::text), 1, 6))
WHERE secret_code IS NULL;

-- Make it not null with a default
ALTER TABLE public.circles ALTER COLUMN secret_code SET NOT NULL;
ALTER TABLE public.circles ALTER COLUMN secret_code SET DEFAULT upper(substr(md5(random()::text), 1, 6));

-- Add unique constraint
ALTER TABLE public.circles ADD CONSTRAINT circles_secret_code_key UNIQUE (secret_code);
