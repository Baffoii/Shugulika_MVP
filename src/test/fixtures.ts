/**
 * Synthetic, safe-to-commit test data builders. No real personal data.
 * Used by unit and component tests; the DB suite has its own SQL seed.
 */
import type { PublicJobRow, CandidateProfileRow } from "@/lib/database.types";

let seq = 0;
const uid = (p: string) => `${p}-${(seq++).toString(16).padStart(8, "0")}`;

export function makePublicJob(overrides: Partial<PublicJobRow> = {}): PublicJobRow {
  return {
    job_id: uid("job"),
    public_slug: "financial-analyst-demo",
    published_at: "2026-07-01T00:00:00Z",
    status: "advertised",
    job_order_id: uid("jo"),
    title: "Financial Analyst",
    department: "Finance",
    description: "Analyse financial performance for a growing group.",
    responsibilities: "Build models; report monthly.",
    requirements: "2+ years experience.",
    country_code: "TZ",
    city: "Dar es Salaam",
    employment_type: "full_time",
    work_arrangement: "hybrid",
    experience_level: "mid",
    salary_min: 1_800_000,
    salary_max: 2_600_000,
    salary_currency: "TZS",
    vacancy_count: 1,
    application_deadline: "2026-08-01",
    recruitment_path: "B",
    is_confidential: false,
    employer_name: "Bahari Financial Group",
    ...overrides,
  };
}

export function makeCandidateProfile(
  overrides: Partial<CandidateProfileRow> = {},
): CandidateProfileRow {
  return {
    id: uid("cand"),
    user_id: uid("user"),
    given_name: "Amina",
    middle_name: null,
    family_name: "Hassan",
    contact_email: null,
    headline: "Financial Analyst",
    summary: "Experienced analyst.",
    country_code: "TZ",
    city: "Dar es Salaam",
    date_of_birth: null,
    availability: "1 month notice",
    open_to_work: true,
    profile_status: "active",
    completion_pct: 80,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}
