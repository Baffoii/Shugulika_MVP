-- File 0010: let candidates read job-order title/employer for roles they've
-- applied to, so My applications / dashboard / notifications can show the
-- specific role instead of a generic "Role" placeholder. Staff policies are
-- unchanged; this only opens a narrow applicant read path.
create policy jo_applicant_read on public.job_orders for select to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.job_order_id = job_orders.id
        and a.candidate_id = public.auth_candidate_id()
    )
  );

-- Employer org name for those same applied roles (respect confidential flag
-- in the app layer — this only grants the name when the candidate applied).
create policy org_applicant_read on public.organizations for select to authenticated
  using (
    exists (
      select 1
      from public.applications a
      join public.job_orders jo on jo.id = a.job_order_id
      where a.candidate_id = public.auth_candidate_id()
        and jo.employer_org_id = organizations.id
    )
  );

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
