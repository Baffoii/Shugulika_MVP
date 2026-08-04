import { describe, expect, it } from "vitest";
import {
  buildCandidateZohoData,
  buildJobOpeningZohoData,
  candidateOutboxPayload,
} from "@/lib/integrations/zoho-recruit/projection";

describe("sandbox Zoho projection payloads", () => {
  it("uses only standard Candidate fields and never Shugulika_ID", () => {
    const data = buildCandidateZohoData({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+255700000000",
      city: "Dar es Salaam",
      country: "Tanzania",
    });
    expect(data).toEqual({
      Full_Name: "Ada Lovelace",
      Email: "ada@example.com",
      Mobile: "+255700000000",
      City: "Dar es Salaam",
      Country: "Tanzania",
    });
    expect(data).not.toHaveProperty("Shugulika_ID");
    expect(candidateOutboxPayload({ fullName: "Ada" }).module).toBe("Candidates");
  });

  it("uses Job_Opening_Name only for jobs", () => {
    expect(buildJobOpeningZohoData({ title: "Nurse" })).toEqual({
      Job_Opening_Name: "Nurse",
    });
    expect(buildJobOpeningZohoData({ title: "  " })).toEqual({});
  });
});
