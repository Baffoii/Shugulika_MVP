/**
 * Turn a CV extraction into provenance rows.
 *
 * Every value the parser produced gets a row recording the parser version, the
 * confidence, the supporting evidence, and when it was extracted — whether or
 * not the candidate ends up accepting it. That is what makes a later re-parse
 * comparable: without the previous confidence on file, "is this new value
 * better?" has no answer.
 *
 * Pure — no I/O, no Supabase. The caller decides which rows survive the
 * precedence rules in `@/lib/candidates/provenance`.
 */
import type { ResumeExtraction } from "@/lib/resume/extraction-schema";
import { extractedProvenance, type ProvenanceRecord } from "@/lib/candidates/provenance";
import type { ProvenanceEntity } from "@/lib/candidates/constants";
import {
  normalizeEmployer,
  normalizeInstitution,
  normalizeSkill,
} from "@/lib/candidates/normalize";

export interface ExtractionProvenanceContext {
  candidateId: string;
  parseRunId: string | null;
  parserVersion: string;
  extractedAt: string;
}

/**
 * Profile fields, keyed exactly as `resume_field_suggestions.field_path` and
 * `candidate_field_provenance.field_path` — one vocabulary, so a suggestion and
 * its provenance always line up.
 */
const PERSONAL_FIELDS = [
  "given_name",
  "middle_name",
  "family_name",
  "phone",
  "email",
  "headline",
  "summary",
  "city",
  "availability",
  "country_code",
] as const;

/**
 * Collection rows are identified by their normalized natural key rather than a
 * row id: at extraction time the row usually does not exist yet, and the key is
 * what lets a re-parse recognize it as the same item.
 */
function collectionKey(entity: ProvenanceEntity, key: string): string {
  return `${entity}:${key}`;
}

export function buildExtractionProvenance(
  extraction: ResumeExtraction,
  context: ExtractionProvenanceContext,
): ProvenanceRecord[] {
  const rows: ProvenanceRecord[] = [];

  const push = (input: {
    targetEntity: ProvenanceEntity;
    fieldPath: string;
    valueText: string | null;
    confidence: number;
    evidenceText: string | null;
  }) => {
    if (!input.valueText || !input.valueText.trim()) return;
    rows.push(
      extractedProvenance({
        candidateId: context.candidateId,
        targetEntity: input.targetEntity,
        targetEntityId: null,
        fieldPath: input.fieldPath,
        valueText: input.valueText.trim(),
        confidence: input.confidence,
        parserVersion: context.parserVersion,
        parseRunId: context.parseRunId,
        evidenceText: input.evidenceText,
        extractedAt: context.extractedAt,
      }),
    );
  };

  for (const field of PERSONAL_FIELDS) {
    const value = extraction.personal[field];
    if (!value) continue;
    push({
      targetEntity: "profile",
      fieldPath: field,
      valueText: value.value,
      confidence: value.confidence,
      evidenceText: value.evidence_text,
    });
  }

  for (const item of extraction.experience) {
    const key = normalizeEmployer(item.employer_name) || normalizeEmployer(item.title);
    if (!key) continue;
    push({
      targetEntity: "experience",
      fieldPath: collectionKey("experience", key),
      valueText: [item.title, item.employer_name, item.start_date, item.end_date]
        .filter(Boolean)
        .join(" | "),
      confidence: item.confidence,
      evidenceText: item.evidence_text,
    });
  }

  for (const item of extraction.education) {
    const key = normalizeInstitution(item.institution);
    if (!key) continue;
    push({
      targetEntity: "education",
      fieldPath: collectionKey("education", key),
      valueText: [item.institution, item.qualification, item.end_date].filter(Boolean).join(" | "),
      confidence: item.confidence,
      evidenceText: item.evidence_text,
    });
  }

  for (const item of extraction.skills) {
    const key = normalizeSkill(item.name);
    if (!key) continue;
    push({
      targetEntity: "skill",
      fieldPath: collectionKey("skill", key),
      valueText: item.name,
      confidence: item.confidence,
      evidenceText: item.evidence_text,
    });
  }

  for (const item of extraction.certifications) {
    const key = normalizeSkill(item.name);
    if (!key) continue;
    push({
      targetEntity: "certification",
      fieldPath: collectionKey("certification", key),
      valueText: [item.name, item.issuer].filter(Boolean).join(" | "),
      confidence: item.confidence,
      evidenceText: item.evidence_text,
    });
  }

  for (const item of extraction.languages) {
    const key = normalizeSkill(item.language);
    if (!key) continue;
    push({
      targetEntity: "language",
      fieldPath: collectionKey("language", key),
      valueText: [item.language, item.proficiency].filter(Boolean).join(" | "),
      confidence: item.confidence,
      evidenceText: item.evidence_text,
    });
  }

  return rows;
}

/**
 * Confidence of the extracted value for one profile field, or null when the
 * parser produced nothing there. Used to compare a re-parse against what is
 * already on file before a suggestion is even offered.
 */
export function personalFieldConfidence(
  extraction: ResumeExtraction,
  field: (typeof PERSONAL_FIELDS)[number],
): number | null {
  return extraction.personal[field]?.confidence ?? null;
}

export { PERSONAL_FIELDS };
