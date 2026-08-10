-- v9.5: Expand busy_read RLS to include friends and pact co-members
-- Previously, busy_read only allowed circle mates to see each other's busy blocks.
-- This meant friends NOT in the same circle couldn't see availability when planning together.

-- Helper function: get friend user IDs (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_my_friend_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN requester_id = auth.uid() THEN addressee_id
    ELSE requester_id
  END
  FROM public.friendships
  WHERE status = 'accepted'
    AND (requester_id = auth.uid() OR addressee_id = auth.uid())
$$;

-- Helper function: get pact co-member user IDs (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_my_pact_mate_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT DISTINCT pm2.user_id
  FROM public.pact_members pm1
  JOIN public.pact_members pm2 ON pm1.pact_id = pm2.pact_id
  WHERE pm1.user_id = auth.uid()
    AND pm2.user_id != auth.uid()
$$;

-- Drop and recreate busy_read to include friends and pact co-members
DROP POLICY IF EXISTS "busy_read" ON public.busy_blocks;
CREATE POLICY "busy_read" ON public.busy_blocks FOR SELECT USING (
  user_id = auth.uid()
  OR user_id IN (SELECT public.get_my_circle_mate_ids())
  OR user_id IN (SELECT public.get_my_friend_ids())
  OR user_id IN (SELECT public.get_my_pact_mate_ids())
);
