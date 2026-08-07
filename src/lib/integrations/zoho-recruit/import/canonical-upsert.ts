import "server-only";

import type { CandidateProfileRow, ProfileRow } from "@/lib/database.types";
import { asAtsClient } from "@/lib/candidates/db";
import { applyProvenance } from "@/lib/candidates/provenance-store";
import { extractedProvenance } from "@/lib/candidates/provenance";
import {
  normalizeEmployer,
  normalizeInstitution,
  normalizeSkill,
  normalizeText,
} from "@/lib/candidates/normalize";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { CandidateDraft } from "@/lib/integrations/zoho-recruit/import/mapping";
import { recordExternalMapping } from "@/lib/integrations/zoho-recruit/import/store";

const IMPORT_VERSION = "zoho-import:v1";
const IMPORT_CONFIDENCE = 0.6;

export type CanonicalUpsertResult =
  { ok: true; candidateId: string; created: boolean } | { ok: false; error: string };

type CandidatePatch = Partial<
  Pick<
    CandidateProfileRow,
    | "given_name"
    | "middle_name"
    | "family_name"
    | "contact_email"
    | "headline"
    | "summary"
    | "country_code"
    | "city"
    | "availability"
    | "nationality"
    | "ethnicity"
    | "religion"
  >
>;

const isBlank = (value: unknown) => value == null || (typeof value === "string" && !value.trim());

/** New records take the mapped value; existing records only receive missing values. */
export function buildConservativeCandidatePatch(
  current: CandidateProfileRow,
  draft: CandidateDraft,
  created: boolean,
): CandidatePatch {
  const incoming: CandidatePatch = {
    given_name: draft.givenName,
    middle_name: draft.middleName,
    family_name: draft.familyName,
    contact_email: draft.email,
    headline: draft.headline,
    summary: draft.summary,
    country_code: draft.countryCode,
    city: draft.city,
    availability: draft.availability,
    // Migration fidelity only. Same conservative rule as every other field:
    // a value is written on create, or to fill a blank — never to overwrite
    // what a candidate has already stated about themselves.
    nationality: draft.nationality,
    ethnicity: draft.ethnicity,
    religion: draft.religion,
  };
  const patch: CandidatePatch = {};
  for (const [field, value] of Object.entries(incoming) as Array<
    [keyof CandidatePatch, string | null]
  >) {
    if (value == null || value === "") continue;
    if (created || isBlank(current[field])) patch[field] = value;
  }
  return patch;
}

async function resolveCandidateId(candidateId: string): Promise<string | null> {
  const client = createServiceRoleClient();
  if (!client) return null;

  let current = candidateId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const { data } = await asAtsClient(client)
      .from("candidate_profiles")
      .select("id,merged_into_candidate_id")
      .eq("id", current)
      .maybeSingle();
    if (!data) return null;
    if (!data.merged_into_candidate_id) return data.id;
    current = data.merged_into_candidate_id;
  }
  return null;
}

async function mappedCandidateId(connectionId: string, zohoRecordId: string) {
  const client = createServiceRoleClient();
  if (!client) return null;
  const { data } = await client
    .from("zoho_recruit_external_mappings")
    .select("local_entity_id")
    .eq("connection_id", connectionId)
    .eq("zoho_module", "Candidates")
    .eq("zoho_record_id", zohoRecordId)
    .maybeSingle();
  return data?.local_entity_id ?? null;
}

async function candidateByEmail(email: string): Promise<string | null> {
  const client = createServiceRoleClient();
  if (!client) return null;
  const { data } = await asAtsClient(client)
    .from("candidate_profiles")
    .select("id,merged_into_candidate_id")
    .eq("contact_email", email)
    .limit(2);
  if (!data || data.length !== 1) return null;
  const only = data[0];
  return only ? resolveCandidateId(only.id) : null;
}

async function provisionCandidateAccount(
  draft: CandidateDraft,
): Promise<{ candidateId: string; created: boolean } | null> {
  const client = createServiceRoleClient();
  if (!client || !draft.email) return null;

  const fullName = [draft.givenName, draft.middleName, draft.familyName].filter(Boolean).join(" ");
  const { data, error } = await client.auth.admin.createUser({
    email: draft.email,
    email_confirm: false,
    user_metadata: { role: "candidate", full_name: fullName, source: "zoho_import" },
  });
  if (error || !data.user) {
    // A retry after Auth succeeded but before staging was updated recovers by
    // canonical contact email instead of creating a second account.
    const recoveredId = await candidateByEmail(draft.email);
    return recoveredId ? { candidateId: recoveredId, created: false } : null;
  }

  const { data: profile } = await client
    .from("candidate_profiles")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return profile?.id ? { candidateId: profile.id, created: true } : null;
}

