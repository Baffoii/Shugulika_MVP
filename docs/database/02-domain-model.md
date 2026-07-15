# 02 — Domain Model

This document explains the conceptual architecture: the domains, aggregate roots, ownership/tenant boundaries, the candidate-global-vs-franchise-private split, the employer-access model, the consent model, the workflow model, and the AI-interview model. It is the mental model the physical schema (`04`, `05`, SQL draft) implements.

---

## 0. Guiding architectural principles

1. **One system, three faces** (S2): Continental Job Portal + Franchise Platform + ATS share **one candidate pool** and **one auth system**. The database is the shared spine.
2. **Tenant ownership is explicit on every private record.** Nothing private is "global by default." Every franchise/HQ/employer-private row carries an `owning_organization_id` (and, where relevant, the country). Cross-tenant access is impossible without an explicit grant.
3. **Global candidate identity ≠ franchise-private processing data.** The candidate owns a single global profile; franchises attach *their own* private engagement records to that candidate without seeing each other's.
4. **Job lifecycle ≠ application lifecycle.** Job order, publication, and approval are their own state machines, separate from the candidate application/pipeline state machine.
5. **Current state + immutable history** for every important workflow. The row holds the current status for fast queries; an append-only `*_events` table holds the attributed, timestamped transition history.
6. **Consent and AI outputs are first-class, versioned, and never collapsed** into booleans or JSON blobs.
7. **RLS is the security boundary**, not the application. The relational model is designed so a correct, non-recursive RLS policy exists for every sensitive table.

---

## 1. Schema organization choice

**Decision: a single `public` schema, with descriptive `snake_case` table names grouped by domain prefix-conventions, plus a small number of dedicated schemas for concerns that must be shielded from the API.**

- **Why one primary schema:** Supabase's PostgREST auto-API and its RLS tooling are simplest and safest when application tables live in `public`. Splitting into many exposed schemas multiplies API/grant surface and complicates cross-schema RLS helper functions.
- **Dedicated non-`public` schemas** (not exposed via PostgREST; accessed only through `SECURITY DEFINER` functions or the service role):
  - `private` — RLS **helper functions** (e.g., `current_membership_orgs()`), so policies can't be bypassed and helpers aren't API-callable.
  - `audit` — append-only audit log and immutable history that must never be writable via the API.
  - `reference` *(optional)* — could hold seldom-changing lookups; for pilot simplicity these live in `public` with a `ref_`-style naming and read-only RLS. We keep them in `public` and document them as reference.
- **Naming:** tables are named for their domain and purpose (e.g., `candidate_educations`, `job_orders`, `candidate_submissions`, `ai_interview_model_runs`). Vague names (`data`, `records`, `items`, `details`, `statuses`) are avoided. Lookup tables use a clear plural noun (`countries`, `rejection_reasons`, `pipeline_stages`).

See `07-security-and-rls.md` for how `private` helper functions are secured.

---

## 2. Domain map

The schema is organized into these domains (aggregate roots in **bold**):

| # | Domain | Aggregate roots | Purpose |
|---|--------|-----------------|---------|
| A | **Identity & Access** | `user_profiles`, `service_actors` | Link to `auth.users`; who a user is; system actors |
| B | **Organizations & Membership** | `organizations`, `organization_memberships` | HQ/country/franchise/employer tenants; scoped roles/permissions |
| C | **Reference & Configuration** | lookups, `platform_settings`, `feature_flags` | Stable enums vs admin-configurable values; country/franchise config |
| D | **Candidate Global Identity** | `candidates` | Candidate-owned global profile + modular sub-records + visibility/search |
| E | **Documents & Media** | `documents` | Object-storage metadata, versions, sharing grants, previews, retention |
| F | **Verification** | `verifications` | Email/phone/identity verification, evidence, outcomes, history |
| G | **Employers** | `employer_organizations` (org subtype) | Company profile, teams, verification, notes |
| H | **Packages & Billing** | `packages`, `employer_subscriptions`, `invoices` | Entitlements, usage, invoices, payments, adjustments |
| I | **Jobs** | `job_orders`, `job_postings` | Order lifecycle, publication/advert lifecycle, approval, templates |
| J | **Applications & Pipeline** | `applications` | 12-stage candidate pipeline, screening, scorecards, testing, references, rejections |
| K | **Employer Submissions** | `candidate_submissions` | Deliberate, snapshotted, consent-gated employer disclosure |
| L | **Notes, Activities, Tasks** | `notes`, `tasks`, `activity_events` | Audience-scoped notes; work queue; timeline |
| M | **Interviews (human)** | `interviews` | Scheduling, panels, scorecards, feedback, recording consent |
| N | **AI Video Interviews** | `ai_interview_sessions` (+ template/config/model/eval subgraphs) | Full AI-assisted async interview pipeline |
| O | **Offers & Placements** | `offers`, `placements` | Offer substates, placement record, guarantee, attribution |
| P | **Communications** | `messages`, `message_deliveries` | Channel-neutral templates, delivery, preferences, opt-in |
| Q | **Whistleblowing / Safeguarding** | `safeguarding_cases` | Confidential restricted-access intake & case management |
| R | **Consent** | `consent_records` | Versioned, auditable consent across all purposes |
| S | **Audit, Privacy & Compliance** | `audit.audit_log`, `data_subject_requests` | Immutable audit; retention; legal holds; DSRs; cross-border; legal versions |
| T | **Reporting** | views / materialized views | Dashboard metrics derived from transactional + history tables |
| U | **Search** | `candidate_search_documents`, `job_search_documents` | FTS/trigram indexes honoring consent & visibility |

