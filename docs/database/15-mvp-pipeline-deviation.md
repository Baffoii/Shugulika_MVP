# 15 — MVP Pipeline Deviation (approved)

This document formally approves the **simplified candidate pipeline** shipped in the MVP and maps mandatory R-062 business gates onto those stages. It supersedes earlier README language that allowed mid-pipeline skips to Client Submission and waived employer-specific consent.

The full 15-stage product spine remains the long-term target in [06-status-and-workflow-models.md](./06-status-and-workflow-models.md). Live stage keys stay simplified until a deliberate expansion.

## Approved stage mapping

| Standard stage (R-060) | MVP treatment |
| --- | --- |
| Applied / Sourced | Collapsed into apply/source → entry `cv_review`; distinguish via `applications.entry_source` |
| CV Screening | `cv_review` |
| Longlisted | Collapsed into leaving `cv_review` (no separate stage) |
| Shortlisted | Collapsed; **screening-notes gate** fires before leaving `cv_review` |
| Screening Interview | `interview_screening` + `interview_review` |
| Testing | `testing` + `test_review` |
| Reference Checks | `reference_checks` (optional after interview review only) |
| Client Submission | `client_submission` |
| Client Interview | Collapsed into employer submission statuses (`interview_requested`, etc.) — not an application stage |
| Offer / Hired | `offer` / `hired` |
| Invoiced / Closed | Accounts/job milestones (`invoices`, `job_orders.status`), not candidate stages |

Legacy keys (`applied_sourced`, `cv_screening`, `longlisted`, `shortlisted`, `screening_interview`, `client_interview`, …) remain for history labels only.

## Active MVP flow

```
Apply/Source → CV Review → Testing → Test Review → Interview Screening → Interview Review
  → (optional) Reference Checks → Client Submission → Offer → Hired
```

- Forward-only; **Reject** is permanent and requires a reason (`rejected_from_stage` stored).
- No skip from Testing / Test Review / Interview Screening directly to Client Submission.
- Reference Checks remain optional after Interview Review.
- Advertised / Invoiced / Closed stay job or accounts milestones.

## Mandatory gates (DB / RPC)

All transitions go through `public.advance_application` / `public.reject_application`. Direct updates to `applications.current_stage` and rejection columns are blocked unless the RPC session flag is set.

| Gate | When | Check |
| --- | --- | --- |
| Screening notes | Leaving `cv_review` | ≥1 `recruiter_notes` with `subject_type='application'` for the application |
| Test completion | `testing` → `test_review` | Assessment `submitted`/`graded`, or metadata `waive_reason` |
| Test review | Leaving `test_review` | Assessment `graded` and not awaiting human review, or `waive_reason` |
| Interview completion | `interview_screening` → `interview_review` | `interviews.status='completed'` **or** video assignment `submitted`/`reviewed`, or `waive_reason` |
| Interview review | Leaving `interview_review` | Interview `outcome` set, video assignment `reviewed`, or `waive_reason` |
| Employer-specific consent | Entering `client_submission` | Active `candidate_consents` with `purpose='employer_submission'` and `covered_org_id = job_orders.employer_org_id` |
| Accepted offer | Entering `hired` | `offers.status='accepted'` for the application |
| Placement before invoice | Issuing non-subscription invoice | `invoices.placement_id` required when `subscription_id is null` and status → `issued` |
| Rejection reason | Any → `rejected` | Non-empty reason via `reject_application` |

MVP uses existing `recruiter_notes` as the screening-notes artifact (no separate `screening_scorecards` table).

## Reversed prior MVP relaxations

- Mid-pipeline jump to Client Submission: **removed**.
- “Active application is enough” for employer sharing without employer-specific consent: **reversed**. Client Submission requires employer-specific consent and `employer_submissions.consent_id`.

## Related RPCs

- `advance_application(application_id, to_stage, note, metadata)`
- `reject_application(application_id, reason, note)`
- `create_placement_from_offer(offer_id)` — creates placement after accepted offer (enables invoicing)
