# 07 — Security & Row-Level Security

RLS is the security boundary. The application never relies on frontend filtering. This document gives the role/permission matrix, the helper-function design, a table-by-table RLS plan, example policies, storage security, and an adversarial review of the 15 required scenarios.

---

## 1. How RLS determines the caller's context

Supabase runs queries as the authenticated role with `auth.uid()` = the caller's `auth.users.id`. All context is derived server-side from that uid — **never** from client-supplied org/role headers (defeats the "franchise staff changes org in the frontend" attack).

Helper functions live in a **private, non-API-exposed** schema and are `SECURITY DEFINER` with a locked `search_path`. They read membership tables and return authorized sets. Policies call them; because they're `SECURITY DEFINER` and not exposed via PostgREST, they can't be bypassed or called directly by clients.

```sql
-- private schema, not exposed to PostgREST; owned by a role that owns the tables
create schema if not exists private;

-- The org set the caller may act within, including approved HQ oversight and transfers.
create or replace function private.authorized_org_ids()
returns setof uuid
language sql stable security definer set search_path = private, public as $$
  -- direct active memberships
  select m.organization_id
  from public.organization_memberships m
  where m.user_id = auth.uid() and m.status = 'active'
        and (m.ends_on is null or m.ends_on >= current_date)
  union
  -- HQ oversight: HQ members may reach franchises via approved oversight relationships
  select r.to_organization_id
  from public.organization_memberships m
  join public.role_permissions rp_join on true  -- (see has_permission)
  join public.organization_relationships r
       on r.from_organization_id = m.organization_id
       and r.relationship_type in ('oversight','transfer_grant')
       and r.status = 'active'
       and (r.valid_until is null or r.valid_until > now())
  where m.user_id = auth.uid() and m.status = 'active'
        and private.has_permission('hq.oversight.read');
$$;

-- Does the caller hold a permission anywhere (optionally within a given org)?
create or replace function private.has_permission(p_key text, p_org uuid default null)
returns boolean
language sql stable security definer set search_path = private, public as $$
  select exists (
    select 1
    from public.organization_memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
    join public.permissions p on p.id = rp.permission_id
    where m.user_id = auth.uid() and m.status='active'
      and p.key = p_key
      and (p_org is null or m.organization_id = p_org)
  );
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = private, public as $$
  select private.has_permission('platform.super_admin');
$$;

-- The candidate row (if any) owned by the caller.
create or replace function private.current_candidate_id()
returns uuid language sql stable security definer set search_path = private, public as $$
  select id from public.candidates where user_id = auth.uid();
$$;
```

**Non-recursion:** helpers query only membership/role/relationship tables. Those tables have **simple** policies (a user sees their own memberships; role/permission tables are readable) that do **not** call the helpers, so there is no policy recursion. This is the key to "avoid unsafe recursive RLS."

---

## 2. Role & permission matrix (summary)

| Role | Scope | Key permissions |
|---|---|---|
| **Super Admin** | platform | everything incl. `platform.super_admin`, `candidate.export`, `audit.read` (all), `config.manage` |
| **HQ Staff (recruiter/accounts/content)** | platform, sub-perms | `hq.oversight.read`, dashboards; recruiter subrole gets pipeline perms scoped via oversight; accounts gets billing read across countries; **no casual candidate browsing** (aggregate default) |
| **Franchise Owner / Country Admin** | own franchise | `team.manage`, `job.*`, `application.*`, `submission.*`, `invoice.read`, `permissions.manage` (own org), "view as role" |
| **Franchise Recruiter** | own franchise | `application.review/advance/reject`, `submission.create/decide`, `interview.manage`, `consent.request`, `document.read` (own engagements) — **cannot** edit invoices, view other franchises, view restricted safeguarding |
| **Franchise Accounts** | own franchise | `invoice.*`, `payment.*`, `placement.read` — **not** screening notes/interview ratings/references, not stage advancement |
| **Employer — Company Admin** | own employer org | manage company/packages/jobs/team, `submission.decide`, `offer.manage`, pool search (if package) |
| **Employer — Hiring Team Member** | assigned jobs | review assigned jobs' applicants/submissions, comment, decide (if granted) |
| **Candidate** | self | own profile/documents/applications/consents/submissions-view/notifications |
| **Public Visitor** | none (anon) | read advertised job postings + public content only |
| **Service role** | system | bypasses RLS (used only by trusted server jobs: notifications, AI evaluation, retention, search indexing) |

