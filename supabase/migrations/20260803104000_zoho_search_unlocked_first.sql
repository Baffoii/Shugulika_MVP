-- Rank unlocked Zoho pool candidates first in Find Candidates search results.

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
    select
      s.*,
      exists (
        select 1 from public.employer_zoho_candidate_unlocks u
        where u.employer_org_id = v_org and u.zoho_candidate_id = s.zoho_candidate_id
      ) as unlocked
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
    f.unlocked as is_unlocked,
    case when f.unlocked then f.given_name else null end as given_name,
    case when f.unlocked then f.family_name else null end as family_name,
    case when f.unlocked then f.full_name else null end as full_name,
    null::uuid as primary_cv_document_id,
    c.total as total_count
  from filtered f
  cross join counted c
  order by f.unlocked desc, f.synced_at desc, f.id
  limit v_limit offset v_offset;
end;
$$;
