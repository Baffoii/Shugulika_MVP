-- =============================================================================
-- Shugulika MVP — asynchronous video interviews: RLS + guards.
-- Deny-by-default like 0002. Candidates see only their own assignments and
-- snapshots; staff (recruiter / franchise_admin / operations / HQ) act within
-- auth_scoped_org_ids(). Employer users get NO access (they see employer
-- submission snapshots elsewhere, never candidate recordings). Reviews are
-- staff-only. Column-level invariants that RLS cannot express are enforced by
-- BEFORE UPDATE trigger guards so they hold even if the app is bypassed.
-- =============================================================================

-- ---- Helper: which roles administer video interviews -------------------------
create or replace function public.auth_is_interview_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.auth_has_role('recruiter')
      or public.auth_has_role('franchise_admin')
      or public.auth_has_role('operations')
      or public.auth_is_hq();
$$;

-- ---- Enable RLS ----------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['interview_templates','interview_template_questions',
    'interview_assignments','interview_assignment_questions',
    'interview_response_attempts','interview_reviews','interview_events'] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---- Table privileges (RLS remains the row-level gate) ---------------------------
grant select, insert, update, delete on
  public.interview_templates, public.interview_template_questions,
  public.interview_assignments, public.interview_assignment_questions,
  public.interview_response_attempts, public.interview_reviews,
  public.interview_events
to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---- Templates + questions: staff only, org-scoped -------------------------------
create policy ivt_staff_read on public.interview_templates for select to authenticated
  using (organization_id in (select public.auth_scoped_org_ids()) and public.auth_is_interview_staff());
create policy ivt_staff_write on public.interview_templates for all to authenticated
  using (organization_id in (select public.auth_scoped_org_ids()) and public.auth_is_interview_staff())
  with check (organization_id in (select public.auth_scoped_org_ids()) and public.auth_is_interview_staff());

create policy ivtq_staff_read on public.interview_template_questions for select to authenticated
  using (exists (select 1 from public.interview_templates t
                 where t.id = interview_template_questions.template_id
                   and t.organization_id in (select public.auth_scoped_org_ids()))
         and public.auth_is_interview_staff());
create policy ivtq_staff_write on public.interview_template_questions for all to authenticated
  using (exists (select 1 from public.interview_templates t
                 where t.id = interview_template_questions.template_id
                   and t.organization_id in (select public.auth_scoped_org_ids()))
         and public.auth_is_interview_staff())
  with check (exists (select 1 from public.interview_templates t
                      where t.id = interview_template_questions.template_id
                        and t.organization_id in (select public.auth_scoped_org_ids()))
              and public.auth_is_interview_staff());

-- ---- Assignments -----------------------------------------------------------------
-- Candidate: read own (drafts stay hidden until invited).
create policy iva_candidate_read on public.interview_assignments for select to authenticated
  using (candidate_id = public.auth_candidate_id() and status <> 'draft');
-- Candidate: update own while active. The trg guard below whitelists exactly
-- which columns/transitions a candidate may perform.
create policy iva_candidate_update on public.interview_assignments for update to authenticated
  using (candidate_id = public.auth_candidate_id()
         and status in ('invited','in_progress'))
  with check (candidate_id = public.auth_candidate_id());
-- Staff: full management inside their scope.
create policy iva_staff_all on public.interview_assignments for all to authenticated
  using (organization_id in (select public.auth_scoped_org_ids()) and public.auth_is_interview_staff())
  with check (organization_id in (select public.auth_scoped_org_ids()) and public.auth_is_interview_staff());

