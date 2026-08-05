/**
 * Similarity signals for candidate identity matching.
 *
 * Used by duplicate detection and by the Zoho import's match stage, so a record
 * arriving from Zoho is judged against the pool by exactly the same rules as two
 * records already in the pool.
 *
 * Every signal is derived from `normalize.ts`, and every signal reports the two
 * normalized values it compared. That evidence is what a reviewer sees — a bare
 * score is not reviewable.
 *
 * No protected characteristic is a signal here. Country code participates only
 * as a weak contact-detail corroboration and can never, on its own, make or
 * break a match.
 */
import type { CandidateIdentity } from "@/lib/candidates/normalize";

export const MATCH_SIGNAL_KEYS = [
  "email",
  "phone",
  "name",
  "date_of_birth",
  "location",
  "employers",
  "institutions",
  "skills",
] as const;
export type MatchSignalKey = (typeof MATCH_SIGNAL_KEYS)[number];

export interface MatchSignal {
  key: MatchSignalKey;
  /** 0–1 similarity for this signal alone. */
  similarity: number;
  /** Relative importance of the signal when both sides have data. */
  weight: number;
  /** True when the values are identical after normalization. */
  exact: boolean;
  /** The normalized values compared, for reviewer evidence. */
  a: string;
  b: string;
}

/**
 * Weights are ordered by how hard the signal is to share by coincidence. Two
 * people genuinely share a city and an employer; they do not share a mobile
 * number. Skills are near-worthless alone and are weighted accordingly — they
 * only ever break ties.
 */
export const SIGNAL_WEIGHTS: Record<MatchSignalKey, number> = {
  email: 1,
  phone: 1,
  name: 0.8,
  date_of_birth: 0.6,
  location: 0.15,
  employers: 0.35,
  institutions: 0.3,
  skills: 0.1,
};

/**
 * Signals strong enough that, on their own, they identify a person. A match on
 * one of these is reported as `exact` — but an exact match still only ever
 * produces a suspected link for a human to confirm.
 */
export const IDENTIFYING_SIGNALS: readonly MatchSignalKey[] = ["email", "phone"];

// ---------------------------------------------------------------------------
// String similarity
// ---------------------------------------------------------------------------

function bigrams(value: string): Map<string, number> {
  const out = new Map<string, number>();
  const clean = value.replace(/\s+/g, " ").trim();
  for (let i = 0; i < clean.length - 1; i += 1) {
    const gram = clean.slice(i, i + 2);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

/**
 * Sørensen–Dice coefficient over character bigrams. Chosen over Levenshtein
 * because it degrades gracefully on transposed name parts, which is the single
 * most common difference between two records for the same person.
 */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let overlap = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  for (const count of left.values()) leftTotal += count;
  for (const [gram, count] of right) {
    rightTotal += count;
    const shared = Math.min(count, left.get(gram) ?? 0);
    overlap += shared;
  }
  if (leftTotal + rightTotal === 0) return 0;
  return (2 * overlap) / (leftTotal + rightTotal);
}

/** Jaccard index over two sets of already-normalized strings. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Name similarity that understands token order and initials. "Asha J
 * Mwakalinga" vs "Mwakalinga Asha John" scores high; two unrelated names that
 * happen to share a common surname do not.
 */
export function nameSimilarity(a: CandidateIdentity, b: CandidateIdentity): number {
  if (!a.nameKey || !b.nameKey) return 0;
  if (a.nameKey === b.nameKey) return 1;

  const left = new Set(a.nameTokens);
  const right = new Set(b.nameTokens);
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
      continue;
    }
    // An initial matching a full token is partial evidence, not a full match.
    if (token.length === 1 && [...right].some((t) => t.startsWith(token))) shared += 0.5;
  }
  const tokenScore = shared / Math.max(left.size, right.size);
  // Blend with a character-level score so a misspelling is not a cliff.
  return Math.max(tokenScore, 0.85 * diceCoefficient(a.nameKey, b.nameKey));
}

// ---------------------------------------------------------------------------
// Signal assembly
// ---------------------------------------------------------------------------

