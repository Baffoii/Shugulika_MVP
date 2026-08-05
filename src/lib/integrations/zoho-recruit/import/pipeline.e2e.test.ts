import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZohoCandidateSource } from "@/lib/integrations/zoho-recruit/import/pipeline";

const memory = vi.hoisted(() => ({
  batch: null as Record<string, unknown> | null,
  records: [] as Array<Record<string, unknown>>,
  failNextWrite: false,
  canonicalWriteAllowed: true,
  mapping: null as {
    candidateId: string;
    fingerprint: string | null;
    mergedIntoCandidateId: null;
  } | null,
}));

vi.mock("@/lib/integrations/zoho-recruit/import/gates", () => ({
  getImportGateStatus: async () => ({
    stagingAllowed: true,
    canonicalWriteAllowed: memory.canonicalWriteAllowed,
    blockedReasons: memory.canonicalWriteAllowed ? [] : ["canonical write gate disabled"],
    flags: {},
  }),
}));

vi.mock("@/lib/candidates/db", () => ({
  asAtsClient: () => ({
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));

vi.mock("@/lib/integrations/zoho-recruit/import/canonical-upsert", () => ({
  upsertCanonicalCandidate: async (input: { zohoRecordId: string; fingerprint: string | null }) => {
    const candidateId = `candidate-${input.zohoRecordId}`;
    memory.mapping = { candidateId, fingerprint: input.fingerprint, mergedIntoCandidateId: null };
    return { ok: true, candidateId, created: true };
  },
}));

vi.mock("@/lib/integrations/zoho-recruit/import/store", () => ({
  getImportBatch: async () => memory.batch,
  listBatchRecords: async (_batchId: string, filter: { status?: string } = {}) =>
    filter.status
      ? memory.records.filter((record) => record.status === filter.status)
      : [...memory.records],
  updateBatch: async (_id: string, patch: Record<string, unknown>) => {
    if (memory.failNextWrite) {
      memory.failNextWrite = false;
      throw new Error("forced persistence failure");
    }
    if (!memory.batch) throw new Error("missing batch");
    const translated = {
      ...(patch.stage ? { stage: patch.stage } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.totals ? { totals: patch.totals } : {}),
      ...(patch.stageHistory ? { stage_history: patch.stageHistory } : {}),
      ...(patch.lastError !== undefined ? { last_error: patch.lastError } : {}),
    };
    Object.assign(memory.batch, translated);
  },
  upsertStagedRecord: async (input: Record<string, unknown>) => {
    if (memory.failNextWrite) {
      memory.failNextWrite = false;
      throw new Error("forced persistence failure");
    }
    const index = memory.records.findIndex(
      (record) => record.zoho_record_id === input.zohoRecordId,
    );
    const current = (index >= 0 ? memory.records[index] : null) ?? {};
    const next = {
      ...current,
      id: current.id ?? `staged-${input.zohoRecordId}`,
      batch_id: input.batchId,
      zoho_record_id: input.zohoRecordId,
      stage: input.stage,
      status: input.status,
      quarantine_reasons: input.quarantineReasons ?? [],
      mapped_payload: input.mappedPayload ?? {},
      source_fingerprint: input.sourceFingerprint ?? null,
      matched_candidate_id: input.matchedCandidateId ?? current.matched_candidate_id ?? null,
      match_score: input.matchScore ?? null,
      match_kind: input.matchKind ?? null,
      decision: current.decision ?? null,
    };
    if (index >= 0) memory.records[index] = next;
    else memory.records.push(next);
  },
  getReconciliationTarget: async () => memory.mapping,
}));

import { runImportStage } from "@/lib/integrations/zoho-recruit/import/pipeline";

const goodRecord = {
  First_Name: "Asha",
  Last_Name: "Mushi",
  Email: "asha@example.com",
  Phone: "+255700000000",
  Country: "TZ",
};

function sourceFor(count: number, eligible = true): ZohoCandidateSource {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    record: {
      ...goodRecord,
      Email: `asha${index}@example.com`,
      Phone: `+2557${String(index).padStart(8, "0")}`,
    },
    eligibility: {
      eligible,
      reasons: eligible ? [] : ["portal_consent_missing"],
      evidence: eligible ? ["portal:true"] : [],
    },
  }));
  return {
    async listCandidates({ page, perPage }) {
      const start = (page - 1) * perPage;
      return {
        records: rows.slice(start, start + perPage),
        hasMore: start + perPage < rows.length,
      };
    },
    async getCandidate(id) {
      const row = rows.find((candidate) => candidate.id === id);
      return row ? { record: row.record, eligibility: row.eligibility } : null;
    },
  };
}

function resetBatch(isDryRun = true) {
  memory.batch = {
    id: "batch-1",
    connection_id: "connection-1",
    stage: "inventory",
    status: "open",
    is_dry_run: isDryRun,
    stage_history: [],
    totals: {},
    last_error: null,
  };
  memory.records = [];
  memory.failNextWrite = false;
  memory.canonicalWriteAllowed = true;
  memory.mapping = null;
}

describe("staged Zoho candidate import end to end", () => {
  beforeEach(() => resetBatch());

  it("processes a full 2,000-record batch without truncating later stages", async () => {
    const source = sourceFor(2_000);
    await runImportStage("batch-1", source); // inventory
    expect(memory.records).toHaveLength(2_000);
    await runImportStage("batch-1", source); // map
    expect(memory.records.filter((record) => record.status === "mapped")).toHaveLength(2_000);
  });

  it("holds missing-consent records at human review and never advances", async () => {
    const source = sourceFor(1, false);
    for (let step = 0; step < 5; step += 1) await runImportStage("batch-1", source);
    expect(memory.batch?.stage).toBe("human_review");
    const result = await runImportStage("batch-1", source);
    expect(result?.to).toBeNull();
    expect(result?.blocked?.[0]).toContain("waiting on a person");
    expect(memory.batch?.status).toBe("blocked");
  });

  it("stops the batch when a database write fails", async () => {
    memory.failNextWrite = true;
    await expect(runImportStage("batch-1", sourceFor(1))).rejects.toThrow(
      "forced persistence failure",
    );
    expect(memory.batch?.status).toBe("failed");
  });

  it("writes and reconciles a live batch against the source and durable mapping", async () => {
    resetBatch(false);
    const source = sourceFor(1);
    for (let step = 0; step < 8; step += 1) await runImportStage("batch-1", source);
    expect(memory.records[0]).toMatchObject({
      status: "upserted",
      matched_candidate_id: "candidate-1",
    });
    expect(memory.batch?.stage).toBe("report");
    await runImportStage("batch-1", source);
    expect(memory.batch?.status).toBe("completed");
  });
});
