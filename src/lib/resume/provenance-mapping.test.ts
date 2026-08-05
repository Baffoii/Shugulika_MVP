import { describe, it, expect } from "vitest";
import {
  buildExtractionProvenance,
  personalFieldConfidence,
} from "@/lib/resume/provenance-mapping";
import type { ResumeExtraction } from "@/lib/resume/extraction-schema";

const CONTEXT = {
  candidateId: "cand-1",
  parseRunId: "run-1",
  parserVersion: "openai:gpt-4.1-mini",
  extractedAt: "2026-08-05T00:00:00.000Z",
};

function personalField(value: string, confidence = 0.9) {
  return { value, confidence, evidence_text: `…${value}…` };
}

function extraction(over: Partial<ResumeExtraction> = {}): ResumeExtraction {
  return {
    personal: {
      given_name: personalField("Asha"),
      middle_name: null,
      family_name: personalField("Mwakalinga"),
      phone: personalField("0712345678", 0.7),
      email: null,
      headline: null,
      summary: null,
      city: personalField("Dar es Salaam", 0.55),
      country_code: null,
      availability: null,
      ...over.personal,
    },
    experience: over.experience ?? [],
    education: over.education ?? [],
    skills: over.skills ?? [],
    certifications: over.certifications ?? [],
    languages: over.languages ?? [],
  };
}

describe("buildExtractionProvenance", () => {
  it("records one row per extracted profile field, with its parser and confidence", () => {
    const rows = buildExtractionProvenance(extraction(), CONTEXT);
    const givenName = rows.find((r) => r.fieldPath === "given_name");

    expect(givenName).toMatchObject({
      candidateId: "cand-1",
      targetEntity: "profile",
      source: "cv_parse",
      valueText: "Asha",
      confidence: 0.9,
      parserVersion: "openai:gpt-4.1-mini",
      parseRunId: "run-1",
      extractedAt: "2026-08-05T00:00:00.000Z",
      confirmedAt: null,
      confirmedBy: null,
    });
  });

  it("skips fields the parser produced nothing for", () => {
    const paths = buildExtractionProvenance(extraction(), CONTEXT).map((r) => r.fieldPath);
    expect(paths).not.toContain("email");
    expect(paths).not.toContain("middle_name");
  });

  it("records low-confidence values too — the confidence is the point", () => {
    const city = buildExtractionProvenance(extraction(), CONTEXT).find(
      (r) => r.fieldPath === "city",
    );
    expect(city?.confidence).toBe(0.55);
  });

  it("keys collection rows by their normalized natural key, not a row id", () => {
    const rows = buildExtractionProvenance(
      extraction({
        experience: [
          {
            title: "Accountant",
            employer_name: "ACME (T) Limited",
            location: null,
            start_date: "2020-01-01",
            end_date: null,
            is_current: true,
            description: null,
            confidence: 0.8,
            evidence_text: null,
          },
        ],
        education: [
          {
            institution: "The University of Dodoma",
            qualification: "BSc",
            field_of_study: null,
            start_date: null,
            end_date: "2019-01-01",
            is_current: false,
            confidence: 0.75,
            evidence_text: null,
          },
        ],
        skills: [{ name: "JS", confidence: 0.6, evidence_text: null }],
      }),
      CONTEXT,
    );

    expect(rows.find((r) => r.targetEntity === "experience")?.fieldPath).toBe("experience:acme");
    expect(rows.find((r) => r.targetEntity === "education")?.fieldPath).toBe(
      "education:university dodoma",
    );
    expect(rows.find((r) => r.targetEntity === "skill")?.fieldPath).toBe("skill:javascript");
  });

  it("keeps the same key when the same employer is spelled differently next time", () => {
    const keyFor = (employer: string) =>
      buildExtractionProvenance(
        extraction({
          experience: [
            {
              title: "Accountant",
              employer_name: employer,
              location: null,
              start_date: null,
              end_date: null,
              is_current: false,
              description: null,
              confidence: 0.8,
              evidence_text: null,
            },
          ],
        }),
        CONTEXT,
      ).find((r) => r.targetEntity === "experience")?.fieldPath;

    expect(keyFor("Acme Ltd")).toBe(keyFor("ACME (T) Limited"));
  });

  it("returns nothing for an extraction that found nothing", () => {
    const empty = extraction({
      personal: {
        given_name: null,
        middle_name: null,
        family_name: null,
        phone: null,
        email: null,
        headline: null,
        summary: null,
        city: null,
        country_code: null,
        availability: null,
      },
    });
    expect(buildExtractionProvenance(empty, CONTEXT)).toEqual([]);
  });
});

describe("personalFieldConfidence", () => {
  it("reads the confidence of a field, or null when it is absent", () => {
    expect(personalFieldConfidence(extraction(), "given_name")).toBe(0.9);
    expect(personalFieldConfidence(extraction(), "email")).toBeNull();
  });
});
