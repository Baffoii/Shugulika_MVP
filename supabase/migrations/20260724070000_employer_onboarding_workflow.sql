-- =============================================================================
-- Employer onboarding — Workflow 1 (functional spec, 24 Jul 2026).
-- Company registration during sign-up, geographically scoped review, and
-- atomic approval that activates the employer organization and its first
-- administrator membership.
--
-- Design notes
-- • A dedicated employer_applications record drives the journey
--   (draft → submitted → under_review → changes_requested/approved/rejected/
--   withdrawn). Organization + membership stay separate records.
-- • Geographic scoping is enforced HERE (RLS + definer RPCs), not just in
--   queue filters: a franchise can only see applications assigned to it AND
--   whose registered geography falls inside its configured coverage.
-- • Every reviewer decision goes through a SECURITY DEFINER RPC that records
--   actor, previous/new status, responsible organization, an immutable
--   audit_logs row, and notifications.
-- • Verification-document upload is deferred (per spec); tax id and company
--   registration numbers are intentionally NOT collected.
-- =============================================================================

-- ---- Organizations: employer identity/address + franchise coverage ---------
alter table public.organizations
  add column if not exists trading_name text,
  add column if not exists legal_type text,
  add column if not exists year_established int,
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists physical_address text,
  add column if not exists postal_address text,
  -- Franchise geographic coverage inside its country. NULL = whole country.
  add column if not exists coverage_regions text[];

-- Existing active employer organizations predate this workflow; treat them as
-- verified so previously provisioned accounts keep working (the new access
-- gate requires an active + verified employer organization).
update public.organizations
set verification_status = 'verified'
where org_type = 'employer' and status = 'active' and verification_status = 'pending';

-- ---- Memberships: first employer administrator flag -------------------------
alter table public.memberships
  add column if not exists is_org_admin boolean not null default false;

-- Existing scoped employer users were provisioned as their company's admin.
update public.memberships
set is_org_admin = true
where role = 'employer_user' and status = 'active' and organization_id is not null;

-- Post-approval editing guard: the first employer administrator may update
-- ordinary company details directly, but registered legal name, country,
-- responsible franchise, status, and verification changes require Shugulika
-- review (HQ). Enforced here so RLS's broad org write policy cannot bypass it.
create or replace function public.tg_org_protect_sensitive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Definer RPCs / service contexts (no authenticated user) are trusted.
  if auth.uid() is null or public.auth_is_hq() then
    return new;
  end if;
  if old.org_type = 'employer' and (
    new.name is distinct from old.name
    or new.country_code is distinct from old.country_code
    or new.parent_id is distinct from old.parent_id
    or new.org_type is distinct from old.org_type
    or new.status is distinct from old.status
    or new.verification_status is distinct from old.verification_status
  ) then
    raise exception 'Registered name, country, responsible office, and status changes require Shugulika review';
  end if;
  return new;
end $$;

drop trigger if exists trg_org_protect_sensitive on public.organizations;
create trigger trg_org_protect_sensitive
  before update on public.organizations
  for each row execute function public.tg_org_protect_sensitive();

-- ---- Employer onboarding applications ---------------------------------------
create table if not exists public.employer_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft' check (status in
    ('draft','submitted','under_review','changes_requested','approved','rejected','withdrawn')),
  version int not null default 1,

  -- Company identity (no tax id / registration number in this version).
  legal_name text,
  trading_name text,
  organization_type text,
  industry text,
  company_size text,
  year_established int check (year_established is null or year_established between 1800 and 2100),
  website text,

  -- Registered address.
  country_code text references public.countries(code),
  region text,
  city text,
  physical_address text,
  postal_address text,

  -- Primary contact (defaults to the signing-up user).
  contact_name text,
  contact_job_title text,
  contact_email text,
  contact_phone text,
  contact_is_authorized boolean not null default false,

  -- Shugulika assignment / routing.
  routing_mode text not null default 'auto' check (routing_mode in ('auto','franchise','hq')),
  requested_franchise_id uuid references public.organizations(id),
  -- Responsible review queue. NULL = HQ queue (no franchise visibility).
  assigned_org_id uuid references public.organizations(id),

  -- Declarations.
  declared_accurate boolean not null default false,
  declared_authorized boolean not null default false,
  accepted_terms boolean not null default false,

  -- Duplicate detection (computed at submission; never leaks private details).
  duplicate_warning boolean not null default false,
  duplicate_reasons text[] not null default '{}',

  -- Reviewer decision.
  changes_requested_message text,
  requested_changes jsonb not null default '[]'::jsonb,
  rejection_category text check (rejection_category is null or rejection_category in
    ('duplicate_company','information_mismatch','ineligible_geography',
     'not_a_genuine_employer','policy_violation','other')),
  rejection_reason text,
  reapply_allowed boolean,

  -- Lifecycle links.
  previous_application_id uuid references public.employer_applications(id),
  resulting_org_id uuid references public.organizations(id),

  submitted_at timestamptz,
  first_submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_eapp_status on public.employer_applications(status);
