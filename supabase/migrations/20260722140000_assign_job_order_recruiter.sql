-- Assign / reassign the owner recruiter for a job order (handover-friendly).

create or replace function public.assign_job_order_recruiter(
  p_job_order_id uuid,
  p_recruiter_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_prev uuid;
  v_recruiter_ok boolean;
begin
  if not (
    public.auth_is_hq()
    or public.auth_has_role('franchise_admin')
    or public.auth_has_role('operations')
  ) then
    raise exception 'Only HQ or franchise admins can assign recruiters to jobs';
  end if;

  select * into v_order
  from public.job_orders
  where id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job order not found or not authorized';
  end if;

  if not public.auth_is_hq()
     and v_order.responsible_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'Job order is outside your organization scope';
  end if;

  if v_order.status not in ('approved', 'active', 'on_hold') then
    raise exception 'Only approved or open jobs can be assigned to a recruiter';
  end if;

  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_recruiter_user_id
      and m.organization_id = v_order.responsible_org_id
      and m.role = 'recruiter'
      and m.status = 'active'
  ) into v_recruiter_ok;

  if not v_recruiter_ok then
    raise exception 'Choose a recruiter from the franchise responsible for this job';
  end if;

  select ja.recruiter_user_id into v_prev
  from public.job_assignments ja
  where ja.job_order_id = p_job_order_id
    and ja.role = 'owner'
  limit 1;

  delete from public.job_assignments
  where job_order_id = p_job_order_id
    and role = 'owner'
    and recruiter_user_id is distinct from p_recruiter_user_id;

  insert into public.job_assignments (job_order_id, recruiter_user_id, role)
  values (p_job_order_id, p_recruiter_user_id, 'owner')
  on conflict (job_order_id, recruiter_user_id) do update
    set role = 'owner';

  -- Hand open applications to the new owner when unassigned or still on the previous owner.
  update public.applications
  set assigned_recruiter_id = p_recruiter_user_id
  where job_order_id = p_job_order_id
    and withdrawn_at is null
    and current_stage not in ('hired', 'rejected')
    and (
      assigned_recruiter_id is null
      or assigned_recruiter_id = v_prev
      or v_prev is null
    );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.recruiter_assigned',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('recruiter_user_id', v_prev),
    jsonb_build_object('recruiter_user_id', p_recruiter_user_id),
    jsonb_build_object('employer_org_id', v_order.employer_org_id)
  );

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  values (
    p_recruiter_user_id,
    'job_order',
    'Job assigned to you',
    'You are now the owner for "' || v_order.title || '".',
    'job_order',
    p_job_order_id
  );

  if v_prev is not null and v_prev is distinct from p_recruiter_user_id then
    insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
    values (
      v_prev,
      'job_order',
      'Job reassigned',
      '"' || v_order.title || '" was handed over to another recruiter.',
      'job_order',
      p_job_order_id
    );
  end if;
end;
$$;

revoke all on function public.assign_job_order_recruiter(uuid, uuid) from public;
grant execute on function public.assign_job_order_recruiter(uuid, uuid) to authenticated;
