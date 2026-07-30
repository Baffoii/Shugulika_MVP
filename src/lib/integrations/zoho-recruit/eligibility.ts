import "server-only";

import { getZohoRecruitGateStatus, type GateStatus } from "@/lib/integrations/zoho-recruit/gates";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Preferred purpose for offline satellite projection. */
export const OFFLINE_RECRUITMENT_SATELLITE_PURPOSE = "offline_recruitment_satellite";

/**
 * Active consent purposes that may authorize a candidate export when an
 * offline_recruitment_satellite row is not yet present. Matches purposes used
 * in the codebase (profile / application document sharing).
 */
export const ZOHO_EXPORT_FALLBACK_CONSENT_PURPOSES = [
  "profile_processing",
  "share_document",
] as const;

export const ZOHO_EXPORT_CONSENT_PURPOSES = [
  OFFLINE_RECRUITMENT_SATELLITE_PURPOSE,
  ...ZOHO_EXPORT_FALLBACK_CONSENT_PURPOSES,
] as const;

export type OfflineCaseStatus = "draft" | "approved" | "restricted" | "withdrawn" | "closed";

export interface OfflineCaseSnapshot {
  id: string;
  connection_id: string;
  local_entity_type: "candidate" | "job";
  local_entity_id: string;
  status: OfflineCaseStatus;
  is_synthetic: boolean;
  legal_hold: boolean;
  processing_purpose: string;
  restriction_reason: string | null;
}

export interface ConsentSnapshot {
  id: string;
  purpose: string;
  withdrawn_at: string | null;
}

export interface ProductionApprovalSnapshot {
  id: string;
  status: "recorded" | "revoked";
}

export interface EligibilityDecision {
  allowed: boolean;
  reasons: string[];
  offlineCaseId: string | null;
  isSynthetic: boolean;
  matchingConsentIds: string[];
  gates: GateStatus;
}

export interface EvaluateEligibilityInput {
  gates: GateStatus;
  offlineCase: OfflineCaseSnapshot | null;
  consents: ConsentSnapshot[];
  productionApproval: ProductionApprovalSnapshot | null;
}

/** Pure eligibility check — re-run at outbox execution time. */
export function evaluateExportEligibility(input: EvaluateEligibilityInput): EligibilityDecision {
  const reasons: string[] = [];
  const { gates, offlineCase, consents, productionApproval } = input;

  if (!gates.syncAllowed) {
    reasons.push(...(gates.blockedReasons.length ? gates.blockedReasons : ["sync gates disabled"]));
    return {
      allowed: false,
      reasons,
      offlineCaseId: offlineCase?.id ?? null,
      isSynthetic: offlineCase?.is_synthetic ?? true,
      matchingConsentIds: [],
      gates,
    };
  }

  if (!offlineCase) {
    reasons.push("no approved offline case");
    return emptyDenied(reasons, gates, true);
  }

  if (offlineCase.legal_hold) {
    reasons.push("legal_hold blocks export");
  }
  if (offlineCase.status === "restricted") {
    reasons.push("offline case is restricted");
  }
  if (offlineCase.status === "withdrawn") {
    reasons.push("offline case is withdrawn");
  }
  if (offlineCase.status !== "approved") {
    if (offlineCase.status !== "restricted" && offlineCase.status !== "withdrawn") {
      reasons.push(`offline case status is ${offlineCase.status}, expected approved`);
    }
  }

  if (offlineCase.is_synthetic) {
    if (!gates.sandboxExportAllowed) {
      reasons.push("synthetic records require sandbox_sync + data_sync gates");
    }
  } else {
    if (!gates.productionExportAllowed) {
      reasons.push("production records require data_sync + production_data gates");
    }
    if (!productionApproval || productionApproval.status !== "recorded") {
      reasons.push("production export requires a recorded zoho_recruit_production_approvals row");
    }
  }

  const matchingConsentIds: string[] = [];
  if (offlineCase.local_entity_type === "candidate") {
    const active = consents.filter((c) => c.withdrawn_at == null);
    const preferred = active.filter((c) => c.purpose === OFFLINE_RECRUITMENT_SATELLITE_PURPOSE);
    const fallback = active.filter((c) =>
      (ZOHO_EXPORT_FALLBACK_CONSENT_PURPOSES as readonly string[]).includes(c.purpose),
    );
    const matched = preferred.length > 0 ? preferred : fallback;
    if (matched.length === 0) {
      reasons.push(
        "no active candidate consent for offline_recruitment_satellite or application-style purposes",
      );
    } else {
      matchingConsentIds.push(...matched.map((c) => c.id));
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    offlineCaseId: offlineCase.id,
    isSynthetic: offlineCase.is_synthetic,
    matchingConsentIds,
    gates,
  };
}

function emptyDenied(
  reasons: string[],
  gates: GateStatus,
  isSynthetic: boolean,
): EligibilityDecision {
  return {
    allowed: false,
    reasons,
    offlineCaseId: null,
    isSynthetic,
    matchingConsentIds: [],
    gates,
  };
}

export async function checkExportEligibility(input: {
  connectionId: string;
  localEntityType: "candidate" | "job";
  localEntityId: string;
}): Promise<EligibilityDecision> {
  const gates = await getZohoRecruitGateStatus();
  const client = createServiceRoleClient();
  if (!client) {
    return emptyDenied(["service role unavailable"], gates, true);
  }

  const { data: offlineCaseRow } = await client
    .from("zoho_recruit_offline_cases")
    .select(
      "id, connection_id, local_entity_type, local_entity_id, status, is_synthetic, legal_hold, processing_purpose, restriction_reason",
    )
    .eq("connection_id", input.connectionId)
    .eq("local_entity_type", input.localEntityType)
    .eq("local_entity_id", input.localEntityId)
    .maybeSingle();

  const offlineCase = (offlineCaseRow as OfflineCaseSnapshot | null) ?? null;

  let consents: ConsentSnapshot[] = [];
  if (input.localEntityType === "candidate") {
    const { data: consentRows } = await client
      .from("candidate_consents")
      .select("id, purpose, withdrawn_at")
      .eq("candidate_id", input.localEntityId)
      .in("purpose", [...ZOHO_EXPORT_CONSENT_PURPOSES])
      .is("withdrawn_at", null);
    consents = (consentRows as ConsentSnapshot[] | null) ?? [];
  }

  let productionApproval: ProductionApprovalSnapshot | null = null;
  if (offlineCase && !offlineCase.is_synthetic) {
    const { data: approval } = await client
      .from("zoho_recruit_production_approvals")
      .select("id, status")
      .eq("connection_id", input.connectionId)
      .eq("status", "recorded")
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    productionApproval = (approval as ProductionApprovalSnapshot | null) ?? null;
  }

  return evaluateExportEligibility({
    gates,
    offlineCase,
    consents,
    productionApproval,
  });
}
