import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Assessments" };

/**
 * Candidate assessment tracker.
 * External provider invites (TestGorilla / Central Test) are not connected in
 * this MVP yet, so the invited/completed lists stay empty until that integration
 * lands. Asynchronous video interviews live under Interviews — not here.
 */
export default function CandidateAssessmentsPage() {
  const invited: never[] = [];
  const completed: never[] = [];

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="Track skills and psychometric assessments you have been invited to complete."
      />

      <Alert tone="info" title="External assessment providers are not connected yet">
        This page will list provider invitations and completed results once TestGorilla / Central
        Test (or a similar integration) is enabled. No actions here produce vendor results yet.
        <div className="mt-3">
          <ButtonLink href="/candidate/interviews" variant="outline" size="sm">
            Go to video interviews
          </ButtonLink>
        </div>
      </Alert>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Invited &amp; in progress</h2>
            <p className="text-sm text-ink-muted">
              Assessments waiting for you to start or finish.
            </p>
          </div>
          <Badge tone="neutral">{invited.length}</Badge>
        </div>
        {invited.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-7 w-7" aria-hidden />}
            title="No assessment invitations"
            description="When a recruiter invites you to a skills or psychometric assessment, it will appear here."
          />
        ) : (
          <div className="space-y-3">
            {/* Provider invites will render here once the integration is connected. */}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Completed</h2>
            <p className="text-sm text-ink-muted">Assessments you have already submitted.</p>
          </div>
          <Badge tone="neutral">{completed.length}</Badge>
        </div>
        {completed.length === 0 ? (
          <Card className="p-4">
            <p className="text-sm text-ink-subtle">No completed assessments yet.</p>
          </Card>
        ) : (
          <div className="space-y-3">{/* Completed provider attempts will render here. */}</div>
        )}
      </section>
    </div>
  );
}