create index if not exists idx_eapp_assigned on public.employer_applications(assigned_org_id);
create index if not exists idx_eapp_applicant on public.employer_applications(applicant_user_id);
create index if not exists idx_eapp_country on public.employer_applications(country_code);

-- One open application per user prevents duplicate organizations on resume.
create unique index if not exists uq_eapp_open_per_user
  on public.employer_applications (applicant_user_id)
  where status in ('draft','submitted','under_review','changes_requested');

create or replace function public.tg_employer_applications_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_eapp_touch on public.employer_applications;
create trigger trg_eapp_touch before update on public.employer_applications
  for each row execute function public.tg_employer_applications_touch();

-- ---- Application events: decision history, timeline, internal notes ---------
-- visible_to_employer=false rows are reviewer-only (internal notes, private
-- decision context). Append-only: no update/delete policies exist.
create table if not exists public.employer_application_events (
  id bigint generated always as identity primary key,
  application_id uuid not null references public.employer_applications(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  action text not null,
  from_status text,
  to_status text,
  assigned_org_id uuid references public.organizations(id),
  message text,
  visible_to_employer boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_eaev_application on public.employer_application_events(application_id);

-- ---- Helper: which franchises are eligible for a geography ------------------
-- Active franchises covering the country and (when configured) the region.
-- Exposed to authenticated users so the registration form can propose routing;
-- returns only franchise identity, never other applications' data.
create or replace function public.eligible_employer_franchises(p_country text, p_region text default null)
returns table (id uuid, name text, country_code text, coverage_regions text[])
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.country_code, o.coverage_regions
  from public.organizations o
  where o.org_type = 'franchise'
    and o.status = 'active'
    and o.country_code = p_country
    and (
      o.coverage_regions is null
      or p_region is null
      or exists (select 1 from unnest(o.coverage_regions) r where lower(r) = lower(p_region))
    )
  order by o.name;
$$;
revoke all on function public.eligible_employer_franchises(text, text) from public;
grant execute on function public.eligible_employer_franchises(text, text) to authenticated;

-- ---- Helper: reviewer authority over one application -------------------------
-- HQ sees everything. A franchise admin sees an application ONLY when it is
-- assigned to their franchise AND its registered geography is inside the
-- franchise's configured coverage (defense in depth against bad assignments).
create or replace function public.auth_is_employer_app_reviewer(p_application_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employer_applications a
    where a.id = p_application_id
      and (
        public.auth_is_hq()
        or (
          a.assigned_org_id is not null
          and exists (
            select 1 from public.memberships m
            where m.user_id = auth.uid()
              and m.status = 'active'
              and m.role = 'franchise_admin'
              and m.organization_id = a.assigned_org_id
          )
          and exists (
            select 1 from public.organizations f
            where f.id = a.assigned_org_id
              and f.org_type = 'franchise'
              and f.status = 'active'
              and f.country_code = a.country_code
              and (
                f.coverage_regions is null
                or a.region is null
                or exists (select 1 from unnest(f.coverage_regions) r
                           where lower(r) = lower(a.region))
              )
          )
        )
      )
  );
$$;
revoke all on function public.auth_is_employer_app_reviewer(uuid) from public;
grant execute on function public.auth_is_employer_app_reviewer(uuid) to authenticated;

-- ---- RLS ---------------------------------------------------------------------
alter table public.employer_applications enable row level security;
alter table public.employer_application_events enable row level security;

-- The blanket grants in 0002 predate these tables. Row access is still fully
-- governed by the policies below; events are written only by definer RPCs.
grant select, insert, update on public.employer_applications to authenticated;
grant select on public.employer_application_events to authenticated;

-- Applicant: read own; create drafts; edit only while draft / changes requested.
-- Submitted and under-review applications are read-only for the applicant.
create policy eapp_owner_read on public.employer_applications
  for select to authenticated
  using (applicant_user_id = auth.uid());

create policy eapp_owner_insert on public.employer_applications
  for insert to authenticated
  with check (
    applicant_user_id = auth.uid()
    and status = 'draft'
    and public.auth_has_role('employer_user')
  );

create policy eapp_owner_update on public.employer_applications
  for update to authenticated
  using (applicant_user_id = auth.uid() and status in ('draft','changes_requested'))
  with check (applicant_user_id = auth.uid() and status in ('draft','changes_requested'));

-- Reviewers: geographically scoped read. All writes go through definer RPCs.
create policy eapp_reviewer_read on public.employer_applications
  for select to authenticated
  using (public.auth_is_employer_app_reviewer(id));

-- Events: applicant sees only employer-visible rows on their own application;
-- reviewers see everything in their scope. Insert happens inside definer RPCs.
create policy eaev_owner_read on public.employer_application_events
  for select to authenticated
  using (
    visible_to_employer
    and exists (
      select 1 from public.employer_applications a
      where a.id = employer_application_events.application_id
        and a.applicant_user_id = auth.uid()
    )
  );

create policy eaev_reviewer_read on public.employer_application_events
  for select to authenticated
  using (public.auth_is_employer_app_reviewer(application_id));

-- Reviewers may resolve the applicant's name/email for the queue and detail view.
create policy profiles_employer_app_reviewer_read on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.employer_applications a
      where a.applicant_user_id = profiles.id
        and public.auth_is_employer_app_reviewer(a.id)
    )
  );

