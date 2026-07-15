# Shugulika — DRAFT SQL schema

> **DRAFT. DO NOT APPLY AUTOMATICALLY.** This is a proposed Supabase/PostgreSQL schema for review, produced from `docs/database/`. It has not been executed against a database. Review with the DPO/security reviewer and resolve the open decisions in `docs/database/12-open-decisions-and-risks.md` (especially OD-1 hosting/residency and OD-6 legal gate) before any production data is loaded.

## Apply order
Run in this order (dependencies noted in `docs/database/13-migration-plan.md`):

1. `00_extensions_schemas_helpers.sql`
2. `01_reference.sql`
3. `02_identity_orgs_rbac.sql`
4. `03_candidate_documents_verification.sql`
5. `04_employer_billing.sql`
6. `05_jobs_consent_applications_submissions.sql` *(consent defined before submissions)*
7. `06_interviews_ai.sql`
8. `07_offers_comms_notes_audit.sql`
9. `08_functions_triggers.sql`
10. `09_views_reporting.sql`
11. `10_rls_policies.sql`
12. `11_storage.sql`
13. `12_seed.sql`

## Conventions
- `uuid` PKs (`gen_random_uuid()`); high-volume append logs use `bigint identity`.
- `timestamptz` everywhere; `created_at`/`updated_at` (+ `set_updated_at` trigger) on mutable tables.
- Explicit FK delete behavior (mostly `RESTRICT`; `CASCADE` only for owned children); see `docs/database/05`.
- RLS deny-by-default; policies call non-recursive `private.*` `SECURITY DEFINER` helpers.
- Files/media in Supabase Storage; Postgres holds metadata + access rules only.

## Known draft limitations (intentional)
- RLS file gives canonical policies for core tables; the same owning-org pattern must be extended to the remaining Ring-3a / billing / interview / AI tables before launch.
- Audit triggers (`private.write_audit`) are defined but attached only by example — attach to all sensitive tables listed in `08`.
- `pg_cron` schedules for MV refresh / retention sweeps / overdue-invoice sweeps are shown commented; enable in the server context.
- Rolling `audit.audit_log` partitions need a monthly creation job (two initial partitions seeded).
- Legal/consent text and retention durations are placeholders pending DPO sign-off (OD-7).
