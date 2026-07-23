# Shugulika Africa — MVP web application

A functional MVP of the Shugulika pan-African recruitment platform: a public job board plus
role-separated portals for **candidates, recruiters, employers, franchise admins, and HQ**, built on
**Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Auth, Postgres, Storage, RLS)**.

The database architecture that informs this app lives in [`docs/database/`](docs/database/); this app uses a
focused, app-owned subset of that model in [`supabase/migrations/`](supabase/migrations/).

---

## 1. Prerequisites
- Node.js 20+ and npm
- A Supabase project (URL + **publishable/anon** key). The service-role key is **never** used by this app.

## 2. Environment
```bash
cp .env.example .env.local
```
`.env.local` (git-ignored) must contain the **frontend-safe** values only:
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```
Server-only (never prefix with `NEXT_PUBLIC_`):
```
OPENAI_API_KEY=...                 # enables AI CV parse + screening; omit for free rule-based CV stub
OPENAI_RESUME_MODEL=gpt-4.1-mini   # optional
OPENAI_SCREENING_MODEL=gpt-4.1-mini # optional
OPENAI_PREPAID_BALANCE_USD=10      # optional — HQ AI credits “remaining” estimate
SUPABASE_SERVICE_ROLE_KEY=...      # seed:users + server document preview/export (never browser)
```
> Never put a Supabase service-role/secret key or OpenAI key in any `NEXT_PUBLIC_*` variable.

## 3. Apply the database (Supabase SQL editor)

> **The app schema (`supabase/migrations/`) is a different, app-owned schema from the reference
> architecture in `docs/database/` (`supabase/migrations_draft/`). Do NOT apply both to the same
> project.** If you already ran the `docs/database` draft (or hit
> `ERROR: 42703: column "org_type" does not exist`), run the reset in step 0 first.

**Step 0 (only if needed):** `supabase/migrations/0000_reset_public_schema.sql` — ⚠️ **destructive**;
wipes the `public` schema so the MVP migrations apply on a clean slate. Auth/Storage are untouched.
Run this only on a project with no data you want to keep (e.g. one that only has the reference draft).

Then run these in order in the Supabase **SQL Editor** (or via the Supabase CLI):
1. `supabase/migrations/0001_mvp_schema.sql` — tables, indexes, constraints
2. `supabase/migrations/0002_mvp_rls.sql` — helper functions, RLS policies, grants, `public_jobs`/`apply_targets` views, signup trigger
3. `supabase/migrations/0003_mvp_storage.sql` — `candidate-documents` private bucket + storage policies
4. `supabase/migrations/0004_mvp_seed.sql` — reference data + demo orgs and **3 advertised jobs** (so the public board works immediately)

Continue with every later numbered migration in filename order (including dated `20260721…` /
`20260722…` files). In particular:
- `0016`–`0024` — asynchronous video interview tables, RLS, private recording bucket, analytics,
  demo metadata, and security hardening
- `20260721140000` / `20260721160000` — AI CV screening tables + metering security
- `20260722093000_ai_usage_events.sql` — HQ OpenAI usage ledger (`ai_usage_events`) + HQ read on
  resume parse runs
- `20260722150000_job_assessment_workflow.sql` — employer assessment preferences, private employer
  test uploads, recruiter-to-candidate assignments, audit history, and scoped access policies
- `20260722160000_assessment_lifecycle_hardening.sql` — pass threshold, candidate open/submit RLS,
  assessment notification RPC, grading-boundary columns, lifecycle audit triggers
- `20260722170000_assessment_engine_denial_multifile.sql` — Shugulika grading RPC, multi-file
  employer test + answer-key uploads, job-order denial with mandatory reason

Migrations are additive; do not replace or edit already-applied production migrations.

These were validated end-to-end on PostgreSQL 15 with a Supabase-compatible shim (auth/storage/roles):
the reset + all four apply cleanly (including on top of the conflicting draft), and RLS isolation, the
signup trigger, and confidential-employer masking were runtime-tested.

If the app still shows *"Could not find the table 'public.public_jobs' in the schema cache"* after
applying the SQL, the API's schema cache is stale — run `notify pgrst, 'reload schema';` (0004 does this
automatically) or toggle any table in the Supabase dashboard, then refresh.

**Auth settings:** in Supabase → Authentication, set the Site URL to `http://localhost:3000` and add
`http://localhost:3000/auth/callback` as a redirect URL. For fast local testing you may disable "Confirm email".