-- The applicant may read the franchise/HQ organization handling their
-- application (name of the responsible Shugulika office).
create policy org_applicant_assigned_read on public.organizations
  for select to authenticated
  using (
    org_type in ('franchise','hq')
    and exists (
      select 1 from public.employer_applications a
      where a.applicant_user_id = auth.uid()
        and (a.assigned_org_id = organizations.id or a.requested_franchise_id = organizations.id)
    )
  );

-- ---- Notification fan-out for a review queue ---------------------------------
create or replace function public.notify_employer_application_queue(
  p_application_id uuid,
  p_title text,
  p_body text
)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_app public.employer_applications%rowtype;
  v_count int := 0;
  v_extra int := 0;
begin
  select * into v_app from public.employer_applications where id = p_application_id;
  if not found then return 0; end if;

  -- HQ always sees every application.
  select public.notify_hq_admins('employer_application', p_title, p_body,
                                 'employer_application', p_application_id) into v_count;

  if v_app.assigned_org_id is not null then
    insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
    select distinct m.user_id, 'employer_application', p_title, p_body,
                    'employer_application', p_application_id
    from public.memberships m
    where m.organization_id = v_app.assigned_org_id
      and m.status = 'active'
      and m.role = 'franchise_admin';
    get diagnostics v_extra = row_count;
  end if;

  return v_count + v_extra;
end $$;
revoke all on function public.notify_employer_application_queue(uuid, text, text) from public;

-- ---- Internal helpers ----------------------------------------------------------
create or replace function public.employer_app_snapshot(a public.employer_applications)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'legal_name', a.legal_name, 'trading_name', a.trading_name,
    'organization_type', a.organization_type, 'industry', a.industry,
    'company_size', a.company_size, 'year_established', a.year_established,
    'website', a.website, 'country_code', a.country_code, 'region', a.region,
    'city', a.city, 'physical_address', a.physical_address,
    'postal_address', a.postal_address, 'contact_name', a.contact_name,
    'contact_job_title', a.contact_job_title, 'contact_email', a.contact_email,
    'contact_phone', a.contact_phone, 'routing_mode', a.routing_mode,
    'requested_franchise_id', a.requested_franchise_id, 'version', a.version
  );
$$;

-- ---- RPC: submit (and resubmit) ------------------------------------------------
create or replace function public.submit_employer_application(p_application_id uuid)
returns public.employer_applications
language plpgsql security definer set search_path = public as $$
declare
  v_app public.employer_applications%rowtype;
  v_is_resubmit boolean;
  v_assigned uuid;
  v_eligible_count int;
  v_norm_name text;
  v_domain text;
  v_dupes text[] := '{}';
  v_country_active boolean;
