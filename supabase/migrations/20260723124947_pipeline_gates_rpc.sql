-- =============================================================================
-- Pipeline gates at the database/RPC layer (approved MVP deviation).
-- See docs/database/15-mvp-pipeline-deviation.md.
-- =============================================================================

-- ---- Session flag helper (RPCs set this before updating applications) --------
create or replace function private.pipeline_stage_rpc_enabled()
returns boolean
language sql
stable
as $$
  select coalesce(nullif(current_setting('shugulika.stage_rpc', true), ''), '') = '1';
$$;

-- ---- Block direct stage / rejection column updates --------------------------
create or replace function private.enforce_application_stage_rpc()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if private.pipeline_stage_rpc_enabled() then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.current_stage is not distinct from old.current_stage
     and new.rejection_reason is not distinct from old.rejection_reason
     and new.rejected_from_stage is not distinct from old.rejected_from_stage
     and new.rejected_at is not distinct from old.rejected_at
  then
    return new;
  end if;

  raise exception
    'application stage and rejection fields may only change via advance_application / reject_application / reopen_application';
end;
$$;

drop trigger if exists trg_applications_stage_rpc on public.applications;
create trigger trg_applications_stage_rpc
  before update of current_stage, rejection_reason, rejected_from_stage, rejected_at
  on public.applications
  for each row
  execute function private.enforce_application_stage_rpc();

-- ---- Allowed next stages (mirrors src/lib/constants.ts after skip removal) --
create or replace function private.pipeline_allowed_next(p_from text)
returns text[]
language sql
immutable
as $$
  select case p_from
    when 'cv_review' then array['testing']
    when 'testing' then array[]::text[]          -- only via allow_auto mark submitted
    when 'test_review' then array['interview_screening']
    when 'interview_screening' then array[]::text[]
    when 'interview_review' then array['reference_checks', 'client_submission']
    when 'reference_checks' then array['client_submission']
    when 'client_submission' then array['offer']
    when 'offer' then array['hired']
    else array[]::text[]
  end;
$$;

create or replace function private.pipeline_waive_reason(p_metadata jsonb)
returns text
language sql
immutable
as $$
  select nullif(trim(coalesce(p_metadata->>'waive_reason', '')), '');
$$;

-- ---- Gate checks ------------------------------------------------------------
create or replace function private.pipeline_has_screening_notes(p_application uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.recruiter_notes n
    where n.subject_type = 'application'
      and n.subject_id = p_application
      and nullif(trim(n.body), '') is not null
  );
$$;

create or replace function private.pipeline_assessment_ready_for_review(p_application uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.assessment_assignments a
    where a.application_id = p_application
      and a.status in ('submitted', 'graded')
  );
$$;

create or replace function private.pipeline_assessment_reviewed(p_application uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.assessment_assignments a
    where a.application_id = p_application
      and a.status = 'graded'
      and coalesce(a.human_review_required, false) = false
  );
$$;

create or replace function private.pipeline_interview_completed(p_application uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.interviews i
    where i.application_id = p_application
      and i.status = 'completed'
  )
  or exists (
    select 1
    from public.interview_assignments ia
    where ia.application_id = p_application
      and ia.status in ('submitted', 'reviewed')
  );
$$;

create or replace function private.pipeline_interview_reviewed(p_application uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.interviews i
    where i.application_id = p_application
      and i.status = 'completed'
      and nullif(trim(coalesce(i.outcome, '')), '') is not null
  )
  or exists (
    select 1
    from public.interview_assignments ia
    where ia.application_id = p_application
      and ia.status = 'reviewed'
  );
$$;

create or replace function private.pipeline_has_employer_consent(p_application uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.applications app
    join public.job_orders jo on jo.id = app.job_order_id
    join public.candidate_consents c
      on c.candidate_id = app.candidate_id
     and c.purpose = 'employer_submission'
     and c.covered_org_id = jo.employer_org_id
     and c.withdrawn_at is null
    where app.id = p_application
  );
$$;

create or replace function private.pipeline_has_accepted_offer(p_application uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.offers o
    where o.application_id = p_application
      and o.status = 'accepted'
  );
$$;

create or replace function private.pipeline_assert_gates(
  p_app public.applications,
  p_from text,
  p_to text,
  p_metadata jsonb
)
returns void
language plpgsql
stable
set search_path = public, private
as $$
declare
  v_waive text := private.pipeline_waive_reason(p_metadata);
