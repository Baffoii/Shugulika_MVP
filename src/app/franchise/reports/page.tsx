import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePortal, franchiseOrgId } from "@/lib/auth";
import {
  getFranchiseKpiDashboard,
  listKpiTargets,
} from "@/lib/data/recruiter-kpis";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  Skeleton,
  Alert,
  ButtonLink,
} from "@/components/ui/primitives";
import { RecruiterComparisonTable } from "@/components/kpis/RecruiterComparisonTable";
import { RecruiterKpiCards } from "@/components/kpis/RecruiterKpiCards";
import { KpiTargetsForm } from "@/components/kpis/KpiTargetsForm";
import { StageFunnel } from "@/app/recruiter/kpis/components/StageFunnel";
import { formatDurationHours } from "@/lib/kpi/definitions";
import { saveFranchiseKpiTargetsAction } from "./actions";
import { FranchisePeriodBar } from "@/components/franchise/FranchisePeriodBar";
import { FranchiseTargetHistoryPanel } from "@/components/franchise/FranchiseTargetHistoryPanel";
import { FranchiseFinanceAttributionGate } from "@/components/franchise/FranchiseEmployerHealthPanel";
import {
  franchiseGrainToKpiPeriod,
  parseFranchisePeriodGrain,
  parseFranchiseSort,
} from "@/lib/franchise/period";
import {
  isFranchiseFinanceAttributionEnabled,
  listFranchiseKpiTargetHistory,
} from "@/lib/data/franchise-ops";

export const metadata: Metadata = { title: "Reports" };

