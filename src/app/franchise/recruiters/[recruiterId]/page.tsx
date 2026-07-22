import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePortal } from "@/lib/auth";
import { canAssignRecruiterRoles, assignableRegionCodes, canAssignInRegion } from "@/lib/rbac";
import {
  getRecruiterProfile,
  getRecruiterAssignedRoles,
  listJobRoles,
} from "@/lib/data/recruiter-kpis";
import {
  getJobsOwnedByRecruiter,
  getJobOrders,
  getJobOwnerAssignments,
  listRecruitersForOrgs,
} from "@/lib/data/staff";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { AssignRolesPanel } from "@/components/recruiters/AssignRolesPanel";
import { AssignJobRecruiterControl } from "@/components/jobs/AssignJobRecruiterControl";
import { formatDate } from "@/lib/format";
import type { CountryRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Manage recruiter jobs" };

const OPEN_STATUSES = new Set(["approved", "active", "on_hold"]);

export default async function AssignRecruiterJobsPage({
  params,
}: {
  params: Promise<{ recruiterId: string }> | { recruiterId: string };
}) {
  const ctx = await requirePortal("franchise");
  if (!canAssignRecruiterRoles(ctx.roles)) redirect("/unauthorized");

  const { recruiterId } = await Promise.resolve(params);
  const profile = await getRecruiterProfile(recruiterId);
  if (!profile) notFound();

  if (profile.regionCode && !canAssignInRegion(ctx.roles, ctx.memberships, profile.regionCode)) {
    redirect("/unauthorized");
  }

  const [ownedJobs, allJobs, roleAssignments, jobRoles] = await Promise.all([
    getJobsOwnedByRecruiter(recruiterId),
    getJobOrders(),
    getRecruiterAssignedRoles(recruiterId),
    listJobRoles(),
  ]);

  const openJobs = allJobs.filter((job) => OPEN_STATUSES.has(job.status));
  const franchiseOpenJobs = openJobs.filter(
    (job) => job.responsible_org_id === profile.organizationId,
  );
  const [owners, recruiters] = await Promise.all([
    getJobOwnerAssignments(franchiseOpenJobs.map((job) => job.id)),
    listRecruitersForOrgs(profile.organizationId ? [profile.organizationId] : []),
  ]);
  const ownerByJob = new Map(owners.map((owner) => [owner.job_order_id, owner]));
  const unassignedJobs = franchiseOpenJobs.filter((job) => !ownerByJob.has(job.id));
  const supabase = createClient();
  const { data: countries } = await supabase
    .from("countries")
    .select("code,name")
    .eq("is_active", true)
    .order("sort_order");

  const allCountries = ((countries as Pick<CountryRow, "code" | "name">[] | null) ?? []).map(
    (c) => ({ code: c.code, name: c.name }),
  );
  const allowed = assignableRegionCodes(ctx.roles, ctx.memberships);
  const regions = allCountries.filter((c) => (allowed ?? []).includes(c.code));
  const defaultRegion =
    profile.regionCode && regions.some((r) => r.code === profile.regionCode)
      ? profile.regionCode
      : (regions[0]?.code ?? "TZ");

  return (
    <div>
      <PageHeader
        title={profile.name}
        description={`${profile.email} · hand over owned jobs or assign open roles from this recruiter’s franchise.`}
        actions={
          <ButtonLink href="/franchise/recruiters" variant="outline" size="sm">
            Back to assignments
          </ButtonLink>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Badge tone="brand">Level: {profile.level}</Badge>
        <Badge tone="neutral">Region: {profile.regionCode ?? "—"}</Badge>
        <Badge tone="info">Franchise scope</Badge>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Jobs owned ({ownedJobs.length})</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {ownedJobs.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">
              No jobs assigned yet. Use Jobs after approval, or assign an open role below.
            </p>
          ) : (
            <DataTable className="rounded-none border-0 shadow-none">
              <THead>
                <TR>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH>Reassign</TH>
                </TR>
              </THead>
              <tbody>
                {ownedJobs.map((job) => (
                  <TR key={job.id}>
                    <TD className="font-medium text-ink">{job.title}</TD>
                    <TD>
                      <StatusBadge status={job.status} />
                    </TD>
                    <TD className="text-ink-muted">{formatDate(job.created_at)}</TD>
                    <TD>
                      {OPEN_STATUSES.has(job.status) ? (
                        <AssignJobRecruiterControl
                          jobOrderId={job.id}
                          responsibleOrgId={job.responsible_org_id}
                          currentRecruiterId={recruiterId}
                          currentRecruiterName={profile.name}
                          recruiters={recruiters}
                        />
                      ) : (
                        <span className="text-xs text-ink-muted">Closed</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Assign an open job</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {unassignedJobs.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">
              No unassigned open jobs in this recruiter&apos;s franchise right now.
            </p>
          ) : (
            <DataTable className="rounded-none border-0 shadow-none">
              <THead>
                <TR>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH>Assign</TH>
                </TR>
              </THead>
              <tbody>
                {unassignedJobs.map((job) => (
                  <TR key={job.id}>
                    <TD className="font-medium text-ink">{job.title}</TD>
                    <TD>
                      <StatusBadge status={job.status} />
                    </TD>
                    <TD>
                      <AssignJobRecruiterControl
                        jobOrderId={job.id}
                        responsibleOrgId={job.responsible_org_id}
                        currentRecruiterId={null}
                        currentRecruiterName={null}
                        recruiters={recruiters}
                        preferredRecruiterId={recruiterId}
                      />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </DataTable>
          )}
        </CardBody>
      </Card>

      <details className="mb-6">
        <summary className="cursor-pointer text-sm font-medium text-brand-700">
          Sourcing specialties (KPI roles)
        </summary>
        <div className="mt-3">
          <AssignRolesPanel
            recruiterId={profile.id}
            recruiterName={profile.name}
            currentAssignments={roleAssignments}
            availableRoles={jobRoles}
            defaultRegion={defaultRegion}
            regionLocked
            regions={regions.length ? regions : [{ code: "TZ", name: "Tanzania" }]}
          />
        </div>
      </details>
    </div>
  );
}
