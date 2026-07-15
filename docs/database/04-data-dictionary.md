# 04 — Data Dictionary

Every proposed table, its purpose, owning domain, data owner, tenant scope, primary key, columns (type, nullability, default, FK), constraints, sensitive-data classification, and per-actor access + retention behavior.

## Conventions

- **Type shorthand:** `uuid`, `text`, `citext` (case-insensitive), `int`, `bigint`, `numeric`, `bool`, `date`, `timestamptz`, `jsonb`, `tsvector`, `bytea`. `PK`=primary key, `FK`=foreign key, `UK`=unique, `NN`=not null, `DEF`=default.
- **Timestamps:** every table has `created_at timestamptz NN DEF now()`; mutable tables also `updated_at timestamptz NN DEF now()` (maintained by trigger). Actor columns `created_by uuid FK→user_profiles`, `updated_by uuid FK→user_profiles` are present on operational tables (noted as "audit cols"). These are omitted from per-column lists for brevity and marked **[+audit cols]**.
- **Access classification legend** (per table): `Cand` = the candidate subject, `Emp` = employer users, `Fr` = owning-franchise users, `HQ` = HQ oversight, `SA` = super admin, `Svc` = service role. Values: ✔ full, ⟳ conditional (via grant/consent/assignment), ✖ none, R read-only, W write.
- **Sensitivity:** `Public` / `Internal` / `Sensitive` / `Highly sensitive (PII/special)`.
- **Retention:** `Retain` (keep), `Soft` (soft-delete flag), `Anon` (anonymize on candidate deletion), `Purge` (hard delete on schedule), `Hold` (subject to legal hold). See `12` for durations (OD-7).

> Reference (lookup) tables are read-only to all authenticated users and writable only by SA/config permission; they are listed compactly in §C.

---

## Domain A — Identity & Access

### `user_profiles`
Application profile 1:1 with `auth.users`. Never stores credentials.
Owner: the user. Tenant scope: global identity. PK: `id`.

| Column | Type | N | Default | FK / Notes |
|---|---|---|---|---|
| id | uuid | NN | — | PK; = `auth.users.id` |
| email | citext | NN | — | mirror of auth email; UK |
| phone | text | Y | — | E.164 |
| full_name | text | Y | — | |
| display_name | text | Y | — | |
| account_status | text | NN | `'active'` | CHECK in (active, invited, suspended, deactivated, pending_deletion) |
| preferred_language | text | NN | `'en'` | FK→languages.code |
| time_zone | text | NN | `'Africa/Dar_es_Salaam'` | |
| country_id | uuid | Y | — | FK→countries |
| email_verified_at | timestamptz | Y | — | |
| phone_verified_at | timestamptz | Y | — | |
| mfa_enabled | bool | NN | false | future MFA |
| last_login_at | timestamptz | Y | — | |
| terms_accepted_version_id | uuid | Y | — | FK→legal_document_versions |
| privacy_accepted_version_id | uuid | Y | — | FK→legal_document_versions |
| is_platform_staff | bool | NN | false | HQ/SA convenience flag (still requires membership) |
| deactivated_at | timestamptz | Y | — | |

Sensitivity: Highly sensitive (PII). Access: Cand ✔(own), Fr/Emp ⟳(only via membership/submission context, never raw contact for candidates), HQ ⟳, SA ✔, Svc ✔. Retention: Anon on account deletion; Hold-aware.
Constraints: `UK(email)`; RLS: user sees own row; staff see profiles within shared org membership.

### `service_actors`
Non-human actors (system jobs, AI evaluator, notification dispatcher) for attributable automated actions.
Owner: platform. PK: `id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| key | text | NN | — | UK, e.g. `ai_evaluator`, `retention_job` |
| display_name | text | NN | — | |
| is_active | bool | NN | true | |

Sensitivity: Internal. Access: SA ✔, Svc R. Retention: Retain.

### `user_invitations`
Pending invites for internal/employer onboarding.
Owner: inviting org. Tenant scope: `organization_id`. PK: `id`.

| Column | Type | N | Default | FK/Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| organization_id | uuid | NN | — | FK→organizations |
| email | citext | NN | — | |
| invited_role_id | uuid | NN | — | FK→roles |
| invited_by | uuid | NN | — | FK→user_profiles |
| token_hash | text | NN | — | hashed invite token |
| status | text | NN | `'pending'` | CHECK (pending, accepted, expired, revoked) |
| expires_at | timestamptz | NN | — | |
| accepted_user_id | uuid | Y | — | FK→user_profiles |

Sensitivity: Sensitive. Access: Fr/HQ ⟳(own org), SA ✔. Retention: Purge after expiry+window. `UK(organization_id,email) WHERE status='pending'`.

---

## Domain B — Organizations & Membership

### `organizations`
Root tenant table for HQ, country operations, franchises, employers, platform.
Owner: platform/HQ. PK: `id`.

| Column | Type | N | Default | FK/Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| organization_type | text | NN | — | CHECK (platform, hq, country_operation, franchise, employer) |
| legal_name | text | NN | — | |
| trading_name | text | Y | — | |
| slug | citext | Y | — | UK; e.g. country sub-portal key |
| country_id | uuid | Y | — | FK→countries |
| parent_organization_id | uuid | Y | — | FK→organizations (HQ→franchise hierarchy) |
| status | text | NN | `'active'` | CHECK (pending, active, suspended, closed) |
| branding_document_id | uuid | Y | — | FK→documents (logo) |

**[+audit cols]** Sensitivity: Internal. Access: Fr R(own+parent), HQ R(all), SA ✔. Retention: Soft (status=closed), Retain. `UK(slug)`.

### `franchise_profiles`
Franchise-specific detail (1:1 with a franchise org).
PK: `organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| organization_id | uuid | NN | — | PK, FK→organizations (type=franchise) |
| franchise_owner_user_id | uuid | Y | — | FK→user_profiles |
| territory | text | Y | — | country/region scope description |
| franchise_status | text | NN | `'onboarding'` | CHECK (prospect, onboarding, active, suspended, terminated) |
| agreement_reference | text | Y | — | |
| activated_on | date | Y | — | |

Sensitivity: Internal. Access: Fr R(own), HQ ✔, SA ✔. Retention: Retain.

### `employer_organizations`
Employer/company detail (1:1 with an employer org). Ring-G root.
PK: `organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| organization_id | uuid | NN | — | PK, FK→organizations (type=employer) |
| responsible_organization_id | uuid | NN | — | FK→organizations (owning franchise/HQ) |
| registered_name | text | NN | — | |
| industry_id | uuid | Y | — | FK→industries |
| company_size | text | Y | — | CHECK bucket |
| registration_number | text | Y | — | tax/registration |
| website | text | Y | — | |
| verification_status | text | NN | `'pending'` | CHECK (pending, verified, rejected) |
| employer_status | text | NN | `'active'` | CHECK (active, suspended, closed) |
| description | text | Y | — | |

Sensitivity: Internal/Sensitive (reg number). Access: Emp R(own), Fr/HQ ⟳(responsible/oversight), SA ✔. Retention: Retain. Note: **an employer belongs to exactly one responsible franchise/HQ** — this is a key tenant edge.

### `organization_addresses`, `organization_contacts`
Addresses/contacts for any org (HQ, franchise, employer). Both: PK `id`, FK `organization_id`, plus typed fields (`address_type`/`contact_type`, lines, city, country_id, name, email, phone, is_primary). Sensitivity: Sensitive (contact PII). Access: owning-org R/W, HQ ⟳, SA ✔. Retention: Retain/Soft.

### `organization_relationships`
Explicit org-to-org edges beyond parent (e.g., HQ oversight grants, cross-franchise transfer authorizations).
PK: `id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| from_organization_id | uuid | NN | — | FK→organizations |
| to_organization_id | uuid | NN | — | FK→organizations |
| relationship_type | text | NN | — | CHECK (oversight, referral, transfer_grant, partner) |
| status | text | NN | `'active'` | |
| valid_from | timestamptz | NN | now() | |
| valid_until | timestamptz | Y | — | |

Sensitivity: Internal. Access: involved orgs R, HQ/SA ✔. Retention: Retain. Used by RLS to authorize controlled HQ oversight / approved transfers.

