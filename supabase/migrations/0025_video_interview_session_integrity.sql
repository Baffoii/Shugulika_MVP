-- =============================================================================
-- Asynchronous video interviews: recruiter session settings, document locking,
-- session interruption tracking, and reconnection tokens.
-- Additive only — preserves existing templates, assignments, and analytics.
-- =============================================================================

-- ---- Template / assignment session settings ---------------------------------
alter table public.interview_templates
  add column if not exists allow_pause_between_questions boolean not null default false,
  add column if not exists allow_response_review boolean not null default true,
  add column if not exists default_deadline_days int not null default 7
    check (default_deadline_days between 1 and 90),
  add column if not exists expiration_grace_hours int not null default 0
    check (expiration_grace_hours between 0 and 72);

alter table public.interview_assignments
  add column if not exists allow_pause_between_questions boolean not null default false,
  add column if not exists allow_response_review boolean not null default true,
  add column if not exists expiration_grace_hours int not null default 0
    check (expiration_grace_hours between 0 and 72),
  add column if not exists session_token text,
  add column if not exists session_token_issued_at timestamptz,
  add column if not exists interruption_count int not null default 0
    check (interruption_count >= 0),
  add column if not exists has_unusual_interruptions boolean not null default false,
  add column if not exists documents_locked_at timestamptz,
  add column if not exists document_snapshot jsonb not null default '[]'::jsonb;

comment on column public.interview_templates.allow_pause_between_questions is
  'When true, candidates may take a controlled break between questions.';
comment on column public.interview_templates.allow_response_review is
  'When true, candidates may review a recording before uploading/selecting it.';
comment on column public.interview_templates.default_deadline_days is
  'Suggested deadline offset when recruiters create an assignment.';
comment on column public.interview_templates.expiration_grace_hours is
  'Extra hours after expires_at during which an in-progress session may finish.';
comment on column public.interview_assignments.document_snapshot is
  'Immutable snapshot of candidate documents locked at interview start.';
comment on column public.interview_assignments.session_token is
  'Opaque token for continuous-session recovery after accidental disconnect.';

-- Backfill assignment snapshots from their templates where still defaulted.
update public.interview_assignments a
set
  allow_pause_between_questions = t.allow_pause_between_questions,
  allow_response_review = t.allow_response_review,
  expiration_grace_hours = t.expiration_grace_hours
from public.interview_templates t
where a.template_id = t.id
  and a.started_at is null;

-- ---- Expand event whitelist for session integrity ---------------------------
alter table public.interview_events
  drop constraint if exists interview_events_event_type_check;

alter table public.interview_events
  add constraint interview_events_event_type_check check (event_type in (
    'interview_opened','consent_given','permissions_requested','permissions_denied',
    'question_opened','preparation_started','recording_started','recording_stopped',
    'retry_selected','upload_started','upload_completed','upload_failed',
    'response_selected','question_completed','interview_submitted',
    'session_started','session_heartbeat','session_interrupted','session_resumed',
    'visibility_hidden','visibility_visible','page_unload_warned',
    'connection_lost','connection_restored','break_started','break_ended',
    'document_change_attempted','document_snapshot_locked'
  ));

-- ---- Document lock helpers --------------------------------------------------
create or replace function public.candidate_has_active_interview(p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.interview_assignments a
    where a.candidate_id = p_candidate_id
      and a.status = 'in_progress'
      and a.documents_locked_at is not null
  );
$$;

revoke all on function public.candidate_has_active_interview(uuid) from public;
grant execute on function public.candidate_has_active_interview(uuid) to authenticated;

create or replace function public.tg_candidate_documents_interview_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id uuid;
  v_assignment_id uuid;
begin
  v_candidate_id := coalesce(new.candidate_id, old.candidate_id);
  if not public.candidate_has_active_interview(v_candidate_id) then
    return coalesce(new, old);
  end if;

  select a.id into v_assignment_id
  from public.interview_assignments a
  where a.candidate_id = v_candidate_id
    and a.status = 'in_progress'
    and a.documents_locked_at is not null
  order by a.started_at desc nulls last
  limit 1;

  if v_assignment_id is not null then
    insert into public.interview_events (
      assignment_id, actor_user_id, event_type, metadata
    ) values (
      v_assignment_id,
      auth.uid(),
      'document_change_attempted',
      jsonb_build_object(
        'operation', tg_op,
        'document_id', coalesce(new.id, old.id),
        'doc_type', coalesce(new.doc_type, old.doc_type),
        'object_path', coalesce(new.object_path, old.object_path),
        'note', 'Document changes are blocked while an interview session is active. Flagged for recruiter review.'
      )
    );
  end if;

  raise exception
    'Identity and supporting documents are locked for the active interview session and cannot be changed until the interview is submitted or cancelled.';
end;
$$;

drop trigger if exists trg_candidate_documents_interview_lock on public.candidate_documents;
create trigger trg_candidate_documents_interview_lock
  before insert or update or delete on public.candidate_documents
  for each row execute function public.tg_candidate_documents_interview_lock();