Full permission keys are seeded in the `permissions` table (see SQL draft §seed).

---

## 3. Table-by-table RLS plan

Notation: **S/I/U/D** = SELECT/INSERT/UPDATE/DELETE. "own" = via `private.authorized_org_ids()` matching `owning_organization_id`. "candidate" = `private.current_candidate_id()` match. SA always ✔.

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|
| `user_profiles` | self; staff sharing an org | self (via auth trigger) | self (safe cols) | none (soft) | contact never bulk-readable |
| `organizations` | member of / parent / HQ oversight | SA/HQ | SA/HQ, owner (own branding) | none | |
| `organization_memberships` | self; org admins of that org | org admin `team.manage` | org admin | none | **simple policy (no helper) to avoid recursion** |
| `roles`/`permissions`/`role_permissions` | all authenticated (read) | SA | SA | SA | |
| `membership_roles` | self; org admin | org admin `permissions.manage` | org admin | org admin | |
| `candidates` | candidate(own); Fr/HQ **only** where an engagement/application exists or approved-search hit (contact fields masked via column-level views) | candidate self; Fr `candidate.create` | candidate self; Fr limited | none | see masking note |
| `candidate_*` modular | candidate(own); Fr where engagement exists (via `candidate_search_documents` for Ring-2) | candidate self | candidate self | candidate self (cascade anon) | |
| `candidate_visibility` | candidate(own) | candidate | candidate | none | |
| `candidate_search_documents` | Fr/HQ where `is_searchable` and (engagement or `candidate.search`); Emp only via pool-search RPC | service only | service only | service | trigger-maintained; contains only approved fields |
| `candidate_engagements` | own franchise; HQ oversight | own franchise `engagement.create` | own franchise | none | **other franchises ✖** |
| `applications` | own franchise; candidate(own, limited cols); Emp for Path-A own-job (masked view) | own franchise; candidate(self apply RPC) | own franchise | none | |
| `application_stage_events` | own franchise; HQ oversight | via transition fn only (service/definer) | none (append-only) | none | |
| `screening_records`/`scorecards`/`assessment_records` | own franchise; HQ oversight | own franchise | own franchise | none | **Emp ✖** |
| `reference_checks` | own franchise **with `reference.read`** | own franchise `reference.write` | own franchise | none | HQ restricted; Emp ✖ |
| `application_rejections` | own franchise; candidate sees only "Not selected" mapping | own franchise `application.reject` | own franchise (reopen) | none | |
| `candidate_submissions` | submitting franchise; recipient employer (own, active, masked); HQ oversight | submitting franchise `submission.create` | submitting franchise; employer decision cols | none | employer sees only own active |
| `submission_snapshots`/`documents` | as parent | via fn | none (immutable) | none | |
| `documents` | candidate(own); Fr where grant/engagement; Emp via submission grant (preview only) | candidate/Fr | owner | none (retention job) | download needs `document.download` |
| `interviews` | own franchise; Emp (own submission/job); candidate (schedule) | own franchise/Emp | own franchise/Emp | none | recording gated by consent |
| `offers` | own franchise; Emp (own); candidate (offer stage) | own franchise/Emp | own franchise/Emp | none | |
| `placements`/`placement_events` | own franchise; HQ oversight | fn | own franchise accounts | none | |
| `invoices`/`payments` | own franchise accounts; Emp(own); HQ totals | accounts `invoice.issue` | accounts `invoice.edit` | none | recruiters read-only |
| `employer_subscriptions`/usage | Emp(own); responsible Fr/HQ accounts | Fr/HQ | Fr/HQ | none | |
| `consent_records` | candidate(own); Fr covering their org; HQ | candidate; Fr `consent.request` | candidate (withdraw) | none | |
| `ai_*` media/eval | own franchise (via consent); candidate(own, candidate-audience only); service evaluator scoped to session | service/fn | service; human review by Fr | retention job | AI never advances app |
| `notes` | by `visibility` + owning org | author within own org | author | author (soft) | every note audience-scoped |
| `safeguarding_cases` | **`safeguarding.read` only** | intake RPC (any/anon) | safeguarding team | none | recruiters ✖ |
| `messages`/`deliveries` | service; owner limited | service | service | none | |
| `audit.audit_log` | `audit.read` scoped by org; SA all | service/definer triggers only | **none** | **none** | append-only |
| reference tables | all read | `config.manage` | `config.manage` | none | |

