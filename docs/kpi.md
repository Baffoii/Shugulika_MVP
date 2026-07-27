# Recruiter, Franchise, and HQ KPI definitions

Operational KPIs for Shugulika MVP. All values are computed from live tables under RLS — never hardcoded in UI components. Platform/franchise defaults live in `recruiter_kpi_targets`.

Timestamps are stored and calculated in **UTC**. Display currently shows UTC-derived durations (hours/days); a dedicated display timezone is an MVP limitation.

## Attribution (reassignment)

| Metric family | Attribution |
|---|---|
| Review / conversion actions | `application_stage_history.actor_id` (who performed the action) |
| Active workload / withdrawals | Current `applications.assigned_recruiter_id` |
| Placements | `placements.recruiter_id` when set |
| Reassigned applications | Historical review credit stays with the actor; workload moves with assignment. No double-count of distinct application IDs in rates. |

There is **no assignment-history table**. Ownership at past timestamps cannot be reconstructed beyond actor_id on stage events.

## Target hierarchy

1. Franchise org + level override (`recruiter_kpi_targets.organization_id = franchise`)
2. Platform global (`organization_id` null)
3. In-code seed defaults only if DB rows are missing (mirrors migration seeds)

Effective source is returned as `platform` | `franchise`. Target changes are written to `audit_logs` via trigger.

Levels: `junior` | `recruiter` | `senior` | `head_recruiter`.

## KPI catalog

For each metric: definition, numerator/denominator, date field, inclusions.

### 1. Applications reviewed
- **Value:** distinct applications with a meaningful review by the recruiter in the period
- **Date field:** stage-history `created_at` (event date)
- **Meaningful:** advance/reject transitions (including into testing, interview, CS, offer, hired, rejected); not page opens
- **Empty:** insufficient data (not 0%)

### 2. Active workload
- **Value:** distinct assigned apps that are not terminal (`rejected`, `hired`, `closed`, `invoiced`), not withdrawn, not on cancelled/closed jobs
- **Date field:** snapshot (now)
- **Breakdown:** by `current_stage`

### 3. Time to first review
- **Value:** median hours `first meaningful review − applications.created_at`
- **Date field:** first review event in period
- **Exclude** never-reviewed from median; show **Awaiting first review** count separately

### 4. Time in stage
- **Value:** median hours dwell per completed stage (enter→exit from stage history)
- **Date field:** exit event in period
- **Stalled:** active apps whose time in current stage exceeds `kpi_stage_age_thresholds`

### 5. Time to client submission
- **Value:** median days `first client_submission − applications.created_at`
- **Date field:** first CS entry; actor-attributed when scoped to a recruiter
- **Include only** apps that reached CS

### 6. Time to fill
- **Value:** median days `placements.created_at − jobs.published_at`
- **Date field:** placement created in period
- **Exclude** unfilled jobs; do not use “now”
- **Unavailable** when no placement records exist (does not fabricate from Hired stage)

### 7. CV review conversion
- **Denom:** distinct apps with completed CV review (leave `cv_review` via advance/reject) in period
- **Num:** those that later reached testing / interview / CS / offer / hired

### 8. Testing pass rate
- **Denom:** `assessment_assignments` with `status=graded`, `human_review_required=false`, score + threshold present, graded in period
- **Num:** `score >= pass_threshold`
- Does **not** infer pass/fail from application stage

### 9. Interview conversion
- **Denom:** apps with completed `interview_review` (actor) in period
- **Num:** later reached `client_submission`, `offer`, or `hired`

### 10. Client submission acceptance
- **Denom:** employer submissions decided in period (not consent_pending/submitted/viewed)
- **Num / accepted:** `shortlisted`, `interview_requested`, `offered`

### 11. Offer-to-hire
- **Denom:** finalized offers (`accepted|declined|expired|withdrawn`) updated in period
- **Num:** `accepted` offers that have a valid linked placement
- **Unavailable** with explanation if no finalized offers — never uses Hired stage alone

### 12. Placement rate
- **Denom:** apps that reached `client_submission` in period (actor-attributed when recruiter-scoped)
- **Num:** those with a valid placement (`status <> failed`)

### 13. Rejection rate and reasons
- **Date field:** `applications.rejected_at`
- Totals, by `rejected_from_stage`, by catalog key (label→key map), free-text **Other** separately

### 14. Candidate withdrawal rate
- **Num:** assigned apps with `withdrawn_at` in period
- **Denom:** assigned apps created before period end

### 15. SLA / action queue
Supported: awaiting first review; assessments past `due_at`; interviews overdue; stalled in stage; offers awaiting response (`sent`/`negotiating`); hires awaiting placement/invoice.  
**Unsupported:** employer feedback overdue (no deadline field) — labeled unavailable.

## Franchise / HQ dashboards

Same formulas via shared loaders in `src/lib/data/recruiter-kpis.ts` and pure math in `src/lib/kpi/definitions.ts`.

- Franchise: `/franchise/reports` — org-scoped; may edit org target overrides
- HQ: `/hq/reports` — franchise + recruiter comparison with country/franchise filters; may edit platform targets
- Aggregates never expose recruiter notes, employer comments, candidate contacts, or references

## Known MVP limitations

- No historical recruiter-assignment timeline
- Rejection reasons historically stored as labels (key preferred going forward)
- Offer / placement / invoice KPIs are **unavailable or thin** until those workflows are routinely used
- Employer feedback overdue not supported
- Display timezone not configurable (UTC-based durations)
- Demo seed users may appear in local reporting; do not treat seed data as production performance

## Security

- No service-role in the web app
- RLS: recruiters read own metrics via assigned/acted apps; franchise sees scoped org; HQ network aggregates; employers/candidates have no KPI target/report access
- Franchise cannot write platform (`organization_id` null) targets
