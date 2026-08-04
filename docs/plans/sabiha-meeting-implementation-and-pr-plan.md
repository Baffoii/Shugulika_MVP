# Sabiha meeting: implementation, portal, database, and PR plan

Date: 3 August 2026  
Status: proposed delivery plan; no production integration credentials or external-provider access assumed

## Executive recommendation

Build around one rule: Shugulika owns the operational truth. Payments, WhatsApp, email, Zoho Books, Zoho Recruit, and Central Test are adapters around Shugulika; none of them may decide whether an employer can use the product.

The recommended decisions are:

1. Use the official Meta WhatsApp Cloud API directly for approved outbound notifications. Add two-way messaging only after outbound delivery is stable.
2. Use Flutterwave hosted checkout for Tanzania and TZS. Activate access only after a signed webhook is independently verified with Flutterwave.
3. Record payments and entitlement grants atomically in Shugulika, then send accounting records to Zoho Books through an asynchronous outbox.
4. Keep Zoho Recruit as an offline-work and migration satellite. Do not make its candidate cache the long-term employer search database.
5. Do not build a general nationality filter. Tanzania's Employment and Labour Relations Act prohibits employment discrimination on nationality and includes applicants within its protection. Capture job-relevant work authorization instead; permit citizenship restrictions only for a documented legal requirement and after Tanzanian legal review.
6. Keep Central Test behind a provider-neutral assessment boundary. Do not develop the live adapter until Central Test supplies written commercial permission, a sandbox, current API documentation, test catalogues, result-sharing rules, rate limits, webhook behaviour, and support contacts.
7. Give HQ broad operational visibility, but never show provider tokens, webhook secrets, raw payment credentials, or other secrets in any portal.

## Audit coverage and current position

This plan was prepared from the meeting notes, the current application routes, Supabase migrations and policies, database verification tests, the open pull requests and their check results, and the active uncommitted entitlement work.

What already exists and should be reused:

- Five useful portal surfaces: HQ, franchise, recruiter, employer, and candidate.
- A first-party assessment lifecycle, aptitude-test workflow, candidate documents, video interviews, AI CV screening, an AI interview branch, employer onboarding, job orders, applications, offers, placements, notifications, and audit records.
- A substantial recruiter KPI system with targets, workload, stage funnel, conversion, speed, SLA, offer-to-hire, placement, and withdrawal metrics.
- Employer packages, subscriptions, entitlements, invoices, payment records, CV unlocks, and job-slot foundations on the active feature branch.
- Strong organization and franchise scoping in many existing RLS policies.
- A Zoho Recruit satellite foundation with outbox, inbox, reconciliation, mapping, conflict, and operational-control concepts.

What is not yet present:

- No Meta WhatsApp Cloud API integration or multi-channel delivery outbox.
- No Flutterwave payment intent, webhook, verification, or reconciliation implementation.
- No nationality field in the canonical candidate profile or CV parser. This is preferable to adding an unsafe hiring filter.
- No provider-neutral external-assessment order/result/share model for Central Test.
- No candidate self-service assessment report; the current result view is mainly lifecycle status.
- No complete HQ revenue/collections dashboard.
- No staff-created offline job draft that is explicitly approved by the employer before publication.
- No canonical migration/deduplication process that makes Shugulika, rather than the Zoho search cache, the final candidate record.

## Release blockers found during the database audit

These should be fixed before merging or deploying the employer entitlement work.

### 1. Anonymous callers can mint CV credits — fixed

`public.grant_cv_unlock_tokens(...)` was a `SECURITY DEFINER` function with public/default execute access and no caller authorization. A rolled-back database probe as the anonymous role successfully invoked it.

**Correction landed in** `supabase/migrations/20260803120000_harden_employer_entitlements_and_unlocks.sql`:

- Moved `grant_cv_unlock_tokens` and `ensure_cv_unlock_balance` to the `private` schema.
- Revoked `EXECUTE` from `PUBLIC`, `anon`, and `authenticated` on those helpers; only authorized definer wrappers (`activate_employer_package`, `purchase_employer_addon`) call them.
- Locked related entitlement `SECURITY DEFINER` signatures (expire mutations are `service_role` only; client wrappers revoke `PUBLIC`/`anon`).
- Database tests assert `has_function_privilege('anon', ...) = false`, employer users cannot grant credits, and cross-organization direct helper calls fail.
- `ai_cv_screens_used(uuid, timestamptz)` already had an HQ / scoped-org tenant gate (unauthorized returns `0`) plus `PUBLIC`/`anon` revoke from `20260721160000_ai_cv_screening_security.sql`; regression coverage is in the entitlement DB suite.

