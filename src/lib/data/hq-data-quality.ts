import "server-only";

/**
 * Data-quality metrics for the HQ dashboard.
 *
 * Seven signals, each answering a question an operator actually has:
 *   parser coverage        — how much of the pool has been through a CV parse?
 *   confirmation rate      — how much of what we extracted has a person agreed to?
 *   missing critical fields— how many records can't be matched or submitted?
 *   duplicate rate         — how much of the pool is suspected of being the same person?
 *   unresolved conflicts   — how much is sitting in a queue waiting on a human?
 *   import error rate      — how much of the last import failed validation?
 *   source freshness       — how long since each source last told us anything?
 *
 * Counts and rates only. This module never returns a candidate's field values:
 * HQ needs to know that 400 records are missing a phone number, not what the
 * phone numbers are.
 */
import { createClient } from "@/lib/supabase/server";
import { asAtsClient } from "@/lib/candidates/db";
import { CONFIDENCE_REVIEW_THRESHOLD } from "@/lib/candidates/provenance";
import { CRITICAL_PROFILE_FIELDS } from "@/lib/candidates/constants";

export interface ParserCoverageMetrics {
  candidatesTotal: number;
  candidatesWithParseRun: number;
  /** 0–1, or null when there are no candidates to divide by. */
  coverageRate: number | null;
  /** Distinct parser versions seen — more than one means results are not comparable. */
  parserVersions: Array<{ version: string; runs: number }>;
  failedRuns: number;
}

export interface ConfirmationMetrics {
  trackedFields: number;
  confirmedFields: number;
  machineFields: number;
  confirmationRate: number | null;
  lowConfidenceFields: number;
}

export interface CompletenessMetrics {
  candidatesTotal: number;
  /** Candidates missing at least one critical field. */
  candidatesIncomplete: number;
  byField: Array<{ field: string; missing: number }>;
}

export interface DuplicateMetrics {
  suspectedPairs: number;
  strongPairs: number;
  confirmedDuplicates: number;
  dismissed: number;
  mergedPairs: number;
  candidatesInvolved: number;
  /** candidatesInvolved / candidatesTotal, 0–1. */
  duplicateRate: number | null;
  unresolvedMergeTasks: number;
}

export interface ImportHealthMetrics {
  batches: number;
  lastBatchAt: string | null;
  lastBatchStage: string | null;
  lastBatchStatus: string | null;
  recordsProcessed: number;
  recordsQuarantined: number;
  recordsFailed: number;
  recordsAwaitingReview: number;
  /** (quarantined + failed) / processed, 0–1. */
  errorRate: number | null;
  gatesBlocked: string[];
}

export interface SourceFreshness {
  source: string;
  lastSeenAt: string | null;
  ageHours: number | null;
}

export interface HqDataQualityMetrics {
  parser: ParserCoverageMetrics;
  confirmation: ConfirmationMetrics;
  completeness: CompletenessMetrics;
  duplicates: DuplicateMetrics;
  imports: ImportHealthMetrics;
  freshness: SourceFreshness[];
  generatedAt: string;
}

/** Core metrics only — Zoho import health is composed in the HQ page. */
export type HqDataQualityCoreMetrics = Omit<HqDataQualityMetrics, "imports">;

/** Score-threshold above which a suspected pair is highlighted to the reviewer. */
const STRONG_PAIR_SCORE = 0.85;

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function hoursSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.round(((now - parsed) / 3_600_000) * 10) / 10);
}

