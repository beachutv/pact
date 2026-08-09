-- v21: Fix circle_members delete RLS policy
-- The existing cm_delete policy has a self-referencing subquery that can fail
-- due to RLS circular dependency. Use a SECURITY DEFINER function instead.

-- Helper function to check if user is admin of a circle (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_circle_admin(cid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.circle_members
    WHERE circle_id = cid AND user_id = auth.uid() AND role = 'admin'
  )
$$;

-- Recreate cm_delete policy using the helper
DROP POLICY IF EXISTS "cm_delete" ON public.circle_members;
CREATE POLICY "cm_delete" ON public.circle_members FOR DELETE USING (
  user_id = auth.uid() OR public.is_circle_admin(circle_id)
);