begin
  select * into v_app from public.employer_applications
  where id = p_application_id for update;

  if not found or v_app.applicant_user_id <> auth.uid() then
    raise exception 'Application not found or not authorized';
  end if;
  if v_app.status not in ('draft','changes_requested') then
    raise exception 'Only draft or changes-requested applications can be submitted';
  end if;

  -- Required-field validation (mirrors the client, enforced server-side).
  if coalesce(trim(v_app.legal_name), '') = '' then raise exception 'Registered company name is required'; end if;
  if coalesce(trim(v_app.organization_type), '') = '' then raise exception 'Organization type is required'; end if;
  if coalesce(trim(v_app.industry), '') = '' then raise exception 'Industry is required'; end if;
  if coalesce(trim(v_app.company_size), '') = '' then raise exception 'Company size is required'; end if;
  if v_app.country_code is null then raise exception 'Country is required'; end if;
  if coalesce(trim(v_app.region), '') = '' then raise exception 'Region/state/province is required'; end if;
  if coalesce(trim(v_app.city), '') = '' then raise exception 'City is required'; end if;
  if coalesce(trim(v_app.physical_address), '') = '' then raise exception 'Physical address is required'; end if;
  if coalesce(trim(v_app.contact_name), '') = '' then raise exception 'Contact person is required'; end if;
  if coalesce(trim(v_app.contact_job_title), '') = '' then raise exception 'Contact job title is required'; end if;
  if coalesce(trim(v_app.contact_email), '') = '' then raise exception 'Contact work email is required'; end if;
  if coalesce(trim(v_app.contact_phone), '') = '' then raise exception 'Contact phone number is required'; end if;
  if not v_app.contact_is_authorized then raise exception 'Confirm the contact person is authorized to administer the account'; end if;
  if not (v_app.declared_accurate and v_app.declared_authorized and v_app.accepted_terms) then
    raise exception 'All declarations must be accepted before submitting';
  end if;

  select c.is_active into v_country_active from public.countries c where c.code = v_app.country_code;
  if not coalesce(v_country_active, false) then
    raise exception 'The selected country is not supported yet';
  end if;

  -- Routing: resolve the responsible review queue from registered geography.
  if v_app.routing_mode = 'hq' then
    v_assigned := null;
  elsif v_app.routing_mode = 'franchise' then
    if v_app.requested_franchise_id is null then
      raise exception 'Choose a Shugulika office or request HQ assignment';
    end if;
    if not exists (
      select 1 from public.eligible_employer_franchises(v_app.country_code, v_app.region) f
      where f.id = v_app.requested_franchise_id
    ) then
      raise exception 'The selected Shugulika office is not eligible for your company geography';
    end if;
    v_assigned := v_app.requested_franchise_id;
  else -- auto
    select count(*) into v_eligible_count
    from public.eligible_employer_franchises(v_app.country_code, v_app.region);
    if v_eligible_count = 1 then
      select f.id into v_assigned
      from public.eligible_employer_franchises(v_app.country_code, v_app.region) f;
    elsif v_eligible_count = 0 then
      v_assigned := null; -- no eligible franchise -> HQ approval queue
    else
      raise exception 'Multiple Shugulika offices serve your region — choose one or request HQ assignment';
    end if;
  end if;

  -- Duplicate warning: normalized company name + website domain against
  -- existing employer organizations and other live applications. Only generic
  -- reasons are stored; no private details from other companies are disclosed.
  v_norm_name := regexp_replace(lower(coalesce(v_app.legal_name, '')), '[^a-z0-9]+', '', 'g');
  v_domain := split_part(regexp_replace(lower(coalesce(v_app.website, '')), '^https?://(www\.)?', ''), '/', 1);

  if v_norm_name <> '' and (
    exists (
      select 1 from public.organizations o
      where o.org_type = 'employer'
        and o.country_code is not distinct from v_app.country_code
        and regexp_replace(lower(o.name), '[^a-z0-9]+', '', 'g') = v_norm_name
    )
    or exists (
      select 1 from public.employer_applications a2
      where a2.id <> v_app.id
        and a2.status in ('submitted','under_review','approved')
        and a2.country_code is not distinct from v_app.country_code
        and regexp_replace(lower(coalesce(a2.legal_name, '')), '[^a-z0-9]+', '', 'g') = v_norm_name
    )
  ) then
    v_dupes := array_append(v_dupes, 'A company with a very similar name is already registered in this country.');
  end if;

  if v_domain <> '' and (
    exists (
      select 1 from public.organizations o
      where o.org_type = 'employer'
        and split_part(regexp_replace(lower(coalesce(o.website, '')), '^https?://(www\.)?', ''), '/', 1) = v_domain
    )
    or exists (
      select 1 from public.employer_applications a2
      where a2.id <> v_app.id
        and a2.status in ('submitted','under_review','approved')
        and split_part(regexp_replace(lower(coalesce(a2.website, '')), '^https?://(www\.)?', ''), '/', 1) = v_domain
    )
  ) then
    v_dupes := array_append(v_dupes, 'Another registration uses the same website domain.');
  end if;

  v_is_resubmit := v_app.status = 'changes_requested';

  update public.employer_applications
  set status = 'submitted',
      assigned_org_id = v_assigned,
      version = case when v_is_resubmit then version + 1 else version end,
      submitted_at = now(),
      first_submitted_at = coalesce(first_submitted_at, now()),
      duplicate_warning = coalesce(array_length(v_dupes, 1), 0) > 0,
      duplicate_reasons = v_dupes
  where id = v_app.id
  returning * into v_app;

  insert into public.employer_application_events
    (application_id, actor_id, action, from_status, to_status, assigned_org_id,
     message, visible_to_employer, metadata)
  values
    (v_app.id, auth.uid(),
     case when v_is_resubmit then 'resubmitted' else 'submitted' end,
     case when v_is_resubmit then 'changes_requested' else 'draft' end,
     'submitted', v_assigned,
     null, true,
     jsonb_build_object('snapshot', public.employer_app_snapshot(v_app),
                        'duplicate_reasons', to_jsonb(v_dupes)));

  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata)
  values
    (auth.uid(),
     case when v_is_resubmit then 'employer_application.resubmitted' else 'employer_application.submitted' end,
     'employer_application', v_app.id, v_assigned,
     jsonb_build_object('status', case when v_is_resubmit then 'changes_requested' else 'draft' end),
     jsonb_build_object('status', 'submitted', 'version', v_app.version),
     jsonb_build_object('duplicate_warning', v_app.duplicate_warning));

  perform public.notify_employer_application_queue(
    v_app.id,
    case when v_is_resubmit then 'Employer application resubmitted' else 'New employer application' end,
    coalesce(v_app.legal_name, 'An employer') || ' (' || coalesce(v_app.country_code, '—') ||
      coalesce(', ' || v_app.region, '') || ') is awaiting review.');

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  values (v_app.applicant_user_id, 'employer_application',
          'Application received',
          'Your company registration was submitted to Shugulika for review. We will notify you of the decision.',
          'employer_application', v_app.id);

  return v_app;
