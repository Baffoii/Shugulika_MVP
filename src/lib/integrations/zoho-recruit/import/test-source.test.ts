import { describe, it, expect } from "vitest";
import {
  assertTestMigrationAllowed,
  forceEligibleSource,
  TestMigrationGuardError,
} from "@/lib/integrations/zoho-recruit/import/test-source";
import { fixtureZohoCandidateSource } from "@/lib/integrations/zoho-recruit/import/source";

const SAFE_ENV = {
  ZOHO_TEST_MIGRATION: "true",
  NODE_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "https://rehearsal.supabase.co",
} as unknown as NodeJS.ProcessEnv;

describe("assertTestMigrationAllowed", () => {
  it("allows an explicitly acknowledged non-production run", () => {
    expect(() => assertTestMigrationAllowed(SAFE_ENV)).not.toThrow();
  });

  it("refuses unless the consent bypass is explicitly acknowledged", () => {
    const env = { ...SAFE_ENV, ZOHO_TEST_MIGRATION: undefined } as NodeJS.ProcessEnv;
    expect(() => assertTestMigrationAllowed(env)).toThrow(TestMigrationGuardError);
  });

  it("refuses in production even when acknowledged", () => {
    const env = { ...SAFE_ENV, NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;
    expect(() => assertTestMigrationAllowed(env)).toThrow(/NODE_ENV is production/);
  });

  it("refuses when the target project is the production one", () => {
    expect(() => assertTestMigrationAllowed(SAFE_ENV, "https://rehearsal.supabase.co")).toThrow(
      /production project/,
    );
  });

  it("refuses when the target project cannot be identified at all", () => {
    const env = { ...SAFE_ENV, NEXT_PUBLIC_SUPABASE_URL: "" } as NodeJS.ProcessEnv;
    expect(() => assertTestMigrationAllowed(env)).toThrow(/cannot be verified/);
  });
});

describe("forceEligibleSource", () => {
  const record = { First_Name: "Ada", Last_Name: "Lovelace", Email: "ada@example.com" };

  it("makes a consent-blocked candidate importable", async () => {
    const inner = fixtureZohoCandidateSource([{ id: "z1", record }]);
    const page = await forceEligibleSource(inner).listCandidates({ page: 1, perPage: 10 });

    expect(page.records).toHaveLength(1);
    expect(page.records[0]!.eligibility.eligible).toBe(true);
  });

  it("preserves the original refusal reason so the report can still count it", async () => {
    const inner = fixtureZohoCandidateSource([{ id: "z1", record }]);
    const page = await forceEligibleSource(inner).listCandidates({ page: 1, perPage: 10 });

    const reasons = page.records[0]!.eligibility.reasons;
    expect(reasons).toContain("test_migration_consent_override");
    // The real-world verdict must survive the override.
    expect(reasons).toContain("portal_consent_missing");
  });

  it("leaves a genuinely consented candidate untouched", async () => {
    const consented = {
      eligible: true,
      reasons: [],
      evidence: ["Portal_Consent=true"],
    };
    const inner = fixtureZohoCandidateSource([{ id: "z2", record, eligibility: consented }]);
    const page = await forceEligibleSource(inner).listCandidates({ page: 1, perPage: 10 });

    expect(page.records[0]!.eligibility).toEqual(consented);
    expect(page.records[0]!.eligibility.reasons).not.toContain("test_migration_consent_override");
  });

  it("applies the override on the single-record path too", async () => {
    const inner = fixtureZohoCandidateSource([{ id: "z1", record }]);
    const row = await forceEligibleSource(inner).getCandidate("z1");
    expect(row?.eligibility.eligible).toBe(true);
  });

  it("passes a missing record through as null", async () => {
    const inner = fixtureZohoCandidateSource([]);
    expect(await forceEligibleSource(inner).getCandidate("nope")).toBeNull();
  });

  it("preserves pagination from the inner source", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `z${i}`, record }));
    const page = await forceEligibleSource(fixtureZohoCandidateSource(rows)).listCandidates({
      page: 1,
      perPage: 2,
    });
    expect(page.records).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });
});
