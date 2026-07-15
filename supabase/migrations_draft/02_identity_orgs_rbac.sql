-- =============================================================================
-- File 02: Identity (Domain A), Organizations & Membership (Domain B), RBAC.
-- =============================================================================

-- ---- Identity --------------------------------------------------------------
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  phone text,
  full_name text,
  display_name text,
  account_status text not null default 'active'
    check (account_status in ('active','invited','suspended','deactivated','pending_deletion')),
  preferred_language text not null default 'en',
  time_zone text not null default 'Africa/Dar_es_Salaam',
  country_id uuid references public.countries(id),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  mfa_enabled boolean not null default false,
  last_login_at timestamptz,
  terms_accepted_version_id uuid,      -- FK -> legal_document_versions (file 07)
  privacy_accepted_version_id uuid,
  is_platform_staff boolean not null default false,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.user_profiles is 'App profile 1:1 with auth.users; NEVER stores credentials.';

create table public.service_actors (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---- Organizations ---------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  organization_type text not null
    check (organization_type in ('platform','hq','country_operation','franchise','employer')),
  legal_name text not null,
  trading_name text,
  slug citext unique,
  country_id uuid references public.countries(id),
  parent_organization_id uuid references public.organizations(id),
  status text not null default 'active' check (status in ('pending','active','suspended','closed')),
  branding_document_id uuid,           -- FK -> documents (file 03) added later
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id),
  updated_by uuid references public.user_profiles(id)
);

alter table public.feature_flags
  add constraint feature_flags_org_fk foreign key (organization_id) references public.organizations(id);

create table public.hq_profiles (
  organization_id uuid primary key references public.organizations(id),
  headquarters_country_id uuid references public.countries(id)
);

create table public.franchise_profiles (
  organization_id uuid primary key references public.organizations(id),
  franchise_owner_user_id uuid references public.user_profiles(id),
  territory text,
  franchise_status text not null default 'onboarding'
    check (franchise_status in ('prospect','onboarding','active','suspended','terminated')),
  agreement_reference text,
  activated_on date
);

create table public.employer_organizations (
  organization_id uuid primary key references public.organizations(id),
  responsible_organization_id uuid not null references public.organizations(id),
  registered_name text not null,
  industry_id uuid references public.industries(id),
  company_size text,
  registration_number text,
  website text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected')),
  employer_status text not null default 'active'
    check (employer_status in ('active','suspended','closed')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.employer_organizations.responsible_organization_id is
  'Owning franchise/HQ. One employer belongs to exactly one responsible org (tenant edge).';

create table public.organization_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  address_type text not null default 'primary',
  line1 text, line2 text, city text, region text,
  country_id uuid references public.countries(id),
  postal_code text, is_primary boolean not null default false
);

create table public.organization_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  contact_type text not null default 'primary',
  name text, email citext, phone text, is_primary boolean not null default false
);

create table public.organization_relationships (
  id uuid primary key default gen_random_uuid(),
  from_organization_id uuid not null references public.organizations(id),
  to_organization_id uuid not null references public.organizations(id),
  relationship_type text not null check (relationship_type in ('oversight','referral','transfer_grant','partner')),
  status text not null default 'active',
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_by uuid references public.user_profiles(id),
  check (from_organization_id <> to_organization_id)
);
comment on table public.organization_relationships is 'Controlled HQ oversight & approved cross-franchise transfer grants (R-003/OD-10).';

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  team_type text not null check (team_type in ('recruiter','accounts','content','hiring','operations')),
  created_at timestamptz not null default now()
);

-- ---- RBAC ------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  scope_level text not null check (scope_level in ('platform','country','franchise','employer','self')),
  is_system boolean not null default true
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text,
  category text
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id),
  organization_id uuid not null references public.organizations(id),
  status text not null default 'active' check (status in ('invited','active','suspended','ended')),
  starts_on date not null default current_date,
  ends_on date,
  reporting_to_membership_id uuid references public.organization_memberships(id),
  team_id uuid references public.teams(id),
  created_at timestamptz not null default now()
);
create unique index uq_active_membership on public.organization_memberships (user_id, organization_id)
  where status <> 'ended';

create table public.membership_roles (
  membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  granted_by uuid references public.user_profiles(id),
  granted_at timestamptz not null default now(),
  primary key (membership_id, role_id)
);

create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  email citext not null,
  invited_role_id uuid not null references public.roles(id),
  invited_by uuid not null references public.user_profiles(id),
  token_hash text not null,
  status text not null default 'pending' check (status in ('pending','accepted','expired','revoked')),
  expires_at timestamptz not null,
  accepted_user_id uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create unique index uq_pending_invite on public.user_invitations (organization_id, email) where status='pending';

-- updated_at triggers
create trigger trg_user_profiles_updated before update on public.user_profiles
  for each row execute function private.set_updated_at();
create trigger trg_organizations_updated before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger trg_employer_orgs_updated before update on public.employer_organizations
  for each row execute function private.set_updated_at();
