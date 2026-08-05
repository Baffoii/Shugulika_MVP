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
  getMyAssessmentAssignments,
  getMyResultSnapshots,
  getMyNotifications,
  computeCompletion,
  applicationRoleLabel,
} from "@/lib/data/candidate";
import { getMyInterviewAssignments } from "@/lib/data/video-interviews";
import { nextCandidateDeadline, pendingAssessments } from "@/lib/candidate/progress";
import { listPublicJobs } from "@/lib/data/jobs";
import { JobCard } from "@/components/jobs/JobCard";
import { CANDIDATE_FACING_STATUS } from "@/lib/constants";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
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
  const [
    apps,
    exp,
    edu,
    skills,
    docs,
    interviews,
    videoInterviews,
    assessments,
    notifications,
    jobsRes,
  ] = await Promise.all([
    getMyApplications(candidate.id),
    getMyExperiences(candidate.id),
    getMyEducation(candidate.id),
    getMySkills(candidate.id),
    getMyDocuments(candidate.id),
    getMyInterviews(candidate.id),
    getMyInterviewAssignments(candidate.id),
    getMyAssessmentAssignments(candidate.id),
    getMyNotifications(),
    listPublicJobs({}),
  ]);
  const snapshots = await getMyResultSnapshots(
    candidate.id,
    assessments.map((assessment) => assessment.id),
  );
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
  const openVideoInterviews = videoInterviews.filter((item) =>
    ["invited", "in_progress"].includes(item.status),
  );
  const openAssessments = pendingAssessments(assessments);
  const unreadNotifications = notifications.filter((notification) => !notification.read_at);
  const nextDeadline = nextCandidateDeadline([
    ...activeApps
      .filter((app) => app.next_action_due)
      .map((app) => ({
        kind: "application" as const,
        label: `Application update · ${applicationRoleLabel(app)}`,
        at: app.next_action_due as string,
        href: `/candidate/applications/${app.id}`,
      })),
    ...openAssessments
      .filter((assessment) => assessment.due_at)
      .map((assessment) => ({
        kind: "assessment" as const,
        label: "Assessment deadline",
        at: assessment.due_at as string,
        href: `/candidate/assessments/${assessment.id}`,
      })),
    ...openVideoInterviews
      .filter((interview) => interview.expires_at)
      .map((interview) => ({
        kind: "interview" as const,
        label: `Video interview · ${interview.job_title ?? interview.template_name_snapshot}`,
        at: interview.expires_at as string,
        href: `/candidate/interviews/${interview.id}`,
      })),
    ...upcoming
      .filter((interview) => interview.scheduled_at)
      .map((interview) => ({
        kind: "interview" as const,
        label: "Scheduled interview",
        at: interview.scheduled_at as string,
        href: "/candidate/interviews",
      })),
  ]);

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
        description="Your progress home: what is complete, what is pending, and what has been shared."
        actions={
          <>
            <ButtonLink href="/candidate/help" size="sm" variant="outline">
              Help & accessibility
            </ButtonLink>
            <ButtonLink href="/candidate/jobs" size="sm">
              Browse jobs
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active applications" value={activeApps.length} tone="brand" />
        <StatCard
          label="Pending assessments / interviews"
          value={openAssessments.length + upcoming.length + openVideoInterviews.length}
          tone="info"
          hint="Actions assigned to you"
        />
        <StatCard
          label="Unread notifications"
          value={unreadNotifications.length}
          tone={unreadNotifications.length ? "warn" : "neutral"}
        />
        <StatCard
          label="Results available"
          value={snapshots.length}
          tone={snapshots.length ? "success" : "neutral"}
          hint="Verified offline snapshots"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your next step</CardTitle>
          <Link href="/candidate/notifications" className="text-sm text-brand-700 hover:underline">
            Notifications ({unreadNotifications.length} unread)
          </Link>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {nextDeadline ? (
            <>
              <div>
                <p className="text-sm font-medium text-ink">{nextDeadline.label}</p>
                <p className="text-sm text-ink-muted">Due {formatDateTime(nextDeadline.at)}</p>
              </div>
              <ButtonLink href={nextDeadline.href} size="sm">
                Open next step
              </ButtonLink>
            </>
          ) : (
            <div>
              <p className="text-sm font-medium text-ink">No upcoming deadline</p>
              <p className="text-sm text-ink-muted">
                We will show your next assessment, interview, or application deadline here.
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Your profile — {completion}% complete</CardTitle>
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
