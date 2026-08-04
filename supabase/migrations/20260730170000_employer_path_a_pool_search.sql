-- Employer Path A anonymized talent-pool search + unlock-aware open.
-- Reuses employer_cv_unlocks for reveal. Recruiters keep search_talent_pool (named).

alter table public.candidate_search_access_events
  drop constraint if exists candidate_search_access_events_access_kind_check;

alter table public.candidate_search_access_events
  add constraint candidate_search_access_events_access_kind_check
  check (access_kind in ('profile_open', 'list_hit', 'employer_pool_search', 'employer_pool_open'));

-- Pool search audits may not target a single candidate.
alter table public.candidate_search_access_events
  alter column candidate_id drop not null;

create or replace function public.employer_has_active_subscription(p_employer_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employer_subscriptions s
    where s.employer_org_id = p_employer_org
      and s.status in ('trial', 'active')
      and (s.expires_on is null or s.expires_on >= current_date)
      and (not s.is_trial or s.trial_ends_on is null or s.trial_ends_on >= current_date)
  );
$$;

create or replace function public.employer_owns_path_a_job(p_employer_org uuid, p_job_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.job_orders j
    where j.id = p_job_order
      and j.employer_org_id = p_employer_org
      and j.recruitment_path = 'A'
      and j.status in ('submitted', 'approved', 'active', 'on_hold', 'partially_filled')
  );
$$;

create or replace function public.project_employer_pool_candidate(
  p_candidate uuid,
  p_employer_org uuid
)
returns table (
  candidate_id uuid,
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
  approved_fields text[],
  open_to_work boolean,
  is_unlocked boolean,
  given_name text,
  family_name text,
  full_name text,
  primary_cv_document_id uuid
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
  v_unlocked boolean;
begin
  select v.approved_fields into v_fields
  from public.candidate_search_visibility v
  where v.candidate_id = p_candidate and v.is_searchable;

  if v_fields is null then
    return;
  end if;

  v_unlocked := exists (
    select 1 from public.employer_cv_unlocks u
    where u.employer_org_id = p_employer_org and u.candidate_id = p_candidate
  );

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
    case
      when v_unlocked then
        coalesce(
          nullif(trim(concat_ws(' ', cp.given_name, cp.family_name)), ''),
          nullif(trim(cp.headline), ''),
          'Candidate ' || left(replace(cp.id::text, '-', ''), 8)
        )
      else
        coalesce(
          nullif(trim(cp.headline), ''),
          'Candidate ' || left(replace(cp.id::text, '-', ''), 8)
        )
    end,
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
    v_unlocked,
    case when v_unlocked then cp.given_name else null end,
    case when v_unlocked then cp.family_name else null end,
    case when v_unlocked then nullif(trim(concat_ws(' ', cp.given_name, cp.family_name)), '') else null end,
    case when v_unlocked then (
      select d.id
      from public.candidate_documents d
      where d.candidate_id = cp.id
        and d.doc_type = 'cv'
        and d.status = 'active'
      order by d.is_primary desc, d.created_at desc
      limit 1
    ) else null end
  from public.candidate_profiles cp
  left join public.candidate_preferences pref on pref.candidate_id = cp.id
  where cp.id = p_candidate
    and cp.profile_status = 'active';
end;
$$;

create or replace function public.search_employer_talent_pool(
  p_job_order_id uuid,
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
  approved_fields text[],
  open_to_work boolean,
  is_unlocked boolean,
  given_name text,
  family_name text,
  full_name text,
  primary_cv_document_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_q text := nullif(trim(coalesce(p_q, '')), '');
  v_skill text := nullif(trim(coalesce(p_skill, '')), '');
  v_country text := nullif(trim(coalesce(p_country, '')), '');
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_avail text := nullif(trim(coalesce(p_availability, '')), '');
  v_level text := nullif(trim(coalesce(p_experience_level, '')), '');
begin
  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account' using errcode = '42501';
  end if;
  if not public.employer_has_active_subscription(v_org) then
    raise exception 'Choose a plan or start a free trial before searching candidates';
  end if;
  if p_job_order_id is null or not public.employer_owns_path_a_job(v_org, p_job_order_id) then
    raise exception 'Select one of your Direct (Path A) job orders to search the pool';
  end if;

  insert into public.candidate_search_access_events (
    actor_id, candidate_id, org_context_id, access_kind, metadata
  ) values (
    auth.uid(), null, v_org, 'employer_pool_search',
    jsonb_build_object('job_order_id', p_job_order_id, 'q', v_q)
  );

  return query
  select p.*
  from public.candidate_search_visibility vis
  join lateral public.project_employer_pool_candidate(vis.candidate_id, v_org) p on true
  where vis.is_searchable
    and (
      v_q is null
      or coalesce(p.headline, '') ilike '%' || v_q || '%'
      or coalesce(p.experience_summary, '') ilike '%' || v_q || '%'
      or coalesce(p.teaser_label, '') ilike '%' || v_q || '%'
      or exists (select 1 from unnest(p.skills) s where s ilike '%' || v_q || '%')
      or exists (select 1 from unnest(p.desired_roles) r where r ilike '%' || v_q || '%')
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
  order by p.is_unlocked desc, p.headline nulls last
  limit v_limit;
end;
$$;

create or replace function public.open_employer_pool_candidate(
  p_candidate_id uuid,
  p_job_order_id uuid
)
returns table (
  candidate_id uuid,
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
  approved_fields text[],
  open_to_work boolean,
  is_unlocked boolean,
  given_name text,
  family_name text,
  full_name text,
  primary_cv_document_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  v_org := public.employer_org_for_caller();
  if v_org is null then
    raise exception 'No approved employer organization for this account' using errcode = '42501';
  end if;
  if not public.employer_has_active_subscription(v_org) then
    raise exception 'Choose a plan or start a free trial before viewing candidates';
  end if;
  if p_job_order_id is null or not public.employer_owns_path_a_job(v_org, p_job_order_id) then
    raise exception 'Select one of your Direct (Path A) job orders';
  end if;
  if not exists (
    select 1 from public.candidate_search_visibility v
    where v.candidate_id = p_candidate_id and v.is_searchable
  ) then
    raise exception 'Candidate is not available in the searchable pool';
  end if;

  insert into public.candidate_search_access_events (
    actor_id, candidate_id, org_context_id, access_kind, metadata
  ) values (
    auth.uid(), p_candidate_id, v_org, 'employer_pool_open',
    jsonb_build_object('job_order_id', p_job_order_id)
  );

  return query
  select * from public.project_employer_pool_candidate(p_candidate_id, v_org);
end;
$$;

revoke all on function public.employer_has_active_subscription(uuid) from public;
revoke all on function public.employer_owns_path_a_job(uuid, uuid) from public;
revoke all on function public.project_employer_pool_candidate(uuid, uuid) from public;
revoke all on function public.search_employer_talent_pool(uuid, text, text, text, text, text, text, int) from public;
revoke all on function public.open_employer_pool_candidate(uuid, uuid) from public;

grant execute on function public.search_employer_talent_pool(uuid, text, text, text, text, text, text, int) to authenticated;
grant execute on function public.open_employer_pool_candidate(uuid, uuid) to authenticated;