### 2. The active entitlement work had three failing database tests — fixed

The full migrated schema verified successfully and all public tables had RLS enabled. The entitlement suite failures were contract/fixture issues, now resolved:

- Invalid/inactive Path A jobs are validated before the idempotent already-unlocked return.
- Stale trials are date-gated for access immediately; durable `status = expired` is applied by `expire_employer_entitlements` (in-RPC status updates cannot survive a raised error under Postgres/PostgREST transaction semantics).
- Path A pool search fixtures use `profile_status = 'active'` so `project_employer_pool_candidate` returns rows.

### 3. Sandbox payment gating has two sources of truth

The browser can show payment actions when an environment flag is enabled, while the database RPC accepts only the database feature flag. This can present an enabled button that always fails.

Use one server-computed capability. A safe demo rule is: non-production environment **and** an explicit database sandbox flag. Production must never activate a paid plan without a verified payment record.

### 4. Current entitlement assumptions need business approval

The active work assumes CV unlock credits never expire, an unlocked candidate stays visible organization-wide, and job-slot add-ons last only for the current subscription period. Treat these as pricing-policy decisions for Sabiha/finance, not engineering defaults.

## Target architecture

The application should use four durable boundaries:

1. **Core records:** candidates, employers, jobs, applications, assessments, interviews, invoices, payments, subscriptions, credits, and access.
2. **Outboxes:** append-only instructions for email, WhatsApp, accounting, Zoho Recruit, and other external work.
3. **Provider adapters:** server-only clients that translate an outbox record into a provider request and normalize the response.
4. **Provider event inboxes:** signed, deduplicated webhook records that are verified before changing a core record.

External outages may delay delivery or accounting synchronization; they may not remove already-granted Shugulika access.

## 1. Noreply and transactional email plan

### Intended outcome

Reliable low-touch transactional email, with human replies routed to a Google Workspace group rather than an unattended mailbox.

### Build

- Verify a dedicated sending subdomain with the chosen transactional provider. Use a clear sender such as `Shugulika <noreply@verified-subdomain>`; the exact domain and addresses are business decisions.
- Add a Workspace distribution group for replies and operational ownership. Set `Reply-To` to the relevant group for messages where a reply is useful.
- Keep authentication email separate through Supabase custom SMTP so password reset and account verification are not coupled to recruitment-message code.
- Add a shared notification outbox with channel, template key/version, locale, recipient, core-record reference, deduplication key, scheduled time, state, and attempt count.
- Add delivery-attempt and provider-event tables for accepted, delivered, bounced, complained, suppressed, and failed states.
- Port the useful employer decision templates from PR #24 onto the current mainline; do not merge its stale base directly.
- Start with application receipt, employer job approval request, job approved/published, assessment invitation/reminder/result-ready, interview invitation/reminder, employer decision, invoice/payment receipt, and account-access messages.
- Provide English and Swahili template variants. Keep secure documents, CVs, and assessment results behind expiring authenticated links.
- Add retry with exponential backoff, dead-letter review, a global kill switch, per-template enablement, and a suppression list.

### Data and access rules

- Only trusted server workers can claim/send outbox rows or record provider events.
- Portal users may view delivery status only for records inside their organization scope.
- Provider API keys and webhook secrets remain server-side and are never returned by a page or RPC.

### Acceptance criteria

- A business event creates at most one logical notification for each recipient/template/version.
- A provider timeout can be retried without sending duplicates.
- Bounces and complaints suppress unsafe retries and appear in HQ operations.
- An email-provider outage does not block an application, job approval, payment, or portal login.

## 2. WhatsApp plan

### Intended outcome

Official, approved outbound WhatsApp notifications with portal links and minimal user interaction; two-way conversations are a later add-on.

### Build

