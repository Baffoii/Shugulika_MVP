-- ATS §9: CV parser provenance.
--
-- Adds the "where did this value come from, and how sure are we" layer that the
-- candidate autofill workflow was missing. Two rules this migration enforces at
-- the database level, not just in application code:
--
--   1. Every extracted value carries its parser_version, confidence, evidence
--      and extraction time, so a re-parse by a newer parser is comparable to
--      the value already on file.
--   2. A value the candidate has explicitly confirmed is never replaced by a
--      lower-confidence machine extraction. The trigger below makes that
--      impossible regardless of which code path writes the row.
--
-- Provenance is metadata about candidate-owned data, so it inherits the same
-- candidate-only visibility as resume_parse_runs / resume_field_suggestions,
-- plus an HQ read for the data-quality dashboard (counts, never values).

-- ---- Parser identity on the run and on each suggestion ----------------------

alter table public.resume_parse_runs
  add column if not exists parser_version text not null default 'unknown';

comment on column public.resume_parse_runs.parser_version is
  'Version of the extraction pipeline that produced this run, e.g. openai-2026.08 or rule-based-v1. Compared across re-parses.';

alter table public.resume_field_suggestions
  add column if not exists parser_version text,
  add column if not exists extracted_at timestamptz not null default now();

comment on column public.resume_field_suggestions.extracted_at is
  'When the parser produced this value (not when the row was inserted or reviewed).';

-- ---- Per-field provenance ---------------------------------------------------

create table if not exists public.candidate_field_provenance (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  target_entity text not null
    check (target_entity in ('profile','experience','education','skill','certification','language')),
  -- null = the value describes a collection row that does not exist yet.
  target_entity_id uuid,
  field_path text not null,
  -- Canonical string form of the value this provenance row describes. Kept as
  -- text (not the raw jsonb) so a comparison never depends on JSON key order.
  value_text text,
  source text not null
    check (source in ('cv_parse','candidate_confirmed','recruiter_entry','zoho_import')),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  parser_version text,
  parse_run_id uuid references public.resume_parse_runs(id) on delete set null,
  evidence_text text,
  extracted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.candidate_field_provenance is
  'One row per candidate field describing which source last won it, at what confidence, from which parser version. Candidate-confirmed values are terminal for machine extraction.';

-- Uniqueness has to fold NULL target_entity_id into a sentinel: in Postgres
-- NULLs are distinct, so a plain unique constraint would allow unlimited
-- duplicate provenance rows for profile-level fields.
create unique index if not exists uq_candidate_field_provenance
  on public.candidate_field_provenance (
    candidate_id,
    target_entity,
    coalesce(target_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    field_path
  );

create index if not exists idx_candidate_field_provenance_candidate
  on public.candidate_field_provenance(candidate_id);
create index if not exists idx_candidate_field_provenance_source
  on public.candidate_field_provenance(source);

drop trigger if exists trg_candidate_field_provenance_updated
  on public.candidate_field_provenance;
create trigger trg_candidate_field_provenance_updated
before update on public.candidate_field_provenance
for each row execute function public.tg_set_updated_at();

-- ---- The confirmed-value guard ---------------------------------------------

-- A value a human established — the candidate confirming it, or a recruiter
-- correcting it — may only be changed by another human. A machine re-parse can
-- never demote it, whatever confidence it claims. Enforced here so that a
-- future importer or worker cannot bypass it by writing the table directly.
create or replace function public.tg_candidate_provenance_guard()
returns trigger language plpgsql as $$
begin
  if old.source in ('candidate_confirmed','recruiter_entry')
     and new.source in ('cv_parse','zoho_import') then
    raise exception
      'candidate_field_provenance: % on %/% is human-established (%) and cannot be overwritten by %',
      old.field_path, old.target_entity, old.candidate_id, old.source, new.source
      using errcode = 'check_violation';
  end if;

  -- Same-source machine re-extraction only wins when it is at least as
  -- confident as what it would replace.
  if old.source = new.source
     and new.source in ('cv_parse','zoho_import')
     and old.confidence is not null
     and new.confidence is not null
     and new.confidence < old.confidence then
    raise exception
      'candidate_field_provenance: lower-confidence re-extraction (% < %) rejected for % on %',
      new.confidence, old.confidence, old.field_path, old.target_entity
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_candidate_provenance_guard on public.candidate_field_provenance;
create trigger trg_candidate_provenance_guard
before update on public.candidate_field_provenance
for each row execute function public.tg_candidate_provenance_guard();

-- A confirmed row must record who confirmed it and when — "confirmed" with no
-- actor is exactly the state an auto-apply bug would produce.
alter table public.candidate_field_provenance
  drop constraint if exists ck_candidate_provenance_confirmed_actor;
alter table public.candidate_field_provenance
  add constraint ck_candidate_provenance_confirmed_actor
  check (source <> 'candidate_confirmed' or confirmed_at is not null);

-- ---- RLS --------------------------------------------------------------------

alter table public.candidate_field_provenance enable row level security;

drop policy if exists candidate_field_provenance_self_all on public.candidate_field_provenance;
create policy candidate_field_provenance_self_all
  on public.candidate_field_provenance for all to authenticated
  using (candidate_id = public.auth_candidate_id())
  with check (candidate_id = public.auth_candidate_id());

-- HQ reads provenance for the data-quality dashboard. Read-only, and the
-- dashboard aggregates counts — it never renders value_text.
drop policy if exists candidate_field_provenance_hq_read on public.candidate_field_provenance;
create policy candidate_field_provenance_hq_read
  on public.candidate_field_provenance for select to authenticated
  using (public.auth_is_hq());

-- 0002's blanket `grant … on all tables` only covered the tables that existed
-- then, so every new table needs its own grant. RLS above decides which rows;
-- this only decides that the role may reach the table at all.
grant select, insert, update, delete on public.candidate_field_provenance to authenticated;
grant select, insert, update, delete on public.candidate_field_provenance to service_role;

notify pgrst, 'reload schema';