## 4. Run
```bash
npm install
npm run dev        # http://localhost:3000
```

## 5. Scripts
```bash
npm run dev        # dev server
npm run build      # production build
npm run start      # serve the build
npm run lint       # ESLint (next/core-web-vitals + strict TS rules)
npm run typecheck  # tsc --noEmit
npm run test       # vitest
```

---

## 6. Creating test users & privileged roles (no service key required)

Candidates and employer users **self-register** at `/auth/sign-up` — a database trigger
(`handle_new_user`) creates their profile, membership, and (for candidates) a candidate profile.
The trigger **clamps** the requested role to `candidate`/`employer_user`, so privileged roles can
never be self-assigned.

Privileged roles (recruiter, franchise_admin, hq_admin, operations, accounts) are **invite-only**.
Provision them from the Supabase SQL editor after the person has signed up:

```sql
-- 1) Find the user id
select id, email from auth.users where email = 'recruiter@example.com';

-- 2) Give them a recruiter membership in the Tanzania franchise (seeded id below)
insert into public.memberships (user_id, organization_id, role, status)
values ('<user-id>', '22222222-2222-2222-2222-222222222222', 'recruiter', 'active');

-- Franchise admin:         role = 'franchise_admin', org = the franchise id
-- HQ admin:                role = 'hq_admin', org = '11111111-1111-1111-1111-111111111111'
-- Employer (to a company): role = 'employer_user', org = an employer org id, e.g.
--   '33333333-3333-3333-3333-333333333333' (Bahari Financial Group)
```
Seeded org ids: HQ `1111…`, Tanzania franchise `2222…`, employers `3333…`/`4444…`.

To see the full flow end-to-end: sign up a candidate, apply to a seeded job, then sign in as a recruiter
(provisioned above) to review the application, add a screening note, and create a consent-gated employer submission.

### Automated provisioning (recommended for demos)

Instead of doing the above by hand, a script creates all six demo accounts (email pre-confirmed) and
assigns their roles:

```bash
# 1) Apply the DB migrations first (§3) so the seeded orgs exist.
# 2) Add your service-role key to .env.local (server-only, never committed):
#    SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard → Settings → API → service_role>
#    (the SEED_*_PASSWORD vars are already in .env.example / .env.local)
npm run seed:users
```

It reads the passwords and the service-role key **from the environment** (never hardcoded) and calls the
Supabase Admin API `auth.admin.createUser({ email, password, email_confirm: true })`, then sets each
account's profile + role membership. It prints a summary (account type · email · landing page · auth
created? · profile+role assigned?). The script is idempotent — safe to re-run.

> The service-role key is used **only** by this local script, server-side. It is never printed, never sent
> to the browser, and never committed. It is not required to run the app itself.

---

## 6b. MVP Test Credentials

> ⚠️ **`12345678` is a deliberately weak, shared testing password for this controlled MVP only.**
> Change every test-account password, or delete these accounts, **before any production deployment.**

Shared password for all accounts below: **`12345678`**

| Account type            | Email                              | Password   | Expected landing page   |
|-------------------------|------------------------------------|------------|-------------------------|
| HQ Administrator        | `hq.admin@shugulika.test`          | `12345678` | `/hq/dashboard`         |
| Franchise Administrator | `franchise.admin@shugulika.test`   | `12345678` | `/franchise/dashboard`  |
| Operations Administrator| `operations.admin@shugulika.test`  | `12345678` | `/franchise/dashboard`  |
| Recruiter               | `recruiter@shugulika.test`         | `12345678` | `/recruiter/dashboard`  |
| Employer User           | `employer@shugulika.test`          | `12345678` | `/employer/dashboard`   |
| Candidate               | `candidate@shugulika.test`         | `12345678` | `/candidate/dashboard`  |

