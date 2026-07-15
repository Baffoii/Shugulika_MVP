# Supabase Setup — Run Order

The SQL that sets up the whole database lives in [`supabase/migrations_draft/`](supabase/migrations_draft/).
The architecture that explains it lives in [`docs/database/`](docs/database/).

> **This is a reviewed DRAFT that has not yet been executed against a database.** Run it first on a **fresh Supabase project / staging project**, not production. Do not load real candidate data until the legal gate is cleared — see `docs/database/12-open-decisions-and-risks.md` (OD-1 hosting/residency, OD-6 PDPC/DPO/DPIA).

## How to run in Supabase

Open your Supabase project → **SQL Editor** → paste each file's contents and run them **in this exact order** (each depends on the previous ones). Run one file, confirm it succeeds, then run the next.

| # | File | What it creates |
|---|------|-----------------|
| 1 | `00_extensions_schemas_helpers.sql` | extensions, `private`/`audit` schemas, shared helpers |
| 2 | `01_reference.sql` | reference / lookup / config tables |
| 3 | `02_identity_orgs_rbac.sql` | users, organizations, memberships, roles, permissions |
| 4 | `03_candidate_documents_verification.sql` | candidate profile, documents, verification |
| 5 | `04_employer_billing.sql` | employers, packages, subscriptions, invoices, payments |
| 6 | `05_jobs_consent_applications_submissions.sql` | jobs, consent, applications/pipeline, submissions |
| 7 | `06_interviews_ai.sql` | human interviews + AI video-interview model |
| 8 | `07_offers_comms_notes_audit.sql` | offers/placements, notes/tasks, communications, whistleblowing, audit/compliance |
| 9 | `08_functions_triggers.sql` | helper functions, transition functions, triggers |
| 10 | `09_views_reporting.sql` | dashboard views + materialized views |
| 11 | `10_rls_policies.sql` | Row-Level Security policies |
| 12 | `11_storage.sql` | Storage buckets + storage policies |
| 13 | `12_seed.sql` | reference seed data (Tanzania, roles, packages, etc.) |

**Order matters** because of foreign-key dependencies (e.g. consent is defined before submissions, functions before RLS policies, everything before seed). Running out of order will fail.

## Which docs to read first (for reviewers)
1. `docs/database/README.md` — index of the whole package.
2. `docs/database/01-source-requirements-audit.md` — what was built and the conflicts/decisions.
3. `docs/database/12-open-decisions-and-risks.md` — decisions to make **before** production.
4. `docs/database/07-security-and-rls.md` — security model (review with a security/DPO reviewer).

## Notes / known draft limitations
- RLS file provides canonical policies for core tables; extend the same owning-org pattern to the remaining tables before launch.
- `pg_cron` schedules (materialized-view refresh, retention sweeps) and audit-trigger attachment are shown but not all wired — see `docs/database/13-migration-plan.md` §post-migration.
- Legal/consent text and retention durations in `12_seed.sql` are placeholders pending DPO sign-off.
