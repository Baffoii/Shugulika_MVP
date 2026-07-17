import { describe, it, expect } from "vitest";
import {
  confidenceBand,
  matchExperience,
  matchEducation,
  matchCertification,
  matchLanguage,
} from "@/lib/resume-suggestions";

describe("confidenceBand", () => {
  it("maps high confidence (>=0.85)", () => {
    expect(confidenceBand(0.85)).toBe("high");
    expect(confidenceBand(1)).toBe("high");
  });
  it("maps medium confidence (>=0.6 and <0.85)", () => {
    expect(confidenceBand(0.6)).toBe("medium");
    expect(confidenceBand(0.84)).toBe("medium");
  });
  it("maps low confidence (<0.6)", () => {
    expect(confidenceBand(0.59)).toBe("low");
    expect(confidenceBand(0)).toBe("low");
  });
});

describe("matchExperience", () => {
  const existing = [
    { id: "e1", title: "Financial Analyst", employer_name: "Acme Bank" },
    { id: "e2", title: "Junior Accountant", employer_name: "Acme Bank" },
  ];
  it("matches on employer + title, case-insensitively", () => {
    expect(
      matchExperience(existing, { title: "financial analyst", employer_name: "ACME BANK" }),
    ).toBe("e1");
  });
  it("returns null when there is no confident match", () => {
    expect(
      matchExperience(existing, { title: "Financial Analyst", employer_name: "Other Corp" }),
    ).toBeNull();
  });
  it("returns null when the employer is missing", () => {
    expect(
      matchExperience(existing, { title: "Financial Analyst", employer_name: null }),
    ).toBeNull();
  });
});

describe("matchEducation", () => {
  const existing = [
    { id: "ed1", institution: "University of Dar es Salaam", qualification: "BCom" },
  ];
  it("matches on institution + qualification, case-insensitively", () => {
    expect(
      matchEducation(existing, {
        institution: "university of dar es salaam",
        qualification: "bcom",
      }),
    ).toBe("ed1");
  });
  it("returns null for a different institution", () => {
    expect(
      matchEducation(existing, { institution: "Ardhi University", qualification: "BCom" }),
    ).toBeNull();
  });
});

describe("matchCertification", () => {
  const existing = [{ id: "c1", name: "PMP", issuer: "PMI" }];
  it("matches on name + issuer, case-insensitively", () => {
    expect(matchCertification(existing, { name: "pmp", issuer: "pmi" })).toBe("c1");
  });
  it("returns null when the name has no match", () => {
    expect(matchCertification(existing, { name: "CFA", issuer: "PMI" })).toBeNull();
  });
});

describe("matchLanguage", () => {
  const existing = [{ id: "l1", language: "Swahili" }];
  it("matches on language name, case-insensitively", () => {
    expect(matchLanguage(existing, { language: "swahili" })).toBe("l1");
  });
  it("returns null for an unlisted language", () => {
    expect(matchLanguage(existing, { language: "French" })).toBeNull();
  });
});
