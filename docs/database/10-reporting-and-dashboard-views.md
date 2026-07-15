# 10 — Reporting & Dashboard Views

Every dashboard metric is computed from the **same** transactional + `*_events` tables so country/franchise/recruiter numbers are comparable (the core franchise-model asset, S2/S7). This maps each required metric to source, calculation, filter scope, recommended view/materialized view, refresh strategy, and required indexes. **No duplicate source-of-truth data** is created for dashboard convenience except where a clear performance reason justifies a materialized view.

## 1. Sourcing strategy (rule of thumb)
- **Direct transactional query / plain view** — small, real-time, or action-oriented lists (recruiter "My Work", employer "Needs Review", exception queue). Cheap because backed by the partial indexes in `08`.
- **Materialized view (scheduled refresh)** — expensive aggregations scanned repeatedly (funnel conversion, time-in-stage, country/franchise/recruiter rollups). Refreshed every 5–15 min (or on-demand after large batch changes) via `pg_cron`.
- **Thin aggregation table** — only `dashboard_exceptions` (populated by triggers) because it must be written at event time and queried as a live queue.

RLS: dashboard **views** are defined `security_invoker` so the caller's RLS still applies (franchise sees only its rows); **materialized views** cannot enforce RLS per-row, so they store only **aggregates keyed by org/country** and are exposed through `security_invoker` wrapper views that filter to `authorized_org_ids()`. Individual PII drill-down always goes back to base tables (with RLS + audit).

## 2. Metric → source map

| Metric | Source tables | Calculation | Scope filter | Recommended object | Refresh | Key indexes |
|---|---|---|---|---|---|---|
| Candidate registrations | `candidates` | count by `created_at`, country | country/franchise (acquisition) | MV `mv_country_overview` | 15 min | `candidates(country_id, created_at)` |
| Profile completion | `candidates.profile_completion_pct` | avg/bucket | country | view / MV | 15 min | — |
| Applications (total/new) | `applications`, `application_stage_events` | count; new = entry events | org/job/recruiter | MV `mv_pipeline_funnel` | 5–15 min | `application_stage_events(to_stage_id, occurred_at)` |
| Active jobs | `job_orders` | count `status IN(active,on_hold)` | org/country | view | live | `job_orders(responsible_organization_id,status)` |
| Jobs by lifecycle status | `job_orders`,`job_postings` | count by status | org/country | view | live | status partials |
| Candidates by pipeline stage | `applications` | count by `current_stage_id` | org/job | view | live | `applications(owning_organization_id,current_stage_id)` |
| Recruiter workload | `applications` | count assigned, open next-actions | recruiter | view (My Work) | live | `applications(assigned_recruiter_id,next_action_due)` |
| Stage conversion | `application_stage_events` | ratio of entries stage N→N+1 | org/country/recruiter | MV `mv_pipeline_funnel` | 5–15 min | `application_stage_events(to_stage_id,occurred_at)` |
| Time in stage | `application_stage_events` | avg `time_in_previous_stage` per stage | org/recruiter | MV `mv_time_in_stage` | 15 min | same |
| Time to shortlist/submit/interview/offer/placement | `application_stage_events` | diff between first-entry timestamps of relevant stages | org/recruiter | MV `mv_time_in_stage` | 15 min | same |
| Time to fill | `job_orders`,`application_stage_events`,`placements` | placement.created − posting.published | org/country | MV `mv_franchise_performance` | 15 min | `placements(owning_organization_id)` |
| Placement count | `placements` | count `status<>failed` | org/country/recruiter | MV `mv_franchise_performance` | 15 min | `placements(owning_organization_id,status)` |
| Placement value | `placements.placement_fee` | sum | org/country | MV | 15 min | — |
| Rejection reasons | `application_rejections` | count by `rejection_reason_id` | org | MV/view | 15 min | `application_rejections(rejection_reason_id) WHERE is_active` |
| Candidate withdrawals | `applications` | count `withdrawn_at` | org | view | live | partial |
| Employer activity | `job_orders`,`candidate_submissions`,`submission_views` | counts by employer | employer/franchise | view | live | tenant indexes |
| Employer package status | `employer_subscriptions`,`subscription_entitlement_usage` | status + used/limit | employer/franchise | view | live | usage UK |
| Invoice status | `invoices` | count/sum by status | org/country | MV `mv_franchise_performance` + view | 15 min | `invoices(owning_organization_id,status)` |
| Payment status | `invoices.payment_status`,`payments` | sum paid/unpaid/overdue | org | view/MV | 15 min | `invoices(due_date) WHERE payment_status<>'paid'` |
| Country performance | rollup | per-country aggregates | HQ | MV `mv_country_overview` | 15 min | — |
| Franchise performance | rollup | per-franchise aggregates | HQ/country | MV `mv_franchise_performance` | 15 min | — |
| Recruiter performance (activity/efficiency/conversion/outcome) | `application_stage_events`,`interviews`,`placements`,`consent_records` | 4 separate metric families (never one score, S7) | franchise/HQ | MV `mv_recruiter_kpis` | 15 min | `application_stage_events(*)` |
| Consent completion | `consent_records` | % with required purposes granted | org | view | live | consent partials |
| Verification completion | `verifications` | % verified | org/country | view | live | `verifications(subject_candidate_id,status)` |
| Interview completion | `interviews` | count by status | org/recruiter | view | live | `interviews(owning_organization_id,scheduled_start)` |
| AI interview processing status | `ai_interview_sessions`,`ai_media_assets`,`ai_model_runs` | counts by processing status | org | view | live | ai status indexes |

