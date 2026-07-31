import "server-only";

import type { CandidateFieldMapping } from "@/lib/integrations/zoho-recruit/candidate-field-map";
import { readMappedValue } from "@/lib/integrations/zoho-recruit/candidate-field-map";

/**
 * Single place for Zoho → employer-search eligibility.
 * Only uses confirmed mapped fields; never invents status enums for missing fields.
 */

/** Status substrings that clearly mark a record ineligible when Candidate_Status is present. */
const INELIGIBLE_STATUS_PATTERN =
  /\b(reject|rejected|blacklist|blacklisted|disqualif|deleted|unavailable|not\s*available|do\s*not\s*contact)\b/i;

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(v)) return true;
    if (["false", "no", "0"].includes(v)) return false;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return null;
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name.trim() || null : null;
  }
  return null;
}

export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
  status: string | null;
  consentOrVisibility: string | null;
};

export function isZohoCandidateSearchEligible(
  record: Record<string, unknown>,
  mapping: CandidateFieldMapping,
): EligibilityResult {
  const reasons: string[] = [];
  const status = asText(readMappedValue(record, mapping, "status"));
  const consentParts: string[] = [];

  const converted = asBoolean(readMappedValue(record, mapping, "converted"));
  if (converted === true) {
    reasons.push("converted");
  }

  if (status && INELIGIBLE_STATUS_PATTERN.test(status)) {
    reasons.push("ineligible_status");
  }

  if (mapping.portalEligible) {
    const portal = asBoolean(readMappedValue(record, mapping, "portalEligible"));
    const portalText = asText(readMappedValue(record, mapping, "portalEligible"));
    if (portalText) consentParts.push(`portal:${portalText}`);
    if (portal === false) reasons.push("portal_not_eligible");
  }

  if (mapping.profileVisibility) {
    const visibility = asText(readMappedValue(record, mapping, "profileVisibility"));
    if (visibility) {
      consentParts.push(`visibility:${visibility}`);
      if (/\b(private|hidden|internal|restricted|none|no)\b/i.test(visibility)) {
        reasons.push("profile_not_visible");
      }
    }
  }

  if (mapping.consentStatus) {
    const consent = asText(readMappedValue(record, mapping, "consentStatus"));
    if (consent) {
      consentParts.push(`consent:${consent}`);
      if (/\b(withdrawn|revoked|denied|rejected|no)\b/i.test(consent)) {
        reasons.push("consent_not_granted");
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    status,
    consentOrVisibility: consentParts.length ? consentParts.join("|") : null,
  };
}
