import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePortal } from "@/lib/auth";
import {
  canAssignRecruiterRoles,
  assignableRegionCodes,
  isHqAdmin,
  canAssignInRegion,
} from "@/lib/rbac";
import {
  getRecruiterProfile,
  getRecruiterAssignedRoles,
  listJobRoles,
} from "@/lib/data/recruiter-kpis";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Badge, ButtonLink } from "@/components/ui/primitives";
import { AssignRolesPanel } from "@/components/recruiters/AssignRolesPanel";
import type { CountryRow } from "@/lib/database.types";

export const metadata: Metadata = { title: "Assign recruiter roles" };

export default async function AssignRecruiterRolesPage({
  params,
}: {
  params: Promise<{ recruiterId: string }> | { recruiterId: string };
}) {
  const ctx = await requirePortal("hq");
  if (!canAssignRecruiterRoles(ctx.roles)) redirect("/unauthorized");

  const { recruiterId } = await Promise.resolve(params);
  const profile = await getRecruiterProfile(recruiterId);
  if (!profile) notFound();

  // Region-locked admins may only manage recruiters in their region
  if (profile.regionCode && !canAssignInRegion(ctx.roles, ctx.memberships, profile.regionCode)) {
    redirect("/unauthorized");
  }

  const [assignments, jobRoles] = await Promise.all([
    getRecruiterAssignedRoles(recruiterId),
    listJobRoles(),
  ]);

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
  const regions =
    allowed === null ? allCountries : allCountries.filter((c) => allowed.includes(c.code));

  const defaultRegion =
    profile.regionCode && regions.some((r) => r.code === profile.regionCode)
      ? profile.regionCode
      : (regions[0]?.code ?? "TZ");

  return (
    <div>
      <PageHeader
        title={`Assign roles · ${profile.name}`}
        description={`${profile.email} · ${profile.organizationName ?? "No org"}`}
        actions={
          <ButtonLink href="/hq/recruiters" variant="outline" size="sm">
            Back to list
          </ButtonLink>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        <Badge tone="brand">Level: {profile.level}</Badge>
        <Badge tone="neutral">Region: {profile.regionCode ?? "—"}</Badge>
        {isHqAdmin(ctx.roles) ? <Badge tone="info">HQ — any region</Badge> : null}
      </div>

      <AssignRolesPanel
        recruiterId={profile.id}
        recruiterName={profile.name}
        currentAssignments={assignments}
        availableRoles={jobRoles}
        defaultRegion={defaultRegion}
        regionLocked={!isHqAdmin(ctx.roles)}
        regions={regions.length ? regions : [{ code: "TZ", name: "Tanzania" }]}
      />
    </div>
  );
}