Create them with `npm run seed:users` (see above). Then sign in at `/auth/sign-in` — each account lands on
its portal. Do **not** use this password anywhere real.

---

## 6c. Expanded demo dataset (migration `0015`)

`supabase/migrations/0015_demo_expansion.sql` adds a larger, more realistic demo set on top of the six
accounts above: **2 more recruiters, 4 more employers, 10 more advertised jobs, and 10 candidate accounts**
with populated profiles (skills, experience, education, languages, preferences, search-visibility).

**Apply it** in the Supabase **SQL editor** after `0001`–`0014` (it creates its own Auth users, so
`npm run seed:users` is not needed for these). Every account uses the same shared password **`12345678`**.

### Recruiter accounts (Dar es Salaam franchise → `/recruiter/dashboard`)

| Name        | Email                       | Password   |
|-------------|-----------------------------|------------|
| Peter Jones | `recruiter2@shugulika.test` | `12345678` |
| Susan Clark | `recruiter3@shugulika.test` | `12345678` |

### Candidate accounts (→ `/candidate/dashboard`)

| Name            | Email                             | Password   | Profile focus / city              |
|-----------------|-----------------------------------|------------|-----------------------------------|
| John Smith      | `john.smith@shugulika.test`       | `12345678` | Software Developer · Dar es Salaam|
| Jane Doe        | `jane.doe@shugulika.test`         | `12345678` | IT Support · Dar es Salaam        |
| Michael Johnson | `michael.johnson@shugulika.test`  | `12345678` | Registered Nurse · Arusha         |
| Emily Davis     | `emily.davis@shugulika.test`      | `12345678` | Front Office / Admin · Arusha     |
| David Brown     | `david.brown@shugulika.test`      | `12345678` | Hotel Front Desk · Zanzibar       |
| Sarah Wilson    | `sarah.wilson@shugulika.test`     | `12345678` | Chef · Zanzibar                   |
| James Miller    | `james.miller@shugulika.test`     | `12345678` | Production Supervisor · Mwanza    |
| Mary Taylor     | `mary.taylor@shugulika.test`      | `12345678` | Warehouse / Inventory · Mwanza    |
| Robert Anderson | `robert.anderson@shugulika.test`  | `12345678` | Accountant · Dar es Salaam        |
| Linda Thomas    | `linda.thomas@shugulika.test`     | `12345678` | Logistics / Dispatch · Dar es Salaam |

### Jobs & employers

10 advertised jobs across 6 employers — Kilimanjaro Tech Labs (Software Developer, IT Support Technician),
Uhuru Health Clinic (Registered Nurse, Clinic Receptionist), Zanzibar Coastal Resorts (Hotel Front Desk
Agent, Executive Chef), Tembo Manufacturing (Production Supervisor, Warehouse Assistant), Bahari Financial
Group (Accountant), and Serengeti Logistics (Fleet Dispatch Officer). They appear on the **public job board**
immediately, and (assigned via `job_assignments`) in each recruiter's **Jobs & orders** list.

### How to test each portal

- **Public board** (no login): browse the 10 new jobs at `/jobs`.
- **Recruiter** (`recruiter2` / `recruiter3`): sign in → `/recruiter/dashboard`; their assigned jobs show under
  **Jobs & orders**. Candidates opted into recruiter discovery appear under **Candidates**
  (`/recruiter/candidates`) — search approved fields, open a profile (audited), and source onto a job.
- **Candidate** (any of the 10 above): sign in → `/candidate/dashboard` to see a populated profile, then
  browse/apply to jobs.
- **Employer** (`employer@shugulika.test`): the Bahari Financial Group jobs are visible under its org scope.

> ⚠️ Same weak MVP password (`12345678`). Change or delete these accounts before any production deployment.

---

