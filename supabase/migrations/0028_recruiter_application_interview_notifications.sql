-- Recruiter notifications for new applications and submitted video interviews.
-- Candidates cannot insert rows for other users (notif_self), so staff fan-out
-- must run through SECURITY DEFINER helpers.

create or replace function public.notify_organization_staff(
  p_org_id uuid,
  p_category text,
  p_title text,
  p_body text,
  p_subject_type text default null,
  p_subject_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if p_org_id is null then
    return 0;
  end if;

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  select distinct m.user_id, p_category, p_title, p_body, p_subject_type, p_subject_id
  from public.memberships m
  where m.organization_id = p_org_id
    and m.status = 'active'
    and m.role in ('recruiter', 'franchise_admin', 'operations', 'hq_admin');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_organization_staff(uuid, text, text, text, text, uuid) from public;
-- Only other definer functions call this — not exposed to clients directly.

-- Authorized entry point: the candidate on the application, or scoped staff.
create or replace function public.notify_staff_of_application(
  p_application_id uuid,
  p_event text default 'created'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_job_title text;
  v_candidate_name text;
  v_title text;
  v_body text;
begin
  select * into v_app
  from public.applications
  where id = p_application_id;

  if v_app.id is null then
    raise exception 'application not found';
  end if;

  if public.auth_candidate_id() is distinct from v_app.candidate_id
     and not public.auth_is_hq()
     and v_app.owning_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'not authorized';
  end if;

  select jo.title into v_job_title
  from public.job_orders jo
  where jo.id = v_app.job_order_id;

  select trim(both from concat_ws(' ', nullif(cp.given_name, ''), nullif(cp.family_name, '')))
  into v_candidate_name
  from public.candidate_profiles cp
  where cp.id = v_app.candidate_id;

  if p_event = 'updated' then
    v_title := 'Application updated';
    v_body := coalesce(nullif(v_candidate_name, ''), 'A candidate')
      || ' updated their application'
      || case when v_job_title is not null then ' for ' || v_job_title else '' end
      || '.';
  else
    v_title := 'New application';
    v_body := coalesce(nullif(v_candidate_name, ''), 'A candidate')
      || ' applied'
      || case when v_job_title is not null then ' for ' || v_job_title else ' for a role' end
      || '.';
  end if;

  return public.notify_organization_staff(
    v_app.owning_org_id,
    'application',
    v_title,
    v_body,
    'application',
    v_app.id
  );
end;
$$;

grant execute on function public.notify_staff_of_application(uuid, text) to authenticated;

-- Fan out video-interview submissions to all org staff (not only assigned_by).
create or replace function public.submit_interview(p_assignment_id uuid)
returns public.interview_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.interview_assignments;
  v_missing int;
  v_job_title text;
  v_candidate_name text;
begin
  select * into v_assignment
  from public.interview_assignments
  where id = p_assignment_id
  for update;

  if v_assignment.id is null
     or v_assignment.candidate_id is distinct from public.auth_candidate_id() then
    raise exception 'interview not found';
  end if;
  if v_assignment.status in ('submitted', 'reviewed') then
    return v_assignment;
  end if;
  if v_assignment.status in ('cancelled', 'expired') then
    raise exception 'this interview is no longer active';
  end if;
  if v_assignment.expires_at is not null and v_assignment.expires_at < now() then
    raise exception 'this interview has expired';
  end if;
  if v_assignment.status <> 'in_progress' then
    raise exception 'the interview has not been started';
  end if;

  select count(*) into v_missing
  from public.interview_assignment_questions q
  where q.assignment_id = p_assignment_id
    and q.is_required
    and (
      q.status <> 'completed'
      or not exists (
        select 1
        from public.interview_response_attempts a
        where a.assignment_question_id = q.id
          and a.is_selected_submission
          and a.upload_status = 'uploaded'
      )
    );
  if v_missing > 0 then
    raise exception 'required questions are incomplete (%)', v_missing;
  end if;

  perform set_config('app.submitting_interview', 'true', true);
  update public.interview_assignments
  set status = 'submitted', submitted_at = now()
  where id = p_assignment_id
  returning * into v_assignment;

  insert into public.interview_events (assignment_id, actor_user_id, event_type)
  values (p_assignment_id, auth.uid(), 'interview_submitted');

  select jo.title into v_job_title
  from public.job_orders jo
  where jo.id = v_assignment.job_order_id;

  select trim(both from concat_ws(' ', nullif(cp.given_name, ''), nullif(cp.family_name, '')))
  into v_candidate_name
  from public.candidate_profiles cp
  where cp.id = v_assignment.candidate_id;

  perform public.notify_organization_staff(
    v_assignment.organization_id,
    'interview',
    'Video interview submitted',
    coalesce(nullif(v_candidate_name, ''), 'A candidate')
      || ' submitted their video interview'
      || case when v_job_title is not null then ' for ' || v_job_title else '' end
      || '.',
    'interview_assignment',
    v_assignment.id
  );

  return v_assignment;
end;
$$;

grant execute on function public.submit_interview(uuid) to authenticated;

notify pgrst, 'reload schema';
