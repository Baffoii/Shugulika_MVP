# 01 — Source Requirements Audit

**Project:** Shugulika Africa — Pan-African Job Portal, Franchise Platform & ATS
**Artifact:** Supabase/PostgreSQL database architecture for the MVP ("Tanzania Controlled Pilot") built to scale pan-African.
**Audit date:** 2026-07-15
**Author:** Lead database architect (this package)

> This document inventories every source, extracts the requirements that drive database structure, and records conflicts, duplicates, gaps, and recommended resolutions. It is the traceability anchor for the rest of the package (see `11-requirement-traceability-matrix.md`).

---

## 1. Source inventory

| # | Source | Type | Date/Version signal | Status | Main content that drives the schema |
|---|--------|------|---------------------|--------|-------------------------------------|
| S1 | **Shugulika Platform Requirements** (`Shugulika Platform Requirements.docx`) | Requirements brief | Earliest, foundational; pre-dates pilot framing | **Current but high-level / partly superseded on tech** | Two components (Continental Job Portal + Franchise/ATS); multi-tenant per-country; roles; visual pipeline (Applied→Hired); resume parsing; document mgmt (in-system preview only); testing (Pmaps/TestGorilla); video interviews; invoicing (Paystack/Flutterwave/Stripe); notifications (WhatsApp); analytics; "no downloads except super admin"; GDPR/African data laws. |
| S2 | **Build & Execution Plan 2.0** (`Shugulika_Platform_build_plan_2_0_clean.docx`) | Build plan | "2.0 clean" → **most recent consolidated plan** | **Current — authoritative for scope & pipeline** | The 15-stage "Spine"; mandatory controls (screening notes, rejection reasons, consent-before-submission); Path A/B candidate journey; three-phase build; roles table; packages (Tier 1/2/3, "Access to N CVs"); watermark + audit; data-protection, residency & retention considerations. |
| S3 | **Development Proposal** (`Shugulika Project Development Proposal.docx (3).pdf`) | Proposal / tech + legal + cost | Latest, references S1+S2 as "the two source documents" | **Current — authoritative for tech, legal, phasing, vendor-neutrality** | Nine-week Tanzania pilot scope; **AWS-native stack recommendation (RDS/Cognito/S3/KMS) and explicit rejection of managed Supabase (no African region)**; seven separate tenant-private record types; PDPC/DPO/DPIA/cross-border gates; vendor-neutral assessments/video/CV-parsing; whistleblowing as committed pilot feature; payments (Flutterwave/Selcom); WhatsApp as one channel; retention/deletion; Pmaps deferred to Phase 2. |
| S4 | **Candidate Journey** (`Shugulika_Candidate_Journey.pdf`, and `(1)` duplicate) | UX workflow spec | References S2 build plan | **Current** | Modular reusable profile; document library w/ multiple resumes; resume selection vs. resume visibility; profile visibility & searchable fields ("never include" list); 8-step application; **immutable application snapshot**; consent as separate granular choices (incl. WhatsApp opt-in, talent-pool visibility); delayed/optional identity verification & trust signals; candidate-facing status mapping. |
| S5 | **Recruiter Pipeline Workflow** (`Shugulika Prototype 2_...pdf`) | UX workflow spec (Path B) | References S3 proposal & S2 | **Current** | Full 15-stage stage-by-stage field lists; 6 distinct candidate record types; Advertised/Invoiced/Closed are job/placement/accounts milestones not candidate columns; screening scorecard; testing & reference-check fields; **client-submission compliance gate** (candidate-specific consent, snapshot lock, watermarked view-only); offer substates; placement record; rejection reasons list; candidate-facing status; HQ/Accounts/Employer permission model. |
| S6 | **Employer Portal Workflow** (`Shugulika Prototype 3_...pdf`) | UX workflow spec | References S1/S2/S3 | **Current** | Employer registration + company approval; two employer roles (Company Admin, Hiring Team Member); package/entitlement display (literal counts, **not "credits"**); job-order wizard; recruitment-route selection (A/B) locked after applications; job publication lifecycle (Draft→Submitted→Changes/Approved→Active); masked candidate profile (visible vs hidden fields); employer decision/rejection/interview/offer flows; package-gated candidate-pool search with masked results + Request Introduction consent. |
| S7 | **Franchise & HQ Dashboard Workflow** (`Shugulika_Dashboard_Workflow.pdf`) | UX workflow spec | References S2/S3 | **Current** | HQ→country→franchise→recruiter/job→record drill-down; role-based access resolved *before* data returns; recruiter scorecard metrics; continental candidate search (candidate-approved fields only, shows existing-engagement flag); candidate workspace tabs (Shared Profile / Applications / Franchise Record / Client Submissions / Consent & Access); employer-submission flow; placement→invoice→payment drill; team & permission management ("View as this role"); compliance/exception queue; **information-boundary matrix** (HQ/owning franchise/other franchises/employer). |
| S8 | **Prototype ZIPs** (`Shugulika_dashboard_prototype`, `Interactive Job Board Prototype`, `Recruiter ATS Web Application`, `test_proto`) | Clickable HTML prototypes | Same era as S4–S7 | **Current — illustrative, not authoritative** | `.dc.html` static prototypes + screenshots that visualize S4–S7. No independent data model; used to confirm field/label naming. Contain embedded copies of the workflow PDFs. |
| S9 | **Logos** (`shugulika_logo.svg`, wordmark) | Brand asset | — | Reference | Organization-branding storage bucket seed only. |
| S10 | **NDA documents** (`003. SHUGULIKA - NDA*.pdf`) | Legal | — | **Out of scope for schema** | Confidentiality between parties; no data-model requirement. Noted for completeness. |

