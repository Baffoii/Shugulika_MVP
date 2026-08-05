/**
 * The acceptance criterion here: a fuzzy duplicate creates a *suspected* link
 * and nothing else. No function in the dedupe module may produce a merge, and
 * no score — however high — may change that.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DEDUPE_THRESHOLDS,
  detectDuplicates,
  evaluateCandidatePair,
  matchAgainstPool,
  orderPair,
  routeMatches,
  type CandidateForDedupe,
} from "@/lib/candidates/dedupe";
import { toCandidateIdentity } from "@/lib/candidates/normalize";
import { diceCoefficient, jaccard, scoreIdentityMatch } from "@/lib/candidates/match";

const asha: CandidateForDedupe = {
  id: "b0000000-0000-4000-8000-000000000001",
  givenName: "Asha",
  familyName: "Mwakalinga",
  email: "asha@example.com",
  phone: "0712345678",
  city: "Dar es Salaam",
  employers: ["Acme Ltd"],
};

const ashaAgain: CandidateForDedupe = {
  id: "a0000000-0000-4000-8000-000000000002",
  givenName: "Asha",
  middleName: "John",
  familyName: "Mwakalinga",
  email: "asha.j@other.example",
  phone: "+255 712 345 678",
  city: "Dar es Salaam, Tanzania",
  employers: ["ACME (T) Limited"],
};

const different: CandidateForDedupe = {
  id: "c0000000-0000-4000-8000-000000000003",
  givenName: "Juma",
  familyName: "Nyerere",
  email: "juma@example.com",
  phone: "0755000111",
  city: "Mwanza",
  employers: ["Beta Co"],
};

describe("evaluateCandidatePair", () => {
  it("links two records for the same person that differ in formatting", () => {
    const result = evaluateCandidatePair(toCandidateIdentity(asha), toCandidateIdentity(ashaAgain));
    expect(result.shouldLink).toBe(true);
    expect(result.matchKind).toBe("exact"); // same phone
    expect(result.autoMergeAllowed).toBe(false);
  });

  it("does not link two different people who share nothing identifying", () => {
    const result = evaluateCandidatePair(toCandidateIdentity(asha), toCandidateIdentity(different));
    expect(result.shouldLink).toBe(false);
  });

  it("reports a probabilistic match when no identifying field is shared", () => {
    const result = evaluateCandidatePair(
      toCandidateIdentity({ ...asha, email: null, phone: null }),
      toCandidateIdentity({ ...ashaAgain, email: null, phone: null }),
    );
    expect(result.matchKind).toBe("probabilistic");
    expect(result.shouldLink).toBe(true);
  });

  it("links on an exact email even when everything else disagrees", () => {
    const result = evaluateCandidatePair(
      toCandidateIdentity({ givenName: "Asha", familyName: "Mwakalinga", email: "x@y.com" }),
      toCandidateIdentity({ givenName: "Juma", familyName: "Nyerere", email: "X@Y.com" }),
    );
    expect(result.shouldLink).toBe(true);
    expect(result.matchKind).toBe("exact");
  });

  it("never reports a mergeable pair, whatever the score", () => {
    const identical = toCandidateIdentity(asha);
    const result = evaluateCandidatePair(identical, identical);
    expect(result.score).toBe(1);
    expect(result.autoMergeAllowed).toBe(false);
  });

  it("supplies reviewer evidence, not just a number", () => {
    const result = evaluateCandidatePair(toCandidateIdentity(asha), toCandidateIdentity(ashaAgain));
    const phone = result.signals.find((s) => s.key === "phone");
    expect(phone).toMatchObject({ exact: true, a: "712345678", b: "712345678" });
  });
});

describe("detectDuplicates", () => {
  it("writes suspected links only", () => {
    const drafts = detectDuplicates([asha, ashaAgain, different]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.status).toBe("suspected");
  });

  it("orders each pair so (a,b) and (b,a) are one row", () => {
    const drafts = detectDuplicates([ashaAgain, asha]);
    const pair = drafts[0]!;
    expect(pair.candidateIdLow < pair.candidateIdHigh).toBe(true);
    expect(pair.candidateIdLow).toBe(ashaAgain.id);
  });

  it("never reports the same pair twice, even across several blocking keys", () => {
    const drafts = detectDuplicates([asha, { ...ashaAgain, email: asha.email }]);
    expect(drafts).toHaveLength(1);
  });

  it("skips records already merged away", () => {
    const drafts = detectDuplicates([
      asha,
      { ...ashaAgain, mergedIntoCandidateId: asha.id },
      different,
    ]);
    expect(drafts).toHaveLength(0);
  });

  it("returns the strongest pairs first", () => {
    const weak: CandidateForDedupe = {
      id: "d0000000-0000-4000-8000-000000000004",
      givenName: "Asha",
      familyName: "Mwakalinga",
      city: "Mwanza",
    };
    const drafts = detectDuplicates([asha, ashaAgain, weak]);
    expect(drafts.length).toBeGreaterThan(1);
    for (let i = 1; i < drafts.length; i += 1) {
      expect(drafts[i - 1]!.score).toBeGreaterThanOrEqual(drafts[i]!.score);
    }
  });

  it("handles an empty and a single-record pool", () => {
    expect(detectDuplicates([])).toEqual([]);
    expect(detectDuplicates([asha])).toEqual([]);
  });

  it("stamps the detector version so old scores are never compared to new ones", () => {
    expect(detectDuplicates([asha, ashaAgain])[0]?.detectorVersion).toBe("candidate-dedupe-v1");
  });
});

describe("no module-level path to an automatic merge", () => {
  it("the dedupe source contains no status other than suspected", () => {
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "candidates", "dedupe.ts"),
      "utf8",
    );
    // The only status literal the module may emit.
    expect(source).not.toContain('status: "merged"');
    expect(source).not.toContain('status: "confirmed_duplicate"');
    expect(source).toContain('status: "suspected"');
  });
});

describe("matchAgainstPool and routeMatches", () => {
  it("returns every plausible match, best first, rather than picking one", () => {
    const { id: _ignored, ...incoming } = asha;
    const matches = matchAgainstPool(incoming, [asha, ashaAgain, different]);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0]!.score).toBeGreaterThanOrEqual(matches[1]!.score);
  });

  it("routes a clean single strong match to link_existing", () => {
    const routing = routeMatches([
      { candidateId: "a", score: 0.95, matchKind: "exact", signals: [], isStrong: true },
    ]);
    expect(routing).toEqual({ route: "link_existing", candidateId: "a", score: 0.95 });
  });

  it("routes several strong matches to a human", () => {
    const routing = routeMatches([
      { candidateId: "a", score: 0.95, matchKind: "exact", signals: [], isStrong: true },
      { candidateId: "b", score: 0.9, matchKind: "exact", signals: [], isStrong: true },
    ]);
    expect(routing).toMatchObject({ route: "human_review", reason: "ambiguous" });
  });

  it("routes a weak single match to a human rather than guessing", () => {
    const routing = routeMatches([
      { candidateId: "a", score: 0.65, matchKind: "probabilistic", signals: [], isStrong: false },
    ]);
    expect(routing).toMatchObject({ route: "human_review", reason: "weak_match" });
  });

  it("routes no match to create_new", () => {
    expect(routeMatches([])).toEqual({ route: "create_new" });
  });
});

describe("similarity primitives", () => {
  it("dice is 1 for identical strings and 0 for disjoint ones", () => {
    expect(diceCoefficient("acme", "acme")).toBe(1);
    expect(diceCoefficient("acme", "zzzz")).toBe(0);
    expect(diceCoefficient("", "")).toBe(0);
  });

  it("jaccard handles empty sets without dividing by zero", () => {
    expect(jaccard([], ["a"])).toBe(0);
    expect(jaccard(["a", "b"], ["a"])).toBeCloseTo(0.5);
  });

  it("scores nothing when the two records share no comparable field", () => {
    const result = scoreIdentityMatch(
      toCandidateIdentity({ givenName: "Asha" }),
      toCandidateIdentity({ email: "x@y.com" }),
    );
    expect(result.score).toBe(0);
    expect(result.signals).toEqual([]);
  });

  it("flags a conflicting identifying field without zeroing the score", () => {
    const result = scoreIdentityMatch(
      toCandidateIdentity({ givenName: "Asha", familyName: "Mwakalinga", phone: "0712345678" }),
      toCandidateIdentity({ givenName: "Asha", familyName: "Mwakalinga", phone: "0755000111" }),
    );
    expect(result.hasIdentifyingConflict).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("orderPair", () => {
  it("is symmetric", () => {
    expect(orderPair("b", "a")).toEqual(orderPair("a", "b"));
  });
});

describe("thresholds", () => {
  it("suspects earlier than it calls something strong", () => {
    expect(DEFAULT_DEDUPE_THRESHOLDS.suspect).toBeLessThan(DEFAULT_DEDUPE_THRESHOLDS.strong);
  });
});
