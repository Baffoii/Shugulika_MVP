-- Employers can withdraw open job orders (with confirmation in the UI).
-- Also enforce vacancy_count >= 1 at the database layer.

alter table public.job_orders
  drop constraint if exists job_orders_vacancy_count_check;

alter table public.job_orders
  add constraint job_orders_vacancy_count_check
  check (vacancy_count >= 1);

create or replace function public.withdraw_job_order(p_job_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
begin
  if not public.auth_has_role('employer_user') then
    raise exception 'Only employers can withdraw job orders';
  end if;

  select * into v_order
  from public.job_orders
  where id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job order not found or not authorized';
  end if;

  if v_order.employer_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'Job order is outside your organization scope';
  end if;

  if v_order.status not in ('submitted', 'approved', 'active', 'on_hold') then
    raise exception 'This job order can no longer be withdrawn';
  end if;

  update public.job_orders
  set status = 'cancelled',
      closed_reason = coalesce(nullif(closed_reason, ''), 'Withdrawn by employer'),
      updated_at = now()
  where id = p_job_order_id;

  update public.jobs
  set status = 'unpublished',
      updated_at = now()
  where job_order_id = p_job_order_id
    and status in ('draft', 'pending_approval', 'advertised', 'paused');

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.withdrawn',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('job_order_status', v_order.status),
    jsonb_build_object('job_order_status', 'cancelled'),
    jsonb_build_object('employer_org_id', v_order.employer_org_id)
  );

  insert into public.activity_events (
    owning_org_id, subject_type, subject_id, event_type, actor_id, summary, metadata
  ) values (
    v_order.responsible_org_id,
    'job_order',
    p_job_order_id,
    'job_order_withdrawn',
    auth.uid(),
    'Job order withdrawn by employer',
    jsonb_build_object('previous_status', v_order.status, 'employer_org_id', v_order.employer_org_id)
  );
end;
$$;

revoke all on function public.withdraw_job_order(uuid) from public;
grant execute on function public.withdraw_job_order(uuid) to authenticated;
