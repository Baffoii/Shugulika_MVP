-- Employer job-order submission -> scoped staff approval/publication.
-- The public publication and its audit entry are committed atomically.

create unique index if not exists uq_jobs_job_order_id on public.jobs (job_order_id);

drop policy if exists jo_staff_write on public.job_orders;

create policy jo_employer_submit on public.job_orders
  for insert to authenticated
  with check (
    public.auth_has_role('employer_user')
    and employer_org_id in (select public.auth_scoped_org_ids())
    and created_by = auth.uid()
    and status = 'submitted'
    and responsible_org_id = (
      select o.parent_id
      from public.organizations o
      where o.id = employer_org_id and o.org_type = 'employer'
    )
  );

create policy jo_scoped_staff_update on public.job_orders
  for update to authenticated
  using (
    (public.auth_is_hq() or responsible_org_id in (select public.auth_scoped_org_ids()))
    and (
      public.auth_is_hq()
      or public.auth_has_role('franchise_admin')
      or public.auth_has_role('recruiter')
    )
  )
  with check (
    (public.auth_is_hq() or responsible_org_id in (select public.auth_scoped_org_ids()))
    and (
      public.auth_is_hq()
      or public.auth_has_role('franchise_admin')
      or public.auth_has_role('recruiter')
    )
  );

drop policy if exists jobs_staff_write on public.jobs;
create policy jobs_scoped_staff_write on public.jobs
  for all to authenticated
  using (
    exists (
      select 1 from public.job_orders jo
      where jo.id = jobs.job_order_id
        and (public.auth_is_hq() or jo.responsible_org_id in (select public.auth_scoped_org_ids()))
        and (
          public.auth_is_hq()
          or public.auth_has_role('franchise_admin')
          or public.auth_has_role('recruiter')
        )
    )
  )
  with check (
    exists (
      select 1 from public.job_orders jo
      where jo.id = jobs.job_order_id
        and (public.auth_is_hq() or jo.responsible_org_id in (select public.auth_scoped_org_ids()))
        and (
          public.auth_is_hq()
          or public.auth_has_role('franchise_admin')
          or public.auth_has_role('recruiter')
        )
    )
  );

-- Job-order audit history is visible to the organizations involved in the order.
drop policy if exists audit_read on public.audit_logs;
create policy audit_scoped_read on public.audit_logs
  for select to authenticated
  using (
    public.auth_is_hq()
    or org_context_id in (select public.auth_scoped_org_ids())
    or (
      entity_type = 'job_order'
      and exists (
        select 1 from public.job_orders jo
        where jo.id = audit_logs.entity_id
          and (
            jo.employer_org_id in (select public.auth_scoped_org_ids())
            or jo.responsible_org_id in (select public.auth_scoped_org_ids())
          )
      )
    )
  );

-- Let authorized job-order viewers resolve the human name behind an audit actor.
create policy profiles_job_order_audit_actor_read on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.audit_logs al
      where al.actor_id = profiles.id
        and al.entity_type = 'job_order'
    )
  );

create or replace function public.audit_submitted_job_order()
returns trigger
language plpgsql
security invoker
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
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_submitted_job_order on public.job_orders;
create trigger trg_audit_submitted_job_order
after insert on public.job_orders
for each row execute function public.audit_submitted_job_order();

create or replace function public.approve_and_publish_job_order(p_job_order_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_job_id uuid;
  v_slug text;
begin
  select * into v_order
  from public.job_orders
  where id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job order not found or not authorized';
  end if;

  if not (
    public.auth_is_hq()
    or public.auth_has_role('franchise_admin')
    or public.auth_has_role('recruiter')
  ) then
    raise exception 'Only authorized staff can approve job orders';
  end if;

  if not public.auth_is_hq()
     and v_order.responsible_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'Job order is outside your organization scope';
  end if;

  if v_order.status <> 'submitted' then
    raise exception 'Only submitted job orders can be approved and published';
  end if;

  update public.job_orders
  set status = 'active', updated_at = now()
  where id = p_job_order_id;

  v_slug := trim(both '-' from regexp_replace(lower(v_order.title), '[^a-z0-9]+', '-', 'g'))
            || '-' || left(replace(p_job_order_id::text, '-', ''), 8);

  insert into public.jobs (job_order_id, status, public_slug, published_at)
  values (p_job_order_id, 'advertised', v_slug, now())
  on conflict (job_order_id) do update
    set status = 'advertised',
        public_slug = excluded.public_slug,
        published_at = excluded.published_at,
        updated_at = now()
  returning id into v_job_id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.approved_and_published',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('job_order_status', v_order.status),
    jsonb_build_object('job_order_status', 'active', 'publication_status', 'advertised'),
    jsonb_build_object('publication_id', v_job_id, 'employer_org_id', v_order.employer_org_id)
  );

  insert into public.activity_events (
    owning_org_id, subject_type, subject_id, event_type, actor_id, summary, metadata
  ) values (
    v_order.responsible_org_id,
    'job_order',
    p_job_order_id,
    'job_order_published',
    auth.uid(),
    'Job order approved and published',
    jsonb_build_object('publication_id', v_job_id)
  );

  return v_job_id;
end;
$$;

revoke all on function public.approve_and_publish_job_order(uuid) from public;
grant execute on function public.approve_and_publish_job_order(uuid) to authenticated;
