# 13 — Migration Plan

Ordered, dependency-aware migration sequence for the draft SQL in `supabase/migrations_draft/`. Each step lists dependencies and rollback considerations. Files are numbered to run in order. **These are drafts — not applied automatically.**

## Ordering principle
Extensions → schemas → helper skeleton → reference/lookups → identity → organizations/membership/RBAC → candidate → documents → verification → employer → packages/billing → jobs → applications/pipeline → submissions → interviews → AI interviews → offers/placements → communications → whistleblowing → consent → audit/compliance → search projections → functions/triggers → views/materialized views → RLS enablement + policies → storage buckets/policies → seed data.

RLS is enabled **after** tables and helper functions exist (policies reference helpers). Seed data runs last so FKs resolve.

## Migration files & dependencies

| # | File | Contents | Depends on | Rollback note |
|---|------|----------|-----------|---------------|
| 00 | `00_extensions.sql` | `pgcrypto`, `citext`, `pg_trgm`, `unaccent`, `btree_gin`; (`vector` commented) | — | `DROP EXTENSION` (rarely needed) |
| 01 | `01_schemas_and_helpers.sql` | `private`, `audit` schemas; `updated_at` trigger fn; placeholder helper fns (bodies finalized in 20) | 00 | drop schemas cascade |
| 02 | `02_reference.sql` | all lookup/reference tables + reference RLS (read-all) | 01 | drop tables |
| 03 | `03_identity.sql` | `user_profiles`, `service_actors`, `user_invitations`; auth trigger to create profile | 01 | drop; detach auth trigger |
| 04 | `04_organizations.sql` | `organizations`, subtype tables, addresses/contacts, relationships, teams | 02,03 | drop |
| 05 | `05_rbac.sql` | `roles`,`permissions`,`role_permissions`,`organization_memberships`,`membership_roles` | 04 | drop |
| 06 | `06_candidate.sql` | `candidates` + all modular sub-records, visibility, tags, duplicate links | 03,04 | drop |
| 07 | `07_documents.sql` | `documents`,`document_versions`,`document_previews`,`document_access_grants` | 06,04 | drop; **purge storage objects separately** |
| 08 | `08_verification.sql` | `verifications`,`verification_evidence`,`verification_events` | 06,07 | drop |
| 09 | `09_employers.sql` | `employer_organizations` (if not in 04), `employer_team_members`,`employer_notes`,`job_hiring_team` (fwd-declared) | 04,05 | drop |
| 10 | `10_billing.sql` | packages/versions/features/entitlements/prices; subscriptions; usage; access events; invoices; lines; payments; proofs; adjustments; billing contacts | 04,09 | drop; **financial data—retain in prod** |
| 11 | `11_jobs.sql` | `job_templates`,`job_orders`,`job_order_events`,`job_assignments`,`job_hiring_team`,`job_screening_questions`,`job_required_documents`,`job_postings`,`versions/channels/events`,`job_search_documents` | 04,09 | drop |
| 12 | `12_applications.sql` | `candidate_engagements`,`applications`,`application_stage_events`,`application_snapshots`,`application_answers`,screening/scorecard/assessment/reference/rejection tables | 06,11 | drop |
| 13 | `13_submissions.sql` | `candidate_submissions`,`submission_snapshots`,`submission_documents`,`submission_events`,`submission_views`,`submission_comments`,`submission_ratings` | 12,09,15(consent fwd) | drop |
| 14 | `14_interviews.sql` | `interviews`,`interview_panelists`,`interview_events`,`interview_scorecards`,`interview_competency_scores`,`interview_question_sets`,`interview_questions` | 12,13 | drop |
| 15 | `15_consent.sql` | `legal_document_versions`,`consent_purposes`(ref—may be in 02),`consent_records` | 06,04 | drop; **legal evidence—retain** |
| 16 | `16_ai_interviews.sql` | all 20 `ai_*` tables (definition/execution/model/output/human/governance) | 11,12,15 | drop; **purge AI media separately** |
| 17 | `17_offers_placements.sql` | `offers`,`offer_versions`,`offer_events`,`placements`,`placement_events` | 12,13 | drop; **placement/revenue—retain** |
| 18 | `18_communications.sql` | `message_templates/versions`,`messages`,`message_recipients`,`message_deliveries`,`communication_preferences`,`in_app_notifications` | 03,06,02 | drop |
| 19 | `19_whistleblowing.sql` | `safeguarding_cases`,`safeguarding_case_events` | 04,06 | drop; **sensitive—retain per policy** |
| 20 | `20_audit_compliance.sql` | `audit.audit_log` (+partitions), `data_subject_requests`,`dsr_events`,`retention_policies`,`legal_holds`,`cross_border_transfers`,`dpia_references`,`security_incidents`,`incident_affected_subjects`,`dashboard_exceptions` | 04,06 | **never drop audit in prod** |
| 21 | `21_functions_triggers.sql` | finalize helper fns; `updated_at`, audit triggers, transition fns (`advance_application`,`submit_candidate_to_client`,`after_consent_withdrawn`,`create_placement_from_offer`,`generate_invoice_number`,`publish_job_posting`,`refresh_profile_completion`,`maintain_search_document`,`emit_notification_event`) | all tables | drop fns/triggers |
| 22 | `22_views_reporting.sql` | `security_invoker` views + materialized views + MV unique indexes | 21 | drop views/MVs |
| 23 | `23_indexes.sql` | all non-PK/UK indexes from `08` (some inline earlier; this consolidates the performance set) | all tables | drop indexes |
| 24 | `24_rls_policies.sql` | `ENABLE ROW LEVEL SECURITY` + all policies (reference helpers from 21) | 21, all tables | disable RLS/drop policies |
| 25 | `25_storage.sql` | bucket definitions + storage RLS policies (as SQL/config) | 21 | delete buckets (empty first) |
| 26 | `26_seed.sql` | reference seeds (countries incl. Tanzania, currencies, languages, stages, rejection reasons, document types, channels incl. inactive whatsapp, consent purposes, roles/permissions/role_permissions, packages Tier1/2/3, feature flags, retention policies, HQ org) | 02–24 | delete seed rows |

