# 08 — Indexes & Performance

Indexes are chosen from the documented high-volume query patterns: recruiter "My Work" queues, job pipelines, candidate & job search, dashboards (stage history / time-in-stage / funnel), employer submission lists, billing, and audit lookups. Every FK used in a join or RLS predicate is indexed (Postgres does **not** auto-index FKs).

## 1. Extensions used by indexes
- `pg_trgm` — trigram GIN for fuzzy name/skill/title search and `ILIKE`.
- `unaccent` — accent-insensitive FTS (African names/locales).
- `btree_gin` — composite GIN where mixing btree + tsvector helps.
- built-in `tsvector`/GIN for full-text.
- `vector` — **reserved**, only if AI matching is enabled later (embedding column).

## 2. Standard conventions
- All PKs are btree on `uuid` (default). High-volume append logs (`audit.audit_log`) use `bigint identity` PK for locality and cheaper inserts.
- Every `owning_organization_id` is indexed (RLS predicate + tenant filter).
- Partial indexes for hot "open work" subsets to keep them small.
- `*_events` history tables indexed by `(parent_id, occurred_at)` and by `(to_state, occurred_at)` for funnel/time queries.

## 3. Index catalogue (by high-value table)

### Identity & orgs
- `organization_memberships (user_id) WHERE status='active'` — RLS helper hot path.
- `organization_memberships (organization_id, status)` — org roster.
- `membership_roles (membership_id)`, `role_permissions (role_id)` — permission checks.
- `organization_relationships (from_organization_id, relationship_type) WHERE status='active'` — oversight resolution.

### Candidate & search
- `candidates (user_id)` UK; `candidates (country_id)`; `candidates (email) `, `(phone)` trigram for dedup.
- `candidate_search_documents USING GIN (search_tsv)` — FTS.
- `candidate_search_documents USING GIN (approved_skills)` , `(preferred_roles)` — array containment filters.
- `candidate_search_documents (is_searchable, country_id, education_level_rank)` partial `WHERE is_searchable` — pool search.
- `candidate_skills (skill_id) WHERE is_searchable`; `candidate_work_experiences (candidate_id)`.
- `candidate_duplicate_links (candidate_id)`, `(status)`.
- **(reserved)** `candidate_search_documents USING ivfflat (embedding vector_cosine_ops)` — only when `vector` enabled.

### Jobs & public board
- `job_orders (responsible_organization_id, status)` — franchise pipeline lists.
- `job_orders (employer_organization_id)` — employer's jobs.
- `job_orders (status) WHERE status IN ('active','on_hold')` — open jobs.
- `job_postings (status) WHERE status='advertised'` — public board base filter.
- `job_postings (public_slug)` UK.
- `job_search_documents USING GIN (search_tsv)`; `job_search_documents (country_id, industry_id, employment_type_id) WHERE is_advertised`; `(deadline) WHERE is_advertised`.

### Applications & pipeline (highest volume)
- `applications (owning_organization_id, current_stage_id)` — pipeline board per franchise.
- `applications (job_order_id, current_stage_id)` — job workspace pipeline.
- `applications (candidate_id, job_order_id)` UK — dedup.
- `applications (assigned_recruiter_id, next_action_due) WHERE withdrawn_at IS NULL` — recruiter "My Work" queue.
- `applications (owning_organization_id) WHERE is_on_hold` and partial indexes for blocked/consent-pending subsets.
- `application_stage_events (application_id, occurred_at)` — timeline.
- `application_stage_events (to_stage_id, occurred_at)` — funnel & time-in-stage aggregates.
- `application_stage_events (occurred_at)` BRIN option for very large history (append-ordered).
- `screening_scorecards (application_id)`, `assessment_records (application_id)`, `reference_checks (application_id)`.
- `application_rejections (rejection_reason_id) WHERE is_active` — rejection-reason reporting.

### Submissions
- `candidate_submissions (employer_organization_id, status)` — employer review list.
- `candidate_submissions (submitting_organization_id, status)` — franchise submissions.
- `candidate_submissions (candidate_id)`; `(consent_record_id)`.
- `candidate_submissions (access_expires_at) WHERE status IN ('submitted','viewed')` — expiry sweep.
- `submission_views (candidate_submission_id, viewed_at)`.