end $$;
revoke all on function public.submit_employer_application(uuid) from public;
grant execute on function public.submit_employer_application(uuid) to authenticated;

-- ---- RPC: withdraw before review ------------------------------------------------
create or replace function public.withdraw_employer_application(p_application_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_app public.employer_applications%rowtype;
begin
  select * into v_app from public.employer_applications
  where id = p_application_id for update;

  if not found or v_app.applicant_user_id <> auth.uid() then
    raise exception 'Application not found or not authorized';
  end if;
  if v_app.status not in ('draft','submitted') then
    raise exception 'Only draft or submitted applications can be withdrawn';
  end if;

  update public.employer_applications
  set status = 'withdrawn', decided_at = now()
  where id = v_app.id;

  insert into public.employer_application_events
    (application_id, actor_id, action, from_status, to_status, visible_to_employer)
  values (v_app.id, auth.uid(), 'withdrawn', v_app.status, 'withdrawn', true);

  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value)
  values (auth.uid(), 'employer_application.withdrawn', 'employer_application',
          v_app.id, v_app.assigned_org_id,
          jsonb_build_object('status', v_app.status),
          jsonb_build_object('status', 'withdrawn'));
end $$;
revoke all on function public.withdraw_employer_application(uuid) from public;
grant execute on function public.withdraw_employer_application(uuid) to authenticated;

-- ---- RPC: open for review ---------------------------------------------------------
create or replace function public.open_employer_application_review(p_application_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_app public.employer_applications%rowtype;
begin
  select * into v_app from public.employer_applications
  where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if not public.auth_is_employer_app_reviewer(v_app.id) then
    raise exception 'You are not authorized to review this application';
  end if;
  if v_app.status <> 'submitted' then
    raise exception 'Only submitted applications can be opened for review';
  end if;

  update public.employer_applications set status = 'under_review' where id = v_app.id;

  insert into public.employer_application_events
    (application_id, actor_id, action, from_status, to_status, assigned_org_id, visible_to_employer)
  values (v_app.id, auth.uid(), 'review_opened', 'submitted', 'under_review', v_app.assigned_org_id, true);

  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value)
  values (auth.uid(), 'employer_application.review_opened', 'employer_application',
          v_app.id, v_app.assigned_org_id,
          jsonb_build_object('status', 'submitted'),
          jsonb_build_object('status', 'under_review'));
end $$;
revoke all on function public.open_employer_application_review(uuid) from public;
grant execute on function public.open_employer_application_review(uuid) to authenticated;

