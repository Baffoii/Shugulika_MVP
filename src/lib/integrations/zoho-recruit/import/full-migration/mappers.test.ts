import { describe, it, expect } from "vitest";
import {
  mapZohoClientToOrganization,
  mapZohoJobOpeningToJobOrder,
  mapAssociationToApplication,
  resolveCountryCode,
  looksLikeCv,
  mimeForFile,
  migratedCvObjectPath,
  fileExtension,
} from "@/lib/integrations/zoho-recruit/import/full-migration/mappers";

const COUNTRIES = [
  { code: "TZ", name: "Tanzania" },
  { code: "KE", name: "Kenya" },
];
const OPTS = { countries: COUNTRIES, fallbackCountry: "TZ" };

describe("resolveCountryCode", () => {
  it("matches by code and by name, case-insensitively", () => {
    expect(resolveCountryCode("ke", COUNTRIES, "TZ")).toBe("KE");
    expect(resolveCountryCode("Kenya", COUNTRIES, "TZ")).toBe("KE");
  });

  it("falls back rather than inventing a country code", () => {
    expect(resolveCountryCode("Atlantis", COUNTRIES, "TZ")).toBe("TZ");
    expect(resolveCountryCode(null, COUNTRIES, "TZ")).toBe("TZ");
  });
});

describe("mapZohoClientToOrganization", () => {
  it("maps a client company to an unverified employer org", () => {
    const { draft, problems } = mapZohoClientToOrganization(
      { Client_Name: "Acme Ltd", Country: "Kenya", Industry: "Mining", Website: "acme.co" },
      OPTS,
    );
    expect(draft).toMatchObject({
      name: "Acme Ltd",
      org_type: "employer",
      country_code: "KE",
      industry: "Mining",
      verification_status: "pending",
    });
    expect(problems).toEqual([]);
  });

  it("rejects a client with no name instead of inventing a placeholder", () => {
    const { draft, problems } = mapZohoClientToOrganization({ Country: "Kenya" }, OPTS);
    expect(draft).toBeNull();
    expect(problems).toContain("client_name_missing");
  });

  it("flags a defaulted country rather than hiding it", () => {
    const { draft, problems } = mapZohoClientToOrganization({ Client_Name: "Acme" }, OPTS);
    expect(draft?.country_code).toBe("TZ");
    expect(problems).toContain("country_missing_defaulted");
  });

  it("reads a Zoho lookup object's name", () => {
    const { draft } = mapZohoClientToOrganization(
      { Account_Name: { id: "1", name: "Lookup Corp" } },
      OPTS,
    );
    expect(draft?.name).toBe("Lookup Corp");
  });
});

describe("mapZohoJobOpeningToJobOrder", () => {
  it("maps a live opening", () => {
    const { draft, problems } = mapZohoJobOpeningToJobOrder(
      {
        Job_Opening_Name: "Welder",
        Job_Opening_Status: "In-Progress",
        Country: "Tanzania",
        City: "Arusha",
        Number_of_Positions: 3,
        Client_Name: "Acme Ltd",
        Remote_Job: false,
      },
      OPTS,
    );
    expect(draft).toMatchObject({
      title: "Welder",
      status: "active",
      country_code: "TZ",
      city: "Arusha",
      vacancy_count: 3,
      work_arrangement: "onsite",
      clientName: "Acme Ltd",
    });
    expect(problems).toEqual([]);
  });

  it("never publishes a salary for an imported job", () => {
    const { draft } = mapZohoJobOpeningToJobOrder(
      { Job_Opening_Name: "X", Job_Opening_Status: "Closed", Salary_Min: 100, Salary_Max: 200 },
      OPTS,
    );
    expect(draft?.salary_public).toBe(false);
  });

  it("closes an unmapped status rather than defaulting it live", () => {
    // Defaulting an unknown status to `active` would put a fabricated job on
    // the public board.
    const { draft, problems } = mapZohoJobOpeningToJobOrder(
      { Job_Opening_Name: "Mystery", Job_Opening_Status: "Bespoke Status" },
      OPTS,
    );
    expect(draft?.status).toBe("closed");
    expect(problems).toContain("job_status_unmapped");
  });

  it("requires a title", () => {
    const { draft, problems } = mapZohoJobOpeningToJobOrder({ Job_Opening_Status: "Open" }, OPTS);
    expect(draft).toBeNull();
    expect(problems).toContain("job_title_missing");
  });

  it("always seats at least one vacancy", () => {
    const { draft } = mapZohoJobOpeningToJobOrder(
      { Job_Opening_Name: "X", Job_Opening_Status: "Open", Number_of_Positions: 0 },
      OPTS,
    );
    expect(draft?.vacancy_count).toBe(1);
  });

  it("flags an inverted salary range", () => {
    const { problems } = mapZohoJobOpeningToJobOrder(
      { Job_Opening_Name: "X", Job_Opening_Status: "Open", Salary_Min: 900, Salary_Max: 100 },
      OPTS,
    );
    expect(problems).toContain("salary_range_inverted");
  });
});

