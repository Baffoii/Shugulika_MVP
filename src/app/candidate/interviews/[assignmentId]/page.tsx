import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Badge,
  Alert,
  ButtonLink,
} from "@/components/ui/primitives";
import { PageHeader } from "@/components/ui/primitives";
import { getMyInterviewDetail } from "@/lib/data/video-interviews";
import { expectedTotalSeconds, formatDuration } from "@/lib/interview-analytics";
import { interviewStatusLabel } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { statusTone } from "@/components/StatusBadge";
import { StartInterviewForm } from "./StartInterviewForm";

export const metadata: Metadata = { title: "Video interview" };

export default async function InterviewInvitationPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const detail = await getMyInterviewDetail(assignmentId);
  if (!detail) notFound();
  const { assignment, questions, jobTitle, employerName } = detail;

  const isExpired =
    assignment.status === "expired" ||
    (assignment.expires_at !== null && new Date(assignment.expires_at) < new Date());
  const maxRetries = Math.max(...questions.map((q) => q.max_attempts), 1) - 1;
  const totalSeconds = expectedTotalSeconds(questions);

  const isLiveAi = assignment.interview_mode === "live_ai_voice";

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={isLiveAi ? "AI voice interview invitation" : "Video interview invitation"}
        description={
          isLiveAi
            ? "Complete a timed live voice interview with Shugulika’s AI interviewer. A human recruiter reviews everything afterward."
            : "Record short video answers at your own pace — one question at a time."
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{jobTitle ?? assignment.template_name_snapshot}</CardTitle>
          <Badge tone={statusTone(assignment.status)}>
            {interviewStatusLabel(assignment.status)}
          </Badge>
        </CardHeader>
        <CardBody className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Employer
              </dt>
              <dd className="mt-0.5 text-ink">{employerName ?? "The hiring team"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Questions
              </dt>
              <dd className="mt-0.5 text-ink">{questions.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Expected duration
              </dt>
              <dd className="mt-0.5 text-ink">
                {isLiveAi
                  ? `About ${Math.round((assignment.duration_seconds ?? 600) / 60)} minutes`
                  : `About ${formatDuration(totalSeconds)}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Submission deadline
              </dt>
              <dd className="mt-0.5 text-ink">
                {assignment.expires_at ? formatDateTime(assignment.expires_at) : "No deadline"}
              </dd>
            </div>
            {!isLiveAi ? (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Retries
                </dt>
                <dd className="mt-0.5 text-ink">
                  {maxRetries === 0
                    ? "One recording per question (no retries)"
                    : `Up to ${maxRetries} retr${maxRetries === 1 ? "y" : "ies"} per question`}
                </dd>
              </div>
            ) : (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  Interviewer
                </dt>
                <dd className="mt-0.5 text-ink">Shugulika AI voice agent</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                You will need
              </dt>
              <dd className="mt-0.5 text-ink">
                {isLiveAi
                  ? "A working microphone, speakers, and a quiet spot"
                  : "A working camera, microphone and a quiet spot"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Recording retention
              </dt>
              <dd className="mt-0.5 text-ink">
                Up to {assignment.retention_days} days after submission
              </dd>
            </div>
          </dl>

          {assignment.candidate_instructions ? (
            <Alert tone="info" title="A note from the recruiting team">
              {assignment.candidate_instructions}
            </Alert>
          ) : null}
          {assignment.template_instructions_snapshot && !isLiveAi ? (
            <div className="rounded-lg border border-surface-border bg-surface-muted px-4 py-3 text-sm text-ink-muted">
              {assignment.template_instructions_snapshot}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {assignment.status === "submitted" || assignment.status === "reviewed" ? (
        <Alert tone="success" title="Interview completed">
          {isLiveAi
            ? "Your AI voice interview was submitted successfully. You cannot retake this interview. A recruiter will review the recording and evidence before any pipeline decision."
            : `Your responses were submitted${assignment.submitted_at ? ` on ${formatDateTime(assignment.submitted_at)}` : ""}. The recruiting team will review them and move your application forward.`}
          {assignment.submitted_at && isLiveAi ? (
            <p className="mt-2 text-sm">Submitted {formatDateTime(assignment.submitted_at)}.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href="/candidate/interviews" variant="outline" size="sm">
              Back to interviews
            </ButtonLink>
            <ButtonLink href="/candidate/applications" variant="outline" size="sm">
              Back to my applications
            </ButtonLink>
          </div>
        </Alert>
      ) : assignment.status === "cancelled" ? (
        <Alert tone="neutral" title="Interview cancelled">
          This interview invitation was withdrawn by the recruiting team. No action is needed.
        </Alert>
      ) : isExpired ? (
        <Alert tone="warn" title="Interview expired">
          The submission deadline for this interview has passed. Contact the recruiting team if you
          believe this is a mistake.
        </Alert>
      ) : isLiveAi ? (
        <Card>
          <CardHeader>
            <CardTitle>Ready when you are</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-muted">
              You will see AI disclosure and a microphone check before the live session starts. You
              can skip a question if needed — just say so. The interviewer may ask brief follow-ups.
              A human recruiter reviews the recording and evidence afterward.
            </p>
            <ButtonLink href={`/candidate/interviews/${assignment.id}/session`}>
              Open AI voice interview
            </ButtonLink>
          </CardBody>
        </Card>
      ) : (
        <StartInterviewForm
          assignmentId={assignment.id}
          alreadyStarted={assignment.status === "in_progress"}
        />
      )}
    </div>
  );
}
