# 11 — Requirement Traceability Matrix

Every requirement from the source materials mapped to: source document, workflow, proposed table/object, relevant column/relationship, relevant RLS rule, phase (MVP / conditional-MVP / future), and any unresolved decision. Requirement IDs (`R-xxx`) are defined in `01`. This matrix is the completeness proof — every `R-xxx` appears exactly once, and the closing coverage list confirms nothing is dropped.

Phase legend: **M** = current MVP; **C** = conditional MVP (in pilot only if its dependency is ready); **F** = future phase (structured now, not an MVP dependency).

| Req | Requirement | Source | Workflow | Table(s) / Object(s) | Column / relationship | RLS / security rule | Phase | Open decision |
|---|---|---|---|---|---|---|---|---|
| R-001 | Multi-country/franchise tenancy | S1,S2,S7 | HQ/Franchise | `organizations`,`countries`,`franchise_profiles`,`hq_profiles` | `organization_type`,`country_id`,`parent_organization_id` | membership-scoped `authorized_org_ids()` | M | — |
| R-002 | Org-scoped roles (not one field) | S1,S2,S6,S7 | all | `roles`,`permissions`,`role_permissions`,`organization_memberships`,`membership_roles` | membership↔role↔permission | `has_permission()` | M | — |
| R-003 | Franchise isolation; controlled HQ oversight | S2,S3,S5,S7 | HQ/Franchise | all Ring-3a tables; `organization_relationships` | `owning_organization_id`; `relationship_type='oversight'` | RLS `owning_organization_id ∈ authorized_org_ids()` | M | — |
| R-004 | "View as role"; permission-exception review | S7 | HQ/Franchise | `roles`/`permissions`; `dashboard_exceptions` | permission graph | read-only preview via `has_permission()` | M | — |
| R-005 | Invitations; internal/employer onboarding; membership dates | S6,S7 | onboarding | `user_invitations`,`organization_memberships` | `status`,`starts_on`,`ends_on` | org-admin only | M | — |
| R-010 | One global candidate profile | S3,S4,S7 | Candidate | `candidates` (+ modular) | `user_id` UK; candidate-owned | candidate-owned RLS | M | — |
| R-011 | Seven separate record types | S3,S5,S7 | all | `candidates`,`applications`,`candidate_engagements`,`employer_organizations`+`employer_notes`,`candidate_submissions`,`consent_records`,`candidate_search_documents` | distinct roots | per-ring RLS | M | — |
| R-012 | Candidate-approved searchable fields; "never include" list | S4,S7 | Candidate/HQ | `candidate_visibility`,`candidate_search_documents` | `approved_search_fields`,`is_searchable`; index excludes restricted | search view only; trigger refuses restricted fields | M | — |
| R-013 | Discovery ≠ processing without consent | S3,S5,S7 | Recruiter/HQ | `candidate_engagements`,`consent_records` | `has_processing_consent` | submission/engagement gated by consent | M | — |
| R-014 | Modular profile incl. non-traditional | S4 | Candidate | `candidate_work_experiences`,`_educations`,`_skills`,`_languages`,`_certifications`,`_licences`,`_projects`,`_memberships`,`_references`,`_preferences*` | `experience_kind`,`education_level_id`,custom skills | candidate-owned | M | — |
| R-015 | Profile visibility separate from doc visibility | S4 | Candidate | `candidate_visibility`,`documents` | `searchable` vs `documents.visibility` | candidate controls both | M | — |
| R-016 | Trust signals (no negative labels) | S4 | Candidate | `verifications` | mobile/profile/identity signals derived | status read to candidate | M | — |
| R-017 | Dedup/merge, archival, deletion, export/correction | brief,S3 | Candidate/HQ | `candidate_duplicate_links`,`data_subject_requests`,`candidates.merged_into_candidate_id`,`archived_at` | merge/archival | HQ/SA + DSR | M(dedup C) | OD-5 |
| R-020 | Document library (multi-CV, categories, media) | S1,S4,S5 | Candidate/Recruiter | `documents`,`document_versions`,`document_types` | `document_type_id`,`version_no` | owner + grant | M | — |
| R-021 | Files in Storage; watermarked view-only; export=SA | S1,S2,S3 | all | `documents`,`document_previews`; Storage buckets | `bucket_id`,`object_path`,`visibility` | private buckets, signed URLs, `document.download`/`candidate.export` | M | — |
| R-022 | Per-doc metadata (scan, checksum, retention, grants) | brief,S3 | all | `documents`,`document_versions`,`document_access_grants` | `scan_status`,`checksum_sha256`,`retention_status`,`expires_at` | grant-based | M | OD-7 |
| R-023 | Resume selection ≠ visibility; no "visible to all" | S4 | Candidate | `applications.cv_document_version_id`,`candidate_visibility` | version chosen per application | candidate-controlled | M | — |
| R-030 | Versioned auditable consent (not booleans) | S2,S3,S4,S5,S7 | all | `consent_records`,`legal_document_versions` | full consent columns | candidate-owned; covering-org read | M | — |
| R-031 | Distinct consent purposes; employer-specific required | S2,S3,S4,brief | Recruiter/Candidate | `consent_purposes`,`consent_records` | `consent_purpose_id`,`covered_organization_id` | submission gate checks purpose+recipient | M | — |
| R-032 | Renewed consent on CV/field change | S5 | Recruiter | `candidate_submissions`,`submission_snapshots` | `snapshot_hash` mismatch → re-consent | submit fn revalidates | M | — |
| R-040 | Job vs application lifecycle separation | S2,S5,S6 | Jobs/Pipeline | `job_orders`,`job_postings`,`applications` | `stage_class`; Advertised/Invoiced/Closed excluded from candidate stages | CHECK/trigger | M | — |
| R-041 | Full job-order fields | S5,S6 | Employer/Recruiter | `job_orders`,`job_screening_questions`,`job_required_documents` | all columns | responsible-org RLS | M | — |
| R-042 | Publication/approval/closure states + versions | S5,S6 | Employer/HQ | `job_postings`,`job_posting_versions`,`job_order_events`,`job_posting_events` | `status`,`approval_status`,`closed_reason` | posting perms | M | — |
| R-043 | Public TZ job board, extensible | S3,S4 | Public | `job_postings`,`job_search_documents` | `country_id`,`status='advertised'` | anon read advertised | M | — |
| R-044 | Approval even for direct-employer jobs | S6 | Employer/HQ | `job_postings.approval_status` | Draft→Submitted→Approved | `posting.approve` | M | — |
| R-050 | Path selection recorded; lock after applications | S2,S6 | Employer/Recruiter | `job_orders` | `recruitment_path`,`path_locked_at` | trigger locks | M | — |
| R-051 | Candidate source & prior-global & authorized relationship | S5,S7 | Recruiter | `applications`,`candidate_sources`,`candidate_engagements` | `entry_type`,`candidate_existed_globally`,`network_search_permission` | owning-org | M | — |
| R-052 | Path A→employer; Path B→recruiter pipeline | S2,S4,S5,S6 | Pipeline | `applications`,`candidate_submissions` | `recruitment_path`; submission for B | employer sees Path A own-job / Path B submission only | M | — |
| R-060 | 15-stage Spine (12 candidate stages) | S2,S5 | Pipeline | `pipeline_stages`,`applications` | `ordinal`,`stage_class`,`current_stage_id` | — | M | OD-9 (per-country config) |
| R-061 | Timestamped/attributed stage history for KPIs | S2,S5,S7 | Pipeline | `application_stage_events` | `from/to`,`actor`,`occurred_at`,`time_in_previous_stage` | append-only | M | — |
| R-062 | Mandatory gates (screening notes, rejection reason, consent) | S2,S5 | Pipeline | `screening_scorecards`,`application_rejections`,`consent_records` | gate checks in `advance_application()` | fn-enforced | M | — |
| R-063 | Structured screening/scorecard/testing/references | S5 | Pipeline | `screening_records`,`screening_criteria_results`,`screening_scorecards`,`scorecard_competency_scores`,`assessment_records`,`reference_checks` | typed columns | references extra-restricted (`reference.read`) | M | — |
| R-064 | Sourced≠applied; duplicate/withdraw/reapply/hold/reopen | S5 | Pipeline | `applications` | `is_direct_application`,`sourced_contacted_at`,`is_on_hold`,`reopened_from_rejection_at`; UK(candidate,job) | owning-org | M | — |
| R-065 | Six distinct workspace record types w/ visibility | S5 | Pipeline | `notes`,`screening_records`,`candidate_submissions`,`reference_checks`,`messages`,`audit_log` | `note_kind`,`visibility` | audience-scoped | M | — |
| R-066 | "My Work" action queue | S5 | Recruiter | `applications`,`tasks`; view `v_my_work` | `next_action`,`next_action_due` | recruiter-scoped | M | — |
| R-070 | Deliberate snapshotted submission model | S5,S6,S7 | Submission | `candidate_submissions`,`submission_snapshots`,`submission_documents`,`submission_events`,`submission_views`,`submission_comments`,`submission_ratings` | full columns; `access_revoked_at` | employer own-active only | M | — |
| R-071 | Submission preserves authorized view at time | S4,S5 | Submission | `submission_snapshots`,`application_snapshots` | `snapshot_hash`,`disclosed_fields` | immutable | M | — |
| R-072 | Masked profile visible/hidden split | S6 | Employer | `v_candidate_masked`,`v_submission_employer`,`submission_snapshots` | approved fields only | view + RLS; base `candidates` denied to employer | M | — |
| R-080 | Human interviews (all types, rounds, panels, feedback split) | S1,S5,S6 | Interview | `interviews`,`interview_panelists`,`interview_scorecards`,`interview_competency_scores`,`interview_question_sets`,`interview_questions`,`interview_events` | `interview_type_id`,`round_no`,`client_feedback` vs `candidate_feedback` | recording gated by consent | M | — |
| R-081 | AI stage retained; never auto-advance; "not required"+reason | S3,S5 | AI Interview | `ai_interview_configs`,`ai_human_reviews`,`applications` stage fn | `is_required`,`not_required_reason`,`is_final` | AI has no stage-write path | M(stage) / F(AI) | OD-8 |
| R-082 | Full AI interview architecture, versioned, reproducible, separate media/transcript/model/eval/human | brief,S3 | AI Interview | all `ai_*` tables (20) | provider/model/prompt/rubric versions; `reprocessing_of_run_id`; separate machine vs human | consent + scoped evaluator | F | OD-8, OD-7 |
| R-083 | No emotion/genuineness scoring; human review mandatory; fairness review | S3 | AI Interview | `ai_human_reviews`,`ai_fairness_reviews`,`ai_integrity_flags` | `override_reason`,`review_type` | restricted | F | OD-8 |
| R-090 | Offer substates; declined≠rejected | S5,S6 | Offer | `offers`,`offer_versions`,`offer_events` | `status`,`declined_reason` | owning-org/employer | M | — |
| R-091 | Placement record + auto invoicing task | S5,S7 | Placement | `placements`,`placement_events`,`tasks` | fee/guarantee/attribution; `create_placement_from_offer()` | accounts/owning-org | M | — |
| R-100 | Packages/versions/features/entitlements; per-country pricing; trial | S1,S2,S6,S3 | Employer/Billing | `packages`,`package_versions`,`package_features`,`package_entitlements`,`package_country_prices`,`employer_subscriptions` | tiered; `is_trial`,`trial_ends_on` | employer own; accounts | M | OD-3 |
| R-101 | Usage limits, literal counts, NO burnable credits | S2,S6,brief,S3 | Employer/Billing | `package_entitlements`,`subscription_entitlement_usage`,`candidate_access_events` | `limit_value`,`used_count`,access ledger | employer own aggregates | M | OD-2 |
| R-102 | Invoices/lines/status/payments/proof/adjust/contacts | S5,S7,S3 | Billing | `invoices`,`invoice_line_items`,`invoice_events`,`payments`,`payment_events`,`payment_proofs`,`credit_adjustments`,`billing_contacts` | full billing columns | accounts write; recruiter read; HQ totals | M | — |
| R-103 | Gateway-swappable; no recurring dependency | S3 | Billing | `payments` | `provider`,`provider_*_reference` | — | M | OD-3 |
| R-110 | Channel-neutral comms; WhatsApp-ready but not built | S1,S2,S3,S4,brief | Comms | `channels`,`message_templates`,`message_template_versions`,`messages`,`message_recipients`,`message_deliveries`,`communication_preferences`,`in_app_notifications` | `channel_id` incl. `whatsapp`(inactive); provider/opt-in fields | preference-gated | M(email/sms/in_app) / F(whatsapp) | OD-3 |
| R-111 | Whistleblowing/safeguarding restricted channel | S2,S3 | Safeguarding | `safeguarding_cases`,`safeguarding_case_events` | confidentiality; anonymous reporter | `safeguarding.read` only | M | — |
| R-120 | Role-based dashboards from common history | S1,S7,S3 | Dashboards | views + MVs (`10`) | `security_invoker` wrappers | RLS + aggregate-by-default | M(basic) / F(advanced) | — |
| R-121 | Full dashboard metric set | S5,S7,brief | Dashboards | `application_stage_events`,`placements`,`invoices`,`consent_records`,`verifications`,`interviews`,`ai_*` + MVs | see `10` metric map | scoped views | M(core) / F(advanced) | — |
| R-130 | Immutable append audit log (full context) | S1,S2,S3,S5,S7 | Compliance | `audit.audit_log` | actor/org/action/entity/before/after/correlation/ip/ua | append-only; `audit.read`; no update/delete | M | — |
| R-131 | Retention/holds/soft-delete/anon/DSR/cross-border/legal versions | S2,S3,brief | Compliance | `retention_policies`,`legal_holds`,`data_subject_requests`,`dsr_events`,`cross_border_transfers`,`legal_document_versions`,`dpia_references`,`security_incidents` | retention action per entity | DPO/SA | M(structure) | OD-6, OD-7 |
| R-132 | Legal launch gate (PDPC/DPO/DPIA before prod data) | S3 | Compliance | `dpia_references`,`feature_flags`; process | launch gate | — | M(gate)/process | OD-6 |
| R-140 | PG search honoring consent/visibility; vector reserved | S1,S3,S7,brief | Search | `candidate_search_documents`,`job_search_documents` | tsvector/trigram; `embedding` reserved | search obeys `is_searchable`/RLS | M(FTS) / F(vector) | — |
| R-150 | Reference/config; enums vs lookups | brief | all | all reference tables + `feature_flags`,`country_configurations`,`franchise_configurations`,`platform_settings` | see `04 §C` | read-all, `config.manage` write | M | OD-9 |

