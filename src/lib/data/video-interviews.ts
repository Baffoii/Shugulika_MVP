/**
 * Read helpers for the asynchronous video interview feature. All queries run
 * with the caller's own session — RLS scopes candidates to their own
 * assignments and staff to their organization.
 */
import { createClient } from "@/lib/supabase/server";
import type {
  InterviewAssignmentAnalyticsRow,
  InterviewAssignmentQuestionRow,
  InterviewAssignmentRow,
  InterviewQuestionAnalyticsRow,
  InterviewResponseAttemptRow,
  InterviewReviewRow,
  InterviewTemplateQuestionRow,
  InterviewTemplateRow,
  JobOrderRow,
  CandidateProfileRow,
} from "@/lib/database.types";

// ---------------------------------------------------------------------------
// Candidate
// ---------------------------------------------------------------------------

export interface CandidateAssignmentListItem extends InterviewAssignmentRow {
  job_title: string | null;
  question_count: number;
}

/** The signed-in candidate's video interview assignments (newest first). */
export async function getMyInterviewAssignments(
  candidateId: string,
): Promise<CandidateAssignmentListItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("interview_assignments")
    .select("*")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[getMyInterviewAssignments]", error.message);
    return [];
  }
  const assignments = (data as InterviewAssignmentRow[] | null) ?? [];
  if (assignments.length === 0) return [];

  const jobOrderIds = [...new Set(assignments.map((a) => a.job_order_id))];
  const assignmentIds = assignments.map((a) => a.id);
  const [{ data: jobs }, { data: questions }] = await Promise.all([
    // Candidates can read job orders they applied to (0010/0012). Unlike
    // public_jobs, this still works if a posting is later paused/unpublished.
    supabase.from("job_orders").select("id,title").in("id", jobOrderIds),
    supabase
      .from("interview_assignment_questions")
      .select("id,assignment_id")
      .in("assignment_id", assignmentIds),
  ]);
  const titleByJobOrder = new Map(
    ((jobs as { id: string; title: string }[] | null) ?? []).map((j) => [j.id, j.title] as const),
  );
  const questionCounts = new Map<string, number>();
  for (const q of (questions as { assignment_id: string }[] | null) ?? []) {
    questionCounts.set(q.assignment_id, (questionCounts.get(q.assignment_id) ?? 0) + 1);
  }
  return assignments.map((a) => ({
    ...a,
    job_title: titleByJobOrder.get(a.job_order_id) ?? null,
    question_count: questionCounts.get(a.id) ?? 0,
  }));
}

export interface CandidateInterviewDetail {
  assignment: InterviewAssignmentRow;
  questions: InterviewAssignmentQuestionRow[];
  attempts: InterviewResponseAttemptRow[];
  jobTitle: string | null;
  employerName: string | null;
}

/** Full candidate view of one assignment (RLS: own rows only). */
export async function getMyInterviewDetail(
  assignmentId: string,
): Promise<CandidateInterviewDetail | null> {
  const supabase = createClient();
  const { data: assignmentData } = await supabase
    .from("interview_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  const assignment = assignmentData as InterviewAssignmentRow | null;
  if (!assignment) return null;

  const [{ data: questions }, { data: attempts }, { data: job }] = await Promise.all([
    supabase
      .from("interview_assignment_questions")
      .select("*")
      .eq("assignment_id", assignmentId)
      .order("display_order", { ascending: true }),
    supabase
      .from("interview_response_attempts")
      .select("*")
      .eq("assignment_id", assignmentId)
      .order("attempt_number", { ascending: true }),
    supabase
      .from("job_orders")
      .select("id,title,employer_org_id,is_confidential")
      .eq("id", assignment.job_order_id)
      .maybeSingle(),
  ]);
  const jobRow = job as {
    title: string;
    employer_org_id: string;
    is_confidential: boolean;
  } | null;
  let employerName: string | null = null;
  if (jobRow) {
    if (jobRow.is_confidential) {
      employerName = "Confidential Employer";
    } else {
      const { data: employer } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", jobRow.employer_org_id)
        .maybeSingle();
      employerName = (employer as { name: string } | null)?.name ?? "The hiring team";
    }
  }
  return {
    assignment,
    questions: (questions as InterviewAssignmentQuestionRow[] | null) ?? [],
    attempts: (attempts as InterviewResponseAttemptRow[] | null) ?? [],
    jobTitle: jobRow?.title ?? null,
    employerName,
  };
}

// ---------------------------------------------------------------------------
// Recruiter / staff
// ---------------------------------------------------------------------------

export interface TemplateWithQuestions extends InterviewTemplateRow {
  questions: InterviewTemplateQuestionRow[];
}

export async function listInterviewTemplates(): Promise<InterviewTemplateRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("interview_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[listInterviewTemplates]", error.message);
    return [];
  }
  return (data as InterviewTemplateRow[] | null) ?? [];
}

