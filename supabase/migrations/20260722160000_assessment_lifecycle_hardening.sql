-- Hardening for the aptitude-assessment workflow:
-- pass threshold, candidate lifecycle updates, reliable notifications,
-- future-compatible grading boundary, audit events, and updated_at.

-- ---------------------------------------------------------------------------
-- Job-order pass threshold (percent, typically 60–70)
-- ---------------------------------------------------------------------------
alter table public.job_orders
  add column if not exists assessment_pass_threshold numeric(5,2) not null default 65
    check (assessment_pass_threshold >= 50 and assessment_pass_threshold <= 100);

comment on column public.job_orders.assessment_pass_threshold is
  'Configured passing score percent for the Shugulika aptitude plan (MVP default 65).';

-- ---------------------------------------------------------------------------
-- Assessment assignment grading boundary (provider-independent)
-- ---------------------------------------------------------------------------
alter table public.assessment_assignments
  add column if not exists provider text,
  add column if not exists external_reference text,
  add column if not exists pass_threshold numeric(5,2),
  add column if not exists mcq_score numeric(5,2),
  add column if not exists free_response_score numeric(5,2),
  add column if not exists human_review_required boolean not null default false,
  add column if not exists ai_confidence numeric(4,3),
  add column if not exists grading_payload jsonb not null default '{}'::jsonb,
  add column if not exists responses jsonb not null default '{}'::jsonb;

comment on column public.assessment_assignments.provider is
  'Optional future provider key (null = first-party / manual). Never hard-codes a vendor.';
comment on column public.assessment_assignments.grading_payload is
  'Structured grading output: rubric refs, per-item scores, evidence, token/cost metadata.';
comment on column public.assessment_assignments.responses is
  'Candidate answers (MCQ selections and free-response text) when a first-party engine exists.';
comment on column public.assessment_assignments.human_review_required is
  'True when AI free-response grading is low-confidence or borderline; AI alone must not reject.';

alter table public.assessment_assignments
  drop constraint if exists assessment_assignments_ai_confidence_check;
alter table public.assessment_assignments
  add constraint assessment_assignments_ai_confidence_check
  check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1));

alter table public.assessment_assignments
  drop constraint if exists assessment_assignments_pass_threshold_check;
alter table public.assessment_assignments
  add constraint assessment_assignments_pass_threshold_check
  check (pass_threshold is null or (pass_threshold >= 50 and pass_threshold <= 100));

-- updated_at trigger (same helper as core schema)
drop trigger if exists trg_updated on public.assessment_assignments;
create trigger trg_updated
  before update on public.assessment_assignments
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Candidate may advance own assignment through opened → in_progress → submitted
-- ---------------------------------------------------------------------------
drop policy if exists assessment_assignment_candidate_update on public.assessment_assignments;
create policy assessment_assignment_candidate_update on public.assessment_assignments
  for update to authenticated
  using (
    candidate_id = public.auth_candidate_id()
    and status in ('assigned', 'opened', 'in_progress')
  )
  with check (
    candidate_id = public.auth_candidate_id()
    and status in ('opened', 'in_progress', 'submitted')
    -- Candidates cannot self-grade or rewrite staff grading fields.
    and grader_id is null
    and graded_at is null
    and score is null
    and result_band is null
    and grading_notes is null
    and coalesce(human_review_required, false) = false
    and ai_confidence is null
    and grading_payload = '{}'::jsonb
  );

-- ---------------------------------------------------------------------------
-- Storage: employers may replace (update) objects in their org folder
-- ---------------------------------------------------------------------------
drop policy if exists "employer updates own assessment uploads" on storage.objects;
create policy "employer updates own assessment uploads" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'employer-assessments'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from public.memberships
      where user_id = auth.uid()
        and role = 'employer_user'
        and status = 'active'
    )
  )
  with check (
    bucket_id = 'employer-assessments'
    and (storage.foldername(name))[1] in (
      select organization_id::text
      from public.memberships
      where user_id = auth.uid()
        and role = 'employer_user'
        and status = 'active'
    )
  );