### `organization_memberships`
A user's membership in an org (users may have several).
PK: `id`. Tenant: `organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| user_id | uuid | NN | — | FK→user_profiles |
| organization_id | uuid | NN | — | FK→organizations |
| status | text | NN | `'active'` | CHECK (invited, active, suspended, ended) |
| starts_on | date | NN | current_date | |
| ends_on | date | Y | — | |
| reporting_to_membership_id | uuid | Y | — | FK→self (reporting lines) |
| team_id | uuid | Y | — | FK→teams |

Sensitivity: Internal. Access: user R(own), Fr/HQ ⟳(own org), SA ✔. Retention: Soft (status=ended). `UK(user_id,organization_id) WHERE status<>'ended'`.

### `teams`
Recruiter teams / employer hiring teams / accounts teams within an org.
PK `id`, FK `organization_id`, `name`, `team_type` CHECK(recruiter, accounts, content, hiring, operations). Access: own-org, HQ/SA. Retention: Retain.

### `roles`, `permissions`, `role_permissions`, `membership_roles`
RBAC core (org-scoped).

- **`roles`**: `id PK`, `key` UK (super_admin, hq_staff, hq_recruiter, hq_accounts, hq_content, franchise_owner, franchise_recruiter, franchise_accounts, employer_admin, employer_hiring, candidate, public), `display_name`, `scope_level` CHECK(platform, country, franchise, employer, self), `is_system` bool. Reference-like but security-critical.
- **`permissions`**: `id PK`, `key` UK (e.g. `application.advance`, `submission.create`, `invoice.edit`, `candidate.export`, `hq.oversight.read`, `document.download`), `description`, `category`.
- **`role_permissions`**: `role_id FK`, `permission_id FK`, PK(role_id,permission_id).
- **`membership_roles`**: `membership_id FK`, `role_id FK`, `granted_by`, PK(membership_id,role_id).

Sensitivity: Internal/Sensitive (security). Access: R for own-org admins, W for SA/HQ config; `permissions`/`role_permissions` W only by SA. Retention: Retain.

---

## Domain C — Reference & Configuration

Reference tables are read-only to authenticated users; write requires `config.manage` (SA/HQ). All have `id uuid PK`, `code`/`key` UK, `label`, `is_active bool`, `sort_order int`, plus the columns noted. **Enum vs table rationale in `12` §Reference.**

| Table | Key columns | Notes / seeded values |
|---|---|---|
| `countries` | `iso2` UK, `iso3`, `name`, `dial_code`, `default_currency_id` | Tanzania active in pilot; others reserved |
| `currencies` | `iso_code` UK, `name`, `symbol`, `minor_unit` | TZS, USD, KES, GHS, … |
| `languages` | `code` UK, `name`, `native_name`, `is_rtl` | en active; sw/fr/ar reserved |
| `industries` | `name`, `parent_id` (hierarchy) | configurable |
| `skills` | `name`, `slug`, `is_verified` | candidates may add custom (see `candidate_skills.custom_label`) |
| `education_levels` | `name`, `rank` | incl. "No formal qualification", vocational, secondary |
| `employment_types` | `name` | full_time, part_time, contract, internship |
| `work_arrangements` | `name` | remote, hybrid, on_site |
| `document_types` | `name`, `category`, `default_visibility`, `default_retention` | cv, cover_letter, id_document, certificate, licence, transcript, work_sample, portfolio, interview_recording, interview_audio, transcript_file, watermarked_preview, payment_proof, org_branding |
| `interview_types` | `name` | phone_screen, recruiter, employer, live_video, in_person, ai_async |
| `verification_types` | `name` | email, phone, identity_document, manual, employer_required |
| `pipeline_stages` | `key` UK, `label`, `ordinal`, `stage_class` (candidate/job/placement/accounts), `is_gated`, `blocking_rule` | the 15 Spine stages; configurable per-org via `pipeline_stage_overrides` |
| `candidate_sources` | `name` | applied_direct, recruiter_sourced, referral, imported, recruiter_created |
| `rejection_reasons` | `name`, `applies_to` (application/submission/offer), `is_active` | full list from S5/S6 |
| `notification_categories` | `key`, `label`, `default_channels`, `is_marketing` | account, application_status, interview, offer, invoice, marketing, whistleblowing_ack |
| `channels` | `key` UK, `label`, `is_active` | email(active), sms(active), in_app(active), **whatsapp(inactive)**, push(reserved) |
| `consent_purposes` | `key` UK, `label`, `requires_recipient`, `is_special_category` | see R-031 list |
| `organization_types` | `key`, `label` | mirrors organizations.organization_type CHECK for config UI |
| `role_types` | (see roles) | |
| `permission_definitions` | (= permissions) | |
| `status_definitions` | `domain`, `key`, `label`, `ordinal` | optional catalog of workflow statuses for UI |
| `feature_flags` | `key` UK, `is_enabled`, `scope`, `organization_id?` | e.g. whatsapp_enabled=false, ai_interview_enabled=false |
| `country_configurations` | `country_id` UK, `id_document_types jsonb`, `tax_rules jsonb`, `default_currency_id`, `work_auth_rules jsonb` | per-country config |
| `franchise_configurations` | `organization_id` UK, `pipeline_overrides jsonb`, `branding jsonb` | per-franchise |
| `platform_settings` | `key` UK, `value jsonb` | global settings |

Sensitivity: Public/Internal. Access: all R; SA/HQ W. Retention: Retain.

---

## Domain D — Candidate Global Identity (Ring 1 & 2)

### `candidates`
Candidate global root. `user_id` nullable (recruiter-created candidates without a login).
Owner: candidate. Tenant scope: **global** (not franchise-owned). PK: `id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| user_id | uuid | Y | — | FK→user_profiles; UK (one candidate per user) |
| given_name | text | Y | — | |
| family_name | text | Y | — | |
| date_of_birth | date | Y | — | minor handling (OD-5) |
| email | citext | Y | — | |
| phone | text | Y | — | |
| country_id | uuid | Y | — | FK→countries |
| current_city | text | Y | — | |
| nationality_country_id | uuid | Y | — | FK→countries; only where justified |
| professional_summary | text | Y | — | |
| profile_photo_document_id | uuid | Y | — | FK→documents |
| profile_status | text | NN | `'draft'` | CHECK (draft, active, archived, pending_deletion) |
| source_channel | text | Y | — | acquisition channel |
| profile_completion_pct | int | NN | 0 | maintained by trigger |
| created_by_organization_id | uuid | Y | — | FK→organizations (if recruiter-created) |
| merged_into_candidate_id | uuid | Y | — | FK→self (dedup/merge) |
| archived_at | timestamptz | Y | — | |

**[+audit cols]** Sensitivity: Highly sensitive (PII). Access: Cand ✔(own), Fr/HQ ⟳(via engagement/application/search-approved fields only — **not** raw contact unless disclosed), Emp ⟳(masked via submission/search), SA ✔. Retention: Anon/Soft on deletion; Hold-aware. `UK(user_id)`.

### Modular candidate sub-records
All FK `candidate_id → candidates ON DELETE CASCADE`, PK `id`, **[+audit cols]**, candidate-owned. Access mirrors `candidates` (candidate ✔ own; internal ⟳ via engagement; employer only masked snapshot fields).

| Table | Key columns |
|---|---|
| `candidate_work_experiences` | job_title, employer_name, location, start_date, end_date, is_current, responsibilities, employment_type_id, experience_kind CHECK(formal, volunteer, informal, family_business, internship, freelance, community) |
| `candidate_educations` | institution_name, qualification, field_of_study, education_level_id, start_date, end_date, is_current, is_completed, grade, description, institution_not_listed bool |
| `candidate_skills` | skill_id (nullable), custom_label, proficiency, years, `is_searchable` bool |
| `candidate_languages` | language_id, proficiency CHECK(basic..native) |
| `candidate_certifications` | name, issuer, issued_on, expires_on, credential_id, document_id FK |
| `candidate_licences` | name, issuer, licence_number, issued_on, expires_on, document_id FK |
| `candidate_projects` | title, description, url, start_date, end_date |
| `candidate_memberships` | organization_name, role, start_date, end_date |
| `candidate_references` | referee_name, relationship, organization, contact_method, contact_value, `is_reachable` — **Sensitive; never in shared search** |
| `candidate_preferences` (1:1) | desired_salary_min/max, salary_currency_id, salary_is_private bool, availability, notice_period, willing_to_relocate bool, cross_border_mobility bool, remote_preference, employment_type_pref, open_to_opportunities bool, accessibility_accommodations text |
| `candidate_preferred_roles` | role_title (multi) |
| `candidate_preferred_industries` | industry_id |
| `candidate_preferred_locations` | country_id, city, is_primary |
| `candidate_tags` | tag, tag_scope CHECK(global, franchise), owning_organization_id (nullable; franchise tags are Ring-3a) |

Sensitivity: PII/Sensitive. Retention: Anon on candidate deletion.

