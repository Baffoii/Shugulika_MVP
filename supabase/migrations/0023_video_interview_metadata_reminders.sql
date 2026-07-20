-- =============================================================================
-- Recording metadata integrity + deadline reminder adapter.
-- =============================================================================

create or replace function public.tg_interview_attempt_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_assignment uuid;
  v_org uuid;
  v_response_seconds int;
  v_storage_size bigint;
begin
  select q.assignment_id, q.response_seconds
    into v_assignment, v_response_seconds
  from public.interview_assignment_questions q
  where q.id = new.assignment_question_id;

  if v_assignment is null or v_assignment <> new.assignment_id then
    raise exception 'question does not belong to this assignment';
  end if;
  if new.duration_seconds is not null
     and new.duration_seconds > v_response_seconds + 5 then
    raise exception 'recording exceeds the configured response limit';
  end if;

  if tg_op = 'INSERT' then
    select ia.organization_id into v_org
    from public.interview_assignments ia where ia.id = new.assignment_id;
    if new.storage_path !~ ('^organization/' || v_org || '/interviews/' || new.assignment_id
        || '/questions/' || new.assignment_question_id || '/attempts/' || new.id
        || '\.(webm|mp4)$') then
      raise exception 'invalid storage path';
    end if;
    return new;
  end if;

  if new.assignment_question_id is distinct from old.assignment_question_id
     or new.assignment_id is distinct from old.assignment_id
     or new.candidate_id is distinct from old.candidate_id
     or new.attempt_number is distinct from old.attempt_number
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path then
    raise exception 'attempt identity fields are immutable';
  end if;

  if old.upload_status = 'uploaded' then
    if new.upload_status <> 'uploaded' then
      raise exception 'an uploaded attempt cannot be reverted';
    end if;
    if new.mime_type is distinct from old.mime_type
       or new.file_size_bytes is distinct from old.file_size_bytes
       or new.duration_seconds is distinct from old.duration_seconds
       or new.preparation_time_used_seconds is distinct from old.preparation_time_used_seconds
       or new.recording_started_at is distinct from old.recording_started_at
       or new.recording_ended_at is distinct from old.recording_ended_at
       or new.uploaded_at is distinct from old.uploaded_at
       or new.client_metadata is distinct from old.client_metadata then
      raise exception 'uploaded recording metadata is immutable';
    end if;
  elsif new.upload_status = 'uploaded' then
    select nullif(o.metadata->>'size', '')::bigint into v_storage_size
    from storage.objects o
    where o.bucket_id = new.storage_bucket and o.name = new.storage_path;
    if not found then
      raise exception 'recording object does not exist in storage';
    end if;
    if v_storage_size is not null then
      new.file_size_bytes := v_storage_size;
    end if;
    new.uploaded_at := now();
  end if;
  return new;
end $$;

-- A scheduler/email adapter can query this invoker view, or recruiters can use
-- the RPC below to create an in-app reminder. The anti-join prevents repeated
-- reminders inside 24 hours.
create or replace view public.interview_deadline_reminder_candidates
with (security_invoker = on) as
select
  ia.id as assignment_id,
  ia.organization_id,
  ia.expires_at,
  cp.user_id as candidate_user_id,
  jo.title as job_title
from public.interview_assignments ia
join public.candidate_profiles cp on cp.id = ia.candidate_id
join public.job_orders jo on jo.id = ia.job_order_id
where ia.status in ('invited','in_progress')
  and ia.expires_at > now()
  and ia.expires_at <= now() + interval '48 hours'
  and not exists (
    select 1 from public.notifications n
    where n.user_id = cp.user_id
      and n.category = 'interview_reminder'
      and n.subject_type = 'interview_assignment'
      and n.subject_id = ia.id
      and n.created_at > now() - interval '24 hours'
  );

grant select on public.interview_deadline_reminder_candidates to authenticated;

create or replace function public.send_interview_deadline_reminder(p_assignment_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_assignment public.interview_assignments;
  v_candidate_user_id uuid;
  v_job_title text;
begin
  select * into v_assignment
  from public.interview_assignments where id = p_assignment_id;
  if v_assignment.id is null
     or not public.auth_is_interview_staff()
     or v_assignment.organization_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'interview not found or not authorized';
  end if;
  if v_assignment.status not in ('invited','in_progress')
     or v_assignment.expires_at is null
     or v_assignment.expires_at <= now() then
    raise exception 'interview is not eligible for a reminder';
  end if;
  if exists (
    select 1 from public.notifications n
    where n.category = 'interview_reminder'
      and n.subject_type = 'interview_assignment'
      and n.subject_id = p_assignment_id
      and n.created_at > now() - interval '24 hours'
  ) then
    return false;
  end if;

  select cp.user_id, jo.title into v_candidate_user_id, v_job_title
  from public.candidate_profiles cp
  join public.job_orders jo on jo.id = v_assignment.job_order_id
  where cp.id = v_assignment.candidate_id;

  insert into public.notifications
    (user_id, category, title, body, subject_type, subject_id)
  values (
    v_candidate_user_id,
    'interview_reminder',
    'Video interview deadline reminder',
    'Your video interview for ' || v_job_title || ' is due soon.',
    'interview_assignment',
    p_assignment_id
  );
  return true;
end $$;

grant execute on function public.send_interview_deadline_reminder(uuid) to authenticated;
