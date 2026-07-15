# 12 — Open Decisions & Risks

Product, legal, and technical decisions still required, each with a **recommended default** the schema already accommodates so implementation is not blocked. Also: assumptions that could force later schema change, and the enum-vs-lookup reference decision.

## A. Open decisions (with recommended defaults)

| ID | Decision | Why it matters | Recommended default | Schema impact if changed |
|---|---|---|---|---|
| **OD-1** | **Hosting & data residency: Supabase (no African managed region) vs AWS Cape Town vs self-hosted Supabase in Africa** | S3 rejects managed Supabase precisely because it has no African region, which conflicts with Tanzania PDPC residency. The task mandates Supabase. | **Self-host Supabase (Postgres + GoTrue + Storage + PostgREST) in an African region (e.g. on AWS Cape Town / af-south-1)** to keep Supabase tooling *and* residency. If self-hosting is too heavy for the pilot, use managed Supabase in the nearest region **with a documented cross-border transfer position** and PDPC approval. | None to the relational schema — it is hosting-portable. Only auth/storage integration config changes. **This is the single most important unresolved item.** |
| **OD-2** | CV/profile-access consumption semantics | S2 "Access to N CVs" vs S6 "literal counts, no credits". | **Distinct candidate profiles unmasked per billing period** counts against the limit; masked search views and re-viewing an already-unmasked profile do **not** decrement. No burnable wallet. | `candidate_access_events.access_type` + counting rule in a function; changing the rule changes the counter query only. |
| **OD-3** | Recurring auto-charge / automatic trial conversion | S2 auto-purchase vs S3 "not until merchant terms confirmed". | **Manual activation in pilot**; store trial intent + tokenized card ref; no auto-charge job. | `employer_subscriptions.auto_activate_intent`; enabling later adds a billing job, no schema change. |
| **OD-4** | Identity-verification depth & mandatory points | Biometric (OCR/liveness/face-match) needs a DPIA. | **Delayed, optional, non-biometric in MVP**; identity verification becomes required only per job/stage/country flag; biometric Phase-2 post-DPIA. | `verifications.method` already includes biometric values (unused in MVP). |
| **OD-5** | Under-18 registration & guardian consent | Legal age/guardian handling undefined. | **Disallow under-18 self-registration in MVP**; require age declaration; keep guardian-consent capability for later. | `candidates.date_of_birth`, `consent_purposes.guardian`, `consent_records.method='guardian'` already present. |
| **OD-6** | PDPC registration / DPO / DPIA / cross-border approval | S3/S1 legal launch gate; production data blocked until complete. | **Operate on synthetic/authorized test data until the gate clears**; use `feature_flags` to gate production-data mode. | `dpia_references`,`cross_border_transfers`,`feature_flags` present; process, not schema. |
| **OD-7** | Retention durations per record type | Legal decision; schema stores policy, not values. | Provisional defaults: rejection reasons 24 mo; interview recordings 12 mo; transcripts 12 mo; AI model outputs 24 mo; ID evidence 90 days post-outcome; audit log 7 yr; consent 7 yr. **Confirm with counsel.** | `retention_policies.retention_period` values only. |
| **OD-8** | AI-interview vendor, model/prompt governance, fairness thresholds, appeals | Fairness/legal acceptability before affecting hiring. | **Defer AI to Phase 2**; keep stage manual; require human review + fairness review before any AI influence. | All `ai_*` structure present; enabling adds workers, not tables. |
| **OD-9** | Per-country configuration values beyond Tanzania | Currencies, tax, ID types, work-auth differ. | **Tanzania seeded now**; other countries added via `country_configurations` when activated. | Config rows only; `pipeline_stages` overridable per org. |
| **OD-10** | Cross-franchise candidate transfer/collaboration | S3 mentions "approved transfer or collaboration workflow" as the *only* exception to isolation. | **No cross-franchise access in MVP**; when needed, use `organization_relationships.relationship_type='transfer_grant'` with explicit, audited approval. | Mechanism present; policy/workflow later. |

## B. Legal & privacy risks