-- Guard: protect ownership/config columns and important state transitions for
-- every actor; enforce candidate whitelist. Runs before staff and candidate
-- updates alike (and inside the submit_interview definer RPC).
create or replace function public.tg_interview_assignment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_is_staff boolean; v_missing int;
begin
  -- Ownership/linkage fields are immutable for everyone.
  if new.candidate_id  is distinct from old.candidate_id
     or new.application_id is distinct from old.application_id
     or new.job_order_id   is distinct from old.job_order_id
     or new.organization_id is distinct from old.organization_id
     or new.template_id     is distinct from old.template_id then
    raise exception 'assignment ownership fields are immutable';
  end if;

  -- Consent, once given, can never be altered or removed by anyone.
  if old.consented_at is not null and (
       new.consented_at is distinct from old.consented_at
       or new.privacy_notice_version is distinct from old.privacy_notice_version
       or new.instructions_version is distinct from old.instructions_version) then
    raise exception 'consent records are immutable';
  end if;

  -- Any transition INTO submitted must satisfy completeness + server timestamp,
  -- no matter who performs it (protects against bypassing the RPC).
  if new.status = 'submitted' and old.status <> 'submitted' then
    if old.status <> 'in_progress' then
      raise exception 'only an in-progress interview can be submitted';
    end if;
    if new.submitted_at is null then
      raise exception 'submitted_at is required';
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
  end if;

  -- A submitted/reviewed interview is immutable to candidates entirely.
  v_is_staff := public.auth_is_interview_staff()
    and old.organization_id in (select public.auth_scoped_org_ids());
  if v_is_staff then
    return new;
  end if;

  -- Candidate path: whitelist of allowed changes.
  if old.status in ('submitted','reviewed','cancelled') then
    raise exception 'this interview can no longer be modified';
  end if;

  -- Candidates may never touch recruiter/config fields.
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
      if new.consented_at is null or new.started_at is null then
        raise exception 'consent and start time are required to begin';
      end if;
      if old.expires_at is not null and old.expires_at < now() then
        raise exception 'this interview has expired';
      end if;
    elsif new.status = 'expired' and old.expires_at is not null and old.expires_at < now() then
      null; -- self-marking an overdue interview as expired is allowed
    elsif new.status = 'submitted' then
      null; -- completeness verified above
    else
      raise exception 'invalid status change';
    end if;
  end if;

  return new;
end $$;
drop trigger if exists trg_iva_guard on public.interview_assignments;
create trigger trg_iva_guard before update on public.interview_assignments
  for each row execute function public.tg_interview_assignment_guard();

-- ---- Assignment question snapshots -------------------------------------------------
create policy ivaq_candidate_read on public.interview_assignment_questions for select to authenticated
  using (exists (select 1 from public.interview_assignments ia
                 where ia.id = interview_assignment_questions.assignment_id
                   and ia.candidate_id = public.auth_candidate_id()
                   and ia.status <> 'draft'));
create policy ivaq_candidate_update on public.interview_assignment_questions for update to authenticated
  using (exists (select 1 from public.interview_assignments ia
                 where ia.id = interview_assignment_questions.assignment_id
                   and ia.candidate_id = public.auth_candidate_id()
                   and ia.status = 'in_progress'
                   and (ia.expires_at is null or ia.expires_at > now())))
  with check (exists (select 1 from public.interview_assignments ia
                      where ia.id = interview_assignment_questions.assignment_id
                        and ia.candidate_id = public.auth_candidate_id()));
create policy ivaq_staff_read on public.interview_assignment_questions for select to authenticated
  using (exists (select 1 from public.interview_assignments ia
                 where ia.id = interview_assignment_questions.assignment_id
                   and ia.organization_id in (select public.auth_scoped_org_ids()))
         and public.auth_is_interview_staff());
create policy ivaq_staff_insert on public.interview_assignment_questions for insert to authenticated
  with check (exists (select 1 from public.interview_assignments ia
                      where ia.id = interview_assignment_questions.assignment_id
                        and ia.organization_id in (select public.auth_scoped_org_ids()))
              and public.auth_is_interview_staff());

-- Guard: snapshots are immutable; only progress fields may change, and a
-- question may be completed only with an uploaded, selected response.
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
  if new.status = 'completed' and old.status <> 'completed' then
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
drop trigger if exists trg_ivaq_guard on public.interview_assignment_questions;
create trigger trg_ivaq_guard before update on public.interview_assignment_questions
  for each row execute function public.tg_interview_question_guard();

-- ---- Response attempts --------------------------------------------------------------
-- Candidate: read own attempts any time (their review screen), write only while
-- the parent assignment is actively in progress and unexpired.
create policy ivra_candidate_read on public.interview_response_attempts for select to authenticated
  using (candidate_id = public.auth_candidate_id());
create policy ivra_candidate_insert on public.interview_response_attempts for insert to authenticated
  with check (
    candidate_id = public.auth_candidate_id()
    and exists (select 1 from public.interview_assignments ia
                where ia.id = interview_response_attempts.assignment_id
                  and ia.candidate_id = public.auth_candidate_id()
                  and ia.status = 'in_progress'
                  and (ia.expires_at is null or ia.expires_at > now()))
  );
