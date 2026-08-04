# Employer entitlements — commercial decision checklist (PR #41)

**Approvers:** Sabiha / finance  
**Decision date:** 4 August 2026  
**Engineering status:** Commercial rules recorded below; production paid activation remains hard-disabled until verified payment records exist  
**Merge constraint:** Production paid activation stays off (`feature_flags.employer_payments_sandbox_enabled` defaults to `false`, plus app three-way AND). Sandbox/demo grants must not create real paid obligations. Production paid activation may turn on only after real payment verification is implemented.

## Decisions

| Rule | Approved behaviour | Approval status | Decision owner | Decision date | Implementation |
| --- | --- | --- | --- | --- | --- |
| CV unlock credits expire per subscription month | Unspent tokens on grants with `period_ends_on` in the past are burned by `expire_employer_entitlements` (FIFO `remaining` on grants; wallet decremented; auditable `cv_unlock_period_ended` expire rows). Spend still requires an active plan. | approved | Sabiha / finance | 2026-08-04 | `20260804075956_cv_unlock_credits_expire_per_period.sql` |
| Candidate unlocks are organization-wide | `employer_cv_unlocks` unique on `(employer_org_id, candidate_id)`; re-open does not re-spend; Path A `job_order_id` authorizes spend only | approved | Sabiha / finance | 2026-08-04 | Existing schema + spend RPCs (unchanged) |
| Job-slot add-ons end with the subscription period | `job_slot_1` ledger grants use `period_*` + `expired_at`; limit counts current non-expired period only | approved | Sabiha / finance | 2026-08-04 | Existing harden migration (unchanged) |
| Production paid activation | Allowed only after real payment verification is implemented; until then sandbox three-way gate + DB flag default false | approved | Sabiha / finance | 2026-08-04 | Sandbox capability + `employer_payments_sandbox_gate` migration; Flutterwave/webhook work still required |

## Still open (not blocking this checklist)

- Package prices, included usage quantities, tax, and refund rules (including refundability of used unlocks/slots)
- Revenue attribution across franchise / HQ

## Engineering references

- App rules: `src/lib/employer-entitlements.ts`
- Sandbox capability: `buildEmployerPaymentsCapability` / `getEmployerPaymentsCapability`
- SQL hard gate: `employer_open_payments_allowed()`
- Migrations: `20260804075107_employer_payments_sandbox_gate.sql`, `20260804075956_cv_unlock_credits_expire_per_period.sql`
