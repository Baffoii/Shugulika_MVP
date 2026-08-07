import "server-only";

/**
 * TEST-ONLY candidate source for the rehearsal migration.
 *
 * The live import deliberately refuses candidates who never consented to the
 * Shugulika portal (`portal_consent_missing`), because those people must not
 * land in the pool employer search runs on. That gate is correct and stays.
 *
 * A rehearsal has the opposite requirement: you need the *whole* population to
 * size the migration, understand the field coverage, and see what would break.
 * This wrapper reads Zoho exactly as the live source does — read-only, no write
 * path — and overrides only the eligibility verdict.
 *
 * It is fenced three ways, because the cost of this running against production
 * is importing non-consented people into a searchable pool:
 *
 *   1. `ZOHO_TEST_MIGRATION=true` must be set explicitly.
 *   2. `NODE_ENV` must not be "production".
 *   3. The Supabase URL must not be the production project.
 *
 * The original verdict is preserved on every record so the batch report can
 * still say how many candidates a *real* import would have refused — which is
 * the single most useful number this rehearsal produces.
 */
import { liveZohoCandidateSource } from "@/lib/integrations/zoho-recruit/import/source";
import type { ZohoCandidateSource } from "@/lib/integrations/zoho-recruit/import/pipeline";

export class TestMigrationGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestMigrationGuardError";
  }
}

/**
 * Throws unless this process is unmistakably a non-production rehearsal.
 * Exported so a runner can fail before opening a batch rather than halfway
 * through one.
 */
export function assertTestMigrationAllowed(
  env: NodeJS.ProcessEnv = process.env,
  productionSupabaseUrl = env.PRODUCTION_SUPABASE_URL,
): void {
  if (env.ZOHO_TEST_MIGRATION !== "true") {
    throw new TestMigrationGuardError(
      "Refusing to run: set ZOHO_TEST_MIGRATION=true to acknowledge this bypasses the candidate consent gate.",
    );
  }
  if (env.NODE_ENV === "production") {
    throw new TestMigrationGuardError(
      "Refusing to run: NODE_ENV is production. The consent bypass is for rehearsal projects only.",
    );
  }

  const target = (env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!target) {
    throw new TestMigrationGuardError(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL is unset, so the target project cannot be verified.",
    );
  }
  if (productionSupabaseUrl && target === productionSupabaseUrl.trim()) {
    throw new TestMigrationGuardError(
      "Refusing to run: NEXT_PUBLIC_SUPABASE_URL points at the production project.",
    );
  }
}

/** Eligibility verdict shape used across the import pipeline. */
interface Eligibility {
  eligible: boolean;
  reasons: string[];
  evidence: string[];
}

/**
 * Rewrites a verdict to eligible while recording what it originally was, so the
 * quarantine/report stages can still distinguish "would have been refused" from
 * "genuinely consented".
 */
function overrideEligibility(original: Eligibility): Eligibility {
  if (original.eligible) return original;
  return {
    eligible: true,
    // Kept in `reasons` rather than dropped: the dry-run report reads these, and
    // a rehearsal that hides how many people lacked consent is worthless.
    reasons: ["test_migration_consent_override", ...original.reasons],
    evidence: original.evidence,
  };
}

/**
 * Wraps any source so every record is eligible. Takes the inner source as a
 * parameter so it can be unit-tested against a fixture without Zoho.
 */
export function forceEligibleSource(inner: ZohoCandidateSource): ZohoCandidateSource {
  return {
    async listCandidates(options) {
      const page = await inner.listCandidates(options);
      return {
        ...page,
        records: page.records.map((row) => ({
          ...row,
          eligibility: overrideEligibility(row.eligibility),
        })),
      };
    },
    async getCandidate(id) {
      const row = await inner.getCandidate(id);
      if (!row) return null;
      return { ...row, eligibility: overrideEligibility(row.eligibility) };
    },
  };
}

/**
 * The rehearsal source: live Zoho reads, consent gate bypassed.
 * Asserts the guards before it will hand back anything.
 */
export function testMigrationCandidateSource(): ZohoCandidateSource {
  assertTestMigrationAllowed();
  return forceEligibleSource(liveZohoCandidateSource());
}
