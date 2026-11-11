-- D06-a2 (P08 R10, table part). public.project_images had PUBLIC policies
-- "Service can insert/update/delete images" with true, so anyone holding the
-- browser's anon key could insert, rewrite or delete every image row through
-- PostgREST. The app's server connects as postgres (BYPASSRLS) and never
-- needed them. The browser never reads this table through PostgREST either;
-- read access stays for anon and authenticated, but only for live images of
-- live projects, matching the server's rule (D06-a).
--
-- The storage.objects policies on the project-images bucket are unchanged
-- here: the browser uploads with the anon key and no user identity, so they
-- can't be made owner-only without changing the upload path (see D06_REPORT).
--
-- Rollback: supabase/rollbacks/20261030000000_d06_project_images_rls.down.sql
-- Run as the table owner (supabase_admin), in one transaction.

drop policy "Service can delete images" on public.project_images;
drop policy "Service can insert images" on public.project_images;
drop policy "Service can update images" on public.project_images;
drop policy "Anyone can view project images" on public.project_images;

create policy "Anyone can view live project images" on public.project_images
  for select to anon, authenticated
  using (
    deleted_at is null
    and exists (select 1 from public.projects p where p.id = project_id and p.deleted_at is null)
  );
