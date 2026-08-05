-- =============================================================================
-- Live AI voice interview — extends async video interview domain.
-- Adds employer briefs, plan freeze fields, live sessions/turns/evaluations,
-- and interview AI usage metering.
-- =============================================================================

-- ---- Feature flag: ships DISABLED ------------------------------------------
-- This migration must never enable the feature. Recording a candidate's voice,
-- transcribing it and sending it to a third-party provider requires privacy and
-- operational sign-off that a schema migration cannot represent. A production
-- administrator enables it explicitly after that approval — see
-- docs/ai-interview-enablement.md.
update public.feature_flags
set is_enabled = false,
    notes = 'Live AI voice interview (GPT-Realtime). DISABLED pending privacy/ops '
            || 'approval. Human recruiter decisions always required; AI output is '
            || 'advisory evidence only.'
where key = 'ai_interview_enabled';

-- ---- Employer interview briefs ---------------------------------------------
create table if not exists public.job_interview_briefs (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  version int not null default 1,
  status text not null default 'draft'
    check (status in ('draft','submitted','approved','rejected')),
  use_ai_voice boolean not null default false,
  language text not null default 'en',
  duration_seconds int not null default 600
    check (duration_seconds between 300 and 900),
  role_priorities text,
  must_have_competencies text,
  required_topics text,
  situational_scenario text,
  company_values text,
  objective_requirements text,
  employer_notes text,
  original_notes text,
  sanitised_brief jsonb not null default '{}'::jsonb,
  policy_warnings text[] not null default '{}',
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_order_id, version)
);
create index if not exists idx_jib_job_order on public.job_interview_briefs(job_order_id, version desc);

comment on table public.job_interview_briefs is
  'Employer interview preferences attached to a job order. Notes are untrusted source data.';

-- ---- Extend interview templates for live AI mode ---------------------------
alter table public.interview_templates
  add column if not exists interview_mode text not null default 'async_video'
    check (interview_mode in ('async_video','live_ai_voice')),
  add column if not exists duration_seconds int not null default 600
    check (duration_seconds between 60 and 900),
  add column if not exists language text not null default 'en',
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists rubric_version text,
  add column if not exists plan_status text not null default 'draft'
    check (plan_status in ('draft','approved','frozen')),
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists job_interview_brief_id uuid
    references public.job_interview_briefs(id) on delete set null,
  add column if not exists frozen_context jsonb not null default '{}'::jsonb;

-- Live AI templates use longer response windows; relax async max when live.
alter table public.interview_templates
  drop constraint if exists interview_templates_default_response_seconds_check;
alter table public.interview_templates
  add constraint interview_templates_default_response_seconds_check
  check (default_response_seconds between 10 and 900);

alter table public.interview_template_questions
  drop constraint if exists interview_template_questions_response_seconds_check;
alter table public.interview_template_questions
  add constraint interview_template_questions_response_seconds_check
  check (response_seconds is null or response_seconds between 10 and 900);

alter table public.interview_template_questions
  add column if not exists competency text,
  add column if not exists expected_evidence text,
  add column if not exists rubric_anchors jsonb not null default '[]'::jsonb,
  add column if not exists source_context text,
  add column if not exists follow_up_policy text not null default 'one_clarification';

-- ---- Assignment snapshots --------------------------------------------------
alter table public.interview_assignments
  add column if not exists interview_mode text not null default 'async_video'
    check (interview_mode in ('async_video','live_ai_voice')),
  add column if not exists duration_seconds int,
  add column if not exists language text,
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists rubric_version text,
  add column if not exists frozen_context jsonb not null default '{}'::jsonb;

alter table public.interview_assignment_questions
  drop constraint if exists interview_assignment_questions_response_seconds_check;
alter table public.interview_assignment_questions
  add constraint interview_assignment_questions_response_seconds_check
  check (response_seconds between 10 and 900);

