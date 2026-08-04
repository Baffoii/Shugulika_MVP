# Integration boundaries architecture

> **Status:** Accepted delivery architecture (documentation)  
> **Date:** 2026-08-04  
> **Companion plan:** [`../plans/sabiha-meeting-implementation-and-pr-plan.md`](../plans/sabiha-meeting-implementation-and-pr-plan.md)  
> **Scope:** Defines four durable boundaries for all provider integrations. Implementation lands in focused follow-up PRs. Production provider integrations remain disabled until verification and operational requirements are complete.

## Executive rule

Shugulika owns the operational truth. External systems may contribute data and receive instructions, but they cannot independently grant or revoke Shugulika access.

## Four durable boundaries

### Boundary 1 — Shugulika core records

Shugulika (Supabase-backed) is authoritative for:

| Domain | Authoritative records |
| --- | --- |
| Identity & tenancy | organizations, memberships, franchise scope |
| Talent | candidates, canonical profiles, documents, visibility, consent |
| Hiring | jobs, approvals, applications, pipeline stages |
| Assessment | assessments, interviews, permitted results, result-sharing |
| Commercial | invoices, verified payments, subscriptions, credits, entitlement grants |
| Access | access decisions, unlocks, package capability |

External systems may stage or project data, but access decisions and entitlement mutations happen only in Shugulika core transactions.

### Boundary 2 — durable outboxes

Outbound work uses a common outbox envelope (provider-specific tables may extend it):

| Field | Purpose |
| --- | --- |
| id | Stable outbox row id |
| channel / provider family | email, whatsapp, payments, accounting, recruitment, assessment |
| event_type + event_version | Versioned instruction catalogue |
| aggregate type + id | Core record the instruction belongs to |
| organization scope | Tenant boundary for ops and RLS |
| immutable payload | Instruction body (no secrets) |
| idempotency / dedupe key | Prevents duplicate provider side effects |
| status | pending, claimed, succeeded, failed, dead_letter, cancelled |
| scheduled / available_at | Backoff and delayed delivery |
| claim / lock time | Worker lease |
| attempt count | Retry accounting |
| last error code / summary | Redacted operational evidence |
| created / processed time | Audit trail |
| trace / correlation id | Cross-system debugging |

**Semantics**

- Business transactions write the core change and outbox instruction atomically when the outbound effect is required for correctness of the product story (for example accounting after verified payment).
- Retry with exponential backoff; permanent failures move to dead-letter.
- Replay and reconciliation are first-class; cancellation is explicit.
- Provider outages never roll back an already-committed core entitlement or access decision.

**Existing mapping (reuse, do not duplicate)**

| Concept | Current artifact | Notes |
| --- | --- | --- |
| Recruitment satellite outbox | `public.zoho_recruit_outbox` | Keep; generalize contracts in TypeScript before inventing a second table |
| Recruitment satellite inbox | `public.zoho_recruit_inbox` | Keep as Zoho-shaped provider-event inbox |
| Generic integration connection | `public.integration_connections` | Legacy/generic; prefer provider-specific connection tables with encryption |
| Audit | `public.audit_logs` | Retain for human-readable product audit; not a substitute for outbox/inbox |

Future email/WhatsApp/payments/accounting outboxes should share the TypeScript envelope and worker claim semantics. Prefer one shared `private`/`integrations` outbox schema only when a second provider needs the same physical table; until then, extend contracts and keep Zoho tables.

### Boundary 3 — server-only provider adapters

Define provider-neutral interfaces for:

- email
- WhatsApp
- payments
- accounting
- recruitment satellite
- external assessments

Adapters translate requests and normalize responses. They must not own product authorization.

Rules:

- All credentials remain server-only (never `NEXT_PUBLIC_`, never browser bundles).
- Implement disabled / no-op / test adapters when credentials or commercial permission are unavailable.
- Feature flags and kill switches fail closed.
- HQ may show masked connection identifiers and health — never tokens, webhook secrets, or raw sensitive payloads.

### Boundary 4 — provider-event inboxes

Inbound provider events must record:

| Field | Purpose |
| --- | --- |
| provider | Provider family |
| provider event id | Vendor-native id when available |
| signature verification state | Authenticated before mutation |
| raw-body digest | Replay / tamper evidence without storing secrets |
| normalized event type / version | Internal catalogue |
| associated internal reference | Payment intent, notification id, mapping id, etc. |
| received / processed time | Audit |
| processing status + attempts + error | Worker state |

Requirements:

- Authenticate / signature-check before business mutation.
- Deduplicate by provider event id and/or digest.
- Independently verify payment facts (never trust browser amount).
- Support replay without duplicate side effects.
- Retain redacted evidence for audit.
- Never expose raw secrets in browser pages or logs.

## System-of-record matrix

| Record | System of record | Satellite / adapter |
| --- | --- | --- |
| Candidate canonical profile | Shugulika | Zoho Recruit projection only after consent/import |
| Employer search pool | Shugulika Path A / directory | Zoho cache is experimental and not canonical |
| Job orders & pipeline | Shugulika | Zoho requisition projection optional |
| Entitlements & unlocks | Shugulika | — |
| Verified payment | Shugulika (after Flutterwave verify) | Flutterwave checkout + webhooks |
| Accounting invoice/payment | Zoho Books (accounting copy) | Driven by Shugulika outbox |
| Notifications | Shugulika notification + outbox | Meta WhatsApp / email providers |
| External assessment results | Shugulika permitted result copy | Central Test only after commercial gate |

