import "server-only";

/** Fields used to discover the source organisation's consent and visibility contract. */
export type ConsentField =
  "status" | "converted" | "portalEligible" | "profileVisibility" | "consentStatus";

export type CandidateFieldMapping = Partial<Record<ConsentField, string>>;

export type ZohoFieldMeta = {
  api_name: string;
  field_label?: string;
  data_type?: string;
};

const PREFERRED_API_NAMES: Record<ConsentField, string[]> = {
  status: ["Candidate_Status", "Status"],
  converted: ["$converted", "Converted", "Is_Converted"],
  portalEligible: ["Portal_Eligible", "Portal_Eligible__s"],
  profileVisibility: ["Profile_Visibility", "Profile_Visibility__s"],
  consentStatus: ["Consent_Status", "Consent_Status__s"],
};

const LABEL_HINTS: Record<ConsentField, string[]> = {
  status: ["candidate status", "status"],
  converted: ["converted"],
  portalEligible: ["portal eligible"],
  profileVisibility: ["profile visibility", "visibility"],
  consentStatus: ["consent", "consent status"],
};

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Build a mapping only from fields confirmed by Zoho metadata. */
export function buildCandidateFieldMapping(fields: ZohoFieldMeta[]): CandidateFieldMapping {
  const byApi = new Set(fields.map((field) => field.api_name));
  const byLabel = new Map<string, string>();
  for (const field of fields) {
    if (field.field_label) byLabel.set(normalizeLabel(field.field_label), field.api_name);
  }

  const mapping: CandidateFieldMapping = {};
  for (const field of Object.keys(PREFERRED_API_NAMES) as ConsentField[]) {
    const preferred = PREFERRED_API_NAMES[field].find((apiName) => byApi.has(apiName));
    if (preferred) {
      mapping[field] = preferred;
      continue;
    }
    const labelMatch = LABEL_HINTS[field]
      .map((hint) => byLabel.get(normalizeLabel(hint)))
      .find((apiName): apiName is string => Boolean(apiName));
    if (labelMatch) mapping[field] = labelMatch;
  }
  return mapping;
}

/** Explicit field selection for list calls; identity fields needed by the mapper are added by Zoho. */
export function consentListFields(mapping: CandidateFieldMapping): string[] {
  return [...new Set(Object.values(mapping).filter((value): value is string => Boolean(value)))];
}

export function readMappedValue(
  record: Record<string, unknown>,
  mapping: CandidateFieldMapping,
  field: ConsentField,
): unknown {
  const apiName = mapping[field];
  return apiName ? record[apiName] : undefined;
}
