# 05 — Relationships & Constraints

Cardinalities, foreign-key delete behavior, uniqueness, state invariants, business constraints, duplicate-prevention, and cross-tenant integrity rules.

---

## 1. FK delete-behavior policy

Default posture: **`ON DELETE RESTRICT`** for anything referenced by history/audit/financial records (we almost never hard-delete; we soft-delete or anonymize). `CASCADE` is used only for genuinely owned child rows that have no independent meaning. `SET NULL` is used for optional attributions.

| Relationship | On delete | Rationale |
|---|---|---|
| `user_profiles.id` → `auth.users.id` | CASCADE (from auth) | Supabase deletes profile when auth user is deleted; but we prefer **soft delete** (account_status) over hard delete. |
| `candidates.user_id` → `user_profiles` | SET NULL | Recruiter-created candidates survive user deletion; candidate identity is global. |
| `candidate_*` children → `candidates` | CASCADE | Modular profile parts have no meaning without the candidate; deletion path is anonymize-then-purge. |
| `applications.candidate_id` → `candidates` | RESTRICT | Applications carry history/KPIs; candidate deletion goes through DSR anonymization, not cascade. |
| `applications.job_order_id` → `job_orders` | RESTRICT | Preserve pipeline history. |
| `application_stage_events.application_id` → `applications` | CASCADE | Owned history of the application; but applications are soft-deleted, so events persist in practice. |
| `candidate_submissions.consent_record_id` → `consent_records` | RESTRICT | Consent is legal evidence; never orphan a submission's authorization. |
| `submission_snapshots` → `candidate_submissions` | CASCADE | Snapshot owned by submission. |
| `documents.owner_candidate_id` → `candidates` | RESTRICT | Deletion via retention workflow (purge object first). |
| `document_versions.document_id` → `documents` | CASCADE | Owned. |
| `invoices.placement_id` → `placements` | RESTRICT | Financial integrity. |
| `payments.invoice_id` → `invoices` | RESTRICT | Financial integrity. |
| `*_events.parent_id` → parent | CASCADE | Owned history. |
| `organization_memberships.organization_id` → `organizations` | RESTRICT | Orgs are soft-closed, not deleted. |
| `ai_media_assets.response_id` → `ai_interview_responses` | CASCADE | Owned; media purge handled separately by retention job before row delete. |
| `audit.audit_log.*` FKs | SET NULL (no delete of log) | Log rows are never deleted; referenced actors may be anonymized. |

**Rule:** No FK to a reference/lookup table cascades; reference rows are deactivated (`is_active=false`), never deleted.

---

## 2. Principal cardinalities

| Parent | Child | Cardinality | Notes |
|---|---|---|---|
| auth.users | user_profiles | 1 : 1 | |
| user_profiles | organization_memberships | 1 : N | user in many orgs |
| organizations | organization_memberships | 1 : N | |
| organization_memberships | membership_roles | 1 : N | multiple roles per membership |
| roles | permissions | N : M | via role_permissions |
| candidates | candidate_* modular | 1 : N (or 1:1 for prefs/visibility/search) | |
| candidates | applications | 1 : N | one per job (unique) |
| candidates | candidate_engagements | 1 : N | one per owning org (unique) |
| job_orders | job_postings | 1 : N | re-posts/channels |
| job_orders | applications | 1 : N | |
| applications | application_stage_events | 1 : N | |
| applications | candidate_submissions | 1 : N | resubmission versions |
| candidate_submissions | submission_snapshots | 1 : 1 | immutable |
| employer_organizations | job_orders | 1 : N | |
| employer_organizations | employer_subscriptions | 1 : N | usually 1 active |
| placements | invoices | 1 : N | |
| offers | placements | 1 : 1 | accepted offer |
| ai_interview_sessions | ai_model_runs | 1 : N | reprocessing = new run |
| ai_model_runs | ai_evaluations | 1 : N | |
| ai_evaluations | ai_human_reviews | 1 : N | final review flagged |
| consent_purposes | consent_records | 1 : N | |

---

## 3. Uniqueness constraints

