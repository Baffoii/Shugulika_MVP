-- Workstream C: candidate-safe progress, offline result snapshots, and explicit sharing.
-- Candidate-facing events are deliberately copied into an allowlisted ledger; the
-- application history, recruiter notes, AI reviews, and employer deliberations are
-- never queried to render the candidate timeline.

alter table public.assessment_assignments
  add column if not exists paid_by text not null default 'employer'
    check (paid_by in ('candidate', 'employer'));

create table if not exists public.assessment_result_snapshots (
  assignment_id uuid primary key references public.assessment_assignments(id) on delete cascade,
  provider text not null,
  permitted_payload jsonb not null default '{}',
  visibility_tier text not null
    check (visibility_tier in ('candidate_full', 'candidate_limited', 'completion_only')),
  captured_at timestamptz not null default now(),
  verified_at timestamptz not null default now()
);

create table if not exists public.result_share_grants (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  assignment_id uuid not null references public.assessment_assignments(id) on delete cascade,
  recipient_org_id uuid not null references public.organizations(id),
  purpose text not null check (length(trim(purpose)) between 3 and 240),
  job_order_id uuid not null references public.job_orders(id),
  scope jsonb not null default '{}',
  consent_id uuid not null references public.candidate_consents(id),
  shared_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  check (expires_at is null or expires_at > shared_at),
  check (revoked_at is null or revoked_at >= shared_at)
);
create index if not exists idx_result_share_candidate
  on public.result_share_grants (candidate_id, shared_at desc);
create index if not exists idx_result_share_recipient
  on public.result_share_grants (recipient_org_id, job_order_id, assignment_id);

create table if not exists public.candidate_visible_events (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  event_type text not null check (event_type in (
    'application_submitted', 'stage_changed', 'assessment_assigned',
    'assessment_updated', 'result_available', 'interview_assigned',
    'interview_updated', 'consent_requested', 'result_shared',
    'result_revoked', 'cv_shared', 'help_requested',
    'reschedule_requested', 'duplicate_review_requested'
  )),
  label text not null check (length(trim(label)) between 1 and 240),
  details jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  source_type text not null,
  source_id text not null,
  unique (source_type, source_id, event_type),
  check (
    not (details ?| array[
      'recruiter_notes', 'recruiter_note', 'internal_notes', 'grading_notes',
      'ai_review', 'ai_confidence', 'employer_deliberation', 'rejection_reason'
    ])
  )
);
create index if not exists idx_candidate_visible_events_candidate
  on public.candidate_visible_events (candidate_id, occurred_at desc);
create index if not exists idx_candidate_visible_events_application
  on public.candidate_visible_events (application_id, occurred_at desc);

create table if not exists public.cv_share_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  recipient_org_id uuid not null references public.organizations(id),
  document_id uuid not null references public.candidate_documents(id),
  consent_id uuid not null references public.candidate_consents(id),
  channel text not null default 'portal_link' check (channel = 'portal_link'),
  portal_path text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_cv_share_candidate
  on public.cv_share_events (candidate_id, created_at desc);

alter table public.assessment_result_snapshots enable row level security;
alter table public.result_share_grants enable row level security;
alter table public.candidate_visible_events enable row level security;
alter table public.cv_share_events enable row level security;

create policy result_snapshot_candidate_read on public.assessment_result_snapshots
  for select to authenticated using (
    exists (
      select 1 from public.assessment_assignments aa
      where aa.id = assessment_result_snapshots.assignment_id
        and aa.candidate_id = public.auth_candidate_id()
    )
  );
create policy result_snapshot_scoped_staff_read on public.assessment_result_snapshots
  for select to authenticated using (
    exists (
      select 1
      from public.assessment_assignments aa
      join public.job_orders jo on jo.id = aa.job_order_id
      where aa.id = assessment_result_snapshots.assignment_id
        and jo.responsible_org_id in (select public.auth_scoped_org_ids())
    )
  );
create policy result_snapshot_active_recipient_read on public.assessment_result_snapshots
  for select to authenticated using (
    exists (
      select 1 from public.result_share_grants g
      where g.assignment_id = assessment_result_snapshots.assignment_id
        and g.recipient_org_id in (select public.auth_scoped_org_ids())
        and g.revoked_at is null
        and (g.expires_at is null or g.expires_at > now())
    )
  );

create policy result_share_candidate_read on public.result_share_grants
  for select to authenticated using (candidate_id = public.auth_candidate_id());
