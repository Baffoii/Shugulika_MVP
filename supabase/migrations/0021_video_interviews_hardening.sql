-- =============================================================================
-- Shugulika MVP — async video interview hardening.
-- 1. Prevent direct clients from marking an attempt uploaded before the object
--    exists in private Storage.
-- 2. Lock completed questions and enforce recorded duration at the DB layer.
-- 3. Require final status changes to pass through the idempotent submit RPC.
-- 4. Correct assignment analytics so retries do not multiply question counts.
-- =============================================================================

create or replace function public.tg_interview_attempt_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_assignment uuid;
  v_org uuid;
  v_response_seconds int;
begin
  if tg_op = 'INSERT' then
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
  if old.upload_status = 'uploaded' and new.upload_status <> 'uploaded' then
    raise exception 'an uploaded attempt cannot be reverted';
  end if;
  if old.upload_status <> 'uploaded' and new.upload_status = 'uploaded'
     and not exists (
       select 1 from storage.objects o
       where o.bucket_id = new.storage_bucket and o.name = new.storage_path
     ) then
    raise exception 'recording object does not exist in storage';
  end if;
  return new;
end $$;

create or replace function public.tg_interview_question_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignment_id is distinct from old.assignment_id
     or new.source_template_question_id is distinct from old.source_template_question_id
     or new.question_text_snapshot is distinct from old.question_text_snapshot
     or new.question_description_snapshot is distinct from old.question_description_snapshot
     or new.display_order is distinct from old.display_order
     or new.preparation_seconds is distinct from old.preparation_seconds
     or new.response_seconds is distinct from old.response_seconds
     or new.max_attempts is distinct from old.max_attempts
     or new.is_required is distinct from old.is_required then
    raise exception 'question snapshots are immutable';
  end if;
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'completed questions are locked';
  end if;
  if new.status = 'completed' and old.status <> 'completed' then
    if old.status <> 'in_progress' then
      raise exception 'the question must be opened before completion';
    end if;
    if new.completed_at is null then
      raise exception 'completed_at is required';
    end if;
    if not exists (
      select 1 from public.interview_response_attempts a
      where a.assignment_question_id = old.id
        and a.is_selected_submission and a.upload_status = 'uploaded'
    ) then
      raise exception 'a question needs an uploaded, selected response before completion';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_interview_assignment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_staff boolean;
  v_missing int;
begin
  if new.candidate_id is distinct from old.candidate_id
     or new.application_id is distinct from old.application_id
     or new.job_order_id is distinct from old.job_order_id
     or new.organization_id is distinct from old.organization_id
     or new.template_id is distinct from old.template_id then
    raise exception 'assignment ownership fields are immutable';
  end if;

  if old.consented_at is not null and (
       new.consented_at is distinct from old.consented_at
       or new.privacy_notice_version is distinct from old.privacy_notice_version
       or new.instructions_version is distinct from old.instructions_version) then
    raise exception 'consent records are immutable';
  end if;

  if new.status = 'submitted' and old.status <> 'submitted' then
    if old.status <> 'in_progress' then
      raise exception 'only an in-progress interview can be submitted';
    end if;
    if current_setting('app.submitting_interview', true) <> 'true' then
      raise exception 'use submit_interview to finalize this interview';
    end if;
    select count(*) into v_missing
    from public.interview_assignment_questions q
    where q.assignment_id = old.id
      and q.is_required
      and (q.status <> 'completed'
           or not exists (
             select 1 from public.interview_response_attempts a
             where a.assignment_question_id = q.id
               and a.is_selected_submission and a.upload_status = 'uploaded'));
    if v_missing > 0 then
      raise exception 'required questions are incomplete';
    end if;
    new.submitted_at := now();
  end if;

  v_is_staff := public.auth_is_interview_staff()
    and old.organization_id in (select public.auth_scoped_org_ids());
  if v_is_staff then
    return new;
  end if;

  if old.status in ('submitted','reviewed','cancelled') then
    raise exception 'this interview can no longer be modified';
  end if;

  if new.expires_at is distinct from old.expires_at
     or new.invited_at is distinct from old.invited_at
     or new.cancelled_at is distinct from old.cancelled_at
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.assigned_by is distinct from old.assigned_by
     or new.candidate_instructions is distinct from old.candidate_instructions
     or new.template_name_snapshot is distinct from old.template_name_snapshot
     or new.template_instructions_snapshot is distinct from old.template_instructions_snapshot
     or new.retention_days is distinct from old.retention_days then
    raise exception 'field not editable';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'invited' and new.status = 'in_progress' then
      if new.consented_at is null
         or nullif(new.privacy_notice_version, '') is null
         or nullif(new.instructions_version, '') is null then
        raise exception 'consent and notice versions are required to begin';
      end if;
      if old.expires_at is not null and old.expires_at < now() then
        raise exception 'this interview has expired';
      end if;
      -- Always use database time, even if a direct client supplied values.
      new.started_at := now();
      new.consented_at := now();
    elsif new.status = 'expired'
          and old.expires_at is not null and old.expires_at < now() then
      null;
    elsif new.status = 'submitted' then
      null; -- the RPC marker and completeness were verified above
    else
      raise exception 'invalid status change';
    end if;
  else
    if new.started_at is distinct from old.started_at
       or new.submitted_at is distinct from old.submitted_at
       or new.consented_at is distinct from old.consented_at
       or new.privacy_notice_version is distinct from old.privacy_notice_version
       or new.instructions_version is distinct from old.instructions_version then
      raise exception 'server timestamps and consent fields are not editable';
    end if;
  end if;

  return new;
