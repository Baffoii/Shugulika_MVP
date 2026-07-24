import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationRow,
  CandidateProfileRow,
  JobOrderRow,
  ApplicationStageHistoryRow,
  RecruiterNoteRow,
  CandidateDocumentRow,
  EmployerSubmissionRow,
  InterviewRow,
  NotificationRow,
  ApplicationAiReviewRow,
  ApplicationAiReviewItemRow,
  AssessmentAssignmentRow,
  JobOrderAssessmentFileRow,
} from "@/lib/database.types";

export interface PipelineApplication extends ApplicationRow {
  candidate_profiles: Pick<
    CandidateProfileRow,
    "id" | "given_name" | "family_name" | "headline" | "city" | "country_code"
  > | null;
  job_orders: Pick<JobOrderRow, "id" | "title" | "employer_org_id"> | null;
}

/** All applications the recruiter is authorized to see (RLS-scoped). */
export async function getPipeline(): Promise<PipelineApplication[]> {
  const supabase = createClient();
  // Avoid nested embeds — applications ↔ job_orders RLS has recursed in the
  // past and PostgREST then returns null for the whole query.
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .is("withdrawn_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getPipeline]", error.message);
    return [];
  }

  const apps = (data as ApplicationRow[] | null) ?? [];
  if (apps.length === 0) return [];

  const candidateIds = [...new Set(apps.map((a) => a.candidate_id))];
  const jobOrderIds = [...new Set(apps.map((a) => a.job_order_id))];

  const [{ data: candidates }, { data: jobs }] = await Promise.all([
    supabase
      .from("candidate_profiles")
      .select("id,given_name,family_name,headline,city,country_code")
      .in("id", candidateIds),
    supabase.from("job_orders").select("id,title,employer_org_id").in("id", jobOrderIds),
  ]);

  type Cand = PipelineApplication["candidate_profiles"];
  type Job = PipelineApplication["job_orders"];
  const candById = new Map(
    ((candidates as Cand[] | null) ?? [])
      .filter((c): c is NonNullable<Cand> => !!c)
      .map((c) => [c.id, c] as const),
  );
  const jobById = new Map(
    ((jobs as Job[] | null) ?? [])
      .filter((j): j is NonNullable<Job> => !!j)
      .map((j) => [j.id, j] as const),
  );

  return apps.map((a) => ({
    ...a,
    candidate_profiles: candById.get(a.candidate_id) ?? null,
    job_orders: jobById.get(a.job_order_id) ?? null,
  }));
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
  const appRows = (apps.data ?? []) as {
    current_stage: string;
    consent_status: string;
    withdrawn_at: string | null;
  }[];
  const subRows = (subs.data ?? []) as { status: string }[];
  const intRows = (interviews.data ?? []) as { status: string }[];
  const active = appRows.filter((a) => !a.withdrawn_at);
  return {
    activeJobs: jobRows.filter((j) => ["active", "approved", "on_hold"].includes(j.status)).length,
    newApplications: active.filter((a) => a.current_stage === "cv_review").length,
    awaitingReview: active.filter((a) =>
      ["cv_review", "test_review", "interview_review"].includes(a.current_stage),
    ).length,
    consentPending: active.filter((a) => a.consent_status === "pending").length,
    submissionsPending: subRows.filter((s) =>
      ["consent_pending", "submitted", "viewed"].includes(s.status),
    ).length,
    interviewsScheduled: intRows.filter((i) =>
      ["requested", "scheduled", "confirmed"].includes(i.status),
    ).length,
    offers: active.filter((a) => a.current_stage === "offer").length,
    placements: ((placements.data ?? []) as { status: string }[]).filter(
      (p) => p.status !== "failed",
    ).length,
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
  aiReview: ApplicationAiReviewRow | null;
  aiReviewItems: ApplicationAiReviewItemRow[];
  assessmentAssignment: AssessmentAssignmentRow | null;
  assessmentFiles: JobOrderAssessmentFileRow[];
  /** Active employer_submission consent for this job's employer, if any. */
  employerSubmissionConsentId: string | null;
  acceptedOfferId: string | null;
}

