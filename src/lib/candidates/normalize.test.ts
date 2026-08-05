import { describe, it, expect } from "vitest";
import {
  fullName,
  isEmailShaped,
  nameSortKey,
  nameTokens,
  normalizeCountryCode,
  normalizeDate,
  normalizeEmail,
  normalizeEmployer,
  normalizeInstitution,
  normalizeLocation,
  normalizeName,
  normalizePhone,
  normalizeQualification,
  normalizeSkill,
  normalizeSkillSet,
  phoneMatchKey,
  toCandidateIdentity,
} from "@/lib/candidates/normalize";

describe("name normalization", () => {
  it("strips honorifics, punctuation, and suffixes", () => {
    expect(normalizeName("Dr. Asha J. Mwakalinga Jr.")).toBe("asha j mwakalinga");
  });

  it("folds accents so the same person compares equal", () => {
    expect(normalizeName("Mwanaïsha")).toBe(normalizeName("Mwanaisha"));
  });

  it("keeps single initials, which are often the only trace of a middle name", () => {
    expect(nameTokens("Asha J Mwakalinga")).toEqual(["asha", "j", "mwakalinga"]);
  });

  it("produces an order-independent key", () => {
    expect(nameSortKey("Asha John Mwakalinga")).toBe(nameSortKey("Mwakalinga, Asha John"));
  });

  it("joins name parts, dropping the missing ones", () => {
    expect(fullName(["Asha", null, "Mwakalinga"])).toBe("Asha Mwakalinga");
    expect(fullName([null, undefined, ""])).toBe("");
  });

  it("is empty-safe", () => {
    expect(normalizeName(null)).toBe("");
    expect(nameSortKey(undefined)).toBe("");
  });
});

