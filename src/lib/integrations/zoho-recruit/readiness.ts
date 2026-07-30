import "server-only";

import { scopesMissing, ZOHO_RECRUIT_SYNC_SCOPES } from "@/lib/integrations/zoho-recruit/config";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SandboxReadinessCheck {
  readyForSandboxExperiments: boolean;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
}

/**
 * Sandbox readiness does NOT require Zoho portal customization.
 * Identity uses zoho_recruit_external_mappings only.
 */
export async function getZohoSandboxReadiness(): Promise<SandboxReadinessCheck> {
  const checks: SandboxReadinessCheck["checks"] = [];
  const client = createServiceRoleClient();
  const gates = await getZohoRecruitGateStatus();

  checks.push({
    id: "no_zoho_portal_customization",
    ok: true,
    detail:
      "No Zoho Modules/Fields changes required. Correlation uses zoho_recruit_external_mappings.",
  });

  checks.push({
    id: "production_data_gate_off",
    ok: gates.flags.zoho_recruit_production_data_enabled !== true,
    detail:
      gates.flags.zoho_recruit_production_data_enabled === true
        ? "Production-data gate is ON — turn it off for sandbox-only operation."
        : "Production-data gate is off (expected for sandbox).",
  });

  if (!client) {
    checks.push({
      id: "service_role",
      ok: false,
      detail: "SUPABASE_SERVICE_ROLE_KEY is not configured.",
    });
    return { readyForSandboxExperiments: false, checks };
  }

  const { data: connection } = await client
    .from("zoho_recruit_connections")
    .select("status, granted_scopes, api_domain, zoho_org_name, sync_paused_at")
    .eq("connection_key", "primary")
    .maybeSingle();

  const connected = connection?.status === "connected";
  checks.push({
    id: "oauth_connected",
    ok: connected,
    detail: connected
      ? `Connected${connection?.zoho_org_name ? ` to ${connection.zoho_org_name}` : ""}${connection?.api_domain ? ` via ${connection.api_domain}` : ""}.`
      : "Not connected — connect a sandbox Zoho org (not the live day-to-day Recruit workspace if you can avoid it).",
  });

  const granted = (connection?.granted_scopes as string[] | undefined) ?? [];
  const missing = scopesMissing(granted, ZOHO_RECRUIT_SYNC_SCOPES);
  checks.push({
    id: "scopes",
    ok: connected && missing.length === 0,
    detail:
      !connected
        ? "Connect first, then reconnect if scopes are missing."
        : missing.length === 0
          ? "Granted scopes cover sandbox projection."
          : `Missing scopes: ${missing.join(", ")}. Disconnect and reconnect to re-consent.`,
  });

  checks.push({
    id: "sync_not_paused",
    ok: !connection?.sync_paused_at,
    detail: connection?.sync_paused_at
      ? "Sync is paused on the connection."
      : "Connection is not paused.",
  });

  checks.push({
    id: "gates_informational",
    ok: true,
    detail: gates.syncAllowed
      ? "Sync gates currently allow worker processing — keep production-data off; prefer sandbox_sync for synthetic cases only."
      : `Sync remains blocked (${gates.blockedReasons.join("; ") || "gates off"}). Safe for day-to-day Zoho.`,
  });

  const readyForSandboxExperiments = checks.every((c) => c.ok);
  return { readyForSandboxExperiments, checks };
}