end $$;

create or replace function public.submit_interview(p_assignment_id uuid)
returns public.interview_assignments
language plpgsql security definer set search_path = public as $$
declare
  v_assignment public.interview_assignments;
  v_missing int;
  v_job_title text;
begin
  select * into v_assignment
  from public.interview_assignments
  where id = p_assignment_id
  for update;

  if v_assignment.id is null
     or v_assignment.candidate_id is distinct from public.auth_candidate_id() then
    raise exception 'interview not found';
  end if;
  if v_assignment.status in ('submitted','reviewed') then
    return v_assignment;
  end if;
  if v_assignment.status in ('cancelled','expired') then
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
    and (q.status <> 'completed'
         or not exists (
           select 1 from public.interview_response_attempts a
           where a.assignment_question_id = q.id
             and a.is_selected_submission and a.upload_status = 'uploaded'));
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
  from public.job_orders jo where jo.id = v_assignment.job_order_id;
  if v_assignment.assigned_by is not null then
    insert into public.notifications
      (user_id, category, title, body, subject_type, subject_id)
    values (
      v_assignment.assigned_by, 'interview', 'Video interview submitted',
      coalesce('A candidate submitted their video interview for ' || v_job_title || '.',
               'A candidate submitted their video interview.'),
      'interview_assignment', v_assignment.id
    );
  end if;
  return v_assignment;
end $$;

create or replace view public.interview_question_analytics
with (security_invoker = on) as
with attempt_stats as (
  select
    a.assignment_question_id,
    count(*) filter (
      where a.recording_started_at is not null or a.upload_status <> 'pending'
    )::int as attempts_used,
    max(a.attempt_number) filter (where a.is_selected_submission) as selected_attempt_number,
    max(a.duration_seconds) filter (
      where a.is_selected_submission
    ) as selected_response_duration_seconds,
    avg(a.duration_seconds) as average_attempt_duration_seconds,
    coalesce(sum(a.duration_seconds), 0) as total_attempt_duration_seconds,
    max(a.preparation_time_used_seconds) filter (
      where a.is_selected_submission
    ) as preparation_time_used_seconds
  from public.interview_response_attempts a
  group by a.assignment_question_id
),
failure_stats as (
  select e.assignment_question_id, count(*)::int as upload_failure_count
  from public.interview_events e
  where e.event_type = 'upload_failed' and e.assignment_question_id is not null
  group by e.assignment_question_id
)
select
  q.id as assignment_question_id,
  q.assignment_id,
  q.display_order,
  q.is_required,
  q.status,
  coalesce(a.attempts_used, 0) as attempts_used,
  greatest(coalesce(a.attempts_used, 0) - 1, 0) as retry_count,
  a.selected_attempt_number,
  a.selected_response_duration_seconds,
  a.average_attempt_duration_seconds,
  coalesce(a.total_attempt_duration_seconds, 0) as total_attempt_duration_seconds,
  a.preparation_time_used_seconds,
  case when q.started_at is not null and q.completed_at is not null
       then extract(epoch from (q.completed_at - q.started_at))
  end as time_from_question_opened_to_completion_seconds,
  coalesce(f.upload_failure_count, 0) as upload_failure_count
from public.interview_assignment_questions q
left join attempt_stats a on a.assignment_question_id = q.id
left join failure_stats f on f.assignment_question_id = q.id;

create or replace view public.interview_assignment_analytics
with (security_invoker = on) as
select
  ia.id as assignment_id,
  ia.status,
  count(q.assignment_question_id) filter (where q.is_required)::int as required_question_count,
  count(q.assignment_question_id)::int as total_question_count,
  count(q.assignment_question_id) filter (where q.status = 'completed')::int
    as completed_question_count,
  case when count(q.assignment_question_id) filter (where q.is_required) > 0
       then round(
         100.0 * count(q.assignment_question_id) filter (
           where q.is_required and q.status = 'completed'
         ) / count(q.assignment_question_id) filter (where q.is_required)
       )
       else 0
  end::int as completion_percentage,
  ia.started_at,
  ia.submitted_at,
  case when ia.started_at is not null and ia.submitted_at is not null
       then extract(epoch from (ia.submitted_at - ia.started_at))
  end as total_elapsed_seconds,
  coalesce(sum(q.attempts_used), 0)::int as total_attempts,
  coalesce(sum(q.retry_count), 0)::int as total_retries,
  avg(q.selected_response_duration_seconds) as average_final_response_duration_seconds,
  case when count(q.assignment_question_id) > 0
       then round(coalesce(sum(q.attempts_used), 0)::numeric
                  / count(q.assignment_question_id), 2)
  end as average_attempts_per_question,
  coalesce(sum(q.selected_response_duration_seconds), 0)
    as total_final_recording_duration_seconds,
  coalesce(sum(q.total_attempt_duration_seconds), 0)
    as total_recording_duration_seconds,
  coalesce(sum(q.upload_failure_count), 0)::int as upload_failure_count,
  coalesce((
    select sum(a.file_size_bytes)
    from public.interview_response_attempts a
    where a.assignment_id = ia.id and a.upload_status = 'uploaded'
  ), 0)::bigint as total_uploaded_bytes
from public.interview_assignments ia
left join public.interview_question_analytics q on q.assignment_id = ia.id
group by ia.id;

grant select on public.interview_question_analytics,
  public.interview_assignment_analytics to authenticated;