## 6d. Simplified recruitment pipeline

Candidates move **forward only** through a shorter screening flow:

**Apply → CV Review → Testing → Test Review / Grading → Interview Screening → Interview Review →
(optional) Reference Checks → Client Submission → Offer → Hired**

- New applications start in **CV Review** (not a separate “Applied” stage).
- After Testing or Interview Screening, recruiters mark the step complete and the candidate
  auto-advances to the matching review stage.
- From Testing onward, recruiters can skip ahead to **Client Submission** when ready.
- **Reject** is permanent; the stage they were rejected from is stored for reporting.
- **Client Submission** automatically creates a masked employer CV pack (no separate consent step —
  applying / staying active is enough). Withdrawal removes employer visibility.
- Each stage move writes history + audit and notifies the candidate (via a secure RPC so the
  notification cannot silently fail under RLS).

Legacy stage keys remain in the database for history only; they are not offered as move targets.

---

## 6e. Fake employer logins (migration `0030`)

Every demo employer that paid Shugulika for headhunting has a real `employer_user` login. Jobs stay
linked via `job_orders.employer_org_id`. Seeded **Candidate CV packs** are the end of the pipeline
(what the employer sees after Client Submission).

Shared password for all rows below: **`12345678`** → `/employer/dashboard`.

| Company                     | Email                         | Contact        | Seeded CVs |
|-----------------------------|-------------------------------|----------------|------------|
| Bahari Financial Group      | `employer@shugulika.test`     | Amina Juma     | 2          |
| Serengeti Logistics         | `serengeti@shugulika.test`    | Joseph Mkapa   | 2          |
| Kilimanjaro Tech Labs       | `kilimanjaro@shugulika.test`  | Grace Kimaro   | 1          |
| Uhuru Health Clinic         | `uhuru@shugulika.test`        | Halima Said    | 1          |
| Zanzibar Coastal Resorts    | `zanzibar@shugulika.test`     | Omar Hassan    | 1          |
| Tembo Manufacturing Ltd     | `tembo@shugulika.test`        | Peter Mwanga   | 1          |

How to try it:

1. Sign in as `employer@shugulika.test` (or any row above).
2. Open **Your roles** for that company’s jobs, and **Candidate CVs** for masked packs.
3. From the recruiter portal, move a live application to **Client Submission** — a new pack appears
   automatically for that employer.

Employers only see their own org. They can shortlist / request interview / reject with reason.

> ⚠️ Same weak MVP password (`12345678`). Change or delete these accounts before any production deployment.

---

## 6f. Asynchronous video interviews

The MVP includes a first-party, HireVue-style asynchronous video interview flow without a paid
video, transcription, or AI provider:

- Recruiters create reusable templates, configure question timers/attempts, assign a template from
  an application, review factual response analytics, play private recordings through short-lived
  signed URLs, add internal notes/ratings, and mark an interview reviewed.
- Candidates review the invitation and privacy notice, give explicit consent, test camera and
  microphone, record one timed response at a time, retry within the configured limit, recover a
  failed upload without re-recording while the page remains open, review completion, and submit.
- `navigator.mediaDevices.getUserMedia()` and `MediaRecorder` record at a 720p target with controlled
  bitrate. Supabase Postgres stores metadata and progress; the private `interview-recordings` bucket
  stores files. No permanent public recording URL is stored.
- RLS enforces candidate ownership and franchise isolation. Employers receive no recording access
  under the current product rules. Submitted interviews and completed questions are candidate-locked.
- Analytics are timestamp/count calculations only. The feature does **not** perform transcription,
  facial or emotion analysis, personality analysis, lie detection, suitability scoring, or hiring
  recommendations.

### Setup and demo

1. Apply migrations through `0024_video_interviews_security_fixes.sql`.
2. Sign in as `candidate@shugulika.test` and open `/candidate/interviews` for the seeded invitation.
3. Sign in as `recruiter@shugulika.test` and open `/recruiter/interview-templates` or
   `/recruiter/interviews`. The submitted demo assignment contains metadata only; playback correctly
   reports that its intentionally absent mock file is unavailable.

