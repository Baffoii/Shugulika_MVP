import type { Metadata } from "next";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/primitives";
import { PlaceholderInline } from "@/components/PlaceholderCard";
import { getMyCandidate, getMyInterviews } from "@/lib/data/candidate";
import { statusTone } from "@/components/StatusBadge";
import { formatDateTime, titleCase } from "@/lib/format";
import { INTERVIEW_TYPES } from "@/lib/constants";

export const metadata: Metadata = { title: "Interviews" };

export default async function CandidateInterviewsPage() {
  const candidate = await getMyCandidate();
  if (!candidate) return null;
  const interviews = await getMyInterviews(candidate.id);

  return (
    <div>
      <PageHeader
        title="Interviews"
        description="Scheduled and requested interview steps across your applications."
      />
      {interviews.length === 0 ? (
        <EmptyState
          title="No interviews yet"
          description="When a recruiter or employer requests an interview, it will appear here."
        />
      ) : (
        <div className="space-y-3">
          {interviews.map((i) => {
            const type = INTERVIEW_TYPES.find((t) => t.key === i.interview_type);
            const isAi = i.interview_type === "ai_async";
            return (
              <Card
                key={i.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {type?.label ?? titleCase(i.interview_type)} · Round {i.round_no}
                    {isAi ? (
                      <span className="ml-2">
                        <PlaceholderInline label="AI interview — integration pending" />
                      </span>
                    ) : null}
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
    </div>
  );
}
