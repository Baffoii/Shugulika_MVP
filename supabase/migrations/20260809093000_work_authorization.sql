-- ATS §9: work-eligibility fields, feature-flagged OFF.
--
-- Tanzania's Employment and Labour Relations Act prohibits employment
-- discrimination on nationality and covers applicants, so this migration draws
-- a hard line:
--
--   * Work AUTHORIZATION — "may this person legally work in country X, and does
--     a permit expire" — is a lawful, job-related question. It lives here.
--   * NATIONALITY / citizenship / national origin is NOT stored, not searchable,
--     not scoreable, and not a KPI dimension. There is deliberately no column
--     for it, and a regression test asserts none appears.
--
-- Everything here is inert until `work_authorization_fields_enabled` is turned
-- on: the RLS policies themselves test the flag, so with the flag off the table
-- reads as empty for every browser role including HQ.

insert into public.feature_flags (key, is_enabled, notes) values
  ('work_authorization_fields_enabled', false,
   'Work-eligibility capture for candidates. OFF until legal review. Never covers nationality or citizenship.')
on conflict (key) do nothing;

-- Local, namespaced flag reader so the policies below do not depend on
-- feature_flags being readable by the calling role.
create or replace function public.ats_feature_flag_enabled(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_enabled from public.feature_flags where key = p_key), false)
$$;

revoke all on function public.ats_feature_flag_enabled(text) from public, anon;
grant execute on function public.ats_feature_flag_enabled(text) to authenticated, service_role;

create table if not exists public.candidate_work_authorizations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique
    references public.candidate_profiles(id) on delete cascade,
  -- The country the eligibility statement is ABOUT (where the work would
  -- happen), never where the candidate is from.
  work_country_code text references public.countries(code),
  eligibility_status text not null default 'unknown'
    check (eligibility_status in (
      'unknown',
      'eligible_without_permit',
      'eligible_with_permit',
      'permit_required',
      'not_eligible'
    )),
  permit_type text,
  permit_expires_on date,
  -- Provenance for the eligibility statement itself.
  source text not null default 'candidate_declared'
    check (source in ('candidate_declared','document_verified','recruiter_entry')),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_work_authorization_verified_actor
    check (source <> 'document_verified' or (verified_at is not null and verified_by is not null))
);

comment on table public.candidate_work_authorizations is
  'Right-to-work status per candidate. Contains no nationality, citizenship, or national-origin field, by design and by legal constraint.';
comment on column public.candidate_work_authorizations.work_country_code is
  'Country the work would be performed in. NOT the candidate country of origin.';

create index if not exists idx_candidate_work_authorizations_expiry
  on public.candidate_work_authorizations(permit_expires_on)
  where permit_expires_on is not null;

drop trigger if exists trg_candidate_work_authorizations_updated
  on public.candidate_work_authorizations;
create trigger trg_candidate_work_authorizations_updated
before update on public.candidate_work_authorizations
for each row execute function public.tg_set_updated_at();

-- ---- RLS: flag-gated, candidate-owned, HQ read ------------------------------

alter table public.candidate_work_authorizations enable row level security;

drop policy if exists candidate_work_authorizations_self_all
  on public.candidate_work_authorizations;
create policy candidate_work_authorizations_self_all
  on public.candidate_work_authorizations for all to authenticated
  using (
    public.ats_feature_flag_enabled('work_authorization_fields_enabled')
    and candidate_id = public.auth_candidate_id()
  )
  with check (
    public.ats_feature_flag_enabled('work_authorization_fields_enabled')
    and candidate_id = public.auth_candidate_id()
  );

drop policy if exists candidate_work_authorizations_hq_read
  on public.candidate_work_authorizations;
create policy candidate_work_authorizations_hq_read
  on public.candidate_work_authorizations for select to authenticated
  using (
    public.ats_feature_flag_enabled('work_authorization_fields_enabled')
    and public.auth_is_hq()
  );

-- Employers get no policy at all. Employer talent search runs on canonical
-- Shugulika records and must never gain a work-eligibility or origin filter.

-- 0002's blanket `grant … on all tables` predates this table. The flag-gated
-- policies above are the real control; this only makes the table reachable.
grant select, insert, update, delete on public.candidate_work_authorizations to authenticated;
grant select, insert, update, delete on public.candidate_work_authorizations to service_role;

notify pgrst, 'reload schema';