- Create/verify the Meta Business Portfolio, WhatsApp Business Account, business phone number, system user, access token, and approved message templates.
- Call the official WhatsApp Cloud API from a server-only adapter. Never place the token, app secret, phone-number ID, or webhook verification value in browser code.
- Reuse the common notification outbox and delivery-attempt model from email. Store the Meta message ID and normalized status without treating it as a core business record.
- Implement signed webhook ingestion, replay protection, raw-event retention, idempotent status updates, and a dead-letter queue.
- Phase 1 templates: application receipt, job-approval request, assessment/interview invitation, deadline reminder, result-ready notice, employer decision, and payment receipt.
- Use a secure portal link for results or candidate data. Do not put a CV, detailed test result, sensitive interview content, or payment secret in WhatsApp.
- Respect opt-in/opt-out and channel preference. If WhatsApp is unavailable or consent is absent, fall back to email and in-app notification.
- Add HQ operational views for template status, delivery rate, failures by reason, queue age, and provider health. Do not expose credentials.

### Later two-way add-on

- Inbound replies should create a controlled conversation/case, not free-form changes to an application.
- Route employers to an assigned franchise/recruiter or central operations queue.
- Define retention, consent, escalation, working hours, attachments, and handoff ownership before enabling it.

### Acceptance criteria

- Only approved templates are sent outside Meta's allowed service window.
- Duplicate webhooks and worker retries cannot duplicate the business action.
- Revoking or rotating a token does not break in-app/email notification delivery.
- A candidate or employer can opt out without losing portal access.

## 3. Billing, Flutterwave, access, and Zoho Books plan

### Intended outcome

Tanzanian employers can pay in TZS through Flutterwave; Shugulika immediately and idempotently records a verified payment and grants access; Zoho Books receives the accounting record afterward.

### Keep and extend

Keep `packages`, `package_entitlements`, `employer_subscriptions`, `invoices`, `invoice_items`, and `payment_records`, subject to the security fixes above. Add:

- `package_prices`: package/add-on, market, currency, amount, tax treatment, effective dates.
- `payment_country_routes`: market/currency to enabled provider and payment methods.
- `employer_payment_intents`: employer, invoice/package/add-on, immutable amount/currency, internal reference, provider reference, expiry, status.
- `payment_provider_events`: raw signed event metadata, digest, provider event/transaction ID, processing state, error.
- `entitlement_grants`: the auditable reason a subscription, job slot, CV credit, assessment, or interview allowance was granted, reversed, or expired.
- `accounting_outbox` and `accounting_sync_attempts`: independent Zoho Books work and retry history.
- `payment_reconciliations`: provider-vs-Shugulika comparison and exception ownership.

### Payment flow

1. The server calculates price, currency, tax metadata, and entitlement; the browser never supplies an authoritative amount.
2. The server creates an immutable intent and Flutterwave hosted-checkout session with a unique internal reference.
3. Flutterwave redirects the user back for experience only. A redirect is not proof of payment.
4. The webhook endpoint validates the HMAC signature, deduplicates the event, and independently verifies transaction status, amount, currency, and internal reference with Flutterwave.
5. One database transaction records the successful payment, closes/updates the invoice, grants the entitlement, and writes the accounting outbox record.
6. A separate worker creates or updates the Zoho Books customer/invoice/payment and saves external IDs. Failures retry without changing employer access.
7. A scheduled reconciliation job queries incomplete/ambiguous provider transactions and surfaces exceptions to HQ.

### Accounting and Tanzania compliance

- Zoho Books is downstream accounting, not the entitlement authority.
- Preserve the useful TRA/VFD questions from PR #38 as a separate finance/legal compliance track. Do not preserve its Selcom provider decision.
- Finance/legal must decide tax-inclusive pricing, fiscal invoice/receipt timing, refund and chargeback treatment, withholding/VAT fields, invoice numbering, and whether a fiscalization failure changes the customer workflow. Even if accounting is delayed, the payment and entitlement ledger must remain internally consistent.
- Every Zoho Books request must be organization-scoped and idempotently mapped to the Shugulika record.

### Refunds and reversals

- Never delete a successful payment. Write reversal/refund records.
- Define whether used CV unlocks, completed tests, posted jobs, and interviews are refundable.
- Revoking future access must be explicit, audited, and independent of Zoho availability.