create policy result_share_scoped_recipient_read on public.result_share_grants
  for select to authenticated using (
    recipient_org_id in (select public.auth_scoped_org_ids())
  );

create policy candidate_events_self_read on public.candidate_visible_events
  for select to authenticated using (candidate_id = public.auth_candidate_id());

create policy cv_share_candidate_read on public.cv_share_events
  for select to authenticated using (candidate_id = public.auth_candidate_id());
create policy cv_share_recipient_read on public.cv_share_events
  for select to authenticated using (recipient_org_id in (select public.auth_scoped_org_ids()));

grant select on public.assessment_result_snapshots, public.result_share_grants,
  public.candidate_visible_events, public.cv_share_events to authenticated;
revoke insert, update, delete on public.assessment_result_snapshots,
  public.result_share_grants, public.candidate_visible_events, public.cv_share_events
  from authenticated, anon;
grant usage, select on sequence public.candidate_visible_events_id_seq to authenticated;

create or replace function public.candidate_stage_label(p_stage text)
returns text language sql immutable set search_path = public as $$
  select case p_stage
    when 'cv_review' then 'Resume under review'
    when 'testing' then 'Skills assessment'
    when 'test_review' then 'Assessment under review'
    when 'interview_screening' then 'Interview scheduled'
    when 'interview_review' then 'Interview under review'
    when 'reference_checks' then 'Reference checks'
    when 'client_submission' then 'Submitted to employer'
    when 'offer' then 'Offer stage'
    when 'hired' then 'Hired'
    when 'rejected' then 'Not selected'
    when 'withdrawn' then 'Withdrawn'
    when 'closed' then 'Position closed'
    when 'applied_sourced' then 'Application received'
    when 'cv_screening' then 'Resume under review'
    when 'longlisted' then 'Moved forward after resume review'
    when 'ai_interview_screening' then 'Interview stage'
    when 'shortlisted' then 'Shortlisted'
    when 'screening_interview' then 'Interview stage'
    when 'client_interview' then 'Employer interview'
    else 'Application updated'
  end
$$;
grant execute on function public.candidate_stage_label(text) to authenticated;

create or replace function public.tg_candidate_application_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, occurred_at, source_type, source_id)
  values
    (new.candidate_id, new.id, 'application_submitted', 'Application received',
     jsonb_build_object('stage_label', public.candidate_stage_label(new.current_stage)),
     new.created_at, 'application', new.id::text)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_candidate_application_event on public.applications;
create trigger trg_candidate_application_event after insert on public.applications
  for each row execute function public.tg_candidate_application_event();

create or replace function public.tg_candidate_stage_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_candidate uuid;
begin
  select candidate_id into v_candidate from public.applications where id = new.application_id;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, occurred_at, source_type, source_id)
  values
    (v_candidate, new.application_id, 'stage_changed', public.candidate_stage_label(new.to_stage),
     jsonb_build_object('stage_label', public.candidate_stage_label(new.to_stage)),
     new.created_at, 'application_stage_history', new.id::text)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_candidate_stage_event on public.application_stage_history;
create trigger trg_candidate_stage_event after insert on public.application_stage_history
  for each row execute function public.tg_candidate_stage_event();

-- Backfill existing application progress without copying reason/note fields.
insert into public.candidate_visible_events
  (candidate_id, application_id, event_type, label, details, occurred_at, source_type, source_id)
select a.candidate_id, a.id, 'application_submitted', 'Application received',
  jsonb_build_object('stage_label', public.candidate_stage_label(a.current_stage)),
  a.created_at, 'application', a.id::text
from public.applications a
on conflict do nothing;

insert into public.candidate_visible_events
  (candidate_id, application_id, event_type, label, details, occurred_at, source_type, source_id)
select a.candidate_id, h.application_id, 'stage_changed',
  public.candidate_stage_label(h.to_stage),
  jsonb_build_object('stage_label', public.candidate_stage_label(h.to_stage)),
  h.created_at, 'application_stage_history', h.id::text
from public.application_stage_history h
join public.applications a on a.id = h.application_id
on conflict do nothing;

-- Candidates now use candidate_visible_events. Raw stage-history notes/reasons
-- remain readable only to scoped staff.
drop policy if exists hist_read on public.application_stage_history;
create policy hist_staff_read on public.application_stage_history for select to authenticated
  using (exists (
    select 1 from public.applications a
    where a.id = application_stage_history.application_id
      and a.owning_org_id in (select public.auth_scoped_org_ids())
  ));
