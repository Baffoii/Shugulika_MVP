import { describe, expect, it } from "vitest";
import { purposeLabel } from "@/lib/ai-purpose-labels";

describe("purposeLabel", () => {
  it("maps known OpenAI purposes to human labels", () => {
    expect(purposeLabel("cv_field_extraction")).toBe("CV field extraction");
    expect(purposeLabel("cv_professional_copy")).toBe("Professional summary / headline draft");
    expect(purposeLabel("cv_role_fit_screen")).toBe("Application role-fit screening");
  });

  it("falls back for unknown purposes", () => {
    expect(purposeLabel("some_new_thing")).toBe("some new thing");
  });
});
