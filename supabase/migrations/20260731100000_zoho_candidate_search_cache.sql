-- Experimental Zoho-backed employer CV search cache (D-1 ignored for spike).
-- Zoho Recruit is the upstream candidate source; Supabase stores a searchable index.
-- Employers never SELECT these tables directly — SECURITY DEFINER RPCs project masked/unlocked DTOs.

-- ---- Search cache ------------------------------------------------------------
create table if not exists public.zoho_recruit_candidate_search (
  id uuid primary key default gen_random_uuid(),
  zoho_candidate_id text not null,
  teaser_label text not null,
  full_name text,
  given_name text,
  family_name text,
  email text,
  phone text,
  job_title text,
  employer_or_industry text,
  industry text,
  skills text[] not null default '{}',
  years_experience numeric,
  qualification text,
  city text,
  country text,
  country_code text,
  candidate_status text,
  availability text,
  has_resume boolean not null default false,
  zoho_attachment_id text,
  search_eligible boolean not null default false,
  consent_or_visibility text,
  zoho_created_at timestamptz,
  zoho_modified_at timestamptz,
  synced_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_zoho_recruit_candidate_search_zoho_id unique (zoho_candidate_id)
);

create index if not exists idx_zoho_cand_search_active_eligible
  on public.zoho_recruit_candidate_search (is_active, search_eligible)
  where is_active and search_eligible;

create index if not exists idx_zoho_cand_search_country
  on public.zoho_recruit_candidate_search (country_code)
  where is_active and search_eligible;

create index if not exists idx_zoho_cand_search_skills
  on public.zoho_recruit_candidate_search using gin (skills);

drop trigger if exists trg_zoho_recruit_candidate_search_updated
  on public.zoho_recruit_candidate_search;
create trigger trg_zoho_recruit_candidate_search_updated
before update on public.zoho_recruit_candidate_search
for each row execute function public.tg_set_updated_at();

-- ---- Sync runs / lock --------------------------------------------------------
create table if not exists public.zoho_recruit_candidate_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references public.zoho_recruit_connections(id) on delete set null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  pages_fetched int not null default 0,
  candidates_seen int not null default 0,
  candidates_upserted int not null default 0,
  candidates_inactivated int not null default 0,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_zoho_cand_sync_runs_started
  on public.zoho_recruit_candidate_sync_runs (started_at desc);

-- Single-row advisory lock table to prevent concurrent sync corruption.
create table if not exists public.zoho_recruit_candidate_sync_lock (
  lock_key text primary key default 'primary',
  run_id uuid references public.zoho_recruit_candidate_sync_runs(id) on delete set null,
  locked_at timestamptz,
  locked_by text
);

insert into public.zoho_recruit_candidate_sync_lock (lock_key)
values ('primary')
on conflict (lock_key) do nothing;

-- ---- Zoho unlock bridge (same wallet, no candidate_profiles FK) --------------
alter table public.employer_cv_unlock_ledger
  add column if not exists zoho_candidate_id text;

create table if not exists public.employer_zoho_candidate_unlocks (
  id uuid primary key default gen_random_uuid(),
  employer_org_id uuid not null references public.organizations(id) on delete cascade,
  zoho_candidate_id text not null,
  search_row_id uuid references public.zoho_recruit_candidate_search(id) on delete set null,
  job_order_id uuid references public.job_orders(id) on delete set null,
  ledger_entry_id uuid references public.employer_cv_unlock_ledger(id) on delete set null,
  unlocked_at timestamptz not null default now(),
  unique (employer_org_id, zoho_candidate_id)
);

create index if not exists idx_employer_zoho_unlocks_org
  on public.employer_zoho_candidate_unlocks (employer_org_id);

alter table public.candidate_search_access_events
  drop constraint if exists candidate_search_access_events_access_kind_check;

alter table public.candidate_search_access_events
  add constraint candidate_search_access_events_access_kind_check
  check (access_kind in (
    'profile_open',
    'list_hit',
    'employer_pool_search',
    'employer_pool_open',
    'employer_zoho_pool_search',
    'employer_zoho_pool_open'
  ));

-- ---- RLS / grants ------------------------------------------------------------
alter table public.zoho_recruit_candidate_search enable row level security;
alter table public.zoho_recruit_candidate_sync_runs enable row level security;
alter table public.zoho_recruit_candidate_sync_lock enable row level security;
alter table public.employer_zoho_candidate_unlocks enable row level security;

revoke all on table public.zoho_recruit_candidate_search from public, anon, authenticated;
revoke all on table public.zoho_recruit_candidate_sync_runs from public, anon, authenticated;
revoke all on table public.zoho_recruit_candidate_sync_lock from public, anon, authenticated;
revoke all on table public.employer_zoho_candidate_unlocks from public, anon, authenticated;

