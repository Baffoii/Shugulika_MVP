-- =============================================================================
-- File 07: Offers/Placements (O), Notes/Tasks (L), Communications (P),
--          Whistleblowing (Q), Audit/Privacy/Compliance (S).
-- =============================================================================

-- ---- Offers & Placements (Domain O) ---------------------------------------
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  candidate_submission_id uuid references public.candidate_submissions(id),
  owning_organization_id uuid not null references public.organizations(id),
  status text not null default 'preparing'
    check (status in ('preparing','sent','negotiating','accepted','declined','expired','withdrawn')),
  position_title text, compensation_amount numeric, currency_id uuid references public.currencies(id),
  benefits text, proposed_start_date date, conditions text,
  offer_document_id uuid references public.documents(id),
  candidate_response text, declined_reason text, expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status <> 'declined' or declined_reason is not null)  -- declined needs reason, != rejected
);
create table public.offer_versions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  version_no int not null, payload jsonb, created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now()
);
create table public.offer_events (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  from_status text, to_status text not null, actor_user_id uuid references public.user_profiles(id),
  occurred_at timestamptz not null default now()
);
create table public.placements (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.offers(id),
  application_id uuid not null references public.applications(id),
  employer_organization_id uuid not null references public.employer_organizations(organization_id),
  owning_organization_id uuid not null references public.organizations(id),
  responsible_recruiter_id uuid references public.user_profiles(id),
  agreed_start_date date, final_compensation numeric, currency_id uuid references public.currencies(id),
  placement_fee numeric, fee_basis text, guarantee_period_days int,
  status text not null default 'active' check (status in ('active','guarantee_period','completed','failed','replaced')),
  replacement_of_placement_id uuid references public.placements(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.user_profiles(id)
);
alter table public.invoices
  add constraint invoices_placement_fk foreign key (placement_id) references public.placements(id);
create table public.placement_events (
  id uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.placements(id) on delete cascade,
  from_status text, to_status text not null, actor_user_id uuid references public.user_profiles(id),
  note text, occurred_at timestamptz not null default now()
);

-- ---- Notes / Tasks / Activities (Domain L) --------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owning_organization_id uuid not null references public.organizations(id),
  author_id uuid not null references public.user_profiles(id),
  subject_type text not null check (subject_type in ('candidate','application','engagement','submission','employer','job_order','interview')),
  subject_id uuid not null,
  note_kind text not null check (note_kind in ('structured_screening','private_internal','hq_operational','employer_comment','candidate_visible','compliance')),
  visibility text not null check (visibility in ('recruiter_private','franchise_internal','hq_accessible','employer_visible','candidate_visible','compliance_restricted')),
  body text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on table public.notes is 'Every note has an explicit audience/visibility; no generic notes box (R-065).';
create table public.note_mentions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  mentioned_user_id uuid not null references public.user_profiles(id)
);
create table public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  document_id uuid not null references public.documents(id)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owning_organization_id uuid not null references public.organizations(id),
  assigned_to uuid references public.user_profiles(id),
  created_by uuid references public.user_profiles(id),
  subject_type text, subject_id uuid, title text not null,
  due_at timestamptz, reminder_at timestamptz,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  task_type text check (task_type in ('follow_up','invoicing','consent_reminder','feedback_chase','generic')),
  created_at timestamptz not null default now()
);
create table public.activity_events (
  id bigint generated always as identity primary key,
  owning_organization_id uuid not null references public.organizations(id),
  subject_type text not null, subject_id uuid not null, event_type text not null,
  actor_user_id uuid references public.user_profiles(id),
  occurred_at timestamptz not null default now(), summary text, metadata jsonb
);

-- ---- Communications (Domain P) : channel-neutral ---------------------------
create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  notification_category_id uuid references public.notification_categories(id),
  owning_organization_id uuid references public.organizations(id),
  name text not null, is_active boolean not null default true
);
create table public.message_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.message_templates(id) on delete cascade,
  version_no int not null, channel_id uuid not null references public.channels(id),
  locale text not null default 'en', subject text, body text not null, variables jsonb,
  is_current boolean not null default true, unique (template_id, version_no, channel_id, locale)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid references public.message_template_versions(id),
  notification_category_id uuid references public.notification_categories(id),
  subject_type text, subject_id uuid, variables jsonb, scheduled_for timestamptz,
  status text not null default 'queued' check (status in ('queued','sent','cancelled')),
  created_by_service uuid references public.service_actors(id),
  created_at timestamptz not null default now()
);
create table public.message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  recipient_user_id uuid references public.user_profiles(id),
  recipient_candidate_id uuid references public.candidates(id),
  external_address text, resolved_channel_id uuid references public.channels(id)
);
create table public.message_deliveries (
  id uuid primary key default gen_random_uuid(),
  message_recipient_id uuid not null references public.message_recipients(id) on delete cascade,
  channel_id uuid not null references public.channels(id),
  provider text, provider_message_id text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','failed','bounced','read')),
  attempt_no int not null default 1, failure_reason text,
  sent_at timestamptz, delivered_at timestamptz, read_at timestamptz
);
comment on table public.message_deliveries is 'Generic channel/provider/delivery metadata; WhatsApp addable later with no schema change (R-110).';
create table public.communication_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.user_profiles(id),
  candidate_id uuid references public.candidates(id),
  notification_category_id uuid not null references public.notification_categories(id),
  channel_id uuid not null references public.channels(id),
  opted_in boolean not null default false, source text,
  consent_record_id uuid references public.consent_records(id),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(user_id, candidate_id) = 1)
);
create unique index uq_comm_pref on public.communication_preferences
  (coalesce(user_id, candidate_id), notification_category_id, channel_id);