---

## 3. Tenant & ownership boundaries

### Organization model
`organizations` is the tenant table with an `organization_type` (`hq`, `country_operation`, `franchise`, `employer`, `platform`). Subtype detail lives in dedicated tables so each org type has properly structured fields rather than a wide sparse table:
- `franchise_profiles` (territory, status, franchise owner, agreement)
- `employer_organizations` (legal/trading name, industry, size, verification, package)
- `hq_profiles` (the single HQ / platform org)
- `countries` is **reference data** (not an organization); a `country_operation` org may represent Shugulika's operation within a country where useful, but the pilot primarily uses HQ + one franchise per country.

Organization relationships (e.g., a franchise **operates in** a country; HQ **oversees** a franchise; a franchise **owns the relationship with** an employer) are modeled explicitly (`organization_relationships`, and `employer_organizations.responsible_organization_id`).

### Membership & roles
- `organization_memberships(user_id, organization_id, start/end)` — a user can belong to more than one organization (e.g., an HQ user seconded to help a franchise), satisfying "users belonging to one or more organizations where permitted."
- Roles are **not** a single column on the user. `membership_roles` assigns one or more `roles` to a membership, and `role_permissions` maps roles to `permissions`. This gives org-scoped RBAC.
- Access **scope** is derived from the membership's organization (and its country/type), plus permission flags. HQ-wide oversight is a permission granted to HQ memberships; it is auditable and never implicit for franchises.

### The tenant rule
> A private record belongs to exactly one owning organization. A user may read/write it only if they have a membership (with the right permission) in that organization, **or** an explicit, recorded cross-tenant grant (HQ oversight, or an approved transfer) applies.

This is enforced by (a) a NOT NULL `owning_organization_id` on private tables, (b) FK integrity, and (c) RLS policies calling a `SECURITY DEFINER` helper that returns the caller's authorized org set.

---

## 4. Candidate: global identity vs. franchise-private data

This is the most important boundary in the system. It is realized as **three concentric rings** around one candidate:

```
                 ┌───────────────────────────────────────────────┐
                 │  RING 1 — GLOBAL (candidate-owned)             │
                 │  candidates + modular sub-records              │
                 │  (experience, education, skills, prefs, docs)  │
                 │  visibility & searchable-field controls        │
                 │        ▲ candidate controls disclosure         │
                 │  ┌─────┴──────────────────────────────────┐    │
                 │  │ RING 2 — SHARED SEARCH (opt-in subset)  │    │
                 │  │ candidate_search_documents              │    │
                 │  │ only candidate-approved fields          │    │
                 │  └─────┬──────────────────────────────────┘    │
                 └────────┼───────────────────────────────────────┘
        per-franchise     │        per-employer
   ┌──────────────────────┴───────┐   ┌────────────────────────────┐
   │ RING 3a — FRANCHISE-PRIVATE  │   │ RING 3b — EMPLOYER-FACING   │
   │ candidate_engagements        │   │ candidate_submissions       │
   │ applications (owned)         │   │ + submission_snapshots      │
   │ screening/notes/refs/ratings │   │ (frozen, consent-gated,     │
   │ scoped to owning_org         │   │ masked, view-only)          │
   └──────────────────────────────┘   └────────────────────────────┘
```