- **Residency conflict (OD-1)** is both a legal and architectural risk. Using managed Supabase outside Africa without PDPC-approved cross-border transfer is a **compliance risk**; self-hosting in Africa is more operational burden for a 9-week pilot. **Do not process production candidate data until OD-1 + OD-6 are resolved** (R-132).
- **Biometric processing** (Phase-2 verification / any AI facial analysis) requires a DPIA and is explicitly restricted; the MVP avoids emotion/genuineness scoring (R-083).
- **Cross-border disclosure** (candidate in Tanzania submitted to an employer elsewhere) must create a `cross_border_transfers` record and rely on a consent purpose that covers cross-border processing.
- **Right to erasure vs. retention/audit**: audit and financial records are retained even after candidate anonymization; the DSR workflow anonymizes PII in Ring-1/3a while preserving non-identifying history and legally required records. This tension is handled by `retention_policies` + `legal_holds`, but the exact reconciliation needs DPO sign-off.

## C. AI-interview fairness & quality risks
- AI outputs must never overwrite human decisions or auto-advance (enforced structurally). Bias/adverse-impact review (`ai_fairness_reviews`) is required before any AI score influences hiring.
- Reproducibility is guaranteed by model-run lineage, but **model/prompt drift** across reprocessing must be governed (versioning + `is_superseded`). A candidate-appeal process (OD-8) is undefined.
- Language/accent coverage for African markets is unproven for any vendor (S3) — a validity risk if AI is enabled prematurely.

## D. Assumptions that could force later schema change (watch-list)

| Assumption | Risk if wrong | Mitigation already in schema |
|---|---|---|
| One employer belongs to exactly one responsible franchise/HQ | If employers can be shared across franchises, `employer_organizations.responsible_organization_id` becomes many-to-many | Would add a join table; contained change |
| Applications are 1 per (candidate, job) | If re-application must create new rows (not reopen), UK must relax | UK is the only lock; documented reopen path |
| Pipeline is globally standard (config per org via overrides) | If stages diverge heavily per country, `pipeline_stages` may need full per-org sets | `pipeline_stage_overrides`/`franchise_configurations` reserved |
| CV access counts distinct profiles per period (OD-2) | If per-view decrement is required, counting changes | ledger already records every access event |
| Consent is per (candidate, purpose, recipient) | If field-level consent granularity is required, `covered_data_scope` JSONB must be queried structurally | JSONB scope present; could normalize later |
| Notes are polymorphic with a guarded `subject_type/id` | Heavy polymorphism can weaken FK integrity | validation trigger per subject_type; could split into per-subject note tables if needed |
| Auth via Supabase GoTrue | If auth provider changes, `user_profiles.id = auth.users.id` coupling changes | `user_profiles` is a thin bridge; portable |

## E. Reference: enum vs lookup-table decisions

**Postgres ENUM** (compile-time, code-coupled, rarely changed) — used for small stable sets where a bad value is a bug:
`organization_type`, `recruitment_path (A/B)`, application `entry_type` is a lookup (see below), `consent method`, `message delivery status`, `offer status`, `invoice status`, `payment status`, generic record `visibility`, `note_kind`. *(In the SQL draft these are implemented as `CHECK` constraints rather than native `ENUM` types, to avoid the operational pain of `ALTER TYPE ... ADD VALUE` and to keep them alterable without table rewrites — a deliberate choice; both are "enum-like".)*

**Lookup tables** (admin-configurable, business-owned, may change without a deploy) — `countries`, `currencies`, `languages`, `industries`, `skills`, `education_levels`, `employment_types`, `work_arrangements`, `document_types`, `interview_types`, `verification_types`, `pipeline_stages`, `candidate_sources`, `rejection_reasons`, `notification_categories`, `channels`, `consent_purposes`, `packages/features/entitlements`. These must be editable by SA/HQ without a migration, and several are referenced by reporting, so they are relational rows with `is_active` flags — **never enums**.

**Rule applied:** *"Avoid enums for values administrators may need to change frequently."* Anything a franchise owner, HQ config admin, or the business might reasonably want to add/rename (a rejection reason, a skill, a country, a package feature) is a **table**. Anything that is a code branch (path A/B, a delivery status the app switches on) is an enum-like CHECK.

## F. Residual risk summary (be direct)
- **Not production-ready until OD-1 and OD-6 are resolved.** The schema is implementation-ready; the *deployment* is legally gated.
- The **AI-interview domain is the largest speculative surface**; it is fully structured but should not be activated until OD-8's fairness/vendor questions are answered.
- **Billing auto-charge and CV-credit semantics** (OD-2/OD-3) are intentionally conservative; confirm before building billing automation.
- Everything else in the MVP scope is well-specified by the sources and fully modeled.