## 3. Recommended materialized views

- **`mv_recruiter_kpis`** — per recruiter: assigned jobs, applications reviewed, candidates screened/shortlisted/submitted, interviews coordinated, placements, avg time-to-first-review, avg time-in-stage, rejection reasons recorded, consent requests completed, stalled records. Keyed `(owning_organization_id, recruiter_id, period)`. Deliberately **four metric families** (activity / efficiency / conversion / outcome), never a single leaderboard number (S7 design rule).
- **`mv_pipeline_funnel`** — per (org, job? , stage, period): entries, exits, conversion to next stage. From `application_stage_events`.
- **`mv_time_in_stage`** — per (org, stage, period): avg/median time-in-stage and time-to milestones.
- **`mv_franchise_performance`** — per (country, franchise, period): active jobs, candidates in process, placements, placement value, time-to-fill, open/overdue invoices, status (healthy/attention).
- **`mv_country_overview`** — per (country, period): registrations, active jobs, candidates in process, placements, invoices, exceptions.

All MVs: `REFRESH MATERIALIZED VIEW CONCURRENTLY` on a `pg_cron` schedule (15 min default; funnel/time 5–15 min). A unique index on each MV's key enables `CONCURRENTLY`.

## 4. Live views (RLS-respecting, `security_invoker`)
- `v_my_work` — recruiter action queue (new/blocked/consent-pending/overdue/stalled) from `applications` + `tasks`.
- `v_employer_needs_review` — employer submissions/applications needing review.
- `v_candidate_masked` / `v_submission_employer` — the masked candidate surfaces employers query (never base `candidates`).
- `v_hq_country_comparison` — wrapper over `mv_country_overview` filtered to `authorized_org_ids()`.
- `v_franchise_dashboard` — wrapper over `mv_franchise_performance` for the owning franchise.
- `v_compliance_exceptions` — over `dashboard_exceptions`.

## 5. Drill-down discipline (privacy)
Dashboards show **aggregates by default** (no PII). Opening an individual candidate/client record from a metric goes through the **base table with RLS + an audit event** (`is_sensitive_access=true`). This satisfies scenario 9 (HQ aggregates without casual browsing) and the S7 information-boundary matrix.

## 6. Exception queue (`dashboard_exceptions`)
Populated at event time by triggers/jobs for: client submission without valid consent, missing screening notes at a mandatory stage, rejection without reason, cross-franchise access attempt, candidate document viewed unexpectedly, unusually large candidate-view volume, suspended-user activity, overdue privacy/retention action. Selecting an exception opens the underlying record + event history (S7 §11). Scoped: franchise sees its own; HQ/SA see all.

## 7. Why not more duplication
The only persisted non-source data are the MVs (justified by repeated expensive aggregation over `application_stage_events`) and `dashboard_exceptions` (must be written at event time). Everything else is a `security_invoker` view over base tables, honoring RLS and avoiding a second source of truth.
