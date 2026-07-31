import { describe, expect, it } from "vitest";
import {
  buildCandidateFieldMapping,
  readMappedValue,
  zohoListFields,
} from "@/lib/integrations/zoho-recruit/candidate-field-map";

describe("buildCandidateFieldMapping", () => {
  it("maps preferred API names from metadata", () => {
    const mapping = buildCandidateFieldMapping([
      { api_name: "id", field_label: "Record Id" },
      { api_name: "Full_Name", field_label: "Candidate Name" },
      { api_name: "Skill_Set", field_label: "Skill Set" },
      { api_name: "Email", field_label: "Email" },
    ]);
    expect(mapping.fullName).toBe("Full_Name");
    expect(mapping.skills).toBe("Skill_Set");
    expect(mapping.email).toBe("Email");
    expect(mapping.zohoCandidateId).toBe("id");
  });

  it("falls back to label hints when preferred API names are absent", () => {
    const mapping = buildCandidateFieldMapping([
      { api_name: "Custom_Title", field_label: "Current Job Title" },
      { api_name: "Custom_City", field_label: "City" },
    ]);
    expect(mapping.jobTitle).toBe("Custom_Title");
    expect(mapping.city).toBe("Custom_City");
  });

  it("leaves unconfirmed fields unset rather than inventing names", () => {
    const mapping = buildCandidateFieldMapping([{ api_name: "id", field_label: "Record Id" }]);
    expect(mapping.portalEligible).toBeUndefined();
    expect(mapping.consentStatus).toBeUndefined();
  });
});

describe("zohoListFields / readMappedValue", () => {
  it("builds an explicit fields list including id", () => {
    const fields = zohoListFields({ zohoCandidateId: "id", jobTitle: "Current_Job_Title" });
    expect(fields).toContain("id");
    expect(fields).toContain("Current_Job_Title");
  });

  it("reads mapped values and keeps Zoho ids as strings", () => {
    const mapping = { zohoCandidateId: "id", email: "Email" } as const;
    const record = { id: "5123456789012345678", Email: "hidden@example.com" };
    expect(readMappedValue(record, mapping, "zohoCandidateId")).toBe("5123456789012345678");
    expect(typeof readMappedValue(record, mapping, "zohoCandidateId")).toBe("string");
  });
});
