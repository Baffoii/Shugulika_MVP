-- Distinct staff notifications for withdraw and reapply (vs generic "updated").
create or replace function public.notify_staff_of_application(
  p_application_id uuid,
  p_event text default 'created'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.applications;
  v_job_title text;
  v_candidate_name text;
  v_title text;
  v_body text;
begin
  select * into v_app
  from public.applications
  where id = p_application_id;

  if v_app.id is null then
    raise exception 'application not found';
  end if;

  if public.auth_candidate_id() is distinct from v_app.candidate_id
     and not public.auth_is_hq()
     and v_app.owning_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'not authorized';
  end if;

  select jo.title into v_job_title
  from public.job_orders jo
  where jo.id = v_app.job_order_id;

  select trim(both from concat_ws(' ', nullif(cp.given_name, ''), nullif(cp.family_name, '')))
  into v_candidate_name
  from public.candidate_profiles cp
  where cp.id = v_app.candidate_id;

  if p_event = 'withdrawn' then
    v_title := 'Application withdrawn';
    v_body := coalesce(nullif(v_candidate_name, ''), 'A candidate')
      || ' withdrew their application'
      || case when v_job_title is not null then ' for ' || v_job_title else '' end
      || '.';
  elsif p_event = 'reapplied' then
    v_title := 'Candidate reapplied';
    v_body := coalesce(nullif(v_candidate_name, ''), 'A candidate')
      || ' reapplied after previously withdrawing'
      || case when v_job_title is not null then ' for ' || v_job_title else '' end
      || '.';
  elsif p_event = 'updated' then
    v_title := 'Application updated';
    v_body := coalesce(nullif(v_candidate_name, ''), 'A candidate')
      || ' updated their application'
      || case when v_job_title is not null then ' for ' || v_job_title else '' end
      || '.';
  else
    v_title := 'New application';
    v_body := coalesce(nullif(v_candidate_name, ''), 'A candidate')
      || ' applied'
      || case when v_job_title is not null then ' for ' || v_job_title else ' for a role' end
      || '.';
  end if;

  return public.notify_organization_staff(
    v_app.owning_org_id,
    'application',
    v_title,
    v_body,
    'application',
    v_app.id
  );
end;
$$;

grant execute on function public.notify_staff_of_application(uuid, text) to authenticated;