drop policy if exists hist_insert on public.application_stage_history;
create policy hist_staff_insert on public.application_stage_history for insert to authenticated
  with check (exists (
    select 1 from public.applications a
    where a.id = application_stage_history.application_id
      and a.owning_org_id in (select public.auth_scoped_org_ids())
  ));
create policy hist_candidate_safe_insert on public.application_stage_history
  for insert to authenticated with check (
    actor_role = 'candidate'
    and actor_id is null
    and reason is null
    and note is null
    and source in ('candidate_apply', 'candidate_withdraw')
    and exists (
      select 1 from public.applications a
      where a.id = application_stage_history.application_id
        and a.candidate_id = public.auth_candidate_id()
        and (
          (application_stage_history.to_stage = 'cv_review' and a.current_stage = 'cv_review')
          or (application_stage_history.to_stage = 'withdrawn' and a.withdrawn_at is not null)
        )
    )
  );

create or replace function public.tg_candidate_assessment_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  v_type := case when tg_op = 'INSERT' then 'assessment_assigned' else 'assessment_updated' end;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.due_at is not distinct from old.due_at then return new; end if;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, occurred_at, source_type, source_id)
  values
    (new.candidate_id, new.application_id, v_type,
     case when tg_op = 'INSERT' then 'Assessment assigned'
          else 'Assessment ' || replace(new.status, '_', ' ') end,
     jsonb_strip_nulls(jsonb_build_object(
       'assignment_id', new.id, 'status', new.status, 'due_at', new.due_at
     )),
     case when tg_op = 'INSERT' then new.assigned_at else now() end,
     -- Include due_at so later deadline changes at the same status are not dropped.
     'assessment_assignment',
     new.id::text || ':' || new.status || ':' || coalesce(new.due_at::text, ''))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_candidate_assessment_event on public.assessment_assignments;
create trigger trg_candidate_assessment_event
  after insert or update of status, due_at on public.assessment_assignments
  for each row execute function public.tg_candidate_assessment_event();

create or replace function public.tg_capture_assessment_result_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tier text; v_payload jsonb;
begin
  if new.status <> 'graded' or new.graded_at is null then return new; end if;
  v_tier := case
    when new.paid_by = 'candidate' then 'candidate_full'
    when new.assessment_mode in ('shugulika', 'both') then 'candidate_limited'
    else 'completion_only'
  end;
  v_payload := case v_tier
    when 'candidate_full' then jsonb_strip_nulls(jsonb_build_object(
      'completion_status', 'completed', 'score_percent', new.score,
      'result_band', new.result_band, 'mcq_score_percent', new.mcq_score,
      'free_response_score_percent', new.free_response_score
    ))
    when 'candidate_limited' then jsonb_strip_nulls(jsonb_build_object(
      'completion_status', 'completed', 'score_percent', new.score,
      'result_band', new.result_band
    ))
    else jsonb_build_object('completion_status', 'completed')
  end;
  insert into public.assessment_result_snapshots
    (assignment_id, provider, permitted_payload, visibility_tier, captured_at, verified_at)
  values
    (new.id, coalesce(new.provider, 'shugulika'), v_payload, v_tier,
     coalesce(new.graded_at, now()), now())
  on conflict (assignment_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_capture_assessment_result_snapshot on public.assessment_assignments;
create trigger trg_capture_assessment_result_snapshot
  after insert or update of status, graded_at on public.assessment_assignments
  for each row execute function public.tg_capture_assessment_result_snapshot();

create or replace function public.tg_result_snapshot_available_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_assignment public.assessment_assignments%rowtype;
begin
  select * into v_assignment from public.assessment_assignments where id = new.assignment_id;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, occurred_at, source_type, source_id)
  values
    (v_assignment.candidate_id, v_assignment.application_id, 'result_available',
     case when new.visibility_tier = 'completion_only'
       then 'Assessment completion available' else 'Assessment result available' end,
     jsonb_build_object('assignment_id', new.assignment_id,
                        'visibility_tier', new.visibility_tier),
     new.captured_at, 'assessment_result_snapshot', new.assignment_id::text)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_result_snapshot_available_event on public.assessment_result_snapshots;
create trigger trg_result_snapshot_available_event after insert on public.assessment_result_snapshots
  for each row execute function public.tg_result_snapshot_available_event();

-- Capture verified offline snapshots for results graded before this migration.
insert into public.assessment_result_snapshots
  (assignment_id, provider, permitted_payload, visibility_tier, captured_at, verified_at)
