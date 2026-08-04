import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Json, ZohoRecruitOutboxRow } from "@/lib/database.types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { redactZohoLogText, zohoBackoffDelayMs } from "@/lib/integrations/zoho-recruit/errors";

const CLAIM_TTL_MS = 5 * 60_000;
const DEFAULT_BATCH = 10;

function requireServiceClient() {
  const client = createServiceRoleClient();
  if (!client) throw new Error("Server credential storage is not configured.");
  return client;
}

const EnqueueInput = z.object({
  connectionId: z.string().uuid(),
  aggregateType: z.string().min(1).max(100),
  aggregateId: z.string().uuid(),
  eventType: z.string().min(1).max(100),
  processingPurpose: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
  consentSnapshot: z.record(z.string(), z.unknown()).default({}),
  payloadVersion: z.number().int().positive().default(1),
  /** Stable event id — caller must supply for idempotent retries of the same intent. */
  eventId: z.string().uuid().optional(),
  maxAttempts: z.number().int().positive().max(32).default(8),
  availableAt: z.string().datetime().optional(),
});

export type EnqueueOutboxInput = z.input<typeof EnqueueInput>;

/**
 * Explicit enqueue only — nothing auto-enqueues from portal flows.
 * Uses a stable event_id for idempotency. No Zoho network calls.
 */
export async function enqueueOutboxEvent(input: EnqueueOutboxInput): Promise<ZohoRecruitOutboxRow> {
  const parsed = EnqueueInput.parse(input);
  const client = requireServiceClient();
  const eventId = parsed.eventId ?? randomUUID();

  const { data, error } = await client
    .from("zoho_recruit_outbox")
    .upsert(
      {
        connection_id: parsed.connectionId,
        event_id: eventId,
        aggregate_type: parsed.aggregateType,
        aggregate_id: parsed.aggregateId,
        event_type: parsed.eventType,
        processing_purpose: parsed.processingPurpose,
        payload_version: parsed.payloadVersion,
        payload: parsed.payload as Json,
        consent_snapshot: parsed.consentSnapshot as Json,
        status: "queued",
        attempt_count: 0,
        available_at: parsed.availableAt ?? new Date().toISOString(),
        max_attempts: parsed.maxAttempts,
        last_error: null,
        claim_token: null,
        claim_expires_at: null,
        processing_started_at: null,
        processed_at: null,
        superseded_by: null,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("*")
    .maybeSingle();

  if (error) throw new Error("Failed to enqueue Zoho outbox event.");

  if (!data) {
    const { data: existing, error: readError } = await client
      .from("zoho_recruit_outbox")
      .select("*")
      .eq("event_id", eventId)
      .single();
    if (readError || !existing) throw new Error("Failed to load enqueued Zoho outbox event.");
    return existing as ZohoRecruitOutboxRow;
  }

  return data as ZohoRecruitOutboxRow;
}

export async function claimOutboxBatch(limit = DEFAULT_BATCH): Promise<ZohoRecruitOutboxRow[]> {
  const client = requireServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const claimToken = randomUUID();
  const claimExpires = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();

  const { data: candidates, error } = await client
    .from("zoho_recruit_outbox")
    .select("*")
    .in("status", ["queued", "retry", "processing"])
    .lte("available_at", nowIso)
    .order("available_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 50)));

  if (error || !candidates?.length) return [];

  const claimed: ZohoRecruitOutboxRow[] = [];
  for (const row of candidates as ZohoRecruitOutboxRow[]) {
    const staleProcessing =
      row.status === "processing" &&
      (!row.claim_expires_at || new Date(row.claim_expires_at).getTime() <= now.getTime());
    const ready = row.status === "queued" || row.status === "retry" || staleProcessing;
    if (!ready) continue;

    const { data: updated, error: updateError } = await client
      .from("zoho_recruit_outbox")
      .update({
        status: "processing",
        claim_token: claimToken,
        claim_expires_at: claimExpires,
        processing_started_at: nowIso,
      })
      .eq("id", row.id)
      .in("status", staleProcessing ? ["processing"] : ["queued", "retry"])
      .select("*")
      .maybeSingle();

    if (updateError || !updated) continue;
    if ((updated as ZohoRecruitOutboxRow).claim_token !== claimToken) continue;
    claimed.push(updated as ZohoRecruitOutboxRow);
    if (claimed.length >= limit) break;
  }

  return claimed;
}

export async function markOutboxSuccess(input: { id: string; claimToken: string }): Promise<void> {
  const client = requireServiceClient();
  const { error } = await client
    .from("zoho_recruit_outbox")
    .update({
      status: "succeeded",
      processed_at: new Date().toISOString(),
      last_error: null,
      claim_token: null,
      claim_expires_at: null,
    })
    .eq("id", input.id)
    .eq("claim_token", input.claimToken)
    .eq("status", "processing");
  if (error) throw new Error("Failed to mark Zoho outbox success.");
}

export async function markOutboxRetry(input: {
  id: string;
  claimToken: string;
  error: string;
  attemptCount: number;
  maxAttempts: number;
}): Promise<"retry" | "dead_letter"> {
  const safeError = redactZohoLogText(input.error).slice(0, 500);
  if (input.attemptCount >= input.maxAttempts) {
    await markOutboxDeadLetter({
      id: input.id,
      claimToken: input.claimToken,
      error: safeError,
      attemptCount: input.attemptCount,
    });
    return "dead_letter";
  }

  const client = requireServiceClient();
  const delay = zohoBackoffDelayMs(input.attemptCount);
  const { error } = await client
    .from("zoho_recruit_outbox")
    .update({
      status: "retry",
      attempt_count: input.attemptCount,
      available_at: new Date(Date.now() + delay).toISOString(),
      last_error: safeError,
      claim_token: null,
      claim_expires_at: null,
      processing_started_at: null,
    })
    .eq("id", input.id)
    .eq("claim_token", input.claimToken)
    .eq("status", "processing");
  if (error) throw new Error("Failed to mark Zoho outbox retry.");
  return "retry";
}

export async function markOutboxDeadLetter(input: {
  id: string;
  claimToken: string;
  error: string;
  attemptCount: number;
}): Promise<void> {
  const client = requireServiceClient();
  const { error } = await client
    .from("zoho_recruit_outbox")
    .update({
      status: "dead_letter",
      attempt_count: input.attemptCount,
      last_error: redactZohoLogText(input.error).slice(0, 500),
      processed_at: new Date().toISOString(),
      claim_token: null,
      claim_expires_at: null,
    })
    .eq("id", input.id)
    .eq("claim_token", input.claimToken)
    .eq("status", "processing");
  if (error) throw new Error("Failed to mark Zoho outbox dead letter.");
}

/**
 * Supersede pending/retry events for an aggregate when restriction wins.
 * Creates no Zoho calls — only ledger updates.
 */
export async function supersedeOutboxOnRestriction(input: {
  connectionId: string;
  aggregateType: string;
  aggregateId: string;
  restrictionEventId: string;
}): Promise<number> {
  const client = requireServiceClient();
  const { data, error } = await client
    .from("zoho_recruit_outbox")
    .update({
      status: "cancelled",
      superseded_by: input.restrictionEventId,
      last_error: "superseded by restriction",
      claim_token: null,
      claim_expires_at: null,
    })
    .eq("connection_id", input.connectionId)
    .eq("aggregate_type", input.aggregateType)
    .eq("aggregate_id", input.aggregateId)
    .in("status", ["queued", "retry"])
    .neq("event_id", input.restrictionEventId)
    .select("id");

  if (error) throw new Error("Failed to supersede Zoho outbox events.");
  return data?.length ?? 0;
}