-- ---- RPC: approve (single atomic transaction) --------------------------------------
-- Verifies reviewer authority + franchise eligibility, activates the verified
-- employer organization, ends the unscoped sign-up membership, creates the one
-- scoped first-administrator membership, and records audit + notification.
create or replace function public.approve_employer_application(p_application_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_app public.employer_applications%rowtype;
  v_parent uuid;
  v_org uuid;
  v_office_name text;
begin
  select * into v_app from public.employer_applications
  where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if not public.auth_is_employer_app_reviewer(v_app.id) then
    raise exception 'You are not authorized to approve this application';
  end if;
  if v_app.status not in ('submitted','under_review') then
    raise exception 'Only submitted or under-review applications can be approved';
  end if;

  -- Responsible organization: assigned franchise must still be active and
  -- geographically eligible; otherwise HQ is the responsible organization.
  if v_app.assigned_org_id is not null then
    if not exists (
      select 1 from public.eligible_employer_franchises(v_app.country_code, v_app.region) f
      where f.id = v_app.assigned_org_id
    ) then
      raise exception 'The assigned franchise is no longer active or eligible for this geography — reassign before approving';
    end if;
    v_parent := v_app.assigned_org_id;
  else
    select o.id into v_parent from public.organizations o
    where o.org_type = 'hq' order by o.created_at limit 1;
    if v_parent is null then raise exception 'No HQ organization is configured'; end if;
  end if;
  select o.name into v_office_name from public.organizations o where o.id = v_parent;

  -- 1) Activate the verified employer organization.
  insert into public.organizations
    (org_type, name, trading_name, legal_type, industry, website, company_size,
     year_established, country_code, region, city, physical_address, postal_address,
     parent_id, status, verification_status)
  values
    ('employer', v_app.legal_name, v_app.trading_name, v_app.organization_type,
     v_app.industry, v_app.website, v_app.company_size, v_app.year_established,
     v_app.country_code, v_app.region, v_app.city, v_app.physical_address,
     v_app.postal_address, v_parent, 'active', 'verified')
  returning id into v_org;

  -- 2) End the original unscoped sign-up membership …
  update public.memberships
  set status = 'ended'
  where user_id = v_app.applicant_user_id
    and role = 'employer_user'
    and organization_id is null
    and status <> 'ended';

  -- 3) … and create exactly one active membership scoped to the new
  --    organization, marked as the company's first employer administrator.
  insert into public.memberships (user_id, organization_id, role, country_code, status, is_org_admin)
  values (v_app.applicant_user_id, v_org, 'employer_user', v_app.country_code, 'active', true);

  -- 4) Mark onboarding approved.
  update public.employer_applications
  set status = 'approved', resulting_org_id = v_org, decided_at = now(), decided_by = auth.uid()
  where id = v_app.id;

  insert into public.employer_application_events
    (application_id, actor_id, action, from_status, to_status, assigned_org_id, message, visible_to_employer)
  values (v_app.id, auth.uid(), 'approved', v_app.status, 'approved', v_parent,
          'Company approved. The employer portal is now unlocked.', true);

  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata)
  values
    (auth.uid(), 'employer_application.approved', 'employer_application', v_app.id, v_parent,
     jsonb_build_object('status', v_app.status),
     jsonb_build_object('status', 'approved', 'organization_id', v_org),
     jsonb_build_object('responsible_org_id', v_parent)),
    (auth.uid(), 'organization.activated_verified', 'organization', v_org, v_parent,
     null,
     jsonb_build_object('status', 'active', 'verification_status', 'verified'),
     jsonb_build_object('application_id', v_app.id)),
    (auth.uid(), 'membership.first_admin_activated', 'membership', null, v_org,
     null,
     jsonb_build_object('user_id', v_app.applicant_user_id, 'role', 'employer_user', 'is_org_admin', true),
     jsonb_build_object('application_id', v_app.id));

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  values (v_app.applicant_user_id, 'employer_application',
          'Your company was approved',
          coalesce(v_app.legal_name, 'Your company') || ' is now active. Responsible Shugulika office: ' ||
            coalesce(v_office_name, 'Shugulika HQ') || '. You can now use the employer dashboard.',
          'employer_application', v_app.id);

  return v_org;
end $$;
revoke all on function public.approve_employer_application(uuid) from public;
grant execute on function public.approve_employer_application(uuid) to authenticated;