alter table public.interview_assignment_questions
  add column if not exists competency text,
  add column if not exists expected_evidence text,
  add column if not exists rubric_anchors jsonb not null default '[]'::jsonb,
  add column if not exists source_context text,
  add column if not exists follow_up_policy text;

-- ---- Live sessions ---------------------------------------------------------
create table if not exists public.interview_live_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.interview_assignments(id) on delete cascade,
  status text not null default 'ready'
    check (status in (
      'ready','live','completed','incomplete_technical','abandoned','failed'
    )),
  model text not null,
  prompt_version text,
  rubric_version text,
  openai_session_ref text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  reconnect_count int not null default 0,
  reserved_usd numeric(10,4) not null default 0.75,
  estimated_cost_usd numeric(12,8),
  token_breakdown jsonb not null default '{}'::jsonb,
  transcription_usage jsonb not null default '{}'::jsonb,
  candidate_audio_bucket text default 'interview-recordings',
  candidate_audio_path text,
  candidate_audio_mime text,
  error_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ils_assignment on public.interview_live_sessions(assignment_id, created_at desc);

create table if not exists public.interview_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_live_sessions(id) on delete cascade,
  assignment_question_id uuid references public.interview_assignment_questions(id) on delete set null,
  speaker text not null check (speaker in ('ai','candidate','system')),
  turn_type text not null default 'utterance'
    check (turn_type in (
      'utterance','question','clarification','welcome','close','system'
    )),
  transcript text,
  started_at timestamptz,
  ended_at timestamptz,
  audio_offset_ms int,
  interruption_state text,
  completion_state text not null default 'complete'
    check (completion_state in ('complete','partial','interrupted','missing')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_it_session on public.interview_turns(session_id, created_at);

create table if not exists public.interview_ai_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_live_sessions(id) on delete cascade,
  assignment_id uuid not null references public.interview_assignments(id) on delete cascade,
  model text not null,
  prompt_version text,
  rubric_version text,
  structured_evidence jsonb not null default '{}'::jsonb,
  question_results jsonb not null default '[]'::jsonb,
  overall_confidence text,
  review_flags text[] not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id)
);
create index if not exists idx_iae_assignment on public.interview_ai_evaluations(assignment_id);

-- Recruiter evidence overrides (human-only; never auto-applied to stage)
alter table public.interview_reviews
  add column if not exists evidence_overrides jsonb not null default '[]'::jsonb,
  add column if not exists ai_evaluation_id uuid
    references public.interview_ai_evaluations(id) on delete set null;

-- ---- Event types: extend check constraint ----------------------------------
alter table public.interview_events drop constraint if exists interview_events_event_type_check;
alter table public.interview_events
  add constraint interview_events_event_type_check check (event_type in (
    'interview_opened','consent_given','permissions_requested','permissions_denied',
    'question_opened','preparation_started','recording_started','recording_stopped',
    'retry_selected','upload_started','upload_completed','upload_failed',
    'response_selected','question_completed','interview_submitted',
    'session_started','session_heartbeat','session_interrupted','session_resumed',
    'visibility_hidden','visibility_visible','page_unload_warned',
    'connection_lost','connection_restored','break_started','break_ended',
    'document_change_attempted','document_snapshot_locked',
    -- Live AI additions
    'brief_submitted','brief_approved','plan_generated','plan_edited','plan_frozen',
    'live_session_ready','live_session_started','live_session_ended',
    'live_question_started','live_question_completed','live_clarification',
    'live_technical_issue','live_reconnect','live_upload_completed',
    'transcription_started','transcription_completed','transcription_failed',
    'ai_evaluation_started','ai_evaluation_completed','ai_evaluation_failed',
    'human_review_opened','human_review_completed','evidence_overridden'
  ));

-- ---- AI usage: add interview feature + optional refs -----------------------
alter table public.ai_usage_events drop constraint if exists ai_usage_events_feature_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_feature_check
  check (feature in ('resume','screening','assessment','interview'));