### Acceptance criteria

- Forged, duplicate, wrong-amount, wrong-currency, and wrong-reference events grant nothing.
- A verified event processed twice produces one payment and one entitlement grant.
- Flutterwave or Zoho downtime cannot corrupt subscriptions or remove existing access.
- HQ can reconcile intents, payments, invoices, entitlements, refunds, and accounting status from one screen.

## 4. HQ portal and KPI plan

### Role

HQ is the network-wide control plane: full authorized business visibility, configuration, assignment, audit, integration health, and financial oversight. “Full access” does not include revealing raw secrets or bypassing audit trails.

### Keep

- Existing HQ dashboard, employer applications, franchises, jobs, placements, recruiters, reports, billing, notifications, AI usage, audit log, countries, users, and integration screens.
- Existing recruiter KPI definitions and target-assignment foundation.

### Revamp

- Add time controls: day, week, month, quarter, year, and custom range; keep a consistent timezone and label comparison periods.
- Add deterministic sorting: newest/oldest and A–Z/Z–A wherever a list is shown.
- Add financial cards: gross collected, refunds, net collected, payment success rate, outstanding invoices, aging buckets, overdue value, and average collection time.
- Add breakdowns by franchise, employer, product/package/add-on, country/market, currency, and payment provider.
- Add operations: active jobs, applications, placements, time to first review, time to submit, time to fill, stale-stage count, open employer approvals, recruiter capacity, test/interview completion, and candidate withdrawal.
- Add recruiter target administration with effective dates, scope, history, and reason for change. Never overwrite historical targets.
- Add integration operations: outbox backlog/age, provider health, webhook failures, reconciliation exceptions, credential expiry indicator, and kill switches. Show masked identifiers only.
- Add data-quality operations: probable duplicate candidates/employers, conflicting external mappings, missing required fields, stale Zoho records, and unresolved merge tasks.
- Add exports that obey the same server-side authorization and filters as the screen.

### Metric governance

Create a metric catalogue containing owner, definition, numerator, denominator, inclusion/exclusion rules, timestamp, timezone, refresh expectation, and drill-down source. Finance must sign off revenue and collection definitions before release.

### Acceptance criteria

- Every KPI can be traced to the underlying scoped records.
- Period comparisons use the same definition and complete-period rules.
- HQ can see all operational organizations but cannot retrieve provider secrets through browser responses.

## 5. Franchise portal and KPI plan

### Role

Each franchise manages only its employer relationships, assigned employer applications, jobs, recruiters, candidates in its work, placements, and attributable finance.

### Keep

- Current franchise dashboard, employer applications, employers, recruiters, candidates, jobs, placements, reports, billing, and settings.
- Existing franchise and organization RLS as the basis for isolation.

### Revamp

- Add the same date-range and alphabetical controls as HQ, but always apply them inside franchise scope.
- Show assigned employer applications by state, age, owner, next action, and SLA.
- Show employer health: active employers, open jobs, recent activity, overdue approvals, stalled vacancies, and repeat placements.
- Show recruiter performance against the target effective for that period: review speed, shortlist quality, submission conversion, interview conversion, offer-to-hire, placements, withdrawals, and SLA breaches.
- Show workload and capacity by recruiter and stage so work can be reassigned.
- Show franchise-attributable collected revenue, outstanding invoices, packages/add-ons, and placement revenue only after finance defines attribution and shared-account rules.
- Allow franchise managers to assign operational targets inside a maximum/approved HQ framework; preserve change history.
- Add drill-downs rather than an external Google Sheet/Data Studio dependency. Use exports only as a convenience.

### Isolation acceptance criteria

- A franchise cannot infer another franchise's employers, candidates, recruiters, revenue, counts, or external identifiers through filters, exports, RPC arguments, or error messages.
- Reassignment changes future access according to an explicit ownership rule and leaves an audit trail.

## 6. Recruiter portal and KPI plan

### Role

The recruiter workspace should turn targets into a prioritized daily queue. The existing KPI implementation is a strong foundation and should be extended, not replaced.

### Keep

- Reviewed applications, workload by stage, stage funnel, time to review/submission/fill, conversion rates, pass rates, offer-to-hire, placement/withdrawal, SLA queue, quality/rejection views, and role assignments.