**Column-level masking for candidate contact:** employer-facing and cross-franchise reads use dedicated **views** (`candidate_masked_v`, `submission_employer_v`) that expose only approved/snapshot fields; base-table RLS additionally blocks direct access. Employers query the views (exposed via PostgREST), never `candidates` directly.

---

## 4. Example policies

```sql
-- Ring-3a isolation: franchise-private engagement
alter table public.candidate_engagements enable row level security;

create policy engagement_select on public.candidate_engagements
for select using (
  owning_organization_id in (select private.authorized_org_ids())
);
create policy engagement_write on public.candidate_engagements
for insert with check (
  owning_organization_id in (select private.authorized_org_ids())
  and private.has_permission('engagement.create', owning_organization_id)
);

-- Employer sees only its own active, non-revoked submissions
alter table public.candidate_submissions enable row level security;

create policy submission_employer_read on public.candidate_submissions
for select using (
  ( employer_organization_id in (select private.authorized_org_ids())
    and status in ('submitted','viewed','shortlisted','interview_requested','offered','rejected')
    and access_revoked_at is null
    and (access_expires_at is null or access_expires_at > now()) )
  or submitting_organization_id in (select private.authorized_org_ids())   -- franchise side
);

-- Candidate reads only its own consent
create policy consent_candidate on public.consent_records
for select using ( subject_candidate_id = private.current_candidate_id() );

-- Advertised jobs are world-readable (anon)
alter table public.job_postings enable row level security;
create policy posting_public_read on public.job_postings
for select using ( status = 'advertised' );

-- Audit log: read only for oversight, never writable via API
revoke insert, update, delete on audit.audit_log from authenticated, anon;
-- inserts happen only through SECURITY DEFINER audit trigger functions
```

**Service role:** trusted server jobs (notification dispatch, AI evaluation, search-index maintenance, retention) use the Supabase **service_role** key which bypasses RLS. These run only in server-side edge functions / workers, never in the browser. The AI evaluator is additionally constrained by application logic to the single session it is processing (and by a scoped signed token), satisfying scenario 10.

---

## 5. Storage security (summary; full detail in `09`)

- All candidate/employer/interview buckets are **private**. No public bucket holds personal data.
- Storage RLS policies mirror table access: a path like `candidate/{candidate_id}/...` is readable only if the caller is that candidate or has a valid grant (checked via a `storage.foldername`/path function calling `private.*`).
- Employers never receive raw object URLs; they get **watermarked preview** objects via **short-lived signed URLs** minted server-side after a permission + consent check, and every mint is logged (`document_access_grants` + `audit_log`). Guessing a path fails RLS (scenario 11).
- Signed URLs are short-lived; suspended users' sessions are invalidated and new signed URLs are refused because the permission check fails at mint time (scenario 12). Old signed URLs expire quickly; for defense-in-depth, sensitive downloads can require a fresh mint each time.

---

## 6. Adversarial review — the 15 required scenarios