No new environment variables are required. The browser uses the existing publishable Supabase key;
the application never exposes or uses a service-role key for recording/upload/playback.

### Retention and notifications

Each template/assignment stores `retention_days` (default 180). The HQ-only
`purge_expired_interview_recordings()` function marks expired attempt rows for deletion; an operator
must delete the corresponding Storage objects or connect this function to a future scheduled cleanup
job. Invitations and submission alerts use existing in-app notifications. Transactional email can be
added later behind the notification adapter; no communication vendor is required. The
`interview_deadline_reminder_candidates` view exposes due assignments without repeat reminders, and
`send_interview_deadline_reminder()` writes the existing in-app notification format for a future
scheduler or manual staff action.

### Current limitations

- Recording depends on modern browser MediaRecorder support and HTTPS (localhost is accepted by
  browsers for development). iOS/Safari codec behavior varies, so MIME type is selected at runtime.
- An actively recording clip cannot survive refresh/tab closure. The candidate resumes from the last
  server-completed question and must restart the interrupted attempt.
- Multipart/resumable uploads and scheduled retention deletion are not included. A failed ordinary
  upload is retryable while its local Blob remains in memory.
- No transcript, AI-generated question, automated analysis, or quality inference is implemented.

---

## 7. What's implemented (working, Supabase-backed)
- **Auth**: email/password sign-up, sign-in, sign-out, password reset, email callback, session persistence
  (`@supabase/ssr`), middleware auth gate, role-aware redirects, `/unauthorized` and `/onboarding` states.
- **Role model**: `profiles` + `memberships` (multi-role, org-scoped) — never a single editable role string.
  Route guards per portal + RLS in the database.
- **Public job board**: keyword search + country/type/workplace/level filters, job cards, job detail,
  confidential-employer masking, salary hidden unless the employer marks it public. Reads a safe `public_jobs`
  view (anonymous-safe).
- **Candidate portal**: dashboard with profile-completion checklist; modular profile (personal, experience,
  education, skills); document library with **Supabase Storage** upload, primary-CV selection, signed-URL view,
  archive; **CV autofill** (OpenAI when `OPENAI_API_KEY` is set, otherwise a free rule-based stub) that writes
  reviewable suggestions only — never auto-applies to the profile; if the CV has no professional summary,
  OpenAI can draft a summary + headline for the candidate to accept/edit/reject; job apply flow with
  **granular, timestamped consent**; applications list with candidate-friendly statuses + withdraw/reapply;
  saved jobs; interviews; notifications; settings with **search-visibility** controls.
- **Asynchronous video interviews**: recruiter templates/assignments, immutable question snapshots,
  candidate device test + timed recorder + retry/upload/review flow, private Storage, signed recruiter
  playback, deterministic analytics, internal review notes/ratings, audit events, and notifications.
- **Recruiter portal**: dashboard/KPIs; **candidate directory** (`/recruiter/candidates`) — talent-pool
  search over candidate-approved fields only (skills, location, experience, availability filters),
  audited profile opens, source-to-job with duplicate/reopen handling, and sourced contact states
  (not contacted / contacted / interested / declined); phase-grouped **pipeline board** over the
  simplified candidate flow (CV Review → Testing → Test Review → Interview Screening → Interview Review →
  optional Reference Checks → Client Submission → Offer → Hired); application workspace with forward-only
  stage moves, automatic Test Review / Interview Review transitions, permanent rejection that records the
  stage rejected from, recruiter notes, stage history, **AI CV role-fit screening** (OpenAI; metered against
  employer package entitlements when subscribed; cache-aware), and automatic employer CV pack creation on
  Client Submission. Every change writes stage history + audit + a candidate notification.
