import Link from "next/link";
import { Card, Badge, ButtonLink, Alert } from "@/components/ui/primitives";
import { getPublicJob } from "@/lib/data/jobs";
import { getSessionContext } from "@/lib/auth";
import { getMyCandidate, getMyApplicationStatusesByJobOrder } from "@/lib/data/candidate";
import { salaryRange, formatDate, titleCase } from "@/lib/format";
import { MapPin, Briefcase, CalendarClock, Users } from "lucide-react";
import { ApplyAgainButton } from "@/components/jobs/ApplyAgainButton";

export async function JobDetailView({
  jobId,
  jobsBasePath = "/jobs",
}: {
  jobId: string;
  jobsBasePath?: string;
}) {
  const job = await getPublicJob(jobId);
  if (!job) return null;

  const session = await getSessionContext();
  const isCandidate = session?.roles.includes("candidate") ?? false;
  const applyHref = session
    ? isCandidate
      ? `/candidate/apply/${job.job_order_id}`
      : "/candidate/dashboard"
    : `/auth/sign-in?redirectTo=/candidate/apply/${job.job_order_id}`;

  let applicationStatus: "active" | "withdrawn" | null = null;
  if (isCandidate) {
    const candidate = await getMyCandidate();
    if (candidate) {
      const statuses = await getMyApplicationStatusesByJobOrder(candidate.id);
      applicationStatus = statuses.get(job.job_order_id) ?? null;
    }
  }
  const alreadyApplied = applicationStatus === "active";
  const withdrawn = applicationStatus === "withdrawn";

  return (
    <div className={jobsBasePath.startsWith("/candidate") ? "" : "mx-auto max-w-4xl"}>
      <Link href={jobsBasePath} className="text-sm text-brand-700 hover:underline">
        ← Back to jobs
      </Link>

      <Card className="mt-4 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-ink">{job.title}</h1>
            <p className="mt-1 text-ink-muted">{job.employer_name}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {withdrawn ? <Badge tone="neutral">Withdrawn</Badge> : null}
            {alreadyApplied ? <Badge tone="neutral">Applied</Badge> : null}
            {job.recruitment_path === "A" ? (
              <Badge tone="info">Direct employer</Badge>
            ) : (
              <Badge tone="success">Shugulika-managed</Badge>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-ink-muted sm:grid-cols-4">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4 text-ink-subtle" aria-hidden /> {job.city ?? "—"},{" "}
            {job.country_code}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Briefcase className="h-4 w-4 text-ink-subtle" aria-hidden />{" "}
            {titleCase(job.employment_type)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-4 w-4 text-ink-subtle" aria-hidden /> {job.vacancy_count} vacanc
            {job.vacancy_count === 1 ? "y" : "ies"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4 text-ink-subtle" aria-hidden /> Closes{" "}
            {formatDate(job.application_deadline)}
          </span>
        </div>

        <div className="mt-4 rounded-lg bg-brand-50/60 px-4 py-3 text-sm text-brand-800">
          Compensation:{" "}
          <span className="font-medium">
            {salaryRange(job.salary_min, job.salary_max, job.salary_currency)}
          </span>
          {job.salary_min == null && job.salary_max == null ? " (not disclosed by employer)" : null}
        </div>

        {withdrawn ? (
          <div className="mt-4">
            <Alert tone="info" title="You withdrew your application">
              You can apply again. Recruiters will see that you previously withdrew from this role.
            </Alert>
          </div>
        ) : alreadyApplied ? (
          <div className="mt-4">
            <Alert tone="info" title="You've already applied">
              You can update your CV or answers — we&apos;ll ask you to confirm first.
            </Alert>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {withdrawn || alreadyApplied ? (
            <ApplyAgainButton
              href={`${applyHref}?reapply=1`}
              jobTitle={job.title}
              employerName={job.employer_name}
              mode={withdrawn ? "reapply" : "update"}
            />
          ) : (
            <ButtonLink href={applyHref} size="md">
              Apply now
            </ButtonLink>
          )}
          {!session ? (
            <ButtonLink href="/auth/sign-up" variant="outline" size="md">
              Create profile first
            </ButtonLink>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          Takes about 3–5 minutes with your saved profile and CV.
        </p>
      </Card>

      <div className="mt-4 grid gap-4">
        {job.description ? <JobSection title="About the role" body={job.description} /> : null}
        {job.responsibilities ? (
          <JobSection title="Responsibilities" body={job.responsibilities} />
        ) : null}
        {job.requirements ? <JobSection title="Requirements" body={job.requirements} /> : null}
      </div>
    </div>
  );
}

function JobSection({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{body}</p>
    </Card>
  );
}
