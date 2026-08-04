import "server-only";

import type { Json } from "@/lib/database.types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

function requireServiceClient() {
  const client = createServiceRoleClient();
  if (!client) throw new Error("Server credential storage is not configured.");
  return client;
}

/**
 * Local ↔ Zoho identity lives in Supabase only.
 * No Zoho custom fields (e.g. Shugulika_ID) are required for sandbox projection.
 */
export async function getExternalMapping(input: {
  connectionId: string;
  localEntityType: string;
  localEntityId: string;
}): Promise<{ id: string; zohoModule: string; zohoRecordId: string } | null> {
  const client = requireServiceClient();
  const { data, error } = await client
    .from("zoho_recruit_external_mappings")
    .select("id, zoho_module, zoho_record_id")
    .eq("connection_id", input.connectionId)
    .eq("local_entity_type", input.localEntityType)
    .eq("local_entity_id", input.localEntityId)
    .maybeSingle();
  if (error) throw new Error("Failed to read Zoho external mapping.");
  if (!data) return null;
  return {
    id: data.id,
    zohoModule: data.zoho_module,
    zohoRecordId: data.zoho_record_id,
  };
}

export async function upsertExternalMapping(input: {
  connectionId: string;
  localEntityType: string;
  localEntityId: string;
  zohoModule: string;
  zohoRecordId: string;
  syncDirection?: "outbound" | "inbound" | "bidirectional_summary";
  localFingerprint?: string | null;
  externalFingerprint?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const client = requireServiceClient();
  const now = new Date().toISOString();
  const { error } = await client.from("zoho_recruit_external_mappings").upsert(
    {
      connection_id: input.connectionId,
      local_entity_type: input.localEntityType,
      local_entity_id: input.localEntityId,
      zoho_module: input.zohoModule,
      zoho_record_id: input.zohoRecordId,
      sync_direction: input.syncDirection ?? "outbound",
      last_local_fingerprint: input.localFingerprint ?? null,
      last_external_fingerprint: input.externalFingerprint ?? null,
      last_synced_at: now,
      metadata: (input.metadata ?? {}) as Json,
    },
    { onConflict: "connection_id,local_entity_type,local_entity_id" },
  );
  if (error) throw new Error("Failed to persist Zoho external mapping.");
}

/** Pull first created/updated Zoho record id from a Recruit write response. */
export function extractZohoRecordId(payload: unknown): string | null {
  if (typeof payload !== "object" || !payload || !("data" in payload)) return null;
  const data = (payload as { data: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (typeof first !== "object" || !first) return null;
  const details =
    "details" in first && typeof (first as { details: unknown }).details === "object"
      ? ((first as { details: Record<string, unknown> }).details ?? {})
      : {};
  const id = details.id ?? (first as { id?: unknown }).id;
  return id == null ? null : String(id);
}
