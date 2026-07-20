import Link from "next/link";
import { notFound } from "next/navigation";
import { getInterviewResults } from "@/lib/data/video-interviews";
import { formatDateTime } from "@/lib/format";
import { formatBytes, formatDuration } from "@/lib/interview-analytics";
import { interviewStatusLabel } from "@/lib/constants";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
} from "@/components/ui/primitives";
import { CancelInterviewButton, Playback, ReminderButton, ReviewForm } from "./ResultsClient";

export const metadata = { title: "Interview results" };

export default async function InterviewResultsPage({
  params,
}: {
  params: { assignmentId: string };
}) {
  const results = await getInterviewResults(params.assignmentId);
  if (!results) notFound();
  const {
    assignment,
    candidate,
    job,
    questions,
    attempts,
    review,
    questionAnalytics,
    assignmentAnalytics,
  } = results;
  const candidateName =
    [candidate?.given_name, candidate?.family_name].filter(Boolean).join(" ") || "Candidate";
  const analyticsByQuestion = new Map(
    questionAnalytics.map((row) => [row.assignment_question_id, row]),
  );
  const selectedByQuestion = new Map(
    attempts
      .filter((attempt) => attempt.is_selected_submission)
      .map((attempt) => [attempt.assignment_question_id, attempt]),
  );
  const canCancel = ["draft", "invited", "in_progress"].includes(assignment.status);
  const canReview = ["submitted", "reviewed"].includes(assignment.status);
  return (
    <div>
      <Link href="/recruiter/interviews" className="text-sm text-brand-700 hover:underline">
        ← Back to interviews
      </Link>
      <PageHeader
        title={candidateName}
        description={`${job?.title ?? assignment.template_name_snapshot} · ${assignment.template_name_snapshot}`}
        actions={
          <Badge
            tone={
              assignment.status === "reviewed"
                ? "success"
                : assignment.status === "submitted"
                  ? "brand"
                  : "neutral"
            }
          >
            {interviewStatusLabel(assignment.status)}
          </Badge>
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Completion"
          value={`${assignmentAnalytics?.completion_percentage ?? 0}%`}
        />
        <StatCard
          label="Final recording"
          value={formatDuration(assignmentAnalytics?.total_final_recording_duration_seconds)}
          hint="Selected responses only"
        />
        <StatCard label="Attempts" value={assignmentAnalytics?.total_attempts ?? attempts.length} />
        <StatCard label="Retries" value={assignmentAnalytics?.total_retries ?? 0} />
        <StatCard
          label="Elapsed interview time"
          value={formatDuration(assignmentAnalytics?.total_elapsed_seconds)}
          hint="Start to final submission"
        />
        <StatCard
          label="All recording time"
          value={formatDuration(assignmentAnalytics?.total_recording_duration_seconds)}
          hint="Includes retries"
        />
        <StatCard
          label="Average final response"
          value={formatDuration(assignmentAnalytics?.average_final_response_duration_seconds)}
        />
        <StatCard
          label="Average attempts"
          value={assignmentAnalytics?.average_attempts_per_question ?? "—"}
          hint="Per question"
        />
      </div>
      <Alert tone="neutral">
        These are factual recording and timing measurements only. Retries and response speed are not
        evidence of candidate quality or suitability.
      </Alert>
      {assignment.has_unusual_interruptions || assignment.interruption_count > 0 ? (
        <div className="mt-3">
          <Alert tone="warn">
            Session integrity: {assignment.interruption_count} interruption(s) recorded
            {assignment.has_unusual_interruptions
              ? " and flagged for recruiter review (for example tab close, refresh, or leave during recording)."
              : "."}{" "}
            Controlled reconnects after accidental disconnect are allowed and logged separately.
          </Alert>
        </div>
      ) : null}
      {assignment.documents_locked_at ? (
        <div className="mt-3">
          <Alert tone="info">
            Application documents were locked at interview start (
            {formatDateTime(assignment.documents_locked_at)}). Document substitution during the
            session is blocked; attempted changes appear in the event log for review — not as proof
            of document authenticity.
          </Alert>
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div className="mt-5 space-y-4">
          {!canReview ? (
            <Alert tone="info">
              This interview is {interviewStatusLabel(assignment.status).toLowerCase()}. Responses
              appear after submission.
            </Alert>
          ) : null}
          {questions.map((question) => {
            const attempt = selectedByQuestion.get(question.id);
            const analytics = analyticsByQuestion.get(question.id);
            return (
              <Card key={question.id}>
                <CardHeader>
                  <CardTitle>Question {question.display_order}</CardTitle>
                  <span className="text-xs text-ink-subtle">
                    {analytics?.attempts_used ?? 0} attempt(s) ·{" "}
                    {formatDuration(analytics?.selected_response_duration_seconds)}
                  </span>
                </CardHeader>
                <CardBody>
                  <p className="font-medium text-ink">{question.question_text_snapshot}</p>
                  {question.question_description_snapshot ? (
                    <p className="mt-1 text-sm text-ink-muted">
                      {question.question_description_snapshot}
                    </p>
                  ) : null}
                  <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-surface-muted p-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-ink-subtle">Selected attempt</dt>
                      <dd className="font-medium text-ink">
                        {analytics?.selected_attempt_number
                          ? `#${analytics.selected_attempt_number}`
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-subtle">Attempts / retries</dt>
                      <dd className="font-medium text-ink">
                        {analytics?.attempts_used ?? 0} / {analytics?.retry_count ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-subtle">Preparation used</dt>
                      <dd className="font-medium text-ink">
                        {formatDuration(analytics?.preparation_time_used_seconds)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-subtle">Final response</dt>
                      <dd className="font-medium text-ink">
                        {formatDuration(analytics?.selected_response_duration_seconds)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-subtle">Average / total recorded</dt>
                      <dd className="font-medium text-ink">
                        {formatDuration(analytics?.average_attempt_duration_seconds)} /{" "}
                        {formatDuration(analytics?.total_attempt_duration_seconds)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-subtle">Question elapsed</dt>
                      <dd className="font-medium text-ink">
                        {formatDuration(analytics?.time_from_question_opened_to_completion_seconds)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-subtle">Upload failures</dt>
                      <dd className="font-medium text-ink">
                        {analytics?.upload_failure_count ?? 0}
                      </dd>
                    </div>
                  </dl>
                  {attempt?.upload_status === "uploaded" ? (
                    <Playback
                      attemptId={attempt.id}
                      durationSeconds={attempt.duration_seconds}
                    />
                  ) : canReview ? (
                    <Alert tone="warn">The selected recording is unavailable.</Alert>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
        <div className="mt-5 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Interview details</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <p>
                <span className="text-ink-subtle">Invited:</span>{" "}
                {formatDateTime(assignment.invited_at)}
              </p>
              <p>
                <span className="text-ink-subtle">Started:</span>{" "}
                {formatDateTime(assignment.started_at)}
              </p>
              <p>
                <span className="text-ink-subtle">Submitted:</span>{" "}
                {formatDateTime(assignment.submitted_at)}
              </p>
              <p>
                <span className="text-ink-subtle">Deadline:</span>{" "}
                {formatDateTime(assignment.expires_at)}
              </p>
              <p>
                <span className="text-ink-subtle">Questions completed:</span>{" "}
                {assignmentAnalytics?.completed_question_count ?? 0} of{" "}
                {assignmentAnalytics?.total_question_count ?? questions.length}
                {" · "}
                {assignmentAnalytics?.required_question_count ?? questions.length} required
              </p>
              <p>
                <span className="text-ink-subtle">Upload failures:</span>{" "}
                {assignmentAnalytics?.upload_failure_count ?? 0}
              </p>
              <p>
                <span className="text-ink-subtle">Uploaded storage:</span>{" "}
                {formatBytes(assignmentAnalytics?.total_uploaded_bytes)}
              </p>
              {assignment.candidate_instructions ? (
                <p className="border-t border-surface-border pt-2 text-ink-muted">
                  {assignment.candidate_instructions}
                </p>
              ) : null}
              <Link
                href={`/recruiter/applications/${assignment.application_id}`}
                className="inline-block text-brand-700 hover:underline"
              >
                Open application
              </Link>
            </CardBody>
          </Card>
          {canReview ? <ReviewForm assignmentId={assignment.id} review={review} /> : null}
          {canCancel ? <ReminderButton assignmentId={assignment.id} /> : null}
          {canCancel ? <CancelInterviewButton assignmentId={assignment.id} /> : null}
        </div>
      </div>
    </div>
  );
}
