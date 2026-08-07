/**
 * The acceptance criterion here: an invalid record is quarantined with a stated
 * reason, never silently dropped or silently repaired. Records carrying a
 * protected characteristic are refused outright.
 */
import { describe, it, expect } from "vitest";
import {
  draftIdentityInput,
  findIntraBatchDuplicates,
  findProhibitedFields,
  fingerprintDraft,
  mapZohoCandidate,
  MAX_SOURCE_RECORD_CHARS,
  type ZohoCandidateRecord,
} from "@/lib/integrations/zoho-recruit/import/mapping";
import {
  decideQuarantine,
  isWaivable,
  missingCriticalFields,
  summarizeQuarantine,
} from "@/lib/integrations/zoho-recruit/import/quarantine";

const COUNTRIES = [
  { code: "TZ", name: "Tanzania" },
  { code: "KE", name: "Kenya" },
];

const options = { countries: COUNTRIES };

function record(over: ZohoCandidateRecord = {}): ZohoCandidateRecord {
  return {
    id: "z-1",
    First_Name: "Asha",
    Last_Name: "Mwakalinga",
    Email: "Asha@Example.com",
    Phone: "0712 345 678",
    City: "Dar es Salaam",
    Country: "Tanzania",
    Current_Job_Title: "Accountant",
    Current_Employer: "Acme Ltd",
    Skill_Set: "Excel, QuickBooks, Bookkeeping",
    ...over,
  };
}

describe("mapZohoCandidate", () => {
  it("maps a clean record to a canonical draft with no problems", () => {
    const result = mapZohoCandidate(record(), options);
    expect(result.problems).toEqual([]);
    expect(result.draft).toMatchObject({
      givenName: "Asha",
      familyName: "Mwakalinga",
      email: "asha@example.com",
      phone: "+255712345678",
      city: "Dar es Salaam",
      countryCode: "TZ",
      headline: "Accountant",
    });
    expect(result.draft.skills).toEqual(["Excel", "QuickBooks", "Bookkeeping"]);
    expect(result.draft.experiences[0]).toMatchObject({
      title: "Accountant",
      employerName: "Acme Ltd",
    });
  });

  it("accepts the field-name variants different Zoho orgs use", () => {
    const result = mapZohoCandidate(
      { id: "z-2", first_name: "Juma", last_name: "Nyerere", mobile: "0755000111" },
      options,
    );
    expect(result.draft.givenName).toBe("Juma");
    expect(result.draft.familyName).toBe("Nyerere");
    expect(result.draft.phone).toBe("+255755000111");
  });

  it("quarantines a record with no usable name", () => {
    const result = mapZohoCandidate({ id: "z-3", Email: "x@y.com" }, options);
    expect(result.problems).toContain("missing_name");
  });

  it("quarantines a record with no way to contact the person", () => {
    const result = mapZohoCandidate({ id: "z-4", First_Name: "Asha" }, options);
    expect(result.problems).toContain("missing_contact");
  });

  it("quarantines an unparseable email rather than dropping it", () => {
    const result = mapZohoCandidate(record({ Email: "not an address" }), options);
    expect(result.problems).toContain("invalid_email");
    expect(result.draft.email).toBeNull();
  });

  it("quarantines an unparseable phone", () => {
    const result = mapZohoCandidate(record({ Phone: "123", Email: null }), options);
    expect(result.problems).toContain("invalid_phone");
  });

  it("quarantines a country it cannot map rather than guessing one", () => {
    const result = mapZohoCandidate(record({ Country: "Atlantis" }), options);
    expect(result.problems).toContain("unmapped_country");
    expect(result.draft.countryCode).toBeNull();
  });

  it("quarantines when no processing consent is on file", () => {
    const result = mapZohoCandidate(record(), { ...options, hasConsent: false });
    expect(result.problems).toContain("consent_missing");
  });

  it("refuses a record carrying a protected characteristic", () => {
    const result = mapZohoCandidate(record({ Marital_Status: "Married" }), options);
    expect(result.problems).toContain("prohibited_field_present");
    expect(result.prohibitedFields).toEqual(["Marital_Status"]);
    // And the value never reaches the canonical draft.
    expect(JSON.stringify(result.draft)).not.toContain("Tanzanian");
  });

  it("ignores a prohibited field that is present but empty", () => {
    const result = mapZohoCandidate(record({ Marital_Status: "", Gender: [] }), options);
    expect(result.problems).not.toContain("prohibited_field_present");
  });

  it("catches prohibited fields whatever the casing or spacing", () => {
    expect(findProhibitedFields({ "Marital Status": "Single" })).toEqual(["Marital Status"]);
    expect(findProhibitedFields({ DISABILITY_STATUS: "x" })).toEqual(["DISABILITY_STATUS"]);
  });

  it("quarantines an oversized payload", () => {
    const result = mapZohoCandidate(
      record({ Candidate_Summary: "x".repeat(MAX_SOURCE_RECORD_CHARS + 1) }),
      options,
    );
    expect(result.problems).toContain("payload_too_large");
  });

  it("reports each problem once even when several checks trip", () => {
    const result = mapZohoCandidate({ id: "z-9" }, options);
    expect(new Set(result.problems).size).toBe(result.problems.length);
  });

  it("keeps free-text availability but flags an unparseable date", () => {
    expect(mapZohoCandidate(record({ Availability: "2 weeks" }), options).draft.availability).toBe(
      "2 weeks",
    );
    expect(mapZohoCandidate(record({ Availability: "99/99/2020" }), options).problems).toContain(
      "invalid_date",
    );
  });
});

