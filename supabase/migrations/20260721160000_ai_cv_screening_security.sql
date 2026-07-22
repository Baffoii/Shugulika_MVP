-- =============================================================================
-- Harden AI CV screening RPCs:
--   1. ai_cv_screens_used — only HQ or members of the employer org may read
--      usage counts (prevents cross-tenant metering probes).
--   2. Revoke EXECUTE from PUBLIC/anon on screening helpers so they are not
--      callable unauthenticated via PostgREST.
-- =============================================================================

create or replace function public.ai_cv_screens_used(p_employer_org uuid, p_since timestamptz)
returns int language sql stable security definer set search_path = public as $$
  select case
    when public.auth_is_hq()
      or p_employer_org in (select public.auth_scoped_org_ids())
    then (
      select count(*)::int
      from public.application_ai_reviews r
      join public.applications a on a.id = r.application_id
      join public.job_orders jo on jo.id = a.job_order_id
      where jo.employer_org_id = p_employer_org
        and r.status = 'succeeded'
        and r.created_at >= p_since
    )
    else 0
  end;
$$;

revoke all on function public.ai_cv_screens_used(uuid, timestamptz) from public;
revoke all on function public.ai_cv_screens_used(uuid, timestamptz) from anon;
grant execute on function public.ai_cv_screens_used(uuid, timestamptz) to authenticated;

revoke all on function public.auth_can_staff_read_application(uuid) from public;
revoke all on function public.auth_can_staff_read_application(uuid) from anon;
grant execute on function public.auth_can_staff_read_application(uuid) to authenticated;

revoke all on function public.auth_can_staff_manage_job_order(uuid) from public;
revoke all on function public.auth_can_staff_manage_job_order(uuid) from anon;
grant execute on function public.auth_can_staff_manage_job_order(uuid) to authenticated;