- **Assessment delivery**: employers configure aptitude testing on job-order submit (Shugulika,
  employer-provided, or both; junior/senior; default 65% pass threshold). Employer mode requires
  **one or more candidate-facing test files and one or more answer-key files** (private Storage;
  candidates never see answer keys). HQ/franchise can **deny** a submitted job order only with a
  mandatory written reason. Moving a candidate to Testing delivers the assessment; candidates take
  the in-app Shugulika bank at `/candidate/assessments/[id]` (absolute MCQ keys + free-response rubrics for
  OpenAI grading). Staff can view Shugulika answer keys/rubrics and employer answer-key files.
  Low-confidence free-response scores or high AI-writing likelihood require human review before reject.
- **Employer portal**: dashboard; employer job-order submission with scoped HQ/franchise/recruiter
  approval and atomic public publication; per-order audit history showing the actor and timestamp;
  aptitude-test choice (Shugulika, employer-provided, or both) with private PDF/DOC/DOCX/XLS/XLSX/CSV
  upload for employer tests; HQ/recruiter visibility follows the job's organization scope;
  **masked** submission review (identity/contact hidden); decision workflow
  (shortlist / request interview / reject-with-reason) with audit; employer comments. Employers only ever see
  candidates submitted to them (enforced by RLS). Client Submission from the recruiter portal creates that pack
  automatically while the application is active.
- **Franchise & HQ**: metrics dashboards (RLS-scoped), franchise/employer/job/placement/invoice lists, **audit log**
  viewer (append-only, HQ-only), and HQ **AI credits** (`/hq/ai-usage`) — estimated OpenAI spend by purpose
  (CV extraction, summary/headline drafts, role-fit screens) with links to the official OpenAI usage dashboard.
  Requires migration `20260722093000_ai_usage_events.sql`.
- **Cross-cutting**: notifications, activity events, append-only audit log, integration placeholders.
- **Design system**: brand tokens (green on white), reusable UI kit (buttons, cards, badges, tables, forms,
  empty/loading/error states), role-aware sidebar + responsive shell.

## 8. Partially implemented / scaffolded
- Franchise/HQ secondary sections (recruiters, countries, users, reports, company-profile editing) have real
  navigation and honest placeholders rather than fake data.
- Interview scheduling and offers are recorded against applications/submissions but don't yet have dedicated
  full-CRUD screens.
- Watermarked document previews (R-021): CVs, certificates, and employer assessment files open as
  server-generated, per-viewer watermarked PDF previews (candidate / job / employer / viewer /
  timestamp). Original Storage signed URLs are not minted for viewers. Every preview is audited;
  original export is HQ Super Admin only and audited. Requires migration
  `20260723114157_document_watermarked_previews.sql` and `SUPABASE_SERVICE_ROLE_KEY` for employer
  access after Storage hardening.

## 9. Placeholders (clearly labelled, no fake results)
AI interview question generation / analysis · hosted TestGorilla/Central Test (or successor) vendor
integration · **automated reject from AI alone** (blocked by design — low-confidence free-response
requires recruiter review) · AI candidate matching ·
candidate intro videos · WhatsApp (applications/notifications/chat) · SMS OTP · live payments ·
mobile money · recurring billing · accounting sync · social/external job publishing · advanced analytics ·
whistleblowing case management. Each has a reserved nav location and a
"Coming soon / Integration pending / Not enabled" card with disabled actions where applicable.

> **Assessment grading cost estimate**
>
> OpenAI bills by **tokens**, not a fixed “credit per test.” Official standard rates from
> [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) (as of this write-up):
> **gpt-4.1-mini** at **$0.40 / 1M input tokens** and **$1.60 / 1M output tokens**.
>
> Assumptions for a typical ~7-question aptitude set with **2 free-response** answers (~150–250 words
> each). Each FR answer runs **two** OpenAI calls (rubric grade + AI-writing authenticity heuristic):
> - Model: `gpt-4.1-mini`
> - Grading: ~2,500 in + ~600 out ≈ **$0.0020**
> - Authenticity (heuristic, not a dedicated detector API): ~800 in + ~250 out ≈ **$0.0007**
> - **Total ≈ $0.0027 / candidate** · 100 ≈ **$0.27** · 1,000 ≈ **$2.70**
>
> MCQs are graded deterministically (no OpenAI). Low-confidence, borderline, or high AI-writing
> likelihood results set `human_review_required` (review-only — never auto-reject). Usage logs to
> `ai_usage_events` (`assessment_free_response`, `assessment_ai_authenticity`).

