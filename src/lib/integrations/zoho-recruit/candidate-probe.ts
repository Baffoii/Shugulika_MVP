import "server-only";

import { scopesMissing, ZOHO_RECRUIT_SYNC_SCOPES } from "@/lib/integrations/zoho-recruit/config";
import { getZohoRecruitGateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { getFields, listRecords } from "@/lib/integrations/zoho-recruit/records";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ZohoCandidateAccessProbe = {
  ready: boolean;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
};

/**
 * Preflight for inbound candidate sync / employer Zoho search.
 * Does not log tokens or candidate PII. Optional live probe hits Zoho once.
 */
export async function probeZohoCandidateAccess(options?: {
  live?: boolean;
}): Promise<ZohoCandidateAccessProbe> {
  const checks: ZohoCandidateAccessProbe["checks"] = [];
  const client = createServiceRoleClient();
  const gates = await getZohoRecruitGateStatus();

  if (!client) {
    checks.push({
      id: "service_role",
      ok: false,
      detail: "Server service credential is not configured.",
    });
    return { ready: false, checks };
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
      ? `Connected${connection?.zoho_org_name ? ` (${connection.zoho_org_name})` : ""}${
          connection?.api_domain ? ` via configured API domain` : ""
        }.`
      : "Not connected — complete HQ OAuth Connect (or Self Client grant) against the target Zoho Recruit org.",
  });

  const granted = (connection?.granted_scopes as string[] | undefined) ?? [];
  const missing = scopesMissing(granted, ZOHO_RECRUIT_SYNC_SCOPES);
  const grantedSet = new Set(granted.map((s) => s.trim()).filter(Boolean));
  const hasCandidateRead =
    grantedSet.has("ZohoRecruit.modules.ALL") ||
    grantedSet.has("ZohoRecruit.modules.READ") ||
    grantedSet.has("ZohoRecruit.modules.candidates.READ") ||
    grantedSet.has("ZohoRecruit.modules.candidates.ALL") ||
    grantedSet.has("ZohoRecruit.modules.candidate.ALL") ||
    missing.length === 0;
  checks.push({
    id: "candidate_read_scope",
    ok: connected && hasCandidateRead,
    detail: !connected
      ? "Connect first."
      : hasCandidateRead
        ? "Candidate access scope is present."
        : `Missing candidate/settings scopes: ${missing.join(", ") || "candidates.ALL"}. Disconnect and reconnect.`,
  });

  const inboundAllowed =
    gates.syncAllowed && (gates.productionExportAllowed || gates.sandboxExportAllowed);
  checks.push({
    id: "sync_gates",
    ok: inboundAllowed,
    detail: inboundAllowed
      ? "Sync gates allow inbound candidate pull."
      : gates.syncAllowed
        ? "Master+data-sync are on, but neither production nor sandbox gate is on — enable one for pull."
        : `Sync blocked: ${gates.blockedReasons.join("; ") || "gates off"}.`,
  });

  checks.push({
    id: "not_paused",
    ok: !connection?.sync_paused_at,
    detail: connection?.sync_paused_at ? "Connection sync is paused." : "Connection is not paused.",
  });

  const baseReady = connected && hasCandidateRead && inboundAllowed && !connection?.sync_paused_at;

  if (options?.live && baseReady) {
    try {
      await getFields("Candidates");
      checks.push({
        id: "live_fields",
        ok: true,
        detail: "Candidates field metadata endpoint responded.",
      });
    } catch {
      checks.push({
        id: "live_fields",
        ok: false,
        detail:
          "Could not read Candidates field metadata. Check org, scopes, and data-center domain.",
      });
    }

    try {
      await listRecords("Candidates", { page: 1, per_page: 1, fields: ["id"] });
      checks.push({
        id: "live_list",
        ok: true,
        detail: "Candidates list endpoint responded.",
      });
    } catch {
      checks.push({
        id: "live_list",
        ok: false,
        detail: "Could not list Candidates. Check org access and API domain.",
      });
    }
  } else if (options?.live) {
    checks.push({
      id: "live_skipped",
      ok: false,
      detail: "Live probe skipped because connection/gates are not ready.",
    });
  }

  return { ready: checks.every((c) => c.ok), checks };
}
