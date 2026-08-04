import { describe, expect, it } from "vitest";
import { toLockedEmployerZohoCandidateDto } from "@/lib/integrations/zoho-recruit/candidate-dto";
import type { NormalizedZohoSearchCandidate } from "@/lib/integrations/zoho-recruit/candidate-normalize";

const sample: NormalizedZohoSearchCandidate = {
  zohoCandidateId: "5123456789012345678",
  teaserLabel: "Nurse",
  fullName: "Ada Lovelace",
  givenName: "Ada",
  familyName: "Lovelace",
  email: "ada@example.com",
  phone: "+255700000000",
  jobTitle: "Nurse",
  employerOrIndustry: "Health",
  industry: "Health",
  skills: ["ICU"],
  yearsExperience: 4,
  qualification: "BSc",
  city: "Dar es Salaam",
  country: "Tanzania",
  countryCode: null,
  candidateStatus: "New",
  availability: "Immediately",
  hasResume: true,
  zohoAttachmentId: "999",
  searchEligible: true,
  consentOrVisibility: null,
  zohoCreatedAt: null,
  zohoModifiedAt: null,
  eligibility: { eligible: true, reasons: [], status: "New", consentOrVisibility: null },
};

describe("toLockedEmployerZohoCandidateDto", () => {
  it("never includes email, phone, full name, or attachment ids", () => {
    const dto = toLockedEmployerZohoCandidateDto(sample);
    const json = JSON.stringify(dto);
    expect(json).not.toMatch(/ada@example\.com/i);
    expect(json).not.toMatch(/\+255/);
    expect(json).not.toMatch(/Lovelace/);
    expect(json).not.toMatch(/999/);
    expect(dto).not.toHaveProperty("email");
    expect(dto).not.toHaveProperty("phone");
    expect(dto).not.toHaveProperty("fullName");
    expect(dto).not.toHaveProperty("zohoAttachmentId");
    expect(dto.isUnlocked).toBe(false);
    expect(dto.teaserLabel).toBe("Nurse");
  });
});