-- ---- Session token / interruption RPCs --------------------------------------
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

  -- Controlled recovery: same token may resume. A missing/mismatched token after
  -- a prior session is treated as an interruption and flagged for review.
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

revoke all on function public.begin_or_resume_interview_session(uuid, text, text) from public;
grant execute on function public.begin_or_resume_interview_session(uuid, text, text) to authenticated;

create or replace function public.record_interview_session_event(
  p_assignment_id uuid,
  p_session_token text,
  p_event_type text,
  p_assignment_question_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.interview_assignments;
  v_count int;
  v_unusual boolean;
begin
  if p_event_type not in (
    'session_heartbeat','session_interrupted','session_resumed',
    'visibility_hidden','visibility_visible','page_unload_warned',
    'connection_lost','connection_restored','break_started','break_ended',
    'document_change_attempted'
  ) then
    raise exception 'unsupported session event';
  end if;

  select * into v_assignment
  from public.interview_assignments
  where id = p_assignment_id
  for update;

  if v_assignment.id is null
     or v_assignment.candidate_id is distinct from public.auth_candidate_id() then
    raise exception 'interview not found';
  end if;
  if v_assignment.status is distinct from 'in_progress' then
    return false;
  end if;
  if v_assignment.session_token is distinct from p_session_token then
    raise exception 'invalid session token';
  end if;

  if p_event_type in ('session_interrupted', 'connection_lost', 'page_unload_warned') then
    v_count := v_assignment.interruption_count + case
      when p_event_type = 'session_interrupted' then 1 else 0 end;
    -- Unusual: repeated hard interruptions, or leave/close while recording.
    v_unusual := v_assignment.has_unusual_interruptions
      or v_count >= 2
      or coalesce(p_metadata->>'during_recording', 'false') = 'true'
      or coalesce(p_metadata->>'reason', '') in ('tab_close', 'refresh', 'navigation');
    if v_count is distinct from v_assignment.interruption_count
       or v_unusual is distinct from v_assignment.has_unusual_interruptions then
      update public.interview_assignments
      set interruption_count = greatest(v_count, v_assignment.interruption_count),
          has_unusual_interruptions = v_unusual
      where id = p_assignment_id;
    end if;
  end if;

  insert into public.interview_events (
    assignment_id, assignment_question_id, actor_user_id, event_type, metadata
  ) values (
    p_assignment_id,
    p_assignment_question_id,
    auth.uid(),
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb)
  );
  return true;
end;
$$;

revoke all on function public.record_interview_session_event(uuid, text, text, uuid, jsonb) from public;
grant execute on function public.record_interview_session_event(uuid, text, text, uuid, jsonb) to authenticated;

create or replace function public.lock_interview_document_snapshot(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.interview_assignments;
  v_snapshot jsonb;
begin
  select * into v_assignment
  from public.interview_assignments
  where id = p_assignment_id
  for update;

  if v_assignment.id is null
     or v_assignment.candidate_id is distinct from public.auth_candidate_id() then
    raise exception 'interview not found';
  end if;
  if v_assignment.status not in ('invited', 'in_progress') then
    raise exception 'interview cannot lock documents in its current status';
  end if;

  if v_assignment.documents_locked_at is not null then
    return v_assignment.document_snapshot;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'document_id', d.id,
      'doc_type', d.doc_type,
      'title', d.title,
      'bucket_id', d.bucket_id,
      'object_path', d.object_path,
      'mime_type', d.mime_type,
      'size_bytes', d.size_bytes,
      'is_primary', d.is_primary,
      'status', d.status,
      'created_at', d.created_at
    )
    order by d.doc_type, d.created_at
  ), '[]'::jsonb)
  into v_snapshot
  from public.candidate_documents d
  where d.candidate_id = v_assignment.candidate_id
    and d.status = 'active';

  update public.interview_assignments
  set document_snapshot = v_snapshot,
      documents_locked_at = now()
  where id = p_assignment_id;

  insert into public.interview_events (assignment_id, actor_user_id, event_type, metadata)
  values (
    p_assignment_id,
    auth.uid(),
    'document_snapshot_locked',
    jsonb_build_object(
      'document_count', jsonb_array_length(v_snapshot),
      'note', 'Documents are locked for the interview session. Changes during the session are blocked and flagged for recruiter review.'
    )
  );

  return v_snapshot;
end;
$$;

revoke all on function public.lock_interview_document_snapshot(uuid) from public;
grant execute on function public.lock_interview_document_snapshot(uuid) to authenticated;

-- Soft-expiration: allow finishing an in-progress interview within grace hours.
create or replace function public.interview_is_past_deadline(p_assignment public.interview_assignments)
returns boolean
language sql
stable
as $$
  select case
    when p_assignment.expires_at is null then false
    when p_assignment.status = 'in_progress'
         and p_assignment.expiration_grace_hours > 0
         and now() <= p_assignment.expires_at
           + make_interval(hours => p_assignment.expiration_grace_hours)
      then false
    else p_assignment.expires_at < now()
  end;
$$;
