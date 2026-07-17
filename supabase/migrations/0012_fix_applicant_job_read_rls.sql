/* 0012 — repair applicant job-order read policies.

   An earlier form of 0010 used a plain subquery on applications inside
   job_orders/organizations policies. That mutually recurses with app_read
   (which subqueries job_orders) and Postgres rejects the select with
   42P17 "infinite recursion detected in policy" — so My applications /
   Applied badges appear empty even though rows and notifications exist.
   Re-apply the SECURITY DEFINER helpers and policies idempotently. */

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

notify pgrst, 'reload schema';
