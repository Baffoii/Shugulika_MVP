import Link from "next/link";
import { PageHeader, Badge, ButtonLink, EmptyState } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { AssignmentFilters } from "@/components/recruiters/AssignmentFilters";
import type { OwnedJobAssignmentView } from "@/lib/data/staff";
import { formatDate } from "@/lib/format";

export function AssignmentsOverview({
  title,
  description,
  tip,
  manageBasePath,
  jobsBasePath,
  assignments,
  recruiterFilter,
  regionFilter,
  recruiters,
  regions,
}: {
  title: string;
  description: string;
  tip?: React.ReactNode;
  manageBasePath: string;
  jobsBasePath: string;
  assignments: OwnedJobAssignmentView[];
  recruiterFilter?: string;
  regionFilter?: string;
  recruiters: { id: string; name: string }[];
  regions: { code: string; name: string }[];
}) {
  const filtered = assignments.filter((row) => {
    if (recruiterFilter && row.recruiter_user_id !== recruiterFilter) return false;
    if (regionFilter && row.recruiter_region !== regionFilter) return false;
    return true;
  });

  const jobCountByRecruiter = new Map<string, number>();
  for (const row of assignments) {
    jobCountByRecruiter.set(
      row.recruiter_user_id,
      (jobCountByRecruiter.get(row.recruiter_user_id) ?? 0) + 1,
    );
  }

  return (
    <div>
      <PageHeader title={title} description={description} />

      <AssignmentFilters
        basePath={manageBasePath}
        recruiters={recruiters}
        regions={regions}
        recruiter={recruiterFilter}
        region={regionFilter}
      />

      {filtered.length === 0 ? (
        <EmptyState
          title={assignments.length === 0 ? "No jobs assigned yet" : "No matching assignments"}
          description={
            assignments.length === 0
              ? "Assign owners from Jobs after a role is approved."
              : "Try a different recruiter or region filter."
          }
        />
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Location</TH>
              <TH>Recruiter</TH>
              <TH>Region</TH>
              <TH>Created</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <tbody>
            {filtered.map((row) => (
              <TR key={row.job_order_id}>
                <TD className="font-medium text-ink">{row.title}</TD>
                <TD>
                  <StatusBadge status={row.status} />
                </TD>
                <TD className="text-ink-muted">
                  {[row.city, row.country_code].filter(Boolean).join(", ")}
                </TD>
                <TD>
                  <div className="font-medium text-ink">{row.recruiter_name}</div>
                  <div className="text-xs text-ink-subtle">
                    {jobCountByRecruiter.get(row.recruiter_user_id) ?? 0} jobs owned
                  </div>
                </TD>
                <TD>
                  <Badge tone="neutral">{row.recruiter_region ?? "—"}</Badge>
                </TD>
                <TD className="text-ink-muted">{formatDate(row.created_at)}</TD>
                <TD>
                  <ButtonLink
                    href={`${manageBasePath}/${row.recruiter_user_id}`}
                    variant="secondary"
                    size="sm"
                  >
                    Manage
                  </ButtonLink>
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}

      <p className="mt-4 text-xs text-ink-subtle">
        Showing {filtered.length} of {assignments.length} assigned job
        {assignments.length === 1 ? "" : "s"}. {tip ? <>{tip} </> : null}
        <Link href={jobsBasePath} className="text-brand-700 hover:underline">
          Open Jobs
        </Link>{" "}
        to assign newly approved roles.
      </p>
    </div>
  );
}
