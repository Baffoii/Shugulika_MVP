-- =============================================================================
-- Shugulika MVP — asynchronous video interviews: schema.
-- Recruiter-managed templates, per-application assignments with immutable
-- question snapshots, per-attempt recording metadata, recruiter reviews and an
-- append-only event log. Recording files live in a private Storage bucket
-- (0018); only private storage paths are stored here, never public URLs.
-- Additive only — the existing scheduled `interviews` table is untouched.
-- =============================================================================

-- ---- Templates ---------------------------------------------------------------
create table if not exists public.interview_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  description text,
  instructions text,
  default_preparation_seconds int not null default 30
    check (default_preparation_seconds between 0 and 600),
  default_response_seconds int not null default 120
    check (default_response_seconds between 10 and 300),
  default_max_attempts int not null default 2
    check (default_max_attempts between 1 and 5),
  -- Retention policy for recordings produced from this template (cost control).
  retention_days int not null default 180 check (retention_days between 1 and 3650),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ivt_org on public.interview_templates(organization_id, is_active);

create table if not exists public.interview_template_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.interview_templates(id) on delete cascade,
  question_text text not null check (length(question_text) between 1 and 2000),
  guidance text,
  display_order int not null check (display_order > 0),
  -- Question-level overrides; null = inherit the template default.
  preparation_seconds int check (preparation_seconds between 0 and 600),
  response_seconds int check (response_seconds between 10 and 300),
  max_attempts int check (max_attempts between 1 and 5),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, display_order) deferrable initially deferred
);
create index if not exists idx_ivtq_template on public.interview_template_questions(template_id, display_order);

-- Cost control: cap the number of questions per template.
create or replace function public.tg_interview_template_question_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.interview_template_questions
      where template_id = new.template_id) >= 15 then
    raise exception 'interview templates are limited to 15 questions';
  end if;
  return new;
end $$;
drop trigger if exists trg_ivtq_cap on public.interview_template_questions;
create trigger trg_ivtq_cap before insert on public.interview_template_questions
  for each row execute function public.tg_interview_template_question_cap();

-- ---- Assignments ---------------------------------------------------------------
create table if not exists public.interview_assignments (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.interview_templates(id),
  candidate_id uuid not null references public.candidate_profiles(id),
  application_id uuid not null references public.applications(id),
  job_order_id uuid not null references public.job_orders(id),
  organization_id uuid not null references public.organizations(id),
  assigned_by uuid references public.profiles(id),
  status text not null default 'invited'
    check (status in ('draft','invited','in_progress','submitted','reviewed','expired','cancelled')),
  invited_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  candidate_instructions text,
  -- Snapshots of candidate-facing template fields so candidates never need read
  -- access to the recruiter-owned template tables.
  template_name_snapshot text not null default '',
  template_instructions_snapshot text,
  -- Explicit candidate consent captured before recording begins.
  consented_at timestamptz,
  privacy_notice_version text,
  instructions_version text,
  retention_days int not null default 180 check (retention_days between 1 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_iva_submitted_after_started
    check (submitted_at is null or started_at is null or submitted_at >= started_at)
);
create index if not exists idx_iva_candidate on public.interview_assignments(candidate_id, status);
create index if not exists idx_iva_org on public.interview_assignments(organization_id, status);
create index if not exists idx_iva_application on public.interview_assignments(application_id);
-- One active assignment per application+template; a recruiter must cancel the
-- old one to intentionally create a replacement.
create unique index if not exists uq_iva_active
  on public.interview_assignments(application_id, template_id)
  where status in ('draft','invited','in_progress','submitted','reviewed');

-- ---- Question snapshots (immutable copy taken at assignment time) -------------
create table if not exists public.interview_assignment_questions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.interview_assignments(id) on delete cascade,
  source_template_question_id uuid references public.interview_template_questions(id) on delete set null,
  question_text_snapshot text not null,
  question_description_snapshot text,
  display_order int not null check (display_order > 0),
  preparation_seconds int not null check (preparation_seconds between 0 and 600),
  response_seconds int not null check (response_seconds between 10 and 300),
  max_attempts int not null check (max_attempts between 1 and 5),
  is_required boolean not null default true,
  status text not null default 'pending' check (status in ('pending','in_progress','completed')),
  started_at timestamptz,
  completed_at timestamptz,
  unique (assignment_id, display_order)
);
create index if not exists idx_ivaq_assignment on public.interview_assignment_questions(assignment_id, display_order);

-- ---- Response attempts (every attempt is kept, one selected per question) -----
create table if not exists public.interview_response_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_question_id uuid not null references public.interview_assignment_questions(id) on delete cascade,
  assignment_id uuid not null references public.interview_assignments(id) on delete cascade,
  candidate_id uuid not null references public.candidate_profiles(id),
  attempt_number int not null check (attempt_number > 0),
  storage_bucket text not null default 'interview-recordings',
  -- Server-generated private path; never a candidate-supplied filename, never a
  -- public URL.
  storage_path text not null,
  mime_type text,
  file_size_bytes bigint check (file_size_bytes is null or (file_size_bytes > 0 and file_size_bytes <= 104857600)),
  duration_seconds numeric(8,2) check (duration_seconds is null or duration_seconds >= 0),
  preparation_time_used_seconds numeric(8,2) check (preparation_time_used_seconds is null or preparation_time_used_seconds >= 0),
  recording_started_at timestamptz,
  recording_ended_at timestamptz,
  uploaded_at timestamptz,
  upload_status text not null default 'pending'
    check (upload_status in ('pending','uploading','uploaded','failed')),
  is_selected_submission boolean not null default false,
  discarded_at timestamptz,
  client_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (assignment_question_id, attempt_number),
  constraint chk_ivra_recording_order
    check (recording_ended_at is null or recording_started_at is null or recording_ended_at >= recording_started_at)
);
create index if not exists idx_ivra_question on public.interview_response_attempts(assignment_question_id);
create index if not exists idx_ivra_assignment on public.interview_response_attempts(assignment_id);
create index if not exists idx_ivra_path on public.interview_response_attempts(storage_bucket, storage_path);
-- Only one attempt may be the submitted response for a question.
create unique index if not exists uq_ivra_selected
  on public.interview_response_attempts(assignment_question_id)
  where is_selected_submission;

