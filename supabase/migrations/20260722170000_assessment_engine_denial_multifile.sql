-- Assessment engine support: multi-file employer uploads, grade finalization RPC,
-- job-order denial with mandatory reason, and AI usage feature expansion.

-- ---------------------------------------------------------------------------
-- AI usage: allow assessment feature
-- ---------------------------------------------------------------------------
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_feature_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_feature_check
  check (feature in ('resume', 'screening', 'assessment'));

-- ---------------------------------------------------------------------------
-- Job order denial
-- ---------------------------------------------------------------------------
alter table public.job_orders
  add column if not exists denial_reason text;

comment on column public.job_orders.denial_reason is
  'Required free-text reason when HQ/franchise staff deny a submitted job order.';

do $$
declare
  cons text;
begin
  select c.conname into cons
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'job_orders'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%submitted%';
  if cons is not null then
    execute format('alter table public.job_orders drop constraint %I', cons);
  end if;
end $$;

alter table public.job_orders
  add constraint job_orders_status_check
  check (status in (
    'draft','submitted','approved','active','on_hold','filled','partially_filled',
    'cancelled','closed','denied'
  ));

alter table public.job_orders
  drop constraint if exists job_orders_denial_reason_check;
alter table public.job_orders
  add constraint job_orders_denial_reason_check
  check (
    (status = 'denied' and denial_reason is not null and length(trim(denial_reason)) >= 8)
    or (status <> 'denied')
  );

create or replace function public.deny_job_order(
  p_job_order_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 8 then
    raise exception 'A denial reason of at least 8 characters is required';
  end if;

  select * into v_order
  from public.job_orders
  where id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job order not found or not authorized';
  end if;

  if not (
    public.auth_is_hq()
    or public.auth_has_role('franchise_admin')
  ) then
    raise exception 'Only HQ or franchise admins can deny job orders';
  end if;

  if not public.auth_is_hq()
     and v_order.responsible_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'Job order is outside your organization scope';
  end if;

  if v_order.status <> 'submitted' then
    raise exception 'Only submitted job orders can be denied';
  end if;

  update public.job_orders
  set status = 'denied',
      denial_reason = v_reason,
      closed_reason = v_reason,
      updated_at = now()
  where id = p_job_order_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.denied',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', 'denied', 'denial_reason', v_reason),
    jsonb_build_object('employer_org_id', v_order.employer_org_id)
  );

  insert into public.activity_events (
    owning_org_id, subject_type, subject_id, event_type, actor_id, summary, metadata
  ) values (
    v_order.responsible_org_id,
    'job_order',
    p_job_order_id,
    'job_order_denied',
    auth.uid(),
    'Job order denied',
    jsonb_build_object('denial_reason', v_reason)
  );
end;
$$;

revoke all on function public.deny_job_order(uuid, text) from public;
grant execute on function public.deny_job_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Employer assessment files (candidate tests + answer keys; multi-file)
-- ---------------------------------------------------------------------------
create table if not exists public.job_order_assessment_files (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  kind text not null check (kind in ('candidate_test', 'answer_key')),
  bucket_id text not null default 'employer-assessments',
  object_path text not null,
  file_name text not null,
  mime_type text,
  byte_size bigint,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (job_order_id, object_path)
);

create index if not exists idx_jo_assessment_files_job
  on public.job_order_assessment_files (job_order_id, kind);

alter table public.job_order_assessment_files enable row level security;

create policy jo_assessment_files_staff_employer_read on public.job_order_assessment_files
  for select to authenticated
  using (
    exists (
      select 1 from public.job_orders jo
      where jo.id = job_order_assessment_files.job_order_id
        and (
          public.auth_is_hq()
          or jo.employer_org_id in (select public.auth_scoped_org_ids())
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
        )
    )
  );

-- Candidates may only read candidate_test files after assignment (never answer keys).
create policy jo_assessment_files_candidate_test_read on public.job_order_assessment_files
  for select to authenticated
  using (
    kind = 'candidate_test'
    and exists (
      select 1
      from public.assessment_assignments aa
      join public.candidate_profiles cp on cp.id = aa.candidate_id
      where aa.job_order_id = job_order_assessment_files.job_order_id
        and cp.user_id = auth.uid()
        and aa.status not in ('cancelled', 'expired')
    )
  );

create policy jo_assessment_files_employer_insert on public.job_order_assessment_files
  for insert to authenticated
  with check (
    public.auth_has_role('employer_user')
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.job_orders jo
      where jo.id = job_order_assessment_files.job_order_id
        and jo.employer_org_id in (select public.auth_scoped_org_ids())
        and jo.created_by = auth.uid()
    )
  );

grant select, insert, delete on public.job_order_assessment_files to authenticated;

