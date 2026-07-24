# Shugulika Database Architecture Package

Complete Supabase/PostgreSQL database architecture for the Shugulika Africa pan-African recruitment platform & ATS MVP ("Tanzania Controlled Pilot"), built to scale pan-African without a rewrite.

## Documents
| File | Contents |
|---|---|
| [01-source-requirements-audit.md](01-source-requirements-audit.md) | Source inventory, extracted requirements (R-xxx), conflicts + resolutions, open decisions |
| [02-domain-model.md](02-domain-model.md) | Domains, aggregate roots, tenant boundaries, candidate rings, consent & AI-interview models |
| [03-entity-relationship-diagram.md](03-entity-relationship-diagram.md) | High-level + per-domain Mermaid ER diagrams |
| [04-data-dictionary.md](04-data-dictionary.md) | Every table: purpose, owner, tenant scope, columns, constraints, access class, retention |
| [05-relationships-and-constraints.md](05-relationships-and-constraints.md) | Cardinalities, FK behavior, uniqueness, state invariants, cross-tenant integrity |
| [06-status-and-workflow-models.md](06-status-and-workflow-models.md) | Every state machine + gates + side-effects + history |
| [07-security-and-rls.md](07-security-and-rls.md) | Role/permission matrix, RLS plan, helper functions, storage security, 15-scenario adversarial review |
| [08-indexes-and-performance.md](08-indexes-and-performance.md) | Index catalogue + query-pattern rationale + partitioning |
| [09-storage-architecture.md](09-storage-architecture.md) | Buckets, paths, signed URLs, watermarking, retention |
| [10-reporting-and-dashboard-views.md](10-reporting-and-dashboard-views.md) | Metric→source map, views vs materialized views, refresh |
| [11-requirement-traceability-matrix.md](11-requirement-traceability-matrix.md) | Every requirement → table/column/RLS/phase (completeness proof) |
| [12-open-decisions-and-risks.md](12-open-decisions-and-risks.md) | Product/legal/technical decisions with recommended defaults |
| [13-migration-plan.md](13-migration-plan.md) | Ordered migration sequence + dependencies + rollback |
| [14-schema-review-checklist.md](14-schema-review-checklist.md) | Pre-implementation verification checklist |
| [15-mvp-pipeline-deviation.md](15-mvp-pipeline-deviation.md) | Approved MVP stage collapses + DB-enforced gate mapping |

Draft SQL: [`../../supabase/migrations_draft/`](../../supabase/migrations_draft/).

## Scope guardrails applied
Supabase (Auth/Storage/RLS/Postgres), **not** AWS. **No** Pmaps. WhatsApp channel-reserved but **not** implemented. AI video interviews fully modeled (may be Phase 2). Vendor-neutral assessments. Usage-limit entitlements, **not** burnable CV credits. No recurring-billing dependency.

## Headline caveat
The schema is implementation-ready, but **deployment is legally gated**: resolve **OD-1 (hosting/residency — Supabase has no African managed region)** and **OD-6 (PDPC/DPO/DPIA/cross-border)** before loading production candidate data.