-- ---- RPC: request changes -------------------------------------------------------------
create or replace function public.request_employer_application_changes(
  p_application_id uuid,
  p_message text,
  p_changes jsonb default '[]'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_app public.employer_applications%rowtype;
begin
  select * into v_app from public.employer_applications
  where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if not public.auth_is_employer_app_reviewer(v_app.id) then
    raise exception 'You are not authorized to review this application';
  end if;
  if v_app.status not in ('submitted','under_review') then
    raise exception 'Changes can only be requested on submitted or under-review applications';
  end if;
  if length(trim(coalesce(p_message, ''))) < 8 then
    raise exception 'Provide a general explanation (at least 8 characters)';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) < 1 then
    raise exception 'List at least one required change';
  end if;

  update public.employer_applications
  set status = 'changes_requested',
      changes_requested_message = trim(p_message),
      requested_changes = p_changes
  where id = v_app.id;

  insert into public.employer_application_events
    (application_id, actor_id, action, from_status, to_status, assigned_org_id,
     message, visible_to_employer, metadata)
  values (v_app.id, auth.uid(), 'changes_requested', v_app.status, 'changes_requested',
          v_app.assigned_org_id, trim(p_message), true,
          jsonb_build_object('requested_changes', p_changes));

  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata)
  values (auth.uid(), 'employer_application.changes_requested', 'employer_application',
          v_app.id, v_app.assigned_org_id,
          jsonb_build_object('status', v_app.status),
          jsonb_build_object('status', 'changes_requested'),
          jsonb_build_object('requested_changes', p_changes));

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  values (v_app.applicant_user_id, 'employer_application',
          'Changes requested on your application',
          trim(p_message), 'employer_application', v_app.id);
end $$;
revoke all on function public.request_employer_application_changes(uuid, text, jsonb) from public;
grant execute on function public.request_employer_application_changes(uuid, text, jsonb) to authenticated;

-- ---- RPC: reject ------------------------------------------------------------------------
create or replace function public.reject_employer_application(
  p_application_id uuid,
  p_category text,
  p_reason text,
  p_reapply_allowed boolean,
  p_internal_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_app public.employer_applications%rowtype;
begin
  select * into v_app from public.employer_applications
  where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if not public.auth_is_employer_app_reviewer(v_app.id) then
    raise exception 'You are not authorized to review this application';
  end if;
  if v_app.status not in ('submitted','under_review') then
    raise exception 'Only submitted or under-review applications can be rejected';
  end if;
  if p_category not in ('duplicate_company','information_mismatch','ineligible_geography',
                        'not_a_genuine_employer','policy_violation','other') then
    raise exception 'Choose a structured rejection category';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Provide an employer-facing rejection reason (at least 8 characters)';
  end if;

  update public.employer_applications
  set status = 'rejected',
      rejection_category = p_category,
      rejection_reason = trim(p_reason),
      reapply_allowed = coalesce(p_reapply_allowed, false),
      decided_at = now(),
      decided_by = auth.uid()
  where id = v_app.id;

  insert into public.employer_application_events
    (application_id, actor_id, action, from_status, to_status, assigned_org_id,
     message, visible_to_employer, metadata)
  values (v_app.id, auth.uid(), 'rejected', v_app.status, 'rejected', v_app.assigned_org_id,
          trim(p_reason), true,
          jsonb_build_object('category', p_category, 'reapply_allowed', coalesce(p_reapply_allowed, false)));

  if length(trim(coalesce(p_internal_note, ''))) > 0 then
    insert into public.employer_application_events
      (application_id, actor_id, action, message, visible_to_employer)
    values (v_app.id, auth.uid(), 'note', trim(p_internal_note), false);
  end if;

  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value, metadata)
  values (auth.uid(), 'employer_application.rejected', 'employer_application',
          v_app.id, v_app.assigned_org_id,
          jsonb_build_object('status', v_app.status),
          jsonb_build_object('status', 'rejected'),
          jsonb_build_object('category', p_category, 'reapply_allowed', coalesce(p_reapply_allowed, false)));

  insert into public.notifications (user_id, category, title, body, subject_type, subject_id)
  values (v_app.applicant_user_id, 'employer_application',
          'Your application was not approved',
          trim(p_reason) || case when coalesce(p_reapply_allowed, false)
            then ' You may submit a revised application.'
            else ' Contact support if you believe this is a mistake.' end,
          'employer_application', v_app.id);
end $$;
revoke all on function public.reject_employer_application(uuid, text, text, boolean, text) from public;
grant execute on function public.reject_employer_application(uuid, text, text, boolean, text) to authenticated;