### `candidate_visibility` (1:1)
Candidate-controlled disclosure & searchable-field selection.
PK: `candidate_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| candidate_id | uuid | NN | — | PK, FK→candidates |
| searchable | bool | NN | false | Ring-2 opt-in ("discoverable by authorized Shugulika recruiters") |
| approved_search_fields | jsonb | NN | `'{}'` | which approved fields are shared (allow-list) |
| talent_pool_opt_in | bool | NN | false | |
| updated_by | uuid | Y | — | FK→user_profiles (should = candidate) |

Sensitivity: Sensitive (controls disclosure). Access: Cand ✔(own), Svc R. Retention: Retain. Changes logged (visibility-change history via `audit_log`).

### `candidate_search_documents` (Ring 2)
Derived index of **only candidate-approved fields**. Maintained by trigger from Ring-1 + `candidate_visibility`. Never contains "never include" fields.
PK: `candidate_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| candidate_id | uuid | NN | — | PK, FK→candidates |
| is_searchable | bool | NN | false | mirrors visibility for fast filtering |
| search_tsv | tsvector | NN | — | FTS over approved summary/skills/roles |
| approved_skills | text[] | NN | `'{}'` | |
| preferred_roles | text[] | NN | `'{}'` | |
| country_id | uuid | Y | — | |
| city | text | Y | — | |
| education_level_rank | int | Y | — | |
| languages | text[] | NN | `'{}'` | |
| availability | text | Y | — | |
| embedding | (vector) | Y | — | **reserved**, extension point for AI matching (see `08`) |

Sensitivity: Internal (approved subset only). Access: Fr/HQ R(only where `is_searchable` + engagement rules), Emp R(only via package-gated pool search, masked), SA ✔. Retention: rebuilt from source; Purge on candidate deletion.

### `candidate_duplicate_links`
Suspected/confirmed duplicate pairs for review/merge.
`id PK`, `candidate_id FK`, `duplicate_candidate_id FK`, `match_score numeric`, `status` CHECK(suspected, dismissed, merged), `reviewed_by`. Access: HQ/SA. Retention: Retain.

---

## Domain E — Documents & Media

### `documents`
Metadata for every stored file; **binary lives in Supabase Storage**, not in Postgres.
Owner: candidate or org. Tenant scope: `owner_candidate_id` OR `owning_organization_id` (exactly one is set for private docs; org-branding uses org). PK: `id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| document_type_id | uuid | NN | — | FK→document_types |
| owner_candidate_id | uuid | Y | — | FK→candidates |
| owning_organization_id | uuid | Y | — | FK→organizations |
| uploaded_by | uuid | Y | — | FK→user_profiles |
| title | text | Y | — | candidate-friendly name ("Finance Resume") |
| bucket_id | text | NN | — | Storage bucket (see `09`) |
| object_path | text | NN | — | current-version object key; UK per bucket |
| current_version_id | uuid | Y | — | FK→document_versions |
| visibility | text | NN | `'private'` | CHECK (private, franchise_internal, recruiter_discoverable, submission_only, org_internal) |
| scan_status | text | NN | `'pending'` | CHECK (pending, clean, infected, failed) |
| verification_status | text | NN | `'unverified'` | CHECK (unverified, verified, rejected) |
| expires_at | timestamptz | Y | — | access expiry |
| retention_status | text | NN | `'active'` | CHECK (active, pending_purge, purged, on_hold) |
| deleted_at | timestamptz | Y | — | soft delete |

**[+audit cols]** Sensitivity: Highly sensitive (CVs, IDs). Access: Cand ✔(own), Fr ⟳(engagement/visibility), Emp ⟳(watermarked preview only, via submission), HQ ⟳, SA ✔(+export). Retention: Purge/Hold per type. `UK(bucket_id,object_path)`. **CHECK: exactly one of owner_candidate_id / owning_organization_id NOT NULL.**

### `document_versions`
Immutable per-version records (supports "preserve exact version submitted").
PK `id`, FK `document_id`. Columns: `version_no int`, `object_path text UK`, `size_bytes bigint`, `mime_type text`, `checksum_sha256 text`, `page_count int`, `uploaded_by`, `created_at`. Sensitivity: Highly sensitive. Access: as parent. Retention: Purge with parent; a version referenced by a submission snapshot is **retained** until the submission's retention ends.

### `document_previews`
Generated derived assets (watermarked preview, thumbnail, redacted preview).
PK `id`, FK `document_id`, `document_version_id`, `preview_type` CHECK(watermarked, thumbnail, redacted), `bucket_id`, `object_path`, `generated_by service_actor`. Access: derived from parent doc visibility. Retention: Purge with parent.

### `document_access_grants`
Explicit, time-boxed sharing of a document to an org/user/submission.
PK `id`, FK `document_id`, `granted_to_organization_id?`, `granted_to_user_id?`, `submission_id?`, `scope` CHECK(preview, download), `granted_by`, `expires_at`, `revoked_at`. Sensitivity: Sensitive. Access: grantor + grantee, SA. Retention: Retain (audit of who-could-see-what).

---

## Domain F — Verification

### `verifications`
One row per verification attempt/state for a subject.
Owner: subject (candidate) or org. PK: `id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| verification_type_id | uuid | NN | — | FK→verification_types |
| subject_candidate_id | uuid | Y | — | FK→candidates |
| subject_organization_id | uuid | Y | — | FK→organizations (employer verification) |
| status | text | NN | `'pending'` | CHECK (pending, in_review, verified, failed, expired) |
| method | text | Y | — | CHECK (otp, email_link, manual_review, document_review, biometric_ocr, biometric_liveness, face_match) — biometric = Phase 2 |
| requested_by | uuid | Y | — | FK→user_profiles |
| verified_by | uuid | Y | — | FK→user_profiles |
| outcome_reason | text | Y | — | failure/rejection reason |
| verified_at | timestamptz | Y | — | |
| expires_at | timestamptz | Y | — | re-verification |

**[+audit cols]** Sensitivity: Highly sensitive. Access: Cand R(own status/trust signal), Fr/HQ ⟳(status only unless authorized), SA ✔. Retention: Retain status; Purge biometric evidence early. CHECK: exactly one subject set.

### `verification_evidence`
Evidence documents/metadata supporting a verification.
PK `id`, FK `verification_id`, `evidence_document_id FK→documents`, `evidence_metadata jsonb`, `captured_at`. Sensitivity: Highly sensitive (ID scans, liveness). Access: SA + authorized reviewer only. Retention: Purge early (short retention).

### `verification_events`
Append-only verification history. PK `id`, FK `verification_id`, `from_status`, `to_status`, `actor`, `occurred_at`, `note`. Retention: Retain.

---

## Domain G — Employers (portal-specific)

### `employer_team_members`
Employer users' roles within the company (Company Admin / Hiring Team Member) — realized via `organization_memberships` + `membership_roles`; this table adds employer-specific attributes.
PK `id`, FK `membership_id`, `employer_role` CHECK(company_admin, hiring_team_member), `can_make_decisions bool`, `can_manage_billing bool`. Access: Emp(own company admin) R/W, Fr/HQ ⟳, SA. Retention: Soft.

### `employer_notes`
Franchise/HQ private notes **about** an employer (CRM-lite; not visible to the employer).
PK `id`, FK `employer_organization_id`, `owning_organization_id`, `author_id`, `body`, `visibility` CHECK(franchise_internal, hq_only). Sensitivity: Internal. Access: owning Fr/HQ, SA. **Employer ✖.** Retention: Retain/Soft.

### `job_hiring_team`
Which employer users can act on a specific job (Hiring Team Member scoping).
PK `id`, FK `job_order_id`, `user_id`, `can_comment bool`, `can_decide bool`. Access: Emp(own), Fr/HQ ⟳. Retention: Retain.

---

## Domain H — Packages & Billing

### `packages`
Product package (Tier 1/2/3, add-ons). PK `id`, `key` UK, `name`, `package_type` CHECK(subscription, addon, one_time), `is_active`. Access: all R, SA W. Retention: Retain.

### `package_versions`
Versioned package definition. PK `id`, FK `package_id`, `version_no`, `effective_from`, `effective_to`, `is_current bool`. Retention: Retain (historical pricing).

### `package_features`
Named features toggled by a package version. PK `id`, FK `package_version_id`, `feature_key`, `is_included bool`, `notes`. e.g. `candidate_pool_search`, `shugulika_managed_recruitment`, `reporting`. Retention: Retain.

### `package_entitlements`
Quantitative limits per package version — **usage limits, not credits** (C-2).
PK `id`, FK `package_version_id`, `entitlement_key` CHECK(active_job_postings, candidate_profile_access_per_period, employer_users, addon_tests), `limit_value int`, `period` CHECK(billing_cycle, total, none), `notes`. Retention: Retain.

### `package_country_prices`
Per-country/currency pricing. PK `id`, FK `package_version_id`, `country_id`, `currency_id`, `amount numeric`, `tax_rate numeric`, `billing_interval` CHECK(monthly, one_time). Retention: Retain.

