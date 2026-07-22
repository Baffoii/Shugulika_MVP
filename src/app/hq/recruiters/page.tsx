import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePortal, memberOrgIds } from "@/lib/auth";
import { canAssignRecruiterRoles, assignableRegionCodes, isHqAdmin } from "@/lib/rbac";
import { getRecruitersWithRoles } from "@/lib/data/recruiter-kpis";
import { listOwnedJobAssignments } from "@/lib/data/staff";
import { createClient } from "@/lib/supabase/server";
import { AssignmentsOverview } from "@/components/recruiters/AssignmentsOverview";
import type { CountryRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Assignments" };

export default async function HqRecruitersPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const ctx = await requirePortal("hq");
  if (!canAssignRecruiterRoles(ctx.roles)) redirect("/unauthorized");

  const params = await Promise.resolve(searchParams ?? {});
  const recruiterFilter = typeof params.recruiter === "string" ? params.recruiter : undefined;
  const regionFilter = typeof params.region === "string" ? params.region : undefined;

  const scopeRegion = isHqAdmin(ctx.roles)
    ? undefined
    : (assignableRegionCodes(ctx.roles, ctx.memberships)?.[0] ?? undefined);
  const orgIds = memberOrgIds(ctx.memberships);

  const [recruiters, assignments, countriesResult] = await Promise.all([
    getRecruitersWithRoles({
      regionCode: scopeRegion,
      organizationId: isHqAdmin(ctx.roles) ? undefined : orgIds[0],
    }),
    listOwnedJobAssignments(),
    createClient().from("countries").select("code,name").eq("is_active", true).order("sort_order"),
  ]);

  const countries = (
    (countriesResult.data as Pick<CountryRow, "code" | "name">[] | null) ?? []
  ).map((c) => ({ code: c.code, name: c.name }));
  const allowed = assignableRegionCodes(ctx.roles, ctx.memberships);
  const regions = allowed === null ? countries : countries.filter((c) => allowed.includes(c.code));

  const scopedRecruiterIds = new Set(recruiters.map((r) => r.recruiterId));
  const scopedAssignments = assignments.filter((row) =>
    scopedRecruiterIds.has(row.recruiter_user_id),
  );

  return (
    <AssignmentsOverview
      title="Assignments"
      description="All jobs currently owned by recruiters. Filter by person or region, then open Manage to hand work over."
      manageBasePath="/hq/recruiters"
      jobsBasePath="/hq/jobs"
      assignments={scopedAssignments}
      recruiterFilter={recruiterFilter}
      regionFilter={regionFilter}
      recruiters={recruiters.map((r) => ({ id: r.recruiterId, name: r.name }))}
      regions={regions.length ? regions : [{ code: "TZ", name: "Tanzania" }]}
      tip={
        <>
          <Link href="/hq/users" className="text-brand-700 hover:underline">
            Users & roles
          </Link>{" "}
          is only for creating login accounts.
        </>
      }
    />
  );
}
