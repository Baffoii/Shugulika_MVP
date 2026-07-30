import "server-only";

import { createHash } from "node:crypto";
import type { ZohoRecruitOutboxRow } from "@/lib/database.types";
import { checkExportEligibility } from "@/lib/integrations/zoho-recruit/eligibility";
import { redactZohoLogText } from "@/lib/integrations/zoho-recruit/errors";
import {
  extractZohoRecordId,
  getExternalMapping,
  upsertExternalMapping,
} from "@/lib/integrations/zoho-recruit/mappings";
import {
  markOutboxDeadLetter,
  markOutboxRetry,
  markOutboxSuccess,
} from "@/lib/integrations/zoho-recruit/outbox";
import { insertRecords, updateRecords } from "@/lib/integrations/zoho-recruit/records";

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex")
    .slice(0, 32);
}

/** Strip optional custom correlation fields — sandbox mode does not require Zoho UI fields. */
function sanitizeOutboundData(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const next = { ...row };
    delete next.Shugulika_ID;
    delete next.shugulika_id;
    return next;
  });
}

/**
 * Process a claimed outbox row: recheck eligibility, then create/update by mapping.
 * Identity is stored only in `zoho_recruit_external_mappings` — no Zoho custom fields required.
 */
export async function processOutboxRow(row: ZohoRecruitOutboxRow): Promise<{
  outcome: "succeeded" | "retry" | "dead_letter" | "cancelled";
  detail: string;
}> {
  if (!row.claim_token) {
    return { outcome: "dead_letter", detail: "missing claim token" };
  }

  const aggregateType = row.aggregate_type;
  const localEntityType =
    aggregateType === "candidate" || aggregateType === "job" ? aggregateType : null;

  if (!localEntityType) {
    await markOutboxDeadLetter({
      id: row.id,
      claimToken: row.claim_token,
      error: `unsupported aggregate_type: ${aggregateType}`,
      attemptCount: row.attempt_count + 1,
    });
    return { outcome: "dead_letter", detail: "unsupported aggregate_type" };
  }

  const eligibility = await checkExportEligibility({
    connectionId: row.connection_id,
    localEntityType,
    localEntityId: row.aggregate_id,
  });

  if (!eligibility.allowed) {
    const reason = eligibility.reasons.join("; ") || "eligibility_denied";
    await markOutboxDeadLetter({
      id: row.id,
      claimToken: row.claim_token,
      error: reason,
      attemptCount: row.attempt_count + 1,
    });
    return { outcome: "dead_letter", detail: reason };
  }

  const payload = row.payload;
  if (
    typeof payload !== "object" ||
    !payload ||
    !("module" in payload) ||
    !("data" in payload) ||
    typeof (payload as { module: unknown }).module !== "string" ||
    !Array.isArray((payload as { data: unknown }).data)
  ) {
    await markOutboxDeadLetter({
      id: row.id,
      claimToken: row.claim_token,
      error: "payload must include module and data[]",
      attemptCount: row.attempt_count + 1,
    });
    return { outcome: "dead_letter", detail: "invalid payload shape" };
  }

  const zohoModule = (payload as { module: string }).module;
  const data = sanitizeOutboundData(
    (payload as { data: Record<string, unknown>[] }).data as Record<string, unknown>[],
  );

  try {
    const existing = await getExternalMapping({
      connectionId: row.connection_id,
      localEntityType,
      localEntityId: row.aggregate_id,
    });

    let zohoRecordId = existing?.zohoRecordId ?? null;
    let responsePayload: unknown;

    if (zohoRecordId) {
      responsePayload = (
        await updateRecords(
          zohoModule,
          data.map((rowData) => ({ ...rowData, id: zohoRecordId })),
        )
      ).data;
    } else {
      const inserted = await insertRecords(zohoModule, data);
      responsePayload = inserted.data;
      zohoRecordId = extractZohoRecordId(responsePayload);
      if (!zohoRecordId) {
        throw new Error("Zoho create succeeded but returned no record id.");
      }
    }

    await upsertExternalMapping({
      connectionId: row.connection_id,
      localEntityType,
      localEntityId: row.aggregate_id,
      zohoModule,
      zohoRecordId,
      localFingerprint: fingerprint(data),
      externalFingerprint: fingerprint({ id: zohoRecordId, data }),
      metadata: { last_event_id: row.event_id },
    });

    await markOutboxSuccess({ id: row.id, claimToken: row.claim_token });
    return {
      outcome: "succeeded",
      detail: existing ? "updated_by_mapping" : "created_and_mapped",
    };
  } catch (error) {
    const message = redactZohoLogText(error instanceof Error ? error.message : "write_failed");
    const nextAttempt = row.attempt_count + 1;
    const maxAttempts = row.max_attempts ?? 8;
    const outcome = await markOutboxRetry({
      id: row.id,
      claimToken: row.claim_token,
      error: message,
      attemptCount: nextAttempt,
      maxAttempts,
    });
    return { outcome, detail: message };
  }
}