## Provider responsibility matrix

| Provider | Responsibility | Must not |
| --- | --- | --- |
| Meta WhatsApp Cloud API | Deliver approved outbound templates; report delivery webhooks | Own consent store; carry sensitive CV/result bodies |
| Email (notification) | Deliver recruitment notifications | Replace auth email config; block core decisions on failure |
| Flutterwave | Hosted checkout TZ/TZS; signed webhooks | Be authoritative for amount without requery; grant entitlements alone |
| Zoho Books | Accounting customer/invoice/payment sync | Revoke portal access on outage |
| Zoho Recruit | Offline satellite sync | Become employer search SoR; expose credentials to browser |
| Central Test | Future external assessments | Be implemented live without written commercial/API permission |

## Core event catalogue (initial)

Versioned event types (extend behind schema validation):

- `notification.email.v1`
- `notification.whatsapp.template.v1`
- `payment.intent.created.v1`
- `payment.verified.v1`
- `accounting.customer.upsert.v1`
- `accounting.invoice.upsert.v1`
- `accounting.payment.upsert.v1`
- `recruitment.zoho.project.v1`
- `recruitment.zoho.reconcile.v1`
- `assessment.external.order.v1` (disabled until Central Test gate)

## Security model

- RLS on every exposed-schema table; private helpers in unexposed schema.
- Revoke default `PUBLIC` execute on privileged functions; grant exact signatures only.
- Prefer `SECURITY INVOKER`; if `SECURITY DEFINER` is required: fixed `search_path`, internal authz, private schema, role tests.
- Tenant-aware policies; HQ/franchise/employer isolation tests required for ops surfaces.
- New public tables are not assumed Data-API exposed; exposure must be explicit.
- Do not modify the Supabase `realtime` schema.

## Data retention and redaction

- Outbox payloads: no secrets, minimize PII, prefer internal ids + template keys.
- Inbox: store digest + redacted normalized event; raw bodies only if encrypted and retention-bounded.
- Logs: never print access tokens, refresh tokens, webhook secrets, card data, or full CV text.
- HQ ops: masked ids only.

## Idempotency strategy

- Deterministic idempotency keys from `(provider_family, event_type, aggregate_id, business_key)`.
- Unique constraints on outbox event id / inbox dedupe key.
- Payment verification grants entitlements once per verified transaction reference.
- Worker claim leases; stale lease reclaim is safe; complete/fail is idempotent.

## Failure and outage behaviour

| Failure | Core behaviour |
| --- | --- |
| Email/WhatsApp provider down | Core decision stands; outbox retries; fallback channel when configured |
| Flutterwave webhook delayed | No entitlement until independent verify succeeds |
| Zoho Books down | Access retained; accounting outbox retries; HQ exception queue |
| Zoho Recruit down | Portal remains usable; satellite sync pauses |
| Worker crash after provider call | Replay uses idempotency; no double grant |

## Feature flags and kill switches

- Provider `*_ENABLED` flags default false in production until verification complete.
- Sync / production-data gates remain off for Zoho until consent/import path exists.
- Employer payments sandbox is a three-way non-production gate only.
- Kill switches must stop workers without deleting core records.

## Operational ownership

| Surface | Owner |
| --- | --- |
| HQ integration ops | HQ platform operators |
| Provider credentials | Server env / secret store only |
| Dead-letter triage | HQ + engineering on-call |
| Commercial provider permission | Business / legal (Central Test, TRA/VFD) |

## Reconciliation paths

- Payments: Flutterwave transaction requery vs Shugulika payment intent.
- Accounting: Zoho Books external ids vs Shugulika invoice/payment.
- Recruitment: Zoho reconcile worker (dry-run first) vs mappings/conflicts.
- Notifications: provider delivery webhooks vs outbox status.

## Migration / backfill strategy

- Prefer additive migrations via `supabase migration new`.
- Never rewrite migrations already applied to shared Supabase projects.
- Backfill outbox/inbox only with explicit idempotency keys.
- Map existing Zoho tables into the shared TypeScript contracts before creating duplicates.

## Rollout and rollback

1. Documentation and contracts (this PR).
2. Shared DB/event foundation + TypeScript workers (disabled adapters).
3. Provider PRs one at a time with flags off.
4. Sandbox verification, then production flag enablement.
5. Rollback = disable flag / kill switch; do not delete core entitlements.

## Central Test partner gate

Do not implement a live adapter until written commercial/API permission, sandbox, current documentation, permitted test catalogue, result-sharing rights, retention terms, rate limits, webhook behaviour, and support ownership are available.

Until then: provider-neutral interface, disabled adapter, feature gate, fixture contract tests that do not claim to represent the live undocumented API.

## Production-readiness checklist

- [ ] Required CI green (format, lint, typecheck, unit, database, security, build, e2e)
- [ ] RLS + privilege + tenant isolation tests for every new table/function
- [ ] No service-role or provider secrets in browser code
- [ ] Disabled-by-default production flags
- [ ] Idempotent webhook replay tests
- [ ] Independent payment verification tests
- [ ] HQ ops shows no raw secrets
- [ ] Runbooks and kill switches documented
- [ ] Commercial/legal gates recorded for Central Test and TRA/VFD
