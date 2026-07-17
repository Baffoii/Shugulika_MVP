import Link from "next/link";
import type { Metadata } from "next";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui/primitives";
import { StageBadge } from "@/components/StatusBadge";
import { getRecruiterMetrics, getPipeline } from "@/lib/data/recruiter";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Recruiter dashboard" };

export default async function RecruiterDashboard() {
  const [metrics, pipeline] = await Promise.all([getRecruiterMetrics(), getPipeline()]);
  const needsAction = pipeline
    .filter((a) => ["applied_sourced", "cv_screening"].includes(a.current_stage))
    .slice(0, 8);

  return (
    <div>
      <PageHeader
        title="My work"
        description="Your recruitment activity across assigned jobs. Metrics reflect only the records you're authorized to see."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active jobs" value={metrics.activeJobs} tone="brand" />
        <StatCard label="New applications" value={metrics.newApplications} tone="info" />
        <StatCard label="Awaiting review" value={metrics.awaitingReview} tone="warn" />
        <StatCard label="Consent pending" value={metrics.consentPending} tone="warn" />
        <StatCard label="Submissions pending" value={metrics.submissionsPending} tone="info" />
        <StatCard label="Interviews scheduled" value={metrics.interviewsScheduled} tone="neutral" />
        <StatCard label="Offers in progress" value={metrics.offers} tone="brand" />
        <StatCard label="Placements" value={metrics.placements} tone="success" />
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Candidates needing review</CardTitle>
            <Link href="/recruiter/pipeline" className="text-sm text-brand-700 hover:underline">
              Open pipeline
            </Link>
          </CardHeader>
          {needsAction.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="You're all caught up"
                description="No new applicants awaiting first review."
              />
            </div>
          ) : (
            <ul className="divide-y divide-surface-border">
              {needsAction.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/recruiter/applications/${a.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {a.candidate_profiles?.given_name ?? "Candidate"}{" "}
                        {a.candidate_profiles?.family_name ?? ""} — {a.job_orders?.title ?? "Role"}
                      </p>
                      <p className="text-xs text-ink-subtle">Applied {formatDate(a.created_at)}</p>
                    </div>
                    <StageBadge stageKey={a.current_stage} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
