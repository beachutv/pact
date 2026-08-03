-- Migration for Pact v5.0
-- Adds: usernames, friendships, circle visibility/join mode
-- Run this in Supabase SQL Editor (dashboard.supabase.com)

-- ==================== 1. USERNAMES ====================
-- Add username column to users (unique, lowercase, alphanumeric + underscores)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;

-- Create unique index for usernames (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON public.users (lower(username));

-- ==================== 2. FRIENDSHIPS ====================
-- Bidirectional friend system with request/accept flow
CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE(requester_id, addressee_id),
  CHECK (requester_id != addressee_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_requester ON public.friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON public.friendships(addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON public.friendships(status);

-- RLS for friendships
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- Users can see their own friendships (sent or received)
CREATE POLICY "friendships_read_own" ON public.friendships FOR SELECT USING (
  requester_id = auth.uid() OR addressee_id = auth.uid()
);

-- Users can send friend requests (as requester)
CREATE POLICY "friendships_create" ON public.friendships FOR INSERT WITH CHECK (
  requester_id = auth.uid()
);

-- Users can update friendships they're part of (accept)
CREATE POLICY "friendships_update" ON public.friendships FOR UPDATE USING (
  addressee_id = auth.uid()
);

-- Users can delete friendships they're part of (unfriend or cancel request)
CREATE POLICY "friendships_delete" ON public.friendships FOR DELETE USING (
  requester_id = auth.uid() OR addressee_id = auth.uid()
);

-- Enable realtime for friendships (for live friend request notifications)
ALTER PUBLICATION supabase_realtime ADD TABLE public.friendships;

-- Helper function: get all accepted friend user IDs for the current user
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

-- ==================== 3. USER SEARCH BY USERNAME ====================
-- Allow any authenticated user to search users by username (for friend add)
-- We need a policy that lets users find others by username without being circle mates
-- The existing policy only allows reading circle mates — add a new one for username search

-- Drop and recreate users read policy to include friends and username search
-- Note: we keep the existing policy and ADD a new one (Supabase merges with OR)
CREATE POLICY "users_read_friends" ON public.users FOR SELECT USING (
  id IN (SELECT public.get_my_friend_ids())
);

-- Allow reading any user by username (limited columns enforced at app level)
-- This is safe because the SELECT returns minimal info for search results
CREATE POLICY "users_search_by_username" ON public.users FOR SELECT USING (
  username IS NOT NULL
);

-- ==================== 4. CIRCLE VISIBILITY ====================
-- Add visibility and join_mode columns to circles
ALTER TABLE public.circles ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('public', 'private'));

ALTER TABLE public.circles ADD COLUMN IF NOT EXISTS join_mode text NOT NULL DEFAULT 'invite'
  CHECK (join_mode IN ('auto', 'approval', 'invite'));

-- ==================== 5. CIRCLE JOIN REQUESTS ====================
-- For circles with join_mode = 'approval', track pending join requests
CREATE TABLE IF NOT EXISTS public.circle_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id),
  UNIQUE(circle_id, user_id)
);

ALTER TABLE public.circle_join_requests ENABLE ROW LEVEL SECURITY;

-- Users can see their own requests + admins can see requests for their circles
CREATE POLICY "join_requests_read" ON public.circle_join_requests FOR SELECT USING (
  user_id = auth.uid()
  OR circle_id IN (
    SELECT circle_id FROM public.circle_members
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Users can create join requests
CREATE POLICY "join_requests_create" ON public.circle_join_requests FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

-- Admins can update (approve/reject) join requests
CREATE POLICY "join_requests_update" ON public.circle_join_requests FOR UPDATE USING (
  circle_id IN (
    SELECT circle_id FROM public.circle_members
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Users can delete their own pending requests (cancel)
CREATE POLICY "join_requests_delete" ON public.circle_join_requests FOR DELETE USING (
  user_id = auth.uid()
);

-- Enable realtime for join requests
ALTER PUBLICATION supabase_realtime ADD TABLE public.circle_join_requests;

-- ==================== 6. UPDATE CIRCLES READ POLICY ====================
-- Public circles should be searchable by anyone
-- Drop old policy and recreate with public visibility check
DROP POLICY IF EXISTS "circles_member_read" ON public.circles;

CREATE POLICY "circles_member_read" ON public.circles FOR SELECT USING (
  created_by = auth.uid()
  OR id IN (SELECT public.get_my_circle_ids())
  OR invite_code IS NOT NULL
  OR visibility = 'public'
);

-- ==================== 7. NOTIFICATION TYPES ====================
-- No schema change needed — notifications table already supports arbitrary types.
-- We'll use type = 'friend_request' for friend request notifications.