## Deferred/hard requirements explicitly preserved (not dropped)

| Item | Where handled | Phase | Note |
|---|---|---|---|
| Franchise onboarding module | `franchise_profiles`,`organization_relationships`,`user_invitations` (structure); workflow later | F | Structure ready; guided flow Phase 2 |
| Paid tenders/announcements | `job_posting_channels.channel='paid_tender'`; `job_postings` reserved listing type | F | Data model reserved; purchase flow later |
| Labour-mobility toolkit | `candidate_preferences.cross_border_mobility`,`candidate_licences`,`cross_border_transfers` | F | Fields present; guidance content later |
| Multi-language | `languages`,`legal_document_versions.locale`,`message_template_versions.locale`,`user_profiles.preferred_language` | M(en)/F | Locale columns everywhere user-facing |
| Social auto-publishing | `job_posting_channels` (linkedin/fb/ig/x) | F | Manual share MVP; auto later |
| CRM | `employer_notes`,`organization_contacts`,`activity_events` | M(in-platform)/F(HubSpot) | No external CRM tables |
| Native app / chatbot / public API | none required in schema | F | Schema serves any client |
| AI candidate matching | `candidate_search_documents.embedding` (reserved) | F | Not an MVP dependency |
| Under-18 / guardian consent | `candidates.date_of_birth`,`consent_purposes.guardian`,`consent_records.method='guardian'` | C/F | Policy OD-5 |
| Duplicate detection/merge | `candidate_duplicate_links`,`merged_into_candidate_id` | C | Matcher Phase 2 |

