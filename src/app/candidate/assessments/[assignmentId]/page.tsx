import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PageHeader, Alert, ButtonLink, Card, CardBody } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";
import { getMyCandidate } from "@/lib/data/candidate";
import type { AssessmentAssignmentRow, JobOrderRow } from "@/lib/database.types";
import { getCandidateQuestions, getQuestionBank } from "@/lib/assessments/question-banks";
import type { AssessmentSeniority } from "@/lib/assessments/question-bank-types";
import { ShugulikaAssessmentForm } from "@/components/assessments/ShugulikaAssessmentForm";
import { openAssessmentAction } from "@/app/candidate/assessment-actions";
import { CandidateAssessmentFileButton } from "@/components/assessments/CandidateAssessmentFileButton";
import { formatDate, titleCase } from "@/lib/format";

export const metadata: Metadata = { title: "Take assessment" };

export default async function TakeAssessmentPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const candidate = await getMyCandidate();
  if (!candidate) redirect("/auth/sign-in");
  const supabase = createClient();
  const { data } = await supabase
    .from("assessment_assignments")
    .select("*")
    .eq("id", assignmentId)
    .eq("candidate_id", candidate.id)
    .maybeSingle();
  const assignment = data as AssessmentAssignmentRow | null;
  if (!assignment) notFound();

  if (["assigned"].includes(assignment.status)) {
    await openAssessmentAction(assignment.id);
  }

  const { data: jobData } = await supabase
    .from("job_orders")
    .select("id,title,assessment_file_name,is_confidential,employer_org_id")
    .eq("id", assignment.job_order_id)
    .maybeSingle();
  const job = jobData as Pick<
    JobOrderRow,
    "id" | "title" | "assessment_file_name" | "is_confidential" | "employer_org_id"
  > | null;

  const closed = ["submitted", "graded", "cancelled", "expired"].includes(assignment.status);
  const includesShugulika =
    assignment.assessment_mode === "shugulika" || assignment.assessment_mode === "both";
  const includesEmployer =
    assignment.assessment_mode === "employer" || assignment.assessment_mode === "both";
  const seniority = assignment.assessment_seniority as AssessmentSeniority;
  const bank = getQuestionBank(seniority);
  const questions = getCandidateQuestions(seniority);

  const { data: files } = includesEmployer
    ? await supabase
        .from("job_order_assessment_files")
        .select("id,file_name,kind")
        .eq("job_order_id", assignment.job_order_id)
        .eq("kind", "candidate_test")
    : { data: [] };

  return (
    <div>
      <PageHeader
        title={job?.title ?? bank.title}
        description={`${titleCase(assignment.assessment_seniority)} · Due ${
          assignment.due_at ? formatDate(assignment.due_at) : "n/a"
        }`}
      />
      <div className="mb-4">
        <ButtonLink href="/candidate/assessments" variant="ghost" size="sm">
          ← Back to assessments
        </ButtonLink>
      </div>

      {closed ? (
        <div className="mb-4">
          <Alert tone="info">
            This assessment is {assignment.status}.
            {assignment.human_review_required
              ? " A recruiter will review free-response answers before any reject decision."
              : ""}
          </Alert>
        </div>
      ) : null}

      {includesEmployer && !closed ? (
        <Card className="mb-6">
          <CardBody className="space-y-3">
            <p className="text-sm font-medium text-ink">Employer-provided test</p>
            <p className="text-sm text-ink-muted">
              Download the candidate-facing file(s), complete them offline if required, then
              continue with any Shugulika questions below.
            </p>
            <div className="flex flex-wrap gap-2">
              {(files as { id: string; file_name: string }[] | null)?.length ? (
                (files as { id: string; file_name: string }[]).map((file) => (
                  <CandidateAssessmentFileButton
                    key={file.id}
                    jobOrderId={assignment.job_order_id}
                    fileName={file.file_name}
                    fileId={file.id}
                  />
                ))
              ) : job?.assessment_file_name ? (
                <CandidateAssessmentFileButton
                  jobOrderId={assignment.job_order_id}
                  fileName={job.assessment_file_name}
                />
              ) : (
                <Alert tone="warn">No employer test file is attached.</Alert>
              )}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {includesShugulika && !closed ? (
        <div className="space-y-4">
          <Alert tone="info">
            {bank.description} Multiple-choice answers are graded automatically. Written answers are
            scored against a fixed rubric; low-confidence results require recruiter review.
          </Alert>
          <ShugulikaAssessmentForm assignmentId={assignment.id} questions={questions} />
        </div>
      ) : null}

      {assignment.assessment_mode === "employer" && !closed ? (
        <Alert tone="info">
          Complete the employer file above, then mark it submitted from the assessments list.
        </Alert>
      ) : null}
    </div>
  );
}
