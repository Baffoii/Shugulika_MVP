/**
 * Pure mappers: Zoho Recruit records → Shugulika row drafts.
 *
 * No I/O and no database access, so every mapping decision is unit-testable
 * without a Zoho connection. The writer (`runner.ts`) owns persistence.
 *
 * Guiding rule, same as the candidate mapper: prefer losing a *field* to
 * inventing one. Where Zoho gives nothing usable the draft carries `null` and
 * the runner records why, rather than substituting a plausible value that would
 * later read as real data.
 */
import {
  mapZohoStatusToStage,
  type StageMapping,
} from "@/lib/integrations/zoho-recruit/import/stage-map";

export interface ZohoRecord {
  [key: string]: unknown;
}

/** Countries the platform knows, passed in so this module stays pure. */
export interface CountryRef {
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------

function str(record: ZohoRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    // Zoho lookups arrive as { id, name }.
    if (value && typeof value === "object" && "name" in (value as Record<string, unknown>)) {
      const name = (value as Record<string, unknown>).name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return null;
}

/**
 * Zoho lookup fields arrive as `{ id, name }`. The id is the stable join key —
 * company names get re-typed and re-cased, ids do not — so linking a job to its
 * client by id avoids the near-miss matches a name comparison would produce.
 */
function lookupId(record: ZohoRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && "id" in (value as Record<string, unknown>)) {
      const id = (value as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) return id.trim();
      if (typeof id === "number") return String(id);
    }
  }
  return null;
}

