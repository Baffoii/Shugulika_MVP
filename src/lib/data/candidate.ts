import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationRow, CandidateProfileRow, CandidateExperienceRow, CandidateEducationRow,
  CandidateSkillRow, CandidateDocumentRow, JobOrderRow, SavedJobRow, PublicJobRow,
  InterviewRow, NotificationRow, CandidateConsentRow,
} from "@/lib/database.types";

/** The current user's candidate profile row (null if not a candidate). */
export async function getMyCandidate(): Promise<CandidateProfileRow | null> {
  const supabase = createClient();
  const { data } = await supabase.from("candidate_profiles").select("*").maybeSingle();
  return (data as CandidateProfileRow | null) ?? null;
}

export interface ApplicationWithJob extends ApplicationRow {
  job_orders: Pick<JobOrderRow, "id" | "title" | "employer_org_id" | "city" | "country_code"> | null;
}

export async function getMyApplications(candidateId: string): Promise<ApplicationWithJob[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("applications")
    .select("*, job_orders(id,title,employer_org_id,city,country_code)")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  return (data as ApplicationWithJob[] | null) ?? [];
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
  const { data } = await supabase.from("candidate_experiences").select("*").eq("candidate_id", candidateId).order("start_date", { ascending: false });
  return (data as CandidateExperienceRow[] | null) ?? [];
}

export async function getMyEducation(candidateId: string): Promise<CandidateEducationRow[]> {
  const supabase = createClient();
  const { data } = await supabase.from("candidate_education").select("*").eq("candidate_id", candidateId).order("start_date", { ascending: false });
  return (data as CandidateEducationRow[] | null) ?? [];
}

export async function getMySkills(candidateId: string): Promise<CandidateSkillRow[]> {
  const supabase = createClient();
  const { data } = await supabase.from("candidate_skills").select("*").eq("candidate_id", candidateId);
  return (data as CandidateSkillRow[] | null) ?? [];
}

export interface SavedJobWithJob extends SavedJobRow {
  jobs: { id: string; job_order_id: string; public_slug: string | null } | null;
}
export async function getMySavedJobs(candidateId: string): Promise<PublicJobRow[]> {
  const supabase = createClient();
  const { data } = await supabase.from("saved_jobs").select("job_id").eq("candidate_id", candidateId);
  const ids = (data ?? []).map((r) => (r as { job_id: string }).job_id);
  if (ids.length === 0) return [];
  const { data: jobs } = await supabase.from("public_jobs").select("*").in("job_id", ids);
  return (jobs as PublicJobRow[] | null) ?? [];
}

export async function getMyInterviews(candidateId: string): Promise<InterviewRow[]> {
  const supabase = createClient();
  const { data: apps } = await supabase.from("applications").select("id").eq("candidate_id", candidateId);
  const appIds = (apps ?? []).map((a) => (a as { id: string }).id);
  if (appIds.length === 0) return [];
  const { data } = await supabase.from("interviews").select("*").in("application_id", appIds).order("scheduled_at", { ascending: true });
  return (data as InterviewRow[] | null) ?? [];
}

export async function getMyNotifications(): Promise<NotificationRow[]> {
  const supabase = createClient();
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
  return (data as NotificationRow[] | null) ?? [];
}

export async function getMyConsents(candidateId: string): Promise<CandidateConsentRow[]> {
  const supabase = createClient();
  const { data } = await supabase.from("candidate_consents").select("*").eq("candidate_id", candidateId).order("granted_at", { ascending: false });
  return (data as CandidateConsentRow[] | null) ?? [];
}

/** Compute a profile-completion percentage from the loaded sections. */
export function computeCompletion(input: {
  profile: CandidateProfileRow | null;
  experiences: number;
  education: number;
  skills: number;
  documents: number;
}): number {
  let pct = 0;
  if (input.profile?.given_name) pct += 15;
  if (input.profile?.headline) pct += 10;
  if (input.profile?.summary) pct += 15;
  if (input.profile?.city) pct += 10;
  if (input.experiences > 0) pct += 20;
  if (input.education > 0) pct += 15;
  if (input.skills > 0) pct += 5;
  if (input.documents > 0) pct += 10;
  return Math.min(100, pct);
}