### Revamp

- Start with “what needs attention”: overdue reviews, expiring interviews/tests, employer approvals, stalled candidates, and missing screening notes.
- Show personal target progress for the selected period, the target version used, and remaining amount/time.
- Add filters for assigned role, employer, job, stage, franchise/HQ scope, and date; support day/week/month/year/custom.
- Make performance cards drill into the exact applications behind the number.
- Add employer-response time and candidate-response time so recruiter delays are not confused with external delays.
- Add candidate-experience guardrails: overdue candidate updates, withdrawal reasons, reschedules, and unanswered messages.
- Keep AI screening, psychometric indicators, and AI interview evidence advisory. They may summarize or flag; they may not auto-reject or make an employment decision.
- Do not expose nationality as a search or ranking filter. Use work authorization and job-location eligibility when relevant.

### Acceptance criteria

- A recruiter sees only assigned/scoped work.
- A KPI remains historically stable when a target is changed later.
- Every flagged SLA has an owner and a next action.

## 7. Candidate portal and progress plan

### Role

The candidate portal should be low-touch and transparent. Candidate “KPIs” should describe their own progress/readiness, not create a hidden employability score or compare them with protected groups.

### Keep

- Profile completion, applications, jobs, saved jobs, documents, assessments, interviews, notifications, settings, and CV parsing/autofill.

### Revamp

- Add a progress home: profile completion, missing fields, active applications, next deadline, pending assessment/interview, messages, and result availability.
- Show an application timeline and the last candidate-visible update. Do not expose internal recruiter notes or other candidates.
- For a self-purchased assessment, show the candidate the full permitted result/report and sharing controls.
- For an employer-paid job assessment, show the candidate the result content allowed by the provider/employer contract and applicable law; at minimum, show completion and transparent sharing status. Do not silently share unrelated results.
- Add explicit result-sharing records: recipient, purpose/job, scope, consent basis, shared time, expiry/revocation, and audit event.
- Make “send CV” a consented, job-scoped action. Never send the raw document in WhatsApp; use a secure portal route.
- Add assessment/interview preparation, supported-device checks, accessibility/help route, reschedule/request-help workflow, and clear deadlines.
- Add data correction and duplicate-account resolution rather than asking candidates to repeatedly re-enter information.

### Acceptance criteria

- A candidate can see what was shared, with whom, for which job, and why.
- A candidate can access a permitted result without depending on Central Test being online at that moment.
- A candidate cannot see employer-only deliberations or another person's records.

## 8. Employer portal plan

### Role

Employers should handle routine/lower-volume recruitment online while Shugulika manages high-value/offline work with deliberate approvals.

### Revamp

- Add server-calculated plans, checkout, invoices, payments, credits, entitlements, and usage history.
- Allow employers to create an online job order and submit it for Shugulika review.
- Allow Shugulika to create an offline/high-value draft linked to an employer; require an authorized employer approval before recruiter publication.
- Add approval request, comments/change request, approved snapshot, approver, timestamp, and later-amendment history.
- Let employers invite job-scoped candidates to approved tests and AI interviews within their entitlements.
- Show completed employer-paid/job-scoped results as soon as they are verified and permitted for sharing; notify rather than requiring manual staff forwarding.
- Keep CV unlock/search against canonical Shugulika candidate records. External Zoho data must first be imported, matched, consent/visibility checked, and deduplicated.
- Add a compact employer funnel: open jobs, applications/submissions, awaiting review, interviews/tests due, offers, hires, approvals due, and subscription usage.

### Acceptance criteria

- An employer cannot publish a role without Shugulika's required review, and a recruiter cannot publish a Shugulika-authored employer role before employer approval.
- An employer sees only its own jobs, candidates submitted/shared for those jobs, purchased entitlements, and authorized search-pool data.

## 9. ATS candidate data, CV parsing, migration, and duplicates

### Canonical model

The canonical candidate profile and documents live in Shugulika. Zoho Recruit records should map to, not replace, those records.

### Build

