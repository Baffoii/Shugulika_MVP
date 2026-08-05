import { describe, expect, it } from "vitest";
import type { CandidateProfileRow } from "@/lib/database.types";
import type { CandidateDraft } from "@/lib/integrations/zoho-recruit/import/mapping";
import { buildConservativeCandidatePatch } from "@/lib/integrations/zoho-recruit/import/canonical-upsert";

const current = {
  id: "candidate-1",
  user_id: "user-1",
  given_name: "Asha",
  middle_name: null,
  family_name: "Mushi",
  contact_email: "asha@example.com",
  headline: "Human-confirmed headline",
  summary: null,
  country_code: "TZ",
  city: "Dar es Salaam",
  date_of_birth: null,
  availability: null,
  open_to_work: true,
  profile_status: "active",
  completion_pct: 50,
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
} satisfies CandidateProfileRow;

const draft: CandidateDraft = {
  givenName: "Asha Imported",
  middleName: "Neema",
  familyName: "Mushi Imported",
  email: "imported@example.com",
  phone: "+255700000000",
  city: "Arusha",
  countryCode: "TZ",
  headline: "Imported headline",
  summary: "Imported summary",
  availability: "2026-09-01",
  skills: [],
  experiences: [],
  education: [],
};

describe("canonical candidate import patch", () => {
  it("fills blanks without replacing established values on an existing candidate", () => {
    expect(buildConservativeCandidatePatch(current, draft, false)).toEqual({
      middle_name: "Neema",
      summary: "Imported summary",
      availability: "2026-09-01",
    });
  });

  it("writes the complete mapped identity for a newly provisioned candidate", () => {
    expect(buildConservativeCandidatePatch(current, draft, true)).toMatchObject({
      given_name: "Asha Imported",
      middle_name: "Neema",
      family_name: "Mushi Imported",
      contact_email: "imported@example.com",
      headline: "Imported headline",
      summary: "Imported summary",
      city: "Arusha",
      country_code: "TZ",
      availability: "2026-09-01",
    });
  });
});
