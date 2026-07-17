# Testing & CI/CD

This document explains the automated testing and continuous-integration system: what
runs on every pull request, how to run each suite locally, the required secrets, and
the recommended branch-protection rules.

## Toolchain (extends the existing setup — nothing was replaced)

| Concern | Tool | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) + TypeScript | unchanged |
| Package manager | npm (`package-lock.json`) | unchanged |
| Unit / component tests | **Vitest** + Testing Library + jsdom | already present; extended |
| Coverage | **@vitest/coverage-v8** | added, with thresholds |
| Formatting | **Prettier** | added (`format` / `format:check`) |
| Lint | ESLint (`eslint-config-next`) | unchanged |
| Types | `tsc --noEmit` | unchanged |
| DB / RLS tests | **pg** against a throwaway Postgres | added |
| E2E | **Playwright** (Chromium) | added |
| Secret scan | **gitleaks** (CI) + an in-repo source scanner | added |
| SAST | **CodeQL** | added |
| Dependencies | **Dependabot** + `npm audit` | added |

## Scripts

```bash
npm run format         # write Prettier formatting
npm run format:check   # verify formatting (CI)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test           # unit + component (DB/e2e are separate/opt-in)
npm run test:unit      # src/lib/*.test.ts
npm run test:components # src/components/*.test.tsx
npm run test:coverage  # unit + component with coverage thresholds
npm run test:db        # RLS + tenant-isolation tests (needs DATABASE_URL)
npm run test:integration # reserved for API/integration tests (needs DATABASE_URL)
npm run test:e2e       # Playwright smoke (builds + starts the app)
npm run db:verify      # assert schema + types are in sync (needs DATABASE_URL)
npm run validate:env   # environment-variable validation
npm run build          # production build (same command Vercel runs)
npm run ci             # the full fast local gate (format+lint+types+env+coverage+build)
```

## What runs on every pull request (`.github/workflows/ci.yml`)

Staged for early feedback; later stages don't start until fast checks pass where it matters.

1. **static** — `npm ci` (lockfile-consistent), `format:check`, `lint`, `typecheck`, `validate:env`.
2. **unit** — `test:coverage` (unit + component) with enforced thresholds; uploads the coverage artifact.
3. **database** — spins a Postgres 15 service, applies **all migrations to a clean DB**, runs the RLS/tenant-isolation tests and `db:verify`. Runs when migrations, types, or `src` change.
4. **build** — `validate:env` + `next build`; guards against case-only import collisions (Linux/Vercel are case-sensitive).
5. **e2e** — builds the app and runs the Playwright smoke (public pages + the middleware auth gate). Uploads the HTML report/trace/video on failure.
6. **security** — `npm audit` (prod deps, high+), gitleaks secret scan. **CodeQL** runs in a separate workflow.
7. **ci-required** — an aggregation job; make **this** the required status check.

Concurrency is set so a new push to a PR cancels the previous run. `dorny/paths-filter` skips the DB/e2e jobs for doc-only PRs.

## Running the DB / RLS tests locally

These need a **throwaway** Postgres (never point them at production). Two options:

**Docker (simplest):**
```bash
docker run --rm -d --name shug-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=shug_test -p 5432:5432 postgres:15
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/shug_test"
npm run test:db
npm run db:verify
docker rm -f shug-pg
```

**Supabase CLI:**
```bash
supabase start
export DATABASE_URL="$(supabase status -o env | grep DB_URL | cut -d= -f2-)"
npm run test:db
```

The harness (`src/test/db/helpers.ts`) resets the `public` schema, installs a Supabase-compatible
shim (`auth`/`storage` + a JWT-claims `auth.uid()`), applies the **full migration history** in order
(every `00NN_*.sql`, skipping only `0000` — a destructive reset the harness already performs — and
`0005`, which seeds real Supabase `auth.users`/`auth.identities` rows the lightweight shim can't
host), seeds two franchises, and asserts isolation by executing queries as `anon` / each
authenticated user (via `SET ROLE` + `request.jwt.claims`) — exactly how Supabase evaluates RLS.
Because it applies migrations dynamically, new migrations are picked up automatically; a seed-only
migration that writes to `auth.users` with full Supabase columns must be added to the skip list.