**Excluded as unrelated:** the Downloads folder also contains many non-Shugulika files (`01-goingviral`, `02-ghosttowns`, `bits_floating_point`, course PDFs, etc.). These are not Shugulika materials and were excluded.

### Duplicates found
- `Shugulika_Candidate_Journey.pdf` and `Shugulika_Candidate_Journey (1).pdf` — **identical content** (same journey spec). Treated as one source (S4).
- The workflow PDFs are also embedded inside the prototype ZIPs' `uploads/` folders — same content, not new requirements.
- Three NDA PDFs (`NDA`, `NDA (1)`, `NDA 2`) — near-duplicates, out of scope.

---

## 2. Extracted requirements (grouped by domain)

Requirement IDs (`R-xxx`) are used throughout the package and in the traceability matrix.

### Identity, organizations, roles
- **R-001** Multi-country, multi-franchise tenancy: HQ, Countries, Franchises, Employers as distinct organizations. (S1, S2, S7)
- **R-002** Roles: Super Admin, HQ Staff (recruiter/accounts/content subroles), Franchise Owner/Country Admin, Franchise Recruiter, Franchise Accounts, Employer (Company Admin + Hiring Team Member), Candidate, Public Visitor. Role assignment must be **scoped to an organization**, not a single field on the user. (S1, S2, S6, S7)
- **R-003** A franchise user must **never** see another franchise's private clients/notes/submissions/invoices/staff; HQ oversight is controlled and audited; access boundary applied *before* data returns. (S2, S3, S5, S7)
- **R-004** "View as this role" preview and permission-exception review for admins. (S7)
- **R-005** Users may be invited; internal & employer onboarding; membership start/end. (S6, S7)

### Candidate global identity vs. franchise-private data
- **R-010** One **global candidate profile** per jobseeker (not one per franchise); candidate-owned; one application history. (S3, S4, S7)
- **R-011** Seven separate record types: global profile, application, franchise engagement record, employer/client record, client submission, consent record, shared search fields. (S3, S5, S7)
- **R-012** Candidate-approved **searchable fields** only enter cross-franchise search; explicit "never include" list (government ID, ID number, private notes, references, rejection reasons, employer feedback, salary discussions, full contact info, applications to other employers). (S4, S7)
- **R-013** Recruiter discovering a global candidate gains **no** access to another franchise's private engagement; processing requires an authorized relationship/consent. (S3, S5, S7)
- **R-014** Modular profile: personal/contact, employment preferences (multi-role), education (incl. non-university/vocational/informal), work experience (incl. volunteer/informal), skills, languages, certifications, licences, projects, memberships, references. (S4)
- **R-015** Profile visibility ("not searchable" vs "discoverable by authorized Shugulika recruiters") separate from document visibility. (S4)
- **R-016** Trust signals separated: mobile-confirmed, profile-complete, identity-verified; no negative "unverified" labels. (S4)
- **R-017** Duplicate-candidate detection / merge; candidate archival, deletion, data-export & correction requests. (task brief C; S3 privacy)

