import { describe, expect, it } from "vitest";
import { isZohoCandidateSearchEligible } from "@/lib/integrations/zoho-recruit/candidate-eligibility";
import type { CandidateFieldMapping } from "@/lib/integrations/zoho-recruit/candidate-field-map";

const fullMapping: CandidateFieldMapping = {
  status: "Candidate_Status",
  converted: "$converted",
  portalEligible: "Portal_Eligible",
  profileVisibility: "Profile_Visibility",
  consentStatus: "Consent_Status",
};

const portalOnly: CandidateFieldMapping = {
  status: "Candidate_Status",
  converted: "$converted",
  portalEligible: "Portal_Eligible",
};

const consentOnly: CandidateFieldMapping = {
  consentStatus: "Consent_Status",
};

const visibilityOnly: CandidateFieldMapping = {
  profileVisibility: "Profile_Visibility",
};

describe("isZohoCandidateSearchEligible (fail-closed)", () => {
  it("rejects when no consent-related mappings exist", () => {
    const result = isZohoCandidateSearchEligible(
      { Candidate_Status: "New", $converted: false },
      { status: "Candidate_Status", converted: "$converted" },
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("portal_consent_missing");
  });

  it("rejects when a mapped Portal_Eligible field is missing from the record", () => {
    const result = isZohoCandidateSearchEligible({ Candidate_Status: "New" }, portalOnly);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("portal_consent_missing");
  });

  it("rejects blank Portal_Eligible values", () => {
    const result = isZohoCandidateSearchEligible({ Portal_Eligible: "  " }, portalOnly);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("portal_consent_missing");
  });

  it("accepts explicit boolean true Portal_Eligible", () => {
    const result = isZohoCandidateSearchEligible({ Portal_Eligible: true }, portalOnly);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("rejects explicit boolean false Portal_Eligible", () => {
    const result = isZohoCandidateSearchEligible({ Portal_Eligible: false }, portalOnly);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("portal_not_eligible");
  });

  it("accepts affirmative portal text values", () => {
    for (const value of ["true", "Yes", "eligible", "Allowed", "opt-in", "granted"]) {
      const result = isZohoCandidateSearchEligible({ Portal_Eligible: value }, portalOnly);
      expect(result.eligible, value).toBe(true);
    }
  });

  it("rejects negative / unrecognized portal text", () => {
    expect(
      isZohoCandidateSearchEligible({ Portal_Eligible: "false" }, portalOnly).reasons,
    ).toContain("portal_not_eligible");
    expect(
      isZohoCandidateSearchEligible({ Portal_Eligible: "ineligible" }, portalOnly).reasons,
    ).toContain("portal_not_eligible");
    expect(
      isZohoCandidateSearchEligible({ Portal_Eligible: "maybe-later" }, portalOnly).reasons,
    ).toContain("portal_not_eligible");
  });

  it("accepts granted consent and rejects withdrawn consent", () => {
    expect(isZohoCandidateSearchEligible({ Consent_Status: "Granted" }, consentOnly).eligible).toBe(
      true,
    );
    const withdrawn = isZohoCandidateSearchEligible({ Consent_Status: "Withdrawn" }, consentOnly);
    expect(withdrawn.eligible).toBe(false);
    expect(withdrawn.reasons).toContain("consent_not_granted");
  });

  it("accepts public visibility and rejects private visibility", () => {
    expect(
      isZohoCandidateSearchEligible({ Profile_Visibility: "Public" }, visibilityOnly).eligible,
    ).toBe(true);
    const privateVis = isZohoCandidateSearchEligible(
      { Profile_Visibility: "Private" },
      visibilityOnly,
    );
    expect(privateVis.eligible).toBe(false);
    expect(privateVis.reasons).toContain("profile_not_visible");
  });

  it("rejects converted candidates even with affirmative portal consent", () => {
    const result = isZohoCandidateSearchEligible(
      { Portal_Eligible: true, $converted: true },
      fullMapping,
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("converted");
  });

  it("rejects disallowed statuses and does not treat status as consent", () => {
    const rejected = isZohoCandidateSearchEligible(
      { Candidate_Status: "Rejected - not a fit", Portal_Eligible: true },
      fullMapping,
    );
    expect(rejected.eligible).toBe(false);
    expect(rejected.reasons).toContain("ineligible_status");

    // Ordinary active status alone is never enough for eligibility.
    const statusOnly = isZohoCandidateSearchEligible(
      { Candidate_Status: "New" },
      { status: "Candidate_Status" },
    );
    expect(statusOnly.eligible).toBe(false);
    expect(statusOnly.reasons).toContain("portal_consent_missing");
  });

  it("lets restrictive signals win over affirmative ones when they conflict", () => {
    const result = isZohoCandidateSearchEligible(
      {
        Portal_Eligible: true,
        Consent_Status: "Withdrawn",
        Profile_Visibility: "Public",
      },
      fullMapping,
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("consent_not_granted");
  });

  it("requires every mapped consent field to affirm when multiple are mapped", () => {
    const missingConsent = isZohoCandidateSearchEligible(
      { Portal_Eligible: true, Profile_Visibility: "Public" },
      fullMapping,
    );
    expect(missingConsent.eligible).toBe(false);
    expect(missingConsent.reasons).toContain("portal_consent_missing");
  });

  it("prefers Portal_Eligible when it is the only mapped consent signal", () => {
    const result = isZohoCandidateSearchEligible(
      { Portal_Eligible: true, Candidate_Status: "New" },
      portalOnly,
    );
    expect(result.eligible).toBe(true);
    expect(result.consentOrVisibility).toContain("portal:");
  });

  it("does not invent status rules when status is unmapped", () => {
    const result = isZohoCandidateSearchEligible(
      { Candidate_Status: "Rejected", Portal_Eligible: true },
      { converted: "$converted", portalEligible: "Portal_Eligible" },
    );
    expect(result.eligible).toBe(true);
  });
});
