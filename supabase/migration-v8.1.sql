-- Migration v8.1: Plan comments + visibility window
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/zxluwryrbpnvsktpxqlj/sql/new

-- 1. Plan comments table
CREATE TABLE IF NOT EXISTS pact_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pact_id uuid NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pact_comments_pact ON pact_comments(pact_id, created_at);

-- RLS for pact_comments: users can read comments on pacts in their circles,
-- insert their own, delete their own
ALTER TABLE pact_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read comments on pacts in their circles"
  ON pact_comments FOR SELECT
  USING (
    pact_id IN (
      SELECT p.id FROM pacts p
      WHERE p.circle_id IN (SELECT get_my_circle_ids())
    )
  );

CREATE POLICY "Users can insert their own comments"
  ON pact_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comments"
  ON pact_comments FOR DELETE
  USING (auth.uid() = user_id);

-- 2. Visibility window column on users table
-- Default 7 days, allowed values: 7 or 14
ALTER TABLE users ADD COLUMN IF NOT EXISTS visibility_window integer DEFAULT 7;

-- 3. Enable realtime on pact_comments
ALTER PUBLICATION supabase_realtime ADD TABLE pact_comments;
