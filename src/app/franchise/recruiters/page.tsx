import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePortal, franchiseOrgId } from "@/lib/auth";
import { canAssignRecruiterRoles, assignableRegionCodes } from "@/lib/rbac";
import { getFranchiseKpiDashboard, getRecruitersWithRoles } from "@/lib/data/recruiter-kpis";
import { listOwnedJobAssignments } from "@/lib/data/staff";
import { createClient } from "@/lib/supabase/server";
import { AssignmentsOverview } from "@/components/recruiters/AssignmentsOverview";
import { RecruiterKpiCards } from "@/components/kpis/RecruiterKpiCards";
import { Alert, ButtonLink } from "@/components/ui/primitives";
import type { CountryRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Assignments" };

export default async function FranchiseRecruitersPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const ctx = await requirePortal("franchise");
  if (!canAssignRecruiterRoles(ctx.roles)) redirect("/unauthorized");

  const params = await Promise.resolve(searchParams ?? {});
  const recruiterFilter = typeof params.recruiter === "string" ? params.recruiter : undefined;
  const regionFilter = typeof params.region === "string" ? params.region : undefined;

  const allowedRegions = assignableRegionCodes(ctx.roles, ctx.memberships) ?? [];
  const orgId = franchiseOrgId(ctx.memberships);

  const [recruiters, assignments, countriesResult, dash] = await Promise.all([
    getRecruitersWithRoles({
      organizationId: orgId ?? undefined,
      // Do not force regionCode here — recruiters may have null country_code and
      // still belong to Dar es Salaam franchise. Region is a UI filter only.
    }),
    listOwnedJobAssignments(),
    createClient().from("countries").select("code,name").eq("is_active", true).order("sort_order"),
    orgId ? getFranchiseKpiDashboard(orgId, "30d") : Promise.resolve(null),
  ]);

  const countries = (
    (countriesResult.data as Pick<CountryRow, "code" | "name">[] | null) ?? []
  ).map((c) => ({ code: c.code, name: c.name }));
  const regions = countries.filter((c) => allowedRegions.includes(c.code));

  const scopedRecruiterIds = new Set(recruiters.map((r) => r.recruiterId));
  const scopedAssignments = assignments.filter((row) =>
    scopedRecruiterIds.has(row.recruiter_user_id),
  );

  return (
    <div>
      {dash ? (
        <div className="mb-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Recruiter KPIs (last 30 days)</h2>
              <p className="text-sm text-ink-muted">
                Compare performance across {dash.recruiterHeadcount} recruiter
                {dash.recruiterHeadcount === 1 ? "" : "s"} in your franchise.
              </p>
            </div>
            <ButtonLink href="/franchise/reports" variant="secondary" size="sm">
              Open full reports
            </ButtonLink>
          </div>
          {dash.recruiters.length === 0 ? (
            <Alert tone="warn" title="No recruiter KPI rows">
              No active recruiter memberships were found for this franchise organization.
            </Alert>
          ) : (
            <RecruiterKpiCards rows={dash.recruiters} manageBasePath="/franchise/recruiters" />
          )}
          <p className="mt-3 text-xs text-ink-subtle">
            Full funnel, medians, targets, and sortable table:{" "}
            <Link href="/franchise/reports" className="text-brand-700 hover:underline">
              Franchise reports
            </Link>
            .
          </p>
        </div>
      ) : null}

      <AssignmentsOverview
        title="Assignments"
        description="Jobs owned by recruiters in your franchise. Filter by person or region, then open Manage to hand work over."
        manageBasePath="/franchise/recruiters"
        jobsBasePath="/franchise/jobs"
        assignments={scopedAssignments}
        recruiterFilter={recruiterFilter}
        regionFilter={regionFilter}
        recruiters={recruiters.map((r) => ({ id: r.recruiterId, name: r.name }))}
        regions={regions.length ? regions : allowedRegions.map((code) => ({ code, name: code }))}
        tip={null}
      />
    </div>
  );
}