function num(record: ZohoRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function int(record: ZohoRecord, ...keys: string[]): number | null {
  const value = num(record, ...keys);
  return value === null ? null : Math.max(0, Math.trunc(value));
}

/** Zoho dates are ISO-ish; anything unparseable becomes null rather than today. */
function isoDate(record: ZohoRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export function resolveCountryCode(
  raw: string | null,
  countries: readonly CountryRef[],
  fallback: string,
): string {
  if (!raw) return fallback;
  const needle = raw.trim().toLowerCase();
  const byCode = countries.find((c) => c.code.toLowerCase() === needle);
  if (byCode) return byCode.code;
  const byName = countries.find((c) => c.name.toLowerCase() === needle);
  if (byName) return byName.code;
  return fallback;
}

// ---------------------------------------------------------------------------
// Clients → organizations
// ---------------------------------------------------------------------------

export interface OrganizationDraft {
  name: string;
  org_type: "employer";
  country_code: string;
  industry: string | null;
  website: string | null;
  /** Imported employers are unverified until a human says otherwise. */
  verification_status: "pending";
  status: "active";
}

export function mapZohoClientToOrganization(
  record: ZohoRecord,
  options: { countries: readonly CountryRef[]; fallbackCountry: string },
): { draft: OrganizationDraft | null; problems: string[] } {
  const problems: string[] = [];
  const name = str(record, "Client_Name", "Account_Name", "Company", "Name");
  if (!name) {
    // Without a name there is nothing to identify the employer by, and a
    // placeholder would pollute employer search.
    return { draft: null, problems: ["client_name_missing"] };
  }

  const rawCountry = str(record, "Country", "Billing_Country", "Mailing_Country");
  if (!rawCountry) problems.push("country_missing_defaulted");

  return {
    draft: {
      name,
      org_type: "employer",
      country_code: resolveCountryCode(rawCountry, options.countries, options.fallbackCountry),
      industry: str(record, "Industry"),
      website: str(record, "Website"),
      verification_status: "pending",
      status: "active",
    },
    problems,
  };
}

// ---------------------------------------------------------------------------
// Job_Openings → job_orders
// ---------------------------------------------------------------------------

/** Zoho job status → Shugulika job_orders.status. */
const JOB_STATUS: Record<string, string> = {
  "in-progress": "active",
  "in progress": "active",
  active: "active",
  open: "active",
  "on-hold": "on_hold",
  "on hold": "on_hold",
  filled: "filled",
  closed: "closed",
  cancelled: "cancelled",
  canceled: "cancelled",
  inactive: "closed",
  draft: "draft",
  "waiting for approval": "submitted",
};

export interface JobOrderDraft {
  title: string;
  department: string | null;
  description: string | null;
  requirements: string | null;
  country_code: string;
  city: string | null;
  employment_type: string | null;
  work_arrangement: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  /** Imported jobs never publish a salary; that is an employer decision. */
  salary_public: false;
  vacancy_count: number;
  status: string;
  is_confidential: boolean;
  application_deadline: string | null;
  target_start_date: string | null;
  /** Zoho's client company name, used only as a fallback for linking. */
  clientName: string | null;
  /** Zoho Clients record id — the exact join key the runner prefers. */
  clientZohoId: string | null;
}

export function mapZohoJobOpeningToJobOrder(
  record: ZohoRecord,
  options: { countries: readonly CountryRef[]; fallbackCountry: string },
): { draft: JobOrderDraft | null; problems: string[] } {
  const problems: string[] = [];
  const title = str(record, "Job_Opening_Name", "Posting_Title", "Title");
  if (!title) return { draft: null, problems: ["job_title_missing"] };

  const rawStatus = str(record, "Job_Opening_Status", "Status");
  const statusKey = (rawStatus ?? "").toLowerCase().replace(/[_-]+/g, " ").trim();
  const status = JOB_STATUS[statusKey] ?? JOB_STATUS[(rawStatus ?? "").toLowerCase()] ?? null;
  if (!status) problems.push(rawStatus ? "job_status_unmapped" : "job_status_missing");

  const rawCountry = str(record, "Country", "Job_Country");
  if (!rawCountry) problems.push("country_missing_defaulted");

  // Stock Zoho Recruit has one `Salary` field, not a min/max pair. Record it as
  // the lower bound and leave max null rather than fabricating a range.
  const min = num(record, "Salary_Min", "Minimum_Salary", "Lower_Salary", "Salary");
  const max = num(record, "Salary_Max", "Maximum_Salary", "Upper_Salary");
  if (min !== null && max !== null && min > max) problems.push("salary_range_inverted");

  return {
    draft: {
      title,
      department: str(record, "Department_Name", "Department", "Category"),
      description: str(record, "Job_Description", "Description"),
      requirements: str(record, "Required_Skills", "Requirements", "Skill_Set"),
      country_code: resolveCountryCode(rawCountry, options.countries, options.fallbackCountry),
      city: str(record, "City", "Job_City"),
      employment_type: str(record, "Job_Type", "Employment_Type"),
      // Zoho's Remote_Job is a boolean; anything richer than remote/onsite is
      // not represented there, so we record only what it actually tells us.
      work_arrangement:
        record.Remote_Job === true ? "remote" : record.Remote_Job === false ? "onsite" : null,
      salary_min: min,
      salary_max: max,
      salary_currency: str(record, "Salary_Currency", "Currency"),
      salary_public: false,
      vacancy_count: Math.max(1, int(record, "Number_of_Positions", "No_of_Positions") ?? 1),
      // An unmapped Zoho status must not silently become "active" — a live job
      // board entry is exactly the kind of thing a rehearsal must not fabricate.
      status: status ?? "closed",
      is_confidential: record.Is_Confidential === true,
      application_deadline: isoDate(record, "Target_Date", "Application_Deadline"),
      target_start_date: isoDate(record, "Date_Opened", "Start_Date"),
      clientName: str(record, "Client_Name", "Account_Name", "Company"),
      clientZohoId: lookupId(record, "Client_Name", "Account_Name", "Client"),
    },
    problems,
  };
}

// ---------------------------------------------------------------------------
// Job/candidate associations → applications
// ---------------------------------------------------------------------------

export interface ApplicationDraft {
  /** Zoho candidate id; the runner resolves it to a local candidate. */
  zohoCandidateId: string;
  current_stage: string;
  rejected_from_stage: string | null;
  is_on_hold: boolean;
  entry_source: string;
  recruitment_path: "A" | "B";
  /** Always true — imported applications are immutable history. */
  is_migrated_readonly: true;
  stageMapping: StageMapping;
}

export function mapAssociationToApplication(
  record: ZohoRecord,
  options: { zohoCandidateId: string; recruitmentPath?: "A" | "B" },
): { draft: ApplicationDraft; problems: string[] } {
  const problems: string[] = [];
  const rawStatus = str(record, "Candidate_Status", "Application_Status", "Status");
  const stageMapping = mapZohoStatusToStage(rawStatus);
  if (stageMapping.isUnmapped) {
    problems.push(rawStatus ? "application_status_unmapped" : "application_status_missing");
  }

  return {
    draft: {
      zohoCandidateId: options.zohoCandidateId,
      current_stage: stageMapping.stage,
      rejected_from_stage: stageMapping.rejectedFromStage,
      is_on_hold: stageMapping.isOnHold,
      entry_source: "zoho_migration",
      recruitment_path: options.recruitmentPath ?? "B",
      is_migrated_readonly: true,
      stageMapping,
    },
    problems,
  };
}

// ---------------------------------------------------------------------------
// Attachments → candidate_documents
// ---------------------------------------------------------------------------

const CV_EXTENSIONS = new Set(["pdf", "doc", "docx", "rtf", "odt", "txt"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  txt: "text/plain",
};

export function fileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match?.[1] ? match[1].toLowerCase() : "";
}

export function looksLikeCv(fileName: string): boolean {
  return CV_EXTENSIONS.has(fileExtension(fileName));
}

export function mimeForFile(fileName: string, provided: string | null): string {
  // Zoho frequently returns application/octet-stream; a known extension is a
  // better signal than that, and the browser needs the real type to preview.
  if (provided && provided !== "application/octet-stream" && !provided.startsWith("text/html")) {
    return provided.split(";")[0]!.trim();
  }
  return MIME_BY_EXTENSION[fileExtension(fileName)] ?? "application/octet-stream";
}

/**
 * Storage path for a migrated CV. Scoped by candidate so the existing
 * candidate-documents RLS policies apply unchanged, and suffixed with the Zoho
 * attachment id so re-running the import overwrites rather than duplicating.
 */
export function migratedCvObjectPath(
  candidateId: string,
  zohoAttachmentId: string,
  fileName: string,
): string {
  const ext = fileExtension(fileName);
  const safeExt = ext && /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : "";
  return `candidate/${candidateId}/zoho-migration/${zohoAttachmentId}${safeExt}`;
}
