-- =============================================================================
-- Recruiter candidate directory & sourcing (R-012, R-013, R-051, R-064, R-130)
--
-- - Sourced-application contact states (not_contacted → declined)
-- - Discovery no longer grants full candidate_profiles SELECT (approved fields only)
-- - search_talent_pool / open_discovered_candidate RPCs with access audit
-- - Demo visibility keys aligned with candidate Settings form
-- =============================================================================

-- ---- Applications: sourcing metadata ----------------------------------------
alter table public.applications
  add column if not exists is_direct_application boolean not null default true;

alter table public.applications
  add column if not exists sourced_contacted_at timestamptz;

alter table public.applications
  add column if not exists sourced_contact_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_sourced_contact_status_check'
  ) then
    alter table public.applications
      add constraint applications_sourced_contact_status_check
      check (
        sourced_contact_status is null
        or sourced_contact_status in ('not_contacted', 'contacted', 'interested', 'declined')
      );
  end if;
end $$;

comment on column public.applications.is_direct_application is
  'True when the candidate applied; false when a recruiter sourced them onto a job (R-064).';
comment on column public.applications.sourced_contact_status is
  'Sourcing disposition for recruiter-sourced applications only.';
comment on column public.applications.sourced_contacted_at is
  'When the recruiter first marked the sourced candidate as contacted.';

update public.applications
set is_direct_application = (coalesce(entry_source, 'applied_direct') = 'applied_direct')
where is_direct_application is distinct from (coalesce(entry_source, 'applied_direct') = 'applied_direct');

update public.applications
set
  sourced_contact_status = 'not_contacted',
  is_direct_application = false
where entry_source = 'recruiter_sourced'
  and sourced_contact_status is null;

