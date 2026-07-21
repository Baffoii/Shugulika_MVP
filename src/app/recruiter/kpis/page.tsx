import { Suspense } from "react";
import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import {
  getRecruiterKPIs,
  getRecruiterAssignedRoles,
  getRecruiterCompanies,
  getMyRecruiterMeta,
  getCandidateQualityScore,
  getPlacementFunnel,
  getTimeToFillTrend,
  getAppsReviewedTrend,
  type KpiDateRange,
  type KpiScope,
} from "@/lib/data/recruiter-kpis";
import { Alert, PageHeader, Skeleton } from "@/components/ui/primitives";
import { KPICard } from "./components/KPICard";
import { TimeToFillChart } from "./components/TimeToFillChart";
import { FunnelChart } from "./components/FunnelChart";
import { QualityBreakdown } from "./components/QualityBreakdown";
import { RoleAssignmentTable } from "./components/RoleAssignmentTable";
import { AppsReviewedChart } from "./components/AppsReviewedChart";
import { KpiFilters } from "./components/KpiFilters";

export const metadata: Metadata = { title: "My KPIs" };

function parseRange(raw: string | string[] | undefined): KpiDateRange {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "week" || v === "quarter") return v;
  return "month";
}

function paramOne(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v || undefined;
}

export default async function RecruiterKpisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<
    string,
    string | string[] | undefined
  >;
}) {
  const ctx = await requirePortal("recruiter");
  const params = await Promise.resolve(searchParams);
  const range = parseRange(params.range);
  const roleId = paramOne(params.role);
  const companyId = paramOne(params.company);

  const scope: KpiScope = {
    jobRoleId: roleId,
    employerOrgId: companyId,
  };

  const meta = await getMyRecruiterMeta(ctx.userId);
  const [roles, companies] = await Promise.all([
    getRecruiterAssignedRoles(ctx.userId),
    getRecruiterCompanies(ctx.userId),
  ]);

  const selectedCompany = companies.find((c) => c.id === companyId);

  const [kpis, quality, funnel, ttfTrend, appsTrend] = await Promise.all([
    getRecruiterKPIs(ctx.userId, range, scope, meta.level, meta.organizationId ?? undefined),
    getCandidateQualityScore(ctx.userId, scope, range),
    getPlacementFunnel(ctx.userId, range, scope),
    getTimeToFillTrend(ctx.userId, scope),
    getAppsReviewedTrend(ctx.userId, scope),
  ]);

  const scopeBits = [
    meta.name,
    selectedCompany?.name,
    meta.regionCode,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        title="My KPIs"
        description={`${scopeBits.join(" · ")}${
          selectedCompany
            ? " — metrics scoped to this company only"
            : " — filter by company to avoid mixing employer pipelines"
        }`}
      />

      <Suspense fallback={<Skeleton className="mb-6 h-10 w-full max-w-xl" />}>
        <div className="mb-6">
          <KpiFilters
            range={range}
            roleId={roleId}
            roles={roles}
            companyId={companyId}
            companies={companies}
          />
        </div>
      </Suspense>

      {!companyId && companies.length > 1 ? (
        <div className="mb-4">
          <Alert tone="info" title="Tip: filter by company">
            Different employers can have very different applicant volumes. Pick a company above so
            time-to-fill, placement rate, and funnel metrics stay comparable.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KPICard
          label="Time to fill"
          value={kpis.sampleSizes.hired === 0 ? "—" : kpis.timeToFill}
          unit={kpis.sampleSizes.hired === 0 ? undefined : "days"}
          targetLabel={`≤ ${kpis.targets.timeToFillDays} days`}
          status={kpis.comparedToTarget.timeToFill}
          hint={`${kpis.sampleSizes.hired} hired in range`}
        />
        <KPICard
          label="Placement rate"
          value={kpis.sampleSizes.applied === 0 ? "—" : kpis.placementRate}
          unit={kpis.sampleSizes.applied === 0 ? undefined : "%"}
          targetLabel={`≥ ${kpis.targets.placementRatePct}%`}
          status={kpis.comparedToTarget.placementRate}
          hint={`${kpis.sampleSizes.hired} / ${kpis.sampleSizes.applied} hired`}
        />
        <KPICard
          label="Candidate quality"
          value={Math.round(kpis.candidateQualityScore)}
          unit="/100"
          targetLabel={`≥ ${kpis.targets.minAptitudeTestScore}`}
          status={kpis.comparedToTarget.candidateQuality}
        />
        <KPICard
          label="Apps reviewed / week"
          value={kpis.applicationsReviewedPerWeek}
          targetLabel={`${kpis.targets.appsReviewedPerWeek} / week`}
          status={kpis.comparedToTarget.applicationsReviewedPerWeek}
          progressPct={
            (kpis.applicationsReviewedPerWeek / Math.max(1, kpis.targets.appsReviewedPerWeek)) * 100
          }
        />
        <KPICard
          label="Offer → hire"
          value={kpis.sampleSizes.offers === 0 ? "—" : kpis.offerToHireRatio}
          unit={kpis.sampleSizes.offers === 0 ? undefined : "%"}
          targetLabel={`≥ ${kpis.targets.offerToHireRatioPct}%`}
          status={kpis.comparedToTarget.offerToHireRatio}
          hint={`${kpis.sampleSizes.acceptedOffers} hired / ${kpis.sampleSizes.offers} offers`}
        />
      </div>

      <div className="mt-6">
        <label className="flex cursor-not-allowed items-center gap-2 text-sm text-ink-subtle opacity-70">
          <input type="checkbox" disabled className="rounded border-surface-border" />
          Compare to other recruiters
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">Coming in Phase 2</span>
        </label>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TimeToFillChart data={ttfTrend} />
        <FunnelChart data={funnel} />
        <QualityBreakdown quality={quality} />
        <AppsReviewedChart data={appsTrend} />
      </div>

      <div className="mt-6">
        <RoleAssignmentTable roles={roles} />
      </div>

      {roles.length === 0 ? (
        <div className="mt-4">
          <Alert tone="warn" title="No sourcing roles assigned">
            Your KPIs may be empty until an admin assigns job roles to your account.
          </Alert>
        </div>
      ) : null}
    </div>
  );
}
