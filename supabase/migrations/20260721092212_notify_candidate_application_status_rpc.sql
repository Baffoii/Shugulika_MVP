-- Reliable candidate stage notifications via security definer.
-- Direct inserts against notifications rely on notif_staff_insert RLS, which
-- can drift; this mirrors notify_staff_of_application and authorizes scoped
-- staff / HQ before inserting for the application's candidate.

create or replace function public.notify_candidate_of_application_status(
  p_application_id uuid,
  p_title text,
  p_body text,
  p_category text default 'application_status'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_user_id uuid;
  v_notification_id uuid;
begin
  if p_application_id is null or nullif(trim(p_title), '') is null or nullif(trim(p_body), '') is null then
    raise exception 'application id, title, and body are required';
  end if;

  select * into v_app
  from public.applications
  where id = p_application_id;

  if v_app.id is null then
    raise exception 'application not found';
  end if;

  if not public.auth_is_hq()
     and v_app.owning_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'not authorized';
  end if;

  select cp.user_id into v_user_id
  from public.candidate_profiles cp
  where cp.id = v_app.candidate_id;

  if v_user_id is null then
    raise exception 'candidate has no linked user';
  end if;

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  values (
    v_user_id,
    coalesce(nullif(trim(p_category), ''), 'application_status'),
    trim(p_title),
    trim(p_body),
    'application',
    v_app.id
  )
  returning id into v_notification_id;

  return v_notification_id;
end;
$$;

revoke all on function public.notify_candidate_of_application_status(uuid, text, text, text) from public;
grant execute on function public.notify_candidate_of_application_status(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