alter table public.ai_usage_events
  add column if not exists assignment_id uuid references public.interview_assignments(id) on delete set null,
  add column if not exists job_order_id uuid references public.job_orders(id) on delete set null,
  add column if not exists session_id uuid references public.interview_live_sessions(id) on delete set null,
  add column if not exists audio_input_tokens int,
  add column if not exists audio_output_tokens int,
  add column if not exists cached_input_tokens int,
  add column if not exists modality_detail jsonb not null default '{}'::jsonb;

-- ---- RLS -------------------------------------------------------------------
alter table public.job_interview_briefs enable row level security;
alter table public.interview_live_sessions enable row level security;
alter table public.interview_turns enable row level security;
alter table public.interview_ai_evaluations enable row level security;

grant select, insert, update, delete on
  public.job_interview_briefs,
  public.interview_live_sessions,
  public.interview_turns,
  public.interview_ai_evaluations
to authenticated;

-- Briefs: employer (own org job orders) + interview staff
drop policy if exists jib_employer_read on public.job_interview_briefs;
create policy jib_employer_read on public.job_interview_briefs for select to authenticated
  using (
    exists (
      select 1 from public.job_orders jo
      where jo.id = job_interview_briefs.job_order_id
        and (
          jo.employer_org_id in (select public.auth_scoped_org_ids())
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
        )
    )
  );

drop policy if exists jib_employer_insert on public.job_interview_briefs;
create policy jib_employer_insert on public.job_interview_briefs for insert to authenticated
  with check (
    exists (
      select 1 from public.job_orders jo
      where jo.id = job_interview_briefs.job_order_id
        and jo.employer_org_id in (select public.auth_scoped_org_ids())
        and public.auth_has_role('employer_user')
    )
  );

drop policy if exists jib_staff_all on public.job_interview_briefs;
create policy jib_staff_all on public.job_interview_briefs for all to authenticated
  using (
    public.auth_is_interview_staff()
    and exists (
      select 1 from public.job_orders jo
      where jo.id = job_interview_briefs.job_order_id
        and (
          jo.responsible_org_id in (select public.auth_scoped_org_ids())
          or public.auth_is_hq()
        )
    )
  )
  with check (
    public.auth_is_interview_staff()
    and exists (
      select 1 from public.job_orders jo
      where jo.id = job_interview_briefs.job_order_id
        and (
          jo.responsible_org_id in (select public.auth_scoped_org_ids())
          or public.auth_is_hq()
        )
    )
  );

-- Live sessions: candidate (own assignment) + staff
drop policy if exists ils_candidate_read on public.interview_live_sessions;
create policy ils_candidate_read on public.interview_live_sessions for select to authenticated
  using (
    exists (
      select 1 from public.interview_assignments a
      where a.id = interview_live_sessions.assignment_id
        and a.candidate_id = public.auth_candidate_id()
    )
  );

drop policy if exists ils_candidate_write on public.interview_live_sessions;
create policy ils_candidate_write on public.interview_live_sessions for insert to authenticated
  with check (
    exists (
      select 1 from public.interview_assignments a
      where a.id = interview_live_sessions.assignment_id
        and a.candidate_id = public.auth_candidate_id()
        and a.status in ('invited','in_progress')
    )
  );

drop policy if exists ils_candidate_update on public.interview_live_sessions;
create policy ils_candidate_update on public.interview_live_sessions for update to authenticated
  using (
    exists (
      select 1 from public.interview_assignments a
      where a.id = interview_live_sessions.assignment_id
        and a.candidate_id = public.auth_candidate_id()
        and a.status in ('invited','in_progress')
    )
  )
  with check (
    exists (
      select 1 from public.interview_assignments a
      where a.id = interview_live_sessions.assignment_id
        and a.candidate_id = public.auth_candidate_id()
    )
  );

