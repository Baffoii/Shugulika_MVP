import "server-only";

/**
 * Persistence for candidate field provenance.
 *
 * Reads/writes go through the caller's RLS-scoped client, so a candidate only
 * ever touches their own provenance and HQ gets read-only access for the
 * data-quality dashboard.
 *
 * The precedence rule lives in `provenance.ts`; this module only applies it. A
 * write that the rule rejects is never sent to the database — and if some other
 * path ever tries, the trigger in 20260809090500 stops it there.
 */
import { asAtsClient, fromProvenanceRecord, toProvenanceRecord } from "@/lib/candidates/db";
import {
  planProvenanceWrites,
  provenanceKey,
  type ProvenanceRecord,
  type ProvenanceSkipReason,
} from "@/lib/candidates/provenance";

type ClientLike = Parameters<typeof asAtsClient>[0];

/** Every provenance row on file for a candidate. */
export async function loadCandidateProvenance(
  client: ClientLike,
  candidateId: string,
): Promise<ProvenanceRecord[]> {
  const { data, error } = await asAtsClient(client)
    .from("candidate_field_provenance")
    .select("*")
    .eq("candidate_id", candidateId);

  if (error) {
    console.error("[provenance-store] load failed:", error.message);
    return [];
  }
  return (data ?? []).map(toProvenanceRecord);
}

export interface ProvenanceWriteResult {
  written: number;
  skipped: Array<{ key: string; reason: ProvenanceSkipReason }>;
  failed: number;
}

/**
 * Apply a batch of provenance rows, honouring the precedence rule against
 * whatever is already on file.
 *
 * Upserts one row at a time rather than in bulk: the unique index folds a null
 * `target_entity_id` into a sentinel, which PostgREST's `onConflict` cannot
 * express, and a per-row write means one rejected field never loses the rest.
 */
export async function applyProvenance(
  client: ClientLike,
  candidateId: string,
  incoming: ProvenanceRecord[],
): Promise<ProvenanceWriteResult> {
  if (incoming.length === 0) return { written: 0, skipped: [], failed: 0 };

  const ats = asAtsClient(client);
  const existing = await loadCandidateProvenance(client, candidateId);
  const existingIds = new Map(
    (
      await ats
        .from("candidate_field_provenance")
        .select("id,target_entity,target_entity_id,field_path")
        .eq("candidate_id", candidateId)
    ).data?.map((row) => [
      provenanceKey({
        targetEntity: row.target_entity,
        targetEntityId: row.target_entity_id,
        fieldPath: row.field_path,
      }),
      row.id,
    ]) ?? [],
  );

  const { writes, skipped } = planProvenanceWrites(existing, incoming);

  let written = 0;
  let failed = 0;
  for (const record of writes) {
    const key = provenanceKey(record);
    const existingId = existingIds.get(key);
    const payload = fromProvenanceRecord(record);

    const { error } = existingId
      ? await ats.from("candidate_field_provenance").update(payload).eq("id", existingId)
      : await ats.from("candidate_field_provenance").insert(payload);

    if (error) {
      // A trigger rejection here means another writer confirmed the field
      // between our read and our write — the confirmed value wins, as intended.
      console.error(`[provenance-store] write rejected for ${key}: ${error.message}`);
      failed += 1;
      continue;
    }
    written += 1;
  }

  return {
    written,
    skipped: skipped.map((s) => ({ key: provenanceKey(s.record), reason: s.reason })),
    failed,
  };
}

/**
 * Record that a candidate explicitly confirmed a value. Called from the
 * suggestion-accept path, so the next parse cannot undo the decision.
 */
export async function recordConfirmation(
  client: ClientLike,
  record: ProvenanceRecord,
): Promise<boolean> {
  const result = await applyProvenance(client, record.candidateId, [record]);
  return result.written > 0;
}
