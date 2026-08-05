/**
 * Regression guard: nationality is never a screening, matching, or ranking
 * signal.
 *
 * Tanzania's Employment and Labour Relations Act prohibits employment
 * discrimination on nationality and covers applicants, so this is a legal
 * constraint rather than a preference. The rule has three surfaces and this
 * file covers all three:
 *
 *   1. The AI screening prompt must explicitly instruct the model not to
 *      consider protected characteristics.
 *   2. No screening or ATS module may read a protected characteristic off a
 *      record.
 *   3. The Zoho import must refuse — not silently strip — a source record that
 *      carries one.
 *
 * The tests read the source tree directly, so a future contributor cannot
 * reintroduce the field by adding a new module.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM_PROMPT } from "@/lib/screening/score-application";
import { PROHIBITED_IMPORT_FIELDS, isProhibitedImportField } from "@/lib/candidates/constants";
import { mapZohoCandidate } from "@/lib/integrations/zoho-recruit/import/mapping";
import { isWaivable } from "@/lib/integrations/zoho-recruit/import/quarantine";

const PROTECTED_TERMS = [
  "nationality",
  "citizenship",
  "national_origin",
  "ethnicity",
  "religion",
] as const;

const SCREENING_DIR = join(process.cwd(), "src", "lib", "screening");
const CANDIDATES_DIR = join(process.cwd(), "src", "lib", "candidates");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(dir, f));
}

describe("AI screening prompt", () => {
  it("instructs the model to ignore protected characteristics", () => {
    const prompt = SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("nationality");
    expect(prompt).toContain("do not consider");
    // Named alongside the other protected characteristics, not in isolation.
    for (const term of ["age", "gender", "ethnicity", "religion", "marital"]) {
      expect(prompt).toContain(term);
    }
  });

  it("scopes the assessment to capability and relevant experience", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("assess capability and relevant experience only");
  });

  it("never asks the model to score, rank, or filter on a protected characteristic", () => {
    const prompt = SYSTEM_PROMPT.toLowerCase();
    for (const term of PROTECTED_TERMS) {
      const index = prompt.indexOf(term);
      if (index === -1) continue;
      // Every mention must sit inside the prohibition sentence.
      const sentence = prompt.slice(Math.max(0, index - 200), index + 200);
      expect(sentence).toMatch(/do not consider|never|prohibit/);
    }
  });
});

describe("screening modules", () => {
  it("read no protected characteristic off any record", () => {
    for (const file of sourceFiles(SCREENING_DIR)) {
      const source = readFileSync(file, "utf8").toLowerCase();
      for (const term of PROTECTED_TERMS) {
        if (!source.includes(term)) continue;
        // score-application.ts names them only to ban them in the prompt.
        expect(file.endsWith("score-application.ts")).toBe(true);
      }
    }
  });

  it("never expose a protected characteristic as a scoring input", () => {
    const schema = readFileSync(join(SCREENING_DIR, "screening-schema.ts"), "utf8").toLowerCase();
    for (const term of PROTECTED_TERMS) {
      expect(schema).not.toContain(term);
    }
  });
});

/**
 * Comments are allowed to name a protected characteristic — several modules
 * document that they deliberately do not read one. Executable code is not.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("ATS candidate modules", () => {
  it("name protected characteristics only in the prohibited-field list", () => {
    for (const file of sourceFiles(CANDIDATES_DIR)) {
      const code = stripComments(readFileSync(file, "utf8")).toLowerCase();
      for (const term of PROTECTED_TERMS) {
        if (!code.includes(term)) continue;
        // constants.ts holds the ban list itself. No other module's executable
        // code may so much as name one of these.
        expect(file.endsWith("constants.ts")).toBe(true);
      }
    }
  });

  it("treat nationality and its synonyms as prohibited on import", () => {
    for (const term of ["nationality", "nationalities", "citizenship", "national_origin"]) {
      expect(PROHIBITED_IMPORT_FIELDS as readonly string[]).toContain(term);
      expect(isProhibitedImportField(term)).toBe(true);
    }
  });

  it("normalize casing and spacing before checking the ban list", () => {
    expect(isProhibitedImportField("Nationality")).toBe(true);
    expect(isProhibitedImportField("  MARITAL STATUS ")).toBe(true);
    expect(isProhibitedImportField("Marital Status")).toBe(true);
    expect(isProhibitedImportField("skills")).toBe(false);
  });
});

describe("Zoho import", () => {
  const countries = [{ code: "TZ", name: "Tanzania" }];

  it("quarantines a source record carrying nationality instead of stripping it", () => {
    const result = mapZohoCandidate(
      {
        id: "z-1",
        First_Name: "Asha",
        Last_Name: "Mwakalinga",
        Email: "asha@example.com",
        Nationality: "Tanzanian",
      },
      { countries },
    );

    expect(result.problems).toContain("prohibited_field_present");
    expect(result.prohibitedFields).toEqual(["Nationality"]);
    // Silently dropping it would hide a compliance problem upstream.
    expect(result.prohibitedFields.length).toBeGreaterThan(0);
  });

  it("never lets a prohibited-field quarantine be waived through", () => {
    expect(isWaivable(["prohibited_field_present"])).toBe(false);
  });

  it("keeps the value out of the canonical draft entirely", () => {
    const result = mapZohoCandidate(
      {
        id: "z-2",
        First_Name: "Juma",
        Last_Name: "Nyerere",
        Email: "juma@example.com",
        Nationality: "Kenyan",
        Citizenship: "Kenya",
        Ethnicity: "Luo",
      },
      { countries },
    );

    const serialized = JSON.stringify(result.draft).toLowerCase();
    for (const value of ["kenyan", "luo"]) {
      expect(serialized).not.toContain(value);
    }
    for (const key of PROTECTED_TERMS) {
      expect(serialized).not.toContain(key);
    }
  });
});

describe("work authorization is not nationality", () => {
  it("stores no nationality column", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260809093000_work_authorization.sql"),
      "utf8",
    );

    // The migration discusses the ban in comments; the table definition itself
    // must not declare a column for any of these.
    const tableStart = migration.indexOf(
      "create table if not exists public.candidate_work_authorizations",
    );
    const tableEnd = migration.indexOf(");", tableStart);
    const tableBody = migration.slice(tableStart, tableEnd).toLowerCase();

    for (const term of PROTECTED_TERMS) {
      expect(tableBody).not.toContain(term);
    }
    // What it does store: where the work would happen, and whether a permit is needed.
    expect(tableBody).toContain("work_country_code");
    expect(tableBody).toContain("eligibility_status");
  });

  it("ships with the feature flag off", () => {
    const migration = readFileSync(
      join(process.cwd(), "supabase", "migrations", "20260809093000_work_authorization.sql"),
      "utf8",
    );
    expect(migration).toMatch(/'work_authorization_fields_enabled',\s*false/);
  });
});