export async function getApplicationDetail(id: string): Promise<ApplicationDetail | null> {
  const supabase = createClient();
  const { data: app } = await supabase.from("applications").select("*").eq("id", id).maybeSingle();
  const application = app as ApplicationRow | null;
  if (!application) return null;

  const [
    candidate,
    job,
    history,
    notes,
    documents,
    submissions,
    interviews,
    aiReviewRes,
    assessmentRes,
    assessmentFilesRes,
    acceptedOfferRes,
  ] = await Promise.all([
    supabase
      .from("candidate_profiles")
      .select("*")
      .eq("id", application.candidate_id)
      .maybeSingle(),
    supabase.from("job_orders").select("*").eq("id", application.job_order_id).maybeSingle(),
    supabase
      .from("application_stage_history")
      .select("*")
      .eq("application_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("recruiter_notes")
      .select("*")
      .eq("subject_type", "application")
      .eq("subject_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("candidate_documents")
      .select("*")
      .eq("candidate_id", application.candidate_id)
      .eq("status", "active"),
    supabase
      .from("employer_submissions")
      .select("*")
      .eq("application_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("interviews")
      .select("*")
      .eq("application_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("application_ai_reviews")
      .select("*")
      .eq("application_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("assessment_assignments").select("*").eq("application_id", id).maybeSingle(),
    supabase
      .from("job_order_assessment_files")
      .select("*")
      .eq("job_order_id", application.job_order_id)
      .order("created_at", { ascending: true }),
    supabase
      .from("offers")
      .select("id")
      .eq("application_id", id)
      .eq("status", "accepted")
      .limit(1)
      .maybeSingle(),
  ]);

  const jobRow = (job.data as JobOrderRow | null) ?? null;
  let employerSubmissionConsentId: string | null = null;
  if (jobRow?.employer_org_id) {
    const { data: consent } = await supabase
      .from("candidate_consents")
      .select("id")
      .eq("candidate_id", application.candidate_id)
      .eq("purpose", "employer_submission")
      .eq("covered_org_id", jobRow.employer_org_id)
      .is("withdrawn_at", null)
      .order("granted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    employerSubmissionConsentId = (consent as { id: string } | null)?.id ?? null;
  }

  const aiReviewRaw = (aiReviewRes.data as ApplicationAiReviewRow | null) ?? null;
  // Don't ship the full model reasoning trace to the browser — staff UI doesn't
  // render it, and it can contain lengthy CV paraphrases.
  const aiReview = aiReviewRaw
    ? ({ ...aiReviewRaw, model_reasoning: null } satisfies ApplicationAiReviewRow)
    : null;
  const { data: aiItemsData } = aiReview
    ? await supabase
        .from("application_ai_review_items")
        .select("*")
        .eq("review_id", aiReview.id)
        .order("ordinal", { ascending: true })
    : { data: null };

  return {
    application,
    candidate: (candidate.data as CandidateProfileRow | null) ?? null,
    job: jobRow,
    history: (history.data as ApplicationStageHistoryRow[] | null) ?? [],
    notes: (notes.data as RecruiterNoteRow[] | null) ?? [],
    documents: (documents.data as CandidateDocumentRow[] | null) ?? [],
    submissions: (submissions.data as EmployerSubmissionRow[] | null) ?? [],
    interviews: (interviews.data as InterviewRow[] | null) ?? [],
    aiReview,
    aiReviewItems: (aiItemsData as ApplicationAiReviewItemRow[] | null) ?? [],
    assessmentAssignment: (assessmentRes.data as AssessmentAssignmentRow | null) ?? null,
    assessmentFiles: (assessmentFilesRes.data as JobOrderAssessmentFileRow[] | null) ?? [],
    employerSubmissionConsentId,
    acceptedOfferId: (acceptedOfferRes.data as { id: string } | null)?.id ?? null,
  };
}

export async function getMyNotifications(limit = 50): Promise<NotificationRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as NotificationRow[] | null) ?? [];
}
