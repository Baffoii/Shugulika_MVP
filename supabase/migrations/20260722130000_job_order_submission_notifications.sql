-- Notify franchise staff and HQ admins when an employer submits a job order.

create or replace function public.notify_hq_admins(
  p_category text,
  p_title text,
  p_body text,
  p_subject_type text default null,
  p_subject_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  select distinct m.user_id, p_category, p_title, p_body, p_subject_type, p_subject_id
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where o.org_type = 'hq'
    and m.status = 'active'
    and m.role = 'hq_admin';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_hq_admins(text, text, text, text, uuid) from public;

create or replace function public.notify_staff_of_job_order_submission(p_job_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_employer_name text;
  v_body text;
  v_count int := 0;
begin
  select * into v_order
  from public.job_orders
  where id = p_job_order_id;

  if not found then
    return 0;
  end if;

  select o.name into v_employer_name
  from public.organizations o
  where o.id = v_order.employer_org_id;

  v_body := coalesce(nullif(v_employer_name, ''), 'An employer')
    || ' submitted "'
    || v_order.title
    || '" for approval.';

  v_count := v_count + public.notify_organization_staff(
    v_order.responsible_org_id,
    'job_order',
    'New job order submitted',
    v_body,
    'job_order',
    v_order.id
  );

  v_count := v_count + public.notify_hq_admins(
    'job_order',
    'New job order submitted',
    v_body,
    'job_order',
    v_order.id
  );

  return v_count;
end;
$$;

revoke all on function public.notify_staff_of_job_order_submission(uuid) from public;

create or replace function public.audit_submitted_job_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'submitted' then
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
    ) values (
      auth.uid(),
      'job_order.submitted',
      'job_order',
      new.id,
      new.responsible_org_id,
      null,
      jsonb_build_object('status', new.status),
      jsonb_build_object('employer_org_id', new.employer_org_id)
    );

    perform public.notify_staff_of_job_order_submission(new.id);
  end if;
  return new;
end;
$$;
