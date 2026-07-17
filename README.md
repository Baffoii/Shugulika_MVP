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
> Never put a Supabase service-role/secret key in this app. Nothing here needs it.

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
  archive; job apply flow with **granular, timestamped consent**; applications list with candidate-friendly
  statuses + withdraw; saved jobs; interviews; notifications; settings with **search-visibility** controls.
- **Recruiter portal**: dashboard/KPIs; phase-grouped **pipeline board** over the 15-stage Spine; application
  **workspace** with stage transitions enforcing **mandatory controls** (screening note before Shortlisted;
  rejection requires a reason; consent-gated Client Submission), recruiter notes with visibility scopes, stage
  history timeline, and masked, consent-gated **employer submission** creation. Every change writes stage history
  + audit + a candidate notification.
- **Employer portal**: dashboard; **masked** submission review (identity/contact hidden); decision workflow
  (shortlist / request interview / reject-with-reason) with audit; employer comments. Employers only ever see
  candidates submitted to them (enforced by RLS).
- **Franchise & HQ**: metrics dashboards (RLS-scoped), franchise/employer/job/placement/invoice lists, **audit log**
  viewer (append-only, HQ-only).
- **Cross-cutting**: notifications, activity events, append-only audit log, integration placeholders.
- **Design system**: brand tokens (green on white), reusable UI kit (buttons, cards, badges, tables, forms,
  empty/loading/error states), role-aware sidebar + responsive shell.

## 8. Partially implemented / scaffolded
- Franchise/HQ secondary sections (recruiters, countries, users, reports, company-profile editing) have real
  navigation and honest placeholders rather than fake data.
- Interview scheduling and offers are recorded against applications/submissions but don't yet have dedicated
  full-CRUD screens.
- Watermarked CV previews: the interface and access model exist; documents open via short-lived signed URLs.
  **Files are not falsely labelled as watermarked** — server-side watermarking is integration-pending.

## 9. Placeholders (clearly labelled, no fake results)
AI video interviews · AI question generation / analysis · assessments (TestGorilla/Central Test) · AI CV parsing ·
AI matching · candidate intro videos · WhatsApp (applications/notifications/chat) · SMS OTP · live payments ·
mobile money · recurring billing · accounting sync · social/external job publishing · advanced analytics ·
whistleblowing case management · automated document watermarking. Each has a reserved nav location and a
"Coming soon / Integration pending / Not enabled" card with disabled actions.

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
`vitest` unit tests cover portal-access rules, home routing, **privileged-role restriction**, the 15-stage
model (Advertised/Invoiced/Closed are not candidate stages), gate metadata, and form validation
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
