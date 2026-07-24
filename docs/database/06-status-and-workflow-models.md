# 06 — Status & Workflow Models

Each state machine below lists: allowed statuses, allowed transitions, required permission, mandatory information, blocking conditions, side-effects, and the history record created. All transitions run through a stored function that validates, records the `*_events` row (attributed + timestamped), and emits side-effects.

Legend: `[perm]` required permission; `⛔` blocking gate; `→` allowed transition; `⚙` side-effect.

---

## 1. Job Order (`job_orders.status`)
Stages: `draft → submitted → approved → active → (on_hold ↔ active) → {filled | partially_filled | closed | cancelled | filled_externally | closed_without_hire}`

- **draft → submitted** `[job.submit]` — ⛔ requires title, employer, responsible org, country, recruitment_path. ⚙ notify Shugulika approver.
- **submitted → approved** `[job.approve]` (Shugulika/HQ) — even direct-employer jobs need lightweight approval (R-044). ⚙ enables publication.
- **submitted → draft** (changes requested) `[job.approve]` — ⚙ notify employer.
- **approved → active** — auto when a `job_posting` is advertised OR recruiter opens the pipeline.
- **active → on_hold / on_hold → active** `[job.manage]`.
- **active → filled/partially_filled/closed/…** `[job.close]` — ⛔ `closed_reason` required. ⚙ compute funnel/time-in-stage; a multi-vacancy job may stay `active` with a Hired candidate.
- **Path lock:** first application sets `path_locked_at`; `recruitment_path` becomes immutable.
- **History:** `job_order_events`.

## 2. Job Publication / Approval (`job_postings.status` + `approval_status`)
Publication: `draft → pending_approval → advertised → (paused ↔ advertised) → {expired | unpublished}`
Approval: `not_submitted → submitted → {changes_requested → submitted | approved}`

- **draft → pending_approval** `[posting.submit]` — ⛔ job_order approved; posting content version exists.
- **pending_approval → advertised** `[posting.approve]` — ⛔ `approval_status=approved`, deadline set, country set, screening criteria present (S5 §A checklist). ⚙ set `published_at`; upsert `job_search_documents`; job_order → active; notify.
- **advertised → paused/expired/unpublished** `[posting.manage]` — ⚙ remove from public search index.
- **History:** `job_posting_events` + immutable `job_posting_versions`.

> **"Advertised" is a job milestone, not a candidate column** (R-040). It lives here, never in `applications.current_stage_id`.

## 3. Application / Candidate Pipeline (`applications.current_stage_id`)
The 12 candidate stages (from the 15-Spine, excluding job/accounts milestones):
`Applied/Sourced → CV Screening → Longlisted → AI Interview Screening → Shortlisted → Screening Interview → Testing → Reference Checks → Client Submission → Client Interview → Offer → Hired`
Plus cross-cutting states: `on_hold`, `withdrawn`, `rejected` (with reopen), and Path-A employer-facing collapse.

> **MVP deviation (approved):** the live product keeps a simplified stage list and enforces R-062 gates on those stages via `advance_application` / `reject_application`. See [15-mvp-pipeline-deviation.md](./15-mvp-pipeline-deviation.md).

Transitions run via `advance_application(application_id, to_stage, payload)`:
- **Applied/Sourced → CV Screening** `[application.review]` — sourced candidates start as *Sourced – not yet contacted*; establishing interest sets `sourced_contacted_at`.
- **CV Screening → Longlisted** — ⛔ `screening_record` outcome recorded.
- **Longlisted → AI Interview Screening** — ⛔ interest/availability confirmed. AI stage may be marked `not_required` with reason (R-081).
- **AI Interview Screening → Shortlisted** — ⚙ if AI used, requires `ai_human_reviews.is_final` (AI never auto-advances).
- **→ Shortlisted (gate)** — ⛔ **cannot pass Shortlisted without `screening_scorecard` + screening notes** (R-062). Function returns the specific missing items ("Complete 2 items before continuing…", S5).
- **Shortlisted → Screening Interview → Testing → Reference Checks** `[application.advance]` — each records its structured record (scorecard/assessment/reference).
- **→ Client Submission** — ⛔ **employer-specific consent gate** (see §5). Creates `candidate_submission` (Path B) or is implicit for Path A.
- **Client Interview → Offer** — records interview outcome.
- **Offer → Hired** — ⛔ accepted offer exists (§9). ⚙ create `placement` + invoicing task.
- **Any → rejected** `[application.reject]` — ⛔ `rejection_reason`; communication outcome chosen; reopen preserves original event.
- **Any → on_hold / withdrawn** — recorded with reason.
- **Path A collapse:** employer sees `Needs Review → Shortlisted → Interview → Offer → Hired`; internal/unused stages recorded as `completed/waived/not_required` mapped to the full 15-stage history behind the scenes (S6).
- **History:** `application_stage_events` (from/to/actor/occurred_at/time_in_previous_stage) — feeds all KPIs.

