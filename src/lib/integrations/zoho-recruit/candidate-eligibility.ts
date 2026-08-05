import "server-only";

import type { CandidateFieldMapping } from "@/lib/integrations/zoho-recruit/candidate-field-map";
import { readMappedValue } from "@/lib/integrations/zoho-recruit/candidate-field-map";

const INELIGIBLE_STATUS =
  /\b(reject|rejected|blacklist|blacklisted|disqualif|deleted|unavailable|not\s*available|do\s*not\s*contact)\b/i;
const AFFIRMATIVE_PORTAL = /^(true|yes|1|eligible|allowed|opt[_\s-]?in|granted|public)$/i;
const NEGATIVE_PORTAL =
  /^(false|no|0|ineligible|not[_\s-]?eligible|denied|restricted|opt[_\s-]?out)$/i;
const AFFIRMATIVE_CONSENT = /^(granted|given|approved|opt[_\s-]?in|yes|true|1|consented)$/i;
const NEGATIVE_CONSENT =
  /\b(withdrawn|revoked|denied|rejected|refused|opt[_\s-]?out|no|false|0)\b/i;
const AFFIRMATIVE_VISIBILITY = /^(public|visible|open|discoverable|searchable)$/i;
const NEGATIVE_VISIBILITY = /\b(private|hidden|internal|restricted|none|no|closed)\b/i;

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  if (typeof value === "string") {
    if (/^(true|yes|1)$/i.test(value.trim())) return true;
    if (/^(false|no|0)$/i.test(value.trim())) return false;
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
  evidence: string[];
};

type Signal = { affirmative: boolean; reason: string | null; evidence: string };

function evaluate(raw: unknown, kind: "portal" | "consent" | "visibility"): Signal {
  const text = asText(raw);
  if (raw == null || !text) {
    return { affirmative: false, reason: "portal_consent_missing", evidence: `${kind}:(empty)` };
  }
  if (kind === "portal") {
    const boolean = asBoolean(raw);
    if (boolean === true || AFFIRMATIVE_PORTAL.test(text))
      return { affirmative: true, reason: null, evidence: `portal:${text}` };
    return {
      affirmative: false,
      reason: NEGATIVE_PORTAL.test(text) ? "portal_not_eligible" : "portal_not_eligible",
      evidence: `portal:${text}`,
    };
  }
  if (kind === "consent") {
    if (!NEGATIVE_CONSENT.test(text) && AFFIRMATIVE_CONSENT.test(text))
      return { affirmative: true, reason: null, evidence: `consent:${text}` };
    return { affirmative: false, reason: "consent_not_granted", evidence: `consent:${text}` };
  }
  if (!NEGATIVE_VISIBILITY.test(text) && AFFIRMATIVE_VISIBILITY.test(text))
    return { affirmative: true, reason: null, evidence: `visibility:${text}` };
  return { affirmative: false, reason: "profile_not_visible", evidence: `visibility:${text}` };
}

/** Fail closed unless every mapped discovery-permission signal is affirmative. */
export function evaluateCandidateEligibility(
  record: Record<string, unknown>,
  mapping: CandidateFieldMapping,
): EligibilityResult {
  const reasons = new Set<string>();
  const evidence: string[] = [];

  if (asBoolean(readMappedValue(record, mapping, "converted")) === true) reasons.add("converted");
  const status = asText(readMappedValue(record, mapping, "status"));
  if (status && INELIGIBLE_STATUS.test(status)) reasons.add("ineligible_status");

  const specs = [
    ["portalEligible", "portal"],
    ["consentStatus", "consent"],
    ["profileVisibility", "visibility"],
  ] as const;
  const signals = specs
    .filter(([field]) => Boolean(mapping[field]))
    .map(([field, kind]) => evaluate(readMappedValue(record, mapping, field), kind));

  if (signals.length === 0) reasons.add("portal_consent_missing");
  for (const signal of signals) {
    evidence.push(signal.evidence);
    if (!signal.affirmative && signal.reason) reasons.add(signal.reason);
  }

  return { eligible: reasons.size === 0, reasons: [...reasons], evidence };
}