### Documents & media
- **R-020** Document library: multiple CVs (named, versioned), cover letters, IDs, certificates, licences, transcripts, work samples, portfolio, interview recordings/audio/transcripts. (S1, S4, S5)
- **R-021** Files stored outside Postgres (object storage); Postgres keeps secure metadata + access rules; **watermarked, view-only previews**; short-lived, permission-checked, logged access; no ordinary download button (export = Super Admin only). (S1, S2, S3)
- **R-022** Per-document category, ownership, visibility, sharing grants, expiration, verification status, virus-scan/safety status, size/MIME/checksum/version, retention/deletion status. (task brief D; S3)
- **R-023** Resume **selection** at application time is distinct from resume **visibility**; no "visible to all employers" option in pilot. (S4)

### Consent
- **R-030** Consent must be **versioned & auditable**, not booleans on the candidate. Fields: who, what authorized, purpose, org/recipient covered, data covered, policy/notice version, granted-at, expiry, withdrawal, capture method, evidence/metadata, consequences of withdrawal. (S2, S3, S4, S5, S7)
- **R-031** Distinct consent purposes: create/maintain profile; searchable fields; recruiter/franchise processing; **employer-specific submission** (general consent NOT sufficient); share unmasked info; share CV/document; record/process AI video interview; transcribe; AI analysis; cross-border processing; marketing/comms; **future WhatsApp**; guardian/parental consent (if under-18 later allowed). (S2, S3, S4, task brief)
- **R-032** Changing the CV/fields after consent requires **renewed** consent for a submission. (S5)

### Jobs (lifecycle separation)
- **R-040** Separate **job order** lifecycle, **job publication/advertisement** lifecycle, and **job approval** lifecycle from candidate application lifecycle. "Advertised", "Invoiced", "Closed" are job/placement/accounts milestones, not candidate stages. (S2, S5, S6)
- **R-041** Job order fields: title, dept, description, responsibilities, requirements, skills, experience, education, employment type, workplace type, location, country, compensation, currency, benefits, vacancy count, deadline, target start, confidential flag, public/private, hiring org, responsible franchise, assigned recruiters, screening questions, required documents, employer-specific application questions, templates. (S5, S6)
- **R-042** Publication states, advertisement channels, posting **versions**, job status history, closure with reason (filled/partially filled/cancelled/on-hold/reposted/filled externally/closed-without-hire). (S5, S6)
- **R-043** Public Tanzania job board for MVP, extensible to other countries; browse without login; filters (country/city/industry/level/employment type/keyword). (S3, S4)
- **R-044** Job publication approval even for direct-employer jobs (Draft→Submitted to Shugulika→Changes Requested/Approved→Active) to prevent fraudulent/incomplete listings. (S6)

### Path A / Path B routing
- **R-050** Record which path applies, why, who chose it, when, whether route changed. Route changeable while job is a Draft, locked after applications begin. (S2, S6)
- **R-051** Record candidate source: applied directly, recruiter-sourced, referral, controlled import, recruiter-created; whether candidate existed globally before; whether franchise has an authorized processing relationship. (S5, S7)
- **R-052** Path A: application goes straight to employer's hiring team (masked, watermarked, view-only). Path B: routed to assigned recruiter's pipeline at "Applied"; employer first sees candidate at Client Submission. (S2, S4, S5, S6)

