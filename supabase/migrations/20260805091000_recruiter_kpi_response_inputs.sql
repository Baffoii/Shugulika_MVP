-- =============================================================================
-- Response-time + attention-queue inputs (Workstream A).
--
-- Adds ONLY the nullable timestamps that are genuinely missing today:
--   * employer_submissions.response_due_at / responded_at
--   * interviews.candidate_response_due_at / candidate_responded_at
--   * applications.consent_requested_at / consent_responded_at
--   * kpi_interview_schedule_events (durable reschedule log)
--
-- Historic rows cannot be backfilled — none of these moments were recorded, and
-- inventing them would fabricate SLA breaches. Rows written before this
-- migration therefore stay NULL and the loaders report the affected metrics as
-- unsupported for those rows rather than guessing. All stamping happens in
-- triggers so the values are server-authoritative.
-- =============================================================================

-- ---- Configurable response SLAs --------------------------------------------
create table if not exists public.kpi_response_sla (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null
    check (scope_key in ('employer_submission', 'candidate_interview', 'candidate_consent')),
  organization_id uuid references public.organizations(id) on delete cascade,
  max_hours int not null check (max_hours > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.kpi_response_sla is
  'Response-time SLAs used to stamp *_due_at columns. Org row overrides the global (organization_id is null) row.';

create unique index if not exists uq_kpi_response_sla_global
  on public.kpi_response_sla (scope_key)
  where organization_id is null;
create unique index if not exists uq_kpi_response_sla_org
  on public.kpi_response_sla (scope_key, organization_id)
  where organization_id is not null;

drop trigger if exists trg_updated on public.kpi_response_sla;
create trigger trg_updated before update on public.kpi_response_sla
  for each row execute function public.tg_set_updated_at();

insert into public.kpi_response_sla (scope_key, organization_id, max_hours)
select v.scope_key, null, v.max_hours
from (values
  ('employer_submission', 120),
  ('candidate_interview', 72),
  ('candidate_consent', 72)
) as v(scope_key, max_hours)
where not exists (
  select 1 from public.kpi_response_sla s
  where s.scope_key = v.scope_key and s.organization_id is null
);

create or replace function private.kpi_response_sla_hours(p_scope text, p_org uuid)
returns int
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select s.max_hours from public.kpi_response_sla s
      where s.scope_key = p_scope and s.organization_id = p_org),
    (select s.max_hours from public.kpi_response_sla s
      where s.scope_key = p_scope and s.organization_id is null)
  );
$$;

-- ---- Employer response window ----------------------------------------------
alter table public.employer_submissions
  add column if not exists response_due_at timestamptz,
  add column if not exists responded_at timestamptz;

comment on column public.employer_submissions.response_due_at is
  'When the employer decision is due. Stamped on transition into submitted; NULL for pre-migration rows.';
comment on column public.employer_submissions.responded_at is
  'First employer decision timestamp. Stamped on transition into a decided status; NULL for pre-migration rows.';

create or replace function private.kpi_stamp_submission_response()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hours int;
begin
  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from 'submitted')
     and new.response_due_at is null
  then
    v_hours := private.kpi_response_sla_hours('employer_submission', new.submitting_org_id);
    if v_hours is not null then
      new.response_due_at := coalesce(new.submitted_at, now()) + make_interval(hours => v_hours);
    end if;
  end if;

  if new.status in ('shortlisted', 'interview_requested', 'offered', 'rejected', 'withdrawn')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and new.responded_at is null
  then
    new.responded_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_kpi_submission_response on public.employer_submissions;
create trigger trg_kpi_submission_response
  before insert or update on public.employer_submissions
  for each row execute function private.kpi_stamp_submission_response();

-- ---- Candidate response window (interview invitations) ----------------------
alter table public.interviews
  add column if not exists candidate_response_due_at timestamptz,
  add column if not exists candidate_responded_at timestamptz;

comment on column public.interviews.candidate_response_due_at is
  'When the candidate reply to an interview request is due. NULL for pre-migration rows.';
comment on column public.interviews.candidate_responded_at is
  'First candidate reply to an interview request. NULL for pre-migration rows.';

create or replace function private.kpi_stamp_interview_response()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_hours int;
begin
  if new.status = 'requested'
     and (tg_op = 'INSERT' or old.status is distinct from 'requested')
     and new.candidate_response_due_at is null
  then
    v_hours := private.kpi_response_sla_hours('candidate_interview', new.owning_org_id);
    if v_hours is not null then
      new.candidate_response_due_at := now() + make_interval(hours => v_hours);
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'requested'
     and new.status in ('scheduled', 'confirmed', 'cancelled', 'no_show')
     and new.candidate_responded_at is null
  then
    new.candidate_responded_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_kpi_interview_response on public.interviews;
create trigger trg_kpi_interview_response
  before insert or update on public.interviews
  for each row execute function private.kpi_stamp_interview_response();