-- ---------------------------------------------------------------------------
-- Reliable candidate assessment notification (security definer)
-- ---------------------------------------------------------------------------
create or replace function public.notify_candidate_of_assessment_assignment(
  p_assignment_id uuid,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.assessment_assignments;
  v_job public.job_orders;
  v_user_id uuid;
  v_notification_id uuid;
begin
  if p_assignment_id is null
     or nullif(trim(p_title), '') is null
     or nullif(trim(p_body), '') is null then
    raise exception 'assignment id, title, and body are required';
  end if;

  select * into v_assignment
  from public.assessment_assignments
  where id = p_assignment_id;

  if v_assignment.id is null then
    raise exception 'assessment assignment not found';
  end if;

  select * into v_job
  from public.job_orders
  where id = v_assignment.job_order_id;

  if v_job.id is null then
    raise exception 'job order not found';
  end if;

  if not public.auth_is_hq()
     and v_job.responsible_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'not authorized';
  end if;

  if not (
    public.auth_is_hq()
    or public.auth_has_role('franchise_admin')
    or public.auth_has_role('recruiter')
  ) then
    raise exception 'not authorized';
  end if;

  select cp.user_id into v_user_id
  from public.candidate_profiles cp
  where cp.id = v_assignment.candidate_id;

  if v_user_id is null then
    raise exception 'candidate has no linked user';
  end if;

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  values (
    v_user_id,
    'assessment',
    trim(p_title),
    trim(p_body),
    'application',
    v_assignment.application_id
  )
  returning id into v_notification_id;

  return v_notification_id;
end;
$$;

revoke all on function public.notify_candidate_of_assessment_assignment(uuid, text, text) from public;
grant execute on function public.notify_candidate_of_assessment_assignment(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit assessment lifecycle transitions
-- ---------------------------------------------------------------------------
create or replace function public.audit_assessment_assignment_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action text;
  v_org uuid;
begin
  -- Assignment creation is audited by the application action (includes deadline).
  -- This trigger records subsequent lifecycle transitions.
  if old.status is distinct from new.status then
    v_action := case new.status
      when 'opened' then 'assessment.opened'
      when 'in_progress' then 'assessment.in_progress'
      when 'submitted' then 'assessment.submitted'
      when 'graded' then 'assessment.graded'
      when 'cancelled' then 'assessment.cancelled'
      when 'expired' then 'assessment.expired'
      else 'assessment.status_changed'
    end;
  elsif coalesce(old.human_review_required, false) is distinct from coalesce(new.human_review_required, false)
        and new.human_review_required then
    v_action := 'assessment.manual_review_required';
  else
    return new;
  end if;

  select responsible_org_id into v_org
  from public.job_orders
  where id = new.job_order_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    v_action,
    'assessment_assignment',
    new.id,
    v_org,
    jsonb_build_object('status', old.status),
    jsonb_build_object(
      'status', new.status,
      'assessment_mode', new.assessment_mode,
      'assessment_seniority', new.assessment_seniority,
      'due_at', new.due_at,
      'score', new.score,
      'human_review_required', new.human_review_required
    ),
    jsonb_build_object(
      'application_id', new.application_id,
      'job_order_id', new.job_order_id,
      'candidate_id', new.candidate_id
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_assessment_assignment_lifecycle on public.assessment_assignments;
create trigger trg_audit_assessment_assignment_lifecycle
after update on public.assessment_assignments
for each row execute function public.audit_assessment_assignment_lifecycle();

-- Enrich job-order assessment audit payload with pass threshold / file size
create or replace function public.audit_job_assessment_configuration()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.assessment_configured',
    'job_order',
    new.id,
    new.responsible_org_id,
    jsonb_build_object(
      'assessment_mode', new.assessment_mode,
      'assessment_seniority', new.assessment_seniority,
      'assessment_pass_threshold', new.assessment_pass_threshold,
      'employer_file_name', new.assessment_file_name,
      'employer_file_size', new.assessment_file_size
    ),
    jsonb_build_object('employer_org_id', new.employer_org_id)
  );
  return new;
end;
$$;

notify pgrst, 'reload schema';
