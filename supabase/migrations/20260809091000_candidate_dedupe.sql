-- ATS §9: candidate duplicate detection and reversible, human-driven merges.
--
-- The single rule this schema exists to enforce: a fuzzy score never merges
-- anything. Detection writes a `suspected` link and stops. A merge only ever
-- happens through candidate_merge_events, which requires a named human actor
-- and carries a full before-snapshot so the merge can be reversed.
--
-- Both tables are HQ-only. Recruiters, franchise admins and employers have no
-- policy here at all — the merge queue exposes two candidates side by side,
-- which is a cross-tenant view no franchise or employer may have.

-- ---- Suspected duplicate pairs ---------------------------------------------

create table if not exists public.candidate_duplicate_links (
  id uuid primary key default gen_random_uuid(),
  -- Ordered pair: storing (low, high) makes (a,b) and (b,a) the same row, so a
  -- detector that walks the pool in a different order cannot double-report.
  candidate_id_low uuid not null references public.candidate_profiles(id) on delete cascade,
  candidate_id_high uuid not null references public.candidate_profiles(id) on delete cascade,
  status text not null default 'suspected'
    check (status in ('suspected','confirmed_duplicate','not_duplicate','merged')),
  match_kind text not null default 'probabilistic'
    check (match_kind in ('exact','probabilistic')),
  score numeric not null check (score >= 0 and score <= 1),
  -- Evidence the reviewer sees: [{signal, weight, a, b}] — field names and
  -- normalized comparison values only.
  signals jsonb not null default '[]',
  detector_version text not null default 'candidate-dedupe-v1',
  detected_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_candidate_duplicate_pair_ordered
    check (candidate_id_low < candidate_id_high),
  constraint uq_candidate_duplicate_pair
    unique (candidate_id_low, candidate_id_high)
);

comment on table public.candidate_duplicate_links is
  'Suspected duplicate candidate pairs. Detection only ever writes status=suspected; nothing here merges records.';

create index if not exists idx_candidate_duplicate_links_status
  on public.candidate_duplicate_links(status, score desc);
create index if not exists idx_candidate_duplicate_links_low
  on public.candidate_duplicate_links(candidate_id_low);
create index if not exists idx_candidate_duplicate_links_high
  on public.candidate_duplicate_links(candidate_id_high);

drop trigger if exists trg_candidate_duplicate_links_updated on public.candidate_duplicate_links;
create trigger trg_candidate_duplicate_links_updated
before update on public.candidate_duplicate_links
for each row execute function public.tg_set_updated_at();

-- A link may not be created already resolved: every pair enters review as
-- `suspected`, including exact-signal matches on email or phone.
create or replace function public.tg_candidate_duplicate_link_insert_guard()
returns trigger language plpgsql as $$
begin
  if new.status <> 'suspected' then
    raise exception
      'candidate_duplicate_links: new links must enter review as suspected (got %)', new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_candidate_duplicate_link_insert_guard on public.candidate_duplicate_links;
create trigger trg_candidate_duplicate_link_insert_guard
before insert on public.candidate_duplicate_links
for each row execute function public.tg_candidate_duplicate_link_insert_guard();

-- ---- Soft merge pointer on the canonical record -----------------------------

alter table public.candidate_profiles
  add column if not exists merged_into_candidate_id uuid
    references public.candidate_profiles(id) on delete set null,
  add column if not exists merged_at timestamptz;

comment on column public.candidate_profiles.merged_into_candidate_id is
  'Set when this record was merged into another. The row is never deleted, so a merge stays reversible.';

alter table public.candidate_profiles
  drop constraint if exists ck_candidate_not_merged_into_self;
alter table public.candidate_profiles
  add constraint ck_candidate_not_merged_into_self
  check (merged_into_candidate_id is null or merged_into_candidate_id <> id);

create index if not exists idx_candidate_profiles_merged_into
  on public.candidate_profiles(merged_into_candidate_id)
  where merged_into_candidate_id is not null;

-- ---- The merge event: the only thing that can merge two candidates ----------

create table if not exists public.candidate_merge_events (
  id uuid primary key default gen_random_uuid(),
  duplicate_link_id uuid references public.candidate_duplicate_links(id) on delete set null,
  primary_candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  merged_candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  status text not null default 'merged' check (status in ('merged','reverted')),
  -- [{field_path, winner, winning_value, losing_value, chosen_by}] — one entry
  -- per conflicting field the reviewer decided.
  field_decisions jsonb not null default '[]',
  -- Everything needed to put both records back: profile rows, child-collection
  -- rows, document ids, external mappings.
  before_snapshot jsonb not null,
  -- NOT NULL by design: a merge without a human actor cannot be recorded, and
  -- without a recorded merge nothing may set merged_into_candidate_id.
  performed_by uuid not null references public.profiles(id) on delete restrict,
  performed_at timestamptz not null default now(),
  reverted_by uuid references public.profiles(id) on delete set null,
  reverted_at timestamptz,
  revert_reason text,
  constraint ck_candidate_merge_distinct
    check (primary_candidate_id <> merged_candidate_id),
  constraint ck_candidate_merge_reverted_actor
    check (status <> 'reverted' or (reverted_by is not null and reverted_at is not null))
);