drop policy if exists ils_staff_all on public.interview_live_sessions;
create policy ils_staff_all on public.interview_live_sessions for all to authenticated
  using (
    public.auth_is_interview_staff()
    and exists (
      select 1 from public.interview_assignments a
      where a.id = interview_live_sessions.assignment_id
        and a.organization_id in (select public.auth_scoped_org_ids())
    )
  )
  with check (
    public.auth_is_interview_staff()
    and exists (
      select 1 from public.interview_assignments a
      where a.id = interview_live_sessions.assignment_id
        and a.organization_id in (select public.auth_scoped_org_ids())
    )
  );

-- Turns: same visibility as sessions
drop policy if exists it_candidate_read on public.interview_turns;
create policy it_candidate_read on public.interview_turns for select to authenticated
  using (
    exists (
      select 1
      from public.interview_live_sessions s
      join public.interview_assignments a on a.id = s.assignment_id
      where s.id = interview_turns.session_id
        and a.candidate_id = public.auth_candidate_id()
    )
  );

drop policy if exists it_candidate_insert on public.interview_turns;
create policy it_candidate_insert on public.interview_turns for insert to authenticated
  with check (
    exists (
      select 1
      from public.interview_live_sessions s
      join public.interview_assignments a on a.id = s.assignment_id
      where s.id = interview_turns.session_id
        and a.candidate_id = public.auth_candidate_id()
        and a.status in ('invited','in_progress')
    )
  );

drop policy if exists it_staff_all on public.interview_turns;
create policy it_staff_all on public.interview_turns for all to authenticated
  using (
    public.auth_is_interview_staff()
    and exists (
      select 1
      from public.interview_live_sessions s
      join public.interview_assignments a on a.id = s.assignment_id
      where s.id = interview_turns.session_id
        and a.organization_id in (select public.auth_scoped_org_ids())
    )
  )
  with check (
    public.auth_is_interview_staff()
    and exists (
      select 1
      from public.interview_live_sessions s
      join public.interview_assignments a on a.id = s.assignment_id
      where s.id = interview_turns.session_id
        and a.organization_id in (select public.auth_scoped_org_ids())
    )
  );

-- Evaluations: staff only (candidates must not see AI rubric before human review)
drop policy if exists iae_staff_all on public.interview_ai_evaluations;
create policy iae_staff_all on public.interview_ai_evaluations for all to authenticated
  using (
    public.auth_is_interview_staff()
    and exists (
      select 1 from public.interview_assignments a
      where a.id = interview_ai_evaluations.assignment_id
        and a.organization_id in (select public.auth_scoped_org_ids())
    )
  )
  with check (
    public.auth_is_interview_staff()
    and exists (
      select 1 from public.interview_assignments a
      where a.id = interview_ai_evaluations.assignment_id
        and a.organization_id in (select public.auth_scoped_org_ids())
    )
  );

-- Live AI completion bypasses per-question video upload requirement.
-- Base: 0024_video_interviews_security_fixes.sql, plus live_ai_voice branch.
create or replace function public.tg_interview_assignment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_is_staff boolean;
  v_missing int;
  v_mode text;
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

  v_mode := coalesce(new.interview_mode, old.interview_mode, 'async_video');

  if new.status = 'submitted' and old.status <> 'submitted' then
    if old.status <> 'in_progress' then
      raise exception 'only an in-progress interview can be submitted';
    end if;
    if current_setting('app.submitting_interview', true) <> 'true' then
      raise exception 'use submit_interview to finalize this interview';
    end if;
    if v_mode = 'live_ai_voice' then
      if not exists (
        select 1 from public.interview_live_sessions s
        where s.assignment_id = old.id
          and s.status in ('completed','incomplete_technical')
      ) then
        raise exception 'live AI session is not complete';
      end if;
    else
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
    end if;
    new.submitted_at := now();
  end if;

  v_is_staff := public.auth_is_interview_staff()
    and old.organization_id in (select public.auth_scoped_org_ids());

  if v_is_staff then
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
     or new.retention_days is distinct from old.retention_days
     or new.interview_mode is distinct from old.interview_mode then
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
  end if;

  return new;
