# 14 — Schema Review Checklist

Run before implementation. Each item has a verification method and the artifact that satisfies it. Check (`[ ]` → `[x]`) during review.

## 1. Every workflow is supported
- [ ] Candidate journey (browse→register→verify→profile→documents→apply→history) → `candidates`, `verifications`, `documents`, `applications`, `application_snapshots` (`02`,`04`,`06`).
- [ ] Recruiter 15-stage pipeline + gates → `applications`, `application_stage_events`, screening/scorecard/assessment/reference/rejection tables, `advance_application()` (`06`).
- [ ] Path A and Path B routing preserved distinctly → `job_orders.recruitment_path`, `applications.entry_type`, `candidate_submissions` (`05`,`06`).
- [ ] Employer portal (register→approve→package→job wizard→review→decide→offer) → `employer_organizations`, `employer_subscriptions`, `job_orders`, `candidate_submissions`, `offers` (`04`,`06`).
- [ ] HQ/franchise dashboards + drill-down → views/MVs (`10`).
- [ ] Whistleblowing intake & case management → `safeguarding_cases` (`04`,`07`).

## 2. Tenant isolation is enforceable
- [ ] Every private table has `owning_organization_id NOT NULL`.
- [ ] RLS enabled on all sensitive tables; policies use `authorized_org_ids()` (`07` §3–4).
- [ ] Helper functions non-recursive and `SECURITY DEFINER` with fixed `search_path` (`07` §1).
- [ ] Cross-tenant child-parent org match enforced by trigger (`05` §7).
- [ ] Cross-tenant automated test suite planned (`13` post-migration).

## 3. Consent is auditable
- [ ] `consent_records` versioned with who/what/purpose/recipient/scope/notice-version/method/evidence/grant/expiry/withdrawal (`04` Domain R).
- [ ] Employer-submission consent distinct from general consent; recipient-scoped (`05`,`06` §5).
- [ ] Withdrawal cascade implemented (`after_consent_withdrawn`) (`06` §5).
- [ ] Renewed-consent-on-change via snapshot hash (`05`,`06`).

## 4. Candidate disclosure is controlled
- [ ] Ring model: global vs shared-search vs franchise-private vs employer-facing (`02` §4).
- [ ] `candidate_search_documents` contains only approved fields; "never include" list excluded (`04`,`05` §7).
- [ ] Visibility separate from document visibility (`candidate_visibility` vs `documents.visibility`).

## 5. Employer access is limited
- [ ] Employers query masked views, never base `candidates` (`07` §3).
- [ ] Employer sees only own-job Path-A applications + own submissions + granted pool hits (`02` §5, `07` §6 #3–4).
- [ ] Masked visible/hidden field split enforced by snapshot + view (`04` K, `07`).

## 6. Franchise-private information remains private
- [ ] Ring-3a tables (`candidate_engagements`, screening, notes, references, ratings, interview notes) scoped to `owning_organization_id` (`04` J).
- [ ] References extra-restricted (`reference.read`) and never in search (`04`,`05`).
- [ ] Franchise A cannot read Franchise B (adversarial #1, `07` §6).

## 7. Job and application states are separate
- [ ] `pipeline_stages.stage_class` separates job/candidate/placement/accounts stages (`06`).
- [ ] Advertised/Invoiced/Closed cannot be an application stage (CHECK) (`05` §4).
- [ ] Job order / publication / approval / application each have own state machine + `*_events` (`06`).

## 8. AI outputs remain traceable
- [ ] Six separable AI sub-graphs; no JSON blob (`02` §8, `04` N).
- [ ] Every evaluation links model/prompt/rubric/question versions + source media (`04` N, `06` §8).
- [ ] Reprocessing = new model run; prior superseded, not overwritten (`05`,`06`).
- [ ] Human review separate; AI never auto-advances (no code path) (`06`,`07` #10/#15).

## 9. Files are secured
- [ ] No binary in Postgres; metadata + Storage (`09`).
- [ ] Private buckets, signed URLs after permission+consent+scan checks, logged (`09` §2–3).
- [ ] Watermarked view-only previews; export = Super Admin, audited (`09` §4).
- [ ] Path-guess and stale-URL/suspended-user defeated (`07` #11,#12).

## 10. Dashboard queries are possible
- [ ] Every required metric mapped to source + object + refresh (`10` §2).
- [ ] MVs keyed by org/country; wrapper views `security_invoker` (`10` §1,§3).
- [ ] Exception queue populated at event time (`10` §6).
- [ ] Recruiter KPIs are 4 metric families, not one score (`10` §3).

## 11. RLS policies are complete
- [ ] Every table in §3 of `07` has SELECT/INSERT/UPDATE/DELETE stance defined.
- [ ] Reference tables read-all / `config.manage` write.
- [ ] Audit log append-only (no update/delete grant) (`07` #14).
- [ ] Service-role usage confined to server workers (`07` §4).

## 12. Indexes support expected queries
- [ ] Every FK used in joins/RLS is indexed (`08`).
- [ ] Hot queues use partial indexes (`08` §5).
- [ ] Search uses GIN/trigram/tsvector (`08` §3).
- [ ] `audit_log` partitioned; history tables indexed by (parent, occurred_at) and (to_state, occurred_at) (`08` §3–4).

## 13. Deletion and retention are defined
- [ ] `retention_policies` per entity; `legal_holds` override (`04` S).
- [ ] Soft-delete vs anonymize vs purge vs retain documented per table (`04` classification, `12` OD-7).
- [ ] Storage retention with independent recording/transcript/model-output schedules (`09` §6).
- [ ] DSR (access/correction/deletion/export) modeled (`04` S).

## 14. No major source requirement is missing
- [ ] Every `R-xxx` appears in the traceability matrix exactly once (`11`).
- [ ] Task completeness checklist fully mapped (`11` coverage confirmation).
- [ ] Deferred/hard requirements preserved with a structural home, not dropped (`11` deferred table).
- [ ] Conflicts recorded with resolutions (`01` §3); open decisions have defaults (`12`).

## 15. Supabase-specific
- [ ] `user_profiles.id = auth.users.id`; profile-on-signup trigger (`04` A, `13`).
- [ ] Helper functions in `private` schema, not API-exposed (`07`).
- [ ] Buckets + storage RLS defined (`09`,`25_storage.sql`).
- [ ] `pg_cron`/scheduled jobs for MV refresh, retention sweeps, overdue invoices, expiry sweeps (`10`,`13`).

## Sign-off
- [ ] Database architect
- [ ] Product owner (Path A/B, packages, pipeline gates)
- [ ] DPO / legal (consent, retention, residency OD-1/OD-6)
- [ ] Security reviewer (RLS, storage, audit)