create table public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id),
  notification_category_id uuid references public.notification_categories(id),
  title text, body text, subject_type text, subject_id uuid, read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- Whistleblowing / Safeguarding (Domain Q) : restricted -----------------
create table public.safeguarding_cases (
  id uuid primary key default gen_random_uuid(),
  case_reference text not null unique,
  reporter_candidate_id uuid references public.candidates(id),
  reporter_contact text,
  about_organization_id uuid references public.organizations(id),
  category text, description text not null,
  status text not null default 'received' check (status in ('received','acknowledged','in_review','resolved','closed')),
  assigned_to uuid references public.user_profiles(id),
  confidentiality_level text not null default 'restricted',
  created_at timestamptz not null default now()
);
comment on table public.safeguarding_cases is 'Confidential; access = safeguarding.read only; ordinary recruiters cannot see (R-111).';
create table public.safeguarding_case_events (
  id uuid primary key default gen_random_uuid(),
  safeguarding_case_id uuid not null references public.safeguarding_cases(id) on delete cascade,
  from_status text, to_status text not null, actor_user_id uuid references public.user_profiles(id),
  note text, occurred_at timestamptz not null default now()
);

-- ---- Audit / Privacy / Compliance (Domain S) ------------------------------
create table audit.audit_log (
  id bigint generated always as identity,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid, actor_service_id uuid, organization_context_id uuid,
  action text not null, entity_type text not null, entity_id uuid,
  before_value jsonb, after_value jsonb, correlation_id uuid,
  ip_address inet, user_agent text, is_sensitive_access boolean not null default false,
  primary key (id, occurred_at)
) partition by range (occurred_at);
comment on table audit.audit_log is 'Append-only, partitioned by month; no UPDATE/DELETE grants (R-130).';
-- Example initial partitions (create rolling partitions via scheduled job)
create table audit.audit_log_2026_07 partition of audit.audit_log
  for values from ('2026-07-01') to ('2026-08-01');
create table audit.audit_log_2026_08 partition of audit.audit_log
  for values from ('2026-08-01') to ('2026-09-01');

create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id),
  request_type text not null check (request_type in ('access','correction','deletion','export','restriction')),
  status text not null default 'received' check (status in ('received','in_progress','completed','rejected')),
  requested_at timestamptz not null default now(), due_at timestamptz,
  handled_by uuid references public.user_profiles(id), resolution_note text
);
create table public.dsr_events (
  id uuid primary key default gen_random_uuid(),
  data_subject_request_id uuid not null references public.data_subject_requests(id) on delete cascade,
  from_status text, to_status text not null, actor_user_id uuid references public.user_profiles(id),
  note text, occurred_at timestamptz not null default now()
);
create table public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null unique,
  retention_action text not null check (retention_action in ('retain','soft_delete','anonymize','purge')),
  retention_period interval, basis text, is_active boolean not null default true
);
create table public.legal_holds (
  id uuid primary key default gen_random_uuid(),
  entity_type text, entity_id uuid, subject_candidate_id uuid references public.candidates(id),
  reason text, placed_by uuid references public.user_profiles(id),
  placed_at timestamptz not null default now(), released_at timestamptz
);
create table public.cross_border_transfers (
  id uuid primary key default gen_random_uuid(),
  subject_candidate_id uuid references public.candidates(id),
  from_country_id uuid references public.countries(id), to_country_id uuid references public.countries(id),
  purpose text, legal_basis text, recipient text,
  consent_record_id uuid references public.consent_records(id), occurred_at timestamptz not null default now()
);
create table public.dpia_references (
  id uuid primary key default gen_random_uuid(),
  title text not null, scope text, reference text, status text, completed_at timestamptz
);
create table public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null, severity text, detected_at timestamptz, status text, description text, reference text
);
create table public.incident_affected_subjects (
  id uuid primary key default gen_random_uuid(),
  security_incident_id uuid not null references public.security_incidents(id) on delete cascade,
  candidate_id uuid references public.candidates(id), organization_id uuid references public.organizations(id)
);
create table public.dashboard_exceptions (
  id bigint generated always as identity primary key,
  exception_type text not null, severity text,
  subject_type text, subject_id uuid,
  owning_organization_id uuid references public.organizations(id),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  detected_at timestamptz not null default now(), resolved_at timestamptz
);

create trigger trg_offers_updated before update on public.offers for each row execute function private.set_updated_at();
create trigger trg_placements_updated before update on public.placements for each row execute function private.set_updated_at();
create trigger trg_notes_updated before update on public.notes for each row execute function private.set_updated_at();
