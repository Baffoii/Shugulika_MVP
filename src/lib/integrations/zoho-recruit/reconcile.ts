import "server-only";

import { createHash } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { listRecords } from "@/lib/integrations/zoho-recruit/records";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const RECONCILE_MODULES = ["Candidates", "Job_Openings"] as const;
const SHUGULIKA_ID_FIELD = "Shugulika_ID";

function requireServiceClient() {
  const client = createServiceRoleClient();
  if (!client) throw new Error("Server credential storage is not configured.");
  return client;
}

function fingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex")
    .slice(0, 32);
}

function extractDataArray(payload: unknown): Record<string, unknown>[] {
  if (
    typeof payload === "object" &&
    payload &&
    "data" in payload &&
    Array.isArray((payload as { data: unknown }).data)
  ) {
    return (payload as { data: Record<string, unknown>[] }).data;
  }
  return [];
}

function extractMoreRecords(payload: unknown): boolean {
  if (
    typeof payload === "object" &&
    payload &&
    "info" in payload &&
    typeof (payload as { info: unknown }).info === "object" &&
    (payload as { info: { more_records?: unknown } }).info
  ) {
    return (payload as { info: { more_records?: boolean } }).info.more_records === true;
  }
  return false;
}

export interface ReconcileOptions {
  connectionId: string;
  /** When true, write reconciliation summary but skip conflict inserts that would auto-repair. */
  dryRun?: boolean;
  maxPagesPerModule?: number;
}

export interface ReconcileResult {
  skipped: boolean;
  skipReason?: string;
  reconciliationId: string | null;
  dryRun: boolean;
  recordsChecked: number;
  differencesFound: number;
  summary: Record<string, unknown>;
}

/**
 * Dry-run capable reconciliation walker.
 * Compares Zoho list pagination against local mappings.
 * Never auto-repairs ambiguous conflicts — records zoho_recruit_conflicts instead.
 * Exits early when sync gates are disabled.
 */
export async function runZohoRecruitReconciliation(
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const gates = await getZohoRecruitGateStatus();
  if (!gates.syncAllowed) {
    return {
      skipped: true,
      skipReason: gates.blockedReasons.join("; ") || "sync gates disabled",
      reconciliationId: null,
      dryRun: options.dryRun === true,
      recordsChecked: 0,
      differencesFound: 0,
      summary: { gates: gates.flags },
    };
  }

  const client = requireServiceClient();
  const dryRun = options.dryRun === true;
  const maxPages = options.maxPagesPerModule ?? 20;

  const { data: reconRow, error: insertError } = await client
    .from("zoho_recruit_reconciliations")
    .insert({
      connection_id: options.connectionId,
      status: "running",
      summary: { dry_run: dryRun } as Json,
    })
    .select("id")
    .single();

  if (insertError || !reconRow) {
    throw new Error("Failed to start Zoho reconciliation run.");
  }

  const reconciliationId = (reconRow as { id: string }).id;
  let recordsChecked = 0;
  let differencesFound = 0;
  const moduleSummaries: Record<string, unknown> = {};
  const conflictNotes: string[] = [];

  try {
    const { data: mappings } = await client
      .from("zoho_recruit_external_mappings")
      .select("id, local_entity_id, zoho_module, zoho_record_id, last_external_fingerprint")
      .eq("connection_id", options.connectionId);

    const byExternal = new Map<
      string,
      {
        id: string;
        local_entity_id: string;
        zoho_module: string;
        zoho_record_id: string;
        last_external_fingerprint: string | null;
      }
    >();
    for (const m of mappings ?? []) {
      byExternal.set(`${m.zoho_module}:${m.zoho_record_id}`, m);
    }

    for (const zohoModule of RECONCILE_MODULES) {
      let page = 1;
      let more = true;
      let moduleChecked = 0;
      let moduleDiffs = 0;

      while (more && page <= maxPages) {
        const result = await listRecords(zohoModule, { page, per_page: 200 });
        const rows = extractDataArray(result.data);
        more = extractMoreRecords(result.data);
        page += 1;

        for (const record of rows) {
          moduleChecked += 1;
          recordsChecked += 1;
          const zohoId = String(record.id ?? record.Id ?? "");
          if (!zohoId) continue;

          const localIdRaw = record[SHUGULIKA_ID_FIELD];
          const mapping = byExternal.get(`${zohoModule}:${zohoId}`);
          const externalFp = fingerprint({
            id: zohoId,
            shugulika_id: localIdRaw ?? null,
          });

          if (!mapping) {
            if (localIdRaw) {
              moduleDiffs += 1;
              differencesFound += 1;
              conflictNotes.push(`unmapped_external:${zohoModule}:${zohoId}`);
              if (!dryRun) {
                await client.from("zoho_recruit_conflicts").insert({
                  connection_id: options.connectionId,
                  mapping_id: null,
                  field_name: SHUGULIKA_ID_FIELD,
                  authoritative_system: "shugulika",
                  local_value_hash: fingerprint(localIdRaw),
                  external_value_hash: externalFp,
                  status: "open",
                  resolution_note: "Unmapped Zoho record with Shugulika_ID — no auto-repair",
                });
              }
            }
            continue;
          }

          if (
            mapping.last_external_fingerprint &&
            mapping.last_external_fingerprint !== externalFp
          ) {
            moduleDiffs += 1;
            differencesFound += 1;
            conflictNotes.push(`fingerprint_mismatch:${zohoModule}:${zohoId}`);
            if (!dryRun) {
              await client.from("zoho_recruit_conflicts").insert({
                connection_id: options.connectionId,
                mapping_id: mapping.id,
                field_name: "record_fingerprint",
                authoritative_system: "shugulika",
                local_value_hash: mapping.last_external_fingerprint,
                external_value_hash: externalFp,
                status: "open",
                resolution_note: "Ambiguous fingerprint drift — recorded, not auto-repaired",
              });
            }
          }
        }
      }

      moduleSummaries[zohoModule] = {
        records_checked: moduleChecked,
        differences_found: moduleDiffs,
        pages_scanned: page - 1,
      };
    }

    const summary = {
      dry_run: dryRun,
      modules: moduleSummaries,
      conflict_samples: conflictNotes.slice(0, 50),
      gates: gates.flags,
    };

    await client
      .from("zoho_recruit_reconciliations")
      .update({
        status: "succeeded",
        records_checked: recordsChecked,
        differences_found: differencesFound,
        summary: summary as Json,
        completed_at: new Date().toISOString(),
        cursor_value: null,
      })
      .eq("id", reconciliationId);

    return {
      skipped: false,
      reconciliationId,
      dryRun,
      recordsChecked,
      differencesFound,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "reconciliation_failed";
    await client
      .from("zoho_recruit_reconciliations")
      .update({
        status: "failed",
        records_checked: recordsChecked,
        differences_found: differencesFound,
        last_error: message.slice(0, 500),
        completed_at: new Date().toISOString(),
        summary: { dry_run: dryRun, modules: moduleSummaries } as Json,
      })
      .eq("id", reconciliationId);
    throw error;
  }
}
