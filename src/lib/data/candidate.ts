import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationRow,
  CandidateProfileRow,
  CandidateExperienceRow,
  CandidateEducationRow,
  CandidateSkillRow,
  CandidateDocumentRow,
  JobOrderRow,
  SavedJobRow,
  PublicJobRow,
  InterviewRow,
  NotificationRow,
  CandidateConsentRow,
  CandidateCertificationRow,
  CandidateLanguageRow,
} from "@/lib/database.types";

/** The current user's candidate profile row (null if not a candidate). */
export async function getMyCandidate(): Promise<CandidateProfileRow | null> {
  const supabase = createClient();
  const { data } = await supabase.from("candidate_profiles").select("*").maybeSingle();
  return (data as CandidateProfileRow | null) ?? null;
}

export interface ApplicationWithJob extends ApplicationRow {
  job_orders:
    | (Pick<
        JobOrderRow,
        "id" | "title" | "employer_org_id" | "city" | "country_code" | "is_confidential"
      > & {
        organizations: { name: string } | null;
      })
    | null;
}

/**
 * Load the candidate's applications without embedding job_orders.
 * Nested embeds hit RLS recursion between applications ↔ job_orders; titles
 * come from the safe public_jobs view instead.
 */
export async function getMyApplications(candidateId: string): Promise<ApplicationWithJob[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getMyApplications]", error.message);
    return [];
  }

  const apps = (data as ApplicationRow[] | null) ?? [];
  if (apps.length === 0) return [];

  const orderIds = [...new Set(apps.map((a) => a.job_order_id))];
  const { data: jobRows } = await supabase
    .from("public_jobs")
    .select("job_order_id, title, employer_name, city, country_code, is_confidential")
    .in("job_order_id", orderIds);

  type JobMeta = {
    job_order_id: string;
    title: string;
    employer_name: string;
    city: string | null;
    country_code: string;
    is_confidential: boolean;
  };
  const byOrder = new Map(
    ((jobRows as JobMeta[] | null) ?? []).map((j) => [j.job_order_id, j] as const),
  );

  return apps.map((a) => {
    const meta = byOrder.get(a.job_order_id);
    if (!meta) {
      return { ...a, job_orders: null };
    }
    return {
      ...a,
      job_orders: {
        id: a.job_order_id,
        title: meta.title,
        employer_org_id: "",
        city: meta.city,
        country_code: meta.country_code,
        is_confidential: meta.is_confidential,
        organizations: { name: meta.employer_name },
      },
    };
  });
}

/** Job order IDs the candidate already has an application for (incl. withdrawn). */
export async function getMyAppliedJobOrderIds(candidateId: string): Promise<Set<string>> {
  const statuses = await getMyApplicationStatusesByJobOrder(candidateId);
  return new Set(statuses.keys());
}

export type ApplicationBoardStatus = "active" | "withdrawn";

/** Per job-order application status for board/detail badges (incl. withdrawn). */
export async function getMyApplicationStatusesByJobOrder(
  candidateId: string,
): Promise<Map<string, ApplicationBoardStatus>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("applications")
    .select("job_order_id, withdrawn_at")
    .eq("candidate_id", candidateId);
  if (error) {
    console.error("[getMyApplicationStatusesByJobOrder]", error.message);
    return new Map();
  }
  const map = new Map<string, ApplicationBoardStatus>();
  for (const row of (data as { job_order_id: string; withdrawn_at: string | null }[] | null) ??
    []) {
    map.set(row.job_order_id, row.withdrawn_at ? "withdrawn" : "active");
  }
  return map;
}

/** Display label for an application row: "Title at Employer". */
export function applicationRoleLabel(app: ApplicationWithJob): string {
  const title = app.job_orders?.title?.trim();
  if (!title) return "Role";
  const employer = app.job_orders?.is_confidential
    ? "Confidential Employer"
    : (app.job_orders?.organizations?.name?.trim() ?? null);
  return employer ? `${title} at ${employer}` : title;
}

export async function getMyDocuments(candidateId: string): Promise<CandidateDocumentRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_documents")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  return (data as CandidateDocumentRow[] | null) ?? [];
}

export async function getMyExperiences(candidateId: string): Promise<CandidateExperienceRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_experiences")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("start_date", { ascending: false });
  return (data as CandidateExperienceRow[] | null) ?? [];
}

export async function getMyEducation(candidateId: string): Promise<CandidateEducationRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_education")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("start_date", { ascending: false });
  return (data as CandidateEducationRow[] | null) ?? [];
}

export async function getMySkills(candidateId: string): Promise<CandidateSkillRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_skills")
    .select("*")
    .eq("candidate_id", candidateId);
  return (data as CandidateSkillRow[] | null) ?? [];
}

export async function getMyCertifications(
  candidateId: string,
): Promise<CandidateCertificationRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_certifications")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("issued_on", { ascending: false });
  return (data as CandidateCertificationRow[] | null) ?? [];
}

export async function getMyLanguages(candidateId: string): Promise<CandidateLanguageRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_languages")
    .select("*")
    .eq("candidate_id", candidateId);
  return (data as CandidateLanguageRow[] | null) ?? [];
}

export interface SavedJobWithJob extends SavedJobRow {
  jobs: { id: string; job_order_id: string; public_slug: string | null } | null;
}
export async function getMySavedJobs(candidateId: string): Promise<PublicJobRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("saved_jobs")
    .select("job_id")
    .eq("candidate_id", candidateId);
  const ids = (data ?? []).map((r) => (r as { job_id: string }).job_id);
  if (ids.length === 0) return [];
  const { data: jobs } = await supabase.from("public_jobs").select("*").in("job_id", ids);
  return (jobs as PublicJobRow[] | null) ?? [];
}

export async function getMyInterviews(candidateId: string): Promise<InterviewRow[]> {
  const supabase = createClient();
  const { data: apps } = await supabase
    .from("applications")
    .select("id")
    .eq("candidate_id", candidateId);
  const appIds = (apps ?? []).map((a) => (a as { id: string }).id);
  if (appIds.length === 0) return [];
  const { data } = await supabase
    .from("interviews")
    .select("*")
    .in("application_id", appIds)
    .order("scheduled_at", { ascending: true });
  return (data as InterviewRow[] | null) ?? [];
}

export async function getMyNotifications(): Promise<NotificationRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data as NotificationRow[] | null) ?? [];
}

export async function getMyConsents(candidateId: string): Promise<CandidateConsentRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("candidate_consents")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("granted_at", { ascending: false });
  return (data as CandidateConsentRow[] | null) ?? [];
}

// Profile-completion is a pure function extracted to lib/candidate-completion.ts
// so it can be unit-tested without server-only imports. Re-exported here so
// existing importers (candidate dashboard/profile pages) keep working unchanged.
export { computeCompletion } from "@/lib/candidate-completion";
