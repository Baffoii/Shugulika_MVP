-- File 0010: let candidates read job-order title/employer for roles they've
-- applied to. MUST use SECURITY DEFINER helpers — a plain subquery on
-- applications inside job_orders policies mutually recurses with app_read.
-- (If you already applied an older recursive version of this file, run 0012
-- and 0014 to repair.)

create or replace function public.auth_applied_job_order_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.job_order_id from public.applications a
  where a.candidate_id = public.auth_candidate_id();
$$;

create or replace function public.auth_applied_employer_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select jo.employer_org_id
  from public.applications a
  join public.job_orders jo on jo.id = a.job_order_id
  where a.candidate_id = public.auth_candidate_id();
$$;

drop policy if exists jo_applicant_read on public.job_orders;
create policy jo_applicant_read on public.job_orders for select to authenticated
  using (job_orders.id in (select public.auth_applied_job_order_ids()));

drop policy if exists org_applicant_read on public.organizations;
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