### `employer_subscriptions`
An employer's assignment to a package version.
PK `id`. Tenant: `employer_organization_id` (+ responsible org).

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| employer_organization_id | uuid | NN | — | FK→employer_organizations |
| package_version_id | uuid | NN | — | FK→package_versions |
| status | text | NN | `'active'` | CHECK (trial, active, expired, cancelled, suspended) |
| is_trial | bool | NN | false | |
| trial_started_on | date | Y | — | |
| trial_ends_on | date | Y | — | |
| card_on_file_reference | text | Y | — | tokenized ref only (no PAN) |
| auto_activate_intent | bool | NN | false | trial→paid intent (not auto-charge dependency) |
| starts_on | date | NN | current_date | |
| expires_on | date | Y | — | |

**[+audit cols]** Sensitivity: Sensitive (billing). Access: Emp R(own), Fr/HQ accounts ⟳, SA ✔. Retention: Retain.

### `subscription_entitlement_usage`
Current usage counters per subscription per entitlement per period (literal counts, R-101).
PK `id`, FK `employer_subscription_id`, `entitlement_key`, `period_start date`, `period_end date`, `used_count int NN DEF 0`, `limit_value int`. `UK(employer_subscription_id,entitlement_key,period_start)`. Access: Emp R(own), Fr/HQ accounts, SA. Retention: Retain (billing history).

### `candidate_access_events`
Ledger of employer accesses to candidate profiles/CVs (drives "18 of 25 accessed this month"; **no burnable credit**).
PK `id`, FK `employer_subscription_id`, `employer_organization_id`, `candidate_id`, `access_type` CHECK(profile_view, cv_preview, unmask, pool_search_reveal), `job_order_id?`, `submission_id?`, `occurred_at`, `counted_against_period date`. Access: Emp R(own aggregate), Fr/HQ, SA. Retention: Retain (audit + billing). Also written to `audit_log`.

### `invoices`
PK `id`. Tenant: `owning_organization_id` (franchise/HQ that owns the client relationship).

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| invoice_number | text | NN | — | UK; generated (see `06`) |
| owning_organization_id | uuid | NN | — | FK→organizations |
| employer_organization_id | uuid | Y | — | FK→employer_organizations |
| employer_subscription_id | uuid | Y | — | FK (for package invoices) |
| placement_id | uuid | Y | — | FK→placements (for placement invoices) |
| currency_id | uuid | NN | — | FK→currencies |
| subtotal_amount | numeric(14,2) | NN | 0 | |
| tax_amount | numeric(14,2) | NN | 0 | |
| total_amount | numeric(14,2) | NN | 0 | |
| status | text | NN | `'draft'` | CHECK (draft, issued, partially_paid, paid, overdue, cancelled, credited) |
| payment_status | text | NN | `'unpaid'` | CHECK (unpaid, partial, paid, refunded) |
| issue_date | date | Y | — | |
| due_date | date | Y | — | |
| payment_reference | text | Y | — | |

**[+audit cols]** Sensitivity: Sensitive. Access: Emp R(own), Fr/HQ accounts ⟳ (recruiters R-only, edit needs `invoice.edit`), SA ✔. Retention: Retain (statutory), Hold. `UK(invoice_number)`.

### `invoice_line_items`
PK `id`, FK `invoice_id`, `description`, `quantity`, `unit_amount`, `tax_rate`, `line_total`, `source_type` CHECK(package, placement, addon, adjustment), `source_id`. Retention: Retain.

### `invoice_events`
Append-only invoice status history. PK `id`, FK `invoice_id`, `from_status`, `to_status`, `actor`, `occurred_at`, `note`. Retention: Retain.

### `payments`
PK `id`, FK `invoice_id`, `amount numeric`, `currency_id`, `method` CHECK(card, mobile_money, bank_transfer, manual), `provider text`, `provider_customer_reference`, `provider_transaction_reference`, `status` CHECK(pending, succeeded, failed, refunded), `recorded_by` (manual), `paid_at`. **Gateway-swappable** (C-3/R-103). Sensitivity: Sensitive. Access: Fr/HQ accounts, Emp R(own), SA. Retention: Retain.

### `payment_events`, `payment_proofs`, `credit_adjustments`, `billing_contacts`
- `payment_events`: append-only (from_status/to_status/actor/note).
- `payment_proofs`: `payment_id`, `document_id FK`, `uploaded_by` (manual proof).
- `credit_adjustments`: `invoice_id`, `type` CHECK(credit, discount, refund, write_off), `amount`, `reason`, `approved_by`.
- `billing_contacts`: `employer_organization_id`, `name`, `email`, `phone`, `is_primary`.

Retention: Retain. Access: accounts-scoped, Emp R(own where relevant).

---

## Domain I — Jobs

### `job_orders`
The employer's job/hiring request + internal ownership. **Order lifecycle** (distinct from publication/application).
PK `id`. Tenant: `responsible_organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| employer_organization_id | uuid | NN | — | FK→employer_organizations (hiring org) |
| responsible_organization_id | uuid | NN | — | FK→organizations (owning franchise/HQ) |
| created_from_template_id | uuid | Y | — | FK→job_templates |
| title | text | NN | — | |
| department | text | Y | — | |
| description | text | Y | — | |
| responsibilities | text | Y | — | |
| requirements | text | Y | — | |
| required_skills | jsonb | Y | — | structured skill list |
| min_experience_years | int | Y | — | |
| education_level_id | uuid | Y | — | FK |
| employment_type_id | uuid | Y | — | FK |
| work_arrangement_id | uuid | Y | — | FK |
| country_id | uuid | NN | — | FK→countries |
| location_city | text | Y | — | |
| compensation_min | numeric | Y | — | |
| compensation_max | numeric | Y | — | |
| currency_id | uuid | Y | — | FK |
| benefits | text | Y | — | |
| vacancy_count | int | NN | 1 | |
| application_deadline | date | Y | — | |
| target_start_date | date | Y | — | |
| is_confidential | bool | NN | false | "Confidential Employer" |
| is_public | bool | NN | true | public vs private job |
| recruitment_path | text | NN | — | CHECK ('A','B'); lockable |
| path_locked_at | timestamptz | Y | — | set when first application arrives |
| status | text | NN | `'draft'` | CHECK (draft, submitted, approved, active, on_hold, filled, partially_filled, cancelled, closed, filled_externally, closed_without_hire) |
| closed_reason | text | Y | — | |
| closed_by | uuid | Y | — | |

**[+audit cols]** Sensitivity: Internal (confidential jobs Sensitive). Access: Emp R/W(own draft fields), Fr/HQ ⟳(responsible/oversight), SA ✔. Retention: Retain/Soft. Indexed on (responsible_organization_id,status), (employer_organization_id).

### `job_order_events`
Append-only job-order status history. PK `id`, FK `job_order_id`, `from_status`, `to_status`, `actor`, `reason`, `occurred_at`. Retention: Retain.

### `job_assignments`
Recruiters assigned to a job (Path B). PK `id`, FK `job_order_id`, `user_id`, `role` CHECK(owner, recruiter, coordinator), `assigned_by`. Access: Fr/HQ, SA. Retention: Retain.

### `job_screening_questions`
Employer-specific application questions. PK `id`, FK `job_order_id`, `prompt`, `question_type` CHECK(boolean, single_choice, multi_choice, numeric, short_text), `options jsonb`, `is_required bool`, `ordinal`. Access: Emp/Fr/HQ. Retention: Retain.

### `job_required_documents`
Documents required for the job. PK `id`, FK `job_order_id`, `document_type_id`, `is_required bool`. Retention: Retain.

### `job_templates`
Reusable job templates (org-scoped). PK `id`, `owning_organization_id`, `name`, `payload jsonb`. Access: owning org. Retention: Retain.

### `job_postings`
**Publication/advertisement lifecycle** (distinct milestone "Advertised"). One order → many postings (re-posts / multi-channel).
PK `id`. Tenant: inherits via job_order.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| job_order_id | uuid | NN | — | FK→job_orders |
| country_id | uuid | NN | — | FK (public board scoping) |
| status | text | NN | `'draft'` | CHECK (draft, pending_approval, advertised, paused, expired, unpublished) |
| approval_status | text | NN | `'not_submitted'` | CHECK (not_submitted, submitted, changes_requested, approved) |
| approved_by | uuid | Y | — | FK→user_profiles |
| published_at | timestamptz | Y | — | |
| unpublished_at | timestamptz | Y | — | |
| current_version_id | uuid | Y | — | FK→job_posting_versions |
| public_slug | citext | Y | — | UK; public URL |

**[+audit cols]** Sensitivity: Public (when advertised). Access: Public R(advertised only), Emp/Fr/HQ ⟳, SA ✔. Retention: Retain/Soft. `UK(public_slug)`.

### `job_posting_versions`
Immutable posting content versions. PK `id`, FK `job_posting_id`, `version_no`, `title`, `body`, `snapshot jsonb`, `created_by`. Retention: Retain.

### `job_posting_channels`
Distribution channels (public_board active; social reserved). PK `id`, FK `job_posting_id`, `channel` CHECK(public_board, linkedin, facebook, instagram, x, paid_tender), `external_reference`, `status`, `shared_at`. Retention: Retain.

### `job_posting_events`
Append-only publication history. PK `id`, FK `job_posting_id`, `from_status`, `to_status`, `actor`, `occurred_at`. Retention: Retain.

### `job_search_documents`
FTS/filter index for the public job board. PK `job_posting_id`, `search_tsv tsvector`, `country_id`, `city`, `industry_id`, `employment_type_id`, `level_rank`, `is_advertised bool`, `deadline date`. Retention: rebuilt.

---

## Domain J — Applications & Pipeline (Ring 3a)

### `candidate_engagements`
Franchise-private engagement record (one per candidate × owning org). The Ring-3a root.
PK `id`. Tenant: `owning_organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| candidate_id | uuid | NN | — | FK→candidates |
| owning_organization_id | uuid | NN | — | FK→organizations |
| source_id | uuid | Y | — | FK→candidate_sources |
| engagement_status | text | NN | `'active'` | CHECK (active, dormant, archived) |
| internal_summary | text | Y | — | franchise-private |
| has_processing_consent | bool | NN | false | derived/maintained from consent_records |

