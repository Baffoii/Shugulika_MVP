import { describe, expect, it } from "vitest";
import {
  evaluateExportEligibility,
  type OfflineCaseSnapshot,
} from "@/lib/integrations/zoho-recruit/eligibility";
import { buildGateStatus } from "@/lib/integrations/zoho-recruit/gates";

const CASE: OfflineCaseSnapshot = {
  id: "11111111-1111-1111-1111-111111111111",
  connection_id: "22222222-2222-2222-2222-222222222222",
  local_entity_type: "candidate",
  local_entity_id: "33333333-3333-3333-3333-333333333333",
  status: "approved",
  is_synthetic: true,
  legal_hold: false,
  processing_purpose: "offline_recruitment_satellite",
  restriction_reason: null,
};

describe("Zoho export eligibility", () => {
  it("blocks when sync gates are off", () => {
    const decision = evaluateExportEligibility({
      gates: buildGateStatus({}),
      offlineCase: CASE,
      consents: [{ id: "c1", purpose: "offline_recruitment_satellite", withdrawn_at: null }],
      productionApproval: null,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some((r) => /enabled is off|data_sync/i.test(r))).toBe(true);
  });

  it("allows synthetic export when sandbox + data sync gates and consent are present", () => {
    const decision = evaluateExportEligibility({
      gates: buildGateStatus({
        zoho_recruit_enabled: true,
        zoho_recruit_data_sync_enabled: true,
        zoho_recruit_sandbox_sync_enabled: true,
      }),
      offlineCase: CASE,
      consents: [{ id: "c1", purpose: "profile_processing", withdrawn_at: null }],
      productionApproval: null,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.matchingConsentIds).toEqual(["c1"]);
  });

  it("blocks restricted, withdrawn, and legal_hold cases", () => {
    const gates = buildGateStatus({
      zoho_recruit_enabled: true,
      zoho_recruit_data_sync_enabled: true,
      zoho_recruit_sandbox_sync_enabled: true,
    });
    const consent = [{ id: "c1", purpose: "offline_recruitment_satellite", withdrawn_at: null }];

    expect(
      evaluateExportEligibility({
        gates,
        offlineCase: { ...CASE, status: "restricted" },
        consents: consent,
        productionApproval: null,
      }).allowed,
    ).toBe(false);

    expect(
      evaluateExportEligibility({
        gates,
        offlineCase: { ...CASE, status: "withdrawn" },
        consents: consent,
        productionApproval: null,
      }).allowed,
    ).toBe(false);

    expect(
      evaluateExportEligibility({
        gates,
        offlineCase: { ...CASE, legal_hold: true },
        consents: consent,
        productionApproval: null,
      }).allowed,
    ).toBe(false);
  });

  it("requires production gates and recorded approval for non-synthetic cases", () => {
    const base = {
      offlineCase: { ...CASE, is_synthetic: false },
      consents: [{ id: "c1", purpose: "offline_recruitment_satellite", withdrawn_at: null }],
    };

    expect(
      evaluateExportEligibility({
        ...base,
        gates: buildGateStatus({
          zoho_recruit_enabled: true,
          zoho_recruit_data_sync_enabled: true,
          zoho_recruit_sandbox_sync_enabled: true,
        }),
        productionApproval: null,
      }).allowed,
    ).toBe(false);

    expect(
      evaluateExportEligibility({
        ...base,
        gates: buildGateStatus({
          zoho_recruit_enabled: true,
          zoho_recruit_data_sync_enabled: true,
          zoho_recruit_production_data_enabled: true,
        }),
        productionApproval: { id: "a1", status: "recorded" },
      }).allowed,
    ).toBe(true);
  });

  it("does not require candidate consent for job offline cases", () => {
    const decision = evaluateExportEligibility({
      gates: buildGateStatus({
        zoho_recruit_enabled: true,
        zoho_recruit_data_sync_enabled: true,
        zoho_recruit_sandbox_sync_enabled: true,
      }),
      offlineCase: { ...CASE, local_entity_type: "job" },
      consents: [],
      productionApproval: null,
    });
    expect(decision.allowed).toBe(true);
  });
});
