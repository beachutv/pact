-- Migration for Pact v20
-- Run this in Supabase SQL Editor

-- 1. Track pact declines (who said "can't make it")
CREATE TABLE IF NOT EXISTS pact_declines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pact_id uuid NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(pact_id, user_id)
);

-- RLS for pact_declines
ALTER TABLE pact_declines ENABLE ROW LEVEL SECURITY;

-- Users can see declines for pacts in their circles
CREATE POLICY "Users can view pact declines in their circles"
  ON pact_declines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM pacts p
      JOIN circle_members cm ON cm.circle_id = p.circle_id
      WHERE p.id = pact_declines.pact_id
      AND cm.user_id = auth.uid()
    )
  );

-- Users can insert their own decline
CREATE POLICY "Users can decline pacts"
  ON pact_declines FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own decline (changed my mind)
CREATE POLICY "Users can undo decline"
  ON pact_declines FOR DELETE
  USING (user_id = auth.uid());

-- 2. Ensure invite_code has a unique constraint (for custom codes)
-- Check if constraint exists first — if it does, this will be a no-op
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'circles_invite_code_key'
  ) THEN
    ALTER TABLE circles ADD CONSTRAINT circles_invite_code_key UNIQUE (invite_code);
  END IF;
END $$;
