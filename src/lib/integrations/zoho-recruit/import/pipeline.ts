import "server-only";

/**
 * The staged import runner.
 *
 * One call advances a batch by exactly one stage. That makes the import
 * resumable, inspectable, and interruptible: an operator can stop after
 * `dry_run`, look at what the batch says it would do, and only then let it
 * proceed. It also means no single invocation can take a record from "raw Zoho
 * JSON" to "row in candidate_profiles".
 *
 * The stage machine and the per-record rules are pure (`stages.ts`,
 * `mapping.ts`, `quarantine.ts`); this module is the I/O around them.
 */
import { COUNTRIES } from "@/lib/constants";
import { matchAgainstPool, routeMatches, type CandidateForDedupe } from "@/lib/candidates/dedupe";
import { asAtsClient } from "@/lib/candidates/db";
import type { ImportStage } from "@/lib/candidates/constants";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getImportGateStatus } from "@/lib/integrations/zoho-recruit/import/gates";
import { upsertCanonicalCandidate } from "@/lib/integrations/zoho-recruit/import/canonical-upsert";
import {
  draftIdentityInput,
  findIntraBatchDuplicates,
  mapZohoCandidate,
  type CandidateDraft,
  type MappingResult,
  type ZohoCandidateRecord,
} from "@/lib/integrations/zoho-recruit/import/mapping";
import {
  decideQuarantine,
  missingCriticalFields,
} from "@/lib/integrations/zoho-recruit/import/quarantine";
import {
  advanceStage,
  canWriteCanonicalRecords,
  emptyTotals,
  nextStage,
  type BatchTotals,
  type StageTransition,
} from "@/lib/integrations/zoho-recruit/import/stages";
import {
  getImportBatch,
  listBatchRecords,
  updateBatch,
  upsertStagedRecord,
} from "@/lib/integrations/zoho-recruit/import/store";

/**
 * Where the batch's source records come from. Injected rather than hard-wired
 * to the Zoho client so the pipeline is testable without a live connection, and
 * so a fixture-driven dry run is a first-class mode rather than a mock.
 */
export interface ZohoCandidateSource {
  listCandidates(options: { page: number; perPage: number }): Promise<{
    records: Array<{ id: string; record: ZohoCandidateRecord }>;
    hasMore: boolean;
  }>;
}

export interface StageRunResult {
  batchId: string;
  from: ImportStage;
  to: ImportStage | null;
  totals: BatchTotals;
  /** Non-fatal notes for the operator: skipped work, systemic mapping problems. */
  notes: string[];
  blocked?: string[];
}

const MAX_RECORDS_PER_BATCH = 2_000;

function totalsFrom(records: Array<{ status: string }>): BatchTotals {
  const totals = emptyTotals();
  totals.inventoried = records.length;
  for (const record of records) {
    if (record.status === "mapped") totals.mapped += 1;
    if (record.status === "quarantined") totals.quarantined += 1;
    if (record.status === "matched") totals.matched += 1;
    if (record.status === "needs_human_review") totals.needsReview += 1;
    if (record.status === "upserted") totals.upserted += 1;
    if (record.status === "skipped") totals.skipped += 1;
    if (record.status === "failed") totals.failed += 1;
  }
  return totals;
}

/**
 * Advance one batch by one stage.
 *
 * Returns `blocked` rather than throwing when a gate is off: a disabled import
 * is a normal, expected state, not an error condition an operator needs to
 * debug.
 */