describe("fingerprintDraft", () => {
  it("is stable for the same draft and changes with the content", () => {
    const a = mapZohoCandidate(record(), options);
    const b = mapZohoCandidate(record(), options);
    const c = mapZohoCandidate(record({ City: "Dodoma" }), options);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(fingerprintDraft(a.draft)).toBe(a.fingerprint);
  });
});

describe("findIntraBatchDuplicates", () => {
  it("flags every record in a colliding group, not just the later one", () => {
    const drafts = [
      { zohoRecordId: "a", draft: mapZohoCandidate(record({ id: "a" }), options).draft },
      { zohoRecordId: "b", draft: mapZohoCandidate(record({ id: "b" }), options).draft },
      {
        zohoRecordId: "c",
        draft: mapZohoCandidate(
          record({ id: "c", Email: "other@example.com", Phone: "0766111222" }),
          options,
        ).draft,
      },
    ];
    const duplicates = findIntraBatchDuplicates(drafts);
    expect(duplicates).toEqual(new Set(["a", "b"]));
  });

  it("falls back to the name when a record has no contact detail", () => {
    const draft = mapZohoCandidate({ id: "x", First_Name: "Asha", Last_Name: "M" }, options).draft;
    const duplicates = findIntraBatchDuplicates([
      { zohoRecordId: "x", draft },
      { zohoRecordId: "y", draft },
    ]);
    expect(duplicates.size).toBe(2);
  });

  it("finds nothing in a batch of distinct people", () => {
    expect(
      findIntraBatchDuplicates([
        { zohoRecordId: "a", draft: mapZohoCandidate(record(), options).draft },
      ]),
    ).toEqual(new Set());
  });
});

describe("quarantine decisions", () => {
  it("carries a reason and a human-readable label for every held record", () => {
    const mapping = mapZohoCandidate({ id: "z" }, options);
    const decision = decideQuarantine(mapping);
    expect(decision.quarantined).toBe(true);
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.labels.length).toBe(decision.reasons.length);
    expect(decision.labels.every((l) => l.length > 0)).toBe(true);
  });

  it("adds the intra-batch duplicate reason", () => {
    const decision = decideQuarantine(mapZohoCandidate(record(), options), {
      duplicateInBatch: true,
    });
    expect(decision.reasons).toEqual(["duplicate_in_batch"]);
  });

  it("lets a clean record through", () => {
    expect(decideQuarantine(mapZohoCandidate(record(), options)).quarantined).toBe(false);
  });

  it("never lets a prohibited field or missing consent be waived", () => {
    expect(isWaivable(["prohibited_field_present"])).toBe(false);
    expect(isWaivable(["consent_missing"])).toBe(false);
    expect(isWaivable(["missing_contact"])).toBe(false);
    expect(isWaivable(["invalid_phone", "unmapped_country"])).toBe(true);
  });

  it("summarizes a batch by reason", () => {
    const summary = summarizeQuarantine([
      decideQuarantine(mapZohoCandidate({ id: "a" }, options)),
      decideQuarantine(mapZohoCandidate(record({ Marital_Status: "X" }), options)),
      decideQuarantine(mapZohoCandidate(record(), options)),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.unwaivable).toBe(2);
    expect(summary.byReason.prohibited_field_present).toBe(1);
  });
});

describe("missingCriticalFields", () => {
  it("names the fields that make a record unusable", () => {
    const draft = mapZohoCandidate({ id: "z", First_Name: "Asha" }, options).draft;
    expect(missingCriticalFields(draft)).toEqual(["family_name", "email", "phone", "country_code"]);
  });

  it("is empty for a complete record", () => {
    expect(missingCriticalFields(mapZohoCandidate(record(), options).draft)).toEqual([]);
  });
});

describe("draftIdentityInput", () => {
  it("exposes only matching fields — no protected characteristic", () => {
    const input = draftIdentityInput(mapZohoCandidate(record(), options).draft);
    const serialized = JSON.stringify(input).toLowerCase();
    for (const term of ["marital_status", "gender", "sex", "race", "disability_status"]) {
      expect(serialized).not.toContain(term);
    }
    expect(input.employers).toEqual(["Acme Ltd"]);
  });
});

describe("education field coverage against the real Zoho org", () => {
  const OPTS = { countries: [{ code: "TZ", name: "Tanzania" }], hasConsent: true };

  it("reads the Training_Institution field this org actually populates", () => {
    // Stock Recruit uses Institute_Name; this org uses Training_Institution.
    // Without the alias every education row was dropped silently.
    const { draft } = mapZohoCandidate(
      {
        First_Name: "Ada",
        Last_Name: "Lovelace",
        Email: "ada@example.com",
        Training_Institution: "Dar Technical College",
        Highest_Qualification_Held: "Diploma",
      },
      OPTS,
    );
    expect(draft.education).toHaveLength(1);
    expect(draft.education[0]).toMatchObject({
      institution: "Dar Technical College",
      qualification: "Diploma",
    });
  });

  it("still prefers the stock field when both are present", () => {
    const { draft } = mapZohoCandidate(
      {
        Email: "a@b.com",
        Institute_Name: "Stock Field University",
        Training_Institution: "Fallback College",
      },
      OPTS,
    );
    expect(draft.education[0]?.institution).toBe("Stock Field University");
  });

  it("falls back to Professional_Qualification for the qualification", () => {
    const { draft } = mapZohoCandidate(
      {
        Email: "a@b.com",
        Training_Institution: "Somewhere",
        Professional_Qualification: "CPA",
      },
      OPTS,
    );
    expect(draft.education[0]?.qualification).toBe("CPA");
  });

  it("records no education when the org supplied no institution at all", () => {
    const { draft } = mapZohoCandidate(
      { Email: "a@b.com", Highest_Qualification_Held: "Degree" },
      OPTS,
    );
    expect(draft.education).toEqual([]);
  });
});
