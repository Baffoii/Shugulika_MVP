import { describe, expect, it } from "vitest";
import { nextCandidateDeadline } from "@/lib/candidate/progress";

describe("candidate progress deadlines", () => {
  it("returns the nearest future deadline and ignores past/invalid values", () => {
    const result = nextCandidateDeadline(
      [
        { kind: "assessment", label: "Past", at: "2026-08-01T00:00:00Z", href: "/past" },
        { kind: "interview", label: "Later", at: "2026-08-09T00:00:00Z", href: "/later" },
        { kind: "application", label: "Next", at: "2026-08-06T00:00:00Z", href: "/next" },
        { kind: "application", label: "Invalid", at: "not-a-date", href: "/invalid" },
      ],
      new Date("2026-08-04T00:00:00Z"),
    );
    expect(result?.label).toBe("Next");
  });
});