- Extend the parser pipeline with field provenance, parser version, confidence, extracted time, and candidate-confirmed value. Do not overwrite a confirmed value with lower-confidence extraction.
- Normalize names, phone numbers, email casing, dates, locations, skills, employers, and education before matching.
- Add dedupe candidates with exact and probabilistic signals; never auto-merge on a fuzzy score alone.
- Add a merge-review queue showing side-by-side conflicts, evidence, selected winner for each field, document handling, external mappings, and a reversible/audited merge record.
- Import Zoho candidates in staged batches: inventory, map, dry run, quarantine invalid records, match, human review, canonical upsert, reconcile, and report.
- Store external identifiers in mapping tables, not as the primary application identity.
- Add data-quality metrics: parser coverage, confirmation rate, missing critical fields, duplicate rate, unresolved conflicts, import error rate, and source freshness.

### Nationality and work eligibility

- Do not add an unrestricted nationality search/filter or use nationality in scoring, ranking, recommendations, screening, or KPI comparisons.
- Add candidate-controlled work-authorization/permit fields only where operationally necessary, with purpose, visibility, expiry, and correction controls.
- If a role has a legally mandated citizenship requirement, require a legal basis/reason code, authorized approver, expiry/review date, and audit record. Keep it disabled until Tanzanian counsel approves the exact workflow.
- Retain the existing AI-screening prohibition on considering or inferring nationality and add regression tests.

## 10. Assessment and Central Test plan

### Provider-neutral model

Extend the existing first-party assessment lifecycle rather than writing Central Test fields directly into jobs/applications. Add concepts for:

- assessment products/catalogue and versions;
- provider and delivery mode (`shugulika`, `central_test`, or future provider);
- employer-paid, candidate-paid, or Shugulika-paid order;
- invitation/order, attempt, verified result, report artifact, indicators, and provider event;
- job-purpose linkage and result-sharing grant;
- provider availability and manual reconciliation state.

### Central Test gate

Before development, obtain:

- signed commercial/API permission;
- named test products (limit initial launch to three or four);
- current API and webhook documentation, sandbox credentials, and test candidates;
- allowed storage/caching of scores and reports;
- employer/candidate/Shugulika result-display and redistribution rights;
- data-processing/security terms, retention/deletion rules, support process, rate limits, and outage behaviour.

The publicly discoverable Central Test API guide is dated February 2022, so it is not sufficient authority for a production implementation.

### Product rules

- Candidate-paid/self-service: the candidate receives their permitted result and controls job sharing.
- Employer-paid/job-specific: the employer receives the verified result immediately under the job-specific sharing basis; the candidate receives the transparency/result level agreed in the product and legal policy.
- Offline leadership-team grid: separate product/add-on, restricted to the contracted organization and Shugulika delivery team; do not expose it in the normal online candidate portal.
- Central Test outage: queued orders wait; previously stored permitted results remain visible; core ATS access continues.
- Psychometric/sales/aptitude indicators are decision support, not automatic pass/fail employment decisions.
- Build Shugulika Excel and language tests as first-party catalogue products later, using the same ordering, payment, attempt, result, and sharing model.

## 11. Online/offline job workflow

Replace “approve and immediately publish” with an explicit, source-aware workflow.

Recommended states:

`draft` → `awaiting_employer_approval` or `submitted_to_shugulika` → `changes_requested` → `approved_by_employer` → `approved_by_shugulika` → `scheduled/published` → `paused/closed/cancelled`.

Required fields/events:

- origin: `employer_online` or `shugulika_offline`;
- employer organization and responsible Shugulika organization;
- author, current owner, approval requirements, approved immutable snapshot/hash;
- comments/change requests and every transition actor/time;
- publication time, close reason, and amendment/reapproval rule.

Rules:

- Employer-origin online: employer submits; Shugulika reviews/approves; authorized recruiter publishes.
- Shugulika-origin offline: staff drafts and links employer; employer approves; Shugulika/recruiter publishes.
- A material edit after approval returns the role to the required approval step.
- Notifications are written to the common outbox; a provider outage does not lose the approval task.

## Pull-request disposition

The sequence matters because several open PRs are stacked.