begin
  -- Screening notes before leaving CV Review (Shortlisted collapse).
  if p_from = 'cv_review' and p_to <> 'rejected' then
    if not private.pipeline_has_screening_notes(p_app.id) then
      raise exception 'Complete screening notes before advancing past CV Review';
    end if;
  end if;

  -- Testing → Test Review
  if p_from = 'testing' and p_to = 'test_review' then
    if v_waive is null and not private.pipeline_assessment_ready_for_review(p_app.id) then
      raise exception 'Assessment must be submitted (or waived) before Test Review';
    end if;
  end if;

  -- Leaving Test Review
  if p_from = 'test_review' and p_to not in ('rejected') then
    if v_waive is null and not private.pipeline_assessment_reviewed(p_app.id) then
      raise exception 'Assessment must be graded and cleared of human review (or waived) before leaving Test Review';
    end if;
  end if;

  -- Interview Screening → Interview Review
  if p_from = 'interview_screening' and p_to = 'interview_review' then
    if v_waive is null and not private.pipeline_interview_completed(p_app.id) then
      raise exception 'Interview must be completed (or waived) before Interview Review';
    end if;
  end if;

  -- Leaving Interview Review
  if p_from = 'interview_review' and p_to not in ('rejected') then
    if v_waive is null and not private.pipeline_interview_reviewed(p_app.id) then
      raise exception 'Interview outcome/review is required (or waive) before leaving Interview Review';
    end if;
  end if;

  -- Employer-specific consent before Client Submission
  if p_to = 'client_submission' then
    if not private.pipeline_has_employer_consent(p_app.id) then
      raise exception 'Employer-specific consent required before Client Submission';
    end if;
  end if;

  -- Accepted offer before Hired
  if p_to = 'hired' then
    if not private.pipeline_has_accepted_offer(p_app.id) then
      raise exception 'An accepted offer is required before Hired';
    end if;
  end if;
end;
$$;