-- Enforce the per-question attempt cap at the database layer.
create or replace function public.tg_interview_attempt_cap()
returns trigger language plpgsql as $$
declare v_max int; v_count int;
begin
  select q.max_attempts into v_max
  from public.interview_assignment_questions q
  where q.id = new.assignment_question_id;
  if v_max is null then
    raise exception 'unknown assignment question';
  end if;
  select count(*) into v_count
  from public.interview_response_attempts a
  where a.assignment_question_id = new.assignment_question_id;
  if v_count >= v_max then
    raise exception 'maximum attempts (%) reached for this question', v_max;
  end if;
  if new.attempt_number > v_max then
    raise exception 'attempt_number exceeds the configured maximum';
  end if;
  return new;
end $$;
drop trigger if exists trg_ivra_cap on public.interview_response_attempts;
create trigger trg_ivra_cap before insert on public.interview_response_attempts
  for each row execute function public.tg_interview_attempt_cap();

-- ---- Recruiter reviews (never candidate-visible; see 0017 RLS) -----------------
create table if not exists public.interview_reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.interview_assignments(id) on delete cascade,
  recruiter_id uuid not null references public.profiles(id),
  overall_rating int check (overall_rating between 1 and 5),
  review_status text not null default 'pending'
    check (review_status in ('pending','reviewed','advanced','not_selected')),
  internal_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- Event log (append-only, factual actions only) ------------------------------
create table if not exists public.interview_events (
  id bigint generated always as identity primary key,
  assignment_id uuid not null references public.interview_assignments(id) on delete cascade,
  assignment_question_id uuid references public.interview_assignment_questions(id) on delete set null,
  actor_user_id uuid references public.profiles(id),
  event_type text not null check (event_type in (
    'interview_opened','consent_given','permissions_requested','permissions_denied',
    'question_opened','preparation_started','recording_started','recording_stopped',
    'retry_selected','upload_started','upload_completed','upload_failed',
    'response_selected','question_completed','interview_submitted'
  )),
  event_timestamp timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
create index if not exists idx_ive_assignment on public.interview_events(assignment_id, event_timestamp);

-- ---- updated_at triggers --------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['interview_templates','interview_template_questions',
    'interview_assignments','interview_reviews'] loop
    execute format('drop trigger if exists trg_updated on public.%I;', t);
    execute format('create trigger trg_updated before update on public.%I for each row execute function public.tg_set_updated_at();', t);
  end loop;
end $$;

-- ---- Final submission RPC (idempotent, server-authoritative) --------------------
-- SECURITY DEFINER: validates ownership + completeness, stamps the server time,
-- notifies the assigning recruiter, and logs the event. Candidates cannot forge
-- any of this through direct table writes (see immutability trigger in 0017).
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

  if v_assignment.id is null then
    raise exception 'interview not found';
  end if;
  if v_assignment.candidate_id is distinct from public.auth_candidate_id() then
    raise exception 'interview not found';
  end if;

  -- Idempotent: a repeat call after submission returns the row unchanged.
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
    and (
      q.status <> 'completed'
      or not exists (
        select 1 from public.interview_response_attempts a
        where a.assignment_question_id = q.id
          and a.is_selected_submission
          and a.upload_status = 'uploaded'
      )
    );
  if v_missing > 0 then
    raise exception 'required questions are incomplete (%)', v_missing;
  end if;

  update public.interview_assignments
  set status = 'submitted', submitted_at = now()
  where id = p_assignment_id
  returning * into v_assignment;

  insert into public.interview_events (assignment_id, actor_user_id, event_type)
  values (p_assignment_id, auth.uid(), 'interview_submitted');

  select jo.title into v_job_title
  from public.job_orders jo where jo.id = v_assignment.job_order_id;

  if v_assignment.assigned_by is not null then
    insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
    values (
      v_assignment.assigned_by,
      'interview',
      'Video interview submitted',
      coalesce('A candidate submitted their video interview for ' || v_job_title || '.',
               'A candidate submitted their video interview.'),
      'interview_assignment',
      v_assignment.id
    );
  end if;

  return v_assignment;
end $$;

grant execute on function public.submit_interview(uuid) to authenticated;

-- ---- Retention helper (documented mechanism; scheduling is a later concern) ----
-- Marks attempts on assignments past their retention window as discarded so an
-- operator (or a future scheduled job) can delete the storage objects, then the
-- rows. Runs with definer rights; restricted to HQ.
create or replace function public.purge_expired_interview_recordings()
returns setof public.interview_response_attempts
language plpgsql security definer set search_path = public as $$
begin
  if not public.auth_is_hq() then
    raise exception 'not authorized';
  end if;
  return query
  update public.interview_response_attempts a
  set discarded_at = now()
  from public.interview_assignments iva
  where iva.id = a.assignment_id
    and a.discarded_at is null
    and iva.submitted_at is not null
    and iva.submitted_at + make_interval(days => iva.retention_days) < now()
  returning a.*;
end $$;

grant execute on function public.purge_expired_interview_recordings() to authenticated;
