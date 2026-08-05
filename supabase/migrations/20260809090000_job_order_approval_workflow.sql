-- Source-aware dual-approval workflow for job_orders + jobs.
-- Replaces atomic approve_and_publish with explicit approve vs publish gates.

-- ---------------------------------------------------------------------------
-- Columns: origin, approval snapshot, approvers
-- ---------------------------------------------------------------------------
alter table public.job_orders
  add column if not exists origin text,
  add column if not exists approved_snapshot jsonb,
  add column if not exists approved_snapshot_hash text,
  add column if not exists employer_approved_by uuid references public.profiles(id),
  add column if not exists employer_approved_at timestamptz,
  add column if not exists shugulika_approved_by uuid references public.profiles(id),
  add column if not exists shugulika_approved_at timestamptz,
  add column if not exists current_owner_user_id uuid references public.profiles(id);

update public.job_orders
set origin = 'employer_online'
where origin is null;

alter table public.job_orders
  alter column origin set default 'employer_online',
  alter column origin set not null;

alter table public.job_orders
  drop constraint if exists job_orders_origin_check;
alter table public.job_orders
  add constraint job_orders_origin_check
  check (origin in ('employer_online', 'shugulika_offline'));

comment on column public.job_orders.origin is
  'employer_online = employer-submitted; shugulika_offline = staff-drafted for employer approval.';
comment on column public.job_orders.approved_snapshot is
  'Immutable material-field snapshot captured at the latest approval that unlocks publish.';
comment on column public.job_orders.approved_snapshot_hash is
  'SHA-256 hex of approved_snapshot; material edits invalidate approval.';

-- ---------------------------------------------------------------------------
-- Expand status CHECK (retain legacy statuses for existing rows)
-- ---------------------------------------------------------------------------
do $$
declare
  cons text;
begin
  select c.conname into cons
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'job_orders'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%submitted%';
  if cons is not null then
    execute format('alter table public.job_orders drop constraint %I', cons);
  end if;
end $$;

alter table public.job_orders
  drop constraint if exists job_orders_status_check;

alter table public.job_orders
  add constraint job_orders_status_check
  check (status in (
    'draft',
    'awaiting_employer_approval',
    'submitted_to_shugulika',
    'changes_requested',
    'approved_by_employer',
    'approved_by_shugulika',
    'submitted',
    'approved',
    'active',
    'on_hold',
    'paused',
    'filled',
    'partially_filled',
    'cancelled',
    'closed',
    'denied'
  ));

-- Backfill legacy submitted → submitted_to_shugulika (origin already employer_online).
update public.job_orders
set status = 'submitted_to_shugulika',
    updated_at = now()
where status = 'submitted';

-- ---------------------------------------------------------------------------
-- History + change requests
-- ---------------------------------------------------------------------------
create table if not exists public.job_order_events (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  event_type text not null,
  actor_user_id uuid references public.profiles(id),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_job_order_events_order_time
  on public.job_order_events (job_order_id, occurred_at desc);

create table if not exists public.job_order_change_requests (
  id uuid primary key default gen_random_uuid(),
  job_order_id uuid not null references public.job_orders(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  message text not null,
  requested_changes jsonb not null default '[]'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'addressed', 'cancelled')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (length(trim(message)) >= 8)
);

create index if not exists idx_job_order_change_requests_order
  on public.job_order_change_requests (job_order_id, created_at desc);

alter table public.job_order_events enable row level security;
alter table public.job_order_change_requests enable row level security;

drop policy if exists job_order_events_scoped_read on public.job_order_events;
create policy job_order_events_scoped_read on public.job_order_events
  for select to authenticated
  using (
    exists (
      select 1 from public.job_orders jo
      where jo.id = job_order_events.job_order_id
        and (
          public.auth_is_hq()
          or jo.employer_org_id in (select public.auth_scoped_org_ids())
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
        )
    )
  );

drop policy if exists job_order_change_requests_scoped_read on public.job_order_change_requests;
create policy job_order_change_requests_scoped_read on public.job_order_change_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.job_orders jo
      where jo.id = job_order_change_requests.job_order_id
        and (
          public.auth_is_hq()
          or jo.employer_org_id in (select public.auth_scoped_org_ids())
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
        )
    )
  );

