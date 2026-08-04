import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const ZOHO_RECRUIT_GATE_KEYS = [
  "zoho_recruit_enabled",
  "zoho_recruit_data_sync_enabled",
  "zoho_recruit_production_data_enabled",
  "zoho_recruit_sandbox_sync_enabled",
] as const;

export type ZohoRecruitGateKey = (typeof ZOHO_RECRUIT_GATE_KEYS)[number];

export interface GateStatus {
  /** Master runtime gate for Zoho Recruit synchronization. */
  enabled: boolean;
  /** Kill switch for any record synchronization. */
  dataSyncEnabled: boolean;
  /** Production candidate/job export requires DPO/legal approval gate. */
  productionDataEnabled: boolean;
  /** Synthetic/sandbox offline-case projection only. */
  sandboxSyncEnabled: boolean;
  /** True when master + data-sync gates allow any sync work. */
  syncAllowed: boolean;
  /** True when production (non-synthetic) export may proceed at the gate layer. */
  productionExportAllowed: boolean;
  /** True when synthetic/sandbox export may proceed at the gate layer. */
  sandboxExportAllowed: boolean;
  /** Human-readable reasons sync is blocked. Empty when syncAllowed. */
  blockedReasons: string[];
  flags: Record<ZohoRecruitGateKey, boolean>;
}

const ALL_DISABLED: GateStatus = {
  enabled: false,
  dataSyncEnabled: false,
  productionDataEnabled: false,
  sandboxSyncEnabled: false,
  syncAllowed: false,
  productionExportAllowed: false,
  sandboxExportAllowed: false,
  blockedReasons: ["feature_flags_unavailable"],
  flags: {
    zoho_recruit_enabled: false,
    zoho_recruit_data_sync_enabled: false,
    zoho_recruit_production_data_enabled: false,
    zoho_recruit_sandbox_sync_enabled: false,
  },
};

/** Pure assembler — never enables gates; missing keys default to false. */
export function buildGateStatus(flags: Partial<Record<ZohoRecruitGateKey, boolean>>): GateStatus {
  const enabled = flags.zoho_recruit_enabled === true;
  const dataSyncEnabled = flags.zoho_recruit_data_sync_enabled === true;
  const productionDataEnabled = flags.zoho_recruit_production_data_enabled === true;
  const sandboxSyncEnabled = flags.zoho_recruit_sandbox_sync_enabled === true;

  const blockedReasons: string[] = [];
  if (!enabled) blockedReasons.push("zoho_recruit_enabled is off");
  if (!dataSyncEnabled) blockedReasons.push("zoho_recruit_data_sync_enabled is off");

  const syncAllowed = enabled && dataSyncEnabled;
  const productionExportAllowed = syncAllowed && productionDataEnabled;
  const sandboxExportAllowed = syncAllowed && sandboxSyncEnabled;

  if (syncAllowed && !productionDataEnabled && !sandboxSyncEnabled) {
    blockedReasons.push(
      "neither zoho_recruit_production_data_enabled nor zoho_recruit_sandbox_sync_enabled is on",
    );
  }

  return {
    enabled,
    dataSyncEnabled,
    productionDataEnabled,
    sandboxSyncEnabled,
    syncAllowed,
    productionExportAllowed,
    sandboxExportAllowed,
    blockedReasons,
    flags: {
      zoho_recruit_enabled: enabled,
      zoho_recruit_data_sync_enabled: dataSyncEnabled,
      zoho_recruit_production_data_enabled: productionDataEnabled,
      zoho_recruit_sandbox_sync_enabled: sandboxSyncEnabled,
    },
  };
}

/**
 * Read Zoho Recruit feature flags. Never enables gates — read-only.
 * Defaults every flag to false when storage is unavailable or a key is missing.
 */
export async function getZohoRecruitGateStatus(): Promise<GateStatus> {
  const client = createServiceRoleClient();
  if (!client) return ALL_DISABLED;

  const { data, error } = await client
    .from("feature_flags")
    .select("key, is_enabled")
    .in("key", [...ZOHO_RECRUIT_GATE_KEYS]);

  if (error || !data) return ALL_DISABLED;

  const flags: Partial<Record<ZohoRecruitGateKey, boolean>> = {};
  for (const row of data) {
    const key = row.key as ZohoRecruitGateKey;
    if ((ZOHO_RECRUIT_GATE_KEYS as readonly string[]).includes(key)) {
      flags[key] = row.is_enabled === true;
    }
  }
  return buildGateStatus(flags);
}