select aa.id,
  coalesce(aa.provider, 'shugulika'),
  case
    when aa.paid_by = 'candidate' then jsonb_strip_nulls(jsonb_build_object(
      'completion_status', 'completed', 'score_percent', aa.score,
      'result_band', aa.result_band, 'mcq_score_percent', aa.mcq_score,
      'free_response_score_percent', aa.free_response_score
    ))
    when aa.assessment_mode in ('shugulika', 'both') then
      jsonb_strip_nulls(jsonb_build_object(
        'completion_status', 'completed', 'score_percent', aa.score,
        'result_band', aa.result_band
      ))
    else jsonb_build_object('completion_status', 'completed')
  end,
  case
    when aa.paid_by = 'candidate' then 'candidate_full'
    when aa.assessment_mode in ('shugulika', 'both') then 'candidate_limited'
    else 'completion_only'
  end,
  coalesce(aa.graded_at, aa.submitted_at, aa.updated_at),
  now()
from public.assessment_assignments aa
where aa.status = 'graded' and aa.graded_at is not null
on conflict (assignment_id) do nothing;

create or replace function public.protect_verified_result_snapshot()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.verified_at is not null then
    raise exception 'verified assessment result snapshots are immutable';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_protect_verified_result_snapshot on public.assessment_result_snapshots;
create trigger trg_protect_verified_result_snapshot
  before update or delete on public.assessment_result_snapshots
  for each row execute function public.protect_verified_result_snapshot();

create or replace function public.tg_candidate_interview_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_candidate uuid; v_type text;
begin
  select candidate_id into v_candidate from public.applications where id = new.application_id;
  if v_candidate is null then return new; end if;
  v_type := case when tg_op = 'INSERT' then 'interview_assigned' else 'interview_updated' end;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.scheduled_at is not distinct from old.scheduled_at then return new; end if;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, occurred_at, source_type, source_id)
  values
    (v_candidate, new.application_id, v_type,
     case when tg_op = 'INSERT' then 'Interview requested'
          else 'Interview ' || replace(new.status, '_', ' ') end,
     jsonb_strip_nulls(jsonb_build_object(
       'interview_id', new.id, 'status', new.status,
       'scheduled_at', new.scheduled_at, 'expires_at', new.expires_at
     )), now(), 'interview',
     -- Include scheduled_at so later reschedules at the same status are not dropped.
     new.id::text || ':' || new.status || ':' || coalesce(new.scheduled_at::text, ''))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_candidate_interview_event on public.interviews;
create trigger trg_candidate_interview_event
  after insert or update of status, scheduled_at on public.interviews
  for each row execute function public.tg_candidate_interview_event();

create or replace function public.tg_candidate_video_interview_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_type text;
begin
  v_type := case when tg_op = 'INSERT' then 'interview_assigned' else 'interview_updated' end;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.expires_at is not distinct from old.expires_at then return new; end if;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, occurred_at, source_type, source_id)
  values
    (new.candidate_id, new.application_id, v_type,
     case when tg_op = 'INSERT' then 'Video interview assigned'
          else 'Video interview ' || replace(new.status, '_', ' ') end,
     jsonb_strip_nulls(jsonb_build_object(
       'interview_assignment_id', new.id, 'status', new.status, 'expires_at', new.expires_at
     )), now(), 'interview_assignment',
     new.id::text || ':' || new.status || ':' || coalesce(new.expires_at::text, ''))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_candidate_video_interview_event on public.interview_assignments;
create trigger trg_candidate_video_interview_event
  after insert or update of status, expires_at on public.interview_assignments
  for each row execute function public.tg_candidate_video_interview_event();

