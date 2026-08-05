# ATS §9 — candidate data, provenance, dedupe, and merge

What this workstream added, and the rules each piece exists to enforce.

Canonical candidate data stays `candidate_profiles` and its children. Everything
below feeds those records or reports on them; nothing replaces them.

## 1. Parser provenance

Every value a parser produces now records **which parser, how confident, from
what evidence, and when** — whether or not the candidate accepts it. Without the
previous confidence on file, "is this re-parse better?" has no answer.

`candidate_field_provenance` holds one row per candidate field. The precedence
rule:

1. A value a human established (`candidate_confirmed`, `recruiter_entry`) beats
   any machine extraction, at any confidence.
2. Between machine sources, the newcomer must be at least as confident.

This is enforced twice on purpose: `decideProvenanceWrite` in
`src/lib/candidates/provenance.ts` keeps callers from ever attempting a bad
write, and a trigger on the table rejects it for any code path that does not come
through there.

`resume_parse_runs.parser_version` is stamped when the run starts, so a run that
fails mid-way still records which parser attempted it. The version includes the
model name (`openai:gpt-4.1-mini`), so a re-parse after a model change is
visibly a different parser rather than a mysterious change of answer.

## 2. Normalization

`src/lib/candidates/normalize.ts` is the single place two candidate values get
compared. Duplicate detection, Zoho import matching, and merge-conflict detection
all go through it, so "are these the same person" gives the same answer
everywhere.

Defaults are Tanzania-first (phone country code 255). A phone country code is a
contact detail; nothing in this module reads or infers nationality.

## 3. Duplicate detection

**Detection never merges.** Every function in `dedupe.ts` produces links with
`status: "suspected"` and nothing else, and the database refuses a link that
arrives already resolved.

An exact match on email or phone is reported as `match_kind: "exact"` so a
reviewer can clear it quickly — but it is still only suspected. Shared household
phone numbers and recycled work addresses are real, and a wrong merge silently
destroys one person's history.

Detection over-reports by design: a missed duplicate is a permanent data-quality
defect, an extra pair in the queue costs a reviewer ten seconds.

## 4. Merge review

`/hq/merge-review` shows two records side by side with the signals that flagged
them, the provenance behind each conflicting field, and what would move across.

Three guarantees:

- **A merge needs a named human.** `candidate_merge_events.performed_by` is NOT
  NULL, `apply_candidate_merge` refuses to run without an `auth.uid()`, and a
  trigger refuses to set `candidate_profiles.merged_into_candidate_id` unless a
  live merge event already exists. A detector cannot forge one.
- **Every conflict must be decided.** `buildMergePlan` throws rather than
  defaulting to the primary record's value — a silent default is how a merge
  quietly deletes the better record.
- **Every merge is reversible.** `before_snapshot` captures both records and
  every row the merge moves; `revert_candidate_merge` puts them back and returns
  the pair to the review queue.

The merged-away record is archived, never deleted. Applications that would
collide on `(candidate, job_order)` stay put, and their ids go into the audit for
manual reconciliation.

### Why the merge is a SECURITY DEFINER function

HQ has `SELECT` but not `UPDATE` on `candidate_profiles` and its children — a
candidate owns their own record. A merge therefore cannot be a sequence of client
writes, and should not be: it has to be atomic, or a crash halfway through splits
a person's history across two records. `apply_candidate_merge` re-checks the HQ
role and the actor itself rather than trusting its caller.

## 5. Data quality

`/hq/data-quality` reports seven signals: parser coverage, confirmation rate,
missing critical fields, duplicate rate, unresolved conflicts, import error rate,
and source freshness.

Counts and rates only. HQ needs to know that 400 records are missing a phone
number, not what the phone numbers are.

The page warns when more than one parser version is in play, because confidence
scores from different parsers are not comparable.

## 6. Work eligibility, and the nationality ban

Two different things, deliberately separated:

- **Work authorization** — "may this person legally work in country X, and does a
  permit expire" — is lawful and job-related. It lives in
  `candidate_work_authorizations`, feature-flagged **off**. The RLS policies
  themselves test the flag, so with it off the table reads as empty for every
  role including HQ.
- **Nationality / citizenship / national origin** is not stored, not searchable,
  not scoreable, and not a KPI dimension. There is no column for it anywhere in
  the schema.

`work_country_code` is the country the *work* would be performed in, never where
the candidate is from.

Regression coverage:

- `src/lib/screening/nationality-ban.test.ts` — the AI screening prompt still
  bans protected characteristics; no screening or ATS module reads one; the Zoho
  import refuses a record that carries one; no schema column matches
  `%nationalit%`, `%citizenship%`, `%ethnicit%`, or `%religion%`.
- `src/lib/kpi/no-nationality.test.ts` — nationality and work-eligibility query
  parameters are dropped, not honoured.

## Where things live

| Concern | Module |
| --- | --- |
| Enums shared across the ATS | `src/lib/candidates/constants.ts` |
| Normalizers | `src/lib/candidates/normalize.ts` |
| Similarity signals | `src/lib/candidates/match.ts` |
| Duplicate detection | `src/lib/candidates/dedupe.ts` |
| Merge planning and revert | `src/lib/candidates/merge.ts` |
| Provenance precedence | `src/lib/candidates/provenance.ts` |
| Local schema fragment | `src/lib/candidates/db.ts` |
| Data-quality metrics | `src/lib/data/hq-data-quality.ts` |
| Staged Zoho import | `src/lib/integrations/zoho-recruit/import/**` |

`src/lib/database.types.ts` is hand-maintained and deliberately untouched; the new
tables are typed locally in `src/lib/candidates/db.ts`, following the same pattern
as `src/lib/kpi/db-extensions.ts`.

## Not in scope

- Employer deduplication. `probableDuplicateEmployers` stays an honest zero
  rather than a borrowed number.
- Creating candidate accounts from an import (see the import doc).
- A nav entry for `/hq/merge-review` — it is linked from `/hq/data-quality`,
  which is in the HQ nav.
