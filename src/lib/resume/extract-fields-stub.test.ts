import { describe, it, expect } from "vitest";
import { extractResumeFieldsStub } from "@/lib/resume/extract-fields-stub";
import { resumeExtractionSchema } from "@/lib/resume/extraction-schema";

const SAMPLE_RESUME = `Amina Hassan
Senior Financial Analyst
amina.hassan@example.com | +255 712 345 678
Dar es Salaam, Tanzania · Available immediately

Summary
Results-driven financial analyst with 6 years of experience in banking and corporate finance.

Experience
Senior Financial Analyst, Acme Bank
Jan 2021 - Present
Led quarterly forecasting and built financial models for the retail banking division.

Financial Analyst, Beta Corp
Jun 2018 - Dec 2020
Supported budgeting and variance analysis for the finance team.

Education
University of Dar es Salaam
BCom Finance
Sep 2014 - Jun 2018

Skills
Financial Modeling, Excel, SQL, Forecasting, Budgeting

Certifications
CFA Level 1, CFA Institute

Languages
Swahili (Native)
English (Fluent)
`;

describe("extractResumeFieldsStub", () => {
  const result = extractResumeFieldsStub(SAMPLE_RESUME);

  it("always conforms to the shared extraction schema", () => {
    expect(() => resumeExtractionSchema.parse(result)).not.toThrow();
  });

  it("extracts given/family name from the first line of the resume", () => {
    expect(result.personal.given_name?.value).toBe("Amina");
    expect(result.personal.family_name?.value).toBe("Hassan");
    expect(result.personal.middle_name).toBeNull();
  });

  it("extracts a phone number from the contact block", () => {
    expect(result.personal.phone?.value).toBe("+255 712 345 678");
  });

  it("extracts a plausible headline from the top of the resume", () => {
    expect(result.personal.headline?.value).toBe("Senior Financial Analyst");
  });

  it("extracts the summary section", () => {
    expect(result.personal.summary?.value).toContain("Results-driven financial analyst");
  });

  it("infers country and city from known names in the text", () => {
    expect(result.personal.country_code?.value).toBe("TZ");
    expect(result.personal.city?.value).toBe("Dar Es Salaam");
  });

  it("extracts availability from free text", () => {
    expect(result.personal.availability?.value).toMatch(/available/i);
  });

  it("extracts two distinct work experience entries with correct dates", () => {
    expect(result.experience).toHaveLength(2);
    expect(result.experience[0]).toMatchObject({
      title: "Senior Financial Analyst",
      employer_name: "Acme Bank",
      start_date: "2021-01-01",
      end_date: null,
      is_current: true,
    });
    expect(result.experience[1]).toMatchObject({
      title: "Financial Analyst",
      employer_name: "Beta Corp",
      start_date: "2018-06-01",
      end_date: "2020-12-01",
      is_current: false,
    });
    // The next entry's header line must not bleed into the previous entry's description.
    expect(result.experience[0]?.description ?? "").not.toContain("Beta Corp");
  });

  it("merges a multi-line education block into a single entry (no double-counting)", () => {
    expect(result.education).toHaveLength(1);
    expect(result.education[0]).toMatchObject({
      institution: "University of Dar es Salaam",
      qualification: "BCom Finance",
      start_date: "2014-09-01",
      end_date: "2018-06-01",
      is_current: false,
    });
  });

  it("splits a comma-separated skills line into individual skills", () => {
    expect(result.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(["Financial Modeling", "Excel", "SQL", "Forecasting", "Budgeting"]),
    );
  });

  it("extracts certifications with name and issuer", () => {
    expect(result.certifications).toEqual([
      expect.objectContaining({ name: "CFA Level 1", issuer: "CFA Institute" }),
    ]);
  });

  it("extracts languages with proficiency from parenthetical notation", () => {
    expect(result.languages).toEqual([
      expect.objectContaining({ language: "Swahili", proficiency: "Native" }),
      expect.objectContaining({ language: "English", proficiency: "Fluent" }),
    ]);
  });

  it("uses modest confidence scores that nudge the review UI toward verification", () => {
    for (const item of result.experience) expect(item.confidence).toBeLessThan(0.85);
    for (const item of result.skills) expect(item.confidence).toBeLessThan(0.85);
  });

  it("returns all-null personal fields and empty lists for text with no recognizable structure", () => {
    const empty = extractResumeFieldsStub("Just a short unrelated sentence.");
    expect(() => resumeExtractionSchema.parse(empty)).not.toThrow();
    expect(empty.experience).toHaveLength(0);
    expect(empty.education).toHaveLength(0);
    expect(empty.skills).toHaveLength(0);
  });
});