async function mergeDraft(candidateId: string, draft: CandidateDraft, created: boolean) {
  const client = createServiceRoleClient();
  if (!client) return { ok: false, error: "Service role is not configured." } as const;

  const { data: current, error: loadError } = await client
    .from("candidate_profiles")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();
  if (loadError || !current)
    return { ok: false, error: "Canonical candidate was not found." } as const;

  const patch = buildConservativeCandidatePatch(current, draft, created);
  if (Object.keys(patch).length > 0) {
    const { error } = await client
      .from("candidate_profiles")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", candidateId);
    if (error) return { ok: false, error: error.message } as const;
  }

  const { data: account } = await client
    .from("profiles")
    .select("*")
    .eq("id", current.user_id)
    .maybeSingle();
  const accountPatch: Partial<Pick<ProfileRow, "full_name" | "phone">> = {};
  const fullName = [draft.givenName, draft.middleName, draft.familyName].filter(Boolean).join(" ");
  if (fullName && (created || isBlank(account?.full_name))) accountPatch.full_name = fullName;
  if (draft.phone && (created || isBlank(account?.phone))) accountPatch.phone = draft.phone;
  if (Object.keys(accountPatch).length > 0) {
    const { error } = await client.from("profiles").update(accountPatch).eq("id", current.user_id);
    if (error) return { ok: false, error: error.message } as const;
  }

  const { data: skills } = await client
    .from("candidate_skills")
    .select("name")
    .eq("candidate_id", candidateId);
  const skillKeys = new Set((skills ?? []).map((row) => normalizeSkill(row.name)));
  const newSkills = draft.skills
    .filter((name) => !skillKeys.has(normalizeSkill(name)))
    .map((name) => ({ candidate_id: candidateId, name }));
  if (newSkills.length > 0) {
    const { error } = await client.from("candidate_skills").insert(newSkills);
    if (error) return { ok: false, error: error.message } as const;
  }

  const { data: experiences } = await client
    .from("candidate_experiences")
    .select("title,employer_name,start_date,end_date")
    .eq("candidate_id", candidateId);
  const experienceKeys = new Set(
    (experiences ?? []).map((row) =>
      [
        normalizeText(row.title),
        normalizeEmployer(row.employer_name),
        row.start_date,
        row.end_date,
      ].join("|"),
    ),
  );
  const newExperiences = draft.experiences
    .filter(
      (row) =>
        !experienceKeys.has(
          [
            normalizeText(row.title),
            normalizeEmployer(row.employerName),
            row.startDate,
            row.endDate,
          ].join("|"),
        ),
    )
    .map((row) => ({
      candidate_id: candidateId,
      title: row.title,
      employer_name: row.employerName,
      start_date: row.startDate,
      end_date: row.endDate,
      kind: "formal",
    }));
  if (newExperiences.length > 0) {
    const { error } = await client.from("candidate_experiences").insert(newExperiences);
    if (error) return { ok: false, error: error.message } as const;
  }

  const { data: education } = await client
    .from("candidate_education")
    .select("institution,qualification,end_date")
    .eq("candidate_id", candidateId);
  const educationKeys = new Set(
    (education ?? []).map((row) =>
      [normalizeInstitution(row.institution), normalizeText(row.qualification), row.end_date].join(
        "|",
      ),
    ),
  );
  const newEducation = draft.education
    .filter(
      (row) =>
        !educationKeys.has(
          [
            normalizeInstitution(row.institution),
            normalizeText(row.qualification),
            row.endDate,
          ].join("|"),
        ),
    )
    .map((row) => ({
      candidate_id: candidateId,
      institution: row.institution,
      qualification: row.qualification,
      end_date: row.endDate,
    }));
  if (newEducation.length > 0) {
    const { error } = await client.from("candidate_education").insert(newEducation);
    if (error) return { ok: false, error: error.message } as const;
  }

  const now = new Date().toISOString();
  const provenanceValues: Array<[string, string | null]> = [
    ["given_name", draft.givenName],
    ["middle_name", draft.middleName],
    ["family_name", draft.familyName],
    ["contact_email", draft.email],
    ["phone", draft.phone],
    ["headline", draft.headline],
    ["summary", draft.summary],
    ["country_code", draft.countryCode],
    ["city", draft.city],
    ["availability", draft.availability],
  ];
  await applyProvenance(
    client,
    candidateId,
    provenanceValues
      .filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
      .map(([fieldPath, valueText]) =>
        extractedProvenance({
          candidateId,
          targetEntity: "profile",
          targetEntityId: null,
          fieldPath,
          valueText,
          confidence: IMPORT_CONFIDENCE,
          parserVersion: IMPORT_VERSION,
          parseRunId: null,
          evidenceText: "Zoho Recruit candidate import",
          extractedAt: now,
          source: "zoho_import",
        }),
      ),
  );

  return { ok: true } as const;
}

/** Create or conservatively enrich one canonical candidate, then persist identity. */
export async function upsertCanonicalCandidate(input: {
  connectionId: string;
  zohoRecordId: string;
  draft: CandidateDraft;
  matchedCandidateId: string | null;
  fingerprint: string | null;
}): Promise<CanonicalUpsertResult> {
  const existingMapping = await mappedCandidateId(input.connectionId, input.zohoRecordId);
  const resolvedMapping = existingMapping ? await resolveCandidateId(existingMapping) : null;
  const resolvedMatch = input.matchedCandidateId
    ? await resolveCandidateId(input.matchedCandidateId)
    : null;

  if (existingMapping && !resolvedMapping) {
    return { ok: false, error: "The Zoho record points to a missing canonical candidate." };
  }
  if (input.matchedCandidateId && !resolvedMatch) {
    return { ok: false, error: "The selected candidate could not be resolved." };
  }
  if (resolvedMapping && resolvedMatch && resolvedMapping !== resolvedMatch) {
    return { ok: false, error: "The Zoho record is already mapped to another candidate." };
  }

  let candidateId = resolvedMapping ?? resolvedMatch;

  let created = false;
  if (!candidateId && input.draft.email) candidateId = await candidateByEmail(input.draft.email);
  if (!candidateId) {
    if (!input.draft.email) {
      return { ok: false, error: "A new candidate account requires an email address." };
    }
    const provisioned = await provisionCandidateAccount(input.draft);
    candidateId = provisioned?.candidateId ?? null;
    created = provisioned?.created ?? false;
  }
  if (!candidateId) return { ok: false, error: "Candidate account provisioning failed." };

  const merged = await mergeDraft(candidateId, input.draft, created);
  if (!merged.ok) return merged;

  await recordExternalMapping({
    connectionId: input.connectionId,
    candidateId,
    zohoRecordId: input.zohoRecordId,
    fingerprint: input.fingerprint,
  });
  return { ok: true, candidateId, created };
}
