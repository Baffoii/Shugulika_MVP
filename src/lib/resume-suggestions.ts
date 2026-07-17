/**
 * Pure, dependency-free helpers for the CV/resume autofill suggestion review
 * workflow. Kept free of Supabase/Next imports so they're trivially unit
 * testable (see resume-suggestions.test.ts) and reusable from both the
 * parsing server action and the UI (ConfidenceBadge).
 */
import type { ResumeSuggestionTargetEntity } from "@/lib/database.types";

export type ConfidenceBand = "high" | "medium" | "low";

/** Maps a 0-1 confidence score to a UI band: >=0.85 high, >=0.6 medium, else low. */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

export const CONFIDENCE_BAND_LABEL: Record<ConfidenceBand, string> = {
  high: "High confidence",
  medium: "Review recommended",
  low: "Uncertain — please verify",
};

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Best-effort duplicate match: finds an existing row whose two identifying
 * fields both match (case-insensitively) the extracted candidate values.
 * Returns the matched row's id, or null when no confident match exists (in
 * which case the caller should treat the suggestion as a new row).
 */
export function findDuplicateMatch<T>(
  existing: T[],
  candidate: { primary: string | null | undefined; secondary: string | null | undefined },
  getFields: (row: T) => {
    primary: string | null | undefined;
    secondary: string | null | undefined;
    id: string;
  },
): string | null {
  const primary = normalize(candidate.primary);
  if (!primary) return null;
  const secondary = normalize(candidate.secondary);
  for (const row of existing) {
    const fields = getFields(row);
    if (normalize(fields.primary) !== primary) continue;
    if (secondary && normalize(fields.secondary) !== secondary) continue;
    return fields.id;
  }
  return null;
}

export function matchExperience(
  existing: { id: string; title: string; employer_name: string | null }[],
  candidate: { title: string | null | undefined; employer_name: string | null | undefined },
): string | null {
  return findDuplicateMatch(
    existing,
    { primary: candidate.employer_name, secondary: candidate.title },
    (row) => ({
      primary: row.employer_name,
      secondary: row.title,
      id: row.id,
    }),
  );
}

export function matchEducation(
  existing: { id: string; institution: string; qualification: string | null }[],
  candidate: { institution: string | null | undefined; qualification: string | null | undefined },
): string | null {
  return findDuplicateMatch(
    existing,
    { primary: candidate.institution, secondary: candidate.qualification },
    (row) => ({
      primary: row.institution,
      secondary: row.qualification,
      id: row.id,
    }),
  );
}

export function matchCertification(
  existing: { id: string; name: string; issuer: string | null }[],
  candidate: { name: string | null | undefined; issuer: string | null | undefined },
): string | null {
  return findDuplicateMatch(
    existing,
    { primary: candidate.name, secondary: candidate.issuer },
    (row) => ({
      primary: row.name,
      secondary: row.issuer,
      id: row.id,
    }),
  );
}

export function matchLanguage(
  existing: { id: string; language: string }[],
  candidate: { language: string | null | undefined },
): string | null {
  const language = normalize(candidate.language);
  if (!language) return null;
  const found = existing.find((row) => normalize(row.language) === language);
  return found?.id ?? null;
}

/** Human labels for target_entity, used by the suggestion review UI. */
export const TARGET_ENTITY_LABEL: Record<ResumeSuggestionTargetEntity, string> = {
  profile: "Profile",
  experience: "Work experience",
  education: "Education",
  skill: "Skill",
  certification: "Certification",
  language: "Language",
};