**[+audit cols]** Sensitivity: Internal (franchise-private). Access: **owning Fr only**, HQ ⟳(oversight), SA. **Other franchises ✖.** Retention: Retain/Soft. `UK(candidate_id,owning_organization_id)`.

### `applications`
Candidate application to a job (the pipeline record). Also carries Path A/B routing & sourcing metadata.
PK `id`. Tenant: `owning_organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| candidate_id | uuid | NN | — | FK→candidates |
| job_order_id | uuid | NN | — | FK→job_orders |
| owning_organization_id | uuid | NN | — | FK→organizations (responsible franchise/HQ; = employer for pure Path A self-managed) |
| recruitment_path | text | NN | — | CHECK ('A','B') copied from job at creation |
| entry_type | uuid | NN | — | FK→candidate_sources (applied_direct, recruiter_sourced, …) |
| is_direct_application | bool | NN | true | false when sourced |
| sourced_contacted_at | timestamptz | Y | — | Path "Sourced – not yet contacted" |
| network_search_permission | bool | Y | — | whether the candidate was sourced with search permission |
| candidate_existed_globally | bool | NN | true | existed before this workflow |
| current_stage_id | uuid | NN | — | FK→pipeline_stages (candidate-class) |
| assigned_recruiter_id | uuid | Y | — | FK→user_profiles |
| assigned_team_id | uuid | Y | — | FK→teams |
| priority | text | NN | `'normal'` | CHECK (low, normal, high) |
| cv_document_version_id | uuid | Y | — | FK→document_versions (CV used) |
| consent_status | text | NN | `'not_required'` | CHECK (not_required, required, pending, granted, withdrawn) |
| is_on_hold | bool | NN | false | |
| withdrawn_at | timestamptz | Y | — | |
| reopened_from_rejection_at | timestamptz | Y | — | |
| next_action | text | Y | — | "My Work" queue |
| next_action_due | date | Y | — | |

**[+audit cols]** Sensitivity: Sensitive. Access: Cand R(candidate-facing status mapping only), owning Fr ✔, HQ ⟳, Emp ⟳(Path A: their own job's applications; masked), SA ✔. **Other franchises ✖.** Retention: Retain/Soft. `UK(candidate_id,job_order_id)` (duplicate prevention; reapplication uses reopen). Indexes on (owning_organization_id,current_stage_id), (assigned_recruiter_id,next_action_due).

### `application_stage_events`
Append-only stage-transition history (feeds KPIs). PK `id`, FK `application_id`, `from_stage_id`, `to_stage_id`, `actor_user_id`/`actor_service_id`, `occurred_at`, `time_in_previous_stage interval`, `reason`, `metadata jsonb`. Retention: Retain (KPI source). Indexed (application_id, occurred_at), (to_stage_id, occurred_at).

### `application_snapshots`
Immutable snapshot of the candidate application at submission time (R-071, S4 §9).
PK `id`, FK `application_id`, `profile_snapshot jsonb`, `screening_answers jsonb`, `cv_document_version_id`, `consent_record_id`, `snapshot_hash text`, `taken_at`. Sensitivity: Sensitive. Access: Cand R(own "submitted information"), owning Fr, SA. Retention: Retain (audit trail).

### `application_answers`
Answers to employer-specific job screening questions. PK `id`, FK `application_id`, `job_screening_question_id`, `answer jsonb`. Access: as application + Emp(their job). Retention: Retain.

### `screening_records`
Structured CV-screening result. PK `id`, FK `application_id`, `owning_organization_id`, `outcome` CHECK(advance, keep, request_info, reject), `initial_rating int`, `notes text`, `screened_by`, `screened_at`. Sensitivity: Internal (franchise-private). Access: owning Fr, HQ ⟳, SA. **Emp ✖.** Retention: Retain per schedule.

### `screening_criteria_results`
Per-criterion checklist result. PK `id`, FK `screening_record_id`, `criterion` CHECK(mandatory_experience, required_skills, industry_exposure, education_certification, location_mobility, work_authorization, salary_alignment), `result` CHECK(meets, partial, fails, unknown), `note`. Retention: Retain.

### `screening_scorecards`
Structured screening-interview scorecard. PK `id`, FK `application_id`, `owning_organization_id`, `overall_recommendation` CHECK(strongly_recommend, recommend, hold, do_not_recommend), `narrative text`, `completed_by`, `completed_at`. **Mandatory before advancing past Shortlisted** (gate enforced in transition fn). Access: owning Fr, HQ ⟳, SA. Retention: Retain.

### `scorecard_competency_scores`
Per-competency score. PK `id`, FK `screening_scorecard_id`, `competency` CHECK(relevant_experience, job_skills, communication, motivation, career_direction, salary, availability, notice_period, location_mobility, work_authorization), `score int`, `note`. Retention: Retain.

### `assessment_records`
Vendor-neutral test/assessment record (TestGorilla/Central Test/future builder — **no Pmaps-specific fields**).
PK `id`, FK `application_id`, `owning_organization_id`, `test_type text`, `provider text`, `provider_reference text`, `invited_at`, `due_at`, `completion_status` CHECK(not_required, invited, in_progress, completed, expired), `score numeric`, `pass_threshold numeric`, `recruiter_interpretation text`, `result_document_id FK`, `not_required_reason text`. Access: owning Fr, HQ ⟳, SA; Emp ⟳(only if included in submission). Retention: Retain.

### `reference_checks`
Per-referee reference record — **more restrictive than screening notes; never in shared search** (R-063).
PK `id`, FK `application_id`, `owning_organization_id`, `referee_name`, `relationship`, `organization`, `contact_method`, `contacted_at`, `completed_by`, `outcome` CHECK(positive, mixed, negative, unreachable), `concerns text`, `follow_up_required bool`, `candidate_authorization_status` CHECK(authorized, pending, declined). Sensitivity: Highly sensitive. Access: owning Fr with `reference.read` permission only, SA. **HQ restricted; Emp ✖.** Retention: Retain per schedule; Purge sensitive contact early.

### `application_rejections`
Structured rejection (every rejection needs a reason, R-062). PK `id`, FK `application_id`, `owning_organization_id`, `rejection_reason_id FK`, `other_note text`, `communication_outcome` CHECK(notify_now, schedule, already_informed, do_not_notify), `rejected_by`, `rejected_at`, `is_active bool` (false if reopened). Access: owning Fr, HQ ⟳, SA. **Never in shared search; not shown to employer as candidate history.** Retention: Retain per schedule (not "permanent by default", S5).

---

## Domain K — Employer Submissions (Ring 3b)

### `candidate_submissions`
Deliberate, consent-gated employer disclosure. **Never the live profile.**
PK `id`. Tenant: `submitting_organization_id` (creator) + `employer_organization_id` (recipient).

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| application_id | uuid | Y | — | FK→applications (Path B) |
| candidate_id | uuid | NN | — | FK→candidates |
| job_order_id | uuid | NN | — | FK→job_orders |
| employer_organization_id | uuid | NN | — | FK→employer_organizations (recipient) |
| submitting_organization_id | uuid | NN | — | FK→organizations (franchise/HQ) |
| submitting_recruiter_id | uuid | Y | — | FK→user_profiles |
| consent_record_id | uuid | NN | — | FK→consent_records (**purpose=employer_submission, recipient=employer**) |
| status | text | NN | `'consent_pending'` | CHECK (consent_pending, submitted, viewed, shortlisted, interview_requested, offered, rejected, withdrawn, access_revoked, access_expired) |
| is_masked | bool | NN | true | |
| client_facing_summary | text | Y | — | recruiter-prepared summary |
| submitted_at | timestamptz | Y | — | |
| access_expires_at | timestamptz | Y | — | employer access period |
| access_revoked_at | timestamptz | Y | — | on consent withdrawal |
| version_no | int | NN | 1 | resubmission version |

**[+audit cols]** Sensitivity: Sensitive. Access: Emp R(own, masked, active), submitting Fr ✔, HQ ⟳, SA ✔. **Other franchises ✖; other employers ✖.** Retention: Retain (what employer was authorized to see). Constraint: cannot become `submitted` unless a valid matching consent exists (enforced in fn + CHECK on consent_status). Indexes (employer_organization_id,status), (candidate_id).

### `submission_snapshots` (1:1)
Frozen disclosure content. PK `id`, FK `candidate_submission_id` UK, `disclosed_profile jsonb` (only approved fields), `disclosed_fields text[]`, `cv_document_version_id FK`, `test_results_included bool`, `reference_summary_included bool`, `proposed_salary jsonb`, `snapshot_hash text`, `taken_at`. Immutable. Access: as parent. Retention: Retain.

### `submission_documents`
Which document versions were shared. PK `id`, FK `candidate_submission_id`, `document_version_id FK`, `disclosure_scope` CHECK(watermarked_preview, download). Access: as parent. Retention: Retain.

### `submission_events`
Append-only submission history incl. access revocation. PK `id`, FK `candidate_submission_id`, `from_status`, `to_status`, `actor`, `occurred_at`, `note`. Retention: Retain.

### `submission_views`
Employer view/access audit. PK `id`, FK `candidate_submission_id`, `viewed_by user`, `viewed_at`, `document_version_id?`, `ip`, `user_agent`. Also mirrored to `audit_log` + `candidate_access_events`. Retention: Retain.

### `submission_comments`, `submission_ratings`
Employer feedback tied to a submission (separate from Ring-3a notes).
- `submission_comments`: `candidate_submission_id`, `author_id`, `body`, `visibility` CHECK(employer_and_recruiter). Visible to assigned recruiter + employer hiring team; **not** Shugulika private notes.
- `submission_ratings`: `candidate_submission_id`, `rated_by`, `rating int`, `dimension`.

Access: Emp(own) + submitting Fr, SA. Retention: Retain.

---

## Domain L — Notes, Activities, Tasks

### `notes`
Audience-scoped note with explicit visibility (no generic notes box).
PK `id`. Tenant: `owning_organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| owning_organization_id | uuid | NN | — | FK→organizations |
| author_id | uuid | NN | — | FK→user_profiles |
| subject_type | text | NN | — | CHECK (candidate, application, engagement, submission, employer, job_order, interview) |
| subject_id | uuid | NN | — | polymorphic (guarded by subject_type + FK-check triggers/partial validation) |
| note_kind | text | NN | — | CHECK (structured_screening, private_internal, hq_operational, employer_comment, candidate_visible, compliance) |
| visibility | text | NN | — | CHECK (recruiter_private, franchise_internal, hq_accessible, employer_visible, candidate_visible, compliance_restricted) |
| body | text | NN | — | |

