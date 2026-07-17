import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateTime,
  relativeDays,
  formatMoney,
  salaryRange,
  initials,
  titleCase,
} from "@/lib/format";

describe("formatDate / formatDateTime", () => {
  it("returns an em dash for null/undefined/invalid", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("garbage")).toBe("—");
  });
  it("formats a valid ISO date", () => {
    expect(formatDate("2026-07-16")).toMatch(/2026/);
    expect(formatDateTime("2026-07-16T09:42:00Z")).toMatch(/2026/);
  });
});

describe("relativeDays", () => {
  it("handles empty and boundary values", () => {
    expect(relativeDays(null)).toBe("");
    expect(relativeDays("bad")).toBe("");
    const today = new Date().toISOString();
    expect(relativeDays(today)).toBe("Today");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    expect(relativeDays(tomorrow)).toBe("Tomorrow");
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(relativeDays(yesterday)).toBe("Yesterday");
    const in5 = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect(relativeDays(in5)).toBe("in 5 days");
    const ago3 = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(relativeDays(ago3)).toBe("3 days ago");
  });
});

describe("formatMoney", () => {
  it("returns an em dash for null/undefined", () => {
    expect(formatMoney(null, "TZS")).toBe("—");
    expect(formatMoney(undefined, null)).toBe("—");
  });
  it("formats known and unknown currencies", () => {
    expect(formatMoney(1500000, "TZS")).toMatch(/1,500,000|TZS/);
    // A well-formed but unreal code still formats with the code as the symbol
    // (Intl separates it with a non-breaking space), so match on parts.
    const zzz = formatMoney(1000, "ZZZ");
    expect(zzz).toContain("ZZZ");
    expect(zzz).toContain("1,000");
    // Defaults to TZS when currency missing
    expect(formatMoney(0, null)).toMatch(/TZS|0/);
  });
});

describe("salaryRange", () => {
  it("is Undisclosed when both bounds are null", () => {
    expect(salaryRange(null, null, "TZS")).toBe("Undisclosed");
  });
  it("shows a single bound or a range", () => {
    expect(salaryRange(1000, null, "TZS")).toMatch(/1,000|TZS/);
    expect(salaryRange(null, 2000, "TZS")).toMatch(/2,000|TZS/);
    expect(salaryRange(1000, 2000, "TZS")).toMatch(/–/);
  });
});

describe("initials", () => {
  it("uses the fallback for empty names", () => {
    expect(initials(null)).toBe("?");
    expect(initials("", "X")).toBe("X");
  });
  it("takes up to two uppercase initials", () => {
    expect(initials("Amina Hassan")).toBe("AH");
    expect(initials("madonna")).toBe("M");
    expect(initials("Jean Paul Sartre")).toBe("JP");
  });
});

describe("titleCase", () => {
  it("handles empty input", () => {
    expect(titleCase(null)).toBe("");
    expect(titleCase("")).toBe("");
  });
  it("converts snake/kebab case to Title Case", () => {
    expect(titleCase("client_submission")).toBe("Client Submission");
    expect(titleCase("no-show")).toBe("No Show");
  });
});