comment on table public.candidate_merge_events is
  'Audit of every candidate merge. performed_by is mandatory, before_snapshot makes the merge reversible, and nothing may mark a candidate merged without a row here.';

create index if not exists idx_candidate_merge_events_primary
  on public.candidate_merge_events(primary_candidate_id);
create index if not exists idx_candidate_merge_events_merged
  on public.candidate_merge_events(merged_candidate_id);
create index if not exists idx_candidate_merge_events_status
  on public.candidate_merge_events(status, performed_at desc);

-- Only one live merge per merged-away candidate.
create unique index if not exists uq_candidate_merge_event_live
  on public.candidate_merge_events(merged_candidate_id)
  where status = 'merged';

-- A candidate may only be flagged merged when a live merge event says so. This
-- is what makes "no auto-merge on fuzzy score alone" a schema property: a
-- detector cannot write the pointer, because it cannot forge a merge event with
-- a real profiles.id actor.
create or replace function public.tg_candidate_merge_pointer_guard()
returns trigger language plpgsql as $$
begin
  if new.merged_into_candidate_id is null then
    return new;
  end if;
  if old.merged_into_candidate_id is not distinct from new.merged_into_candidate_id then
    return new;
  end if;
  if not exists (
    select 1 from public.candidate_merge_events e
    where e.merged_candidate_id = new.id
      and e.primary_candidate_id = new.merged_into_candidate_id
      and e.status = 'merged'
  ) then
    raise exception
      'candidate_profiles: cannot mark % merged without an audited candidate_merge_events row', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_candidate_merge_pointer_guard on public.candidate_profiles;
create trigger trg_candidate_merge_pointer_guard
before update on public.candidate_profiles
for each row execute function public.tg_candidate_merge_pointer_guard();

-- Reverting is an update to the event, never a delete: the audit trail is
-- append-and-amend only.
create or replace function public.tg_candidate_merge_event_immutable()
returns trigger language plpgsql as $$
begin
  if old.primary_candidate_id <> new.primary_candidate_id
     or old.merged_candidate_id <> new.merged_candidate_id
     or old.performed_by <> new.performed_by
     or old.before_snapshot <> new.before_snapshot then
    raise exception 'candidate_merge_events: the audited facts of a merge are immutable'
      using errcode = 'check_violation';
  end if;
  if old.status = 'reverted' and new.status = 'merged' then
    raise exception 'candidate_merge_events: a reverted merge cannot be re-marked as merged'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_candidate_merge_event_immutable on public.candidate_merge_events;
create trigger trg_candidate_merge_event_immutable
before update on public.candidate_merge_events
for each row execute function public.tg_candidate_merge_event_immutable();

-- ---- RLS: HQ only -----------------------------------------------------------

alter table public.candidate_duplicate_links enable row level security;
alter table public.candidate_merge_events enable row level security;

drop policy if exists candidate_duplicate_links_hq_all on public.candidate_duplicate_links;
create policy candidate_duplicate_links_hq_all
  on public.candidate_duplicate_links for all to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

drop policy if exists candidate_merge_events_hq_read on public.candidate_merge_events;
create policy candidate_merge_events_hq_read
  on public.candidate_merge_events for select to authenticated
  using (public.auth_is_hq());

drop policy if exists candidate_merge_events_hq_write on public.candidate_merge_events;
create policy candidate_merge_events_hq_write
  on public.candidate_merge_events for insert to authenticated
  with check (public.auth_is_hq() and performed_by = auth.uid());

drop policy if exists candidate_merge_events_hq_revert on public.candidate_merge_events;
create policy candidate_merge_events_hq_revert
  on public.candidate_merge_events for update to authenticated
  using (public.auth_is_hq())
  with check (public.auth_is_hq());

-- 0002's blanket `grant … on all tables` only covered the tables that existed
-- then. The policies above are what restrict this to HQ; these grants only make
-- the tables reachable.
grant select, insert, update, delete on public.candidate_duplicate_links to authenticated;
-- No delete on the audit: a merge is amended (reverted), never erased.
grant select, insert, update on public.candidate_merge_events to authenticated;
grant select, insert, update, delete on public.candidate_duplicate_links to service_role;
grant select, insert, update on public.candidate_merge_events to service_role;