**[+audit cols]** Sensitivity: varies by kind. Access: computed from `visibility` + `owning_organization_id`. **Every note has an explicit audience.** Retention: Retain/Soft per kind. Indexes (subject_type,subject_id), (owning_organization_id,visibility).

### `note_mentions`, `note_attachments`
- `note_mentions`: `note_id`, `mentioned_user_id`. Triggers notification.
- `note_attachments`: `note_id`, `document_id FK`.

### `tasks`
Recruiter/accounts work items + reminders. PK `id`, `owning_organization_id`, `assigned_to`, `created_by`, `subject_type`, `subject_id`, `title`, `due_at`, `reminder_at`, `status` CHECK(open, done, cancelled), `task_type` CHECK(follow_up, invoicing, consent_reminder, feedback_chase, generic). Access: owning org. Retention: Soft.

### `activity_events`
Denormalized activity timeline (calls, notes, reviews, stage changes) for fast per-subject display. PK `id`, `owning_organization_id`, `subject_type`, `subject_id`, `event_type`, `actor`, `occurred_at`, `summary`, `metadata jsonb`. Access: owning org (+ candidate for candidate-visible events). Retention: Retain. (This is a read-optimized projection; source of truth remains the domain `*_events` tables.)

---

## Domain M — Interviews (human)