export default async function FranchiseReportsPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const ctx = await requirePortal("franchise");
  const params = await Promise.resolve(searchParams ?? {});
  const grain = parseFranchisePeriodGrain(params.range);
  const sort = parseFranchiseSort(params.sort);
  const range = franchiseGrainToKpiPeriod(grain);
  const orgId = franchiseOrgId(ctx.memberships);

  if (!orgId) {
    return (
      <div>
        <PageHeader
          title="Reports"
          description="Your account is not linked to a franchise organization."
        />
      </div>
    );
  }

  const supabase = createClient();
  const [{ data: org }, dash, targets, platformTargets, history, financeEnabled] =
    await Promise.all([
      supabase.from("organizations").select("name,country_code").eq("id", orgId).maybeSingle(),
      getFranchiseKpiDashboard(orgId, range),
      listKpiTargets(orgId),
      listKpiTargets(null),
      listFranchiseKpiTargetHistory(orgId),
      isFranchiseFinanceAttributionEnabled(),
    ]);

  const orgMeta = org as { name: string; country_code: string | null } | null;
  const franchiseLabel = orgMeta?.name ?? "Your franchise";
  const allTargets = [
    ...targets,
    ...platformTargets.filter((p) => !targets.some((t) => t.recruiter_level === p.recruiter_level)),
  ];

  // Alphabetical sort for recruiter cards when requested (local; does not edit shared KPI components).
  const recruiters =
    sort === "alpha_asc" || sort === "alpha_desc"
      ? [...dash.recruiters].sort((a, b) => {
          const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
          return sort === "alpha_desc" ? -cmp : cmp;
        })
      : dash.recruiters;

  return (
    <div>
      <PageHeader
        title="Franchise reports"
        description={`${franchiseLabel}${
          orgMeta?.country_code ? ` · ${orgMeta.country_code}` : ""
        } — compare recruiters in your franchise using the same KPI definitions as My KPIs.`}
      />

      <Suspense fallback={<Skeleton className="mb-6 h-10 w-64" />}>
        <FranchisePeriodBar grain={grain} sort={sort} />
      </Suspense>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Recruiter comparison</h2>
          <p className="text-sm text-ink-muted">
            {dash.recruiterHeadcount} active recruiter
            {dash.recruiterHeadcount === 1 ? "" : "s"} · drill into{" "}
            <Link href="/franchise/capacity" className="font-medium text-brand-700 hover:underline">
              capacity
            </Link>
            ,{" "}
            <Link
              href="/franchise/employers/health"
              className="font-medium text-brand-700 hover:underline"
            >
              employer health
            </Link>
            , or{" "}
            <Link
              href="/franchise/employer-applications"
              className="font-medium text-brand-700 hover:underline"
            >
              employer applications
            </Link>
          </p>
        </div>
        <ButtonLink href="/franchise/recruiters" variant="secondary" size="sm">
          Manage assignments
        </ButtonLink>
      </div>

      {recruiters.length === 0 ? (
        <div className="mb-6">
          <Alert tone="warn" title="No recruiters found for this franchise">
            Confirm recruiters have an active <code>recruiter</code> membership on{" "}
            <strong>{franchiseLabel}</strong>. Job ownership alone is not enough for this
            comparison.
          </Alert>
        </div>
      ) : null}

      <div className="mb-6">
        <RecruiterKpiCards rows={recruiters} manageBasePath="/franchise/recruiters" />
      </div>

      <div className="mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Detailed comparison table</CardTitle>
          </CardHeader>
          <RecruiterComparisonTable rows={recruiters} manageBasePath="/franchise/recruiters" />
        </Card>
      </div>

      <h2 className="mb-3 text-base font-semibold text-ink">Franchise totals</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active jobs" value={dash.activeJobs} tone="brand" />
        <StatCard label="Active applications" value={dash.activeApplications} tone="info" />
        <StatCard label="Current placements" value={dash.currentPlacements} tone="success" />
        <StatCard
          label="Placement value"
          value={dash.placementValue == null ? "—" : Math.round(dash.placementValue)}
          tone="neutral"
        />
        <StatCard label="Open invoices" value={dash.openInvoices} tone="warn" />
        <StatCard label="Paid invoices" value={Math.round(dash.paidInvoiceTotal)} tone="success" />
        <StatCard
          label="Unpaid invoices"
          value={Math.round(dash.unpaidInvoiceTotal)}
          tone="orange"
        />
        <StatCard label="Recruiters" value={dash.recruiterHeadcount} tone="neutral" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <StageFunnel funnel={dash.funnel} />
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Franchise medians & rates</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between gap-2">
              <span>Time to first review</span>
              <span className="tabular-nums">
                {formatDurationHours(dash.medianTimeToFirstReviewHours)}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Time to client submission</span>
              <span className="tabular-nums">
                {dash.medianTimeToClientSubmissionDays == null
                  ? "—"
                  : `${dash.medianTimeToClientSubmissionDays}d`}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Time to fill</span>
              <span className="tabular-nums">
                {dash.medianTimeToFillDays == null ? "—" : `${dash.medianTimeToFillDays}d`}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Placement rate</span>
              <span className="tabular-nums">
                {dash.placementRate.value == null
                  ? "—"
                  : `${dash.placementRate.value}% (${dash.placementRate.numerator}/${dash.placementRate.denominator})`}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>CS acceptance</span>
              <span className="tabular-nums">
                {dash.clientSubmissionAcceptance.value == null
                  ? "—"
                  : `${dash.clientSubmissionAcceptance.value}% (${dash.clientSubmissionAcceptance.numerator}/${dash.clientSubmissionAcceptance.denominator})`}
              </span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Rejections (period)</span>
              <span className="tabular-nums">{dash.rejectionTotal}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span>Withdrawals (period)</span>
              <span className="tabular-nums">{dash.withdrawalTotal}</span>
            </li>
          </ul>
          <h3 className="mb-2 mt-4 text-xs font-medium uppercase text-ink-subtle">
            Stalled by stage
          </h3>
          {Object.keys(dash.stalledByStage).length === 0 ? (
            <p className="text-sm text-ink-muted">No stalled applications.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {Object.entries(dash.stalledByStage).map(([k, n]) => (
                <li key={k} className="flex justify-between">
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                  <span className="tabular-nums">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-ink">Finance attribution</h2>
        <FranchiseFinanceAttributionGate enabled={financeEnabled} />
      </div>

      <div className="mt-6">
        <KpiTargetsForm
          initial={allTargets}
          organizationId={orgId}
          sourceLabel={`franchise overrides (${franchiseLabel})`}
          saveAction={saveFranchiseKpiTargetsAction}
        />
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-ink">Target change history</h2>
        <FranchiseTargetHistoryPanel entries={history} />
      </div>
    </div>
  );
}