## Running e2e locally

```bash
npx playwright install chromium         # once
npm run build
npm run test:e2e                        # smoke (public pages + auth gate)
# Full authenticated flows (needs a configured Supabase + seeded users):
E2E_LIVE=1 npm run test:e2e
```

## Coverage thresholds

Global **75%** (statements/branches/functions/lines) over the security-relevant modules, with stricter
bars for the highest-risk logic:

| Module | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `src/lib/rbac.ts` (authorization) | 95 | 90 | 100 | 95 |
| `src/lib/validation.ts` (input validation) | 85 | 80 | 90 | 85 |
| `src/lib/resume-suggestions.ts` (data mapping) | 85 | 80 | 90 | 85 |

Coverage is scoped to pure, meaningfully-testable modules. Server/DB wiring and RLS are covered by the
**database** suite; UI flows by **e2e** — not by chasing unit-coverage on glue code.

## Required GitHub secrets

The default CI needs **no secrets** — `next build` and the e2e smoke use dummy public values, and the DB
suite uses the ephemeral Postgres service. Optional/advanced:

| Secret | Used by | Required? |
|---|---|---|
| `GITHUB_TOKEN` | gitleaks, CodeQL | provided automatically |
| `E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY` | live e2e against a **test** Supabase | only for `E2E_LIVE` runs |
| `SUPABASE_SERVICE_ROLE_KEY` | seeding auth users for live e2e | **only** in a protected environment, **never** exposed to fork PRs |

**Never** expose `SUPABASE_SERVICE_ROLE_KEY` or database passwords to workflows triggered by forked PRs
(`pull_request` from forks has no access to repo secrets by default — keep it that way). The service-role
key is never printed and never used by the app or the default CI.

## Vercel

- CI runs the **same** `next build` Vercel runs, plus `validate:env`, so build/env failures are caught pre-merge.
- Where Vercel's Git integration is enabled, its **preview deployment** is an additional PR check. We run e2e
  against the **CI-built app** (deterministic) rather than the preview URL; to target a preview instead, set
  `PLAYWRIGHT_BASE_URL` to the preview URL and `E2E_LIVE=1`.
- Vercel env vars: set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Preview +
  Production). `OPENAI_API_KEY` (server-only, for CV parsing) must **not** carry a `NEXT_PUBLIC_` prefix.

## Recommended branch protection (main + develop)

Configure in GitHub → Settings → Branches (documented here; not applied automatically):

- ✅ Require a pull request before merging (≥1 approval; 2 for `main`).
- ✅ Require status checks to pass: **`ci-required`** (and `CodeQL` / `analyze`).
- ✅ Require branches to be up to date before merging.
- ✅ Require conversation resolution before merging.
- ✅ Require review from **Code Owners** (protects `.github/`, `supabase/migrations/`, auth/RLS — see `CODEOWNERS`).
- ✅ Dismiss stale approvals when new commits are pushed.
- ✅ Restrict who can push; **disable force pushes** and branch deletion.
- ✅ Do not allow bypassing the above (include administrators).

## Current coverage & known gaps

**Covered now:** authorization helpers, validation schemas (incl. `fieldErrors` form mapping),
pipeline-stage/status model, formatting, resume field-mapping/confidence, profile completeness, env
access; component rendering/states for job cards, status badges, placeholders, and the job filter bar;
**RLS/tenant isolation** (candidate, recruiter/franchise A↔B, employer submission scope, anon,
forged-insert `WITH CHECK`, and candidate-private **resume parse runs / field suggestions** from
migration 0006); full-migration-history apply + schema/types sync; public + auth-gate e2e;
secret/SAST/dependency scanning.

**Gaps to close next (tracked):**
- Server-action integration tests (apply, stage transitions, submissions) against the DB harness — the
  RLS layer is tested; the action orchestration is currently covered via e2e only.
- Live authenticated e2e per role (behind `E2E_LIVE`) wired into a nightly job with a dedicated test project.
- File-upload edge cases (oversized/corrupt/MIME-mismatch) — needs a storage stub or a Supabase test bucket.
- CV-parse (`src/lib/resume/extract-*`, OpenAI) — mock the provider and test extraction mapping.
- e2e sharding once the suite grows.
