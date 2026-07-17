/* 0014 — stop applications ↔ job_orders RLS recursion for staff reads.

   app_read's Path-A branch does EXISTS (SELECT … FROM job_orders …).
   jo_applicant_read (from 0010) did EXISTS (SELECT … FROM applications …).
   Together that is 42P17 infinite recursion, so getPipeline() returns [] and
   applications vanish from the recruiter portal even though rows still exist.

   1) Keep applicant helpers SECURITY DEFINER (re-assert 0012).
   2) Replace app_read's Path-A job_orders subquery with a SECURITY DEFINER
      lookup so selecting applications never re-enters job_orders RLS. */

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

create or replace function public.auth_job_order_employer_org_id(p_job_order_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select jo.employer_org_id from public.job_orders jo where jo.id = p_job_order_id;
$$;

drop policy if exists jo_applicant_read on public.job_orders;
create policy jo_applicant_read on public.job_orders for select to authenticated
  using (job_orders.id in (select public.auth_applied_job_order_ids()));

drop policy if exists org_applicant_read on public.organizations;
create policy org_applicant_read on public.organizations for select to authenticated
  using (organizations.id in (select public.auth_applied_employer_org_ids()));

drop policy if exists app_read on public.applications;
create policy app_read on public.applications for select to authenticated using (
  candidate_id = public.auth_candidate_id()
  or owning_org_id in (select public.auth_scoped_org_ids())
  or (
    recruitment_path = 'A'
    and public.auth_job_order_employer_org_id(job_order_id) in (select public.auth_scoped_org_ids())
  )
);

notify pgrst, 'reload schema';
