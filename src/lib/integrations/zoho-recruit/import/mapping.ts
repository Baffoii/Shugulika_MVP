/**
 * Zoho Recruit Candidate record → canonical Shugulika candidate draft.
 *
 * Two rules govern this translation:
 *
 *   1. **Canonical is Shugulika.** The draft is shaped like `candidate_profiles`
 *      and its children, not like Zoho. Zoho is a satellite; employer search
 *      runs on our records, never on a Zoho projection.
 *   2. **Prohibited fields are refused, not stripped.** If the source record
 *      carries nationality, citizenship, or another protected characteristic
 *      with a value, the record is quarantined so an operator sees that the
 *      upstream system holds data we will not ingest. Silently dropping it would
 *      hide a compliance problem rather than surface it.
 *
 * Pure — no I/O, no network.
 */
import { isProhibitedImportField, type QuarantineReason } from "@/lib/candidates/constants";
import {
  normalizeCountryCode,
  normalizeDate,
  normalizeEmail,
  normalizePhone,
  normalizeText,
} from "@/lib/candidates/normalize";

/** A raw Zoho record as it comes off the API: untyped keys, unknown values. */
export type ZohoCandidateRecord = Record<string, unknown>;

export interface CandidateDraft {
  givenName: string | null;
  middleName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  countryCode: string | null;
  headline: string | null;
  summary: string | null;
  availability: string | null;
  skills: string[];
  experiences: Array<{
    title: string;
    employerName: string | null;
    startDate: string | null;
    endDate: string | null;
  }>;
  education: Array<{
    institution: string;
    qualification: string | null;
    endDate: string | null;
  }>;
}

export interface MappingResult {
  draft: CandidateDraft;
  /** Reasons the record cannot be imported as-is. Empty means it maps cleanly. */
  problems: QuarantineReason[];
  /** Prohibited source keys that carried a value, for the operator's report. */
  prohibitedFields: string[];
  /** Content hash of the mapped draft, for change detection on re-import. */
  fingerprint: string;
}

/**
 * Zoho field API names we read, in preference order. Zoho org customization
 * means the same concept appears under several names, so each canonical field
 * lists the aliases we accept rather than assuming one layout.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  givenName: ["First_Name", "first_name", "firstName", "Given_Name"],
  familyName: ["Last_Name", "last_name", "lastName", "Family_Name"],
  middleName: ["Middle_Name", "middle_name", "middleName"],
  email: ["Email", "email", "Secondary_Email", "Email_Address"],
  phone: ["Phone", "phone", "Mobile", "mobile", "Phone_Number"],
  city: ["City", "city", "Current_Location", "Location"],
  country: ["Country", "country", "Current_Country"],
  headline: ["Current_Job_Title", "Job_Title", "Title", "Headline"],
  summary: ["Candidate_Summary", "Summary", "Professional_Summary"],
  availability: ["Availability", "Notice_Period", "Available_From"],
  skills: ["Skill_Set", "Skills", "skills"],
  currentEmployer: ["Current_Employer", "Employer", "Company"],
  highestQualification: ["Highest_Qualification_Held", "Qualification", "Degree"],
  institution: ["Institute_Name", "Institution", "University"],
};

function readString(record: ZohoCandidateRecord, aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const value = record[alias];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function readList(record: ZohoCandidateRecord, aliases: readonly string[]): string[] {
  for (const alias of aliases) {
    const value = record[alias];
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    }
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/[,;|]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Non-cryptographic content hash. Used only to notice that a source record
 * changed since the last import — never as a security or identity primitive.
 */
export function fingerprintDraft(draft: CandidateDraft): string {
  const canonical = JSON.stringify(draft, Object.keys(draft).sort());
  let hash = 5381;
  for (let i = 0; i < canonical.length; i += 1) {
    hash = ((hash << 5) + hash + canonical.charCodeAt(i)) >>> 0;
  }
  return `zcd_${hash.toString(16)}`;
}

/** Prohibited source keys that actually carry a value. */
export function findProhibitedFields(record: ZohoCandidateRecord): string[] {
  const found: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (!isProhibitedImportField(key)) continue;
    const isEmpty =
      value == null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (!isEmpty) found.push(key);
  }
  return found;
}

/** Largest source record we will stage, in serialized characters. */
export const MAX_SOURCE_RECORD_CHARS = 200_000;

export interface MappingOptions {
  /** Supported countries, for resolving a country name to an ISO code. */
  countries: ReadonlyArray<{ code: string; name: string }>;
  /**
   * Whether processing consent is on file for this record. The import will not
   * create a canonical candidate without it.
   */
  hasConsent?: boolean;
}