- **Ring 1 (Global, candidate-owned):** `candidates` and its modular children. The candidate controls visibility. No franchise "owns" this.
- **Ring 2 (Shared search):** `candidate_search_documents` contains **only** candidate-approved fields (R-012). It powers cross-franchise/continental discovery and the employer candidate-pool search. The "never include" list (government ID, references, private notes, rejection reasons, employer feedback, salary discussions, full contact info, other applications) is enforced by what the trigger writes into this table.
- **Ring 3a (Franchise-private):** `candidate_engagements` (one per candidate × owning franchise/HQ) plus the franchise's `applications`, screening records, notes, references, ratings, interview notes. Every row carries `owning_organization_id`. **Franchise A cannot see Franchise B's Ring 3a** — this is the core isolation guarantee.
- **Ring 3b (Employer-facing):** `candidate_submissions` and their frozen `submission_snapshots`. The employer never touches Rings 1/3a; it sees only a deliberate, consent-gated, masked, snapshotted disclosure.

**A recruiter discovering a global candidate (Ring 1/2) gains no automatic Ring 3a access** to another franchise's engagement, and no ability to process the candidate without a consent record authorizing their organization (R-013).

---

## 5. Employer-access model

Employers are the most restricted actors. Their access derives from exactly three sources, each backed by a row:

1. **A direct application to their own job** (Path A) — `applications` where the job's hiring org is the employer and the job's `recruitment_path='A'`.
2. **A formal submission to them** (Path B) — `candidate_submissions` where `employer_organization_id` = the employer, status is active, and the access period has not been revoked/expired.
3. **A package-gated candidate-pool search hit** they've been granted — masked search results (Ring 2) + a `submission`/introduction request that must obtain employer-specific consent before any unmasking.