## Coverage confirmation

The task's completeness checklist maps as follows (every item ✔ represented):

Candidate registration/profile ✔(R-010/014) · phone/email verification ✔(R-016,F-domain) · CV/doc upload ✔(R-020/021) · consent ✔(R-030/031) · public job browsing ✔(R-043) · applications ✔(R-052/060) · application history ✔(R-061, `application_stage_events`, S4 timeline) · Path A ✔(R-052) · Path B ✔(R-052) · recruiter pipeline ✔(R-060–066) · mandatory notes ✔(R-062) · rejection reasons ✔(R-062, `application_rejections`) · candidate-submission consent ✔(R-031/070) · employer candidate review ✔(R-070/072) · masked profiles ✔(R-072) · watermarked previews ✔(R-021, `document_previews`) · employer comments ✔(`submission_comments`) · employer offer/rejection ✔(R-090, `offers`,`application_rejections`) · job orders ✔(R-041) · job advertising ✔(R-042) · package entitlements ✔(R-100/101) · invoice records ✔(R-102) · payment status ✔(R-102) · audit logs ✔(R-130) · HQ dashboards ✔(R-120) · country dashboards ✔(`mv_country_overview`) · franchise dashboards ✔(`mv_franchise_performance`) · recruiter KPIs ✔(`mv_recruiter_kpis`) · placement data ✔(R-091) · franchise-private info ✔(Ring-3a) · global candidate info ✔(Ring-1) · AI video interviews ✔(R-082) · interview media/transcripts ✔(`ai_media_assets`,`ai_transcripts`) · AI evaluation traceability ✔(R-082 lineage) · future comms channels ✔(R-110) · WhatsApp readiness ✔(R-110) · data retention ✔(R-131) · data deletion ✔(R-131, storage `09`) · cross-country expansion ✔(R-001, `countries`,`country_configurations`).

**Every requirement identified in the source materials is mapped above.** Items not in the MVP are marked **C**/**F** with their structural home, so nothing is dropped — only phased.
