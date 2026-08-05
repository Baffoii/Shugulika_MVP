import "server-only";

/**
 * Feature gates for the staged candidate import.
 *
 * Import is gated separately from outbound sync. Connecting Zoho, exporting to
 * Zoho, and importing candidates from Zoho are three different decisions with
 * three different risks — the biggest here being that an import writes into the
 * canonical candidate pool that employer search runs on.
 *
 * Everything defaults to off, including when the flag store cannot be read.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";

export const IMPORT_GATE_KEYS = [
  "zoho_candidate_import_enabled",
  "zoho_candidate_import_write_enabled",
] as const;
export type ImportGateKey = (typeof IMPORT_GATE_KEYS)[number];

export interface ImportGateStatus {
  /** Master gate for running any import stage at all. */
  enabled: boolean;
  /** Allows a non-dry-run batch to write canonical candidate records. */
  writeEnabled: boolean;
  /** True when staged, read-only import work may run. */
  stagingAllowed: boolean;
  /** True when canonical_upsert may write. Requires both gates AND the master Zoho gate. */
  canonicalWriteAllowed: boolean;
  blockedReasons: string[];
  flags: Record<ImportGateKey, boolean>;
}

/** Pure assembler — never enables a gate; a missing key is off. */
export function buildImportGateStatus(
  flags: Partial<Record<ImportGateKey, boolean>>,
  zohoConnected: boolean,
): ImportGateStatus {
  const enabled = flags.zoho_candidate_import_enabled === true;
  const writeEnabled = flags.zoho_candidate_import_write_enabled === true;

  const blockedReasons: string[] = [];
  if (!enabled) blockedReasons.push("zoho_candidate_import_enabled is off");
  if (!writeEnabled) blockedReasons.push("zoho_candidate_import_write_enabled is off");
  if (!zohoConnected) blockedReasons.push("zoho_recruit_enabled is off");

  return {
    enabled,
    writeEnabled,
    stagingAllowed: enabled,
    canonicalWriteAllowed: enabled && writeEnabled && zohoConnected,
    blockedReasons,
    flags: {
      zoho_candidate_import_enabled: enabled,
      zoho_candidate_import_write_enabled: writeEnabled,
    },
  };
}

export async function getImportGateStatus(): Promise<ImportGateStatus> {
  const zohoGates = await getZohoRecruitGateStatus();
  const client = createServiceRoleClient();
  if (!client) return buildImportGateStatus({}, zohoGates.enabled);

  const { data, error } = await client
    .from("feature_flags")
    .select("key, is_enabled")
    .in("key", [...IMPORT_GATE_KEYS]);

  if (error || !data) return buildImportGateStatus({}, zohoGates.enabled);

  const flags: Partial<Record<ImportGateKey, boolean>> = {};
  for (const row of data) {
    const key = row.key as ImportGateKey;
    if ((IMPORT_GATE_KEYS as readonly string[]).includes(key)) flags[key] = row.is_enabled === true;
  }
  return buildImportGateStatus(flags, zohoGates.enabled);
}
