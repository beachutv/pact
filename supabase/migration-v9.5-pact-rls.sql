-- v9.5: Fix pacts RLS to allow reading plans the user is a member of
-- Previously, pacts_read only allowed circle_id in get_my_circle_ids(),
-- which excluded plans with null circle_id entirely.

-- Drop and recreate pacts_read to also check pact_members
DROP POLICY IF EXISTS "pacts_read" ON public.pacts;
CREATE POLICY "pacts_read" ON public.pacts FOR SELECT USING (
  circle_id IN (SELECT public.get_my_circle_ids())
  OR id IN (SELECT pact_id FROM public.pact_members WHERE user_id = auth.uid())
  OR created_by = auth.uid()
);

-- Also fix pact_members read — same issue
DROP POLICY IF EXISTS "pm_read" ON public.pact_members;
CREATE POLICY "pm_read" ON public.pact_members FOR SELECT USING (
  pact_id IN (
    SELECT id FROM public.pacts WHERE circle_id IN (SELECT public.get_my_circle_ids())
  )
  OR pact_id IN (SELECT pact_id FROM public.pact_members WHERE user_id = auth.uid())
);

-- Also fix pacts_update and pacts_delete to work for members with null circle_id
DROP POLICY IF EXISTS "pacts_update" ON public.pacts;
CREATE POLICY "pacts_update" ON public.pacts FOR UPDATE USING (
  created_by = auth.uid() OR circle_id IN (
    SELECT circle_id FROM public.circle_members
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

DROP POLICY IF EXISTS "pacts_delete" ON public.pacts;
CREATE POLICY "pacts_delete" ON public.pacts FOR DELETE USING (
  created_by = auth.uid() OR circle_id IN (
    SELECT circle_id FROM public.circle_members
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);
