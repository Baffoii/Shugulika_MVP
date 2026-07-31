import "server-only";

/**
 * Central mapping between Zoho Candidates field API names and the internal
 * search model. UI code must not hardcode Zoho API names.
 */

export type InternalCandidateField =
  | "zohoCandidateId"
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "jobTitle"
  | "currentEmployer"
  | "industry"
  | "skills"
  | "yearsExperience"
  | "qualification"
  | "city"
  | "country"
  | "status"
  | "availability"
  | "converted"
  | "portalEligible"
  | "profileVisibility"
  | "consentStatus"
  | "createdTime"
  | "modifiedTime"
  | "resumeFileId";

/** Preferred Zoho API names when metadata confirms them. */
export const PREFERRED_ZOHO_API_NAMES: Record<InternalCandidateField, string[]> = {
  zohoCandidateId: ["id"],
  firstName: ["First_Name"],
  lastName: ["Last_Name"],
  fullName: ["Full_Name", "Candidate_Name", "Name"],
  email: ["Email"],
  phone: ["Mobile", "Phone", "Phone_Number"],
  jobTitle: ["Current_Job_Title", "Job_Title", "Desired_Job"],
  currentEmployer: ["Current_Employer", "Current_Employer_Name", "Company"],
  industry: ["Industry", "Current_Industry"],
  skills: ["Skill_Set", "Skills", "Skill"],
  yearsExperience: ["Experience_in_Years", "Experience_Years", "Years_of_Experience", "Experience"],
  qualification: ["Highest_Qualification_Held", "Highest_Qualification", "Qualification"],
  city: ["City"],
  country: ["Country"],
  status: ["Candidate_Status", "Status"],
  availability: ["Availability", "Available_From"],
  converted: ["$converted", "Converted", "Is_Converted"],
  portalEligible: ["Portal_Eligible", "Portal_Eligible__s"],
  profileVisibility: ["Profile_Visibility", "Profile_Visibility__s"],
  consentStatus: ["Consent_Status", "Consent_Status__s"],
  createdTime: ["Created_Time", "Created_Time__s"],
  modifiedTime: ["Modified_Time", "Modified_Time__s"],
  resumeFileId: ["Resume", "CV", "Attachment_Id"],
};

/** Label fragments used to discover fields when preferred API names are absent. */
export const FIELD_LABEL_HINTS: Record<InternalCandidateField, string[]> = {
  zohoCandidateId: ["record id"],
  firstName: ["first name"],
  lastName: ["last name"],
  fullName: ["candidate name", "full name"],
  email: ["email"],
  phone: ["mobile", "phone"],
  jobTitle: ["current job title", "job title", "desired role", "desired job"],
  currentEmployer: ["current employer", "employer", "company"],
  industry: ["industry", "functional area"],
  skills: ["skill"],
  yearsExperience: ["experience", "years of experience"],
  qualification: ["highest qualification", "qualification", "education"],
  city: ["city"],
  country: ["country"],
  status: ["candidate status", "status"],
  availability: ["availability", "available"],
  converted: ["converted"],
  portalEligible: ["portal eligible"],
  profileVisibility: ["profile visibility", "visibility"],
  consentStatus: ["consent"],
  createdTime: ["created time", "created"],
  modifiedTime: ["modified time", "modified", "updated"],
  resumeFileId: ["resume", "cv", "curriculum"],
};

export type ZohoFieldMeta = {
  api_name: string;
  field_label?: string;
  data_type?: string;
};

export type CandidateFieldMapping = Partial<Record<InternalCandidateField, string>>;

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Build mapping from Zoho settings/fields metadata. Unconfirmed fields stay unset. */
export function buildCandidateFieldMapping(fields: ZohoFieldMeta[]): CandidateFieldMapping {
  const byApi = new Map(fields.map((f) => [f.api_name, f]));
  const byLabel = new Map<string, string>();
  for (const field of fields) {
    if (field.field_label) byLabel.set(normalizeLabel(field.field_label), field.api_name);
  }

  const mapping: CandidateFieldMapping = {};
  for (const [internal, preferred] of Object.entries(PREFERRED_ZOHO_API_NAMES) as Array<
    [InternalCandidateField, string[]]
  >) {
    const preferredHit = preferred.find((name) => byApi.has(name));
    if (preferredHit) {
      mapping[internal] = preferredHit;
      continue;
    }
    const hints = FIELD_LABEL_HINTS[internal];
    const labelHit = hints
      .map((hint) => byLabel.get(normalizeLabel(hint)))
      .find((api): api is string => Boolean(api));
    if (labelHit) mapping[internal] = labelHit;
  }

  // id is always present on Zoho records even if settings omit it.
  if (!mapping.zohoCandidateId) mapping.zohoCandidateId = "id";
  return mapping;
}

/** Fields to request from Zoho list API (explicit selection only). */
export function zohoListFields(mapping: CandidateFieldMapping): string[] {
  const names = new Set<string>(["id"]);
  for (const api of Object.values(mapping)) {
    if (api) names.add(api);
  }
  return [...names];
}

export function readMappedValue(
  record: Record<string, unknown>,
  mapping: CandidateFieldMapping,
  field: InternalCandidateField,
): unknown {
  const api = mapping[field];
  if (!api) return undefined;
  return record[api];
}