grant select, insert, update, delete on table public.zoho_recruit_candidate_search to service_role;
grant select, insert, update, delete on table public.zoho_recruit_candidate_sync_runs to service_role;
grant select, insert, update, delete on table public.zoho_recruit_candidate_sync_lock to service_role;
grant select, insert, update, delete on table public.employer_zoho_candidate_unlocks to service_role;

-- Employers may see their own Zoho unlock rows (no PII).
grant select on table public.employer_zoho_candidate_unlocks to authenticated;
drop policy if exists employer_zoho_unlocks_read on public.employer_zoho_candidate_unlocks;
create policy employer_zoho_unlocks_read on public.employer_zoho_candidate_unlocks
  for select to authenticated
  using (
    employer_org_id in (
      select m.organization_id
      from public.memberships m
      where m.user_id = auth.uid()
        and m.role = 'employer_user'
        and m.status = 'active'
    )
  );

-- ---- Spend unlock for Zoho candidate ----------------------------------------
create or replace function public.spend_zoho_cv_unlock(
  p_zoho_candidate_id text,
  p_job_order_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_balance int;
  v_ledger uuid;
  v_existing uuid;
  v_search_id uuid;
  v_zoho_id text;
begin
  v_zoho_id := nullif(btrim(p_zoho_candidate_id), '');
  if v_zoho_id is null or char_length(v_zoho_id) > 100 then
    raise exception 'Invalid candidate reference';
  end if;

  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account';
  end if;

  if not public.employer_has_active_subscription(v_org) then
    raise exception 'Your plan or trial is not active';
  end if;

  if p_job_order_id is not null
     and not public.employer_owns_path_a_job(v_org, p_job_order_id) then
    raise exception 'Select one of your Direct (Path A) job orders';
  end if;

  select id into v_search_id
  from public.zoho_recruit_candidate_search
  where zoho_candidate_id = v_zoho_id
    and is_active
    and search_eligible;
  if v_search_id is null then
    raise exception 'Candidate is not available in the searchable pool';
  end if;

  select id into v_existing
  from public.employer_zoho_candidate_unlocks
  where employer_org_id = v_org and zoho_candidate_id = v_zoho_id;
  if found then
    return jsonb_build_object('already_unlocked', true, 'unlock_id', v_existing);
  end if;

  perform public.ensure_cv_unlock_balance(v_org);

  update public.employer_cv_unlock_balances
    set balance = balance - 1, updated_at = now()
  where employer_org_id = v_org and balance >= 1
  returning balance into v_balance;

  if v_balance is null then
    raise exception 'No CV unlocks remaining. Buy more unlocks from Billing.';
  end if;

  insert into public.employer_cv_unlock_ledger
    (employer_org_id, entry_type, amount, balance_after, reason, zoho_candidate_id, actor_user_id)
  values
    (v_org, 'spend', -1, v_balance, 'zoho_cv_unlock', v_zoho_id, auth.uid())
  returning id into v_ledger;

  insert into public.employer_zoho_candidate_unlocks
    (employer_org_id, zoho_candidate_id, search_row_id, job_order_id, ledger_entry_id)
  values
    (v_org, v_zoho_id, v_search_id, p_job_order_id, v_ledger)
  returning id into v_existing;

  return jsonb_build_object(
    'already_unlocked', false,
    'unlock_id', v_existing,
    'cv_unlock_balance', v_balance
  );
end;
$$;

revoke all on function public.spend_zoho_cv_unlock(text, uuid) from public;
grant execute on function public.spend_zoho_cv_unlock(text, uuid) to authenticated;

-- ---- Search / open projections ----------------------------------------------
create or replace function public.search_zoho_employer_talent_pool(
  p_job_order_id uuid,
  p_q text default null,
  p_skill text default null,
  p_country text default null,
  p_city text default null,
  p_availability text default null,
  p_experience_level text default null,
  p_industry text default null,
  p_qualification text default null,
  p_role text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  candidate_id uuid,
  zoho_candidate_id text,
  teaser_label text,
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
  industry text,
  has_resume boolean,
  approved_fields text[],
  open_to_work boolean,
  is_unlocked boolean,
  given_name text,
  family_name text,
  full_name text,
  primary_cv_document_id uuid,
  total_count bigint
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_limit int;
  v_offset int;
  v_q text;
  v_skill text;
  v_country text;
  v_city text;
  v_avail text;
  v_exp text;
  v_industry text;
  v_qual text;
  v_role text;
  v_min_years numeric;
  v_max_years numeric;
begin
  v_org := public.employer_org_for_caller();
  if v_org is null or not public.employer_has_active_subscription(v_org) then
    raise exception 'not authorized to search talent pool' using errcode = '42501';
  end if;

  if p_job_order_id is null or not public.employer_owns_path_a_job(v_org, p_job_order_id) then
    raise exception 'Select one of your Direct (Path A) job orders to search the pool';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_q := nullif(btrim(coalesce(p_q, '')), '');
  v_skill := nullif(btrim(coalesce(p_skill, '')), '');
  v_country := nullif(btrim(coalesce(p_country, '')), '');
  v_city := nullif(btrim(coalesce(p_city, '')), '');
  v_avail := nullif(btrim(coalesce(p_availability, '')), '');
  v_exp := nullif(btrim(coalesce(p_experience_level, '')), '');
  v_industry := nullif(btrim(coalesce(p_industry, '')), '');
  v_qual := nullif(btrim(coalesce(p_qualification, '')), '');
  v_role := nullif(btrim(coalesce(p_role, '')), '');

  if v_exp = 'entry' then v_min_years := 0; v_max_years := 2;
  elsif v_exp = 'mid' then v_min_years := 2; v_max_years := 5;
  elsif v_exp = 'senior' then v_min_years := 5; v_max_years := 10;
  elsif v_exp = 'lead' then v_min_years := 8; v_max_years := 15;
  elsif v_exp = 'exec' then v_min_years := 12; v_max_years := null;
  else v_min_years := null; v_max_years := null;
  end if;

  insert into public.candidate_search_access_events
    (actor_id, candidate_id, org_context_id, access_kind, metadata)
  values (
    auth.uid(),
    null,
    v_org,
    'employer_zoho_pool_search',
    jsonb_build_object(
      'job_order_id', p_job_order_id,
      'q', v_q, 'skill', v_skill, 'country', v_country, 'city', v_city,
      'availability', v_avail, 'experience_level', v_exp,
      'industry', v_industry, 'qualification', v_qual, 'role', v_role,
      'limit', v_limit, 'offset', v_offset, 'source', 'zoho_recruit'
    )
  );

  return query
  with filtered as (
    select s.*
    from public.zoho_recruit_candidate_search s
    where s.is_active
      and s.search_eligible
      and (v_q is null or (
        coalesce(s.job_title, '') ilike '%' || v_q || '%'
        or coalesce(s.qualification, '') ilike '%' || v_q || '%'
        or coalesce(s.employer_or_industry, '') ilike '%' || v_q || '%'
        or coalesce(s.industry, '') ilike '%' || v_q || '%'
        or coalesce(s.city, '') ilike '%' || v_q || '%'
        or exists (
          select 1 from unnest(s.skills) sk
          where sk ilike '%' || v_q || '%'
        )
      ))
      and (v_skill is null or exists (
        select 1 from unnest(s.skills) sk where sk ilike '%' || v_skill || '%'
      ))
      and (v_country is null or (
        s.country_code ilike v_country or coalesce(s.country, '') ilike '%' || v_country || '%'
      ))
      and (v_city is null or coalesce(s.city, '') ilike '%' || v_city || '%')
      and (v_avail is null or coalesce(s.availability, '') ilike '%' || v_avail || '%')
      and (v_industry is null or (
        coalesce(s.industry, '') ilike '%' || v_industry || '%'
        or coalesce(s.employer_or_industry, '') ilike '%' || v_industry || '%'
      ))
      and (v_qual is null or coalesce(s.qualification, '') ilike '%' || v_qual || '%')
      and (v_role is null or coalesce(s.job_title, '') ilike '%' || v_role || '%')
      and (v_min_years is null or (s.years_experience is not null and s.years_experience >= v_min_years))
      and (v_max_years is null or (s.years_experience is not null and s.years_experience < v_max_years))
  ),
  counted as (
    select count(*)::bigint as total from filtered
  )
  select
    f.id as candidate_id,
    f.zoho_candidate_id,
    f.teaser_label,
    f.job_title as headline,
    f.country_code,
    f.city,
    f.skills,
    f.qualification as education_level,
    case when f.years_experience is not null
      then f.years_experience::text || ' years'
      else null
    end as experience_summary,
    f.years_experience as experience_years,
    '{}'::text[] as languages,
    f.availability,
    case when f.job_title is not null then array[f.job_title] else '{}'::text[] end as desired_roles,
    coalesce(f.industry, f.employer_or_industry) as industry,
    f.has_resume,
    array['headline','skills','location','experience','education','availability']::text[] as approved_fields,
    true as open_to_work,
    exists (
      select 1 from public.employer_zoho_candidate_unlocks u
      where u.employer_org_id = v_org and u.zoho_candidate_id = f.zoho_candidate_id
    ) as is_unlocked,
    case when exists (
      select 1 from public.employer_zoho_candidate_unlocks u
      where u.employer_org_id = v_org and u.zoho_candidate_id = f.zoho_candidate_id
    ) then f.given_name else null end as given_name,
    case when exists (
      select 1 from public.employer_zoho_candidate_unlocks u
      where u.employer_org_id = v_org and u.zoho_candidate_id = f.zoho_candidate_id
    ) then f.family_name else null end as family_name,
    case when exists (
      select 1 from public.employer_zoho_candidate_unlocks u
      where u.employer_org_id = v_org and u.zoho_candidate_id = f.zoho_candidate_id
    ) then f.full_name else null end as full_name,
    null::uuid as primary_cv_document_id,
    c.total as total_count
  from filtered f
  cross join counted c
  order by f.synced_at desc, f.id
  limit v_limit offset v_offset;
end;
$$;

create or replace function public.open_zoho_employer_pool_candidate(
  p_candidate_id uuid,
  p_job_order_id uuid
)
returns table (
  candidate_id uuid,
  zoho_candidate_id text,
  teaser_label text,
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
  industry text,
  has_resume boolean,
  approved_fields text[],
  open_to_work boolean,
  is_unlocked boolean,
  given_name text,
  family_name text,
  full_name text,
  primary_cv_document_id uuid,
  total_count bigint
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  v_org := public.employer_org_for_caller();
  if v_org is null or not public.employer_has_active_subscription(v_org) then
    raise exception 'not authorized to open candidate' using errcode = '42501';
  end if;

  if p_job_order_id is null or not public.employer_owns_path_a_job(v_org, p_job_order_id) then
    raise exception 'Select one of your Direct (Path A) job orders';
  end if;

  insert into public.candidate_search_access_events
    (actor_id, candidate_id, org_context_id, access_kind, metadata)
  values (
    auth.uid(),
    null,
    v_org,
    'employer_zoho_pool_open',
    jsonb_build_object(
      'job_order_id', p_job_order_id,
      'search_row_id', p_candidate_id,
      'source', 'zoho_recruit'
    )
  );

  return query
  select
    s.id as candidate_id,
    s.zoho_candidate_id,
    s.teaser_label,
    s.job_title as headline,
    s.country_code,
    s.city,
    s.skills,
    s.qualification as education_level,
    case when s.years_experience is not null
      then s.years_experience::text || ' years'
      else null
    end as experience_summary,
    s.years_experience as experience_years,
    '{}'::text[] as languages,
    s.availability,
    case when s.job_title is not null then array[s.job_title] else '{}'::text[] end as desired_roles,
    coalesce(s.industry, s.employer_or_industry) as industry,
    s.has_resume,
    array['headline','skills','location','experience','education','availability']::text[] as approved_fields,
    true as open_to_work,
    exists (
      select 1 from public.employer_zoho_candidate_unlocks u
      where u.employer_org_id = v_org and u.zoho_candidate_id = s.zoho_candidate_id
    ) as is_unlocked,
    case when exists (
      select 1 from public.employer_zoho_candidate_unlocks u
      where u.employer_org_id = v_org and u.zoho_candidate_id = s.zoho_candidate_id
    ) then s.given_name else null end as given_name,
    case when exists (
      select 1 from public.employer_zoho_candidate_unlocks u
      where u.employer_org_id = v_org and u.zoho_candidate_id = s.zoho_candidate_id
    ) then s.family_name else null end as family_name,
    case when exists (
      select 1 from public.employer_zoho_candidate_unlocks u
      where u.employer_org_id = v_org and u.zoho_candidate_id = s.zoho_candidate_id
    ) then s.full_name else null end as full_name,
    null::uuid as primary_cv_document_id,
    1::bigint as total_count
  from public.zoho_recruit_candidate_search s
  where s.id = p_candidate_id
    and s.is_active
    and s.search_eligible;
end;
$$;

revoke all on function public.search_zoho_employer_talent_pool(
  uuid, text, text, text, text, text, text, text, text, text, int, int
) from public;
revoke all on function public.open_zoho_employer_pool_candidate(uuid, uuid) from public;
grant execute on function public.search_zoho_employer_talent_pool(
  uuid, text, text, text, text, text, text, text, text, text, int, int
) to authenticated;
grant execute on function public.open_zoho_employer_pool_candidate(uuid, uuid) to authenticated;
