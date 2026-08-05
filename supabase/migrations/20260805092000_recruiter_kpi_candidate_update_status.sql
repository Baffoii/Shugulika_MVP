-- =============================================================================
-- Candidate-update status for the recruiter CX guardrails (Workstream A).
--
-- `notifications` is recipient-scoped by RLS (`user_id = auth.uid()`), which is
-- correct: staff must not be able to read candidates' inboxes. But two CX
-- guardrails need to know whether the candidate has *heard from us* and whether
-- they *opened* it — for applications the caller already manages.
--
-- This SECURITY DEFINER function threads that needle. It returns only
-- (application_id, notification_id, category, created_at, read_at) — never the
-- title, body, or any other recipient's rows — and only for applications inside
-- the caller's scoped orgs. The app still uses no service-role key.
-- =============================================================================

create or replace function public.kpi_candidate_update_status(p_application_ids uuid[])
returns table (
  application_id uuid,
  notification_id uuid,
  category text,
  created_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.id as application_id,
    n.id as notification_id,
    n.category,
    n.created_at,
    n.read_at
  from public.applications a
  join public.candidate_profiles cp on cp.id = a.candidate_id
  join public.notifications n
    on n.subject_type = 'application'
   and n.subject_id = a.id
   and n.user_id = cp.user_id          -- candidate's own copy only
  where a.id = any(p_application_ids)
    and a.owning_org_id in (select public.auth_scoped_org_ids())
    -- Staff only. Candidates and employers read their own data through their
    -- own surfaces; this function is not a side door for them.
    and (
      public.auth_is_hq()
      or public.auth_has_role('recruiter')
      or public.auth_has_role('franchise_admin')
    );
$$;

comment on function public.kpi_candidate_update_status(uuid[]) is
  'CX guardrail read: per-application candidate notification send/read timestamps. '
  'Returns no message content and only covers applications in the caller''s scoped orgs.';

revoke all on function public.kpi_candidate_update_status(uuid[]) from public, anon;
grant execute on function public.kpi_candidate_update_status(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