export async function getInterviewTemplate(
  templateId: string,
): Promise<TemplateWithQuestions | null> {
  const supabase = createClient();
  const { data: template } = await supabase
    .from("interview_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (!template) return null;
  const { data: questions } = await supabase
    .from("interview_template_questions")
    .select("*")
    .eq("template_id", templateId)
    .order("display_order", { ascending: true });
  return {
    ...(template as InterviewTemplateRow),
    questions: (questions as InterviewTemplateQuestionRow[] | null) ?? [],
  };
}

export interface StaffAssignmentListItem extends InterviewAssignmentRow {
  candidate_name: string | null;
  job_title: string | null;
}

/** All assignments visible to the staff member (RLS org-scoped). */
export async function listInterviewAssignments(): Promise<StaffAssignmentListItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("interview_assignments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[listInterviewAssignments]", error.message);
    return [];
  }
  const assignments = (data as InterviewAssignmentRow[] | null) ?? [];
  if (assignments.length === 0) return [];

  const candidateIds = [...new Set(assignments.map((a) => a.candidate_id))];
  const jobOrderIds = [...new Set(assignments.map((a) => a.job_order_id))];
  const [{ data: candidates }, { data: jobs }] = await Promise.all([
    supabase.from("candidate_profiles").select("id,given_name,family_name").in("id", candidateIds),
    supabase.from("job_orders").select("id,title").in("id", jobOrderIds),
  ]);
  const nameById = new Map(
    (
      (candidates as Pick<CandidateProfileRow, "id" | "given_name" | "family_name">[] | null) ?? []
    ).map((c) => [c.id, [c.given_name, c.family_name].filter(Boolean).join(" ") || null] as const),
  );
  const titleById = new Map(
    ((jobs as Pick<JobOrderRow, "id" | "title">[] | null) ?? []).map(
      (j) => [j.id, j.title] as const,
    ),
  );
  return assignments.map((a) => ({
    ...a,
    candidate_name: nameById.get(a.candidate_id) ?? null,
    job_title: titleById.get(a.job_order_id) ?? null,
  }));
}

/** Assignments attached to one application (for the recruiter workspace). */
export async function getAssignmentsForApplication(
  applicationId: string,
): Promise<InterviewAssignmentRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("interview_assignments")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  return (data as InterviewAssignmentRow[] | null) ?? [];
}

export interface InterviewResults {
  assignment: InterviewAssignmentRow;
  candidate: CandidateProfileRow | null;
  job: JobOrderRow | null;
  questions: InterviewAssignmentQuestionRow[];
  attempts: InterviewResponseAttemptRow[];
  review: InterviewReviewRow | null;
  questionAnalytics: InterviewQuestionAnalyticsRow[];
  assignmentAnalytics: InterviewAssignmentAnalyticsRow | null;
}

/** Everything the recruiter results page needs (RLS org-scoped). */
export async function getInterviewResults(assignmentId: string): Promise<InterviewResults | null> {
  const supabase = createClient();
  const { data: assignmentData } = await supabase
    .from("interview_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  const assignment = assignmentData as InterviewAssignmentRow | null;
  if (!assignment) return null;

  const [candidate, job, questions, attempts, review, qAnalytics, aAnalytics] = await Promise.all([
    supabase.from("candidate_profiles").select("*").eq("id", assignment.candidate_id).maybeSingle(),
    supabase.from("job_orders").select("*").eq("id", assignment.job_order_id).maybeSingle(),
    supabase
      .from("interview_assignment_questions")
      .select("*")
      .eq("assignment_id", assignmentId)
      .order("display_order", { ascending: true }),
    supabase
      .from("interview_response_attempts")
      .select("*")
      .eq("assignment_id", assignmentId)
      .order("attempt_number", { ascending: true }),
    supabase.from("interview_reviews").select("*").eq("assignment_id", assignmentId).maybeSingle(),
    supabase.from("interview_question_analytics").select("*").eq("assignment_id", assignmentId),
    supabase
      .from("interview_assignment_analytics")
      .select("*")
      .eq("assignment_id", assignmentId)
      .maybeSingle(),
  ]);

  return {
    assignment,
    candidate: (candidate.data as CandidateProfileRow | null) ?? null,
    job: (job.data as JobOrderRow | null) ?? null,
    questions: (questions.data as InterviewAssignmentQuestionRow[] | null) ?? [],
    attempts: (attempts.data as InterviewResponseAttemptRow[] | null) ?? [],
    review: (review.data as InterviewReviewRow | null) ?? null,
    questionAnalytics: (qAnalytics.data as InterviewQuestionAnalyticsRow[] | null) ?? [],
    assignmentAnalytics: (aAnalytics.data as InterviewAssignmentAnalyticsRow | null) ?? null,
  };
}