-- ---- Discovery access audit -------------------------------------------------
create table if not exists public.candidate_search_access_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  candidate_id uuid not null references public.candidate_profiles(id) on delete cascade,
  org_context_id uuid references public.organizations(id) on delete set null,
  access_kind text not null default 'profile_open'
    check (access_kind in ('profile_open', 'list_hit')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cand_search_access_candidate
  on public.candidate_search_access_events (candidate_id, created_at desc);
create index if not exists idx_cand_search_access_actor
  on public.candidate_search_access_events (actor_id, created_at desc);

comment on table public.candidate_search_access_events is
  'Audit log when staff open a discovered (search-visible) candidate profile (R-130).';

alter table public.candidate_search_access_events enable row level security;

drop policy if exists cand_search_access_hq_read on public.candidate_search_access_events;
create policy cand_search_access_hq_read
on public.candidate_search_access_events
for select to authenticated
using (
  public.auth_is_hq()
  or org_context_id in (select public.auth_scoped_org_ids())
);

drop policy if exists cand_search_access_insert on public.candidate_search_access_events;
create policy cand_search_access_insert
on public.candidate_search_access_events
for insert to authenticated
with check (actor_id = auth.uid());

grant select, insert on public.candidate_search_access_events to authenticated;
grant all on public.candidate_search_access_events to service_role;
grant usage, select on sequence public.candidate_search_access_events_id_seq to authenticated, service_role;

-- ---- Tighten Ring-1 reads: discovery ≠ full profile -----------------------
-- Staff may still read full profiles when their org has an application
-- (processing relationship). Searchable-only candidates are reachable only via
-- the projection RPCs below (approved fields).
create or replace function public.auth_can_read_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p_candidate = public.auth_candidate_id()
    or exists (
      select 1 from public.applications a
      where a.candidate_id = p_candidate
        and a.owning_org_id in (select public.auth_scoped_org_ids())
    );
$$;

-- ---- Helpers ----------------------------------------------------------------
create or replace function public.auth_can_search_talent()
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.auth_has_role('recruiter')
    or public.auth_has_role('franchise_admin')
    or public.auth_has_role('operations')
    or public.auth_is_hq();
$$;

create or replace function public.candidate_experience_years(p_candidate uuid)
returns numeric language sql stable security definer set search_path = public as $$
  -- date - date yields integer days in Postgres
  select coalesce(
    round(
      (
        select sum(
          greatest(
            0,
            (coalesce(e.end_date, current_date) - e.start_date)::numeric / 365.25
          )
        )
        from public.candidate_experiences e
        where e.candidate_id = p_candidate
          and e.start_date is not null
      ),
      1
    ),
    0
  );
$$;

create or replace function public.experience_level_matches(
  p_years numeric,
  p_level text
) returns boolean language sql immutable as $$
  select case p_level
    when 'entry' then p_years < 2
    when 'mid' then p_years >= 2 and p_years < 5
    when 'senior' then p_years >= 5 and p_years < 10
    when 'lead' then p_years >= 8 and p_years < 15
    when 'exec' then p_years >= 12
    else true
  end;
$$;

-- ---- Shared projection (approved fields only) -------------------------------
create or replace function public.project_searchable_candidate(p_candidate uuid)
returns table (
  candidate_id uuid,
  given_name text,
  family_name text,
  headline text,
  country_code text,
  city text,
  skills text[],
  education_level text,
  experience_summary text,
  experience_years numeric,
  languages text[],
  availability text,
  desired_roles text[],
  approved_fields text[],
  open_to_work boolean,
  has_own_engagement boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_fields text[];
  v_years numeric;
  v_has_country boolean;
  v_has_skills boolean;
  v_has_edu boolean;
  v_has_exp boolean;
  v_has_lang boolean;
  v_has_avail boolean;
  v_has_roles boolean;
begin
  if not public.auth_can_search_talent() then
    raise exception 'not authorized to search talent pool' using errcode = '42501';
  end if;

  select v.approved_fields into v_fields
  from public.candidate_search_visibility v
  where v.candidate_id = p_candidate and v.is_searchable;

  if v_fields is null then
    return;
  end if;

  v_has_country := 'country_city' = any(v_fields) or 'city' = any(v_fields) or 'country_code' = any(v_fields);
  v_has_skills := 'skills' = any(v_fields);
  v_has_edu := 'education_level' = any(v_fields);
  v_has_exp := 'experience_summary' = any(v_fields) or 'headline' = any(v_fields);
  v_has_lang := 'languages' = any(v_fields);
  v_has_avail := 'availability' = any(v_fields);
  v_has_roles := 'desired_roles' = any(v_fields);

  v_years := public.candidate_experience_years(p_candidate);

  return query
  select
    cp.id,
    cp.given_name,
    cp.family_name,
    cp.headline,
    case when v_has_country then cp.country_code else null end,
    case when v_has_country then cp.city else null end,
    case when v_has_skills then coalesce((
      select array_agg(s.name order by s.name)
      from public.candidate_skills s
      where s.candidate_id = cp.id and s.is_searchable
    ), '{}'::text[]) else '{}'::text[] end,
    case when v_has_edu then (
      select e.qualification
      from public.candidate_education e
      where e.candidate_id = cp.id
      order by coalesce(e.end_date, e.start_date) desc nulls last
      limit 1
    ) else null end,
    case when v_has_exp then left(coalesce(cp.summary, ''), 280) else null end,
    case when v_has_exp then v_years else null end,
    case when v_has_lang then coalesce((
      select array_agg(l.language order by l.language)
      from public.candidate_languages l
      where l.candidate_id = cp.id
    ), '{}'::text[]) else '{}'::text[] end,
    case when v_has_avail then cp.availability else null end,
    case when v_has_roles then coalesce(pref.desired_roles, '{}'::text[]) else '{}'::text[] end,
    v_fields,
    cp.open_to_work,
    exists (
      select 1 from public.applications a
      where a.candidate_id = cp.id
        and a.owning_org_id in (select public.auth_scoped_org_ids())
    )
  from public.candidate_profiles cp
  left join public.candidate_preferences pref on pref.candidate_id = cp.id
  where cp.id = p_candidate
    and cp.profile_status = 'active';
end;
$$;

revoke all on function public.project_searchable_candidate(uuid) from public;
grant execute on function public.project_searchable_candidate(uuid) to authenticated;

-- ---- Talent pool search -----------------------------------------------------
create or replace function public.search_talent_pool(
  p_q text default null,
  p_skill text default null,
  p_country text default null,
  p_city text default null,
  p_availability text default null,
  p_experience_level text default null,
  p_limit int default 50
)
returns table (
  candidate_id uuid,
  given_name text,
  family_name text,
  headline text,
  country_code text,
  city text,
  skills text[],
  education_level text,
  experience_summary text,
  experience_years numeric,
  languages text[],
  availability text,
  desired_roles text[],
  approved_fields text[],
  open_to_work boolean,
  has_own_engagement boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_q text := nullif(trim(coalesce(p_q, '')), '');
  v_skill text := nullif(trim(coalesce(p_skill, '')), '');
  v_country text := nullif(trim(coalesce(p_country, '')), '');
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_avail text := nullif(trim(coalesce(p_availability, '')), '');
  v_level text := nullif(trim(coalesce(p_experience_level, '')), '');
begin
  if not public.auth_can_search_talent() then
    raise exception 'not authorized to search talent pool' using errcode = '42501';
  end if;

  return query
  select p.*
  from public.candidate_search_visibility vis
  join lateral public.project_searchable_candidate(vis.candidate_id) p on true
  where vis.is_searchable
    and (
      v_q is null
      or coalesce(p.given_name, '') ilike '%' || v_q || '%'
      or coalesce(p.family_name, '') ilike '%' || v_q || '%'
      or coalesce(p.headline, '') ilike '%' || v_q || '%'
      or coalesce(p.experience_summary, '') ilike '%' || v_q || '%'
      or exists (
        select 1 from unnest(p.skills) s where s ilike '%' || v_q || '%'
      )
      or exists (
        select 1 from unnest(p.desired_roles) r where r ilike '%' || v_q || '%'
      )
    )
    and (
      v_skill is null
      or exists (select 1 from unnest(p.skills) s where s ilike '%' || v_skill || '%')
    )
    and (v_country is null or p.country_code = v_country)
    and (v_city is null or coalesce(p.city, '') ilike '%' || v_city || '%')
    and (
      v_avail is null
      or coalesce(p.availability, '') ilike '%' || v_avail || '%'
    )
    and (
      v_level is null
      or (
        p.experience_years is not null
        and public.experience_level_matches(p.experience_years, v_level)
      )
    )
  order by p.has_own_engagement desc, p.family_name nulls last, p.given_name nulls last
  limit v_limit;
end;
$$;

revoke all on function public.search_talent_pool(text, text, text, text, text, text, int) from public;
grant execute on function public.search_talent_pool(text, text, text, text, text, text, int) to authenticated;

-- ---- Open discovered profile (audited) --------------------------------------
create or replace function public.open_discovered_candidate(p_candidate uuid)
returns table (
  candidate_id uuid,
  given_name text,
  family_name text,
  headline text,
  country_code text,
  city text,
  skills text[],
  education_level text,
  experience_summary text,
  experience_years numeric,
  languages text[],
  availability text,
  desired_roles text[],
  approved_fields text[],
  open_to_work boolean,
  has_own_engagement boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if not public.auth_can_search_talent() then
    raise exception 'not authorized to open discovered candidate' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.candidate_search_visibility v
    where v.candidate_id = p_candidate and v.is_searchable
  ) then
    raise exception 'candidate is not discoverable' using errcode = '42501';
  end if;

  select m.organization_id into v_org
  from public.memberships m
  where m.user_id = auth.uid()
    and m.status = 'active'
    and m.organization_id is not null
  order by case when m.role = 'recruiter' then 0 else 1 end
  limit 1;

  insert into public.candidate_search_access_events (
    actor_id, candidate_id, org_context_id, access_kind, metadata
  ) values (
    auth.uid(),
    p_candidate,
    v_org,
    'profile_open',
    jsonb_build_object('via', 'open_discovered_candidate')
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, after_value, metadata
  ) values (
    auth.uid(),
    'candidate.search_profile_opened',
    'candidate_profile',
    p_candidate,
    v_org,
    jsonb_build_object('access', 'approved_fields_only'),
    jsonb_build_object('sensitive', true)
  );

  return query select * from public.project_searchable_candidate(p_candidate);
end;
$$;

revoke all on function public.open_discovered_candidate(uuid) from public;
grant execute on function public.open_discovered_candidate(uuid) to authenticated;

-- Align demo opt-in fields with candidate Settings keys so filters work
update public.candidate_search_visibility
set approved_fields = array[
  'desired_roles',
  'country_city',
  'skills',
  'education_level',
  'experience_summary',
  'languages',
  'availability'
]
where is_searchable
  and approved_fields && array['given_name', 'family_name', 'headline', 'city', 'country_code']::text[];

notify pgrst, 'reload schema';
