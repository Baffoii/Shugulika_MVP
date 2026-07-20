-- gen_random_bytes lives in the extensions schema on Supabase.
-- begin_or_resume_interview_session used an unqualified call with search_path=public,
-- which caused: function gen_random_bytes(integer) does not exist

create or replace function public.begin_or_resume_interview_session(
  p_assignment_id uuid,
  p_previous_token text default null,
  p_reason text default null
)
returns table (
  session_token text,
  resumed boolean,
  interruption_count int,
  has_unusual_interruptions boolean,
  allow_pause_between_questions boolean,
  allow_response_review boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_assignment public.interview_assignments;
  v_token text;
  v_resumed boolean := false;
  v_count int;
  v_unusual boolean;
begin
  select * into v_assignment
  from public.interview_assignments
  where id = p_assignment_id
  for update;

  if v_assignment.id is null then
    raise exception 'interview not found';
  end if;
  if v_assignment.candidate_id is distinct from public.auth_candidate_id() then
    raise exception 'interview not found';
  end if;
  if v_assignment.status is distinct from 'in_progress' then
    raise exception 'interview is not active';
  end if;

  if v_assignment.session_token is null then
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    update public.interview_assignments
    set session_token = v_token,
        session_token_issued_at = now()
    where id = p_assignment_id;
    insert into public.interview_events (assignment_id, actor_user_id, event_type, metadata)
    values (
      p_assignment_id, auth.uid(), 'session_started',
      jsonb_build_object('reason', coalesce(p_reason, 'initial'))
    );
  elsif p_previous_token is not null and p_previous_token = v_assignment.session_token then
    v_token := v_assignment.session_token;
    v_resumed := true;
    insert into public.interview_events (assignment_id, actor_user_id, event_type, metadata)
    values (
      p_assignment_id, auth.uid(), 'session_resumed',
      jsonb_build_object('reason', coalesce(p_reason, 'reconnect'), 'controlled_recovery', true)
    );
  else
    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_count := v_assignment.interruption_count + 1;
    v_unusual := v_count >= 2 or coalesce(v_assignment.has_unusual_interruptions, false);
    update public.interview_assignments
    set session_token = v_token,
        session_token_issued_at = now(),
        interruption_count = v_count,
        has_unusual_interruptions = v_unusual
    where id = p_assignment_id;
    insert into public.interview_events (assignment_id, actor_user_id, event_type, metadata)
    values (
      p_assignment_id, auth.uid(), 'session_interrupted',
      jsonb_build_object(
        'reason', coalesce(p_reason, 'unauthorized_restart'),
        'previous_token_present', p_previous_token is not null,
        'interruption_count', v_count,
        'flagged_for_review', v_unusual
      )
    );
    insert into public.interview_events (assignment_id, actor_user_id, event_type, metadata)
    values (
      p_assignment_id, auth.uid(), 'session_started',
      jsonb_build_object('reason', 'replacement_after_interruption', 'interruption_count', v_count)
    );
    v_assignment.interruption_count := v_count;
    v_assignment.has_unusual_interruptions := v_unusual;
  end if;

  return query
  select
    coalesce(v_token, v_assignment.session_token),
    v_resumed,
    v_assignment.interruption_count,
    v_assignment.has_unusual_interruptions,
    v_assignment.allow_pause_between_questions,
    v_assignment.allow_response_review;
end;
$$;