| Table | Unique | Purpose |
|---|---|---|
| user_profiles | (email) | one profile per email |
| candidates | (user_id) WHERE user_id NOT NULL | one candidate per login |
| organizations | (slug) | sub-portal/URL key |
| organization_memberships | (user_id, organization_id) WHERE status<>'ended' | no duplicate active membership |
| membership_roles | (membership_id, role_id) | |
| applications | (candidate_id, job_order_id) | **duplicate-application prevention** |
| candidate_engagements | (candidate_id, owning_organization_id) | one engagement per franchise |
| candidate_visibility / candidate_preferences / candidate_search_documents | (candidate_id) | 1:1 |
| invoices | (invoice_number) | |
| job_postings | (public_slug) WHERE public_slug NOT NULL | |
| document_versions | (object_path) | one row per stored object |
| documents | (bucket_id, object_path) | |
| subscription_entitlement_usage | (employer_subscription_id, entitlement_key, period_start) | |
| legal_document_versions | (document_kind, version_no, locale) | |
| safeguarding_cases | (case_reference) | |
| ai_interview_invitations | (secure_token_hash) | |
| placements | (offer_id) | one placement per offer |
| communication_preferences | (subject, notification_category_id, channel_id) | one pref row |
| reference tables | (code/key) | |

---

## 4. State invariants (enforced by CHECK + transition functions)

- **Job vs application separation:** `pipeline_stages.stage_class` partitions stages; `applications.current_stage_id` must reference a stage with `stage_class='candidate'`. `Advertised` (job), `Invoiced` (accounts), `Closed` (job) can never be an application's `current_stage_id` (CHECK via FK to a filtered domain / trigger).
- **Path lock:** once `job_orders.path_locked_at` is set (first application), `recruitment_path` is immutable (trigger raises on change).
- **Screening gate:** an application cannot advance beyond `Shortlisted` unless a `screening_scorecard` (and required screening notes) exists — enforced in `advance_application()` (see `06`).
- **Rejection reason:** creating an `application_rejections` row requires a non-null `rejection_reason_id` OR (`reason_id='other'` AND `other_note` NOT NULL) — CHECK.
- **Submission consent gate:** `candidate_submissions.status` cannot move to `submitted` unless a valid `consent_record` exists with `consent_purpose=employer_submission`, `covered_organization_id=employer_organization_id`, `withdrawn_at IS NULL`, and (`expires_at IS NULL OR expires_at>now()`), and the snapshot hash matches the current CV/fields (renewed-consent rule). Enforced in `submit_candidate_to_client()`.
- **Consent withdrawal cascade:** setting `consent_records.withdrawn_at` triggers dependent `candidate_submissions` → `access_revoked` and cuts document grants (trigger `after_consent_withdrawn`).
- **Offer/Hired:** an application can enter `Hired` only if an `offers` row exists with `status='accepted'` (or an authorized exception flag). A `placement` is created only from an accepted offer.
- **Offer declined ≠ rejected:** `offers.status='declined'` requires `declined_reason`; it does **not** set the application to a rejected stage automatically.
- **AI human-review supremacy:** `ai_evaluations` (machine) can exist without a human review, but an application stage change driven by AI requires an `ai_human_reviews.is_final=true` row; `ai_evaluations` alone can never write an application stage event (no code path). Reprocessing sets `ai_evaluations.is_superseded=true` on prior evaluations and creates a new `ai_model_run`.
- **Document owner exclusivity:** CHECK `num_nonnulls(owner_candidate_id, owning_organization_id) = 1` on `documents` (candidate-owned XOR org-owned).
- **Consent subject exclusivity:** CHECK `num_nonnulls(subject_candidate_id, subject_user_id) = 1`.
- **Verification subject exclusivity:** CHECK `num_nonnulls(subject_candidate_id, subject_organization_id) = 1`.
- **Invoice source exclusivity:** an invoice is either package-based or placement-based: CHECK `num_nonnulls(employer_subscription_id, placement_id) >= 1` and line items reference a consistent source.
- **Trial fields:** `employer_subscriptions` CHECK: if `is_trial` then `trial_ends_on NOT NULL`.
- **Access window:** `candidate_submissions` CHECK: `access_revoked_at IS NULL OR access_revoked_at >= submitted_at`.
- **Vacancy/close:** a `job_orders` with `vacancy_count>1` may have Hired applications while `status='active'`; closing requires `closed_reason`.