### Applications & recruiter pipeline
- **R-060** 15 canonical stages: Advertised → Applied/Sourced → CV Screening → Longlisted → AI Interview Screening → Shortlisted → Screening Interview → Testing → Reference Checks → Client Submission → Client Interview → Offer → Hired → Invoiced → Closed. 12 candidate-board stages (Applied/Sourced…Hired). Configurable per org/country later. (S2, S5)
- **R-061** Every stage change **timestamped & attributed**; append-only stage history feeding KPIs. (S2, S5, S7)
- **R-062** Mandatory controls: cannot pass **Shortlisted** without recorded screening notes; every **rejection requires a reason** (retained per retention schedule); **employer-specific consent** before Client Submission. (S2, S5)
- **R-063** Structured screening record (criteria checklist), screening scorecard (competencies + recommendation), testing record (type/provider/score/threshold/interpretation), reference checks (per-referee, more restrictive than screening notes, never in shared search). (S5)
- **R-064** Sourced candidate ≠ applied ("Sourced – not yet contacted"); preserve entry mode. Duplicate applications, withdrawal, reapplication, hold/paused, reopen-rejected (preserving original rejection event). (S5)
- **R-065** Six distinct record types in candidate workspace: structured screening notes, private internal notes, client-submission summary, reference information, candidate communications, audit history — each with explicit visibility. (S5)
- **R-066** "My Work" action queue: new apps, waiting-for-contact, interviews/tests due, blocked-by-missing-notes, submissions awaiting consent, feedback overdue, offers awaiting response, hires awaiting invoicing, stalled-in-stage. (S5)