export async function getParserCoverage(): Promise<ParserCoverageMetrics> {
  const supabase = createClient();
  const ats = asAtsClient(supabase);

  const [{ count: candidatesTotal }, runsRes] = await Promise.all([
    supabase.from("candidate_profiles").select("id", { count: "exact", head: true }),
    ats.from("resume_parse_runs").select("candidate_id,parser_version,status").limit(20_000),
  ]);

  const runs = runsRes.data ?? [];
  const byCandidate = new Set(
    runs.filter((r) => r.status === "succeeded").map((r) => r.candidate_id),
  );

  const versionTally = new Map<string, number>();
  for (const run of runs) {
    const version = run.parser_version || "unknown";
    versionTally.set(version, (versionTally.get(version) ?? 0) + 1);
  }

  return {
    candidatesTotal: candidatesTotal ?? 0,
    candidatesWithParseRun: byCandidate.size,
    coverageRate: rate(byCandidate.size, candidatesTotal ?? 0),
    parserVersions: [...versionTally.entries()]
      .map(([version, count]) => ({ version, runs: count }))
      .sort((a, b) => b.runs - a.runs),
    failedRuns: runs.filter((r) => r.status === "failed").length,
  };
}

export async function getConfirmationMetrics(): Promise<ConfirmationMetrics> {
  const { data } = await asAtsClient(createClient())
    .from("candidate_field_provenance")
    .select("source,confidence")
    .limit(50_000);

  const rows = data ?? [];
  let confirmed = 0;
  let machine = 0;
  let lowConfidence = 0;

  for (const row of rows) {
    if (row.source === "cv_parse" || row.source === "zoho_import") {
      machine += 1;
      if ((row.confidence ?? 0) < CONFIDENCE_REVIEW_THRESHOLD) lowConfidence += 1;
    } else {
      confirmed += 1;
    }
  }

  return {
    trackedFields: rows.length,
    confirmedFields: confirmed,
    machineFields: machine,
    confirmationRate: rate(confirmed, rows.length),
    lowConfidenceFields: lowConfidence,
  };
}

export async function getCompletenessMetrics(): Promise<CompletenessMetrics> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_profiles")
    .select("id,given_name,family_name,contact_email,country_code,user_id")
    .limit(20_000);

  const rows = (data ?? []) as Array<{
    id: string;
    given_name: string | null;
    family_name: string | null;
    contact_email: string | null;
    country_code: string | null;
    user_id: string;
  }>;

  // Phone lives on the shared profiles row, not on candidate_profiles.
  const { data: profileRows } = await supabase
    .from("profiles")
    .select("id,phone")
    .in(
      "id",
      rows.slice(0, 1_000).map((r) => r.user_id),
    );
  const phoneByUser = new Map(
    ((profileRows as { id: string; phone: string | null }[] | null) ?? []).map((p) => [
      p.id,
      p.phone,
    ]),
  );

  const tally = new Map<string, number>(CRITICAL_PROFILE_FIELDS.map((f) => [f, 0]));
  let incomplete = 0;

  for (const row of rows) {
    const missing: string[] = [];
    if (!row.given_name) missing.push("given_name");
    if (!row.family_name) missing.push("family_name");
    if (!row.contact_email) missing.push("email");
    if (!row.country_code) missing.push("country_code");
    if (!phoneByUser.get(row.user_id)) missing.push("phone");

    for (const field of missing) tally.set(field, (tally.get(field) ?? 0) + 1);
    if (missing.length > 0) incomplete += 1;
  }

  return {
    candidatesTotal: rows.length,
    candidatesIncomplete: incomplete,
    byField: [...tally.entries()]
      .map(([field, missing]) => ({ field, missing }))
      .sort((a, b) => b.missing - a.missing),
  };
}

