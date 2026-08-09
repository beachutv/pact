-- v9.6: Fix pacts RLS - avoid circular dependency between pacts and pact_members policies
-- The v9.5 migration created circular RLS: pacts_read checks pact_members, pm_read checks pacts.
-- Fix: use a SECURITY DEFINER function to bypass RLS when checking membership.

-- Helper function: get pact IDs where user is a member (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_my_pact_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT pact_id FROM public.pact_members WHERE user_id = auth.uid()
$$;

-- Fix pacts_read: use the helper function instead of direct subquery
DROP POLICY IF EXISTS "pacts_read" ON public.pacts;
CREATE POLICY "pacts_read" ON public.pacts FOR SELECT USING (
  circle_id IN (SELECT public.get_my_circle_ids())
  OR id IN (SELECT public.get_my_pact_ids())
  OR created_by = auth.uid()
);

-- Fix pm_read: use both helper functions
DROP POLICY IF EXISTS "pm_read" ON public.pact_members;
CREATE POLICY "pm_read" ON public.pact_members FOR SELECT USING (
  pact_id IN (
    SELECT id FROM public.pacts WHERE circle_id IN (SELECT public.get_my_circle_ids())
  )
  OR pact_id IN (SELECT public.get_my_pact_ids())
);