### Interviews / AI
- `interviews (owning_organization_id, scheduled_start)`; `(application_id)`; `(status) WHERE status IN ('requested','scheduled','confirmed')`.
- `ai_interview_sessions (application_id)`, `(status)`.
- `ai_media_assets (response_id)`, `(retention_status, delete_after) WHERE retention_status='active'` — retention sweeps.
- `ai_model_runs (session_id)`, `(reprocessing_of_run_id)`.
- `ai_evaluations (model_run_id) WHERE NOT is_superseded`.
- `ai_human_reviews (ai_evaluation_id) WHERE is_final`.

### Offers, placements, billing
- `offers (application_id)`, `(status)`.
- `placements (owning_organization_id, status)`; `(employer_organization_id)`; `(responsible_recruiter_id)`.
- `invoices (owning_organization_id, status)`, `(employer_organization_id)`, `(placement_id)`, `(due_date) WHERE payment_status<>'paid'` (overdue sweep), `(invoice_number)` UK.
- `payments (invoice_id, status)`.
- `subscription_entitlement_usage (employer_subscription_id, entitlement_key, period_start)` UK.
- `candidate_access_events (employer_organization_id, counted_against_period)` — "N of M this month".

### Consent, documents, verification
- `consent_records (subject_candidate_id, consent_purpose_id)`; `(covered_organization_id)`; partial `WHERE withdrawn_at IS NULL AND (expires_at IS NULL OR expires_at>now())` for "current consent".
- `documents (owner_candidate_id)`, `(owning_organization_id)`, `(document_type_id)`, `(retention_status, expires_at)` (retention), `(bucket_id, object_path)` UK.
- `document_access_grants (document_id) WHERE revoked_at IS NULL`; `(granted_to_organization_id)`.
- `verifications (subject_candidate_id, status)`, `(expires_at) WHERE status='verified'` (re-verify sweep).

### Notes, comms, audit
- `notes (subject_type, subject_id)`, `(owning_organization_id, visibility)`.
- `tasks (assigned_to, status, due_at) WHERE status='open'` — task queue.
- `message_deliveries (status) WHERE status IN ('queued','failed')` — retry worker; `(message_recipient_id)`; `(provider, provider_message_id)`.
- `communication_preferences (subject, notification_category_id, channel_id)` UK.
- `audit.audit_log (entity_type, entity_id)`, `(actor_user_id, occurred_at)`, `(organization_context_id, occurred_at)`, `(action, occurred_at)`; **range-partitioned by month** on `occurred_at`.
- `dashboard_exceptions (owning_organization_id, status)`, `(exception_type) WHERE status='open'`.

## 4. Partitioning
- `audit.audit_log` — monthly `RANGE` partitions on `occurred_at`; old partitions detached/archived per retention. High insert volume, mostly append + recent reads.
- `application_stage_events` — candidate table for partitioning **later** if volume warrants (by `occurred_at`); BRIN index is a lighter first step.
- `message_deliveries` and `candidate_access_events` — monthly partitions considered once volume is known.

## 5. Query-pattern → index rationale (examples)
| Query | Index used | Why |
|---|---|---|
| Recruiter "My Work": my due/blocked candidates | `applications (assigned_recruiter_id, next_action_due) WHERE not withdrawn` | small hot partial index; sorted by due |
| Job pipeline board | `applications (job_order_id, current_stage_id)` | group-by stage within a job |
| Funnel conversion / time-in-stage | `application_stage_events (to_stage_id, occurred_at)` | aggregate transitions by stage over time |
| Employer review queue "Needs Review" | `candidate_submissions (employer_organization_id, status)` | tenant + status filter |
| Public job board filter | `job_postings status partial` + `job_search_documents GIN/btree` | advertised-only base + FTS/filters |
| Candidate pool search (masked) | `candidate_search_documents GIN + is_searchable partial` | approved-fields FTS + opt-in filter |
| "18 of 25 profiles this month" | `candidate_access_events (employer_organization_id, counted_against_period)` | period aggregate |
| Overdue invoices sweep | `invoices (due_date) WHERE payment_status<>'paid'` | scheduled job scans only unpaid |
| Consent withdrawal cascade | `candidate_submissions (consent_record_id)` | find dependents fast |
| AI retention purge | `ai_media_assets (retention_status, delete_after)` partial | sweep only active-expiring media |
| Audit lookup for a record | `audit_log (entity_type, entity_id)` | per-entity history |

## 6. Anti-patterns avoided
- No index on low-selectivity booleans alone (used only in partial-index predicates).
- No duplicate `owning_organization_id` single-column indexes where a leading composite already covers it.
- Materialized aggregates (see `10`) instead of unindexed dashboard scans over full history.
- No storing large media in Postgres (BYTEA) — object storage only, so no TOAST bloat on hot tables.
