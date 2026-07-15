-- =============================================================================
-- File 04: Employer portal specifics (Domain G) + Packages & Billing (Domain H).
-- =============================================================================

create table public.employer_team_members (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.organization_memberships(id) on delete cascade,
  employer_role text not null check (employer_role in ('company_admin','hiring_team_member')),
  can_make_decisions boolean not null default false,
  can_manage_billing boolean not null default false
);

create table public.employer_notes (
  id uuid primary key default gen_random_uuid(),
  employer_organization_id uuid not null references public.employer_organizations(organization_id),
  owning_organization_id uuid not null references public.organizations(id),
  author_id uuid not null references public.user_profiles(id),
  body text not null,
  visibility text not null default 'franchise_internal' check (visibility in ('franchise_internal','hq_only')),
  created_at timestamptz not null default now()
);
comment on table public.employer_notes is 'Franchise/HQ-private notes ABOUT an employer (CRM-lite). Employer cannot see these.';

-- ---- Packages & entitlements ----------------------------------------------
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, name text not null,
  package_type text not null check (package_type in ('subscription','addon','one_time')),
  is_active boolean not null default true
);
create table public.package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id),
  version_no int not null,
  effective_from date not null default current_date, effective_to date,
  is_current boolean not null default true,
  unique (package_id, version_no)
);
create table public.package_features (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.package_versions(id) on delete cascade,
  feature_key text not null, is_included boolean not null default true, notes text
);
create table public.package_entitlements (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.package_versions(id) on delete cascade,
  entitlement_key text not null
    check (entitlement_key in ('active_job_postings','candidate_profile_access_per_period','employer_users','addon_tests')),
  limit_value int, period text not null default 'billing_cycle' check (period in ('billing_cycle','total','none')),
  notes text
);
comment on table public.package_entitlements is 'Usage LIMITS (literal counts), not burnable credits (R-101/C-2).';

create table public.package_country_prices (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.package_versions(id) on delete cascade,
  country_id uuid not null references public.countries(id),
  currency_id uuid not null references public.currencies(id),
  amount numeric(14,2) not null, tax_rate numeric(6,4) not null default 0,
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly','one_time'))
);

-- ---- Subscriptions & usage -------------------------------------------------
create table public.employer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employer_organization_id uuid not null references public.employer_organizations(organization_id),
  package_version_id uuid not null references public.package_versions(id),
  status text not null default 'active' check (status in ('trial','active','expired','cancelled','suspended')),
  is_trial boolean not null default false,
  trial_started_on date, trial_ends_on date,
  card_on_file_reference text,          -- tokenized only; never a PAN
  auto_activate_intent boolean not null default false,
  starts_on date not null default current_date, expires_on date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (not is_trial or trial_ends_on is not null)
);
create unique index uq_active_subscription on public.employer_subscriptions (employer_organization_id)
  where status in ('trial','active');

create table public.subscription_entitlement_usage (
  id uuid primary key default gen_random_uuid(),
  employer_subscription_id uuid not null references public.employer_subscriptions(id) on delete cascade,
  entitlement_key text not null, period_start date not null, period_end date,
  used_count int not null default 0, limit_value int,
  unique (employer_subscription_id, entitlement_key, period_start)
);

create table public.candidate_access_events (
  id uuid primary key default gen_random_uuid(),
  employer_subscription_id uuid references public.employer_subscriptions(id),
  employer_organization_id uuid not null references public.employer_organizations(organization_id),
  candidate_id uuid not null references public.candidates(id),
  access_type text not null check (access_type in ('profile_view','cv_preview','unmask','pool_search_reveal')),
  job_order_id uuid,                     -- FK -> job_orders (file 05)
  submission_id uuid,                    -- FK -> candidate_submissions (file 06)
  counted_against_period date,
  occurred_at timestamptz not null default now()
);
comment on table public.candidate_access_events is 'Ledger driving "18 of 25 accessed this month"; no burnable credit (R-101).';

-- ---- Invoices & payments ---------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  owning_organization_id uuid not null references public.organizations(id),
  employer_organization_id uuid references public.employer_organizations(organization_id),
  employer_subscription_id uuid references public.employer_subscriptions(id),
  placement_id uuid,                    -- FK -> placements (file 08)
  currency_id uuid not null references public.currencies(id),
  subtotal_amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  status text not null default 'draft'
    check (status in ('draft','issued','partially_paid','paid','overdue','cancelled','credited')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid','refunded')),
  issue_date date, due_date date, payment_reference text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id)
);
create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null, quantity numeric not null default 1,
  unit_amount numeric(14,2) not null default 0, tax_rate numeric(6,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  source_type text check (source_type in ('package','placement','addon','adjustment')), source_id uuid
);
create table public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  from_status text, to_status text not null,
  actor_user_id uuid references public.user_profiles(id), note text,
  occurred_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  amount numeric(14,2) not null, currency_id uuid not null references public.currencies(id),
  method text not null check (method in ('card','mobile_money','bank_transfer','manual')),
  provider text, provider_customer_reference text, provider_transaction_reference text,
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunded')),
  recorded_by uuid references public.user_profiles(id), paid_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.payments is 'Gateway-swappable; store provider refs generically (R-103/C-3).';
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  from_status text, to_status text not null,
  actor_user_id uuid references public.user_profiles(id), note text,
  occurred_at timestamptz not null default now()
);
create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  document_id uuid not null references public.documents(id),
  uploaded_by uuid references public.user_profiles(id)
);
create table public.credit_adjustments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  type text not null check (type in ('credit','discount','refund','write_off')),
  amount numeric(14,2) not null, reason text, approved_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create table public.billing_contacts (
  id uuid primary key default gen_random_uuid(),
  employer_organization_id uuid not null references public.employer_organizations(organization_id),
  name text, email citext, phone text, is_primary boolean not null default false
);

create trigger trg_subscriptions_updated before update on public.employer_subscriptions
  for each row execute function private.set_updated_at();
create trigger trg_invoices_updated before update on public.invoices
  for each row execute function private.set_updated_at();
