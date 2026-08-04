import "server-only";

/**
 * Canonical import eligibility (draft).
 *
 * Zoho records must pass consent/visibility checks before staged import into
 * Shugulika. Fail closed when discovery consent evidence is missing.
 * Restrictive/withdrawn consent overrides affirmative values. Ordinary candidate
 * status is not treated as consent. Employer search must use canonical
 * Shugulika candidates after import/dedupe — not a Zoho search cache.
 */

import type { CandidateFieldMapping } from "@/lib/integrations/zoho-recruit/candidate-field-map";
import { readMappedValue } from "@/lib/integrations/zoho-recruit/candidate-field-map";

/**
 * Single place for Zoho → canonical-import eligibility.
 *
 * Fail-closed: a Zoho record may be staged for Shugulika import only when there
 * is affirmative, mapped evidence of portal discovery permission. Missing,
 * blank, unrecognized, withdrawn, private, restricted, or negative consent
 * makes the candidate ineligible. Ordinary Candidate_Status is never treated
 * as consent. Employer search uses canonical Shugulika candidates after import.
 */

/** Status substrings that clearly mark a record ineligible when Candidate_Status is present. */
const INELIGIBLE_STATUS_PATTERN =
  /\b(reject|rejected|blacklist|blacklisted|disqualif|deleted|unavailable|not\s*available|do\s*not\s*contact)\b/i;

const AFFIRMATIVE_PORTAL_TEXT = /^(true|yes|1|eligible|allowed|opt[_\s-]?in|granted|public)$/i;
const NEGATIVE_PORTAL_TEXT =
  /^(false|no|0|ineligible|not[_\s-]?eligible|denied|restricted|opt[_\s-]?out)$/i;

const AFFIRMATIVE_CONSENT_TEXT = /^(granted|given|approved|opt[_\s-]?in|yes|true|1|consented)$/i;
const NEGATIVE_CONSENT_TEXT =
  /\b(withdrawn|revoked|denied|rejected|refused|opt[_\s-]?out|no|false|0)\b/i;

const AFFIRMATIVE_VISIBILITY_TEXT = /^(public|visible|open|discoverable|searchable)$/i;
const NEGATIVE_VISIBILITY_TEXT = /\b(private|hidden|internal|restricted|none|no|closed)\b/i;

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

type ConsentSignal = {
  affirmative: boolean;
  reason?: string;
  part: string;
};

function pushReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

/**
 * Evaluate one mapped portal-discovery signal.
 * Returns null when the field is not mapped (caller decides missing overall).
 */
function evaluatePortalEligible(
  record: Record<string, unknown>,
  mapping: CandidateFieldMapping,
): ConsentSignal | null {
  if (!mapping.portalEligible) return null;
  const raw = readMappedValue(record, mapping, "portalEligible");
  const portal = asBoolean(raw);
  const portalText = asText(raw);
  const part = portalText ? `portal:${portalText}` : "portal:(empty)";

  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) {
    return { affirmative: false, reason: "portal_consent_missing", part };
  }
  if (portal === true || (portalText != null && AFFIRMATIVE_PORTAL_TEXT.test(portalText))) {
    return { affirmative: true, part };
  }
  if (portal === false || (portalText != null && NEGATIVE_PORTAL_TEXT.test(portalText))) {
    return { affirmative: false, reason: "portal_not_eligible", part };
  }
  // Unrecognized non-empty value — fail closed.
  return { affirmative: false, reason: "portal_not_eligible", part };
}

function evaluateConsentStatus(
  record: Record<string, unknown>,
  mapping: CandidateFieldMapping,
): ConsentSignal | null {
  if (!mapping.consentStatus) return null;
  const raw = readMappedValue(record, mapping, "consentStatus");
  const consent = asText(raw);
  const part = consent ? `consent:${consent}` : "consent:(empty)";

  if (raw === undefined || raw === null || !consent) {
    return { affirmative: false, reason: "portal_consent_missing", part };
  }
  if (NEGATIVE_CONSENT_TEXT.test(consent)) {
    return { affirmative: false, reason: "consent_not_granted", part };
  }
  if (AFFIRMATIVE_CONSENT_TEXT.test(consent)) {
    return { affirmative: true, part };
  }
  return { affirmative: false, reason: "consent_not_granted", part };
}

function evaluateProfileVisibility(
  record: Record<string, unknown>,
  mapping: CandidateFieldMapping,
): ConsentSignal | null {
  if (!mapping.profileVisibility) return null;
  const raw = readMappedValue(record, mapping, "profileVisibility");
  const visibility = asText(raw);
  const part = visibility ? `visibility:${visibility}` : "visibility:(empty)";

  if (raw === undefined || raw === null || !visibility) {
    return { affirmative: false, reason: "portal_consent_missing", part };
  }
  if (NEGATIVE_VISIBILITY_TEXT.test(visibility)) {
    return { affirmative: false, reason: "profile_not_visible", part };
  }
  if (AFFIRMATIVE_VISIBILITY_TEXT.test(visibility)) {
    return { affirmative: true, part };
  }
  return { affirmative: false, reason: "profile_not_visible", part };
}

export function isZohoCandidateSearchEligible(
  record: Record<string, unknown>,
  mapping: CandidateFieldMapping,
): EligibilityResult {
  const reasons: string[] = [];
  const status = asText(readMappedValue(record, mapping, "status"));
  const consentParts: string[] = [];

  const converted = asBoolean(readMappedValue(record, mapping, "converted"));
  if (converted === true) {
    pushReason(reasons, "converted");
  }

  if (status && INELIGIBLE_STATUS_PATTERN.test(status)) {
    pushReason(reasons, "ineligible_status");
  }

  const signals = [
    evaluatePortalEligible(record, mapping),
    evaluateConsentStatus(record, mapping),
    evaluateProfileVisibility(record, mapping),
  ].filter((s): s is ConsentSignal => s != null);

  for (const signal of signals) {
    consentParts.push(signal.part);
  }

  const mappedConsentFields = Boolean(
    mapping.portalEligible || mapping.consentStatus || mapping.profileVisibility,
  );

  if (!mappedConsentFields || signals.length === 0) {
    pushReason(reasons, "portal_consent_missing");
  } else {
    // Every mapped consent-related field must affirm discovery. Restrictive
    // (missing / negative / unrecognized) signals always win over affirmatives.
    for (const signal of signals) {
      if (!signal.affirmative && signal.reason) {
        pushReason(reasons, signal.reason);
      }
    }
    if (!signals.some((s) => s.affirmative)) {
      const consentReasons = [
        "portal_consent_missing",
        "portal_not_eligible",
        "consent_not_granted",
        "profile_not_visible",
      ];
      if (!consentReasons.some((r) => reasons.includes(r))) {
        pushReason(reasons, "portal_consent_missing");
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