end $$;

-- Question completion: live AI may complete without a video upload attempt.
create or replace function public.tg_interview_question_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_mode text;
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
  if new.status = 'completed' and old.status <> 'completed' then
    if new.completed_at is null then
      raise exception 'completed_at is required';
    end if;
    select coalesce(a.interview_mode, 'async_video') into v_mode
    from public.interview_assignments a
    where a.id = old.assignment_id;
    if coalesce(v_mode, 'async_video') <> 'live_ai_voice' then
      if not exists (
        select 1 from public.interview_response_attempts a
        where a.assignment_question_id = old.id
          and a.is_selected_submission and a.upload_status = 'uploaded'
      ) then
        raise exception 'a question needs an uploaded, selected response before completion';
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_jib_updated on public.job_interview_briefs;
create trigger trg_jib_updated before update on public.job_interview_briefs
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_ils_updated on public.interview_live_sessions;
create trigger trg_ils_updated before update on public.interview_live_sessions
  for each row execute function public.tg_set_updated_at();

-- Live-aware submit_interview (extends 0028)
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
        and s.status in ('completed','incomplete_technical')
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

grant execute on function public.submit_interview(uuid) to authenticated;

-- Live AI candidate audio: allow audio MIME + path-based storage policies
update storage.buckets
set allowed_mime_types = array[
  'video/webm','video/mp4','audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg'
]
where id = 'interview-recordings';

drop policy if exists interview_recordings_live_candidate_insert on storage.objects;
create policy interview_recordings_live_candidate_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'interview-recordings'
  and name like 'organization/%/interviews/%/live/%'
  and exists (
    select 1 from public.interview_assignments a
    where a.candidate_id = public.auth_candidate_id()
      and a.status in ('invited','in_progress')
      and name like ('organization/' || a.organization_id::text || '/interviews/' || a.id::text || '/live/%')
  )
);

drop policy if exists interview_recordings_live_candidate_select on storage.objects;
create policy interview_recordings_live_candidate_select
on storage.objects for select to authenticated
using (
  bucket_id = 'interview-recordings'
  and name like 'organization/%/interviews/%/live/%'
  and exists (
    select 1 from public.interview_assignments a
    where a.candidate_id = public.auth_candidate_id()
      and name like ('organization/' || a.organization_id::text || '/interviews/' || a.id::text || '/live/%')
  )
);

drop policy if exists interview_recordings_live_staff_select on storage.objects;
create policy interview_recordings_live_staff_select
on storage.objects for select to authenticated
using (
  bucket_id = 'interview-recordings'
  and name like 'organization/%/interviews/%/live/%'
  and public.auth_is_interview_staff()
  and exists (
    select 1 from public.interview_assignments a
    where a.organization_id in (select public.auth_scoped_org_ids())
      and name like ('organization/' || a.organization_id::text || '/interviews/' || a.id::text || '/live/%')
  )
);

-- ---- Execute-privilege hardening -------------------------------------------
-- Postgres grants EXECUTE to PUBLIC on every newly created function, so an
-- unauthenticated `anon` caller could otherwise invoke these directly over
-- PostgREST. Revoke first, then grant only the role that legitimately calls it.

-- Trigger-only functions: never a callable API surface for any client role.
revoke all on function public.tg_interview_assignment_guard() from public;
revoke all on function public.tg_interview_assignment_guard() from anon, authenticated;
revoke all on function public.tg_interview_question_guard() from public;
revoke all on function public.tg_interview_question_guard() from anon, authenticated;

-- Candidate-callable submit path: signed-in users only, never anon.
revoke all on function public.submit_interview(uuid) from public;
revoke all on function public.submit_interview(uuid) from anon;
grant execute on function public.submit_interview(uuid) to authenticated;

notify pgrst, 'reload schema';
