import "server-only";

/**
 * Build Zoho Recruit payloads from standard module fields only.
 * Never includes Shugulika_ID or other custom Zoho portal fields.
 */

export interface CandidateProjectionInput {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface JobProjectionInput {
  title?: string | null;
}

export function buildCandidateZohoData(input: CandidateProjectionInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.fullName?.trim()) data.Full_Name = input.fullName.trim();
  if (input.email?.trim()) data.Email = input.email.trim();
  if (input.phone?.trim()) data.Mobile = input.phone.trim();
  if (input.city?.trim()) data.City = input.city.trim();
  if (input.country?.trim()) data.Country = input.country.trim();
  return data;
}

export function buildJobOpeningZohoData(input: JobProjectionInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (input.title?.trim()) data.Job_Opening_Name = input.title.trim();
  return data;
}

export function candidateOutboxPayload(input: CandidateProjectionInput): {
  module: "Candidates";
  data: Record<string, unknown>[];
} {
  return { module: "Candidates", data: [buildCandidateZohoData(input)] };
}

export function jobOutboxPayload(input: JobProjectionInput): {
  module: "Job_Openings";
  data: Record<string, unknown>[];
} {
  return { module: "Job_Openings", data: [buildJobOpeningZohoData(input)] };
}