## 4. Candidate Submission (`candidate_submissions.status`)
`consent_pending → submitted → viewed → {shortlisted | interview_requested | offered | rejected | withdrawn} ; submitted/viewed/... → {access_revoked | access_expired}`

- **(create) → consent_pending** `[submission.create]` — recruiter prepares proposed submission (employer, job, CV version, fields, summary, tests/refs to include). System generates the employer-facing preview.
- **consent_pending → submitted** `[submission.create]` — ⛔ valid matching consent (§5) + snapshot hash matches. ⚙ create immutable `submission_snapshot` + `submission_documents`; grant employer time-boxed access; notify employer + candidate.
- **submitted → viewed** — on first employer view (⚙ `submission_views` + `candidate_access_events` + audit).
- **→ shortlisted/interview_requested/offered/rejected** `[submission.decide]` (employer) — records employer decision; Path B mirrors to recruiter.
- **→ withdrawn** (candidate/recruiter) or **→ access_revoked** (consent withdrawal) or **→ access_expired** (window lapse) — ⚙ cut document grants; audit.
- **Renewed consent:** changing CV/fields after consent invalidates the hash → back to `consent_pending`.
- **History:** `submission_events`.

## 5. Consent (`consent_records`)
`granted (active) → {expired | withdrawn}`; a purpose may have many historical rows (latest active = current).

- **grant** `[self]` (candidate) or captured by recruiter with method=verbal_recorded — records purpose, covered recipient, data scope, legal-doc version, method, evidence, granted_at, expires_at.
- **withdraw** `[self]` — sets `withdrawn_at`; ⚙ **cascade**: dependent `candidate_submissions` → `access_revoked`; document grants revoked; `communication_preferences` for that purpose (e.g. WhatsApp) set `opted_in=false`; audit + `dashboard_exceptions` if an active submission was cut.
- **Gate semantics:** employer-submission consent must name the employer (`covered_organization_id`) and match the submission's snapshot; general franchise-processing consent is **insufficient** (R-031).
- **History:** consent rows are themselves the ledger; changes audited in `audit.audit_log`.

## 6. Verification (`verifications.status`)
`pending → in_review → {verified | failed | expired}`; re-verification creates a new attempt.
- **pending → verified** `[verification.review]` (or automatic for OTP/email). ⚙ update candidate trust signals (mobile_confirmed / identity_verified); no negative labels (R-016).
- **verified → expired** (time) → re-verify.
- Biometric methods (`biometric_ocr/liveness/face_match`) are Phase-2 and gated behind DPIA (OD-4).
- **History:** `verification_events`; evidence in `verification_evidence` (short retention).

## 7. Interview — human (`interviews.status`)
`requested → scheduled → confirmed → {completed | rescheduled → scheduled | cancelled | no_show}`
- **requested → scheduled** `[interview.manage]` — type, datetime, panel, location/link.
- **scheduled → confirmed** — candidate confirmation recorded.
- **→ completed** — ⛔ attendance status, rating/scorecard, recommended next step (S6). Recording access requires `recording_consent_id`.
- Path A: request can go straight to candidate; Path B: routed to recruiter to coordinate.
- **History:** `interview_events`; scorecards separate; client vs private feedback kept distinct (R-080).

## 8. AI Interview Processing (`ai_interview_sessions.status` + media/model/eval)
Session: `in_progress → {completed | abandoned | error}`
Media (`ai_media_assets`): `upload pending → uploaded → processing → done|error`
Model run (`ai_model_runs.run_status`): `queued → running → {succeeded | failed}`
Evaluation lifecycle: machine `ai_evaluations` → `ai_human_reviews` (final).