grant select on public.job_order_events to authenticated;
grant select, insert, update on public.job_order_change_requests to authenticated;

drop policy if exists job_order_change_requests_staff_write on public.job_order_change_requests;
create policy job_order_change_requests_staff_write on public.job_order_change_requests
  for all to authenticated
  using (
    exists (
      select 1 from public.job_orders jo
      where jo.id = job_order_change_requests.job_order_id
        and (
          public.auth_is_hq()
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
          or jo.employer_org_id in (select public.auth_scoped_org_ids())
        )
        and (
          public.auth_is_hq()
          or public.auth_has_role('franchise_admin')
          or public.auth_has_role('recruiter')
          or public.auth_has_role('employer_user')
        )
    )
  )
  with check (
    exists (
      select 1 from public.job_orders jo
      where jo.id = job_order_change_requests.job_order_id
        and (
          public.auth_is_hq()
          or jo.responsible_org_id in (select public.auth_scoped_org_ids())
          or jo.employer_org_id in (select public.auth_scoped_org_ids())
        )
        and (
          public.auth_is_hq()
          or public.auth_has_role('franchise_admin')
          or public.auth_has_role('recruiter')
          or public.auth_has_role('employer_user')
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.job_order_material_snapshot(p_order public.job_orders)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'title', p_order.title,
    'description', coalesce(p_order.description, ''),
    'requirements', coalesce(p_order.requirements, ''),
    'salary_min', p_order.salary_min,
    'salary_max', p_order.salary_max,
    'salary_currency', coalesce(p_order.salary_currency, ''),
    'country_code', p_order.country_code,
    'city', coalesce(p_order.city, ''),
    'vacancy_count', p_order.vacancy_count,
    'recruitment_path', p_order.recruitment_path,
    'application_deadline', p_order.application_deadline
  );
$$;

create or replace function public.job_order_snapshot_hash(p_snapshot jsonb)
returns text
language sql
immutable
as $$
  select encode(digest(coalesce(p_snapshot, '{}'::jsonb)::text, 'sha256'), 'hex');
$$;

create or replace function public.job_order_record_event(
  p_job_order_id uuid,
  p_from_status text,
  p_to_status text,
  p_event_type text,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.job_order_events (
    job_order_id, from_status, to_status, event_type, actor_user_id, reason, metadata
  ) values (
    p_job_order_id, p_from_status, p_to_status, p_event_type, auth.uid(), p_reason,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.job_order_record_event(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.job_order_record_event(uuid, text, text, text, text, jsonb) to authenticated;

create or replace function public.job_order_assert_staff_scope(p_order public.job_orders)
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not (
    public.auth_is_hq()
    or public.auth_has_role('franchise_admin')
    or public.auth_has_role('recruiter')
  ) then
    raise exception 'Only authorized staff can perform this job-order action';
  end if;

  if not public.auth_is_hq()
     and p_order.responsible_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'Job order is outside your organization scope';
  end if;
end;
$$;

create or replace function public.job_order_clear_approvals(p_job_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.job_orders
  set approved_snapshot = null,
      approved_snapshot_hash = null,
      employer_approved_by = null,
      employer_approved_at = null,
      shugulika_approved_by = null,
      shugulika_approved_at = null,
      updated_at = now()
  where id = p_job_order_id;
end;
$$;

-- Material edit after approval returns the role to the required approval step.
create or replace function public.job_order_material_edit_reapproval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_reset_to text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Ignore pure status/workflow bookkeeping updates.
  if (
    new.title is not distinct from old.title
    and new.description is not distinct from old.description
    and new.requirements is not distinct from old.requirements
    and new.salary_min is not distinct from old.salary_min
    and new.salary_max is not distinct from old.salary_max
    and new.salary_currency is not distinct from old.salary_currency
    and new.country_code is not distinct from old.country_code
    and new.city is not distinct from old.city
    and new.vacancy_count is not distinct from old.vacancy_count
    and new.recruitment_path is not distinct from old.recruitment_path
    and new.application_deadline is not distinct from old.application_deadline
  ) then
    return new;
  end if;

  -- Only reset once an approval/publication path has started.
  if old.status not in (
    'awaiting_employer_approval',
    'submitted_to_shugulika',
    'changes_requested',
    'approved_by_employer',
    'approved_by_shugulika',
    'approved',
    'active',
    'on_hold',
    'paused'
  ) then
    return new;
  end if;

  v_old := public.job_order_material_snapshot(old);
  v_new := public.job_order_material_snapshot(new);
  if v_old = v_new then
    return new;
  end if;

  if new.origin = 'shugulika_offline' then
    v_reset_to := 'awaiting_employer_approval';
  else
    v_reset_to := 'submitted_to_shugulika';
  end if;

  new.status := v_reset_to;
  new.approved_snapshot := null;
  new.approved_snapshot_hash := null;
  new.employer_approved_by := null;
  new.employer_approved_at := null;
  new.shugulika_approved_by := null;
  new.shugulika_approved_at := null;
  new.updated_at := now();

  perform public.job_order_record_event(
    new.id,
    old.status,
    v_reset_to,
    'material_edit_reapproval',
    'Material fields changed; approval required again',
    jsonb_build_object(
      'before_hash', public.job_order_snapshot_hash(v_old),
      'after_hash', public.job_order_snapshot_hash(v_new)
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_job_order_material_edit_reapproval on public.job_orders;
create trigger trg_job_order_material_edit_reapproval
before update on public.job_orders
for each row execute function public.job_order_material_edit_reapproval();

-- ---------------------------------------------------------------------------
-- RLS: employer submit + employer edit of editable statuses
-- ---------------------------------------------------------------------------
drop policy if exists jo_employer_submit on public.job_orders;
create policy jo_employer_submit on public.job_orders
  for insert to authenticated
  with check (
    public.auth_has_role('employer_user')
    and employer_org_id in (select public.auth_scoped_org_ids())
    and created_by = auth.uid()
    and origin = 'employer_online'
    and status in ('draft', 'submitted_to_shugulika')
    and responsible_org_id = (
      select o.parent_id
      from public.organizations o
      where o.id = employer_org_id and o.org_type = 'employer'
    )
  );

drop policy if exists jo_employer_update_editable on public.job_orders;
create policy jo_employer_update_editable on public.job_orders
  for update to authenticated
  using (
    public.auth_has_role('employer_user')
    and employer_org_id in (select public.auth_scoped_org_ids())
    and origin = 'employer_online'
    and status in ('draft', 'changes_requested')
  )
  with check (
    public.auth_has_role('employer_user')
    and employer_org_id in (select public.auth_scoped_org_ids())
    and origin = 'employer_online'
    and status in ('draft', 'changes_requested')
  );

-- Submission audit/notify for the new online status (and legacy during transition).
create or replace function public.audit_submitted_job_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('submitted', 'submitted_to_shugulika')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
    ) values (
      auth.uid(),
      'job_order.submitted',
      'job_order',
      new.id,
      new.responsible_org_id,
      case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) else null end,
      jsonb_build_object('status', new.status, 'origin', new.origin),
      jsonb_build_object('employer_org_id', new.employer_org_id, 'origin', new.origin)
    );

    perform public.notify_staff_of_job_order_submission(new.id);

    if tg_op = 'INSERT' then
      perform public.job_order_record_event(
        new.id, null, new.status, 'submitted', null,
        jsonb_build_object('origin', new.origin)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_submitted_job_order on public.job_orders;
create trigger trg_audit_submitted_job_order
after insert or update of status on public.job_orders
for each row execute function public.audit_submitted_job_order();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Staff create offline draft linked to an employer.
create or replace function public.create_offline_job_order_draft(
  p_employer_org_id uuid,
  p_title text,
  p_country_code text,
  p_description text default null,
  p_requirements text default null,
  p_city text default null,
  p_vacancy_count int default 1,
  p_recruitment_path text default 'B',
  p_salary_min numeric default null,
  p_salary_max numeric default null,
  p_salary_currency text default null,
  p_application_deadline date default null,
  p_department text default null,
  p_employment_type text default null,
  p_work_arrangement text default null,
  p_experience_level text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employer public.organizations%rowtype;
  v_id uuid;
  v_path text := coalesce(nullif(trim(p_recruitment_path), ''), 'B');
  v_title text := trim(coalesce(p_title, ''));
  v_vacancies int := coalesce(p_vacancy_count, 1);
begin
  if not (
    public.auth_is_hq()
    or public.auth_has_role('franchise_admin')
    or public.auth_has_role('recruiter')
  ) then
    raise exception 'Only authorized staff can create offline job order drafts';
  end if;

  if length(v_title) < 2 then
    raise exception 'Title is required';
  end if;
  if v_vacancies < 1 then
    raise exception 'vacancy_count must be at least 1';
  end if;
  if v_path not in ('A', 'B') then
    raise exception 'recruitment_path must be A or B';
  end if;

  select * into v_employer
  from public.organizations
  where id = p_employer_org_id and org_type = 'employer';

  if not found then
    raise exception 'Employer organization not found';
  end if;

  if v_employer.parent_id is null then
    raise exception 'Employer is not assigned to a Shugulika franchise';
  end if;

  if not public.auth_is_hq()
     and v_employer.parent_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'Employer is outside your organization scope';
  end if;

  insert into public.job_orders (
    employer_org_id,
    responsible_org_id,
    created_by,
    current_owner_user_id,
    origin,
    status,
    title,
    description,
    requirements,
    country_code,
    city,
    vacancy_count,
    recruitment_path,
    salary_min,
    salary_max,
    salary_currency,
    application_deadline,
    department,
    employment_type,
    work_arrangement,
    experience_level
  ) values (
    v_employer.id,
    v_employer.parent_id,
    auth.uid(),
    auth.uid(),
    'shugulika_offline',
    'draft',
    v_title,
    nullif(trim(coalesce(p_description, '')), ''),
    nullif(trim(coalesce(p_requirements, '')), ''),
    p_country_code,
    nullif(trim(coalesce(p_city, '')), ''),
    v_vacancies,
    v_path,
    p_salary_min,
    p_salary_max,
    nullif(trim(coalesce(p_salary_currency, '')), ''),
    p_application_deadline,
    nullif(trim(coalesce(p_department, '')), ''),
    nullif(trim(coalesce(p_employment_type, '')), ''),
    nullif(trim(coalesce(p_work_arrangement, '')), ''),
    nullif(trim(coalesce(p_experience_level, '')), '')
  )
  returning id into v_id;

  perform public.job_order_record_event(
    v_id, null, 'draft', 'offline_draft_created', null,
    jsonb_build_object('employer_org_id', v_employer.id)
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.offline_draft_created',
    'job_order',
    v_id,
    v_employer.parent_id,
    null,
    jsonb_build_object('status', 'draft', 'origin', 'shugulika_offline'),
    jsonb_build_object('employer_org_id', v_employer.id)
  );

  return v_id;
end;
$$;

revoke all on function public.create_offline_job_order_draft(
  uuid, text, text, text, text, text, int, text, numeric, numeric, text, date, text, text, text, text
) from public;
grant execute on function public.create_offline_job_order_draft(
  uuid, text, text, text, text, text, int, text, numeric, numeric, text, date, text, text, text, text
) to authenticated;

-- Submit / resubmit: online → Shugulika; offline → employer approval queue.
create or replace function public.submit_job_order_to_shugulika(p_job_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_to text;
begin
  select * into v_order
  from public.job_orders
  where id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job order not found or not authorized';
  end if;

  if v_order.origin = 'employer_online' then
    if not (
      public.auth_has_role('employer_user')
      and v_order.employer_org_id in (select public.auth_scoped_org_ids())
    ) then
      raise exception 'Only the employer can submit this job order to Shugulika';
    end if;
    if v_order.status not in ('draft', 'changes_requested') then
      raise exception 'Only draft or changes-requested online job orders can be submitted';
    end if;
    v_to := 'submitted_to_shugulika';
  elsif v_order.origin = 'shugulika_offline' then
    perform public.job_order_assert_staff_scope(v_order);
    if v_order.status not in ('draft', 'changes_requested') then
      raise exception 'Only draft or changes-requested offline job orders can be sent for employer approval';
    end if;
    v_to := 'awaiting_employer_approval';
  else
    raise exception 'Unsupported job order origin';
  end if;

  if length(trim(coalesce(v_order.title, ''))) < 2 then
    raise exception 'Title is required before submission';
  end if;
  if v_order.employer_org_id is null or v_order.responsible_org_id is null then
    raise exception 'Employer and responsible organization are required';
  end if;
  if v_order.country_code is null or length(trim(v_order.country_code)) = 0 then
    raise exception 'Country is required before submission';
  end if;
  if v_order.recruitment_path not in ('A', 'B') then
    raise exception 'recruitment_path is required before submission';
  end if;

  update public.job_orders
  set status = v_to,
      updated_at = now()
  where id = p_job_order_id;

  update public.job_order_change_requests
  set status = 'addressed',
      resolved_at = coalesce(resolved_at, now())
  where job_order_id = p_job_order_id
    and status = 'open';

  perform public.job_order_record_event(
    p_job_order_id, v_order.status, v_to, 'submitted', null,
    jsonb_build_object('origin', v_order.origin)
  );

  if v_to = 'awaiting_employer_approval' then
    insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
    select distinct m.user_id,
           'job_order',
           'Job order awaiting your approval',
           'Please review and approve "' || v_order.title || '".',
           'job_order',
           v_order.id
    from public.memberships m
    where m.organization_id = v_order.employer_org_id
      and m.status = 'active'
      and m.role = 'employer_user';

    insert into public.audit_logs (
      actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
    ) values (
      auth.uid(),
      'job_order.awaiting_employer_approval',
      'job_order',
      p_job_order_id,
      v_order.responsible_org_id,
      jsonb_build_object('status', v_order.status),
      jsonb_build_object('status', v_to, 'origin', v_order.origin),
      jsonb_build_object('employer_org_id', v_order.employer_org_id)
    );
  end if;
end;
$$;

revoke all on function public.submit_job_order_to_shugulika(uuid) from public;
grant execute on function public.submit_job_order_to_shugulika(uuid) to authenticated;

create or replace function public.request_job_order_changes(
  p_job_order_id uuid,
  p_message text,
  p_changes jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_message text := trim(coalesce(p_message, ''));
  v_changes jsonb := coalesce(p_changes, '[]'::jsonb);
  v_id uuid;
begin
  if length(v_message) < 8 then
    raise exception 'A change-request message of at least 8 characters is required';
  end if;
  if jsonb_typeof(v_changes) <> 'array' or jsonb_array_length(v_changes) < 1 then
    raise exception 'Provide at least one requested change item';
  end if;

  select * into v_order
  from public.job_orders
  where id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job order not found or not authorized';
  end if;

  perform public.job_order_assert_staff_scope(v_order);

  if not (
    public.auth_is_hq()
    or public.auth_has_role('franchise_admin')
    or public.auth_has_role('recruiter')
  ) then
    raise exception 'Only authorized staff can request job-order changes';
  end if;

  if v_order.status not in (
    'submitted_to_shugulika',
    'awaiting_employer_approval',
    'approved_by_employer',
    'approved_by_shugulika'
  ) then
    raise exception 'Changes can only be requested for job orders under review';
  end if;

  update public.job_orders
  set status = 'changes_requested',
      approved_snapshot = null,
      approved_snapshot_hash = null,
      employer_approved_by = null,
      employer_approved_at = null,
      shugulika_approved_by = null,
      shugulika_approved_at = null,
      updated_at = now()
  where id = p_job_order_id;

  insert into public.job_order_change_requests (
    job_order_id, requested_by, message, requested_changes, status
  ) values (
    p_job_order_id, auth.uid(), v_message, v_changes, 'open'
  )
  returning id into v_id;

  perform public.job_order_record_event(
    p_job_order_id, v_order.status, 'changes_requested', 'changes_requested', v_message,
    jsonb_build_object('change_request_id', v_id, 'changes', v_changes)
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.changes_requested',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', 'changes_requested'),
    jsonb_build_object('change_request_id', v_id, 'message', v_message)
  );

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  select distinct m.user_id,
         'job_order',
         'Changes requested on job order',
         v_message,
         'job_order',
         v_order.id
  from public.memberships m
  where m.organization_id = v_order.employer_org_id
    and m.status = 'active'
    and m.role = 'employer_user';

  return v_id;
end;
$$;

revoke all on function public.request_job_order_changes(uuid, text, jsonb) from public;
grant execute on function public.request_job_order_changes(uuid, text, jsonb) to authenticated;

create or replace function public.approve_job_order_by_employer(p_job_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_snapshot jsonb;
  v_hash text;
begin
  if not public.auth_has_role('employer_user') then
    raise exception 'Only employers can approve offline job orders';
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

  if v_order.origin <> 'shugulika_offline' then
    raise exception 'Employer approval applies to Shugulika offline job orders only';
  end if;

  if v_order.status <> 'awaiting_employer_approval' then
    raise exception 'Only job orders awaiting employer approval can be approved by the employer';
  end if;

  v_snapshot := public.job_order_material_snapshot(v_order);
  v_hash := public.job_order_snapshot_hash(v_snapshot);

  update public.job_orders
  set status = 'approved_by_employer',
      approved_snapshot = v_snapshot,
      approved_snapshot_hash = v_hash,
      employer_approved_by = auth.uid(),
      employer_approved_at = now(),
      updated_at = now()
  where id = p_job_order_id;

  perform public.job_order_record_event(
    p_job_order_id, v_order.status, 'approved_by_employer', 'approved_by_employer', null,
    jsonb_build_object('snapshot_hash', v_hash)
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.approved_by_employer',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', 'approved_by_employer', 'snapshot_hash', v_hash),
    jsonb_build_object('employer_org_id', v_order.employer_org_id)
  );

  perform public.notify_organization_staff(
    v_order.responsible_org_id,
    'job_order',
    'Employer approved job order',
    'Employer approved "' || v_order.title || '". You may continue Shugulika approval or publish when ready.',
    'job_order',
    v_order.id
  );
end;
$$;

revoke all on function public.approve_job_order_by_employer(uuid) from public;
grant execute on function public.approve_job_order_by_employer(uuid) to authenticated;

create or replace function public.approve_job_order_by_shugulika(p_job_order_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_snapshot jsonb;
  v_hash text;
  v_from text;
begin
  select * into v_order
  from public.job_orders
  where id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job order not found or not authorized';
  end if;

  perform public.job_order_assert_staff_scope(v_order);

  if v_order.origin = 'employer_online' then
    if v_order.status <> 'submitted_to_shugulika' then
      raise exception 'Only job orders submitted to Shugulika can be approved';
    end if;
  elsif v_order.origin = 'shugulika_offline' then
    if v_order.status <> 'approved_by_employer' then
      raise exception 'Offline job orders require employer approval before Shugulika approval';
    end if;
  else
    raise exception 'Unsupported job order origin';
  end if;

  v_from := v_order.status;
  v_snapshot := public.job_order_material_snapshot(v_order);
  v_hash := public.job_order_snapshot_hash(v_snapshot);

  update public.job_orders
  set status = 'approved_by_shugulika',
      approved_snapshot = v_snapshot,
      approved_snapshot_hash = v_hash,
      shugulika_approved_by = auth.uid(),
      shugulika_approved_at = now(),
      updated_at = now()
  where id = p_job_order_id;

  perform public.job_order_record_event(
    p_job_order_id, v_from, 'approved_by_shugulika', 'approved_by_shugulika', null,
    jsonb_build_object('snapshot_hash', v_hash, 'origin', v_order.origin)
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.approved_by_shugulika',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('status', v_from),
    jsonb_build_object('status', 'approved_by_shugulika', 'snapshot_hash', v_hash),
    jsonb_build_object('employer_org_id', v_order.employer_org_id, 'origin', v_order.origin)
  );

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  select distinct m.user_id,
         'job_order',
         'Job order approved by Shugulika',
         '"' || v_order.title || '" was approved and is ready to publish.',
         'job_order',
         v_order.id
  from public.memberships m
  where m.organization_id = v_order.employer_org_id
    and m.status = 'active'
    and m.role = 'employer_user';
end;
$$;

revoke all on function public.approve_job_order_by_shugulika(uuid) from public;
grant execute on function public.approve_job_order_by_shugulika(uuid) to authenticated;

create or replace function public.publish_job_order(p_job_order_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_job_id uuid;
  v_slug text;
  v_current_hash text;
begin
  if public.auth_has_role('employer_user')
     and not (
       public.auth_is_hq()
       or public.auth_has_role('franchise_admin')
       or public.auth_has_role('recruiter')
     ) then
    raise exception 'Employers cannot publish job orders';
  end if;

  select * into v_order
  from public.job_orders
  where id = p_job_order_id
  for update;

  if not found then
    raise exception 'Job order not found or not authorized';
  end if;

  perform public.job_order_assert_staff_scope(v_order);

  if v_order.origin = 'employer_online' then
    if v_order.status <> 'approved_by_shugulika' then
      raise exception 'Online job orders cannot be published before Shugulika approval';
    end if;
  elsif v_order.origin = 'shugulika_offline' then
    if v_order.status not in ('approved_by_employer', 'approved_by_shugulika') then
      raise exception 'Offline job orders cannot be published before employer approval';
    end if;
  else
    raise exception 'Unsupported job order origin';
  end if;

  if v_order.approved_snapshot is null or v_order.approved_snapshot_hash is null then
    raise exception 'Approved snapshot is required before publish';
  end if;

  v_current_hash := public.job_order_snapshot_hash(public.job_order_material_snapshot(v_order));
  if v_current_hash is distinct from v_order.approved_snapshot_hash then
    raise exception 'Job order changed after approval; re-approval is required';
  end if;

  update public.job_orders
  set status = 'active',
      updated_at = now()
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

  perform public.job_order_record_event(
    p_job_order_id, v_order.status, 'active', 'published', null,
    jsonb_build_object('publication_id', v_job_id, 'origin', v_order.origin)
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.published',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('job_order_status', v_order.status),
    jsonb_build_object('job_order_status', 'active', 'publication_status', 'advertised'),
    jsonb_build_object(
      'publication_id', v_job_id,
      'employer_org_id', v_order.employer_org_id,
      'origin', v_order.origin
    )
  );

  insert into public.activity_events (
    owning_org_id, subject_type, subject_id, event_type, actor_id, summary, metadata
  ) values (
    v_order.responsible_org_id,
    'job_order',
    p_job_order_id,
    'job_order_published',
    auth.uid(),
    'Job order published',
    jsonb_build_object('publication_id', v_job_id, 'origin', v_order.origin)
  );

  return v_job_id;
end;
$$;

revoke all on function public.publish_job_order(uuid) from public;
grant execute on function public.publish_job_order(uuid) to authenticated;

-- Retire atomic approve+publish (callers must use split approve / publish).
create or replace function public.approve_and_publish_job_order(p_job_order_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception
    'approve_and_publish_job_order is retired; use approve_job_order_by_shugulika and publish_job_order';
end;
$$;

-- ---------------------------------------------------------------------------
-- Align deny / withdraw / assign with new statuses
-- ---------------------------------------------------------------------------
create or replace function public.deny_job_order(
  p_job_order_id uuid,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.job_orders%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if length(v_reason) < 8 then
    raise exception 'A denial reason of at least 8 characters is required';
  end if;

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
  ) then
    raise exception 'Only HQ or franchise admins can deny job orders';
  end if;

  if not public.auth_is_hq()
     and v_order.responsible_org_id not in (select public.auth_scoped_org_ids()) then
    raise exception 'Job order is outside your organization scope';
  end if;

  if v_order.status not in (
    'submitted',
    'submitted_to_shugulika',
    'awaiting_employer_approval',
    'changes_requested',
    'approved_by_employer',
    'approved_by_shugulika'
  ) then
    raise exception 'Only job orders under review can be denied';
  end if;

  update public.job_orders
  set status = 'denied',
      denial_reason = v_reason,
      closed_reason = v_reason,
      updated_at = now()
  where id = p_job_order_id;

  perform public.job_order_record_event(
    p_job_order_id, v_order.status, 'denied', 'denied', v_reason, '{}'::jsonb
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata
  ) values (
    auth.uid(),
    'job_order.denied',
    'job_order',
    p_job_order_id,
    v_order.responsible_org_id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', 'denied', 'denial_reason', v_reason),
    jsonb_build_object('employer_org_id', v_order.employer_org_id)
  );

  insert into public.activity_events (
    owning_org_id, subject_type, subject_id, event_type, actor_id, summary, metadata
  ) values (
    v_order.responsible_org_id,
    'job_order',
    p_job_order_id,
    'job_order_denied',
    auth.uid(),
    'Job order denied',
    jsonb_build_object('denial_reason', v_reason)
  );
end;
$$;

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

  if v_order.status not in (
    'draft',
    'submitted',
    'submitted_to_shugulika',
    'awaiting_employer_approval',
    'changes_requested',
    'approved_by_employer',
    'approved_by_shugulika',
    'approved',
    'active',
    'on_hold',
    'paused'
  ) then
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

  perform public.job_order_record_event(
    p_job_order_id, v_order.status, 'cancelled', 'withdrawn', null,
    jsonb_build_object('employer_org_id', v_order.employer_org_id)
  );

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

  if v_order.status not in (
    'approved',
    'approved_by_employer',
    'approved_by_shugulika',
    'active',
    'on_hold',
    'paused'
  ) then
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

  update public.applications
  set assigned_recruiter_id = p_recruiter_user_id
  where job_order_id = p_job_order_id
    and withdrawn_at is null
    and current_stage not in ('hired', 'rejected')
    and (
      assigned_recruiter_id is null
      or assigned_recruiter_id = v_prev
    );

  update public.job_orders
  set current_owner_user_id = p_recruiter_user_id,
      updated_at = now()
  where id = p_job_order_id;

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  values (
    p_recruiter_user_id,
    'job_order',
    'You were assigned a job order',
    'You now own "' || v_order.title || '".',
    'job_order',
    p_job_order_id
  );

  if v_prev is not null and v_prev is distinct from p_recruiter_user_id then
    insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
    values (
      v_prev,
      'job_order',
      'Job order reassigned',
      '"' || v_order.title || '" was reassigned to another recruiter.',
      'job_order',
      p_job_order_id
    );
  end if;

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
end;
$$;