### `interviews`
Human interview record (phone/recruiter/employer/live-video/in-person).
PK `id`. Tenant: `owning_organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| application_id | uuid | Y | — | FK→applications |
| candidate_submission_id | uuid | Y | — | FK (employer/client interview) |
| owning_organization_id | uuid | NN | — | FK→organizations |
| interview_type_id | uuid | NN | — | FK→interview_types |
| round_no | int | NN | 1 | |
| scheduled_start | timestamptz | Y | — | |
| duration_minutes | int | Y | — | |
| location_or_link | text | Y | — | |
| status | text | NN | `'requested'` | CHECK (requested, scheduled, confirmed, rescheduled, completed, cancelled, no_show) |
| candidate_confirmed_at | timestamptz | Y | — | |
| reminder_status | text | Y | — | |
| recording_document_id | uuid | Y | — | FK→documents |
| recording_consent_id | uuid | Y | — | FK→consent_records |
| outcome | text | Y | — | CHECK (advance, hold, reject, offer) |
| candidate_feedback | text | Y | — | separate from client feedback |
| client_feedback | text | Y | — | separate from private interpretation |
| decision_deadline | date | Y | — | |

**[+audit cols]** Sensitivity: Sensitive. Access: owning Fr ✔, Emp ⟳(employer interviews on their submission/job), Cand R(schedule/confirmation), HQ ⟳, SA. Retention: Retain. Recording access requires `recording_consent_id`. Indexes (application_id), (owning_organization_id,scheduled_start).

### `interview_panelists`
PK `id`, FK `interview_id`, `user_id?`/`external_name`, `role` CHECK(interviewer, observer, coordinator). Retention: Retain.

### `interview_events`
Append-only status history (requested→scheduled→…). Retention: Retain.

### `interview_scorecards`, `interview_competency_scores`
- `interview_scorecards`: `interview_id`, `owning_organization_id`, `overall_recommendation`, `narrative`, `completed_by`, `audience` CHECK(internal, employer_visible).
- `interview_competency_scores`: `interview_scorecard_id`, `competency`, `score`, `note`.

Access: owning Fr; employer only where `audience=employer_visible`. Retention: Retain.

### `interview_question_sets`, `interview_questions`
Reusable question sets (org-scoped) for human interviews. `interview_question_sets`: `owning_organization_id`, `name`, `version_no`. `interview_questions`: `question_set_id`, `prompt`, `ordinal`, `competency`. Retention: Retain (versioned).

---

## Domain N — AI Video Interviews

*(Full model; may be Phase 2 but structured now. All AI-media/eval tables carry retention + deletion fields.)*

### Definition sub-graph
- **`ai_interview_templates`**: `id PK`, `owning_organization_id`, `name`, `description`, `is_active`. Owner: org/HQ.
- **`ai_interview_template_versions`**: `id PK`, `template_id FK`, `version_no`, `is_current bool`, `effective_from`. **Versioned** (R-082).
- **`ai_competencies`**: `id PK`, `template_version_id FK`, `name`, `weight numeric`, `rubric_text`, `ordinal`.
- **`ai_question_banks`**: `id PK`, `template_version_id FK`, `name`.
- **`ai_questions`**: `id PK`, `question_bank_id FK`, `ordinal`, `competency_id FK?`, `is_follow_up bool`, `parent_question_id FK?`.
- **`ai_question_versions`**: `id PK`, `question_id FK`, `version_no`, `prompt_text`, `prep_seconds int`, `response_limit_seconds int`, `max_retakes int`, `is_current bool`. **Unversioned questions prohibited** (R-082).
- **`ai_interview_configs`**: `id PK`, `job_order_id FK`, `template_version_id FK`, `is_required bool`, `not_required_reason text`, `retake_policy jsonb`, `created_by`. Job-specific config.

Access: owning org/HQ config; SA. Retention: Retain (needed for reproducibility).

### Execution sub-graph
- **`ai_interview_invitations`**: `id PK`, `ai_interview_config_id FK`, `application_id FK`, `candidate_id FK`, `secure_token_hash text`, `status` CHECK(sent, opened, started, completed, expired, revoked), `expires_at`, `sent_at`. Sensitivity: Sensitive (secure access). Access: owning Fr, Cand(via token), SA.
- **`ai_interview_sessions`**: `id PK`, `invitation_id FK`, `application_id FK`, `consent_record_id FK` (**purpose=record_ai_interview**), `status` CHECK(in_progress, completed, abandoned, error), `device_metadata jsonb`, `browser_metadata jsonb`, `started_at`, `completed_at`, `error_reason`. Access: owning Fr, Cand R(own), Svc(evaluator, scoped to this session only), SA.
- **`ai_interview_responses`**: `id PK`, `session_id FK`, `ai_question_version_id FK`, `ordinal`, `retake_no int`, `response_status`, `duration_seconds`. Access: as session.
- **`ai_media_assets`**: `id PK`, `response_id FK`, `media_kind` CHECK(video, audio), `bucket_id`, `object_path`, `upload_status` CHECK(pending, uploaded, failed), `processing_status` CHECK(pending, processing, done, error), `size_bytes`, `duration_seconds`, `checksum`, `retention_status`, `delete_after`. **Raw media in Storage, not PG** (R-021). Sensitivity: Highly sensitive. Access: owning Fr(via consent), Cand R(own), Svc(scoped), SA. Retention: Purge on schedule (independent of transcript/eval).
- **`ai_transcripts`**: `id PK`, `media_asset_id FK`, `language`, `full_text`, `redaction_status`, `translation_of_transcript_id FK?`, `retention_status`, `delete_after`. Access: as media (translation later). Retention: independent Purge.
- **`ai_transcript_segments`**: `id PK`, `transcript_id FK`, `ordinal`, `speaker`, `start_ms`, `end_ms`, `text`. Retention: with transcript.

### Model-execution sub-graph
- **`ai_model_runs`**: `id PK`, `session_id FK`, `provider text`, `model_id text`, `model_version text`, `prompt_version text`, `rubric_version text`, `run_status` CHECK(queued, running, succeeded, failed), `reprocessing_of_run_id FK?` (**reprocessing = new run, R-082**), `token_cost int`, `cost_amount numeric`, `error_reason`, `started_at`, `completed_at`. Sensitivity: Internal. Access: owning Fr, HQ ⟳, SA. Retention: Retain (traceability) then Purge with outputs.
- **`ai_processing_errors`**: `id PK`, `model_run_id FK`, `stage`, `error_code`, `detail`. Retention: Retain (ops).

### Output sub-graph (machine) — separate from human decision
- **`ai_evaluations`**: `id PK`, `model_run_id FK`, `overall_score numeric`, `confidence numeric`, `summary_text`, `audience` CHECK(recruiter, candidate), `is_superseded bool`. **Machine output only.** Access: owning Fr, HQ ⟳, Cand R(only `audience=candidate`), SA. Retention: Purge on schedule.
- **`ai_evaluation_scores`**: `id PK`, `ai_evaluation_id FK`, `competency_id FK`, `score numeric`, `confidence numeric`, `evidence_text`, `evidence_segment_id FK?`. Evidence links back to transcript segment. Retention: with evaluation.
- **`ai_integrity_flags`**: `id PK`, `ai_evaluation_id FK`, `flag_type` CHECK(possible_multiple_speakers, off_topic, low_audio_quality, possible_assistance, anomaly), `severity`, `detail`. Retention: with evaluation.

### Human-decision & governance sub-graph
- **`ai_human_reviews`**: `id PK`, `ai_evaluation_id FK`, `reviewer_id FK`, `agrees_with_ai bool`, `overrides_ai bool`, `override_reason text`, `final_recommendation` CHECK(advance, hold, reject, not_required), `is_final bool`, `reviewed_at`. **Human decision never overwritten by AI; AI never auto-advances** (R-081/R-083). Access: owning Fr, HQ ⟳, SA. Retention: Retain.
- **`ai_fairness_reviews`**: `id PK`, `template_version_id FK` or `ai_evaluation_id FK?`, `review_type` CHECK(bias, adverse_impact, quality), `outcome`, `reviewer_id`, `notes`, `reviewed_at`. Retention: Retain.

*(AI-interview deletion is orchestrated by scheduled jobs honoring each table's `retention_status`/`delete_after`; see `06` §AI processing and `09`.)*

---

## Domain O — Offers & Placements

### `offers`
PK `id`. Tenant: `owning_organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| application_id | uuid | NN | — | FK→applications |
| candidate_submission_id | uuid | Y | — | FK (employer-originated) |
| owning_organization_id | uuid | NN | — | FK→organizations |
| status | text | NN | `'preparing'` | CHECK (preparing, sent, negotiating, accepted, declined, expired, withdrawn) |
| position_title | text | Y | — | |
| compensation_amount | numeric | Y | — | |
| currency_id | uuid | Y | — | |
| benefits | text | Y | — | |
| proposed_start_date | date | Y | — | |
| conditions | text | Y | — | |
| offer_document_id | uuid | Y | — | FK→documents |
| candidate_response | text | Y | — | |
| declined_reason | text | Y | — | declined ≠ rejected |
| expires_at | timestamptz | Y | — | |

**[+audit cols]** Sensitivity: Sensitive. Access: owning Fr ✔, Emp ⟳(own submission/job), Cand R(offer-stage), HQ ⟳, SA. Retention: Retain.

### `offer_versions`
Immutable offer terms versions. PK `id`, FK `offer_id`, `version_no`, `payload jsonb`, `created_by`. Retention: Retain.

### `offer_events`
Append-only offer status history. Retention: Retain.

### `placements` (1:1 with accepted offer)
PK `id`. Tenant: `owning_organization_id`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| offer_id | uuid | NN | — | FK→offers UK |
| application_id | uuid | NN | — | FK→applications |
| employer_organization_id | uuid | NN | — | FK |
| owning_organization_id | uuid | NN | — | FK (franchise attribution) |
| responsible_recruiter_id | uuid | Y | — | FK→user_profiles |
| agreed_start_date | date | Y | — | |
| final_compensation | numeric | Y | — | |
| currency_id | uuid | Y | — | |
| placement_fee | numeric | Y | — | revenue |
| fee_basis | text | Y | — | |
| guarantee_period_days | int | Y | — | |
| status | text | NN | `'active'` | CHECK (active, guarantee_period, completed, failed, replaced) |
| replacement_of_placement_id | uuid | Y | — | FK→self |

**[+audit cols]** Sensitivity: Sensitive (revenue). Access: owning Fr accounts/recruiter, HQ ⟳(totals/oversight), SA. Retention: Retain. Auto-emits invoicing task (fn).

### `placement_events`
Append-only placement history (incl. guarantee outcomes). Retention: Retain.

---

## Domain P — Communications (channel-neutral)

### `message_templates`, `message_template_versions`
- `message_templates`: `id PK`, `key` UK, `notification_category_id FK`, `owning_organization_id?` (global or org-branded), `name`, `is_active`.
- `message_template_versions`: `id PK`, `template_id FK`, `version_no`, `channel_id FK`, `locale`, `subject`, `body`, `variables jsonb`, `is_current`. **Versioned** (R-110).

Access: SA/HQ W, all R (internal). Retention: Retain.

### `messages`
A transactional message instance (event → recipients). PK `id`, `template_version_id FK?`, `notification_category_id FK`, `subject_type`, `subject_id`, `variables jsonb`, `scheduled_for timestamptz?`, `status` CHECK(queued, sent, cancelled), `created_by_service?`. Access: owning org/SA/Svc. Retention: Retain (comms audit).

### `message_recipients`
PK `id`, `message_id FK`, `recipient_user_id?`, `recipient_candidate_id?`, `external_address text?` (email/phone for external), `resolved_channel_id FK`. Sensitivity: Sensitive (contact). Access: Svc/SA; owner limited. Retention: Retain.

### `message_deliveries`
Per-channel delivery attempt (email/sms/in_app; **whatsapp reserved**).
PK `id`, `message_recipient_id FK`, `channel_id FK`, `provider text`, `provider_message_id text`, `status` CHECK(queued, sent, delivered, failed, bounced, read), `attempt_no int`, `failure_reason text`, `sent_at`, `delivered_at`, `read_at`. Access: Svc/SA. Retention: Retain. Supports WhatsApp later with no schema change (channel + provider fields already generic).

### `communication_preferences`
Opt-in/out per subject per category per channel. PK `id`, `user_id?`/`candidate_id?`, `notification_category_id FK`, `channel_id FK`, `opted_in bool`, `source`, `updated_at`, `consent_record_id FK?` (e.g. WhatsApp opt-in links to consent). `UK(subject, category, channel)`. Access: subject ✔(own), Svc R. Retention: Retain.

