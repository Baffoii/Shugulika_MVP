import type { Metadata } from "next";
import { requirePortal, memberOrgIds } from "@/lib/auth";
import { canAssignRecruiterRoles, assignableRegionCodes } from "@/lib/rbac";
import { getRecruitersWithRoles } from "@/lib/data/recruiter-kpis";
import { PageHeader, Badge, ButtonLink } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Recruiters" };

export default async function FranchiseRecruitersPage() {
  const ctx = await requirePortal("franchise");
  if (!canAssignRecruiterRoles(ctx.roles)) {
    redirect("/unauthorized");
  }

  const regions = assignableRegionCodes(ctx.roles, ctx.memberships) ?? [];
  const orgIds = memberOrgIds(ctx.memberships);

  const recruiters = await getRecruitersWithRoles({
    organizationId: orgIds[0],
    regionCode: regions[0],
  });

  return (
    <div>
      <PageHeader
        title="Recruiters"
        description="Recruiters in your franchise, their assigned sourcing roles, and KPI summaries."
      />

      {recruiters.length === 0 ? (
        <p className="text-sm text-ink-muted">No recruiters found in your region.</p>
      ) : (
        <DataTable>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Level</TH>
              <TH>Region</TH>
              <TH>Roles</TH>
              <TH>Time to fill</TH>
              <TH>Placement</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <tbody>
            {recruiters.map((r) => (
              <TR key={r.recruiterId}>
                <TD>
                  <div className="font-medium text-ink">{r.name}</div>
                  <div className="text-xs text-ink-subtle">{r.email}</div>
                </TD>
                <TD>
                  <Badge tone="neutral">{r.level}</Badge>
                </TD>
                <TD>{r.regionCode ?? "—"}</TD>
                <TD>{r.assignedRoles.length}</TD>
                <TD>{r.kpisSummary.timeToFill > 0 ? `${r.kpisSummary.timeToFill}d` : "—"}</TD>
                <TD>{r.kpisSummary.placementRate > 0 ? `${r.kpisSummary.placementRate}%` : "—"}</TD>
                <TD>
                  <ButtonLink
                    href={`/franchise/recruiters/${r.recruiterId}`}
                    variant="secondary"
                    size="sm"
                  >
                    Edit roles
                  </ButtonLink>
                </TD>
              </TR>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