export function mapZohoCandidate(
  record: ZohoCandidateRecord,
  options: MappingOptions,
): MappingResult {
  const problems: QuarantineReason[] = [];
  const prohibitedFields = findProhibitedFields(record);
  if (prohibitedFields.length > 0) problems.push("prohibited_field_present");

  if (JSON.stringify(record).length > MAX_SOURCE_RECORD_CHARS) {
    problems.push("payload_too_large");
  }

  const givenName = readString(record, FIELD_ALIASES.givenName ?? []);
  const familyName = readString(record, FIELD_ALIASES.familyName ?? []);
  if (!givenName && !familyName) problems.push("missing_name");

  const rawEmail = readString(record, FIELD_ALIASES.email ?? []);
  const email = normalizeEmail(rawEmail);
  if (rawEmail && !email) problems.push("invalid_email");

  const rawPhone = readString(record, FIELD_ALIASES.phone ?? []);
  const phone = normalizePhone(rawPhone);
  if (rawPhone && !phone) problems.push("invalid_phone");

  if (!email && !phone) problems.push("missing_contact");

  const rawCountry = readString(record, FIELD_ALIASES.country ?? []);
  const countryCode = normalizeCountryCode(rawCountry, options.countries);
  if (rawCountry && !countryCode) problems.push("unmapped_country");

  if (options.hasConsent === false) problems.push("consent_missing");

  const currentEmployer = readString(record, FIELD_ALIASES.currentEmployer ?? []);
  const headline = readString(record, FIELD_ALIASES.headline ?? []);
  const institution = readString(record, FIELD_ALIASES.institution ?? []);
  const qualification = readString(record, FIELD_ALIASES.highestQualification ?? []);

  const availabilityRaw = readString(record, FIELD_ALIASES.availability ?? []);
  // Availability is sometimes a date and sometimes free text ("2 weeks"). A
  // date that will not parse is a real defect; free text is not.
  const availability = availabilityRaw ? (normalizeDate(availabilityRaw) ?? availabilityRaw) : null;
  if (
    availabilityRaw &&
    /\d{1,4}[/.-]\d{1,4}/.test(availabilityRaw) &&
    !normalizeDate(availabilityRaw)
  ) {
    problems.push("invalid_date");
  }

  const draft: CandidateDraft = {
    givenName,
    middleName: readString(record, FIELD_ALIASES.middleName ?? []),
    familyName,
    email,
    phone: phone?.e164 ?? null,
    city: readString(record, FIELD_ALIASES.city ?? []),
    countryCode,
    headline,
    summary: readString(record, FIELD_ALIASES.summary ?? []),
    availability,
    skills: readList(record, FIELD_ALIASES.skills ?? []),
    experiences:
      currentEmployer || headline
        ? [
            {
              title: headline ?? "Unspecified role",
              employerName: currentEmployer,
              startDate: null,
              endDate: null,
            },
          ]
        : [],
    education: institution ? [{ institution, qualification, endDate: null }] : [],
  };

  return {
    draft,
    problems: [...new Set(problems)],
    prohibitedFields,
    fingerprint: fingerprintDraft(draft),
  };
}

/**
 * Identity fields the match stage compares. Extracted here so mapping and
 * matching read the same values off the same draft.
 */
export function draftIdentityInput(draft: CandidateDraft) {
  return {
    givenName: draft.givenName,
    middleName: draft.middleName,
    familyName: draft.familyName,
    email: draft.email,
    phone: draft.phone,
    city: draft.city,
    countryCode: draft.countryCode,
    employers: draft.experiences.map((e) => e.employerName),
    institutions: draft.education.map((e) => e.institution),
    skills: draft.skills,
  };
}

/** Batch-level duplicate detection: two source records claiming the same identity. */
export function findIntraBatchDuplicates(
  results: ReadonlyArray<{ zohoRecordId: string; draft: CandidateDraft }>,
): Set<string> {
  const byIdentity = new Map<string, string[]>();
  for (const { zohoRecordId, draft } of results) {
    const keys: string[] = [];
    if (draft.email) keys.push(`email:${draft.email}`);
    if (draft.phone) keys.push(`phone:${draft.phone}`);
    if (keys.length === 0) {
      const name = normalizeText([draft.givenName, draft.familyName].filter(Boolean).join(" "));
      if (name) keys.push(`name:${name}`);
    }
    for (const key of keys) {
      const bucket = byIdentity.get(key);
      if (bucket) bucket.push(zohoRecordId);
      else byIdentity.set(key, [zohoRecordId]);
    }
  }

  const duplicates = new Set<string>();
  for (const ids of byIdentity.values()) {
    if (ids.length > 1) for (const id of ids) duplicates.add(id);
  }
  return duplicates;
}
