import { describe, expect, it } from "vitest";
import { isZohoCandidateSearchEligible } from "@/lib/integrations/zoho-recruit/candidate-eligibility";
import type { CandidateFieldMapping } from "@/lib/integrations/zoho-recruit/candidate-field-map";

const mapping: CandidateFieldMapping = {
  status: "Candidate_Status",
  converted: "$converted",
  portalEligible: "Portal_Eligible",
  profileVisibility: "Profile_Visibility",
  consentStatus: "Consent_Status",
};

describe("isZohoCandidateSearchEligible", () => {
  it("allows records without blocking signals", () => {
    const result = isZohoCandidateSearchEligible(
      { Candidate_Status: "New", $converted: false },
      mapping,
    );
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects converted candidates when the field is present", () => {
    const result = isZohoCandidateSearchEligible({ $converted: true }, mapping);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("converted");
  });

  it("rejects clearly ineligible statuses when status field is mapped", () => {
    const result = isZohoCandidateSearchEligible(
      { Candidate_Status: "Rejected - not a fit" },
      mapping,
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("ineligible_status");
  });

  it("enforces portal/visibility/consent only when those fields are mapped", () => {
    expect(isZohoCandidateSearchEligible({ Portal_Eligible: false }, mapping).reasons).toContain(
      "portal_not_eligible",
    );
    expect(
      isZohoCandidateSearchEligible({ Profile_Visibility: "Private" }, mapping).reasons,
    ).toContain("profile_not_visible");
    expect(
      isZohoCandidateSearchEligible({ Consent_Status: "Withdrawn" }, mapping).reasons,
    ).toContain("consent_not_granted");
  });

  it("does not invent status rules when status is unmapped", () => {
    const result = isZohoCandidateSearchEligible(
      { Candidate_Status: "Rejected" },
      { converted: "$converted" },
    );
    expect(result.eligible).toBe(true);
  });
});