| PR | Recommendation | Required action |
|---|---|---|
| #24 employer decision emails | **Keep concept; rebuild/retarget** | Preserve templates, dedupe, and event triggers. Move onto current main and the shared email outbox; keep human replies through `Reply-To`. Do not merge the stale base directly. |
| #36 AI live interview | **Keep; rebase and review** | Rebase after current foundations, retain feature flag and human-only decisions, then add employer entitlement/invitation and result-sharing rules. |
| #37 WhatsApp/email plan | **Replace; do not merge as written** | It selects Twilio-first. Rewrite for official Meta Cloud API; retain useful consent, template catalogue, outbox, fallback, and operational-monitoring ideas. |
| #38 billing plan | **Replace; do not merge as written** | It selects Selcom checkout and couples the sequence differently. Rewrite for Flutterwave, Shugulika-owned entitlement, Zoho Books async accounting, and a separate TRA/VFD decision track. |
| #39 Zoho Recruit decision | **Keep and merge first** | It aligns with the satellite/source-of-truth direction. Confirm wording that employer search is canonical Shugulika data, not a permanent Zoho cache. |
| #40 Zoho satellite foundation | **Keep after fixing CI** | Retarget/rebase after #39. Resolve its static/required-check failure; retain server-only credentials, field mapping, feature flags, and operational controls. |
| #41 Zoho sync + employer packages | **Do not merge as a monolith; split** | See the four-part split below. Fix the critical function privilege issue and all DB tests first. |
| #42 dev dependency updates | **Keep/merge** | Playwright 1.61.1→1.62.0 and `eslint-config-next` 16.2.11→16.2.12 are bounded updates; rerun full CI after rebasing. |
| #43 CodeQL action | **Keep/merge soon** | Workflow-only patch update; checks are green. |
| #44 production dependency group | **Split** | Merge Supabase, lucide, Next, and Recharts updates after tests. Put OpenAI 6→7 in a dedicated migration PR with API review and AI feature tests. |
| #45 `@types/node` 22→26 | **Defer/close for now** | Keep types aligned with the supported runtime/CI Node line; upgrade runtime, CI, and types together later. |
| #46 jsdom 26→30 | **Close/defer** | Current checks fail and the new major's Node floor does not match the present runtime target. Reopen as a dedicated runtime/test-environment migration. |

### Required split of PR #41

1. **Zoho synchronization:** migrations and code for connections, mappings, outbox/inbox, signed callbacks, reconciliation, conflicts, HQ operations, isolation tests, and documentation.
2. **Employer entitlements:** packages, prices/usage, subscriptions, CV wallet/unlocks, job slots, UI, RPC authorization, and exhaustive cross-tenant/function-privilege tests.
3. **Canonical candidate import/dedupe:** migrate eligible Zoho records into Shugulika candidates with provenance, consent/visibility, conflict review, and external mapping.
4. **Employer candidate search:** query only canonical Shugulika records and reveal fields progressively under plan and CV-unlock rules. Remove direct employer dependence on `zoho_recruit_candidate_search`.

The active branch's commit boundaries already make much of this separation practical: decision/foundation, core sync/reconciliation/ops, employer packages, and Zoho-cache search were added in distinguishable groups.

### Branch cleanup

- Do not merge `docs/gap-analysis-and-workplan` as it stands. It is based on an older point and deletes/reverses parts of the now-merged KPI implementation. Preserve any still-useful narrative by copying it into a current document, then archive/delete the stale branch after review.
- After each replacement PR lands, close superseded #37/#38 and delete their branches.
- Delete already-merged feature branches only after verifying their merge commits are on `main`; this is repository hygiene, not a functional change.
- Never discard the current uncommitted entitlement changes. Move them into the dedicated entitlement/security PR once the failing contracts are resolved.

## Delivery sequence

### Phase 0 — security and decisions

