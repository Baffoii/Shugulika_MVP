import { describe, expect, it } from "vitest";
import { evaluateCandidateEligibility } from "@/lib/integrations/zoho-recruit/candidate-eligibility";
import { buildCandidateFieldMapping } from "@/lib/integrations/zoho-recruit/candidate-field-map";

describe("Zoho candidate consent eligibility", () => {
  it("discovers customized consent fields from metadata", () => {
    expect(
      buildCandidateFieldMapping([
        { api_name: "Custom_Consent", field_label: "Consent Status" },
        { api_name: "Portal_Eligible" },
      ]),
    ).toEqual({ consentStatus: "Custom_Consent", portalEligible: "Portal_Eligible" });
  });

  it("fails closed when no consent field is mapped or its value is absent", () => {
    expect(evaluateCandidateEligibility({ Candidate_Status: "New" }, {}).reasons).toContain(
      "portal_consent_missing",
    );
    expect(
      evaluateCandidateEligibility({}, { portalEligible: "Portal_Eligible" }).reasons,
    ).toContain("portal_consent_missing");
  });

  it("accepts explicit permission and lets any restrictive signal win", () => {
    expect(
      evaluateCandidateEligibility({ Portal_Eligible: true }, { portalEligible: "Portal_Eligible" })
        .eligible,
    ).toBe(true);
    const withdrawn = evaluateCandidateEligibility(
      { Portal_Eligible: true, Consent_Status: "Withdrawn" },
      { portalEligible: "Portal_Eligible", consentStatus: "Consent_Status" },
    );
    expect(withdrawn.eligible).toBe(false);
    expect(withdrawn.reasons).toContain("consent_not_granted");
  });

  it("rejects converted and ineligible candidates even with consent", () => {
    const result = evaluateCandidateEligibility(
      { Portal_Eligible: true, Converted: true, Candidate_Status: "Do not contact" },
      {
        portalEligible: "Portal_Eligible",
        converted: "Converted",
        status: "Candidate_Status",
      },
    );
    expect(result.reasons).toEqual(expect.arrayContaining(["converted", "ineligible_status"]));
  });
});
