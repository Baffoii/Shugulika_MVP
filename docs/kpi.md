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

## Target versioning

`recruiter_kpi_targets` holds only the **current** row per (level, org). Without
history, changing a target silently rewrites how every past period was graded.

`recruiter_kpi_target_versions` (migration `20260805090000`) is an **append-only**
snapshot table fed by an `after insert or update` trigger on
`recruiter_kpi_targets`. Each row carries `target_id`, `organization_id`,
`recruiter_level`, the full metric payload as `jsonb`, `effective_from`,
`superseded_at`, and `changed_by`. Writing a target closes the previous open
version and inserts a new one. A guard trigger rejects deletes and any update
other than closing an open `superseded_at`; existing targets were backfilled with
an initial version at their `created_at`.

**Resolution.** Every KPI payload resolves the version whose
`[effective_from, superseded_at)` window contains the *period end* — never
"latest". `until` is exclusive, so a closed period resolves at its **last
instant** (`until − 1ms`); resolving at `until` itself would pick up a target
that took effect the moment the period closed. An open period resolves at now.

Precedence at that instant: franchise version → platform version → earliest
recorded version (flagged `earliest_version`) → in-code defaults. A franchise
override created *after* a period ended deliberately does not apply to it.

Every dashboard payload returns `targetVersionId` and `targetSource`, plus a
`targetVersion` object with `basis`
(`version_at_period_end` | `earliest_version` | `current_row` | `platform_defaults`)
and the version window. The recruiter KPI page shows this as "Target version
used".

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

### 15. SLA / action queue → attention queue

Every SLA item is now a row, not just a count. Each carries **`ownerUserId`**,
**`nextAction`**, **`dueAt`**, and **`applicationId`**.

Ownership resolves `applications.assigned_recruiter_id` → job owner
(`job_assignments`, `role = 'owner'`) → the viewing recruiter, and the source is
reported as `ownerSource`. The queue is always built from a single recruiter's
already-scoped rows, so the final fallback cannot surface another recruiter's
work. `ownerUserId` is never null.

| Kind | Trigger | `nextAction` |
|---|---|---|
| `overdue_first_review` | Assigned, open, unreviewed past the first-review target | `review_cv` |
| `assessment_past_due` | `assessment_assignments.due_at` passed, not graded/cancelled/expired | `chase_assessment` |
| `interview_overdue` | `interviews.scheduled_at` passed without an outcome | `close_out_interview` |
| `employer_approval_awaiting` | Submission in `submitted`/`viewed` | `chase_employer` |
| `stalled_in_stage` | Time in current stage > `kpi_stage_age_thresholds` | `advance_or_reject` |
| `missing_screening_notes` | In `cv_review` with no recruiter note (mirrors `private.pipeline_has_screening_notes`) | `add_screening_note` |
| `offer_awaiting_response` | Offer `sent`/`negotiating` | `chase_offer_response` |
| `hire_awaiting_placement` | Hired with no placement/invoice | `record_placement` |
| `candidate_update_overdue` | Candidate silent > 168h | `update_candidate` |

The first six are the attention-first categories shown on `/recruiter/kpis` and
in the dashboard strip. Items sort most-overdue first. `dueAt` is null only where
the source row genuinely records no deadline, and that is labeled rather than
filled in.

### 16. Employer response time
- **Value:** median hours `employer_submissions.responded_at − submitted_at`
- **Overdue:** unanswered past `response_due_at`
- **Unavailable** when no submission carries `submitted_at` — never reported as 0

### 17. Candidate response time
- **Value:** median hours from a recorded request to the candidate's first reply,
  across the interview-invitation path (`interviews.candidate_response_due_at` →
  `candidate_responded_at`) and the consent path
  (`applications.consent_requested_at` → `consent_responded_at`)
- Deliberately **separate** from employer response time: a slow candidate and a
  slow employer are different problems with different next actions
- Rows with no recorded request moment are excluded, never estimated

### 18. CX guardrails
- **Overdue candidate updates:** active applications where the candidate has heard
  nothing for more than 168h, anchored on the last staff→candidate notification
  and falling back to the last stage change
- **Withdrawal reasons:** grouped from the `withdrawn` stage event's `reason`.
  No surface captures a withdrawal reason today, so rows land in `unspecified`
  and `reasonCaptureSupported: false` says so explicitly