export async function runImportStage(
  batchId: string,
  source: ZohoCandidateSource | null,
): Promise<StageRunResult | null> {
  const batch = await getImportBatch(batchId);
  if (!batch) return null;

  const gates = await getImportGateStatus();
  if (!gates.stagingAllowed) {
    return {
      batchId,
      from: batch.stage,
      to: null,
      totals: emptyTotals(),
      notes: [],
      blocked: gates.blockedReasons,
    };
  }

  const target = nextStage(batch.stage);
  const history = (batch.stage_history ?? []) as unknown as StageTransition[];
  const notes: string[] = [];

  switch (batch.stage) {
    case "inventory":
      await stageInventory(batchId, source, notes);
      break;
    case "map":
      await stageMap(batchId, notes);
      break;
    case "dry_run":
      await stageDryRun(batchId, notes);
      break;
    case "quarantine":
      // Quarantine decisions are made during map/dry_run; this stage exists so
      // an operator has a defined place to stop and look at them.
      notes.push("Quarantined records are held for review; nothing was changed.");
      break;
    case "match":
      await stageMatch(batchId, notes);
      break;
    case "human_review":
      notes.push(...(await humanReviewNotes(batchId)));
      break;
    case "canonical_upsert":
      await stageCanonicalUpsert(batch, notes);
      break;
    case "reconcile":
      notes.push(...(await reconcileNotes(batchId)));
      break;
    case "report":
      notes.push("Batch already reported.");
      break;
  }

  const records = await listBatchRecords(batchId);
  const totals = totalsFrom(records);

  if (!target) {
    await updateBatch(batchId, {
      status: "completed",
      totals,
      completedAt: new Date().toISOString(),
      report: { notes, totals: totals as unknown as Record<string, unknown> },
    });
    return { batchId, from: batch.stage, to: null, totals, notes };
  }

  const advanced = advanceStage(
    batch.stage,
    target,
    new Date().toISOString(),
    history,
    notes.join(" ") || null,
  );
  await updateBatch(batchId, {
    stage: advanced.stage,
    status: "running",
    totals,
    stageHistory: advanced.history,
  });

  return { batchId, from: batch.stage, to: target, totals, notes };
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

async function stageInventory(
  batchId: string,
  source: ZohoCandidateSource | null,
  notes: string[],
): Promise<void> {
  if (!source) {
    notes.push("No source configured; nothing was inventoried.");
    return;
  }

  let page = 1;
  let staged = 0;
  let hasMore = true;

  while (hasMore && staged < MAX_RECORDS_PER_BATCH) {
    const { records, hasMore: more } = await source.listCandidates({ page, perPage: 200 });
    for (const { id, record } of records) {
      if (staged >= MAX_RECORDS_PER_BATCH) break;
      await upsertStagedRecord({
        batchId,
        zohoRecordId: id,
        stage: "inventory",
        status: "pending",
        // The raw record is kept only until the map stage rewrites this column
        // with the canonical draft.
        mappedPayload: { source: record },
      });
      staged += 1;
    }
    hasMore = more;
    page += 1;
  }

  if (hasMore) {
    notes.push(
      `Inventory stopped at the ${MAX_RECORDS_PER_BATCH}-record batch limit; run another batch for the remainder.`,
    );
  }
  notes.push(`Inventoried ${staged} record(s).`);
}

async function stageMap(batchId: string, notes: string[]): Promise<void> {
  const staged = await listBatchRecords(batchId, { status: "pending" });
  if (staged.length === 0) {
    notes.push("Nothing to map.");
    return;
  }

  const countries = COUNTRIES.map((c) => ({ code: c.code, name: c.name }));
  const mapped: Array<{ zohoRecordId: string; recordId: string; mapping: MappingResult }> = [];

  for (const row of staged) {
    const raw = ((row.mapped_payload ?? {}) as { source?: ZohoCandidateRecord }).source ?? {};
    mapped.push({
      zohoRecordId: row.zoho_record_id,
      recordId: row.id,
      mapping: mapZohoCandidate(raw, { countries }),
    });
  }

  const intraBatchDuplicates = findIntraBatchDuplicates(
    mapped.map((m) => ({ zohoRecordId: m.zohoRecordId, draft: m.mapping.draft })),
  );

  const missingFieldTally = new Map<string, number>();
  let quarantined = 0;

  for (const item of mapped) {
    const decision = decideQuarantine(item.mapping, {
      duplicateInBatch: intraBatchDuplicates.has(item.zohoRecordId),
    });
    for (const field of missingCriticalFields(item.mapping.draft)) {
      missingFieldTally.set(field, (missingFieldTally.get(field) ?? 0) + 1);
    }
    if (decision.quarantined) quarantined += 1;

    await upsertStagedRecord({
      batchId,
      zohoRecordId: item.zohoRecordId,
      stage: "map",
      status: decision.quarantined ? "quarantined" : "mapped",
      quarantineReasons: decision.reasons,
      mappedPayload: {
        draft: item.mapping.draft as unknown as Record<string, unknown>,
        prohibitedFields: item.mapping.prohibitedFields,
      },
      sourceFingerprint: item.mapping.fingerprint,
    });
  }

  notes.push(`Mapped ${mapped.length - quarantined}, quarantined ${quarantined}.`);

  // A field missing on nearly every record is a mapping problem, not a data
  // problem — say so, rather than leaving an operator to fix 500 records by hand.
  for (const [field, count] of missingFieldTally) {
    if (count >= Math.max(5, Math.ceil(mapped.length * 0.9))) {
      notes.push(
        `"${field}" is missing on ${count}/${mapped.length} records — check the Zoho field mapping before importing.`,
      );
    }
  }
}

async function stageDryRun(batchId: string, notes: string[]): Promise<void> {
  const records = await listBatchRecords(batchId);
  const mapped = records.filter((r) => r.status === "mapped").length;
  const quarantined = records.filter((r) => r.status === "quarantined").length;
  notes.push(
    `Dry run: ${mapped} record(s) would proceed to matching, ${quarantined} are held in quarantine. No canonical record was written.`,
  );
}

async function stageMatch(batchId: string, notes: string[]): Promise<void> {
  const records = await listBatchRecords(batchId, { status: "mapped" });
  if (records.length === 0) {
    notes.push("Nothing to match.");
    return;
  }

  const pool = await loadCandidatePool();
  let toCreate = 0;
  let toLink = 0;
  let toReview = 0;

  for (const row of records) {
    const draft = ((row.mapped_payload ?? {}) as { draft?: CandidateDraft }).draft;
    if (!draft) continue;

    const matches = matchAgainstPool(draftIdentityInput(draft), pool);
    const routing = routeMatches(matches);

    if (routing.route === "create_new") {
      toCreate += 1;
      await upsertStagedRecord({
        batchId,
        zohoRecordId: row.zoho_record_id,
        stage: "match",
        status: "matched",
        mappedPayload: row.mapped_payload as Record<string, unknown>,
        sourceFingerprint: row.source_fingerprint,
        matchKind: "none",
      });
      continue;
    }

    if (routing.route === "link_existing") {
      toLink += 1;
      await upsertStagedRecord({
        batchId,
        zohoRecordId: row.zoho_record_id,
        stage: "match",
        status: "matched",
        mappedPayload: row.mapped_payload as Record<string, unknown>,
        sourceFingerprint: row.source_fingerprint,
        matchedCandidateId: routing.candidateId,
        matchScore: routing.score,
        matchKind: matches[0]?.matchKind ?? "probabilistic",
      });
      continue;
    }

    // Ambiguous or weak: a person decides. The import never picks.
    toReview += 1;
    await upsertStagedRecord({
      batchId,
      zohoRecordId: row.zoho_record_id,
      stage: "match",
      status: "needs_human_review",
      mappedPayload: {
        ...(row.mapped_payload as Record<string, unknown>),
        candidateMatches: routing.matches.slice(0, 5),
        reviewReason: routing.reason,
      },
      sourceFingerprint: row.source_fingerprint,
      matchedCandidateId: routing.matches[0]?.candidateId ?? null,
      matchScore: routing.matches[0]?.score ?? null,
      matchKind: routing.matches[0]?.matchKind ?? null,
    });
  }

  notes.push(
    `Match: ${toCreate} new, ${toLink} linked to an existing candidate, ${toReview} awaiting human review.`,
  );
}

async function humanReviewNotes(batchId: string): Promise<string[]> {
  const pending = await listBatchRecords(batchId, { status: "needs_human_review" });
  const quarantined = await listBatchRecords(batchId, { status: "quarantined" });
  if (pending.length === 0 && quarantined.length === 0) return ["Nothing awaiting review."];
  return [
    `${pending.length} ambiguous match(es) and ${quarantined.length} quarantined record(s) are waiting on a person.`,
  ];
}

async function stageCanonicalUpsert(
  batch: { id: string; connection_id: string; stage: ImportStage; is_dry_run: boolean },
  notes: string[],
): Promise<void> {
  const gates = await getImportGateStatus();
  const records = await listBatchRecords(batch.id);
  const totals = totalsFrom(records);

  const allowed = canWriteCanonicalRecords({
    stage: batch.stage,
    isDryRun: batch.is_dry_run,
    totals,
  });

  if (!allowed.allowed || !gates.canonicalWriteAllowed) {
    notes.push(
      `No canonical record was written: ${[...allowed.reasons, ...(gates.canonicalWriteAllowed ? [] : gates.blockedReasons)].join("; ")}.`,
    );
    return;
  }

  const ready = records.filter((record) => record.status === "matched");
  let written = 0;
  let created = 0;
  let failed = 0;

  for (const record of ready) {
    const draft = ((record.mapped_payload ?? {}) as { draft?: CandidateDraft }).draft;
    if (!draft) {
      failed += 1;
      await upsertStagedRecord({
        batchId: batch.id,
        zohoRecordId: record.zoho_record_id,
        stage: "canonical_upsert",
        status: "failed",
        mappedPayload: record.mapped_payload as Record<string, unknown>,
        sourceFingerprint: record.source_fingerprint,
        matchedCandidateId: record.matched_candidate_id,
        matchScore: record.match_score,
        matchKind: record.match_kind,
        lastError: "Mapped candidate draft is missing.",
      });
      continue;
    }

    const result = await upsertCanonicalCandidate({
      connectionId: batch.connection_id,
      zohoRecordId: record.zoho_record_id,
      draft,
      matchedCandidateId: record.decision === "create_new" ? null : record.matched_candidate_id,
      fingerprint: record.source_fingerprint,
    });

    if (!result.ok) {
      failed += 1;
      await upsertStagedRecord({
        batchId: batch.id,
        zohoRecordId: record.zoho_record_id,
        stage: "canonical_upsert",
        status: "failed",
        mappedPayload: record.mapped_payload as Record<string, unknown>,
        sourceFingerprint: record.source_fingerprint,
        matchedCandidateId: record.matched_candidate_id,
        matchScore: record.match_score,
        matchKind: record.match_kind,
        lastError: result.error,
      });
      continue;
    }

    written += 1;
    if (result.created) created += 1;
    await upsertStagedRecord({
      batchId: batch.id,
      zohoRecordId: record.zoho_record_id,
      stage: "canonical_upsert",
      status: "upserted",
      mappedPayload: record.mapped_payload as Record<string, unknown>,
      sourceFingerprint: record.source_fingerprint,
      matchedCandidateId: result.candidateId,
      matchScore: record.match_score,
      matchKind: record.match_kind,
    });
  }

  notes.push(
    `Canonical upsert: ${written} written (${created} new), ${failed} failed. Durable Zoho mappings were recorded for every successful row.`,
  );
}

async function reconcileNotes(batchId: string): Promise<string[]> {
  const records = await listBatchRecords(batchId);
  const upserted = records.filter((r) => r.status === "upserted").length;
  const failed = records.filter((r) => r.status === "failed").length;
  return [`Reconcile: ${upserted} written, ${failed} failed.`];
}

/**
 * The existing candidate pool the match stage compares against. Read through
 * the service-role client because staging runs in a worker with no user session.
 */
async function loadCandidatePool(limit = 5_000): Promise<CandidateForDedupe[]> {
  const client = createServiceRoleClient();
  if (!client) return [];

  const { data, error } = await asAtsClient(client)
    .from("candidate_profiles")
    .select(
      "id,given_name,middle_name,family_name,contact_email,city,country_code,merged_into_candidate_id",
    )
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    givenName: row.given_name,
    middleName: row.middle_name,
    familyName: row.family_name,
    email: row.contact_email,
    city: row.city,
    countryCode: row.country_code,
    // Records already merged away must not be re-matched, or an import would
    // attach a new CV to a record nobody looks at any more.
    mergedIntoCandidateId: row.merged_into_candidate_id,
  }));
}
