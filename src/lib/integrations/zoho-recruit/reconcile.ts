import { createHash } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { getRecord } from "@/lib/integrations/zoho-recruit/records";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

export interface ReconcileOptions {
  connectionId: string;
  /** When true, write reconciliation summary but skip conflict inserts. */
  dryRun?: boolean;
  maxMappings?: number;
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
 * Mapping-first reconciliation — no Zoho custom fields required.
 * Walks local mappings and GETs each Zoho record by id.
 */
export async function runZohoRecruitReconciliation(
  options: ReconcileOptions,
): Promise<ReconcileResult> {
  const dryRun = options.dryRun === true;
  const maxMappings = options.maxMappings ?? 500;
  const gates = await getZohoRecruitGateStatus();

  if (!gates.syncAllowed) {
    return {
      skipped: true,
      skipReason: gates.blockedReasons.join("; ") || "sync gates disabled",
      reconciliationId: null,
      dryRun,
      recordsChecked: 0,
      differencesFound: 0,
      summary: { gates: gates.flags, mode: "mapping_only" },
    };
  }

  const client = requireServiceClient();
  const { data: recon, error: reconError } = await client
    .from("zoho_recruit_reconciliations")
    .insert({
      connection_id: options.connectionId,
      status: "running",
      summary: { dry_run: dryRun, mode: "mapping_only" } as Json,
    })
    .select("id")
    .single();

  if (reconError || !recon) {
    throw new Error("Failed to start Zoho reconciliation run.");
  }

  let recordsChecked = 0;
  let differencesFound = 0;
  const conflictNotes: string[] = [];
  const moduleSummaries: Record<string, { checked: number; diffs: number; missing: number }> = {};

  try {
    const { data: mappings, error: mapError } = await client
      .from("zoho_recruit_external_mappings")
      .select("id, zoho_module, zoho_record_id, last_external_fingerprint")
      .eq("connection_id", options.connectionId)
      .limit(maxMappings);

    if (mapError) throw new Error("Failed to load Zoho mappings for reconciliation.");

    for (const mapping of mappings ?? []) {
      const zohoModule = mapping.zoho_module;
      moduleSummaries[zohoModule] ??= { checked: 0, diffs: 0, missing: 0 };
      recordsChecked += 1;
      moduleSummaries[zohoModule].checked += 1;

      try {
        const result = await getRecord(zohoModule, mapping.zoho_record_id);
        const payload = result.data;
        const data =
          typeof payload === "object" &&
          payload &&
          "data" in payload &&
          Array.isArray((payload as { data: unknown }).data)
            ? (payload as { data: Record<string, unknown>[] }).data[0]
            : null;

        if (!data) {
          differencesFound += 1;
          moduleSummaries[zohoModule].missing += 1;
          conflictNotes.push(`missing_remote:${zohoModule}:${mapping.zoho_record_id}`);
          if (!dryRun) {
            await client.from("zoho_recruit_conflicts").insert({
              connection_id: options.connectionId,
              mapping_id: mapping.id,
              field_name: "zoho_record",
              authoritative_system: "shugulika",
              local_value_hash: mapping.last_external_fingerprint,
              external_value_hash: null,
              status: "open",
              resolution_note: "Mapped Zoho record missing remotely — no auto-repair",
            });
          }
          continue;
        }

        const externalFp = fingerprint({
          id: mapping.zoho_record_id,
          module: zohoModule,
          keys: Object.keys(data).sort(),
        });

        if (
          mapping.last_external_fingerprint &&
          mapping.last_external_fingerprint !== externalFp
        ) {
          differencesFound += 1;
          moduleSummaries[zohoModule].diffs += 1;
          conflictNotes.push(`fingerprint_mismatch:${zohoModule}:${mapping.zoho_record_id}`);
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
      } catch {
        differencesFound += 1;
        moduleSummaries[zohoModule].missing += 1;
        conflictNotes.push(`fetch_failed:${zohoModule}:${mapping.zoho_record_id}`);
      }
    }

    const summary = {
      dry_run: dryRun,
      mode: "mapping_only",
      modules: moduleSummaries,
      conflict_samples: conflictNotes.slice(0, 50),
      gates: gates.flags,
      note: "No Zoho custom fields required; only mapped records are checked.",
    };

    await client
      .from("zoho_recruit_reconciliations")
      .update({
        status: "succeeded",
        records_checked: recordsChecked,
        differences_found: differencesFound,
        summary: summary as Json,
        completed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", recon.id);

    return {
      skipped: false,
      reconciliationId: recon.id,
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
        last_error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", recon.id);
    throw error;
  }
}