-- ---- Candidate consent response window -------------------------------------
alter table public.applications
  add column if not exists consent_requested_at timestamptz,
  add column if not exists consent_responded_at timestamptz;

comment on column public.applications.consent_requested_at is
  'When consent moved to pending/required. NULL for pre-migration rows.';
comment on column public.applications.consent_responded_at is
  'When the candidate granted or withdrew consent. NULL for pre-migration rows.';

create or replace function private.kpi_stamp_consent_response()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.consent_status in ('required', 'pending')
     and (tg_op = 'INSERT' or old.consent_status is distinct from new.consent_status)
     and new.consent_requested_at is null
  then
    new.consent_requested_at := now();
  end if;

  if new.consent_status in ('granted', 'withdrawn')
     and (tg_op = 'INSERT' or old.consent_status is distinct from new.consent_status)
     and new.consent_responded_at is null
  then
    new.consent_responded_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_kpi_consent_response on public.applications;
create trigger trg_kpi_consent_response
  before insert or update on public.applications
  for each row execute function private.kpi_stamp_consent_response();

-- ---- Interview reschedule log ----------------------------------------------
-- public.interviews keeps no schedule history, and public.interview_events is
-- the video-interview (self-recorded) log — it has no reschedule event type.
-- This table records schedule changes from now on; counts before this migration
-- are genuinely unknowable and are reported as such.
create table if not exists public.kpi_interview_schedule_events (
  id bigint generated always as identity primary key,
  interview_id uuid not null references public.interviews(id) on delete cascade,
  application_id uuid references public.applications(id) on delete set null,
  owning_org_id uuid not null references public.organizations(id) on delete cascade,
  change_kind text not null check (change_kind in ('scheduled', 'rescheduled', 'cancelled')),
  previous_scheduled_at timestamptz,
  new_scheduled_at timestamptz,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_kpi_interview_sched_app
  on public.kpi_interview_schedule_events (application_id, created_at);
create index if not exists idx_kpi_interview_sched_org
  on public.kpi_interview_schedule_events (owning_org_id, created_at);

create or replace function private.kpi_log_interview_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    if new.scheduled_at is null then
      return new;
    end if;
    v_kind := 'scheduled';
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_kind := 'cancelled';
  elsif new.scheduled_at is distinct from old.scheduled_at then
    v_kind := case when old.scheduled_at is null then 'scheduled' else 'rescheduled' end;
  else
    return new;
  end if;

  insert into public.kpi_interview_schedule_events (
    interview_id, application_id, owning_org_id, change_kind,
    previous_scheduled_at, new_scheduled_at, actor_id
  ) values (
    new.id,
    new.application_id,
    new.owning_org_id,
    v_kind,
    case when tg_op = 'INSERT' then null else old.scheduled_at end,
    new.scheduled_at,
    auth.uid()
  );

  return new;
end;
$$;

drop trigger if exists trg_kpi_interview_schedule_log on public.interviews;
create trigger trg_kpi_interview_schedule_log
  after insert or update on public.interviews
  for each row execute function private.kpi_log_interview_schedule_change();

-- ---- RLS --------------------------------------------------------------------
alter table public.kpi_response_sla enable row level security;

drop policy if exists "kpi_response_sla_read" on public.kpi_response_sla;
create policy "kpi_response_sla_read" on public.kpi_response_sla
  for select to authenticated
  using (
    organization_id is null
    or organization_id in (select public.auth_scoped_org_ids())
    or public.auth_is_hq()
  );

drop policy if exists "kpi_response_sla_hq_write" on public.kpi_response_sla;
create policy "kpi_response_sla_hq_write" on public.kpi_response_sla
  for all to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

drop policy if exists "kpi_response_sla_franchise_write" on public.kpi_response_sla;
create policy "kpi_response_sla_franchise_write" on public.kpi_response_sla
  for all to authenticated
  using (
    not public.auth_is_hq()
    and public.auth_has_role('franchise_admin')
    and organization_id is not null
    and organization_id in (select public.auth_scoped_org_ids())
  )
  with check (
    not public.auth_is_hq()
    and public.auth_has_role('franchise_admin')
    and organization_id is not null
    and organization_id in (select public.auth_scoped_org_ids())
  );

alter table public.kpi_interview_schedule_events enable row level security;

-- Read-only for staff inside the owning org; written only by the trigger.
drop policy if exists "kpi_interview_sched_read" on public.kpi_interview_schedule_events;
create policy "kpi_interview_sched_read" on public.kpi_interview_schedule_events
  for select to authenticated
  using (
    public.auth_is_hq()
    or owning_org_id in (select public.auth_scoped_org_ids())
  );

grant select on public.kpi_response_sla to authenticated;
grant select, insert, update, delete on public.kpi_response_sla to service_role;
grant select on public.kpi_interview_schedule_events to authenticated;
grant all on public.kpi_interview_schedule_events to service_role;

notify pgrst, 'reload schema';