---

## 5. Business constraints (semantic)

- A **franchise recruiter** may only be `assigned_recruiter_id` on applications whose `owning_organization_id` is (or is overseen by) their org — enforced by RLS + a validation trigger on assignment.
- An **employer user** can be on `job_hiring_team` only for jobs of their own employer org.
- A **submission's `submitting_organization_id`** must equal the application's `owning_organization_id` (a franchise submits its own candidates) unless an `organization_relationships.relationship_type='transfer_grant'` exists (OD-10).
- **Candidate search** results (`candidate_search_documents`) must only include candidates with `is_searchable=true`; the trigger that maintains this table refuses to write "never include" fields.
- **Reference-check rows** never populate `candidate_search_documents` and are excluded from any employer-facing snapshot builder.
- **Consent covering an employer** must reference an `employer_organization_id`; a franchise-processing consent cannot satisfy an employer-submission gate (distinct `consent_purpose`).
- **Placement fee / revenue** is visible to owning-franchise accounts and HQ oversight; recruiters can read commercial status but cannot edit invoices without `invoice.edit`.

---

## 6. Duplicate-prevention rules

| Scenario | Mechanism |
|---|---|
| Same candidate applies twice to same job | `UK(applications.candidate_id, job_order_id)`; reapplication reopens the existing application (preserving original rejection event). |
| Duplicate global candidate identities | `candidate_duplicate_links` + `candidates.merged_into_candidate_id`; a background matcher flags; merge is an SA/HQ workflow. |
| Duplicate active membership | `UK(organization_memberships user_id, organization_id) WHERE status<>'ended'`. |
| Duplicate active subscription | Partial unique / app rule: one `status='active'` subscription per employer at a time (partial index). |
| Duplicate invoice number | `UK(invoice_number)` + generator function with advisory lock. |
| Duplicate object storage rows | `UK(documents.bucket_id, object_path)` and `UK(document_versions.object_path)`. |
| Duplicate consent for same purpose+recipient | Not unique (history is valuable); the **current** consent is the latest non-withdrawn row (query pattern), not a unique constraint. |

---

## 7. Cross-tenant integrity rules (the isolation guarantees)

These are the constraints that make Franchise A ↮ Franchise B isolation structural, not cosmetic:

1. **Every private row has `owning_organization_id NOT NULL`** (Ring-3a and financial/notes/interview tables). No default; must be set at insert.
2. **RLS on every such table** restricts visibility to `owning_organization_id ∈ authorized_org_set(caller)` where the set is computed by a `SECURITY DEFINER` helper from `organization_memberships` (+ approved `organization_relationships` for HQ oversight / transfer). (See `07`.)
3. **FK + trigger cross-checks** prevent attaching a private child to a parent in a different tenant: e.g., `screening_records.owning_organization_id` must equal its `applications.owning_organization_id` (trigger); `submission_documents.document_version_id` must reference a document the candidate owns and that was consented for that submission.
4. **Search/index tables carry no tenant-private fields**, so cross-franchise discovery can never leak Ring-3a data even if RLS on the index were mis-scoped.
5. **Employer scoping**: employer users' authorized rows derive only from (their own job's applications) ∪ (submissions to their org) ∪ (granted pool reveals) — no path yields another employer's or franchise's data.
6. **Audit immutability**: `audit.audit_log` has no UPDATE/DELETE grant to any role except a break-glass SA procedure; cross-tenant access *attempts* are themselves logged and surfaced in `dashboard_exceptions`.
7. **Consent scoping**: a submission cannot reference a consent record whose `covered_organization_id` differs from its `employer_organization_id` (trigger), so consent can't be "reused" across employers.

These directly answer the adversarial scenarios in `07` §Adversarial review.