export async function getDuplicateMetrics(candidatesTotal: number): Promise<DuplicateMetrics> {
  const ats = asAtsClient(createClient());
  const [linksRes, mergeRes] = await Promise.all([
    ats
      .from("candidate_duplicate_links")
      .select("candidate_id_low,candidate_id_high,status,score")
      .limit(20_000),
    ats.from("candidate_merge_events").select("status").limit(20_000),
  ]);

  const links = linksRes.data ?? [];
  const mergeEvents = mergeRes.data ?? [];
  const involved = new Set<string>();
  let suspected = 0;
  let strong = 0;
  let confirmedDuplicates = 0;
  let dismissed = 0;

  for (const link of links) {
    if (link.status === "suspected") {
      suspected += 1;
      if (Number(link.score) >= STRONG_PAIR_SCORE) strong += 1;
      involved.add(link.candidate_id_low);
      involved.add(link.candidate_id_high);
    }
    if (link.status === "confirmed_duplicate") {
      confirmedDuplicates += 1;
      involved.add(link.candidate_id_low);
      involved.add(link.candidate_id_high);
    }
    if (link.status === "not_duplicate") dismissed += 1;
  }

  // Prefer the audited merge ledger over link status for completed merges.
  const mergedPairs = mergeEvents.filter((event) => event.status === "merged").length;

  return {
    suspectedPairs: suspected,
    strongPairs: strong,
    confirmedDuplicates,
    dismissed,
    mergedPairs,
    candidatesInvolved: involved.size,
    duplicateRate: rate(involved.size, candidatesTotal),
    // Pairs a human has confirmed are duplicates but has not yet merged, plus
    // everything still waiting on a first look.
    unresolvedMergeTasks: suspected + confirmedDuplicates,
  };
}

/**
 * Canonical (non-integration) source freshness. Import-provider freshness is
 * appended on the HQ data-quality page from the integration metrics module.
 */
export async function getSourceFreshness(now = Date.now()): Promise<SourceFreshness[]> {
  const supabase = createClient();
  const ats = asAtsClient(supabase);

  const [parseRes, provenanceRes] = await Promise.all([
    ats
      .from("resume_parse_runs")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1),
    ats
      .from("candidate_field_provenance")
      .select("confirmed_at")
      .not("confirmed_at", "is", null)
      .order("confirmed_at", { ascending: false })
      .limit(1),
  ]);

  const lastParse = parseRes.data?.[0]?.created_at ?? null;
  const lastConfirmation = provenanceRes.data?.[0]?.confirmed_at ?? null;

  return [
    { source: "CV parsing", lastSeenAt: lastParse, ageHours: hoursSince(lastParse, now) },
    {
      source: "Candidate confirmations",
      lastSeenAt: lastConfirmation,
      ageHours: hoursSince(lastConfirmation, now),
    },
  ];
}

/**
 * Parser / confirmation / completeness / duplicate metrics.
 * Import health is composed on the HQ page so `lib/data` stays integration-isolated.
 */
export async function getHqDataQualityCoreMetrics(): Promise<HqDataQualityCoreMetrics> {
  const [parser, confirmation, completeness, freshness] = await Promise.all([
    getParserCoverage(),
    getConfirmationMetrics(),
    getCompletenessMetrics(),
    getSourceFreshness(),
  ]);
  const duplicates = await getDuplicateMetrics(parser.candidatesTotal);

  return {
    parser,
    confirmation,
    completeness,
    duplicates,
    freshness,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The subset `hq-ops.ts` needs to fill in the duplicate/parser placeholders on
 * the HQ portal. Kept small on purpose — the portal card is a signpost to this
 * page, not a second copy of it.
 */
export interface HqDataQualityCounts {
  probableDuplicateCandidates: number;
  unresolvedMergeTasks: number;
  missingRequiredFieldSignals: number;
  lowConfidenceParsedFields: number;
}

export async function getHqDataQualityCounts(): Promise<HqDataQualityCounts> {
  const [completeness, confirmation] = await Promise.all([
    getCompletenessMetrics(),
    getConfirmationMetrics(),
  ]);
  const duplicates = await getDuplicateMetrics(completeness.candidatesTotal);

  return {
    probableDuplicateCandidates: duplicates.candidatesInvolved,
    unresolvedMergeTasks: duplicates.unresolvedMergeTasks,
    missingRequiredFieldSignals: completeness.candidatesIncomplete,
    lowConfidenceParsedFields: confirmation.lowConfidenceFields,
  };
}