create policy jo_assessment_files_employer_delete on public.job_order_assessment_files
  for delete to authenticated
  using (
    public.auth_has_role('employer_user')
    and exists (
      select 1 from public.job_orders jo
      where jo.id = job_order_assessment_files.job_order_id
        and jo.employer_org_id in (select public.auth_scoped_org_ids())
        and jo.created_by = auth.uid()
    )
  );

-- Expand storage SELECT so answer keys are staff/employer only (path on job_orders
-- legacy column OR job_order_assessment_files).
drop policy if exists "authorized users read employer assessments" on storage.objects;
create policy "authorized users read employer assessments" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'employer-assessments'
    and (
      exists (
        select 1
        from public.job_orders jo
        where jo.assessment_file_path = storage.objects.name
          and (
            public.auth_is_hq()
            or jo.employer_org_id in (select public.auth_scoped_org_ids())
            or jo.responsible_org_id in (select public.auth_scoped_org_ids())
            or exists (
              select 1
              from public.assessment_assignments aa
              join public.candidate_profiles cp on cp.id = aa.candidate_id
              where aa.job_order_id = jo.id
                and cp.user_id = auth.uid()
                and aa.status not in ('cancelled', 'expired')
            )
          )
      )
      or exists (
        select 1
        from public.job_order_assessment_files f
        join public.job_orders jo on jo.id = f.job_order_id
        where f.object_path = storage.objects.name
          and (
            public.auth_is_hq()
            or jo.employer_org_id in (select public.auth_scoped_org_ids())
            or jo.responsible_org_id in (select public.auth_scoped_org_ids())
            or (
              f.kind = 'candidate_test'
              and exists (
                select 1
                from public.assessment_assignments aa
                join public.candidate_profiles cp on cp.id = aa.candidate_id
                where aa.job_order_id = jo.id
                  and cp.user_id = auth.uid()
                  and aa.status not in ('cancelled', 'expired')
              )
            )
          )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Candidate may write responses when submitting; grading via security definer
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
    and grader_id is null
    and graded_at is null
    and score is null
    and result_band is null
    and grading_notes is null
    and coalesce(human_review_required, false) = false
    and ai_confidence is null
    and grading_payload = '{}'::jsonb
  );

create or replace function public.apply_assessment_grade(
  p_assignment_id uuid,
  p_responses jsonb,
  p_score numeric,
  p_mcq_score numeric,
  p_free_response_score numeric,
  p_result_band text,
  p_human_review_required boolean,
  p_ai_confidence numeric,
  p_grading_payload jsonb,
  p_grading_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.assessment_assignments;
  v_job public.job_orders;
  v_is_candidate boolean;
  v_is_staff boolean;
begin
  select * into v_assignment
  from public.assessment_assignments
  where id = p_assignment_id
  for update;

  if v_assignment.id is null then
    raise exception 'assessment assignment not found';
  end if;

  select * into v_job from public.job_orders where id = v_assignment.job_order_id;

  v_is_candidate := exists (
    select 1 from public.candidate_profiles cp
    where cp.id = v_assignment.candidate_id and cp.user_id = auth.uid()
  );
  v_is_staff := public.auth_is_hq()
    or (
      (public.auth_has_role('franchise_admin') or public.auth_has_role('recruiter'))
      and v_job.responsible_org_id in (select public.auth_scoped_org_ids())
    );

  if not (v_is_candidate or v_is_staff) then
    raise exception 'not authorized';
  end if;

  if v_assignment.status in ('graded', 'cancelled', 'expired') then
    raise exception 'assessment cannot be graded in its current status';
  end if;

  update public.assessment_assignments
  set
    responses = coalesce(p_responses, responses),
    status = case
      when p_human_review_required then 'submitted'
      else 'graded'
    end,
    submitted_at = coalesce(submitted_at, now()),
    opened_at = coalesce(opened_at, now()),
    score = p_score,
    mcq_score = p_mcq_score,
    free_response_score = p_free_response_score,
    result_band = p_result_band,
    human_review_required = coalesce(p_human_review_required, false),
    ai_confidence = p_ai_confidence,
    grading_payload = coalesce(p_grading_payload, '{}'::jsonb),
    grading_notes = p_grading_notes,
    grader_id = case when coalesce(p_human_review_required, false) then null else auth.uid() end,
    graded_at = case when coalesce(p_human_review_required, false) then null else now() end,
    updated_at = now()
  where id = p_assignment_id;
end;
$$;

revoke all on function public.apply_assessment_grade(
  uuid, jsonb, numeric, numeric, numeric, text, boolean, numeric, jsonb, text
) from public;
grant execute on function public.apply_assessment_grade(
  uuid, jsonb, numeric, numeric, numeric, text, boolean, numeric, jsonb, text
) to authenticated;

notify pgrst, 'reload schema';