- **Interview reschedules:** from `kpi_interview_schedule_events`, a trigger-fed
  log on `public.interviews`. `public.interview_events` is the video-interview
  log and has no reschedule event type. History starts at migration
  `20260805091000`; earlier reschedules are unknowable and reported as such
- **Unanswered candidate notifications:** unread past a 48h grace window, read via
  `public.kpi_candidate_update_status` (see Security). Advisory only — an unread
  notification is a prompt to follow up, never a candidate-quality signal

### 19. Drill-downs

Every KPI card and SLA count opens the exact application IDs behind the number.
`src/lib/kpi/drilldowns.ts` derives each set with the *same* predicates the
metric uses, so a card and its drill-down cannot disagree; numerator and
denominator sets are exposed separately. Drill-downs return application IDs only
— no candidate names, notes, or employer comments — and are filtered through the
caller's scoped set before rendering.

### 20. Filters

`/recruiter/kpis` filters on date grain (`day` | `week` | `month` | `year` |
`custom`), assigned role, employer, job, and stage. Windows are half-open UTC
`[since, until)`; weeks start Monday.

Scope comes from the session, never the URL: `parseKpiFilters` reads only an
allow-list of keys and drops any `recruiter`/`owner`/`organization` parameter,
and `constrainFiltersToOptions` silently discards any id outside the recruiter's
own option lists — dropping rather than erroring, so a response never confirms
that a guessed id exists. Recruiter scope is their membership org; there is no
cross-franchise picker. **There is no nationality filter** (see Security).

## Franchise / HQ dashboards

Same formulas via shared loaders in `src/lib/data/recruiter-kpis.ts` and pure math in `src/lib/kpi/definitions.ts`.

- Franchise: `/franchise/reports` — org-scoped; may edit org target overrides
- HQ: `/hq/reports` — franchise + recruiter comparison with country/franchise filters; may edit platform targets
- Aggregates never expose recruiter notes, employer comments, candidate contacts, or references

## Known MVP limitations

- No historical recruiter-assignment timeline
- Rejection reasons historically stored as labels (key preferred going forward)
- Offer / placement / invoice KPIs are **unavailable or thin** until those workflows are routinely used
- Employer feedback overdue is supported only from 2026-08-05 onward: `response_due_at`, `responded_at`, `candidate_response_due_at`, `candidate_responded_at`, `consent_requested_at`, and `consent_responded_at` are stamped by trigger and cannot be backfilled, so older rows are excluded rather than estimated
- Interview reschedule counts start at the `20260805091000` migration — `public.interviews` kept no schedule history before it
- No withdrawal-reason capture on the candidate withdraw flow; the breakdown reports `unspecified` honestly instead of implying no reason existed
- Display timezone not configurable (UTC-based durations)
- Demo seed users may appear in local reporting; do not treat seed data as production performance

## Security

- No service-role in the web app
- RLS: recruiters read own metrics via assigned/acted apps; franchise sees scoped org; HQ network aggregates; employers/candidates have no KPI target/report access
- Franchise cannot write platform (`organization_id` null) targets
- `recruiter_kpi_target_versions` is readable under the same rules as the targets
  it snapshots, and is written only by the `SECURITY DEFINER` snapshot trigger
- `public.kpi_candidate_update_status(uuid[])` is the one exception to
  recipient-scoped `notifications` RLS. It is `SECURITY DEFINER`, restricted to
  staff roles and to applications inside the caller's scoped orgs, and returns
  only `(application_id, notification_id, category, created_at, read_at)` — no
  title, no body, no other recipient's rows
- A recruiter sees only assigned or acted-on work. Filters can narrow the view
  and never widen it: the loader takes `recruiterId` from the session, drops
  out-of-scope filter values silently, and passes both the attention queue
  (`restrictToScope`) and every drill-down (`restrictDrilldowns`) through the
  caller's scoped application set before returning

## Fairness

- **Nationality is never a filter, score, or rank signal.** Tanzania's Employment
  and Labour Relations Act prohibits employment discrimination on nationality and
  covers applicants. `PROHIBITED_FILTER_KEYS` blocks `nationality`,
  `citizenship`, and `national_origin`, and
  `src/lib/kpi/no-nationality.test.ts` reads the KPI source tree so a new module
  cannot reintroduce it
- AI screening, psychometric, and interview-evidence signals stay **advisory**.
  KPI code may summarize and flag; it never auto-rejects, auto-advances, or
  decides employment. The same regression test asserts no KPI module references
  an advance/reject path