| # | Attack | What stops it |
|---|---|---|
| 1 | Recruiter (Franchise A) reads Franchise B's private notes | `candidate_engagements`/`notes`/`screening_records` RLS: `owning_organization_id ∈ authorized_org_ids()`. B's rows aren't in A's set. No frontend filter involved. |
| 2 | Recruiter discovers a global candidate but has no processing consent | Ring-1/Ring-2 discovery exposes only approved search fields (view). Creating an `application`/`candidate_engagement` and acting requires `has_processing_consent`; the submission gate requires employer-specific consent. No consent → no processing rows. |
| 3 | Employer queries candidates never submitted to it | Employers can't `SELECT` `candidates` directly (RLS deny). They use `submission_employer_v` / pool-search RPC, which only returns submissions to their org or masked opted-in pool hits. No path returns arbitrary candidates. |
| 4 | Employer changes a submission ID in an API request (IDOR) | RLS on `candidate_submissions` requires `employer_organization_id ∈ authorized_org_ids()`. A guessed/other id fails the policy → 0 rows, regardless of the id supplied. |
| 5 | Candidate withdraws employer-submission consent | `after_consent_withdrawn` trigger sets dependent submissions `access_revoked`, revokes document grants, opts out related comms, writes audit + exception. Employer RLS then returns 0 rows (`access_revoked_at` set). |
| 6 | Employer previously viewed a candidate whose access is later revoked | Live access cut immediately (RLS). Historical `submission_snapshots`/`submission_views` remain for audit but are not re-served to the employer once revoked; any cached signed URL expires and re-mint is refused. |
| 7 | Recruiter downloads a CV version not shared with their franchise | `documents`/`document_versions` RLS requires ownership/engagement/grant. A version not granted to the franchise (no `document_access_grants` and no engagement) → deny. Download additionally needs `document.download`. |
| 8 | One candidate in multiple processes across countries | Global candidate (Ring-1) is shared; each franchise's `applications`/engagement is Ring-3a and mutually invisible. Cross-country recruiters see the shared profile (if opted-in) but not each other's engagements/applications. |
| 9 | HQ wants aggregates but shouldn't casually browse sensitive candidate data | Dashboards read materialized aggregates (no row-level PII). Opening an individual private record requires `hq.oversight.read` + generates an audit event; the information-boundary matrix marks candidate application history "Restricted" for HQ (aggregate by default). |
| 10 | AI evaluator accesses recordings outside its authorized job | Evaluator runs as service role but is scoped by (a) a per-session signed token, (b) application logic binding it to one `ai_interview_session`, (c) `ai_media_assets` tied to that session. It never enumerates other sessions. |
| 11 | User guesses a private Storage object path | Storage RLS denies unless caller owns the path or holds a valid grant. Signed URLs are minted only after a server-side permission+consent check. A guessed path returns 403. |
| 12 | Suspended user reuses an old signed URL / active session | `account_status='suspended'` and membership `status='suspended'` remove the user from `authorized_org_ids()`; permission checks fail, so no new signed URL is minted and API queries return nothing. Old signed URLs are short-lived; sensitive assets require fresh mints. Auth session revocation handled at the auth layer. |
| 13 | Franchise staff changes org context in the frontend | There is no client-supplied org context. Context derives from `auth.uid()` via membership tables. Changing anything client-side has no effect on RLS. |
| 14 | Internal user alters immutable audit history | `audit.audit_log` grants no UPDATE/DELETE to `authenticated`/`anon`; inserts happen only via `SECURITY DEFINER` triggers. Even SA edits require a logged break-glass procedure. Partitioned append-only. |
| 15 | AI score regenerated with a different model/prompt | Reprocessing creates a **new** `ai_model_run` (new model/prompt/rubric versions) and a new `ai_evaluation`; prior evaluation is marked `is_superseded` but preserved. The human `ai_human_reviews.is_final` decision is never overwritten. Full lineage answers "which model/prompt/rubric/question/recording produced this." |

---

## 7. Additional hardening

- **Least-privilege service credentials**: separate service keys per worker (notifications vs AI vs retention) if the platform supports it; each only touches its tables.
- **Automated cross-tenant tests** (S3): a test suite asserts, per sensitive table, that a Franchise-A JWT sees zero Franchise-B rows and vice-versa — run in CI (Week 8 in the proposal plan).
- **Definer-function safety**: all `SECURITY DEFINER` functions set an explicit `search_path`, are owned by a non-superuser role that owns the tables, and are not granted EXECUTE to `anon` where not needed.
- **PII minimization in search**: the search projection is the only cross-tenant readable candidate surface and structurally cannot contain restricted fields.
- **Break-glass**: SA exceptional access (export, audit correction) is itself audited (`action='breakglass.*'`) and surfaced to the exception queue.
