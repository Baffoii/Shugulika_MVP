import "server-only";

import type { CandidateFieldMapping } from "@/lib/integrations/zoho-recruit/candidate-field-map";
import { readMappedValue } from "@/lib/integrations/zoho-recruit/candidate-field-map";
import {
  isZohoCandidateSearchEligible,
  type EligibilityResult,
} from "@/lib/integrations/zoho-recruit/candidate-eligibility";

export type NormalizedZohoSearchCandidate = {
  zohoCandidateId: string;
  teaserLabel: string;
  fullName: string | null;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  employerOrIndustry: string | null;
  industry: string | null;
  skills: string[];
  yearsExperience: number | null;
  qualification: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  candidateStatus: string | null;
  availability: string | null;
  hasResume: boolean;
  zohoAttachmentId: string | null;
  searchEligible: boolean;
  consentOrVisibility: string | null;
  zohoCreatedAt: string | null;
  zohoModifiedAt: string | null;
  eligibility: EligibilityResult;
};

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t || null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((item) => asText(item)).filter((item): item is string => Boolean(item));
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.name === "string") return obj.name.trim() || null;
    if (typeof obj.display_value === "string") return obj.display_value.trim() || null;
  }
  return null;
}

function asStringId(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t || null;
  }
  // Never use Number() — Zoho IDs can exceed JS safe integer range.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function asSkills(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        const text = asText(item);
        return text ? text.split(/[,;|]/) : [];
      })
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i);
  }
  const text = asText(value);
  if (!text) return [];
  return text
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i);
}

function asYears(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asIsoDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function guessCountryCode(country: string | null): string | null {
  if (!country) return null;
  const t = country.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return null;
}

function teaserFrom(record: { jobTitle: string | null; zohoCandidateId: string }): string {
  if (record.jobTitle) return record.jobTitle;
  const short =
    record.zohoCandidateId.replace(/\D/g, "").slice(-8) || record.zohoCandidateId.slice(-8);
  return `Candidate ${short.toUpperCase()}`;
}

function asBool(value: unknown): boolean | null {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(t)) return true;
    if (["false", "0", "no", "n"].includes(t)) return false;
  }
  return null;
}

function resumeMeta(value: unknown): { hasResume: boolean; attachmentId: string | null } {
  if (value == null || value === false || value === "") {
    return { hasResume: false, attachmentId: null };
  }
  if (typeof value === "string") {
    const t = value.trim();
    // File fields sometimes return an id or filename.
    if (!t) return { hasResume: false, attachmentId: null };
    if (/^\d{6,}$/.test(t)) return { hasResume: true, attachmentId: t };
    return { hasResume: true, attachmentId: null };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const id =
      asStringId(obj.id) ??
      asStringId(obj.attachment_Id) ??
      asStringId(obj.file_Id) ??
      asStringId(obj.File_Id);
    return { hasResume: true, attachmentId: id };
  }
  return { hasResume: true, attachmentId: null };
}

export function normalizeZohoCandidateRecord(
  raw: unknown,
  mapping: CandidateFieldMapping,
): NormalizedZohoSearchCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const zohoCandidateId =
    asStringId(readMappedValue(record, mapping, "zohoCandidateId")) ?? asStringId(record.id);
  if (!zohoCandidateId) return null;

  const eligibility = isZohoCandidateSearchEligible(record, mapping);
  const givenName = asText(readMappedValue(record, mapping, "firstName"));
  const familyName = asText(readMappedValue(record, mapping, "lastName"));
  const fullName =
    asText(readMappedValue(record, mapping, "fullName")) ||
    [givenName, familyName].filter(Boolean).join(" ") ||
    null;
  const jobTitle = asText(readMappedValue(record, mapping, "jobTitle"));
  const currentEmployer = asText(readMappedValue(record, mapping, "currentEmployer"));
  const industry = asText(readMappedValue(record, mapping, "industry"));
  const resume = resumeMeta(readMappedValue(record, mapping, "resumeFileId"));
  const attachmentPresent = asBool(readMappedValue(record, mapping, "attachmentPresent"));
  const country = asText(readMappedValue(record, mapping, "country"));

  return {
    zohoCandidateId,
    teaserLabel: teaserFrom({ jobTitle, zohoCandidateId }),
    fullName,
    givenName,
    familyName,
    email: asText(readMappedValue(record, mapping, "email")),
    phone: asText(readMappedValue(record, mapping, "phone")),
    jobTitle,
    employerOrIndustry: currentEmployer || industry,
    industry,
    skills: asSkills(readMappedValue(record, mapping, "skills")),
    yearsExperience: asYears(readMappedValue(record, mapping, "yearsExperience")),
    qualification: asText(readMappedValue(record, mapping, "qualification")),
    city: asText(readMappedValue(record, mapping, "city")),
    country,
    countryCode: guessCountryCode(country),
    candidateStatus: eligibility.status,
    availability: asText(readMappedValue(record, mapping, "availability")),
    // Many Zoho orgs store CVs only on the Attachments related list and expose
    // Is_Attachment_Present on the candidate — not a Resume file field.
    hasResume: resume.hasResume || attachmentPresent === true,
    zohoAttachmentId: resume.attachmentId,
    searchEligible: eligibility.eligible,
    consentOrVisibility: eligibility.consentOrVisibility,
    zohoCreatedAt: asIsoDate(readMappedValue(record, mapping, "createdTime")),
    zohoModifiedAt: asIsoDate(readMappedValue(record, mapping, "modifiedTime")),
    eligibility,
  };
}
