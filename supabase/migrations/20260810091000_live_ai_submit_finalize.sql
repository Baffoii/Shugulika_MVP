-- Allow live AI submit when session ended (including abandoned), and repair stuck rows.

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
  v_mode text;
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

  v_mode := coalesce(v_assignment.interview_mode, 'async_video');
  if v_mode = 'live_ai_voice' then
    if not exists (
      select 1 from public.interview_live_sessions s
      where s.assignment_id = p_assignment_id
        and s.status in ('completed', 'incomplete_technical', 'abandoned')
    ) then
      raise exception 'live AI session is not complete';
    end if;
  else
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
    case when v_mode = 'live_ai_voice' then 'AI voice interview submitted'
         else 'Video interview submitted' end,
    coalesce(nullif(v_candidate_name, ''), 'A candidate')
      || case when v_mode = 'live_ai_voice'
              then ' completed their AI voice interview'
              else ' submitted their video interview' end
      || case when v_job_title is not null then ' for ' || v_job_title else '' end
      || '.',
    'interview_assignment',
    v_assignment.id
  );

  return v_assignment;
end;
$$;

-- Re-assert execute privileges after the replace. `create or replace` keeps the
-- existing ACL, so this also repairs databases where an older migration left
-- EXECUTE granted to PUBLIC.
revoke all on function public.submit_interview(uuid) from public;
revoke all on function public.submit_interview(uuid) from anon;
grant execute on function public.submit_interview(uuid) to authenticated;

notify pgrst, 'reload schema';
