-- File 0010: let candidates read job-order title/employer for roles they've
-- applied to, so My applications / dashboard / notifications can show the
-- specific role instead of a generic "Role" placeholder. Staff policies are
-- unchanged; this only opens a narrow applicant read path.
-- These applicant read paths are expressed through SECURITY DEFINER helpers so
-- they can read `applications` with RLS bypassed. A plain subquery on
-- `applications` inside a job_orders/organizations policy mutually recurses with
-- applications' own `app_read` policy (which subqueries `job_orders`), which
-- Postgres rejects at rewrite time with 42P17 "infinite recursion detected in
-- policy". The helpers mirror the same auth_* SECURITY DEFINER pattern as 0002.

-- Job-order ids the current candidate has applied to (RLS-bypassing).
create or replace function public.auth_applied_job_order_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.job_order_id from public.applications a
  where a.candidate_id = public.auth_candidate_id();
$$;

-- Employer-org ids for those same applied roles (RLS-bypassing).
create or replace function public.auth_applied_employer_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select jo.employer_org_id
  from public.applications a
  join public.job_orders jo on jo.id = a.job_order_id
  where a.candidate_id = public.auth_candidate_id();
$$;

create policy jo_applicant_read on public.job_orders for select to authenticated
  using (job_orders.id in (select public.auth_applied_job_order_ids()));

-- Employer org name for those same applied roles (respect confidential flag
-- in the app layer — this only grants the name when the candidate applied).
create policy org_applicant_read on public.organizations for select to authenticated
  using (organizations.id in (select public.auth_applied_employer_org_ids()));

-- Rewrite generic apply notifications that were created before role-specific copy.
update public.notifications n
set body = format(
  'Your application for %s at %s was received. We''ll update you as it progresses.',
  jo.title,
  case when jo.is_confidential then 'Confidential Employer' else o.name end
)
from public.applications a
join public.job_orders jo on jo.id = a.job_order_id
join public.organizations o on o.id = jo.employer_org_id
where n.subject_type = 'application'
  and n.subject_id = a.id
  and n.category = 'application_status'
  and n.body = 'Your application was received. We''ll update you as it progresses.';

notify pgrst, 'reload schema';
