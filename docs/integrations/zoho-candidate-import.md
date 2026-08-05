# Zoho Recruit → Shugulika candidate import

**Status:** implemented, gated off. Nothing runs until both import flags are enabled.

Zoho Recruit is a satellite. Employer search, matching, and every candidate-facing
surface run on canonical Shugulika records (`candidate_profiles` and its children).
This import moves data *into* those canonical records; it never makes Zoho the
source of truth, and it never becomes a search index.

## The stages

A batch advances one stage per worker invocation. That is the point: an operator
can stop after `dry_run`, read the report, and only then let it continue. No
single call can take a raw Zoho record all the way to `candidate_profiles`.

| Stage | What happens | What it can write |
| --- | --- | --- |
| `inventory` | List candidate records from Zoho and stage them as work items. | staging rows only |
| `map` | Translate each record into a canonical draft; quarantine what fails. | staging rows only |
| `dry_run` | Report what a real import would do. | nothing |
| `quarantine` | A defined stopping point to review held-back records. | nothing |
| `match` | Compare each draft against the existing pool. | staging rows only |
| `human_review` | Ambiguous matches and quarantined records wait for a person. | nothing |
| `canonical_upsert` | Write approved records and their external mapping. | canonical records |
| `reconcile` | Re-read what was written and confirm it matches the source. | staging rows only |
| `report` | Publish the batch outcome. | batch report |

`advanceStage` throws on a skipped or backwards transition. A batch cannot reach
`canonical_upsert` without passing through `human_review`.

## Gates

Three independent flags, all default `false`:

- `zoho_recruit_enabled` — the master Zoho gate (pre-existing).
- `zoho_candidate_import_enabled` — allows staged, read-only import work.
- `zoho_candidate_import_write_enabled` — allows a non-dry-run batch to write
  canonical candidate records.

`canonicalWriteAllowed` requires all three. Separately, batches are `is_dry_run`
by default, and a database trigger refuses to mark a dry-run batch's record as
`upserted` — so a mis-configured worker cannot import for real.

## Quarantine

A record that fails validation is **held with a stated reason**, never silently
dropped and never silently repaired. The database enforces this: a row with
`status = 'quarantined'` and an empty `quarantine_reasons` array is rejected.

Reasons split into two kinds:

- **Waivable** — fix it upstream in Zoho and re-run: `invalid_email`,
  `invalid_phone`, `invalid_date`, `unmapped_country`, `duplicate_in_batch`,
  `payload_too_large`.
- **Unwaivable** — no operator can click past these: `prohibited_field_present`,
  `consent_missing`, `missing_name`, `missing_contact`.

### Prohibited fields

If a source record carries nationality, citizenship, ethnicity, religion, marital
status, or another protected characteristic *with a value*, the record is
**quarantined rather than stripped**. Stripping would hide the fact that the
upstream system holds data we refuse to ingest; quarantining puts it in front of
an operator. The value never reaches the canonical draft either way.

This is a legal constraint. Tanzania's Employment and Labour Relations Act
prohibits employment discrimination on nationality and covers applicants.

## Matching

The match stage uses the same normalizers and scorer as candidate deduplication
(`src/lib/candidates/normalize.ts`, `match.ts`, `dedupe.ts`), so a record arriving
from Zoho is judged by exactly the same rules as two records already in the pool.

Routing is deliberately conservative:

- no match → `create_new`
- exactly one strong match → `link_existing`
- several strong matches, or one weak one → `human_review`

A score never picks between two people.

## External identity

Durable local↔Zoho identity lives **only** in `zoho_recruit_external_mappings`.
The `zoho_record_id` on a staging row is a batch work item;
`purge_zoho_candidate_import_batch(batch_id)` discards a finished batch's staging
rows and leaves the mapping — and the candidate — untouched.

## Operating a batch

Staging tables are server-only: no browser role can read them, including HQ. HQ
sees a sanitized summary at `/hq/data-quality`, assembled by server code after a
role check.

The worker route advances one batch by one stage:

```bash
curl -X POST "$SITE_URL/api/integrations/zoho-recruit/workers/import" -H "Authorization: Bearer $ZOHO_RECRUIT_WORKER_SECRET" -H "Content-Type: application/json" -d '{"batchId":"<uuid>"}'
```

A gated-off import returns `200 {"skipped": true, "reason": …}` rather than an
error — a disabled import is a normal state, not something to retry against.

## What this does not do

`canonical_upsert` reports which records are approved and ready, but does not
itself create candidate accounts. Provisioning a candidate creates an auth user,
which is a larger surface than this workstream owns; the staged decisions are
complete and durable, and the write step hands off to the existing
candidate-provisioning path.
