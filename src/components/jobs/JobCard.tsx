import Link from "next/link";
import { MapPin, Briefcase, Clock } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { salaryRange, formatDate, relativeDays, titleCase } from "@/lib/format";
import type { PublicJobRow } from "@/lib/database.types";

export function JobCard({
  job,
  detailBasePath = "/jobs",
  applied = false,
  withdrawn = false,
}: {
  job: PublicJobRow;
  detailBasePath?: string;
  /** Candidate has an active application for this role. */
  applied?: boolean;
  /** Candidate withdrew their application for this role. */
  withdrawn?: boolean;
}) {
  const closing = job.application_deadline;
  const closingSoon = closing ? new Date(closing).getTime() - Date.now() < 5 * 86_400_000 : false;
  return (
    <Link
      href={`${detailBasePath}/${job.public_slug ?? job.job_id}`}
      className="card block p-5 transition-shadow hover:shadow-pop focus-visible:shadow-pop"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{job.title}</h3>
          <p className="mt-0.5 text-sm text-ink-muted">{job.employer_name}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {withdrawn ? <Badge tone="neutral">Withdrawn</Badge> : null}
          {applied && !withdrawn ? <Badge tone="neutral">Applied</Badge> : null}
          {job.recruitment_path === "A" ? (
            <Badge tone="info">Direct employer</Badge>
          ) : (
            <Badge tone="success">Shugulika-managed</Badge>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-4 w-4 text-ink-subtle" aria-hidden /> {job.city ?? "—"},{" "}
          {job.country_code}
        </span>
        <span className="inline-flex items-center gap-1">
          <Briefcase className="h-4 w-4 text-ink-subtle" aria-hidden />{" "}
          {titleCase(job.employment_type)} · {titleCase(job.work_arrangement)}
        </span>
      </div>
      {job.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-ink-muted">{job.description}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-3 text-xs text-ink-subtle">
        <span>{salaryRange(job.salary_min, job.salary_max, job.salary_currency)}</span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {closing ? (
            <span className={closingSoon ? "font-medium text-amber-700" : ""}>
              Closes {formatDate(closing)} · {relativeDays(closing)}
            </span>
          ) : (
            "Open"
          )}
        </span>
      </div>
    </Link>
  );
}
