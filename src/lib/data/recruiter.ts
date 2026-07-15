import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationRow, CandidateProfileRow, JobOrderRow, ApplicationStageHistoryRow,
  RecruiterNoteRow, CandidateDocumentRow, EmployerSubmissionRow, InterviewRow,
} from "@/lib/database.types";

export interface PipelineApplication extends ApplicationRow {
  candidate_profiles: Pick<CandidateProfileRow, "id" | "given_name" | "family_name" | "headline" | "city" | "country_code"> | null;
  job_orders: Pick<JobOrderRow, "id" | "title" | "employer_org_id"> | null;
}

/** All applications the recruiter is authorized to see (RLS-scoped). */
export async function getPipeline(): Promise<PipelineApplication[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("applications")
    .select("*, candidate_profiles(id,given_name,family_name,headline,city,country_code), job_orders(id,title,employer_org_id)")
    .is("withdrawn_at", null)
    .order("created_at", { ascending: false });
  return (data as PipelineApplication[] | null) ?? [];
}

export interface RecruiterMetrics {
  activeJobs: number;
  newApplications: number;
  awaitingReview: number;
  consentPending: number;
  submissionsPending: number;
  interviewsScheduled: number;
  offers: number;
  placements: number;
}

export async function getRecruiterMetrics(): Promise<RecruiterMetrics> {
  const supabase = createClient();
  const [jobs, apps, subs, interviews, placements] = await Promise.all([
    supabase.from("job_orders").select("id,status"),
    supabase.from("applications").select("id,current_stage,consent_status,withdrawn_at"),
    supabase.from("employer_submissions").select("id,status"),
    supabase.from("interviews").select("id,status"),
    supabase.from("placements").select("id,status"),
  ]);
  const jobRows = (jobs.data ?? []) as { status: string }[];
  const appRows = (apps.data ?? []) as { current_stage: string; consent_status: string; withdrawn_at: string | null }[];
  const subRows = (subs.data ?? []) as { status: string }[];
  const intRows = (interviews.data ?? []) as { status: string }[];
  const active = appRows.filter((a) => !a.withdrawn_at);
  return {
    activeJobs: jobRows.filter((j) => ["active", "approved", "on_hold"].includes(j.status)).length,
    newApplications: active.filter((a) => a.current_stage === "applied_sourced").length,
    awaitingReview: active.filter((a) => ["applied_sourced", "cv_screening"].includes(a.current_stage)).length,
    consentPending: active.filter((a) => a.consent_status === "pending").length,
    submissionsPending: subRows.filter((s) => ["consent_pending", "submitted", "viewed"].includes(s.status)).length,
    interviewsScheduled: intRows.filter((i) => ["requested", "scheduled", "confirmed"].includes(i.status)).length,
    offers: active.filter((a) => a.current_stage === "offer").length,
    placements: ((placements.data ?? []) as { status: string }[]).filter((p) => p.status !== "failed").length,
  };
}

export interface ApplicationDetail {
  application: ApplicationRow;
  candidate: CandidateProfileRow | null;
  job: JobOrderRow | null;
  history: ApplicationStageHistoryRow[];
  notes: RecruiterNoteRow[];
  documents: CandidateDocumentRow[];
  submissions: EmployerSubmissionRow[];
  interviews: InterviewRow[];
}

export async function getApplicationDetail(id: string): Promise<ApplicationDetail | null> {
  const supabase = createClient();
  const { data: app } = await supabase.from("applications").select("*").eq("id", id).maybeSingle();
  const application = app as ApplicationRow | null;
  if (!application) return null;

  const [candidate, job, history, notes, documents, submissions, interviews] = await Promise.all([
    supabase.from("candidate_profiles").select("*").eq("id", application.candidate_id).maybeSingle(),
    supabase.from("job_orders").select("*").eq("id", application.job_order_id).maybeSingle(),
    supabase.from("application_stage_history").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    supabase.from("recruiter_notes").select("*").eq("subject_type", "application").eq("subject_id", id).order("created_at", { ascending: false }),
    supabase.from("candidate_documents").select("*").eq("candidate_id", application.candidate_id).eq("status", "active"),
    supabase.from("employer_submissions").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    supabase.from("interviews").select("*").eq("application_id", id).order("created_at", { ascending: false }),
  ]);

  return {
    application,
    candidate: (candidate.data as CandidateProfileRow | null) ?? null,
    job: (job.data as JobOrderRow | null) ?? null,
    history: (history.data as ApplicationStageHistoryRow[] | null) ?? [],
    notes: (notes.data as RecruiterNoteRow[] | null) ?? [],
    documents: (documents.data as CandidateDocumentRow[] | null) ?? [],
    submissions: (submissions.data as EmployerSubmissionRow[] | null) ?? [],
    interviews: (interviews.data as InterviewRow[] | null) ?? [],
  };
}