-- ---- advance_application ----------------------------------------------------
create or replace function public.advance_application(
  p_application uuid,
  p_to_stage text,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_app public.applications;
  v_from text;
  v_allow_auto boolean := coalesce((p_metadata->>'allow_auto')::boolean, false);
  v_source text := coalesce(nullif(trim(p_metadata->>'source'), ''), 'recruiter');
  v_allowed text[];
  v_from_ord int;
  v_to_ord int;
begin
  if p_application is null or nullif(trim(p_to_stage), '') is null then
    raise exception 'application id and target stage are required';
  end if;

  select * into v_app from public.applications where id = p_application for update;
  if v_app.id is null then
    raise exception 'application not found';
  end if;

  if not public.auth_is_hq()
     and v_app.owning_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'not authorized';
  end if;

  if v_app.withdrawn_at is not null then
    raise exception 'This application was withdrawn by the candidate and cannot be advanced.';
  end if;

  if v_app.current_stage = 'rejected' then
    raise exception 'This candidate was rejected and cannot be moved to another stage.';
  end if;

  if p_to_stage = 'rejected' then
    raise exception 'Use reject_application to reject a candidate';
  end if;

  if not exists (
    select 1 from public.pipeline_stages ps
    where ps.key = p_to_stage and ps.stage_class = 'candidate'
  ) then
    raise exception 'Invalid target stage';
  end if;

  -- Legacy keys are not valid move targets
  if p_to_stage in (
    'applied_sourced','cv_screening','longlisted','ai_interview_screening',
    'shortlisted','screening_interview','client_interview'
  ) then
    raise exception 'Legacy stage is not a valid move target';
  end if;

  v_from := v_app.current_stage;

  select ordinal into v_from_ord from public.pipeline_stages where key = v_from;
  select ordinal into v_to_ord from public.pipeline_stages where key = p_to_stage;

  if not v_allow_auto and v_to_ord is not null and v_from_ord is not null and v_to_ord <= v_from_ord then
    raise exception 'Candidates can only move forward. Going back to an earlier stage is not allowed.';
  end if;

  if not v_allow_auto then
    v_allowed := private.pipeline_allowed_next(v_from);
    if not (p_to_stage = any (v_allowed)) then
      raise exception 'Cannot move from % to %', v_from, p_to_stage;
    end if;
  else
    -- Auto transitions: testing → test_review, interview_screening → interview_review
    if not (
      (v_from = 'testing' and p_to_stage = 'test_review')
      or (v_from = 'interview_screening' and p_to_stage = 'interview_review')
    ) then
      raise exception 'Automatic transition from % to % is not allowed', v_from, p_to_stage;
    end if;
  end if;

  perform private.pipeline_assert_gates(v_app, v_from, p_to_stage, coalesce(p_metadata, '{}'::jsonb));

  perform set_config('shugulika.stage_rpc', '1', true);

  update public.applications
     set current_stage = p_to_stage,
         updated_at = now()
   where id = p_application;

  insert into public.application_stage_history (
    application_id, from_stage, to_stage, actor_id, actor_role, note, source
  ) values (
    p_application,
    v_from,
    p_to_stage,
    auth.uid(),
    'recruiter',
    nullif(trim(coalesce(p_note, '')), ''),
    v_source
  );

  return jsonb_build_object(
    'ok', true,
    'from_stage', v_from,
    'to_stage', p_to_stage
  );
end;
$$;

revoke all on function public.advance_application(uuid, text, text, jsonb) from public;
grant execute on function public.advance_application(uuid, text, text, jsonb) to authenticated;

-- ---- reject_application -----------------------------------------------------
create or replace function public.reject_application(
  p_application uuid,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_app public.applications;
  v_from text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_application is null then
    raise exception 'application id is required';
  end if;
  if v_reason is null then
    raise exception 'A rejection reason is required.';
  end if;

  select * into v_app from public.applications where id = p_application for update;
  if v_app.id is null then
    raise exception 'application not found';
  end if;

  if not public.auth_is_hq()
     and v_app.owning_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'not authorized';
  end if;

  if v_app.current_stage = 'rejected' then
    raise exception 'This candidate is already rejected.';
  end if;

  if v_app.withdrawn_at is not null then
    raise exception 'This application was withdrawn and cannot be rejected.';
  end if;

  v_from := v_app.current_stage;

  perform set_config('shugulika.stage_rpc', '1', true);

  update public.applications
     set current_stage = 'rejected',
         is_on_hold = false,
         rejected_from_stage = v_from,
         rejected_at = now(),
         rejection_reason = v_reason,
         updated_at = now()
   where id = p_application;

  insert into public.application_stage_history (
    application_id, from_stage, to_stage, actor_id, actor_role, reason, note, source
  ) values (
    p_application,
    v_from,
    'rejected',
    auth.uid(),
    'recruiter',
    v_reason,
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Rejected during ' || v_from),
    'recruiter'
  );

  return jsonb_build_object(
    'ok', true,
    'from_stage', v_from,
    'to_stage', 'rejected',
    'rejection_reason', v_reason
  );
end;
$$;

revoke all on function public.reject_application(uuid, text, text) from public;
grant execute on function public.reject_application(uuid, text, text) to authenticated;

-- ---- reopen_application (withdrawn / rejected → cv_review) ------------------
create or replace function public.reopen_application(
  p_application uuid,
  p_note text default null,
  p_source text default 'reopen'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_app public.applications;
  v_from text;
  v_is_staff boolean;
  v_is_candidate boolean;
begin
  if p_application is null then
    raise exception 'application id is required';
  end if;

  select * into v_app from public.applications where id = p_application for update;
  if v_app.id is null then
    raise exception 'application not found';
  end if;

  v_is_staff := public.auth_is_hq()
    or v_app.owning_org_id in (select public.auth_scoped_org_ids());
  v_is_candidate := exists (
    select 1 from public.candidate_profiles cp
    where cp.id = v_app.candidate_id and cp.user_id = auth.uid()
  );

  if not (v_is_staff or v_is_candidate) then
    raise exception 'not authorized';
  end if;

  if v_app.current_stage not in ('rejected') and v_app.withdrawn_at is null then
    raise exception 'Only withdrawn or rejected applications can be reopened';
  end if;

  v_from := case
    when v_app.withdrawn_at is not null then 'withdrawn'
    else v_app.current_stage
  end;

  perform set_config('shugulika.stage_rpc', '1', true);

  update public.applications
     set current_stage = 'cv_review',
         withdrawn_at = null,
         is_on_hold = false,
         rejected_from_stage = null,
         rejected_at = null,
         rejection_reason = null,
         updated_at = now()
   where id = p_application;

  insert into public.application_stage_history (
    application_id, from_stage, to_stage, actor_id, actor_role, note, source
  ) values (
    p_application,
    v_from,
    'cv_review',
    auth.uid(),
    case when v_is_candidate and not v_is_staff then 'candidate' else 'recruiter' end,
    nullif(trim(coalesce(p_note, '')), ''),
    coalesce(nullif(trim(p_source), ''), 'reopen')
  );

  return jsonb_build_object('ok', true, 'from_stage', v_from, 'to_stage', 'cv_review');
end;
$$;

revoke all on function public.reopen_application(uuid, text, text) from public;
grant execute on function public.reopen_application(uuid, text, text) to authenticated;

-- ---- create_placement_from_offer --------------------------------------------
create or replace function public.create_placement_from_offer(p_offer uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_app public.applications;
  v_placement uuid;
  v_employer uuid;
begin
  if p_offer is null then
    raise exception 'offer id is required';
  end if;

  select * into v_offer from public.offers where id = p_offer for update;
  if v_offer.id is null then
    raise exception 'offer not found';
  end if;

  if v_offer.status <> 'accepted' then
    raise exception 'offer not accepted';
  end if;

  select * into v_app from public.applications where id = v_offer.application_id;
  if v_app.id is null then
    raise exception 'application not found';
  end if;

  if not public.auth_is_hq()
     and v_app.owning_org_id not in (select public.auth_scoped_org_ids())
     and v_offer.owning_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'not authorized';
  end if;

  select id into v_placement from public.placements where offer_id = p_offer;
  if v_placement is not null then
    return v_placement;
  end if;

  select employer_org_id into v_employer from public.job_orders where id = v_app.job_order_id;

  insert into public.placements (
    offer_id, application_id, employer_org_id, owning_org_id, recruiter_id, start_date, status
  ) values (
    p_offer,
    v_app.id,
    coalesce(v_offer.employer_org_id, v_employer),
    v_app.owning_org_id,
    v_app.assigned_recruiter_id,
    v_offer.start_date,
    'active'
  )
  returning id into v_placement;

  return v_placement;
end;
$$;

revoke all on function public.create_placement_from_offer(uuid) from public;
grant execute on function public.create_placement_from_offer(uuid) to authenticated;

-- ---- Invoice: placement required to issue non-subscription invoices ---------
create or replace function private.enforce_invoice_placement_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'issued'
     and (tg_op = 'INSERT' or old.status is distinct from 'issued')
     and new.subscription_id is null
     and new.placement_id is null
  then
    raise exception 'Placement is required before issuing a non-subscription invoice';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_placement_gate on public.invoices;
create trigger trg_invoice_placement_gate
  before insert or update of status, placement_id, subscription_id
  on public.invoices
  for each row
  execute function private.enforce_invoice_placement_gate();

-- ---- Submitted employer packs must carry employer-specific consent ----------
create or replace function private.enforce_submission_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
  v_employer uuid;
begin
  if new.status is distinct from 'submitted' and new.submitted_at is null then
    return new;
  end if;

  -- Only enforce when becoming / remaining submitted with a submit timestamp
  if new.status = 'submitted' or new.submitted_at is not null then
    if new.consent_id is null then
      raise exception 'Employer-specific consent_id is required for submitted employer packs';
    end if;

    select jo.employer_org_id into v_employer
    from public.job_orders jo
    where jo.id = new.job_order_id;

    select exists (
      select 1
      from public.candidate_consents c
      where c.id = new.consent_id
        and c.candidate_id = new.candidate_id
        and c.purpose = 'employer_submission'
        and c.covered_org_id = coalesce(new.employer_org_id, v_employer)
        and c.withdrawn_at is null
    ) into v_ok;

    if not v_ok then
      raise exception 'Valid employer-specific consent required for employer submission';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_employer_submission_consent on public.employer_submissions;
create trigger trg_employer_submission_consent
  before insert or update of status, consent_id, submitted_at
  on public.employer_submissions
  for each row
  execute function private.enforce_submission_consent();

notify pgrst, 'reload schema';
