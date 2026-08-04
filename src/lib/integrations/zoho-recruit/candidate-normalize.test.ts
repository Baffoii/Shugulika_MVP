import { describe, expect, it } from "vitest";
import type { CandidateFieldMapping } from "@/lib/integrations/zoho-recruit/candidate-field-map";
import { normalizeZohoCandidateRecord } from "@/lib/integrations/zoho-recruit/candidate-normalize";

const mapping: CandidateFieldMapping = {
  zohoCandidateId: "id",
  firstName: "First_Name",
  lastName: "Last_Name",
  fullName: "Full_Name",
  email: "Email",
  phone: "Mobile",
  jobTitle: "Current_Job_Title",
  industry: "Industry",
  skills: "Skill_Set",
  yearsExperience: "Experience_in_Years",
  qualification: "Highest_Qualification_Held",
  city: "City",
  country: "Country",
  status: "Candidate_Status",
  availability: "Availability",
  converted: "$converted",
  attachmentPresent: "Is_Attachment_Present",
};

describe("normalizeZohoCandidateRecord", () => {
  it("keeps Zoho ids as strings and handles missing fields", () => {
    const normalized = normalizeZohoCandidateRecord(
      {
        id: "5123456789012345678",
        Current_Job_Title: "Nurse",
        Skill_Set: "ICU, Triage",
        $converted: false,
        Candidate_Status: "New",
      },
      mapping,
    );
    expect(normalized).not.toBeNull();
    expect(normalized!.zohoCandidateId).toBe("5123456789012345678");
    expect(typeof normalized!.zohoCandidateId).toBe("string");
    expect(normalized!.email).toBeNull();
    expect(normalized!.phone).toBeNull();
    expect(normalized!.skills).toEqual(["ICU", "Triage"]);
    expect(normalized!.searchEligible).toBe(true);
    expect(normalized!.teaserLabel).toBe("Nurse");
    expect(normalized!.hasResume).toBe(false);
  });

  it("sets hasResume from Is_Attachment_Present when Resume file field is absent", () => {
    const normalized = normalizeZohoCandidateRecord(
      {
        id: "497983000000876145",
        Current_Job_Title: "Technical IT Support Officer",
        Is_Attachment_Present: true,
        $converted: false,
        Candidate_Status: "New",
      },
      mapping,
    );
    expect(normalized!.hasResume).toBe(true);
    expect(normalized!.zohoAttachmentId).toBeNull();
  });

  it("never uses full name as the locked teaser when a title exists", () => {
    const normalized = normalizeZohoCandidateRecord(
      {
        id: "99",
        Full_Name: "Secret Person",
        Current_Job_Title: "Analyst",
        $converted: false,
      },
      mapping,
    );
    expect(normalized!.teaserLabel).toBe("Analyst");
    expect(normalized!.teaserLabel).not.toContain("Secret");
  });

  it("marks ineligible records without fabricating values", () => {
    const normalized = normalizeZohoCandidateRecord(
      {
        id: "1",
        Candidate_Status: "Blacklisted",
        Email: "x@example.com",
      },
      mapping,
    );
    expect(normalized!.searchEligible).toBe(false);
    expect(normalized!.eligibility.reasons).toContain("ineligible_status");
  });
});