- CV-credit minting privileges are locked; entitlement DB suite is green. Finish payments single-source gating (§3) and commercial decisions (§4).
- Approve package/add-on rules, prices, tax/refund rules, revenue attribution, result-sharing rules, and legal handling of work authorization.
- Merge/rewrite the architecture decision documents (#39, replacements for #37/#38).
- Obtain Meta, Flutterwave, Zoho Books, and email-provider non-production credentials; begin Central Test commercial/API request.

Exit: database security suite green; no ambiguous paid activation path; signed-off product policies.

### Phase 1 — common platform foundations

- Shared notification outbox, email delivery, templates, preferences, audit, retries, and operations.
- Payment-intent/event/entitlement/accounting-outbox schema.
- Canonical candidate provenance/dedupe model.
- Source-aware job approval states.
- Metric catalogue and shared date/sort/filter components.

Exit: foundations work with fake/test adapters and complete RLS/tenant tests.

### Phase 2 — Tanzania launch integrations

- Flutterwave sandbox → verified webhook → entitlement → Zoho Books sandbox.
- Meta WhatsApp outbound templates/webhooks with email/in-app fallback.
- HQ payment, integration, queue, and reconciliation operations.
- Employer billing and approval workflow.

Exit: end-to-end sandbox evidence for duplicate/forged/outage cases and finance acceptance.

### Phase 3 — portal KPI revamps

- HQ financial/network dashboards.
- Franchise isolated performance/finance/capacity dashboard.
- Recruiter action-first target dashboard.
- Candidate progress/results/sharing dashboard.
- Employer funnel, usage, assessments, and AI interview administration.

Exit: metric definitions signed off, drill-down reconciliation passes, accessibility and role tests pass.

### Phase 4 — migration and external assessments

- Staged Zoho candidate migration, dedupe review, and canonical employer search.
- Central Test sandbox adapter only after the partner gate is complete.
- Initial three/four approved tests and offline leadership-grid product.
- Shugulika Excel/language tests later through the same provider-neutral model.

Exit: migration reconciliation signed off; external result rights and outage behaviour proven.

### Phase 5 — optional add-ons

- Two-way WhatsApp employer conversations and operations handoff.
- Additional tests/products.
- Reduced Zoho Recruit dependence and eventual controlled retirement, after record-by-record reconciliation and retention planning.

## Verification checklist for every implementation PR

- Typecheck, unit, lint, build, database, and browser journey checks green.
- RLS enabled and explicit grants reviewed for every new public table/view/function.
- Function execute privileges tested by `anon`, candidate, employer, recruiter, franchise, HQ, and service roles as applicable.
- Cross-organization read/write/RPC/export tests.
- Webhook signature, replay, duplicate, wrong-amount/reference, delayed-event, and retry tests.
- No secret/provider credential in client bundles, page payloads, logs, audit metadata, or error messages.
- Idempotency and outbox recovery tested under worker crash and provider timeout.
- Accessibility, timezone, day/week/month/year/custom filters, deterministic sorting, and empty/error/loading states.
- Audit event for every approval, entitlement change, payment/refund, result share, merge, and privileged override.
- Migration rollback/backfill/reconciliation plan documented before production execution.

## Decisions Sabiha, finance, legal, and partners must supply

1. Package prices, included usage, add-on expiry, credit rollover, and organization-wide unlock policy.
2. Tanzania tax/fiscalization workflow, refund/chargeback policy, and Zoho Books organization/account mapping.
3. Revenue attribution between HQ and franchises, placement vs subscription reporting, and commission visibility.
4. Official sending domain, Google Workspace groups, escalation ownership, supported languages, and message consent/retention.
5. Candidate/employer rights for every assessment type, especially who paid, who sees the report, how long it is retained, and whether sharing is revocable.
6. Exact offline/high-value job approval ownership and what edits require reapproval.
7. Tanzanian legal approval for any work-authorization/citizenship question; no general nationality filter should be launched.
8. Central Test's current written API/commercial package and allowed initial test catalogue.

## Primary external references

- Meta's official WhatsApp Business Platform collection: https://www.postman.com/meta/whatsapp-business-platform/collection/wlk6lh4/whatsapp-cloud-api
- Flutterwave Tanzania mobile-money guide: https://developer.flutterwave.com/v3.0.0/docs/tanzania
- Flutterwave webhook verification guidance: https://developer.flutterwave.com/docs/webhooks
- Zoho Books invoice API: https://www.zoho.com/books/api/v3/invoices/
- Zoho Books customer payments API: https://www.zoho.com/books/api/v3/customer-payments/
- Central Test API guide indexed as February 2022: https://doc.centraltest.com/espnews/pdf/CentralTest_API-UserGuide_v2_28.pdf
- Tanzania Employment and Labour Relations Act (official revised Act): https://oagmis.oag.go.tz/portal/acts/revised/570/download
- Supabase 2026 explicit API grants change: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