function signal(
  key: MatchSignalKey,
  similarity: number,
  a: string,
  b: string,
  exact = similarity === 1,
): MatchSignal {
  return {
    key,
    similarity: Math.max(0, Math.min(1, similarity)),
    weight: SIGNAL_WEIGHTS[key],
    exact,
    a,
    b,
  };
}

/**
 * Compare two normalized identities. Only signals where BOTH sides carry data
 * are produced — a missing field is unknown, never evidence of difference.
 */
export function compareIdentities(a: CandidateIdentity, b: CandidateIdentity): MatchSignal[] {
  const signals: MatchSignal[] = [];

  if (a.email && b.email) {
    signals.push(signal("email", a.email === b.email ? 1 : 0, a.email, b.email));
  }
  if (a.phoneKey && b.phoneKey) {
    signals.push(signal("phone", a.phoneKey === b.phoneKey ? 1 : 0, a.phoneKey, b.phoneKey));
  }
  if (a.nameKey && b.nameKey) {
    const similarity = nameSimilarity(a, b);
    signals.push(signal("name", similarity, a.nameKey, b.nameKey, a.nameKey === b.nameKey));
  }
  if (a.dateOfBirth && b.dateOfBirth) {
    signals.push(
      signal(
        "date_of_birth",
        a.dateOfBirth === b.dateOfBirth ? 1 : 0,
        a.dateOfBirth,
        b.dateOfBirth,
      ),
    );
  }
  if (a.location && b.location) {
    signals.push(
      signal("location", diceCoefficient(a.location, b.location), a.location, b.location),
    );
  }
  if (a.employers.length && b.employers.length) {
    signals.push(
      signal(
        "employers",
        jaccard(a.employers, b.employers),
        a.employers.join("|"),
        b.employers.join("|"),
      ),
    );
  }
  if (a.institutions.length && b.institutions.length) {
    signals.push(
      signal(
        "institutions",
        jaccard(a.institutions, b.institutions),
        a.institutions.join("|"),
        b.institutions.join("|"),
      ),
    );
  }
  if (a.skills.length && b.skills.length) {
    signals.push(
      signal("skills", jaccard(a.skills, b.skills), a.skills.join("|"), b.skills.join("|")),
    );
  }

  return signals;
}

export interface MatchScore {
  /** 0–1 weighted similarity across the signals both records could supply. */
  score: number;
  signals: MatchSignal[];
  /** True when at least one identifying signal matched exactly. */
  hasIdentifyingMatch: boolean;
  /** True when an identifying signal was comparable and came back different. */
  hasIdentifyingConflict: boolean;
}

/**
 * Weighted score over the comparable signals.
 *
 * Two deliberate properties:
 *   * The denominator counts only comparable signals, so a sparse record is not
 *     penalized for the fields it is missing.
 *   * A conflicting identifying signal (two different phone numbers, two
 *     different emails) is reported but does NOT zero the score — people change
 *     numbers, and the reviewer is better placed to judge that than a rule.
 */
export function scoreIdentityMatch(a: CandidateIdentity, b: CandidateIdentity): MatchScore {
  const signals = compareIdentities(a, b);
  let weighted = 0;
  let totalWeight = 0;
  for (const s of signals) {
    weighted += s.similarity * s.weight;
    totalWeight += s.weight;
  }
  const score = totalWeight > 0 ? weighted / totalWeight : 0;

  return {
    score,
    signals,
    hasIdentifyingMatch: signals.some((s) => IDENTIFYING_SIGNALS.includes(s.key) && s.exact),
    hasIdentifyingConflict: signals.some(
      (s) => IDENTIFYING_SIGNALS.includes(s.key) && !s.exact && s.similarity === 0,
    ),
  };
}

/**
 * Cheap blocking keys, so a pool of N candidates does not need N² comparisons.
 * Two records only get compared when they share at least one key.
 */
export function blockingKeys(identity: CandidateIdentity): string[] {
  const keys: string[] = [];
  if (identity.email) keys.push(`email:${identity.email}`);
  if (identity.phoneKey) keys.push(`phone:${identity.phoneKey}`);
  for (const token of identity.nameTokens) {
    if (token.length >= 3) keys.push(`name:${token}`);
  }
  return keys;
}