create policy ivra_candidate_update on public.interview_response_attempts for update to authenticated
  using (
    candidate_id = public.auth_candidate_id()
    and exists (select 1 from public.interview_assignments ia
                where ia.id = interview_response_attempts.assignment_id
                  and ia.status = 'in_progress'
                  and (ia.expires_at is null or ia.expires_at > now()))
  )
  with check (candidate_id = public.auth_candidate_id());
create policy ivra_staff_read on public.interview_response_attempts for select to authenticated
  using (exists (select 1 from public.interview_assignments ia
                 where ia.id = interview_response_attempts.assignment_id
                   and ia.organization_id in (select public.auth_scoped_org_ids()))
         and public.auth_is_interview_staff());

-- Guard: attempts must reference the candidate's own question within the same
-- assignment, and the private storage path is server-shaped and immutable —
-- a candidate can never point an attempt at somebody else's object.
create or replace function public.tg_interview_attempt_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_assignment uuid; v_org uuid;
begin
  if tg_op = 'INSERT' then
    select q.assignment_id into v_assignment
    from public.interview_assignment_questions q
    where q.id = new.assignment_question_id;
    if v_assignment is null or v_assignment <> new.assignment_id then
      raise exception 'question does not belong to this assignment';
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

  -- UPDATE: identity, numbering and location are immutable.
  if new.assignment_question_id is distinct from old.assignment_question_id
     or new.assignment_id is distinct from old.assignment_id
     or new.candidate_id is distinct from old.candidate_id
     or new.attempt_number is distinct from old.attempt_number
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path then
    raise exception 'attempt identity fields are immutable';
  end if;
  -- An attempt may only be marked uploaded together with a real upload flow;
  -- once uploaded, it cannot be downgraded back to pending (only failed→retry).
  if old.upload_status = 'uploaded' and new.upload_status <> 'uploaded' then
    raise exception 'an uploaded attempt cannot be reverted';
  end if;
  return new;
end $$;
drop trigger if exists trg_ivra_guard on public.interview_response_attempts;
create trigger trg_ivra_guard before insert or update on public.interview_response_attempts
  for each row execute function public.tg_interview_attempt_guard();

-- ---- Reviews: staff-only, never visible to candidates --------------------------------
create policy ivr_staff_all on public.interview_reviews for all to authenticated
  using (exists (select 1 from public.interview_assignments ia
                 where ia.id = interview_reviews.assignment_id
                   and ia.organization_id in (select public.auth_scoped_org_ids()))
         and public.auth_is_interview_staff())
  with check (exists (select 1 from public.interview_assignments ia
                      where ia.id = interview_reviews.assignment_id
                        and ia.organization_id in (select public.auth_scoped_org_ids()))
              and public.auth_is_interview_staff()
              and recruiter_id = auth.uid());

-- ---- Events: append-only ---------------------------------------------------------------
create policy ive_candidate_insert on public.interview_events for insert to authenticated
  with check (
    actor_user_id = auth.uid()
    and exists (select 1 from public.interview_assignments ia
                where ia.id = interview_events.assignment_id
                  and ia.candidate_id = public.auth_candidate_id())
  );
create policy ive_staff_insert on public.interview_events for insert to authenticated
  with check (
    actor_user_id = auth.uid()
    and exists (select 1 from public.interview_assignments ia
                where ia.id = interview_events.assignment_id
                  and ia.organization_id in (select public.auth_scoped_org_ids()))
    and public.auth_is_interview_staff()
  );
create policy ive_candidate_read on public.interview_events for select to authenticated
  using (exists (select 1 from public.interview_assignments ia
                 where ia.id = interview_events.assignment_id
                   and ia.candidate_id = public.auth_candidate_id()));
create policy ive_staff_read on public.interview_events for select to authenticated
  using (exists (select 1 from public.interview_assignments ia
                 where ia.id = interview_events.assignment_id
                   and ia.organization_id in (select public.auth_scoped_org_ids()))
         and public.auth_is_interview_staff());
-- No UPDATE/DELETE policies => the event log is append-only.

-- ---- Notifications: staff may notify a candidate about their interview -----------------
create policy notif_staff_insert_interview on public.notifications for insert to authenticated
  with check (
    subject_type = 'interview_assignment'
    and subject_id is not null
    and exists (
      select 1
      from public.interview_assignments ia
      join public.candidate_profiles cp on cp.id = ia.candidate_id
      where ia.id = notifications.subject_id
        and cp.user_id = notifications.user_id
        and ia.organization_id in (select public.auth_scoped_org_ids())
    )
  );