create or replace function public.candidate_share_assessment_result(
  p_assignment_id uuid, p_purpose text,
  p_expires_at timestamptz default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_assignment public.assessment_assignments%rowtype;
declare v_snapshot public.assessment_result_snapshots%rowtype;
declare v_consent uuid; v_grant uuid; v_recipient uuid;
begin
  select * into v_assignment from public.assessment_assignments
    where id = p_assignment_id and candidate_id = public.auth_candidate_id();
  if not found then raise exception 'assessment not found'; end if;
  select * into v_snapshot from public.assessment_result_snapshots
    where assignment_id = p_assignment_id;
  if not found or v_snapshot.visibility_tier <> 'candidate_full' then
    raise exception 'this result is not available for candidate-managed sharing';
  end if;
  select employer_org_id into v_recipient from public.job_orders
    where id = v_assignment.job_order_id;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'share expiry must be in the future';
  end if;
  insert into public.candidate_consents
    (candidate_id, purpose, covered_org_id, scope, method, note)
  values
    (v_assignment.candidate_id, 'share_assessment_result', v_recipient,
     jsonb_build_object('assignment_id', p_assignment_id,
                        'job_order_id', v_assignment.job_order_id,
                        'purpose', trim(p_purpose)),
     'web_form', 'Candidate explicitly shared a permitted result snapshot')
  returning id into v_consent;
  insert into public.result_share_grants
    (candidate_id, assignment_id, recipient_org_id, purpose, job_order_id,
     scope, consent_id, expires_at)
  values
    (v_assignment.candidate_id, p_assignment_id, v_recipient, trim(p_purpose),
     v_assignment.job_order_id, jsonb_build_object('visibility_tier', v_snapshot.visibility_tier),
     v_consent, p_expires_at)
  returning id into v_grant;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, source_type, source_id)
  values
    (v_assignment.candidate_id, v_assignment.application_id, 'result_shared',
     'Assessment result shared',
     jsonb_build_object('grant_id', v_grant, 'recipient_org_id', v_recipient,
                        'job_order_id', v_assignment.job_order_id, 'purpose', trim(p_purpose)),
     'result_share_grant', v_grant::text);
  return v_grant;
end $$;

create or replace function public.candidate_revoke_result_share(p_grant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_grant public.result_share_grants%rowtype; v_application uuid;
begin
  update public.result_share_grants
    set revoked_at = now(), revoked_by = auth.uid()
    where id = p_grant_id and candidate_id = public.auth_candidate_id()
      and revoked_at is null
    returning * into v_grant;
  if not found then raise exception 'active share not found'; end if;
  select application_id into v_application from public.assessment_assignments
    where id = v_grant.assignment_id;
  update public.candidate_consents set withdrawn_at = now()
    where id = v_grant.consent_id and withdrawn_at is null;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, source_type, source_id)
  values
    (v_grant.candidate_id, v_application, 'result_revoked', 'Assessment result share revoked',
     jsonb_build_object('grant_id', v_grant.id, 'recipient_org_id', v_grant.recipient_org_id,
                        'job_order_id', v_grant.job_order_id),
     'result_share_grant', v_grant.id::text || ':revoked');
end $$;

create or replace function public.candidate_share_cv(
  p_application_id uuid, p_document_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_app public.applications%rowtype; v_recipient uuid;
declare v_consent uuid; v_event uuid; v_submission_id uuid; v_portal_path text;
begin
  select * into v_app from public.applications
    where id = p_application_id and candidate_id = public.auth_candidate_id()
      and withdrawn_at is null;
  if not found then raise exception 'active application not found'; end if;
  if not exists (select 1 from public.candidate_documents d
                 where d.id = p_document_id and d.candidate_id = v_app.candidate_id
                   and d.doc_type = 'cv' and d.status = 'active') then
    raise exception 'active CV not found';
  end if;
  select employer_org_id into v_recipient from public.job_orders where id = v_app.job_order_id;

  -- Pin the selected CV onto the application and any live employer submission so
  -- the employer portal actually opens the document the candidate consented to.
  update public.applications
    set cv_document_id = p_document_id, updated_at = now()
    where id = v_app.id;
  update public.employer_submissions
    set cv_document_id = p_document_id
    where application_id = v_app.id
      and access_revoked_at is null;

  select id into v_submission_id
    from public.employer_submissions
    where application_id = v_app.id
      and access_revoked_at is null
    order by created_at desc
    limit 1;
  v_portal_path := case
    when v_submission_id is not null then '/employer/submissions/' || v_submission_id::text
    else '/employer/submissions?application=' || v_app.id::text
  end;

  insert into public.candidate_consents
    (candidate_id, purpose, covered_org_id, scope, method, note)
  values
    (v_app.candidate_id, 'share_document', v_recipient,
     jsonb_build_object('application_id', v_app.id, 'job_order_id', v_app.job_order_id,
                        'document_id', p_document_id, 'channel', 'portal_link'),
     'web_form', 'Candidate explicitly shared a CV using a secure portal link')
  returning id into v_consent;
  insert into public.cv_share_events
    (candidate_id, application_id, recipient_org_id, document_id, consent_id,
     channel, portal_path)
  values
    (v_app.candidate_id, v_app.id, v_recipient, p_document_id, v_consent,
     'portal_link', v_portal_path)
  returning id into v_event;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, source_type, source_id)
  values
    (v_app.candidate_id, v_app.id, 'cv_shared', 'CV shared through the secure portal',
     jsonb_build_object('cv_share_event_id', v_event, 'recipient_org_id', v_recipient,
                        'job_order_id', v_app.job_order_id, 'channel', 'portal_link',
                        'document_id', p_document_id),
     'cv_share_event', v_event::text);
  return v_event;
