import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import { canAssignRecruiterRoles, assignableRegionCodes, isHqAdmin } from "@/lib/rbac";
import { getRecruitersWithRoles } from "@/lib/data/recruiter-kpis";
import { memberOrgIds } from "@/lib/auth";
import { PageHeader, Badge, ButtonLink } from "@/components/ui/primitives";
import { DataTable, THead, TH, TR, TD } from "@/components/ui/table";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Recruiters" };

export default async function HqRecruitersPage() {
  const ctx = await requirePortal("hq");
  if (!canAssignRecruiterRoles(ctx.roles)) redirect("/unauthorized");

  const regionFilter = isHqAdmin(ctx.roles)
    ? undefined
    : (assignableRegionCodes(ctx.roles, ctx.memberships)?.[0] ?? undefined);

  const orgIds = memberOrgIds(ctx.memberships);
  const recruiters = await getRecruitersWithRoles({
    regionCode: regionFilter,
    // HQ sees all; others scoped by first org if needed
    organizationId: isHqAdmin(ctx.roles) ? undefined : orgIds[0],
  });

  return (
    <div>
      <PageHeader
        title="Recruiters"
        description="Assign sourcing roles and review KPI summaries across the network."
      />

      {recruiters.length === 0 ? (
        <p className="text-sm text-ink-muted">No recruiters found for your scope.</p>
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
                    href={`/hq/recruiters/${r.recruiterId}`}
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

      <p className="mt-4 text-xs text-ink-subtle">
        Tip: open a recruiter to assign or revoke job roles. Region-locked admins can only manage
        their country.
      </p>
      <p className="mt-1 text-xs text-ink-subtle">
        <Link href="/hq/users" className="text-brand-700 hover:underline">
          Users & roles
        </Link>{" "}
        remains the place for membership provisioning.
      </p>
    </div>
  );
}