-- ---- RPC: assign / reassign (HQ only) --------------------------------------------------
-- Immediately changes which franchise can access the application (RLS keys off
-- assigned_org_id). p_org_id null sends the application to the HQ queue.
create or replace function public.reassign_employer_application(
  p_application_id uuid,
  p_org_id uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_app public.employer_applications%rowtype;
begin
  if not public.auth_is_hq() then
    raise exception 'Only HQ can assign or reassign employer applications';
  end if;

  select * into v_app from public.employer_applications
  where id = p_application_id for update;
  if not found then raise exception 'Application not found'; end if;
  if v_app.status not in ('submitted','under_review') then
    raise exception 'Only submitted or under-review applications can be reassigned';
  end if;

  if p_org_id is not null and not exists (
    select 1 from public.eligible_employer_franchises(v_app.country_code, v_app.region) f
    where f.id = p_org_id
  ) then
    raise exception 'That franchise is not eligible for this application''s geography';
  end if;

  update public.employer_applications set assigned_org_id = p_org_id where id = v_app.id;

  insert into public.employer_application_events
    (application_id, actor_id, action, from_status, to_status, assigned_org_id,
     visible_to_employer, metadata)
  values (v_app.id, auth.uid(), 'reassigned', v_app.status, v_app.status, p_org_id, true,
          jsonb_build_object('previous_assigned_org_id', v_app.assigned_org_id));

  insert into public.audit_logs
    (actor_id, action, entity_type, entity_id, org_context_id, before_value, after_value)
  values (auth.uid(), 'employer_application.reassigned', 'employer_application',
          v_app.id, p_org_id,
          jsonb_build_object('assigned_org_id', v_app.assigned_org_id),
          jsonb_build_object('assigned_org_id', p_org_id));

  perform public.notify_employer_application_queue(
    v_app.id, 'Employer application assigned to your queue',
    coalesce(v_app.legal_name, 'An employer application') || ' now requires your review.');
end $$;
revoke all on function public.reassign_employer_application(uuid, uuid) from public;
grant execute on function public.reassign_employer_application(uuid, uuid) to authenticated;

-- ---- RPC: internal reviewer note ---------------------------------------------------------
create or replace function public.add_employer_application_note(
  p_application_id uuid,
  p_note text
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.auth_is_employer_app_reviewer(p_application_id) then
    raise exception 'You are not authorized to add notes on this application';
  end if;
  if length(trim(coalesce(p_note, ''))) < 2 then
    raise exception 'Enter a note';
  end if;
  insert into public.employer_application_events
    (application_id, actor_id, action, message, visible_to_employer)
  values (p_application_id, auth.uid(), 'note', trim(p_note), false);
end $$;
revoke all on function public.add_employer_application_note(uuid, text) from public;
grant execute on function public.add_employer_application_note(uuid, text) to authenticated;

-- ---- RPC: start a revised application after rejection / withdrawal ----------------------
-- Preserves the closed application as immutable history and links the new one.
create or replace function public.start_revised_employer_application(p_previous_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_prev public.employer_applications%rowtype;
  v_new uuid;
begin
  select * into v_prev from public.employer_applications
  where id = p_previous_id for update;
  if not found or v_prev.applicant_user_id <> auth.uid() then
    raise exception 'Application not found or not authorized';
  end if;
  if v_prev.status not in ('rejected','withdrawn') then
    raise exception 'A revised application can only follow a rejected or withdrawn one';
  end if;
  if v_prev.status = 'rejected' and not coalesce(v_prev.reapply_allowed, false) then
    raise exception 'Reapplication was not allowed for this application';
  end if;
  if exists (
    select 1 from public.employer_applications a
    where a.applicant_user_id = auth.uid()
      and a.status in ('draft','submitted','under_review','changes_requested')
  ) then
    raise exception 'You already have an application in progress';
  end if;

  insert into public.employer_applications
    (applicant_user_id, status, legal_name, trading_name, organization_type, industry,
     company_size, year_established, website, country_code, region, city,
     physical_address, postal_address, contact_name, contact_job_title, contact_email,
     contact_phone, contact_is_authorized, routing_mode, requested_franchise_id,
     previous_application_id)
  values
    (auth.uid(), 'draft', v_prev.legal_name, v_prev.trading_name, v_prev.organization_type,
     v_prev.industry, v_prev.company_size, v_prev.year_established, v_prev.website,
     v_prev.country_code, v_prev.region, v_prev.city, v_prev.physical_address,
     v_prev.postal_address, v_prev.contact_name, v_prev.contact_job_title,
     v_prev.contact_email, v_prev.contact_phone, v_prev.contact_is_authorized,
     v_prev.routing_mode, v_prev.requested_franchise_id, v_prev.id)
  returning id into v_new;

  insert into public.employer_application_events
    (application_id, actor_id, action, visible_to_employer, metadata)
  values (v_prev.id, auth.uid(), 'revision_started', true,
          jsonb_build_object('new_application_id', v_new));

  return v_new;
end $$;
revoke all on function public.start_revised_employer_application(uuid) from public;
grant execute on function public.start_revised_employer_application(uuid) to authenticated;