// Reproduces a real-world layout where "Institution - dates" is on one line
// and the degree/qualification is on the line immediately AFTER it (rather
// than before), and the candidate has a three-part name.
const MIDDLE_NAME_AND_TRAILING_DEGREE_RESUME = `Grace Wanjiru Mwangi
grace.mwangi@example.com | 0712 345 678

Education
Institute of Finance and Management- Oct 2016- Nov 2018
Master of Science in Finance and Investment
University of Dar es Salaam- Oct 2008-July 2011
Bachelor of Commerce (B.Com) Accounting
Kilakala High School - Feb 2006-April 2008
Advanced Certificate of Secondary Education
`;

// Reproduces a "CURRICULUM VITAE" title line followed by a single combined
// "Name | Title | Phone | Email" contact line — a common real-world layout
// that a naive "line 0 is the name" heuristic would miss entirely.
const TITLE_LINE_AND_COMBINED_CONTACT_RESUME = `CURRICULUM VITAE

John Michael Doe | Senior Analyst | +255 700 111 222 | john.doe@example.com

Education
University of Nairobi
Bachelor of Science in Statistics
Jan 2015 - Dec 2018
`;

describe("extractResumeFieldsStub — title line + combined contact line", () => {
  const result = extractResumeFieldsStub(TITLE_LINE_AND_COMBINED_CONTACT_RESUME);

  it("skips the CV title line and splits the name from the combined contact line", () => {
    expect(result.personal.given_name?.value).toBe("John");
    expect(result.personal.middle_name?.value).toBe("Michael");
    expect(result.personal.family_name?.value).toBe("Doe");
  });

  it("still extracts the phone number from the same combined line", () => {
    expect(result.personal.phone?.value).toBe("+255 700 111 222");
  });
});

// Reproduces a real-world sidebar/template CV: name, a multi-line "Profile"
// paragraph, an unrecognized "Professional Qualification" section, and only
// THEN a "Contact" section with phone/emails — well past what a naive
// "phone must be near the top" heuristic would ever look at.
const SIDEBAR_TEMPLATE_RESUME = `GLORY MINJA

PROFILE
A proficient, resourceful and results-driven professional with a proven
track record in Assurance, Strategy, corporate governance and Business
Project management. Experienced in risk and Internal control assessments,
Internal Audits and external audit.

PROFESSIONAL QUALIFICATION
Hold Certificate in Directorship (CiDir) form Institute of Directors
Tanzania.
Associate Public Accountant (ACPA) & a member of NBAA

CONTACT
Mobile:+255713691517/+255786670116
Email: gloryminja@yahoo.com / gloryjminja@gmail.com

Education
University of Dar es Salaam
Bachelor of Commerce Accounting
Jan 2008 - Dec 2011
`;

describe("extractResumeFieldsStub — sidebar/template CV with contact block after several other sections", () => {
  const result = extractResumeFieldsStub(SIDEBAR_TEMPLATE_RESUME);

  it("extracts the name from the very first line", () => {
    expect(result.personal.given_name?.value).toBe("GLORY");
    expect(result.personal.family_name?.value).toBe("MINJA");
  });

  it("finds the phone number even though Contact is well past the top-of-document window", () => {
    // Two numbers are slash-separated in the source ("+255.../+255...") — "/"
    // isn't a valid phone character, so the regex cleanly stops at the first
    // complete number rather than swallowing the separator.
    expect(result.personal.phone?.value).toBe("+255713691517");
  });

  it("finds an email even though Contact is well past the top-of-document window", () => {
    expect(result.personal.email?.value).toBe("gloryminja@yahoo.com");
  });

  it("does not let the unrecognized Professional Qualification section bleed into the summary", () => {
    expect(result.personal.summary?.value ?? "").not.toContain("CiDir");
    expect(result.personal.summary?.value ?? "").not.toContain("Mobile");
  });
});

describe("extractResumeFieldsStub — degree-after-institution layout", () => {
  const result = extractResumeFieldsStub(MIDDLE_NAME_AND_TRAILING_DEGREE_RESUME);

  it("splits a three-part name into given/middle/family name", () => {
    expect(result.personal.given_name?.value).toBe("Grace");
    expect(result.personal.middle_name?.value).toBe("Wanjiru");
    expect(result.personal.family_name?.value).toBe("Mwangi");
  });

  it("extracts a qualification even when the degree line comes after the institution+dates line", () => {
    expect(result.education).toHaveLength(3);
    expect(result.education[0]).toMatchObject({
      institution: "Institute of Finance and Management",
      qualification: "Master of Science in Finance and Investment",
      start_date: "2016-10-01",
      end_date: "2018-11-01",
    });
    expect(result.education[1]).toMatchObject({
      institution: "University of Dar es Salaam",
      qualification: "Bachelor of Commerce (B.Com) Accounting",
      start_date: "2008-10-01",
      end_date: "2011-07-01",
    });
    expect(result.education[2]).toMatchObject({
      institution: "Kilakala High School",
      qualification: "Advanced Certificate of Secondary Education",
      start_date: "2006-02-01",
      end_date: "2008-04-01",
    });
  });
});