-- ---- Applying and reverting a merge -----------------------------------------
--
-- HQ has SELECT but not UPDATE on candidate_profiles and its child tables — a
-- candidate owns their own record. A merge therefore cannot be a sequence of
-- client writes, and should not be: it must be atomic, or a crash halfway
-- through leaves a candidate's history split across two records.
--
-- These two SECURITY DEFINER functions are the only way a merge happens. Both
-- re-check hq_admin themselves rather than trusting the caller, and both refuse
-- to run without a real auth.uid() to record as the actor.

create or replace function public.apply_candidate_merge(
  p_primary_candidate_id uuid,
  p_merged_candidate_id uuid,
  p_duplicate_link_id uuid,
  p_field_decisions jsonb,
  p_profile_updates jsonb,
  p_before_snapshot jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_event_id uuid;
  v_updates jsonb := coalesce(p_profile_updates, '{}'::jsonb);
  v_primary public.candidate_profiles%rowtype;
  v_merged public.candidate_profiles%rowtype;
  v_reassigned jsonb;
  v_before_snapshot jsonb;
  v_primary_preferences jsonb;
  v_merged_preferences jsonb;
  v_primary_visibility jsonb;
  v_merged_visibility jsonb;
  v_primary_work_authorization jsonb;
  v_merged_work_authorization jsonb;
  v_deleted_saved_jobs jsonb := '[]'::jsonb;
  v_deleted_unlocks jsonb := '[]'::jsonb;
  v_deleted_provenance jsonb := '[]'::jsonb;
begin
  if not public.auth_is_hq() then
    raise exception 'apply_candidate_merge: HQ role required' using errcode = 'insufficient_privilege';
  end if;
  if v_actor is null then
    raise exception 'apply_candidate_merge: a merge requires an authenticated actor'
      using errcode = 'insufficient_privilege';
  end if;
  if p_primary_candidate_id = p_merged_candidate_id then
    raise exception 'apply_candidate_merge: a candidate cannot be merged into itself'
      using errcode = 'check_violation';
  end if;
  if p_before_snapshot is null or p_before_snapshot = '{}'::jsonb then
    raise exception 'apply_candidate_merge: a merge must carry a before-snapshot to stay reversible'
      using errcode = 'check_violation';
  end if;

  -- Lock both records in a stable order so concurrent reviews cannot create a
  -- merge chain or capture a stale before-state.
  perform 1
    from public.candidate_profiles
   where id in (p_primary_candidate_id, p_merged_candidate_id)
   order by id
   for update;

  select * into v_primary
    from public.candidate_profiles
   where id = p_primary_candidate_id;
  select * into v_merged
    from public.candidate_profiles
   where id = p_merged_candidate_id;

  if v_primary.id is null or v_merged.id is null then
    raise exception 'apply_candidate_merge: both candidate records must exist'
      using errcode = 'no_data_found';
  end if;
  if v_primary.merged_into_candidate_id is not null or v_merged.merged_into_candidate_id is not null then
    raise exception 'apply_candidate_merge: an already-merged candidate cannot be merged again'
      using errcode = 'check_violation';
  end if;

  if p_duplicate_link_id is not null and not exists (
    select 1
      from public.candidate_duplicate_links l
     where l.id = p_duplicate_link_id
       and l.candidate_id_low = least(p_primary_candidate_id, p_merged_candidate_id)
       and l.candidate_id_high = greatest(p_primary_candidate_id, p_merged_candidate_id)
       and l.status in ('suspected', 'confirmed_duplicate')
  ) then
    raise exception 'apply_candidate_merge: duplicate link does not match this candidate pair'
      using errcode = 'check_violation';
  end if;

  -- Two applications for the same job carry separate assessment/interview
  -- histories. Guessing which workflow survives would be data loss, while
  -- leaving one on the archived candidate would split the ATS record. Require
  -- an operator to resolve that collision before applying the candidate merge.
  if exists (
    select 1
      from public.applications a
      join public.applications b on b.job_order_id = a.job_order_id
     where a.candidate_id = p_merged_candidate_id
       and b.candidate_id = p_primary_candidate_id
  ) then
    raise exception 'apply_candidate_merge: both candidates have an application for the same job; resolve the application workflow first'
      using errcode = 'unique_violation';
  end if;

  select to_jsonb(p) into v_primary_preferences
    from public.candidate_preferences p where p.candidate_id = p_primary_candidate_id;
  select to_jsonb(p) into v_merged_preferences
    from public.candidate_preferences p where p.candidate_id = p_merged_candidate_id;
  select to_jsonb(v) into v_primary_visibility
    from public.candidate_search_visibility v where v.candidate_id = p_primary_candidate_id;
  select to_jsonb(v) into v_merged_visibility
    from public.candidate_search_visibility v where v.candidate_id = p_merged_candidate_id;
  select to_jsonb(w) into v_primary_work_authorization
    from public.candidate_work_authorizations w where w.candidate_id = p_primary_candidate_id;
  select to_jsonb(w) into v_merged_work_authorization
    from public.candidate_work_authorizations w where w.candidate_id = p_merged_candidate_id;

  -- Collapse exact bookmark/unlock/provenance duplicates. Their full rows are
  -- kept in the immutable snapshot so a revert can recreate them.
  with deleted as (
    delete from public.saved_jobs s
     where s.candidate_id = p_merged_candidate_id
       and exists (select 1 from public.saved_jobs p where p.candidate_id = p_primary_candidate_id and p.job_id = s.job_id)
    returning to_jsonb(s) as row
  ) select coalesce(jsonb_agg(row), '[]'::jsonb) into v_deleted_saved_jobs from deleted;

  with deleted as (
    delete from public.employer_cv_unlocks u
     where u.candidate_id = p_merged_candidate_id
       and exists (select 1 from public.employer_cv_unlocks p where p.candidate_id = p_primary_candidate_id and p.employer_org_id = u.employer_org_id)
    returning to_jsonb(u) as row
  ) select coalesce(jsonb_agg(row), '[]'::jsonb) into v_deleted_unlocks from deleted;

  with deleted as (
    delete from public.candidate_field_provenance f
     where f.candidate_id = p_merged_candidate_id
       and exists (
         select 1 from public.candidate_field_provenance p
          where p.candidate_id = p_primary_candidate_id
            and p.target_entity = f.target_entity
            and p.target_entity_id is not distinct from f.target_entity_id
            and p.field_path = f.field_path
       )
    returning to_jsonb(f) as row
  ) select coalesce(jsonb_agg(row), '[]'::jsonb) into v_deleted_provenance from deleted;

  -- Capture the exact rows this transaction is about to move. Reversal must
  -- never depend on an RLS-filtered browser snapshot assembled earlier.
  v_reassigned := jsonb_build_object(
    'experiences', coalesce((select jsonb_agg(id) from public.candidate_experiences where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'education', coalesce((select jsonb_agg(id) from public.candidate_education where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(id) from public.candidate_skills where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(id) from public.candidate_certifications where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(id) from public.candidate_languages where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(id) from public.candidate_documents where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(id) from public.candidate_consents where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'savedJobs', coalesce((select jsonb_agg(id) from public.saved_jobs where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'applications', coalesce((select jsonb_agg(id) from public.applications where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(id) from public.candidate_tags where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(id) from public.employer_submissions where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'parseRuns', coalesce((select jsonb_agg(id) from public.resume_parse_runs where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'parseSuggestions', coalesce((select jsonb_agg(id) from public.resume_field_suggestions where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'interviewAssignments', coalesce((select jsonb_agg(id) from public.interview_assignments where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'interviewAttempts', coalesce((select jsonb_agg(id) from public.interview_response_attempts where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'assessmentAssignments', coalesce((select jsonb_agg(id) from public.assessment_assignments where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'searchAccessEvents', coalesce((select jsonb_agg(id) from public.candidate_search_access_events where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'unlockLedger', coalesce((select jsonb_agg(id) from public.employer_cv_unlock_ledger where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'unlocks', coalesce((select jsonb_agg(id) from public.employer_cv_unlocks where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'resultShares', coalesce((select jsonb_agg(id) from public.result_share_grants where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'visibleEvents', coalesce((select jsonb_agg(id) from public.candidate_visible_events where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'cvShares', coalesce((select jsonb_agg(id) from public.cv_share_events where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'provenance', coalesce((select jsonb_agg(id) from public.candidate_field_provenance where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'importRecords', coalesce((select jsonb_agg(id) from public.zoho_candidate_import_records where matched_candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'recruiterNotes', coalesce((select jsonb_agg(id) from public.recruiter_notes where subject_type = 'candidate' and subject_id = p_merged_candidate_id), '[]'::jsonb),
    'externalMappings', coalesce((select jsonb_agg(id) from public.zoho_recruit_external_mappings where local_entity_type = 'candidate_profile' and local_entity_id = p_merged_candidate_id), '[]'::jsonb)
  );

  v_before_snapshot := p_before_snapshot || jsonb_build_object(
    'primary', to_jsonb(v_primary),
    'duplicate', to_jsonb(v_merged),
    'reassigned', v_reassigned,
    'oneToOne', jsonb_build_object(
      'primaryPreferences', v_primary_preferences,
      'duplicatePreferences', v_merged_preferences,
      'primaryVisibility', v_primary_visibility,
      'duplicateVisibility', v_merged_visibility,
      'primaryWorkAuthorization', v_primary_work_authorization,
      'duplicateWorkAuthorization', v_merged_work_authorization
    ),
    'deletedCollisions', jsonb_build_object(
      'savedJobs', v_deleted_saved_jobs,
      'unlocks', v_deleted_unlocks,
      'provenance', v_deleted_provenance
    ),
    'capturedAt', now()
  );

  -- The audit row comes next: the pointer guard below refuses to flag a
  -- candidate merged unless this row already exists.
  insert into public.candidate_merge_events (
    duplicate_link_id, primary_candidate_id, merged_candidate_id,
    status, field_decisions, before_snapshot, performed_by
  ) values (
    p_duplicate_link_id, p_primary_candidate_id, p_merged_candidate_id,
    'merged', coalesce(p_field_decisions, '[]'::jsonb),
    v_before_snapshot,
    v_actor
  )
  returning id into v_event_id;

  -- Winning field values, keyed by column name. A key that is absent leaves the
  -- primary's value untouched.
  update public.candidate_profiles p set
    given_name    = case when v_updates ? 'given_name'    then v_updates->>'given_name'    else p.given_name end,
    middle_name   = case when v_updates ? 'middle_name'   then v_updates->>'middle_name'   else p.middle_name end,
    family_name   = case when v_updates ? 'family_name'   then v_updates->>'family_name'   else p.family_name end,
    contact_email = case when v_updates ? 'contact_email' then v_updates->>'contact_email' else p.contact_email end,
    headline      = case when v_updates ? 'headline'      then v_updates->>'headline'      else p.headline end,
    summary       = case when v_updates ? 'summary'       then v_updates->>'summary'       else p.summary end,
    city          = case when v_updates ? 'city'          then v_updates->>'city'          else p.city end,
    country_code  = case when v_updates ? 'country_code'  then v_updates->>'country_code'  else p.country_code end,
    date_of_birth = case when v_updates ? 'date_of_birth' then (v_updates->>'date_of_birth')::date else p.date_of_birth end,
    availability  = case when v_updates ? 'availability'  then v_updates->>'availability'  else p.availability end
  where p.id = p_primary_candidate_id;

  -- Move the duplicate's history onto the surviving record.
  update public.candidate_experiences set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.candidate_education set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.candidate_skills set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.candidate_certifications set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.candidate_languages set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.candidate_documents set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;

  -- One-to-one records are combined conservatively. Privacy wins for
  -- visibility, while populated preference/work-authorization fields survive.
  if v_merged_preferences is not null then
    if v_primary_preferences is null then
      update public.candidate_preferences set candidate_id = p_primary_candidate_id
       where candidate_id = p_merged_candidate_id;
    else
      update public.candidate_preferences p set
        desired_roles = array(select distinct unnest(p.desired_roles || coalesce((select desired_roles from public.candidate_preferences where candidate_id = p_merged_candidate_id), '{}'))),
        preferred_industries = array(select distinct unnest(p.preferred_industries || coalesce((select preferred_industries from public.candidate_preferences where candidate_id = p_merged_candidate_id), '{}'))),
        preferred_locations = array(select distinct unnest(p.preferred_locations || coalesce((select preferred_locations from public.candidate_preferences where candidate_id = p_merged_candidate_id), '{}'))),
        min_salary = coalesce(p.min_salary, (select min_salary from public.candidate_preferences where candidate_id = p_merged_candidate_id)),
        max_salary = coalesce(p.max_salary, (select max_salary from public.candidate_preferences where candidate_id = p_merged_candidate_id)),
        salary_currency = coalesce(p.salary_currency, (select salary_currency from public.candidate_preferences where candidate_id = p_merged_candidate_id)),
        salary_private = p.salary_private or coalesce((select salary_private from public.candidate_preferences where candidate_id = p_merged_candidate_id), true),
        willing_to_relocate = p.willing_to_relocate or coalesce((select willing_to_relocate from public.candidate_preferences where candidate_id = p_merged_candidate_id), false),
        remote_preference = coalesce(p.remote_preference, (select remote_preference from public.candidate_preferences where candidate_id = p_merged_candidate_id)),
        employment_types = array(select distinct unnest(p.employment_types || coalesce((select employment_types from public.candidate_preferences where candidate_id = p_merged_candidate_id), '{}'))),
        notice_period = coalesce(p.notice_period, (select notice_period from public.candidate_preferences where candidate_id = p_merged_candidate_id)),
        updated_at = now()
       where p.candidate_id = p_primary_candidate_id;
      delete from public.candidate_preferences where candidate_id = p_merged_candidate_id;
    end if;
  end if;

  if v_merged_visibility is not null then
    if v_primary_visibility is null then
      update public.candidate_search_visibility set candidate_id = p_primary_candidate_id
       where candidate_id = p_merged_candidate_id;
    else
      update public.candidate_search_visibility p set
        is_searchable = p.is_searchable and coalesce((select is_searchable from public.candidate_search_visibility where candidate_id = p_merged_candidate_id), false),
        approved_fields = coalesce((
          select array_agg(field_name)
            from unnest(p.approved_fields) field_name
           where field_name = any(coalesce((select approved_fields from public.candidate_search_visibility where candidate_id = p_merged_candidate_id), '{}'))
        ), '{}'),
        updated_at = now()
       where p.candidate_id = p_primary_candidate_id;
      delete from public.candidate_search_visibility where candidate_id = p_merged_candidate_id;
    end if;
  end if;

  if v_merged_work_authorization is not null then
    if v_primary_work_authorization is null then
      update public.candidate_work_authorizations set candidate_id = p_primary_candidate_id
       where candidate_id = p_merged_candidate_id;
    else
      update public.candidate_work_authorizations p set
        work_country_code = case when p.eligibility_status = 'unknown' then coalesce((select work_country_code from public.candidate_work_authorizations where candidate_id = p_merged_candidate_id), p.work_country_code) else p.work_country_code end,
        eligibility_status = case when p.eligibility_status = 'unknown' then coalesce((select eligibility_status from public.candidate_work_authorizations where candidate_id = p_merged_candidate_id), p.eligibility_status) else p.eligibility_status end,
        permit_type = coalesce(p.permit_type, (select permit_type from public.candidate_work_authorizations where candidate_id = p_merged_candidate_id)),
        permit_expires_on = coalesce(p.permit_expires_on, (select permit_expires_on from public.candidate_work_authorizations where candidate_id = p_merged_candidate_id)),
        note = coalesce(p.note, (select note from public.candidate_work_authorizations where candidate_id = p_merged_candidate_id)),
        updated_at = now()
       where p.candidate_id = p_primary_candidate_id;
      delete from public.candidate_work_authorizations where candidate_id = p_merged_candidate_id;
    end if;
  end if;

  update public.candidate_consents set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.saved_jobs set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.applications set candidate_id = p_primary_candidate_id
   where candidate_id = p_merged_candidate_id;
  update public.candidate_tags set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.employer_submissions set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.resume_parse_runs set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.resume_field_suggestions set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  -- Interview ownership is normally immutable. This audited, atomic merge is
  -- the sole exception; disable only that guard while the linked application
  -- and candidate are moved together. The table lock prevents concurrent edits.
  alter table public.interview_assignments disable trigger trg_iva_guard;
  update public.interview_assignments set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  alter table public.interview_assignments enable trigger trg_iva_guard;
  update public.interview_response_attempts set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.assessment_assignments set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.candidate_search_access_events set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.employer_cv_unlock_ledger set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.employer_cv_unlocks set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.result_share_grants set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.candidate_visible_events set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.cv_share_events set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.candidate_field_provenance set candidate_id = p_primary_candidate_id
    where candidate_id = p_merged_candidate_id;
  update public.zoho_candidate_import_records set matched_candidate_id = p_primary_candidate_id
    where matched_candidate_id = p_merged_candidate_id;
  update public.recruiter_notes set subject_id = p_primary_candidate_id
    where subject_type = 'candidate' and subject_id = p_merged_candidate_id;
  update public.zoho_recruit_external_mappings set local_entity_id = p_primary_candidate_id
    where local_entity_type = 'candidate_profile' and local_entity_id = p_merged_candidate_id;

  update public.candidate_profiles
     set merged_into_candidate_id = p_primary_candidate_id,
         merged_at = now(),
         profile_status = 'archived',
         open_to_work = false
   where id = p_merged_candidate_id;

  if p_duplicate_link_id is not null then
    update public.candidate_duplicate_links
       set status = 'merged', reviewed_by = v_actor, reviewed_at = now()
     where id = p_duplicate_link_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value, metadata)
  values (
    v_actor, 'candidate.merge', 'candidate_profile', p_merged_candidate_id,
    v_before_snapshot,
    jsonb_build_object('primaryCandidateId', p_primary_candidate_id, 'profileUpdates', v_updates),
    jsonb_build_object('mergeEventId', v_event_id, 'duplicateLinkId', p_duplicate_link_id)
  );

  return v_event_id;
end $$;

create or replace function public.revert_candidate_merge(
  p_merge_event_id uuid,
  p_profile_restores jsonb,
  p_reason text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_event public.candidate_merge_events;
  v_restores jsonb := coalesce(p_profile_restores, '{}'::jsonb);
  v_reassigned jsonb;
  v_one_to_one jsonb;
  v_deleted jsonb;
begin
  if not public.auth_is_hq() then
    raise exception 'revert_candidate_merge: HQ role required' using errcode = 'insufficient_privilege';
  end if;
  if v_actor is null then
    raise exception 'revert_candidate_merge: a revert requires an authenticated actor'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_event from public.candidate_merge_events where id = p_merge_event_id;
  if not found then
    raise exception 'revert_candidate_merge: merge event % not found', p_merge_event_id
      using errcode = 'no_data_found';
  end if;
  if v_event.status <> 'merged' then
    raise exception 'revert_candidate_merge: merge event % is already reverted', p_merge_event_id
      using errcode = 'check_violation';
  end if;

  -- Release the pointer first; the guard trigger only inspects transitions to a
  -- non-null value, so clearing it is always allowed.
  update public.candidate_profiles
     set merged_into_candidate_id = null,
         merged_at = null,
         profile_status = coalesce(v_event.before_snapshot->'duplicate'->>'profile_status', 'active'),
         open_to_work = coalesce((v_event.before_snapshot->'duplicate'->>'open_to_work')::boolean, true)
   where id = v_event.merged_candidate_id;

  v_reassigned := coalesce(v_event.before_snapshot->'reassigned', '{}'::jsonb);

  update public.candidate_experiences set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'experiences','[]'::jsonb)))::uuid);
  update public.candidate_education set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'education','[]'::jsonb)))::uuid);
  update public.candidate_skills set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'skills','[]'::jsonb)))::uuid);
  update public.candidate_certifications set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'certifications','[]'::jsonb)))::uuid);
  update public.candidate_languages set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'languages','[]'::jsonb)))::uuid);
  update public.candidate_documents set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'documents','[]'::jsonb)))::uuid);
  update public.candidate_consents set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'consents','[]'::jsonb)))::uuid);
  update public.saved_jobs set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'savedJobs','[]'::jsonb)))::uuid);
  update public.applications set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'applications','[]'::jsonb)))::uuid);
  update public.candidate_tags set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'tags','[]'::jsonb)))::uuid);
  update public.employer_submissions set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'submissions','[]'::jsonb)))::uuid);
  update public.resume_parse_runs set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'parseRuns','[]'::jsonb)))::uuid);
  update public.resume_field_suggestions set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'parseSuggestions','[]'::jsonb)))::uuid);
  alter table public.interview_assignments disable trigger trg_iva_guard;
  update public.interview_assignments set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'interviewAssignments','[]'::jsonb)))::uuid);
  alter table public.interview_assignments enable trigger trg_iva_guard;
  update public.interview_response_attempts set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'interviewAttempts','[]'::jsonb)))::uuid);
  update public.assessment_assignments set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'assessmentAssignments','[]'::jsonb)))::uuid);
  update public.candidate_search_access_events set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'searchAccessEvents','[]'::jsonb)))::bigint);
  update public.employer_cv_unlock_ledger set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'unlockLedger','[]'::jsonb)))::uuid);
  update public.employer_cv_unlocks set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'unlocks','[]'::jsonb)))::uuid);
  update public.result_share_grants set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'resultShares','[]'::jsonb)))::uuid);
  update public.candidate_visible_events set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'visibleEvents','[]'::jsonb)))::bigint);
  update public.cv_share_events set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'cvShares','[]'::jsonb)))::uuid);
  update public.candidate_field_provenance set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'provenance','[]'::jsonb)))::uuid);
  update public.zoho_candidate_import_records set matched_candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'importRecords','[]'::jsonb)))::uuid);
  update public.recruiter_notes set subject_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'recruiterNotes','[]'::jsonb)))::uuid);
  update public.zoho_recruit_external_mappings set local_entity_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'externalMappings','[]'::jsonb)))::uuid);

  -- Restore one-to-one rows exactly as they were before the merge.
  v_one_to_one := coalesce(v_event.before_snapshot->'oneToOne', '{}'::jsonb);
  delete from public.candidate_preferences where candidate_id in (v_event.primary_candidate_id, v_event.merged_candidate_id);
  if v_one_to_one->'primaryPreferences' is not null and v_one_to_one->'primaryPreferences' <> 'null'::jsonb then
    insert into public.candidate_preferences select (jsonb_populate_record(null::public.candidate_preferences, v_one_to_one->'primaryPreferences')).*;
  end if;
  if v_one_to_one->'duplicatePreferences' is not null and v_one_to_one->'duplicatePreferences' <> 'null'::jsonb then
    insert into public.candidate_preferences select (jsonb_populate_record(null::public.candidate_preferences, v_one_to_one->'duplicatePreferences')).*;
  end if;

  delete from public.candidate_search_visibility where candidate_id in (v_event.primary_candidate_id, v_event.merged_candidate_id);
  if v_one_to_one->'primaryVisibility' is not null and v_one_to_one->'primaryVisibility' <> 'null'::jsonb then
    insert into public.candidate_search_visibility select (jsonb_populate_record(null::public.candidate_search_visibility, v_one_to_one->'primaryVisibility')).*;
  end if;
  if v_one_to_one->'duplicateVisibility' is not null and v_one_to_one->'duplicateVisibility' <> 'null'::jsonb then
    insert into public.candidate_search_visibility select (jsonb_populate_record(null::public.candidate_search_visibility, v_one_to_one->'duplicateVisibility')).*;
  end if;

  delete from public.candidate_work_authorizations where candidate_id in (v_event.primary_candidate_id, v_event.merged_candidate_id);
  if v_one_to_one->'primaryWorkAuthorization' is not null and v_one_to_one->'primaryWorkAuthorization' <> 'null'::jsonb then
    insert into public.candidate_work_authorizations select (jsonb_populate_record(null::public.candidate_work_authorizations, v_one_to_one->'primaryWorkAuthorization')).*;
  end if;
  if v_one_to_one->'duplicateWorkAuthorization' is not null and v_one_to_one->'duplicateWorkAuthorization' <> 'null'::jsonb then
    insert into public.candidate_work_authorizations select (jsonb_populate_record(null::public.candidate_work_authorizations, v_one_to_one->'duplicateWorkAuthorization')).*;
  end if;

  -- Recreate exact duplicates that were collapsed during apply.
  v_deleted := coalesce(v_event.before_snapshot->'deletedCollisions', '{}'::jsonb);
  insert into public.saved_jobs
    select (jsonb_populate_record(null::public.saved_jobs, row_value)).*
      from jsonb_array_elements(coalesce(v_deleted->'savedJobs', '[]'::jsonb)) row_value;
  insert into public.employer_cv_unlocks
    select (jsonb_populate_record(null::public.employer_cv_unlocks, row_value)).*
      from jsonb_array_elements(coalesce(v_deleted->'unlocks', '[]'::jsonb)) row_value;
  insert into public.candidate_field_provenance
    select (jsonb_populate_record(null::public.candidate_field_provenance, row_value)).*
      from jsonb_array_elements(coalesce(v_deleted->'provenance', '[]'::jsonb)) row_value;

  update public.candidate_profiles p set
    given_name    = case when v_restores ? 'given_name'    then v_restores->>'given_name'    else p.given_name end,
    middle_name   = case when v_restores ? 'middle_name'   then v_restores->>'middle_name'   else p.middle_name end,
    family_name   = case when v_restores ? 'family_name'   then v_restores->>'family_name'   else p.family_name end,
    contact_email = case when v_restores ? 'contact_email' then v_restores->>'contact_email' else p.contact_email end,
    headline      = case when v_restores ? 'headline'      then v_restores->>'headline'      else p.headline end,
    summary       = case when v_restores ? 'summary'       then v_restores->>'summary'       else p.summary end,
    city          = case when v_restores ? 'city'          then v_restores->>'city'          else p.city end,
    country_code  = case when v_restores ? 'country_code'  then v_restores->>'country_code'  else p.country_code end,
    date_of_birth = case when v_restores ? 'date_of_birth' then (v_restores->>'date_of_birth')::date else p.date_of_birth end,
    availability  = case when v_restores ? 'availability'  then v_restores->>'availability'  else p.availability end
  where p.id = v_event.primary_candidate_id;

  update public.candidate_merge_events
     set status = 'reverted', reverted_by = v_actor, reverted_at = now(), revert_reason = p_reason
   where id = p_merge_event_id;

  -- The pair goes back into review rather than being silently forgotten: a
  -- reverted merge means the duplicate question is still open.
  if v_event.duplicate_link_id is not null then
    update public.candidate_duplicate_links
       set status = 'suspected', reviewed_by = null, reviewed_at = null,
           review_note = 'Merge reverted: ' || coalesce(p_reason, 'no reason given')
     where id = v_event.duplicate_link_id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, before_value, after_value, metadata)
  values (
    v_actor, 'candidate.merge_reverted', 'candidate_profile', v_event.merged_candidate_id,
    v_event.before_snapshot,
    jsonb_build_object('profileRestores', v_restores),
    jsonb_build_object('mergeEventId', p_merge_event_id, 'reason', p_reason)
  );

  return true;
end $$;

revoke all on function public.apply_candidate_merge(uuid, uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon;
revoke all on function public.revert_candidate_merge(uuid, jsonb, text) from public, anon;
grant execute on function public.apply_candidate_merge(uuid, uuid, uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.revert_candidate_merge(uuid, jsonb, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
