import Link from "next/link";
import { listInterviewAssignments } from "@/lib/data/video-interviews";
import { formatDateTime } from "@/lib/format";
import { interviewStatusLabel } from "@/lib/constants";
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";

export const metadata = { title: "Interviews" };

const tones = {
  invited: "info",
  in_progress: "warn",
  submitted: "brand",
  reviewed: "success",
  expired: "danger",
  cancelled: "neutral",
  draft: "neutral",
} as const;

export default async function Page() {
  const assignments = await listInterviewAssignments();
  return (
    <div>
      <PageHeader
        title="Video interviews"
        description="Track asynchronous interview invitations, submissions, and recruiter reviews."
        actions={
          <ButtonLink href="/recruiter/interview-templates" variant="secondary">
            Manage templates
          </ButtonLink>
        }
      />
      {assignments.length ? (
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <Link
              key={assignment.id}
              href={`/recruiter/interviews/${assignment.id}`}
              className="block"
            >
              <Card className="transition-colors hover:border-brand-300">
                <CardBody className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div>
                    <p className="font-semibold text-ink">
                      {assignment.candidate_name || "Candidate"}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {assignment.job_title || assignment.template_name_snapshot}
                    </p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      Invited {formatDateTime(assignment.invited_at ?? assignment.created_at)}
                      {assignment.expires_at
                        ? ` · Due ${formatDateTime(assignment.expires_at)}`
                        : ""}
                    </p>
                  </div>
                  <Badge tone={tones[assignment.status]}>
                    {interviewStatusLabel(assignment.status)}
                  </Badge>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No video interviews yet"
          description="Assign an active template from a candidate application."
          action={<ButtonLink href="/recruiter/pipeline">Open pipeline</ButtonLink>}
        />
      )}
    </div>
  );
}