end $$;

create or replace function public.candidate_request_support(
  p_request_type text, p_subject_type text, p_subject_id uuid, p_message text
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_candidate uuid := public.auth_candidate_id();
declare v_application uuid; v_job_order uuid; v_responsible_org uuid;
declare v_assigned_to uuid; v_event bigint; v_event_type text;
begin
  if v_candidate is null then raise exception 'candidate profile required'; end if;
  if p_request_type not in ('help', 'reschedule', 'duplicate_review') then
    raise exception 'unsupported request type';
  end if;
  if length(trim(p_message)) < 10 or length(trim(p_message)) > 2000 then
    raise exception 'message must be between 10 and 2000 characters';
  end if;
  if p_request_type = 'duplicate_review' then
    if p_subject_type <> 'candidate' or p_subject_id <> v_candidate then
      raise exception 'invalid duplicate review subject';
    end if;
  elsif p_subject_type = 'assessment' then
    select application_id, job_order_id, assigned_by
      into v_application, v_job_order, v_assigned_to
      from public.assessment_assignments
      where id = p_subject_id and candidate_id = v_candidate;
    if not found then raise exception 'assessment not found'; end if;
  elsif p_subject_type = 'interview' then
    select application_id, job_order_id, assigned_by
      into v_application, v_job_order, v_assigned_to
      from public.interview_assignments
      where id = p_subject_id and candidate_id = v_candidate;
    if not found then raise exception 'interview not found'; end if;
  elsif p_subject_type = 'application' then
    select id, job_order_id, assigned_recruiter_id
      into v_application, v_job_order, v_assigned_to
      from public.applications where id = p_subject_id and candidate_id = v_candidate;
    if not found then raise exception 'application not found'; end if;
  else
    raise exception 'unsupported request subject';
  end if;
  if v_application is not null then
    select owning_org_id into v_responsible_org
      from public.applications where id = v_application;
  elsif v_job_order is not null then
    select responsible_org_id into v_responsible_org
      from public.job_orders where id = v_job_order;
  end if;
  v_event_type := case p_request_type
    when 'reschedule' then 'reschedule_requested'
    when 'duplicate_review' then 'duplicate_review_requested'
    else 'help_requested' end;
  insert into public.candidate_visible_events
    (candidate_id, application_id, event_type, label, details, source_type, source_id)
  values
    (v_candidate, v_application, v_event_type,
     case p_request_type when 'reschedule' then 'Reschedule requested'
       when 'duplicate_review' then 'Duplicate account review requested'
       else 'Help requested' end,
     jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id,
                        'message', trim(p_message)),
     'candidate_request', gen_random_uuid()::text)
  returning id into v_event;
  if v_assigned_to is not null then
    insert into public.notifications
      (user_id, category, title, body, subject_type, subject_id)
    values
      (v_assigned_to, 'candidate_support',
       case p_request_type when 'reschedule' then 'Candidate requested a reschedule'
         when 'duplicate_review' then 'Candidate requested duplicate review'
         else 'Candidate requested help' end,
       trim(p_message), p_subject_type, p_subject_id);
  else
    insert into public.notifications
      (user_id, category, title, body, subject_type, subject_id)
    select distinct m.user_id, 'candidate_support',
      case p_request_type when 'duplicate_review' then 'Candidate requested duplicate review'
        else 'Candidate requested help' end,
      trim(p_message), 'candidate', v_candidate
    from public.memberships m
    where m.status = 'active'
      and (
        m.role = 'hq_admin'
        or (
          m.role = 'franchise_admin'
          and v_responsible_org is not null
          and m.organization_id = v_responsible_org
        )
      );
  end if;
  return v_event;
end $$;

revoke all on function public.candidate_share_assessment_result(uuid, text, timestamptz),
  public.candidate_revoke_result_share(uuid), public.candidate_share_cv(uuid, uuid),
  public.candidate_request_support(text, text, uuid, text) from public, anon;
grant execute on function public.candidate_share_assessment_result(uuid, text, timestamptz),
  public.candidate_revoke_result_share(uuid), public.candidate_share_cv(uuid, uuid),
  public.candidate_request_support(text, text, uuid, text) to authenticated;
