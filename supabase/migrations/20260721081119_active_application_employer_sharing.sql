-- Candidate account/application consent replaces the separate employer-specific
-- consent gate. Employers may see a submitted pack only while its application
-- remains active; candidate withdrawal therefore revokes access immediately.

create schema if not exists private;

create or replace function private.application_is_active(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.applications a
    where a.id = p_application_id
      and a.withdrawn_at is null
  );
$$;

revoke all on function private.application_is_active(uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.application_is_active(uuid) to authenticated;

drop policy if exists sub_read on public.employer_submissions;
create policy sub_read on public.employer_submissions
for select to authenticated
using (
  submitting_org_id in (select public.auth_scoped_org_ids())
  or (
    employer_org_id in (select public.auth_scoped_org_ids())
    and status in ('submitted','viewed','shortlisted','interview_requested','offered','rejected')
    and access_revoked_at is null
    and (
      application_id is null
      or private.application_is_active(application_id)
    )
  )
);
