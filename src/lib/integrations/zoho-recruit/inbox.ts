import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Json, ZohoRecruitInboxRow } from "@/lib/database.types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { redactZohoLogText } from "@/lib/integrations/zoho-recruit/errors";

const CLAIM_TTL_MS = 5 * 60_000;
const DEFAULT_BATCH = 20;

function requireServiceClient() {
  const client = createServiceRoleClient();
  if (!client) throw new Error("Server credential storage is not configured.");
  return client;
}

export function hashWebhookPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload ?? null);
  return createHash("sha256").update(canonical).digest("hex");
}

const StoreInput = z.object({
  connectionId: z.string().uuid(),
  payload: z.unknown(),
  eventType: z.string().min(1).max(200).optional(),
  /** Caller-supplied dedupe key; defaults to payload hash. */
  dedupeKey: z.string().min(1).max(500).optional(),
  signatureVerified: z.boolean().default(false),
});

export type StoreInboxInput = z.input<typeof StoreInput>;

/**
 * Store a webhook payload with payload_hash + dedupe_key.
 * Duplicate (connection_id, dedupe_key) returns the existing row.
 * Does not mutate portal authoritative fields.
 */
export async function storeInboxWebhook(
  input: StoreInboxInput,
): Promise<{ row: ZohoRecruitInboxRow; created: boolean }> {
  const parsed = StoreInput.parse(input);
  const client = requireServiceClient();
  const payloadHash = hashWebhookPayload(parsed.payload);
  const dedupeKey = parsed.dedupeKey ?? payloadHash;

  const { data: existing } = await client
    .from("zoho_recruit_inbox")
    .select("*")
    .eq("connection_id", parsed.connectionId)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();

  if (existing) {
    return { row: existing as ZohoRecruitInboxRow, created: false };
  }

  const { data, error } = await client
    .from("zoho_recruit_inbox")
    .insert({
      connection_id: parsed.connectionId,
      dedupe_key: dedupeKey,
      event_type: parsed.eventType ?? null,
      payload: parsed.payload as Json,
      payload_hash: payloadHash,
      signature_verified: parsed.signatureVerified,
      status: "received",
    })
    .select("*")
    .single();

  if (error) {
    // Race on unique dedupe — return the winner.
    const { data: raced } = await client
      .from("zoho_recruit_inbox")
      .select("*")
      .eq("connection_id", parsed.connectionId)
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();
    if (raced) return { row: raced as ZohoRecruitInboxRow, created: false };
    throw new Error("Failed to store Zoho inbox webhook.");
  }

  return { row: data as ZohoRecruitInboxRow, created: true };
}

export async function claimInboxBatch(limit = DEFAULT_BATCH): Promise<ZohoRecruitInboxRow[]> {
  const client = requireServiceClient();
  const now = new Date();
  const claimToken = randomUUID();
  const claimExpires = new Date(now.getTime() + CLAIM_TTL_MS).toISOString();

  const { data: candidates, error } = await client
    .from("zoho_recruit_inbox")
    .select("*")
    .in("status", ["received", "processing"])
    .order("received_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 50)));

  if (error || !candidates?.length) return [];

  const claimed: ZohoRecruitInboxRow[] = [];
  for (const row of candidates as ZohoRecruitInboxRow[]) {
    const stale =
      row.status === "processing" &&
      (!row.claim_expires_at || new Date(row.claim_expires_at).getTime() <= now.getTime());
    if (row.status !== "received" && !stale) continue;

    const { data: updated, error: updateError } = await client
      .from("zoho_recruit_inbox")
      .update({
        status: "processing",
        claim_token: claimToken,
        claim_expires_at: claimExpires,
      })
      .eq("id", row.id)
      .in("status", stale ? ["processing"] : ["received"])
      .select("*")
      .maybeSingle();

    if (updateError || !updated) continue;
    if ((updated as ZohoRecruitInboxRow).claim_token !== claimToken) continue;
    claimed.push(updated as ZohoRecruitInboxRow);
    if (claimed.length >= limit) break;
  }

  return claimed;
}

/**
 * Mark inbox processing complete. Never writes portal candidate/job/application fields —
 * only inbox ledger status (+ optional ignored reason).
 */
export async function markInboxProcessed(input: {
  id: string;
  claimToken: string;
  status: "succeeded" | "ignored" | "failed";
  error?: string;
}): Promise<void> {
  const client = requireServiceClient();
  const { error } = await client
    .from("zoho_recruit_inbox")
    .update({
      status: input.status,
      processed_at: new Date().toISOString(),
      last_error: input.error ? redactZohoLogText(input.error).slice(0, 500) : null,
      claim_token: null,
      claim_expires_at: null,
    })
    .eq("id", input.id)
    .eq("claim_token", input.claimToken)
    .eq("status", "processing");
  if (error) throw new Error("Failed to mark Zoho inbox processed.");
}

/**
 * Process a claimed inbox row without mutating portal authoritative fields.
 * Zoho-owned offline status summaries are acknowledged only; portal stages stay untouched.
 */
export async function processInboxRow(row: ZohoRecruitInboxRow): Promise<{
  status: "succeeded" | "ignored" | "failed";
  note: string;
}> {
  if (!row.claim_token) {
    return { status: "failed", note: "missing claim token" };
  }

  const payload = row.payload;
  if (payload == null || typeof payload !== "object") {
    await markInboxProcessed({
      id: row.id,
      claimToken: row.claim_token,
      status: "ignored",
      error: "empty or non-object payload",
    });
    return { status: "ignored", note: "empty payload" };
  }

  // Intentionally no writes to candidate_profiles, applications, job_orders, etc.
  // Future inbound mapping may update zoho_recruit_external_mappings fingerprints only.
  await markInboxProcessed({
    id: row.id,
    claimToken: row.claim_token,
    status: "succeeded",
  });
  return {
    status: "succeeded",
    note: "acknowledged without portal field mutation",
  };
}
