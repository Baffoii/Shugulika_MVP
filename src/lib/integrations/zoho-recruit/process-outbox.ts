import "server-only";

import type { ZohoRecruitOutboxRow } from "@/lib/database.types";
import { checkExportEligibility } from "@/lib/integrations/zoho-recruit/eligibility";
import {
  markOutboxDeadLetter,
  markOutboxRetry,
  markOutboxSuccess,
} from "@/lib/integrations/zoho-recruit/outbox";
import { upsertRecords } from "@/lib/integrations/zoho-recruit/records";
import { redactZohoLogText } from "@/lib/integrations/zoho-recruit/errors";

/**
 * Process a claimed outbox row: recheck eligibility, then upsert when allowed.
 * No portal mutations — Zoho satellite projection only.
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
    // Gate-off / consent / restriction: do not hammer Zoho — dead-letter with reason.
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
  const data = (payload as { data: Record<string, unknown>[] }).data;

  try {
    await upsertRecords(zohoModule, data);
    await markOutboxSuccess({ id: row.id, claimToken: row.claim_token });
    return { outcome: "succeeded", detail: "upserted" };
  } catch (error) {
    const message = redactZohoLogText(error instanceof Error ? error.message : "upsert_failed");
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