### `in_app_notifications`
PK `id`, `user_id FK`, `notification_category_id`, `title`, `body`, `subject_type`, `subject_id`, `read_at`. Access: user(own). Retention: Purge old.

---

## Domain Q — Whistleblowing / Safeguarding (restricted)

### `safeguarding_cases`
Confidential intake — **not** an ordinary recruiter chat; restricted access (R-111).
PK `id`. Tenant: platform/HQ safeguarding team (not franchise recruiters).

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| case_reference | text | NN | — | UK |
| reporter_candidate_id | uuid | Y | — | FK (nullable/anonymous) |
| reporter_contact | text | Y | — | optional |
| about_organization_id | uuid | Y | — | FK |
| category | text | Y | — | |
| description | text | NN | — | encrypted-at-rest recommended |
| status | text | NN | `'received'` | CHECK (received, acknowledged, in_review, resolved, closed) |
| assigned_to | uuid | Y | — | FK→user_profiles (safeguarding contact) |
| confidentiality_level | text | NN | `'restricted'` | |

Sensitivity: Highly sensitive. Access: **only** `safeguarding.read` permission holders (senior/SA); **ordinary recruiters ✖**, franchise users ✖ unless explicitly assigned. Retention: Retain per policy; Hold. `case_reference` UK.

### `safeguarding_case_events`
Append-only case history. PK `id`, FK `safeguarding_case_id`, `from_status`, `to_status`, `actor`, `note`, `occurred_at`. Access: restricted as parent. Retention: Retain.

---

## Domain R — Consent

### `consent_records`
Versioned, auditable consent ledger (R-030/R-031).
PK `id`. Owner: subject.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | uuid | NN | gen | PK |
| subject_candidate_id | uuid | Y | — | FK→candidates |
| subject_user_id | uuid | Y | — | FK→user_profiles |
| consent_purpose_id | uuid | NN | — | FK→consent_purposes |
| covered_organization_id | uuid | Y | — | FK→organizations (recipient scope; required for employer_submission) |
| covered_data_scope | jsonb | NN | `'{}'` | which data/fields/documents |
| legal_document_version_id | uuid | Y | — | FK→legal_document_versions (notice/text version) |
| granted_by | uuid | Y | — | FK→user_profiles (who gave it) |
| method | text | NN | — | CHECK (web_form, otp_confirmed, verbal_recorded, imported, guardian) |
| evidence | jsonb | NN | `'{}'` | capture metadata (ip, ua, screen hash) |
| purpose_detail | text | Y | — | specific purpose text |
| granted_at | timestamptz | NN | now() | |
| expires_at | timestamptz | Y | — | |
| withdrawn_at | timestamptz | Y | — | |
| withdrawal_effect | text | Y | — | consequences applied |

**[+audit cols]** Sensitivity: Sensitive (legal). Access: Cand ✔(own), owning Fr ⟳(status + records covering their org), HQ ⟳, SA. Retention: Retain (legal evidence). Constraint: exactly one subject set; `covered_organization_id` NN when purpose requires recipient. Indexes (subject_candidate_id, consent_purpose_id), (covered_organization_id).

### `legal_document_versions`
Versioned privacy notices, terms, consent texts. PK `id`, `document_kind` CHECK(privacy_policy, terms, consent_text, dpa), `version_no`, `locale`, `title`, `body`, `effective_from`, `is_current`. `UK(document_kind, version_no, locale)`. Access: all R, SA W. Retention: Retain (immutable).

---

## Domain S — Audit, Privacy & Compliance

### `audit.audit_log`
Immutable append-only audit trail (in dedicated `audit` schema, not API-exposed).
PK `id bigint identity`.

| Column | Type | N | Default | Notes |
|---|---|---|---|---|
| id | bigint | NN | identity | PK |
| occurred_at | timestamptz | NN | now() | |
| actor_user_id | uuid | Y | — | FK→user_profiles |
| actor_service_id | uuid | Y | — | FK→service_actors |
| organization_context_id | uuid | Y | — | FK→organizations |
| action | text | NN | — | e.g. `submission.viewed`, `document.downloaded`, `consent.withdrawn`, `permission.changed` |
| entity_type | text | NN | — | |
| entity_id | uuid | Y | — | |
| before_value | jsonb | Y | — | |
| after_value | jsonb | Y | — | |
| correlation_id | uuid | Y | — | request id |
| ip_address | inet | Y | — | |
| user_agent | text | Y | — | |
| is_sensitive_access | bool | NN | false | |

Sensitivity: Sensitive. Access: **no UPDATE/DELETE for anyone** (append-only, enforced by grants + trigger); SELECT limited to `audit.read` (HQ oversight/SA) scoped by org. Retention: Retain (long, statutory); Hold-aware. Partitioned by month (see `08`). Indexes (entity_type,entity_id), (actor_user_id,occurred_at), (organization_context_id,occurred_at).

### `data_subject_requests`
Candidate access/correction/deletion/export requests (R-131). PK `id`, `candidate_id FK`, `request_type` CHECK(access, correction, deletion, export, restriction), `status` CHECK(received, in_progress, completed, rejected), `requested_at`, `due_at`, `handled_by`, `resolution_note`. Access: Cand R(own), DPO/SA. Retention: Retain.

### `dsr_events`
Append-only DSR history. Retention: Retain.

### `retention_policies`
Per-entity retention rule. PK `id`, `entity_type text UK`, `retention_action` CHECK(retain, soft_delete, anonymize, purge), `retention_period interval`, `basis text`, `is_active`. Access: DPO/SA. Retention: Retain. (Durations = OD-7.)

### `legal_holds`
Overrides retention for named entities/subjects. PK `id`, `entity_type`, `entity_id?`, `subject_candidate_id?`, `reason`, `placed_by`, `placed_at`, `released_at`. Access: DPO/SA. Retention: Retain.

### `cross_border_transfers`
Records of cross-border processing/disclosure (PDPC). PK `id`, `subject_candidate_id?`, `from_country_id`, `to_country_id`, `purpose`, `legal_basis`, `recipient`, `consent_record_id?`, `occurred_at`. Access: DPO/HQ/SA. Retention: Retain.

### `dpia_references`, `security_incidents`, `incident_affected_subjects`
- `dpia_references`: `id`, `title`, `scope`, `reference`, `status`, `completed_at`.
- `security_incidents`: `id`, `title`, `severity`, `detected_at`, `status`, `description`, `reference`.
- `incident_affected_subjects`: `security_incident_id`, `candidate_id?`, `organization_id?`.

Access: DPO/SA. Retention: Retain.

---

## Domain T — Reporting

No new base tables (metrics derive from transactional + `*_events` tables). Materialized aggregation tables introduced only where justified (see `10-reporting-and-dashboard-views.md`):
- `mv_recruiter_kpis`, `mv_franchise_performance`, `mv_country_overview`, `mv_pipeline_funnel`, `mv_time_in_stage` — materialized views refreshed on schedule.
- `dashboard_exceptions` — a thin base table populated by triggers/jobs for the compliance exception queue (client submission without consent, missing screening notes, rejection without reason, cross-franchise access attempt, unusual view volume, suspended-user activity, overdue retention). PK `id`, `exception_type`, `severity`, `subject_type`, `subject_id`, `owning_organization_id`, `status`, `detected_at`, `resolved_at`. Access: HQ/SA + owning franchise (own). Retention: Retain.

---

## Domain U — Search

No additional base tables beyond `candidate_search_documents` (Domain D) and `job_search_documents` (Domain I). Both are trigger-maintained projections honoring consent/visibility and carry GIN/trigram/tsvector indexes (see `08`). The optional `embedding` column on `candidate_search_documents` is the reserved vector-search extension point (disabled in MVP).

---

## Table count by domain (see `README`/summary)

| Domain | Approx. tables |
|---|---|
| A Identity & Access | 3 |
| B Organizations & Membership | 11 |
| C Reference & Config | 24 |
| D Candidate Global | 19 |
| E Documents & Media | 4 |
| F Verification | 3 |
| G Employers | 3 |
| H Packages & Billing | 15 |
| I Jobs | 11 |
| J Applications & Pipeline | 12 |
| K Employer Submissions | 7 |
| L Notes/Tasks/Activities | 5 |
| M Interviews (human) | 7 |
| N AI Video Interviews | 20 |
| O Offers & Placements | 5 |
| P Communications | 7 |
| Q Whistleblowing | 2 |
| R Consent | 2 |
| S Audit/Privacy/Compliance | 9 |
| T Reporting | 6 (mostly views + 1 table) |
| U Search | 0 (projections in D/I) |
| **Total** | **≈ 175 tables/objects** (≈150 base tables + reference + views) |

