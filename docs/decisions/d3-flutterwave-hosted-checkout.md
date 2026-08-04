# D-3 — Payments: Flutterwave hosted checkout (replaces Selcom-first plan)

> **Status:** Proposed replacement decision  
> **Supersedes:** PR #38 / `docs/zoho-books-tra-vfd-selcom-plan` Selcom checkout path  
> **Date:** 2026-08-04  
> **Scope:** Architecture decision only; production paid activation stays disabled until end-to-end verification.

## Decision

Use **Flutterwave hosted checkout** for Tanzania / TZS.

Required flow:

1. Browser never authoritative for amount.
2. Create an immutable internal payment intent in Shugulika.
3. Validate signed Flutterwave webhook (Boundary 4).
4. Independently requery/verify status, amount, currency, transaction reference, and employer/payment intent.
5. One transaction records verified payment, entitlement grant, and accounting outbox instruction atomically in Shugulika.
6. Asynchronous Zoho Books accounting outbox (Boundary 2/3).
7. Provider/accounting outages cannot revoke existing access.
8. TRA/VFD remains a separate finance/legal compliance track.

## Rejection rules

Duplicate, forged, wrong-amount, wrong-currency, or wrong-reference events grant nothing.

## Why replace Selcom-first checkout

Product direction is Flutterwave for TZ/TZS hosted checkout with independent verification before entitlement grant. Zoho Books remains accounting-only; it is not the access control plane.

## Non-negotiables

- Production activation disabled until sandbox + security review pass.
- Entitlement helpers remain private; ordinary employers cannot grant credits.
- Three-way non-production sandbox gate may demo UX only; never production paid activation without verified payment.

## Rollout

1. Payment intent schema + disabled Flutterwave adapter.
2. Sandbox checkout + webhook + requery tests.
3. Atomic grant + Zoho Books outbox.
4. HQ exception / reconciliation views.
5. Production flag only after checklist in `docs/architecture/integration-boundaries.md`.