> **Not placeholders:** CV autofill (AI or rule-based stub), candidate suggestion review, professional
> summary/headline drafting when a CV has no summary, recruiter AI CV screening, HQ AI usage reporting,
> and **assessment configuration + assignment delivery + Shugulika junior/senior banks with MCQ keys,
> free-response rubrics, OpenAI free-response grading, and AI-writing authenticity checks** (employer upload, auto-deliver on move to Testing,
> candidate take/submit, staff answer-key view, job denial with reason) are implemented. OpenAI features need
> `OPENAI_API_KEY`; without it, CV parse falls back to the free stub, screening is unavailable, and
> free-response aptitude answers are flagged for recruiter review.

## 10. Security notes
- **RLS on every table**; access via non-recursive `SECURITY DEFINER` helper functions. Franchise A cannot see
  Franchise B; employers see only their submissions; candidates see only their own records; anon sees only
  advertised jobs + reference data. Validated at runtime (see §3).
- Privileged roles cannot be self-assigned (trigger clamp + invite-only memberships).
- Private storage bucket; candidate files under their own `{uid}/…` prefix; staff read via a candidate-scoped
  policy; no public URLs for candidate documents.
- Only the publishable key is used client-side; the service-role key is never referenced.

## 11. Unresolved dependencies / decisions
- A live SMS provider (phone OTP), payment provider, assessment/AI/video vendors, and WhatsApp Business are not
  connected — see the placeholders above.
- Data-residency / legal gating (PDPC/DPO/DPIA) from `docs/database/12-open-decisions-and-risks.md` applies before
  loading real candidate data.

## 12. Tests
`vitest` unit tests cover portal-access rules, home routing, **privileged-role restriction**, the simplified
candidate pipeline (forward-only moves, entry stage, terminal rejection), gate metadata, and form validation
(rejection-requires-reason, sign-up role restriction). Run `npm run test`.

## Testing & CI/CD

Automated checks run on every pull request via GitHub Actions
(`.github/workflows/ci.yml`): formatting, lint, type-check, env validation, unit +
component tests with coverage thresholds, **RLS/tenant-isolation tests** against an
ephemeral Postgres, migration + schema/type verification, a production build,
Playwright e2e smoke, and dependency/secret/CodeQL scanning. Make **`ci-required`**
the required status check (see recommended branch protection in
[`docs/testing/TESTING.md`](docs/testing/TESTING.md)).

Common commands:

```bash
npm run ci            # fast local gate: format + lint + types + env + coverage + build
npm run test          # unit + component
npm run test:coverage # + coverage thresholds
npm run test:db       # RLS/isolation tests (needs a throwaway DATABASE_URL — see docs)
npm run test:e2e      # Playwright smoke (public pages + auth gate)
```

Full guide, required secrets, and coverage/gaps: **[`docs/testing/TESTING.md`](docs/testing/TESTING.md)**.

---

## Project layout
```
src/
  app/                  routes: public, auth, candidate, recruiter, employer, franchise, hq
  components/           design system + layout shell + shared page bodies
  lib/
    constants.ts        pipeline stages, statuses, roles, rejection reasons, doc types, placeholders
    rbac.ts             pure role/permission helpers (unit-tested)
    auth.ts             session context + portal guards (server-only)
    validation.ts       Zod schemas
    data/               data-access layer (jobs, candidate, recruiter, staff)
    supabase/           browser + server + middleware clients (@supabase/ssr)
    database.types.ts   hand-authored types matching supabase/migrations
supabase/migrations/    0001 schema · 0002 rls+grants · 0003 storage · 0004 seed
docs/database/          full architecture reference (14 documents)
```
