-- Franchise ops: employer-application owner, SLA, next action, and in-franchise
-- owner reassignment. Cross-franchise queue moves remain HQ-only via
-- reassign_employer_application.

-- ---------------------------------------------------------------------------
-- Additive columns
-- ---------------------------------------------------------------------------
alter table public.employer_applications
  add column if not exists owner_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists sla_due_at timestamptz,
  add column if not exists next_action text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employer_applications_next_action_check'
  ) then
    alter table public.employer_applications
      add constraint employer_applications_next_action_check
      check (
        next_action is null
        or next_action in (
          'open_review',
          'decide',
          'await_employer',
          'await_hq',
          'close_out',
          'none'
        )
      );
  end if;
end $$;

create index if not exists idx_eapp_assigned_status_sla
  on public.employer_applications (assigned_org_id, status, sla_due_at);

create index if not exists idx_eapp_assigned_owner
  on public.employer_applications (assigned_org_id, owner_user_id);

-- Default next_action / SLA when an application enters the review queue.
create or replace function public.tg_employer_applications_ops_defaults()
returns trigger
language plpgsql
as $$
declare
  v_base timestamptz;
  -- On UPDATE, NEW.next_action retains the prior column value unless the
  -- statement explicitly set it. Recompute from status in that case so
  -- submitted → under_review → approved does not freeze at 'open_review'.
  v_recompute_next_action boolean :=
    tg_op = 'INSERT'
    or (
      tg_op = 'UPDATE'
      and new.status is distinct from old.status
      and new.next_action is not distinct from old.next_action
    )
    or (new.next_action is null);
begin
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    if v_recompute_next_action then
      new.next_action := case new.status
        when 'submitted' then 'open_review'
        when 'under_review' then 'decide'
        when 'changes_requested' then 'await_employer'
        when 'approved' then 'close_out'
        when 'rejected' then 'close_out'
        when 'withdrawn' then 'none'
        else 'none'
      end;
    end if;

    if new.sla_due_at is null
       and new.status in ('submitted', 'under_review')
       and new.submitted_at is not null
    then
      v_base := coalesce(new.submitted_at, now());
      new.sla_due_at := v_base + interval '48 hours';
    end if;

    if new.status in ('approved', 'rejected', 'withdrawn', 'draft') then
      new.sla_due_at := null;
      if v_recompute_next_action then
        new.next_action := case
          when new.status in ('approved', 'rejected') then 'close_out'
          else 'none'
        end;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_eapp_ops_defaults on public.employer_applications;
create trigger trg_eapp_ops_defaults
  before insert or update of status, submitted_at, next_action, sla_due_at
  on public.employer_applications
  for each row execute function public.tg_employer_applications_ops_defaults();

-- Backfill open queue rows.
update public.employer_applications
set
  next_action = case status
    when 'submitted' then 'open_review'
    when 'under_review' then 'decide'
    when 'changes_requested' then 'await_employer'
    else coalesce(next_action, 'none')
  end,
  sla_due_at = case
    when status in ('submitted', 'under_review') and submitted_at is not null
      then coalesce(sla_due_at, submitted_at + interval '48 hours')
    else null
  end
where status in ('submitted', 'under_review', 'changes_requested')
  and (next_action is null or (status in ('submitted', 'under_review') and sla_due_at is null));

-- ---------------------------------------------------------------------------
-- Feature flag: franchise finance attribution (default OFF)
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, is_enabled, notes) values
  (
    'franchise_finance_attribution',
    false,
    'When false, franchise finance UI shows Attribution rules not configured and must not label P&L.'
  )
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Ownership rule (documented + enforced):
-- 1. Future access follows assigned_org_id (queue) and employer parent_id after approval.
-- 2. franchise_admin / operations may reassign owner_user_id WITHIN the same assigned_org_id.
-- 3. Cross-franchise / HQ queue moves remain HQ-only (reassign_employer_application).
-- 4. Every owner change writes employer_application_events + audit_logs.
-- ---------------------------------------------------------------------------
create or replace function public.reassign_employer_application_owner(
  p_application_id uuid,
  p_owner_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.employer_applications%rowtype;
  v_prev_owner uuid;
  v_actor uuid := auth.uid();
  v_can boolean := false;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_app
  from public.employer_applications
  where id = p_application_id
  for update;

  if not found then
    -- Do not leak whether the id exists in another franchise.
    raise exception 'Application not found';
  end if;

  if v_app.assigned_org_id is null then
    raise exception 'Application not found';
  end if;

  -- Caller must be franchise_admin or operations on the assigned org, or HQ.
  if public.auth_is_hq() then
    v_can := true;
  elsif exists (
    select 1
    from public.memberships m
    where m.user_id = v_actor
      and m.organization_id = v_app.assigned_org_id
      and m.role in ('franchise_admin', 'operations')
      and m.status = 'active'
  ) then
    v_can := true;
  end if;

  if not v_can then
    raise exception 'Application not found';
  end if;

  -- New owner must be an active staff member of the SAME assigned franchise.
  if p_owner_user_id is not null and not exists (
    select 1
    from public.memberships m
    where m.user_id = p_owner_user_id
      and m.organization_id = v_app.assigned_org_id
      and m.role in ('franchise_admin', 'operations', 'recruiter', 'accounts')
      and m.status = 'active'
  ) then
    raise exception 'Owner must belong to the assigned franchise';
  end if;

  v_prev_owner := v_app.owner_user_id;

  if v_prev_owner is not distinct from p_owner_user_id then
    return;
  end if;

  update public.employer_applications
  set owner_user_id = p_owner_user_id
  where id = v_app.id;

  insert into public.employer_application_events
    (application_id, actor_id, action, from_status, to_status, assigned_org_id,
     visible_to_employer, message, metadata)
  values (
    v_app.id,
    v_actor,
    'owner_reassigned',
    v_app.status,
    v_app.status,
    v_app.assigned_org_id,
    false,
    'Review owner updated',
    jsonb_build_object(
      'previous_owner_user_id', v_prev_owner,
      'owner_user_id', p_owner_user_id
    )
  );

  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value)
  values (
    v_actor,
    'employer_application.owner_reassigned',
    'employer_application',
    v_app.id,
    v_app.assigned_org_id,
    jsonb_build_object('owner_user_id', v_prev_owner),
    jsonb_build_object('owner_user_id', p_owner_user_id)
  );
end;
$$;

revoke all on function public.reassign_employer_application_owner(uuid, uuid) from public;
grant execute on function public.reassign_employer_application_owner(uuid, uuid) to authenticated;

comment on function public.reassign_employer_application_owner(uuid, uuid) is
  'Reassigns employer_applications.owner_user_id within the same assigned_org_id. Cross-franchise queue moves remain HQ-only.';

comment on column public.employer_applications.owner_user_id is
  'Operational owner inside assigned_org_id. Does not change franchise queue scope.';
comment on column public.employer_applications.sla_due_at is
  'Review SLA deadline for open employer applications.';
comment on column public.employer_applications.next_action is
  'Suggested next operational action for the assigned franchise queue.';
