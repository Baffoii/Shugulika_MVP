/**
 * Candidate duplicate detection.
 *
 * The contract, stated once and enforced by the types below: **detection never
 * merges.** Every function here produces links with `status: "suspected"` and
 * nothing else. There is no code path in this module that can mark a pair
 * merged, confirmed, or dismissed — those are human decisions taken in
 * `/hq/merge-review`, recorded in `candidate_merge_events`.
 *
 * An exact match on email or phone is reported as `match_kind: "exact"` so a
 * reviewer can clear it in one glance, but it is still only suspected: shared
 * family phone numbers and recycled work addresses are real, and a wrong merge
 * silently destroys one person's history.
 *
 * Pure — no I/O.
 */
import { DEDUPE_DETECTOR_VERSION, type DuplicateMatchKind } from "@/lib/candidates/constants";
import {
  toCandidateIdentity,
  type CandidateIdentity,
  type CandidateIdentityInput,
} from "@/lib/candidates/normalize";
import { blockingKeys, scoreIdentityMatch, type MatchSignal } from "@/lib/candidates/match";

export interface DedupeThresholds {
  /** At or above this weighted score, the pair is written for review. */
  suspect: number;
  /** At or above this, the reviewer sees it flagged as a strong candidate. */
  strong: number;
}

/**
 * Tuned to over-report rather than under-report. A missed duplicate is a
 * permanent data-quality defect; an extra pair in the review queue costs a
 * reviewer ten seconds.
 */
export const DEFAULT_DEDUPE_THRESHOLDS: DedupeThresholds = { suspect: 0.6, strong: 0.85 };

export interface CandidateForDedupe extends CandidateIdentityInput {
  id: string;
  /** Records already merged away are not re-detected. */
  mergedIntoCandidateId?: string | null;
}

/**
 * A row destined for `candidate_duplicate_links`. `status` is a literal, not a
 * parameter: there is no way to ask this module for anything else.
 */
export interface DuplicateLinkDraft {
  candidateIdLow: string;
  candidateIdHigh: string;
  status: "suspected";
  matchKind: DuplicateMatchKind;
  score: number;
  signals: MatchSignal[];
  detectorVersion: string;
  /** True when the score cleared the strong threshold. Advisory only. */
  isStrong: boolean;
}

export interface PairEvaluation {
  /** True when the pair clears the suspect threshold and should be linked. */
  shouldLink: boolean;
  score: number;
  matchKind: DuplicateMatchKind;
  signals: MatchSignal[];
  isStrong: boolean;
  /**
   * Always false. Present so that any future caller reaching for "can I just
   * merge this one" gets an explicit, greppable no.
   */
  autoMergeAllowed: false;
}

