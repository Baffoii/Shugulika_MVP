-- =============================================================================
-- Fix interview recording uploads broken by a leftover draft Storage policy.
-- "org writes own" includes bucket interview-recordings and evaluates
-- private.authorized_org_ids(), which depends on draft tables
-- (organization_memberships / organization_relationships) that are not part of
-- the MVP schema. When Postgres ORs INSERT policies, that exception aborts the
-- candidate signed-upload path even though the MVP candidate policy would pass.
-- =============================================================================

-- Keep org-owned buckets writable via the MVP helper; do NOT include
-- interview-recordings (candidate uploads use the dedicated interview policies).
drop policy if exists "org writes own" on storage.objects;

create policy "org writes own"
on storage.objects for insert to authenticated
with check (
  bucket_id = any (array[
    'employer-documents',
    'payment-evidence',
    'interview-audio',
    'interview-transcripts',
    'org-branding'
  ]::text[])
  and (storage.foldername(name))[2] in (
    select public.auth_scoped_org_ids()::text
  )
);

-- Soften the draft helper so any remaining callers fail closed instead of
-- raising when draft tables are absent. The `private` schema originates from
-- out-of-repo draft work, so ensure it exists on clean/staging databases
-- before (re)defining the helper.
create schema if not exists private;

create or replace function private.authorized_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.organization_id
  from public.memberships m
  where m.user_id = auth.uid()
    and m.status = 'active'
    and m.organization_id is not null;
$$;