describe("mapAssociationToApplication", () => {
  it("maps an association's status onto a pipeline stage", () => {
    const { draft, problems } = mapAssociationToApplication(
      { Candidate_Status: "Submitted to Client" },
      { zohoCandidateId: "z1" },
    );
    expect(draft.current_stage).toBe("client_submission");
    expect(draft.is_migrated_readonly).toBe(true);
    expect(draft.entry_source).toBe("zoho_migration");
    expect(problems).toEqual([]);
  });

  it("records where a rejection happened", () => {
    const { draft } = mapAssociationToApplication(
      { Candidate_Status: "Rejected-by-Client" },
      { zohoCandidateId: "z1" },
    );
    expect(draft.current_stage).toBe("rejected");
    expect(draft.rejected_from_stage).toBe("client_submission");
  });

  it("carries on-hold as a flag", () => {
    const { draft } = mapAssociationToApplication(
      { Candidate_Status: "On Hold" },
      { zohoCandidateId: "z1" },
    );
    expect(draft.is_on_hold).toBe(true);
  });

  it("flags a missing or unknown status rather than assuming cv_review", () => {
    const missing = mapAssociationToApplication({}, { zohoCandidateId: "z1" });
    expect(missing.draft.current_stage).toBe("zoho_unmapped");
    expect(missing.problems).toContain("application_status_missing");

    const unknown = mapAssociationToApplication(
      { Candidate_Status: "Weird Custom Thing" },
      { zohoCandidateId: "z1" },
    );
    expect(unknown.problems).toContain("application_status_unmapped");
  });

  it("always marks the application immutable history", () => {
    for (const status of ["Hired", "Rejected", "New", undefined]) {
      const { draft } = mapAssociationToApplication(status ? { Candidate_Status: status } : {}, {
        zohoCandidateId: "z1",
      });
      expect(draft.is_migrated_readonly).toBe(true);
    }
  });
});

describe("CV attachment helpers", () => {
  it("recognises CV-shaped files and ignores others", () => {
    expect(looksLikeCv("resume.pdf")).toBe(true);
    expect(looksLikeCv("cv.DOCX")).toBe(true);
    expect(looksLikeCv("headshot.png")).toBe(false);
    expect(looksLikeCv("noextension")).toBe(false);
  });

  it("prefers a known extension over Zoho's octet-stream", () => {
    expect(mimeForFile("cv.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(mimeForFile("cv.docx", null)).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("keeps a genuine content type and strips parameters", () => {
    expect(mimeForFile("cv.pdf", "application/pdf; charset=binary")).toBe("application/pdf");
  });

  it("scopes the storage path to the candidate and the Zoho attachment", () => {
    const path = migratedCvObjectPath("cand-1", "att-9", "My CV.pdf");
    // Candidate-scoped so existing candidate-documents RLS applies unchanged.
    expect(path).toBe("candidate/cand-1/zoho-migration/att-9.pdf");
  });

  it("produces a stable path so re-running overwrites instead of duplicating", () => {
    const a = migratedCvObjectPath("c", "att-1", "cv.pdf");
    const b = migratedCvObjectPath("c", "att-1", "cv.pdf");
    expect(a).toBe(b);
  });

  it("drops a suspicious extension rather than putting it in the path", () => {
    expect(fileExtension("evil.p h p")).toBe("");
    expect(migratedCvObjectPath("c", "a", "weird.name.with.no.ext!")).toBe(
      "candidate/c/zoho-migration/a",
    );
  });
});
