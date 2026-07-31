import "server-only";

import type { NormalizedZohoSearchCandidate } from "@/lib/integrations/zoho-recruit/candidate-normalize";

/** Locked employer-facing DTO — never includes PII or Zoho attachment endpoints. */
export type LockedZohoEmployerCandidateDto = {
  zohoCandidateId: string;
  teaserLabel: string;
  jobTitle: string | null;
  industry: string | null;
  skills: string[];
  yearsExperience: number | null;
  qualification: string | null;
  city: string | null;
  country: string | null;
  availability: string | null;
  hasResume: boolean;
  isUnlocked: false;
};

export function toLockedEmployerZohoCandidateDto(
  row: NormalizedZohoSearchCandidate,
): LockedZohoEmployerCandidateDto {
  return {
    zohoCandidateId: row.zohoCandidateId,
    teaserLabel: row.teaserLabel,
    jobTitle: row.jobTitle,
    industry: row.industry ?? row.employerOrIndustry,
    skills: row.skills,
    yearsExperience: row.yearsExperience,
    qualification: row.qualification,
    city: row.city,
    country: row.country,
    availability: row.availability,
    hasResume: row.hasResume,
    isUnlocked: false,
  };
}
