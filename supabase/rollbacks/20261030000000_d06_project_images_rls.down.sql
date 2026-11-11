-- Rollback for supabase/migrations/20261030000000_d06_project_images_rls.sql.
-- Restores the policies exactly as captured in P02 (pg_dump of public.project_images).
-- Kept outside supabase/migrations so the Supabase CLI never runs it as an up migration.
-- Run as the table owner (supabase_admin), in one transaction.

drop policy "Anyone can view live project images" on public.project_images;

CREATE POLICY "Anyone can view project images" ON public.project_images FOR SELECT USING (true);
CREATE POLICY "Service can delete images" ON public.project_images FOR DELETE USING (true);
CREATE POLICY "Service can insert images" ON public.project_images FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can update images" ON public.project_images FOR UPDATE USING (true);