/** Order a pair so (a,b) and (b,a) are the same row, matching the DB constraint. */
export function orderPair(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

/**
 * Score one pair of candidates.
 *
 * An exact identifying match (same email or same phone) is always linked, even
 * if the rest of the record disagrees — that is exactly the case a reviewer must
 * see. Otherwise the weighted score must clear the suspect threshold.
 */
export function evaluateCandidatePair(
  a: CandidateIdentity,
  b: CandidateIdentity,
  thresholds: DedupeThresholds = DEFAULT_DEDUPE_THRESHOLDS,
): PairEvaluation {
  const { score, signals, hasIdentifyingMatch } = scoreIdentityMatch(a, b);
  const shouldLink = hasIdentifyingMatch || score >= thresholds.suspect;

  return {
    shouldLink,
    score,
    matchKind: hasIdentifyingMatch ? "exact" : "probabilistic",
    signals,
    isStrong: hasIdentifyingMatch || score >= thresholds.strong,
    autoMergeAllowed: false,
  };
}

/**
 * Detect duplicates across a pool.
 *
 * Blocking keeps this linear-ish: two records are only compared when they share
 * an email, a phone, or a name token. Records already merged away are skipped so
 * a resolved duplicate does not come back every time detection runs.
 */
export function detectDuplicates(
  pool: readonly CandidateForDedupe[],
  thresholds: DedupeThresholds = DEFAULT_DEDUPE_THRESHOLDS,
): DuplicateLinkDraft[] {
  const active = pool.filter((c) => !c.mergedIntoCandidateId);
  const identities = new Map<string, CandidateIdentity>();
  const buckets = new Map<string, string[]>();

  for (const candidate of active) {
    const identity = toCandidateIdentity(candidate);
    identities.set(candidate.id, identity);
    for (const key of blockingKeys(identity)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(candidate.id);
      else buckets.set(key, [candidate.id]);
    }
  }

  const seen = new Set<string>();
  const drafts: DuplicateLinkDraft[] = [];

  for (const bucket of buckets.values()) {
    // A name token shared by hundreds of people is not a useful block; comparing
    // that bucket pairwise would dominate the run without finding anything the
    // email/phone blocks miss.
    if (bucket.length < 2 || bucket.length > 50) continue;

    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const { low, high } = orderPair(bucket[i] as string, bucket[j] as string);
        const pairKey = `${low}|${high}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const left = identities.get(low);
        const right = identities.get(high);
        if (!left || !right) continue;

        const evaluation = evaluateCandidatePair(left, right, thresholds);
        if (!evaluation.shouldLink) continue;

        drafts.push({
          candidateIdLow: low,
          candidateIdHigh: high,
          status: "suspected",
          matchKind: evaluation.matchKind,
          score: evaluation.score,
          signals: evaluation.signals,
          detectorVersion: DEDUPE_DETECTOR_VERSION,
          isStrong: evaluation.isStrong,
        });
      }
    }
  }

  return drafts.sort((a, b) => b.score - a.score);
}

export interface PoolMatch {
  candidateId: string;
  score: number;
  matchKind: DuplicateMatchKind;
  signals: MatchSignal[];
  isStrong: boolean;
}

/**
 * Match one incoming record (from a CV or a Zoho import) against an existing
 * pool. Returns every plausible match, best first — never "the" match, because
 * picking one silently is how an import attaches a CV to the wrong person.
 */
export function matchAgainstPool(
  incoming: CandidateIdentityInput,
  pool: readonly CandidateForDedupe[],
  thresholds: DedupeThresholds = DEFAULT_DEDUPE_THRESHOLDS,
): PoolMatch[] {
  const identity = toCandidateIdentity(incoming);
  const matches: PoolMatch[] = [];

  for (const candidate of pool) {
    if (candidate.mergedIntoCandidateId) continue;
    const evaluation = evaluateCandidatePair(identity, toCandidateIdentity(candidate), thresholds);
    if (!evaluation.shouldLink) continue;
    matches.push({
      candidateId: candidate.id,
      score: evaluation.score,
      matchKind: evaluation.matchKind,
      signals: evaluation.signals,
      isStrong: evaluation.isStrong,
    });
  }

  return matches.sort((a, b) => b.score - a.score);
}

/**
 * How an import should route a record given its matches.
 *
 * `link_existing` is only ever proposed for a single unambiguous strong match;
 * anything else — no match, several matches, or a weak one — goes to a human.
 */
export type MatchRouting =
  | { route: "create_new" }
  | { route: "link_existing"; candidateId: string; score: number }
  | { route: "human_review"; reason: "ambiguous" | "weak_match"; matches: PoolMatch[] };

export function routeMatches(matches: readonly PoolMatch[]): MatchRouting {
  if (matches.length === 0) return { route: "create_new" };

  const [best, ...rest] = matches;
  if (!best) return { route: "create_new" };

  const contenders = rest.filter((m) => m.isStrong);
  if (contenders.length > 0) {
    return { route: "human_review", reason: "ambiguous", matches: [...matches] };
  }
  if (!best.isStrong) {
    return { route: "human_review", reason: "weak_match", matches: [...matches] };
  }
  return { route: "link_existing", candidateId: best.candidateId, score: best.score };
}
