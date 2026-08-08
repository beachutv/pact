-- Migration v8.2: Plan voting / responses
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/zxluwryrbpnvsktpxqlj/sql/new

-- pact_responses: stores yes/maybe/no votes per user per pact
-- This is separate from pact_members (committed) and pact_declines (declined)
-- It's a lightweight "signal" before committing
CREATE TABLE IF NOT EXISTS pact_responses (
  pact_id uuid NOT NULL REFERENCES pacts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response text NOT NULL CHECK (response IN ('yes', 'maybe', 'no')),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (pact_id, user_id)
);

ALTER TABLE pact_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read responses on pacts in their circles"
  ON pact_responses FOR SELECT
  USING (
    pact_id IN (
      SELECT p.id FROM pacts p
      WHERE p.circle_id IN (SELECT get_my_circle_ids())
    )
  );

CREATE POLICY "Users can insert/update their own responses"
  ON pact_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own responses"
  ON pact_responses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own responses"
  ON pact_responses FOR DELETE
  USING (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE pact_responses;