- **invitation → session start** — ⛔ **consent (purpose=record_ai_interview)** recorded; secure token valid.
- **responses → media upload** — media stored in Storage; row tracks upload/processing status.
- **transcription** — `ai_transcripts` + segments; translation later.
- **model run** — records provider/model_id/model_version/prompt_version/rubric_version/token cost. **Reprocessing** = new `ai_model_run` referencing `reprocessing_of_run_id`; prior `ai_evaluations.is_superseded=true`.
- **evaluation (machine)** — competency/question scores + evidence + confidence + integrity flags. ⛔ **never writes an application stage event.**
- **human review** — reviewer agrees/overrides with reason; `is_final=true` is the authoritative outcome. Only a final human review can drive an application advance.
- **fairness/quality review** — `ai_fairness_reviews`.
- **deletion** — scheduled jobs purge media/transcript/model output independently per `retention_status`/`delete_after`.
- **History:** each sub-table's status columns + `ai_processing_errors`; reproducibility via the model-run lineage.

## 9. Offer (`offers.status`)
`preparing → sent → negotiating → {accepted | declined | expired | withdrawn}`
- **preparing → sent** `[offer.manage]` — terms recorded (comp, currency, benefits, start, conditions, expiry). Path A employer sends directly; Path B via recruiter.
- **sent → negotiating → accepted** — ⚙ enables Hired + placement.
- **→ declined** — ⛔ `declined_reason`; **does not** auto-reject the application.
- **→ expired** (time) / **→ withdrawn** (employer).
- **History:** `offer_events` + immutable `offer_versions`.

## 10. Placement (`placements.status`)
`active → guarantee_period → {completed | failed → replaced}`
- **create** — auto from accepted offer (`create_placement_from_offer()`): candidate, employer, franchise attribution, recruiter, start, fee, guarantee. ⚙ **emit invoicing task** to accounts (R-091).
- **guarantee_period → failed** — ⚙ may create a `replacement_of_placement_id` linkage and re-open sourcing.
- **History:** `placement_events`.

## 11. Invoice (`invoices.status` + `payment_status`)
Status: `draft → issued → {partially_paid | paid | overdue | cancelled | credited}`
Payment: `unpaid → partial → paid → refunded`
- **draft → issued** `[invoice.issue]` (accounts) — ⛔ line items, currency, due date; ⚙ generate `invoice_number` (sequence + advisory lock), notify billing contact.
- **issued → paid/partially_paid** — via `payments`; `payment_status` derived from sum of succeeded payments vs total.
- **→ overdue** — scheduled job when past due_date and unpaid.
- **→ credited/cancelled** — via `credit_adjustments`.
- Recruiters read commercial status; edits need `invoice.edit`; HQ sees country/franchise totals (R-102).
- **History:** `invoice_events`.

## 12. Payment (`payments.status`)
`pending → {succeeded | failed → (retry) | refunded}`
- Manual recording allowed (`method=manual`, `recorded_by`, proof in `payment_proofs`).
- Provider fields captured generically (swappable gateway, C-3/R-103); webhook reconciliation (app layer) verifies server-side.
- **History:** `payment_events`.

---

## 13. Cross-workflow side-effect summary

| Trigger event | Side-effects |
|---|---|
| Stage change (any) | `application_stage_events` row; `activity_events` projection; KPI materialized-view staleness flag. |
| Submission `submitted` | snapshot + document grants + employer notification + candidate notification + audit. |
| Consent withdrawn | dependent submissions → access_revoked; grants revoked; comms opt-out; audit + exception. |
| Offer accepted | application → Hired; `create_placement_from_offer()`; invoicing task. |
| Placement created | invoicing task to accounts; franchise attribution recorded. |
| Employer views submission/CV | `submission_views` + `candidate_access_events` (usage meter) + audit. |
| Rejection without reason attempt | blocked by CHECK; if bypass attempted → exception. |
| Cross-franchise read attempt | blocked by RLS; logged; surfaced in `dashboard_exceptions`. |
| Document uploaded | scan job (scan_status), preview/watermark generation, checksum. |
| Retention due | soft-delete/anonymize/purge per `retention_policies` unless `legal_holds` present. |

All side-effects that must be atomic with the transition run inside the transition function's transaction; notifications/KPI refresh are emitted as events/tasks (eventual consistency).
