import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePortal, memberOrgIds } from "@/lib/auth";
import { canAssignRecruiterRoles, assignableRegionCodes } from "@/lib/rbac";
import { getRecruitersWithRoles } from "@/lib/data/recruiter-kpis";
import { listOwnedJobAssignments } from "@/lib/data/staff";
import { createClient } from "@/lib/supabase/server";
import { AssignmentsOverview } from "@/components/recruiters/AssignmentsOverview";
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
  const orgIds = memberOrgIds(ctx.memberships);

  const [recruiters, assignments, countriesResult] = await Promise.all([
    getRecruitersWithRoles({
      organizationId: orgIds[0],
      regionCode: allowedRegions[0],
    }),
    listOwnedJobAssignments(),
    createClient().from("countries").select("code,name").eq("is_active", true).order("sort_order"),
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
  );
}
