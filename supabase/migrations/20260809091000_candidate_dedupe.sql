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
  v_skipped_applications uuid[];
  v_primary public.candidate_profiles%rowtype;
  v_merged public.candidate_profiles%rowtype;
  v_reassigned jsonb;
  v_before_snapshot jsonb;
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

  -- Applications are unique per (candidate, job order). When both records
  -- applied to the same job, the duplicate's row stays put rather than being
  -- destroyed. Work this out BEFORE writing the audit row: before_snapshot is
  -- immutable once stored, so everything it must record has to be known now.
  select coalesce(array_agg(a.id), '{}') into v_skipped_applications
    from public.applications a
   where a.candidate_id = p_merged_candidate_id
     and exists (
       select 1 from public.applications b
        where b.candidate_id = p_primary_candidate_id
          and b.job_order_id = a.job_order_id
     );

  -- Capture the exact rows this transaction is about to move. Reversal must
  -- never depend on an RLS-filtered browser snapshot assembled earlier.
  v_reassigned := jsonb_build_object(
    'experiences', coalesce((select jsonb_agg(id) from public.candidate_experiences where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'education', coalesce((select jsonb_agg(id) from public.candidate_education where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(id) from public.candidate_skills where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(id) from public.candidate_certifications where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(id) from public.candidate_languages where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(id) from public.candidate_documents where candidate_id = p_merged_candidate_id), '[]'::jsonb),
    'applications', coalesce((
      select jsonb_agg(id)
        from public.applications
       where candidate_id = p_merged_candidate_id
         and not (id = any(v_skipped_applications))
    ), '[]'::jsonb),
    'externalMappings', '[]'::jsonb
  );

  v_before_snapshot := p_before_snapshot || jsonb_build_object(
    'primary', to_jsonb(v_primary),
    'duplicate', to_jsonb(v_merged),
    'reassigned', v_reassigned,
    'skippedApplicationIds', to_jsonb(v_skipped_applications),
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

  -- Everything except the collisions computed above moves across.
  update public.applications set candidate_id = p_primary_candidate_id
   where candidate_id = p_merged_candidate_id
     and not (id = any(v_skipped_applications));

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
    jsonb_build_object('mergeEventId', v_event_id, 'duplicateLinkId', p_duplicate_link_id,
                       'skippedApplicationIds', to_jsonb(v_skipped_applications))
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
  update public.applications set candidate_id = v_event.merged_candidate_id
   where id in (select (jsonb_array_elements_text(coalesce(v_reassigned->'applications','[]'::jsonb)))::uuid);

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