describe("email normalization", () => {
  it("lowercases and drops a plus tag", () => {
    expect(normalizeEmail("Asha+jobs@Example.com")).toBe("asha@example.com");
  });

  it("ignores dots in the local part only where the provider does", () => {
    expect(normalizeEmail("a.s.h.a@gmail.com")).toBe("asha@gmail.com");
    expect(normalizeEmail("a.s.h.a@example.com")).toBe("a.s.h.a@example.com");
  });

  it("rejects anything that is not a single address", () => {
    for (const bad of ["not an email", "a@b", "a@@b.com", "a@b.com, c@d.com", "", null]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("reports shape separately from normalization", () => {
    expect(isEmailShaped("Asha@Example.com")).toBe(true);
    expect(isEmailShaped("asha at example")).toBe(false);
  });
});

describe("phone normalization", () => {
  it("treats local, international, and 00-prefixed forms as the same number", () => {
    const forms = ["0712 345 678", "+255712345678", "00255712345678", "255-712-345-678"];
    const keys = forms.map((f) => phoneMatchKey(f));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("712345678");
  });

  it("produces an E.164 form with the trunk zero removed", () => {
    expect(normalizePhone("0712345678")?.e164).toBe("+255712345678");
    expect(normalizePhone("0712345678")?.national).toBe("712345678");
  });

  it("keeps a foreign country code rather than forcing the default", () => {
    const kenyan = normalizePhone("+254712345678");
    expect(kenyan?.countryCode).toBe("254");
    expect(kenyan?.e164).toBe("+254712345678");
  });

  it("returns null rather than inventing a number", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(phoneMatchKey("n/a")).toBeNull();
  });
});

describe("date normalization", () => {
  it("completes partial dates to the first of the period", () => {
    expect(normalizeDate("2019")).toBe("2019-01-01");
    expect(normalizeDate("2019-06")).toBe("2019-06-01");
    expect(normalizeDate("March 2019")).toBe("2019-03-01");
  });

  it("reads ambiguous numeric dates day-first", () => {
    expect(normalizeDate("03/04/2020")).toBe("2020-04-03");
  });

  it("falls back to month-first when day-first is impossible", () => {
    expect(normalizeDate("12/25/2020")).toBe("2020-12-25");
  });

  it("passes ISO dates through", () => {
    expect(normalizeDate("2020-04-03")).toBe("2020-04-03");
  });

  it("rejects impossible and open-ended values", () => {
    expect(normalizeDate("2020-02-31")).toBeNull();
    expect(normalizeDate("Present")).toBeNull();
    expect(normalizeDate("sometime")).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });
});

describe("location, employer, institution, qualification", () => {
  it("keeps only the most specific part of a location", () => {
    expect(normalizeLocation("Dar es Salaam, Tanzania")).toBe("dar es salaam");
    expect(normalizeLocation("Arusha City")).toBe("arusha");
  });

  it("drops legal-form and local-subsidiary markers from employers", () => {
    expect(normalizeEmployer("Acme Ltd")).toBe("acme");
    expect(normalizeEmployer("ACME (T) Limited")).toBe("acme");
    expect(normalizeEmployer("Acme Tanzania Company")).toBe("acme");
  });

  it("never reduces an employer to nothing", () => {
    expect(normalizeEmployer("Limited")).toBe("limited");
  });

  it("strips institution stopwords", () => {
    expect(normalizeInstitution("The University of Dodoma")).toBe("university dodoma");
  });

  it("expands qualification abbreviations", () => {
    expect(normalizeQualification("BSc")).toBe("bachelor of science");
    expect(normalizeQualification("MBA Finance")).toBe("master of business administration finance");
    expect(normalizeQualification("Bachelor of Commerce")).toBe("bachelor of commerce");
  });
});

describe("skill normalization", () => {
  it("folds common aliases", () => {
    expect(normalizeSkill("JS")).toBe("javascript");
    expect(normalizeSkill("Node.js")).toBe("node.js");
    expect(normalizeSkill("MS Excel")).toBe("microsoft excel");
  });

  it("keeps symbols that distinguish languages", () => {
    expect(normalizeSkill("C++")).toBe("c++");
    expect(normalizeSkill("C#")).toBe("c#");
  });

  it("deduplicates and sorts a set", () => {
    expect(normalizeSkillSet(["JS", "javascript", "SQL", null, ""])).toEqual(["javascript", "sql"]);
  });
});

describe("country normalization", () => {
  const supported = [
    { code: "TZ", name: "Tanzania" },
    { code: "KE", name: "Kenya" },
  ];

  it("accepts a code or a name", () => {
    expect(normalizeCountryCode("tz", supported)).toBe("TZ");
    expect(normalizeCountryCode("Kenya", supported)).toBe("KE");
  });

  it("returns null for anything unsupported rather than guessing", () => {
    expect(normalizeCountryCode("Atlantis", supported)).toBeNull();
    expect(normalizeCountryCode(null, supported)).toBeNull();
  });
});

describe("toCandidateIdentity", () => {
  it("normalizes every comparison field at once", () => {
    const identity = toCandidateIdentity({
      givenName: "Asha",
      middleName: "J",
      familyName: "Mwakalinga",
      email: "Asha+cv@Gmail.com",
      phone: "0712 345 678",
      city: "Dar es Salaam, Tanzania",
      countryCode: "tz",
      dateOfBirth: "12/03/1995",
      employers: ["Acme Ltd", "Acme (T) Limited"],
      institutions: ["The University of Dodoma"],
      skills: ["JS", "javascript"],
    });

    expect(identity.email).toBe("asha@gmail.com");
    expect(identity.phoneKey).toBe("712345678");
    expect(identity.nameKey).toBe("asha j mwakalinga");
    expect(identity.location).toBe("dar es salaam");
    expect(identity.countryCode).toBe("TZ");
    expect(identity.dateOfBirth).toBe("1995-03-12");
    // Both employer spellings collapse to one.
    expect(identity.employers).toEqual(["acme"]);
    expect(identity.institutions).toEqual(["university dodoma"]);
    expect(identity.skills).toEqual(["javascript"]);
  });

  it("survives a completely empty record", () => {
    const identity = toCandidateIdentity({});
    expect(identity.nameKey).toBe("");
    expect(identity.email).toBeNull();
    expect(identity.phoneKey).toBeNull();
    expect(identity.employers).toEqual([]);
  });
});
