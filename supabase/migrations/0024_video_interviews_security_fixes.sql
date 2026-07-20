-- =============================================================================
-- Shugulika MVP — security and invariant fixes for async video interviews.
-- Closes: fake uploaded inserts, post-confirm storage overwrite, staff reopen,
-- missing assignment linkage, attempt-cap races, sticky completion, and
-- loose notification / reminder policies.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Attempt guard: never accept uploaded without a Storage object; freeze
-- uploaded metadata; lock selection after the question is completed.
-- ---------------------------------------------------------------------------
create or replace function public.tg_interview_attempt_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_assignment uuid;
  v_org uuid;
  v_response_seconds int;
  v_question_status text;
  v_storage_size bigint;
  v_object_updated timestamptz;
begin
  select q.assignment_id, q.response_seconds, q.status
    into v_assignment, v_response_seconds, v_question_status
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
    -- Clients must never insert a confirmed upload without the object present.
    if new.upload_status = 'uploaded' then
      select nullif(o.metadata->>'size', '')::bigint into v_storage_size
      from storage.objects o
      where o.bucket_id = new.storage_bucket and o.name = new.storage_path;
      if not found then
        raise exception 'recording object does not exist in storage';
      end if;
      if v_storage_size is not null then
        new.file_size_bytes := v_storage_size;
      end if;
      new.uploaded_at := coalesce(new.uploaded_at, now());
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

  if v_question_status = 'completed'
     and new.is_selected_submission is distinct from old.is_selected_submission then
    raise exception 'selected response is locked after question completion';
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
    select nullif(o.metadata->>'size', '')::bigint,
           coalesce(o.updated_at, o.created_at)
      into v_storage_size, v_object_updated
    from storage.objects o
    where o.bucket_id = new.storage_bucket and o.name = new.storage_path;
    if not found then
      raise exception 'recording object does not exist in storage';
    end if;
    -- Reject confirming an older leftover object after a re-record.
    if new.recording_ended_at is not null
       and v_object_updated is not null
       and v_object_updated < new.recording_ended_at - interval '5 seconds' then
      raise exception 'storage object is older than this recording attempt';
    end if;
    if v_storage_size is not null then
      new.file_size_bytes := v_storage_size;
    end if;
    new.uploaded_at := now();
  end if;
  return new;
end $$;

-- Attempt cap: lock the question row to prevent concurrent over-cap inserts.
create or replace function public.tg_interview_attempt_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_count int;
begin
  select max_attempts into v_max
  from public.interview_assignment_questions
  where id = new.assignment_question_id
  for update;
  if v_max is null then
    raise exception 'unknown assignment question';
  end if;
  select count(*) into v_count
  from public.interview_response_attempts
  where assignment_question_id = new.assignment_question_id;
  if v_count >= v_max then
    raise exception 'maximum attempts (%) reached for this question', v_max;
  end if;
  if new.attempt_number > v_max then
    raise exception 'attempt_number exceeds the configured maximum';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Question guard: freeze progress timestamps once completed.
-- ---------------------------------------------------------------------------
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
  if old.status = 'completed' then
    if new.status <> 'completed' then
      raise exception 'completed questions are locked';
    end if;
    if new.started_at is distinct from old.started_at
       or new.completed_at is distinct from old.completed_at then
      raise exception 'completed question timestamps are locked';
    end if;
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

-- ---------------------------------------------------------------------------
-- Assignment ownership linkage + safer staff transitions.
-- ---------------------------------------------------------------------------
create or replace function public.tg_interview_assignment_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_app public.applications;
  v_template_org uuid;
begin
  select * into v_app from public.applications where id = new.application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;
  if new.candidate_id is distinct from v_app.candidate_id
     or new.job_order_id is distinct from v_app.job_order_id
     or new.organization_id is distinct from v_app.owning_org_id then
    raise exception 'assignment must match the application candidate, job, and organization';
  end if;
  select organization_id into v_template_org
  from public.interview_templates where id = new.template_id;
  if v_template_org is null or v_template_org is distinct from new.organization_id then
    raise exception 'template must belong to the assignment organization';
  end if;
  return new;
end $$;

drop trigger if exists trg_interview_assignment_link on public.interview_assignments;
create trigger trg_interview_assignment_link
  before insert or update of candidate_id, application_id, job_order_id,
                             organization_id, template_id
  on public.interview_assignments
  for each row execute function public.tg_interview_assignment_link();

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
    -- Staff may cancel active interviews or mark submitted ones reviewed.
    -- They may not reopen a submitted/reviewed interview or invent "reviewed"
    -- without a prior candidate submission.
    if new.status is distinct from old.status then
      if old.status in ('submitted','reviewed')
         and new.status in ('draft','invited','in_progress','expired') then
        raise exception 'submitted interviews cannot be reopened';
      end if;
      if new.status = 'reviewed' and old.status not in ('submitted','reviewed') then
        raise exception 'only submitted interviews can be marked reviewed';
      end if;
      if new.status = 'cancelled'
         and old.status not in ('draft','invited','in_progress','cancelled') then
        raise exception 'this interview can no longer be cancelled';
      end if;
    end if;
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
      new.started_at := now();
      new.consented_at := now();
    elsif new.status = 'expired'
          and old.expires_at is not null and old.expires_at < now() then
      null;
    elsif new.status = 'submitted' then
      null;
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

-- ---------------------------------------------------------------------------
-- Storage: block overwrite after an attempt is confirmed uploaded.
-- ---------------------------------------------------------------------------
drop policy if exists "candidate update own interview recordings" on storage.objects;
create policy "candidate update own interview recordings"
on storage.objects for update to authenticated
using (
  bucket_id = 'interview-recordings'
  and exists (
    select 1
    from public.interview_response_attempts a
    join public.interview_assignments ia on ia.id = a.assignment_id
    where a.storage_bucket = 'interview-recordings'
      and a.storage_path = storage.objects.name
      and a.candidate_id = public.auth_candidate_id()
      and a.upload_status in ('pending','uploading','failed')
      and ia.status = 'in_progress'
      and (ia.expires_at is null or ia.expires_at > now())
  )
)
with check (
  bucket_id = 'interview-recordings'
  and exists (
    select 1
    from public.interview_response_attempts a
    join public.interview_assignments ia on ia.id = a.assignment_id
    where a.storage_bucket = 'interview-recordings'
      and a.storage_path = storage.objects.name
      and a.candidate_id = public.auth_candidate_id()
      and a.upload_status in ('pending','uploading','failed')
      and ia.status = 'in_progress'
      and (ia.expires_at is null or ia.expires_at > now())
  )
);

-- ---------------------------------------------------------------------------
-- Notifications: staff-only interview categories.
-- ---------------------------------------------------------------------------
drop policy if exists notif_staff_insert_interview on public.notifications;
create policy notif_staff_insert_interview on public.notifications
  for insert to authenticated
  with check (
    public.auth_is_interview_staff()
    and category in ('interview','interview_reminder')
    and subject_type = 'interview_assignment'
    and exists (
      select 1 from public.interview_assignments ia
      join public.candidate_profiles cp on cp.id = ia.candidate_id
      where ia.id = notifications.subject_id
        and cp.user_id = notifications.user_id
        and ia.organization_id in (select public.auth_scoped_org_ids())
    )
  );

-- Reminder RPC: same 48h eligibility window as the adapter view.
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
     or v_assignment.expires_at <= now()
     or v_assignment.expires_at > now() + interval '48 hours' then
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
