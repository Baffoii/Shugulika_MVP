import type { Metadata } from "next";
import { Video } from "lucide-react";
import { PageHeader, Card, EmptyState, Badge, ButtonLink } from "@/components/ui/primitives";
import { getMyCandidate, getMyInterviews } from "@/lib/data/candidate";
import { getMyInterviewAssignments } from "@/lib/data/video-interviews";
import { statusTone } from "@/components/StatusBadge";
import { formatDateTime, titleCase } from "@/lib/format";
import { INTERVIEW_TYPES, interviewStatusLabel } from "@/lib/constants";
import type { CandidateAssignmentListItem } from "@/lib/data/video-interviews";

export const metadata: Metadata = { title: "Interviews" };

function isActionable(status: CandidateAssignmentListItem["status"]) {
  return status === "invited" || status === "in_progress";
}

function isCompleted(status: CandidateAssignmentListItem["status"]) {
  return status === "submitted" || status === "reviewed";
}

function VideoAssignmentCard({ assignment }: { assignment: CandidateAssignmentListItem }) {
  const canOpen = !["expired", "cancelled"].includes(assignment.status);
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-ink">
            {assignment.job_title ?? assignment.template_name_snapshot}
          </p>
          <Badge tone={statusTone(assignment.status)}>
            {interviewStatusLabel(assignment.status)}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-ink-subtle">
          {assignment.question_count} question
          {assignment.question_count === 1 ? "" : "s"}
          {assignment.expires_at ? ` · Due ${formatDateTime(assignment.expires_at)}` : ""}
          {assignment.submitted_at ? ` · Submitted ${formatDateTime(assignment.submitted_at)}` : ""}
        </p>
      </div>
      {canOpen ? (
        <ButtonLink href={`/candidate/interviews/${assignment.id}`} size="sm">
          {assignment.status === "in_progress"
            ? "Continue"
            : isCompleted(assignment.status)
              ? "View confirmation"
              : "View invitation"}
        </ButtonLink>
      ) : null}
    </Card>
  );
}

export default async function CandidateInterviewsPage() {
  const candidate = await getMyCandidate();
  if (!candidate) return null;
  const [interviews, videoAssignments] = await Promise.all([
    getMyInterviews(candidate.id),
    getMyInterviewAssignments(candidate.id),
  ]);

  const actionable = videoAssignments.filter((a) => isActionable(a.status));
  const completed = videoAssignments.filter((a) => isCompleted(a.status));
  const other = videoAssignments.filter((a) => !isActionable(a.status) && !isCompleted(a.status));

  return (
    <div>
      <PageHeader
        title="Interviews"
        description="Video interviews and scheduled interview steps across your applications."
      />

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Video interviews — action needed</h2>
            <p className="text-sm text-ink-muted">
              Invitations and interviews in progress. Record responses on your own schedule.
            </p>
          </div>
          <Badge tone="neutral">{actionable.length}</Badge>
        </div>
        {actionable.length === 0 ? (
          <EmptyState
            icon={<Video className="h-7 w-7" aria-hidden />}
            title="No open video interviews"
            description="A recruiter invitation will appear here when a video interview is ready."
          />
        ) : (
          <div className="space-y-3">
            {actionable.map((assignment) => (
              <VideoAssignmentCard key={assignment.id} assignment={assignment} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Video interviews — completed</h2>
            <p className="text-sm text-ink-muted">
              Submitted responses waiting on recruiter review.
            </p>
          </div>
          <Badge tone="neutral">{completed.length}</Badge>
        </div>
        {completed.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-ink-subtle">No completed video interviews yet.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {completed.map((assignment) => (
              <VideoAssignmentCard key={assignment.id} assignment={assignment} />
            ))}
          </div>
        )}
      </section>

      {other.length > 0 ? (
        <section className="mb-8">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-ink">Expired or cancelled</h2>
          </div>
          <div className="space-y-3">
            {other.map((assignment) => (
              <VideoAssignmentCard key={assignment.id} assignment={assignment} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-3">
          <h2 className="text-base font-semibold text-ink">Scheduled interviews</h2>
          <p className="text-sm text-ink-muted">Live and in-person interview steps.</p>
        </div>
        {interviews.length === 0 ? (
          <EmptyState
            title="No scheduled interviews"
            description="Live or in-person interview requests will appear here."
          />
        ) : (
          <div className="space-y-3">
            {interviews.map((i) => {
              const type = INTERVIEW_TYPES.find((t) => t.key === i.interview_type);
              return (
                <Card
                  key={i.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {type?.label ?? titleCase(i.interview_type)} · Round {i.round_no}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {i.scheduled_at ? formatDateTime(i.scheduled_at) : "Awaiting scheduling"}
                      {i.location_or_link ? ` · ${i.location_or_link}` : ""}
                    </p>
                    {i.instructions ? (
                      <p className="mt-1 text-sm text-ink-muted">{i.instructions}</p>
                    ) : null}
                  </div>
                  <Badge tone={statusTone(i.status)}>{titleCase(i.status)}</Badge>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
