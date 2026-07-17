import Link from "next/link";
import type { Metadata } from "next";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  StatCard,
  ButtonLink,
  EmptyState,
  Badge,
} from "@/components/ui/primitives";
import {
  getMyCandidate,
  getMyApplications,
  getMyExperiences,
  getMyEducation,
  getMySkills,
  getMyDocuments,
  getMyInterviews,
  computeCompletion,
  applicationRoleLabel,
} from "@/lib/data/candidate";
import { listPublicJobs } from "@/lib/data/jobs";
import { JobCard } from "@/components/jobs/JobCard";
import { CANDIDATE_FACING_STATUS } from "@/lib/constants";
import { formatDate, titleCase } from "@/lib/format";
import { CheckCircle2, Circle } from "lucide-react";

export const metadata: Metadata = { title: "Dashboard" };

export default async function CandidateDashboard() {
  const candidate = await getMyCandidate();
  if (!candidate) {
    return (
      <EmptyState
        title="Your candidate profile is being set up"
        description="Refresh in a moment, or contact support if this persists."
      />
    );
  }
  const [apps, exp, edu, skills, docs, interviews, jobsRes] = await Promise.all([
    getMyApplications(candidate.id),
    getMyExperiences(candidate.id),
    getMyEducation(candidate.id),
    getMySkills(candidate.id),
    getMyDocuments(candidate.id),
    getMyInterviews(candidate.id),
    listPublicJobs({}),
  ]);
  const completion = computeCompletion({
    profile: candidate,
    experiences: exp.length,
    education: edu.length,
    skills: skills.length,
    documents: docs.length,
  });
  const activeApps = apps.filter((a) => !a.withdrawn_at);
  const appliedOrderIds = new Set(apps.map((a) => a.job_order_id));
  const upcoming = interviews.filter((i) =>
    ["requested", "scheduled", "confirmed"].includes(i.status),
  );

  const checklist = [
    { label: "Add your headline", done: !!candidate.headline },
    { label: "Write a short summary", done: !!candidate.summary },
    { label: "Add work experience", done: exp.length > 0 },
    { label: "Add education", done: edu.length > 0 },
    { label: "Add skills", done: skills.length > 0 },
    { label: "Upload a CV", done: docs.some((d) => d.doc_type === "cv") },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${candidate.given_name ?? "there"}`}
        description="Track your applications, keep your profile fresh, and discover new roles."
        actions={
          <ButtonLink href="/candidate/jobs" size="sm">
            Browse jobs
          </ButtonLink>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active applications" value={activeApps.length} tone="brand" />
        <StatCard label="Upcoming interviews" value={upcoming.length} tone="info" />
        <StatCard label="Saved documents" value={docs.length} tone="neutral" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Get ready to apply — {completion}% complete</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-surface-border">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${completion}%` }}
              />
            </div>
            <ul className="space-y-2">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-sm">
                  {c.done ? (
                    <CheckCircle2 className="h-4 w-4 text-brand-600" aria-hidden />
                  ) : (
                    <Circle className="h-4 w-4 text-ink-subtle" aria-hidden />
                  )}
                  <span className={c.done ? "text-ink-muted line-through" : "text-ink"}>
                    {c.label}
                  </span>
                </li>
              ))}
            </ul>
            <ButtonLink
              href="/candidate/profile"
              variant="secondary"
              size="sm"
              className="mt-4 w-full"
            >
              Continue profile
            </ButtonLink>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent applications</CardTitle>
            <Link href="/candidate/applications" className="text-sm text-brand-700 hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardBody className="p-0">
            {activeApps.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No applications yet"
                  description="Find a role and apply — it takes just a few minutes."
                  action={
                    <ButtonLink href="/candidate/jobs" size="sm">
                      Browse jobs
                    </ButtonLink>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y divide-surface-border">
                {activeApps.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {applicationRoleLabel(a)}
                      </p>
                      <p className="text-xs text-ink-subtle">Applied {formatDate(a.created_at)}</p>
                    </div>
                    <Badge tone="info">
                      {CANDIDATE_FACING_STATUS[a.current_stage] ?? titleCase(a.current_stage)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Recommended roles</h2>
          <Link href="/candidate/jobs" className="text-sm text-brand-700 hover:underline">
            See all
          </Link>
        </div>
        {jobsRes.jobs.filter((j) => !appliedOrderIds.has(j.job_order_id)).length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {jobsRes.jobs
              .filter((j) => !appliedOrderIds.has(j.job_order_id))
              .slice(0, 3)
              .map((j) => (
                <JobCard key={j.job_id} job={j} detailBasePath="/candidate/jobs" />
              ))}
          </div>
        ) : (
          <Card className="p-5 text-sm text-ink-muted">
            {appliedOrderIds.size > 0
              ? "You've already applied to the featured roles — browse all open jobs for more."
              : "No roles to show yet."}
          </Card>
        )}
      </div>
    </div>
  );
}