## Dependency notes / forward declarations
- `job_hiring_team` references both `job_orders` and employer users; created in 11 (with employer FK) but employer subtype exists from 04/09 — ensure 09 runs before 11.
- `candidate_submissions` (13) references `consent_records` (15); either run 15 before 13, or add the FK in 15 after both exist. Draft runs **15 before 13** to keep FKs inline. *(File numbers reflect logical grouping; actual apply order will place consent before submissions — see the SQL draft header which fixes the concrete order.)*
- Transition functions (21) must exist before RLS policies that call helpers (24), and before seed (26) if seed uses them.
- Materialized views (22) need their base tables and a unique index for `REFRESH ... CONCURRENTLY`.

## Rollback strategy
- Each file is idempotent-friendly (`CREATE ... IF NOT EXISTS` where safe; `DROP ... IF EXISTS` in paired `down` scripts).
- **Never** auto-rollback `audit.audit_log`, financial (`invoices/payments/placements`), consent, or safeguarding data in production — these are retained; a "rollback" in prod means a forward corrective migration, not a drop.
- Storage buckets must be emptied (objects deleted per retention) before bucket deletion.
- RLS can be toggled off (`DISABLE ROW LEVEL SECURITY`) for emergency data fixes only via a logged break-glass procedure, then re-enabled.

## Environment sequencing (per S3 nine-week plan)
1. **Dev/staging**: apply 00–26 with synthetic seed; run cross-tenant RLS test suite.
2. **UAT**: apply to a UAT project; use authorized test data only (OD-6 gate).
3. **Production**: apply only after OD-1 (residency) + OD-6 (PDPC/DPO/DPIA/cross-border) are cleared; enable `feature_flags.production_data_mode`.

## Post-migration verification (automated)
- Cross-tenant isolation tests (Franchise A JWT sees 0 Franchise B rows) per sensitive table.
- Consent-gate test: submission blocked without matching employer consent.
- Audit immutability test: UPDATE/DELETE on `audit.audit_log` denied.
- Storage path-guess test: private object 403 without grant.
- MV refresh + `security_invoker` view scoping test.
- Transition-gate tests: cannot pass Shortlisted without scorecard; rejection requires reason; AI cannot advance an application.