Everything the employer sees is **masked by default** (R-072): the visible/hidden field split is enforced by (a) what the submission snapshot contains, (b) RLS on `candidate_submissions`/`submission_snapshots`, and (c) the search index containing only approved fields. Employers **never** see Ring 3a (recruiter notes, other employers' feedback, references, rejection history) and **never** get the live global profile.

Employer team scoping: `employer_organizations` has members with roles `company_admin` (manages company/packages/jobs/team) and `hiring_team_member` (only jobs they're assigned to, via `job_hiring_team`). Offer/rejection authority is a permission on the membership.

---

## 6. Consent model

Consent is a **versioned event ledger**, never booleans on the candidate (R-030).

- `consent_purposes` (reference): profile creation, searchable fields, franchise processing, **employer-specific submission**, share unmasked info, share CV/document, record AI interview, transcribe interview, AI analysis, cross-border processing, marketing/comms, WhatsApp comms, guardian consent.
- `legal_document_versions` (privacy notices, terms, consent texts) — each consent references the exact version shown.
- `consent_records` — the ledger. Each row: subject (candidate/user), granted-by actor, purpose, **covered organization/recipient**, **covered data scope**, legal-document version, method (web form, OTP-confirmed, verbal-recorded, imported), evidence/metadata (JSONB for capture context), granted-at, expires-at, withdrawn-at, withdrawal-effect note.
- **Scoping matters:** employer-specific submission consent references the *specific* `employer_organization_id` (and often the specific job). General registration consent (purpose = franchise processing / talent pool) is explicitly **insufficient** to authorize a client submission (R-031). This is enforced at the submission gate: creating a `candidate_submission` requires a valid, non-withdrawn `consent_record` whose purpose is `employer_submission` and whose covered recipient matches.
- **Withdrawal effects:** withdrawing a consent flips dependent access: `candidate_submissions` referencing a withdrawn consent are moved to `access_revoked`, submission access is cut, and an audit event is written. A DB trigger performs this cascade deterministically (see `06` and `07`).
- **Renewed consent on change (R-032):** if the CV/fields change after consent for a pending submission, the old consent no longer matches the snapshot hash and the submission cannot proceed until a new consent record is captured.

---

## 7. Workflow model (state + history)

Every important workflow follows the same pattern:

- The aggregate row stores the **current** state (`status` / `current_stage_id`) for indexed querying.
- An append-only `*_events` table stores every transition: `from_state`, `to_state`, `actor` (user or service), `occurred_at`, `reason/metadata`, and any mandatory payload (e.g., screening-notes reference, rejection reason).
- Transitions are performed by **stored functions** that (a) validate the allowed transition, (b) enforce mandatory information / blocking gates, (c) write the event, (d) update current state, and (e) emit side-effects (notification events, placement/invoice tasks). This keeps the state machine authoritative in the DB even if multiple clients exist.

State machines modeled (full detail in `06-status-and-workflow-models.md`):
job order · job publication/approval · application (12 candidate stages) · recruiter pipeline sub-states · candidate submission · interview · AI interview processing · offer · placement · invoice · payment · consent · verification.

**Job vs application separation (R-040):** the 15-stage "Spine" is split so that:
- **Advertised** is a *job publication* milestone (`job_postings.status`).
- **Applied/Sourced → Hired** (12 stages) are *application/pipeline* stages (`applications.current_stage_id` + `application_stage_events`).
- **Invoiced** is a *placement/accounts* milestone (`invoices`/`placements`).
- **Closed** is a *job order* milestone (`job_orders.status`), and a job with multiple vacancies can have a Hired candidate while remaining open (R-042/R-060).

---

## 8. AI-interview model

Modeled as **six separable sub-graphs** so that source media, transcription, model execution, generated outputs, human review, and the final decision are independently identifiable, and any AI result is fully reproducible (R-082/R-083). AI output is stored **separately from** human evaluation and never overwrites it.

```
  DEFINITION                         EXECUTION                        DECISION
  ┌───────────────────┐   ┌────────────────────────────┐   ┌───────────────────────┐
  │ ai_interview_      │   │ ai_interview_invitations   │   │ ai_evaluations        │
  │   templates        │   │  → ai_interview_sessions   │   │  (MACHINE output:     │
  │ + template_versions│   │     (consent, device)      │   │   competency & Q-level│
  │ ai_competencies    │   │  → ai_interview_responses  │   │   scores, evidence,   │
  │ ai_question_banks  │   │  → ai_media_assets         │   │   confidence, flags)  │
  │ + ai_questions     │   │     (video/audio, upload,  │   │ ai_integrity_flags    │
  │ + question_versions│   │      processing status)    │   │            │          │
  │ ai_interview_config│   │  → ai_transcripts          │   │            ▼          │
  │  (job-specific)    │   │     + transcript_segments  │   │ ai_human_reviews      │
  └─────────┬──────────┘   │  → ai_model_runs           │   │  (HUMAN override,     │
            │              │     (provider, model id,   │   │   reason, FINAL       │
            └─────────────▶│      model & prompt version│──▶│   approved evaluation)│
   which questions/rubric  │      rubric version, cost) │   │ ai_fairness_reviews   │
   produced a result       └────────────────────────────┘   └───────────────────────┘
```

- **Reproducibility:** any `ai_evaluation` links to the exact `ai_model_run` (provider + model id + model version + prompt version + rubric version) and the exact source `ai_media_asset`/`ai_transcript` and question **versions** it used. You can always answer "which model, prompt, rubric, question version, and recording produced this score."
- **Separation of machine vs human:** `ai_evaluations` (machine) and `ai_human_reviews` (human) are distinct tables. The human review can override; the final approved evaluation is the human one; the machine recommendation is preserved unchanged. An AI score never auto-advances/rejects an application (R-081).
- **Retention/deletion:** `ai_media_assets`, `ai_transcripts`, and `ai_model_runs`/`ai_evaluations` each carry retention & deletion fields so recording, transcript, and model output can be deleted on independent schedules. **Reprocessing** creates a *new* `ai_model_run` (with a new prompt/model/rubric version) rather than mutating the old result (R-082 "AI score regenerated" scenario).
- **Candidate-facing vs recruiter-facing outputs** are distinguished by an `audience` field on generated summaries.

---

## 9. Aggregate boundaries (transaction consistency)

Aggregates that must be updated atomically:
- **Application** = application row + its stage event + any mandatory screening/rejection payload (one transaction via the transition function).
- **Candidate submission** = submission + snapshot + disclosed-document links + consent link (created atomically; the snapshot is immutable thereafter).
- **Placement** = placement row + invoicing task (auto-emitted).
- **AI session** = session + responses + media (media upload is async; session completion is a separate transition).
- **Consent withdrawal** = consent row + cascade to dependent submissions + audit (one function).

Cross-aggregate effects (notifications, KPI refresh) are emitted as events/tasks rather than being part of the same transaction where eventual consistency is acceptable.

---

## 10. What is deliberately *not* an aggregate/root here
- **No single giant `users` table** — identity is `auth.users` + `user_profiles`; roles/scope live in memberships.
- **No single giant `candidates` table** — the candidate is a thin root with modular children and separate franchise-private/employer-facing rings.
- **No generic `status` column reused across unrelated workflows** — each workflow has its own status domain and its own `*_events` history.
- **No single JSON blob for AI results** — six sub-graphs as above.
