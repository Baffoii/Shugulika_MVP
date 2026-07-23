import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_PRESETS,
  SEARCH_APPROVED_FIELDS,
  SOURCED_CONTACT_STATUSES,
} from "@/lib/constants";

describe("candidate directory constants", () => {
  it("exposes the seven candidate-approved search fields", () => {
    expect(SEARCH_APPROVED_FIELDS.map((f) => f.key)).toEqual([
      "desired_roles",
      "country_city",
      "skills",
      "education_level",
      "experience_summary",
      "languages",
      "availability",
    ]);
  });

  it("defines sourced contact states in outreach order", () => {
    expect(SOURCED_CONTACT_STATUSES.map((s) => s.key)).toEqual([
      "not_contacted",
      "contacted",
      "interested",
      "declined",
    ]);
  });

  it("includes availability filter presets used by the directory", () => {
    expect(AVAILABILITY_PRESETS.length).toBeGreaterThan(0);
    expect(AVAILABILITY_PRESETS.some((p) => p.key === "Immediately")).toBe(true);
  });
});