### Employer submissions
- **R-070** A submission is a **deliberate, snapshotted** record — never the live global profile. Fields: candidate, job, employer, submitting franchise, submitting recruiter, consent, status, timestamp, profile snapshot, CV version shared, fields shared, masked/unmasked, note, access period, employer views, comments, ratings, interview request, shortlist, rejection, offer, withdrawal, **revocation of access**, version history. (S5, S6, S7)
- **R-071** Submission preserves what the employer was authorized to see at submission time, even if the global profile later changes. (S4 snapshot, S5)
- **R-072** Masked profile: visible fields (ref number, general location, current role, years exp, approved skills, education, availability, consented salary, work auth, application answers, authorized secure CV preview) vs hidden until permitted (full name, email/phone, exact address, ID docs, references, private notes, other employers' feedback, rejection history, franchise-private salary discussions). (S6)

### Interviews (human + AI)
- **R-080** Phone screening, recruiter, employer, live video, in-person, AI-assisted/async video; rounds, panels, scheduling, invitations, candidate confirmation, status, reschedule/cancel/no-show, question sets, scorecards, competencies, interviewer & employer feedback, attachments, recording consent, recording access, outcomes. (S1, S5, S6)
- **R-081** AI interview stage retained in pipeline even if completed manually in pilot; AI score never auto-advances/rejects — one review input only; "Not required" with reason allowed. (S3, S5)
- **R-082** **AI interview architecture (full, even if post-MVP):** templates+versions, job-specific config, competencies, question banks+versions+ordering+follow-ups, prep/response time, retake rules, invitations, secure candidate tokens/sessions, consent, session start/complete, device/browser metadata, per-question video/audio, upload & processing status, transcription + segments + speaker/timestamps, translation (later), redaction, processing errors, model provider/id/version, prompt version, rubric, competency- & question-level scoring, evidence, confidence, integrity/anomaly flags, human review + overrides + reason, final approved evaluation, candidate-facing vs recruiter-facing outputs, AI summary, cost/token metadata, retention & deletion (recording/transcript/model-output), reprocessing history, bias/fairness/quality reviews, audit trail. **Never one JSON blob; AI output never overwrites human decision.** (task brief N; S3)
- **R-083** No facial-expression/emotion/genuineness/cultural-fit scoring in MVP; human review mandatory; job-relevance/fairness/legal review required before affecting hiring. (S3)

### Offers, placements
- **R-090** Offer: version, compensation, currency, benefits, start date, conditions, status substates (Preparing→Sent→Negotiating→Accepted→Declined→Expired), candidate response, employer approval, rejection, withdrawal, expiration. Declined ≠ auto-rejected. (S5, S6)
- **R-091** Placement record on Hire: agreed start, hiring employer, position, final compensation, placement fee arrangement, recruiter responsible, guarantee period, franchise attribution, revenue, replacement/failed placement, history. Auto-creates invoicing task to accounts. (S5, S7)

### Packages, billing, invoices, payments
- **R-100** Packages Tier 1/2/3 (monthly fee), package versions, features, entitlements; per-country pricing; currency; taxes; one-time charges; free-trial (1 free posting/week) with **conditional** auto-activation. (S1, S2, S6, S3)
- **R-101** Entitlement limits: number of active/permitted job postings, candidate-profile/CV access limits, employer user count, candidate-pool search access, reporting/support inclusion, add-ons (per-test). Displayed as **literal usage counts, not abstract "credits"** ("18 of 25 candidate profiles accessed this month"). **Do NOT implement a burnable CV-credit consumption model** unless later approved. (S2, S6, task brief, S3)
- **R-102** Invoices: numbering, currency, line items, tax, issue/due date, paid/unpaid status, payment reference, manual payment recording, payment proof, refund/adjustment/credit, billing contacts, billing history, activation/expiration. Recruiters may view commercial status but not edit invoices unless permitted; HQ sees country/franchise totals, franchise accounts see only own. (S5, S7, S3)
- **R-103** Production recurring/auto-charge NOT an MVP dependency; keep gateway swappable (store provider name/customer ref/txn ref/amount/currency/status/timestamps). (S3)

### Communications & notifications
- **R-110** Channel-neutral model: templates+versions, email, SMS, **future WhatsApp**, in-app notifications, transactional events, recipients (incl. external), delivery attempts/status, provider message id, failure reason, read status, communication preferences (opt-in/out per category+channel), notification categories, scheduled messages, message variables, audit history. **Do NOT implement WhatsApp now**, but include channel/provider/opt-in/delivery metadata so it can be added without restructuring. (S1, S2, S3, S4, task brief P)
- **R-111** Whistleblowing/safeguarding channel: confidential intake form, restricted access, not an ordinary recruiter chat, acknowledgement + case status + basic case management. **Committed pilot feature.** (S2, S3)

### Dashboards & reporting
- **R-120** Role-based dashboards: HQ continent-wide, country, franchise, recruiter KPI, employer, billing, operational/compliance exception queue. Metrics all computed from the **same stage history & invoice records** for comparability. (S1, S7, S3)
- **R-121** Metrics: registrations, profile completion, applications, active jobs, jobs by lifecycle status, candidates by stage, recruiter workload, stage conversion, time-in-stage, time-to (shortlist/submit/interview/offer/placement/fill), placement count & value, rejection reasons, withdrawals, employer activity & package status, invoice & payment status, country/franchise/recruiter performance, consent completion, verification completion, interview completion, AI interview processing status. (S5, S7, task brief Q)

### Audit, privacy, compliance
- **R-130** Append-oriented audit log: actor, org context, action, entity type/id, timestamp, request/correlation id, before/after (where appropriate), IP/UA, automated actions, data exports, sensitive access, profile disclosures, document downloads, employer views, consent changes, permission changes, admin actions. Immutable / tamper-resistant. (S1, S2, S3, S5, S7)
- **R-131** Retention rules; legal holds; soft-delete vs anonymize vs retain vs hard-delete (documented per record); data-subject access/correction/deletion/export requests; cross-border processing records; privacy-policy & terms versions; data-processing purpose; breach/incident references; DPIA references. (S2, S3, task brief R)
- **R-132** Legal gate: no production candidate data until PDPC registration, DPO appointment, DPIA, privacy notice, retention schedule, data-subject procedures, cross-border transfer approval are complete; otherwise synthetic/authorized test data only. (S3)

### Search
- **R-140** PostgreSQL-based candidate & job search (full-text + structured filters + trigram); candidate search restricted to candidate-approved fields & consent/visibility; must not bypass franchise/employer access; optional vector-search extension point for later AI matching (not an MVP dependency). (S1, S3, S7, task brief S)

### Reference / configuration
- **R-150** Reference/config for countries, currencies, languages, industries, skills, education levels, employment types, work arrangements, rejection reasons, pipeline stages, document types, interview types, verification types, notification categories, organization types, role types, permission definitions, consent purposes, status definitions, feature flags, country/franchise config, platform settings. Enums for stable code-coupled sets; lookup tables for admin-configurable sets. (task brief T)

---

## 3. Conflicts and recommended resolutions

| # | Conflict | Sources | Recommended resolution |
|---|----------|---------|------------------------|
| **C-1 — Hosting/Auth stack: AWS vs Supabase** | S3 proposal **recommends AWS-native (Amazon RDS + Cognito + S3 + KMS)** and **explicitly rejects managed Supabase because it has no African region**, which matters for Tanzania PDPC data-residency. The task instruction mandates **Supabase (Auth, Storage, RLS, PostgreSQL)** and to *not* design around AWS. | S3 vs task brief | **Follow the task instruction: design for Supabase.** The relational model, tenant boundaries, consent, and privacy gates are hosting-independent, so the schema is portable. **However this is a genuine, unresolved product/legal conflict:** Supabase's managed regions do not currently include Africa, which directly contradicts S3's data-residency rationale. Recorded as top open decision **OD-1** in `12-open-decisions-and-risks.md`. Options: (a) Supabase self-hosted in an African region (e.g., on AWS Cape Town) to keep Supabase tooling + residency; (b) accept non-African managed Supabase region with a documented cross-border transfer position; (c) revert to AWS-native. The schema supports all three. |
| **C-2 — CV access: "credits" vs literal usage limits** | S2 says "Access to 10/20/30 CVs" (sounds like a consumable quota). S6 says **do not** use abstract "credit" currency — show literal counts ("18 of 25 profiles accessed this month"). S3 says CV-access semantics **must be clarified before implementation**. Task brief: do **not** implement the CV-credit consumption model unless explicitly approved. | S2 vs S6/S3/task | Model entitlements as **usage limits + an access-event ledger** (count of distinct candidate profiles/CVs accessed within a billing period), **not** a burnable credit wallet. Whether access is "distinct profiles per period" vs "per-view decrement" is left configurable and flagged as **OD-2**. No decrement-on-view semantics are hard-coded. |
| **C-3 — Free-trial auto-charge** | S2: after the free week the package is **automatically purchased** (card on file). S3: do **not** promise automatic trial conversion until merchant/cancellation/refund/tax rules are confirmed; recurring auto-charge is post-MVP. | S2 vs S3 | Schema stores **trial status, trial end, scheduled activation intent, and card-on-file reference**, but **auto-charge is not a hard dependency**. Activation can be manual in the pilot. Flagged **OD-3**. |
| **C-4 — Identity verification depth/timing** | S2 onboarding narrative implies OCR + liveness + face-match as part of sign-up. S4 & S3: identity verification is **delayed, optional, and non-biometric in the pilot**; biometric (OCR/liveness/face-match) only Phase 2 after a DPIA. | S2 vs S4/S3 | Verification is modeled as **delayed & optional**, with method types that include future biometric methods (nullable, Phase-2). Account creation requires only phone OTP + optional email. Biometric fields exist but are not mandatory. Flagged **OD-4**. |
| **C-5 — "No downloadable/exportable files at all" vs Super Admin export** | S1: "All data must remain within the system, no downloadable/exportable files to user PCs" **and** "no data downloads by any role **except Super Admin**." | Internal to S1; refined by S3 | Not a true contradiction once read with S3: ordinary users get **watermarked, view-only, short-lived, audited** previews and **no** download; **Super Admin** has an audited export right. S3 notes prevention is **deterrence + traceability**, not absolute (screenshots possible). Model `export` as a Super-Admin-only, fully audited permission. |
| **C-6 — Pmaps** | S1 asks to "check Pmaps integration"; S3 defers Pmaps to Phase 2 and recommends vendor-neutrality. Task brief: **ignore Pmaps; no Pmaps-specific tables/fields**. | S1 vs S3/task | **No Pmaps-specific structures.** Assessment/interview/CV-parsing results are stored in a **vendor-neutral** model (provider name/id + normalized result fields) that can accept TestGorilla, Central Test, a future Shugulika builder, or any provider. |
| **C-7 — WhatsApp now vs later** | S1/S2 mention WhatsApp integration; S4 consent form includes WhatsApp opt-in. Task brief: **do not implement WhatsApp yet**, but be ready. | S1/S2/S4 vs task | Channel-neutral communications model with a `whatsapp` channel value **defined but inactive**; consent purpose + opt-in preference stored now; **no WhatsApp provider wiring** in the schema/functions. |
| **C-8 — CRM / social auto-publishing** | S1 wants CRM integration + auto-publish to LinkedIn/FB/IG/X. S3: no CRM in Phase 1 (store relationship fields in-platform); social auto-publish blocked by platform API access → manual share in pilot. | S1 vs S3 | Store employer/franchise **relationship fields in-platform** (no external CRM tables). Store job **publication channels + share metadata**; treat automated social posting as a later integration, not a schema dependency. |
| **C-9 — Under-18 candidates** | Not decided anywhere; task brief asks to support guardian/parental consent *if later allowed*. | task brief; S3 open item | Schema includes **optional guardian/consent capability and a candidate `date_of_birth`/minor handling**, but under-18 registration policy itself is **OD-5** (recommended default: **disallow under-18 self-registration in MVP**, require age declaration). |

---

## 4. Requirements that cannot be confidently translated into database behavior (open product decisions)

These are carried into `12-open-decisions-and-risks.md` with recommended defaults; they do **not** block the schema (the schema is built to accommodate either resolution).

- **OD-1** Hosting/residency: Supabase (no African managed region) vs AWS Cape Town vs self-hosted Supabase in Africa. (from C-1)
- **OD-2** Exact CV/profile-access consumption semantics (distinct-per-period vs per-view decrement; does viewing a masked profile count vs only unmasking). (from C-2)
- **OD-3** Whether/when recurring auto-charge and automatic trial conversion are enabled. (from C-3)
- **OD-4** Verification depth & when identity verification becomes mandatory per job/stage/country. (from C-4)
- **OD-5** Under-18 policy and guardian-consent flow. (from C-9)
- **OD-6** Data-residency & cross-border transfer legal position (PDPC registration/DPO/DPIA) — a **launch gate**, not a schema blocker. (S3)
- **OD-7** Retention durations per record type (rejection reasons, interview recordings, transcripts, AI outputs, audit logs, consent). Schema stores retention policy; **values** are a legal decision. (S3)
- **OD-8** AI interview vendor(s), model/prompt governance, fairness thresholds, candidate appeal process. (S3)
- **OD-9** Country-specific configuration values (currencies, tax, ID types, work-authorization rules) beyond Tanzania. (S7)
- **OD-10** Whether cross-franchise candidate **transfer/collaboration** is ever permitted, and by what workflow (S3 mentions "approved transfer or collaboration workflow" as the only exception). Schema includes a transfer-grant mechanism; the policy is open.

---

## 5. Notable requirements deliberately preserved despite being deferred/hard

Per the instruction *"do not omit a requirement merely because it appears difficult, deferred, or only partially described,"* the schema fully models:

- **Full AI video-interview pipeline** (Phase 2+) — modeled now (R-082) so it can be added without restructuring.
- **WhatsApp & other channels** — channel-neutral now (R-110).
- **Whistleblowing/safeguarding** — committed pilot feature, restricted-access domain (R-111).
- **Franchise onboarding, paid tenders, labour-mobility toolkit, multi-language, social publishing** — reference/config and content structures reserved (R-043, R-150) without becoming MVP dependencies.
- **Duplicate detection / merge, data-subject requests, legal holds, cross-border records** — modeled (R-017, R-131).

---

## 6. Scope exclusions confirmed
- **No AWS-specific tables/assumptions** (design is Supabase; hosting conflict tracked as OD-1).
- **No Pmaps-specific tables/fields/integrations.**
- **No WhatsApp provider implementation** (channel reserved only).
- **No burnable CV-credit wallet** (usage-limit + access-ledger instead).
- **No automatic recurring billing dependency** (structure extensible only).
- **No AI candidate-matching as an MVP dependency** (vector extension point reserved).
