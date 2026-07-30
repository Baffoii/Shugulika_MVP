import { Suspense } from "react";
import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import {
  getRecruiterKPIs,
  getRecruiterAssignedRoles,
  getRecruiterCompanies,
  getMyRecruiterMeta,
  getTimeToFillTrend,
  getAppsReviewedTrend,
  type KpiPeriod,
  type KpiScope,
} from "@/lib/data/recruiter-kpis";
import { RECRUITER_LEVEL_LABELS } from "@/lib/rbac";
import { Alert, PageHeader, Skeleton } from "@/components/ui/primitives";
import { KPICard, metricDisplay, sampleLine } from "./components/KPICard";
import { TimeToFillChart } from "./components/TimeToFillChart";
import { AppsReviewedChart } from "./components/AppsReviewedChart";
import { RoleAssignmentTable } from "./components/RoleAssignmentTable";
import { KpiFilters } from "./components/KpiFilters";
import { SlaQueuePanel } from "./components/SlaQueuePanel";
import { WorkloadByStage } from "./components/WorkloadByStage";
import { RejectionBreakdown } from "./components/RejectionBreakdown";
import { StageFunnel } from "./components/StageFunnel";
import { Card } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "My KPIs" };

function parsePeriod(raw: string | string[] | undefined): KpiPeriod {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "week" || v === "7d") return "7d";
  if (v === "quarter" || v === "90d") return "90d";
  if (v === "ytd") return "ytd";
  if (v === "custom") return "custom";
  if (v === "month" || v === "30d") return "30d";
  return "30d";
}

function paramOne(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v || undefined;
}

export default async function RecruiterKpisPage({
  searchParams,
}: {
  searchParams:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const ctx = await requirePortal("recruiter");
  const params = await Promise.resolve(searchParams);
  const range = parsePeriod(params.range);
  const roleId = paramOne(params.role);
  const companyId = paramOne(params.company);
  const from = paramOne(params.from);
  const to = paramOne(params.to);

  const scope: KpiScope = {
    jobRoleId: roleId,
    employerOrgId: companyId,
  };

  const customWindow =
    range === "custom" && from && to
      ? {
          since: new Date(`${from}T00:00:00.000Z`).toISOString(),
          until: new Date(`${to}T23:59:59.999Z`).toISOString(),
        }
      : undefined;

  const meta = await getMyRecruiterMeta(ctx.userId);
  const [roles, companies] = await Promise.all([
    getRecruiterAssignedRoles(ctx.userId),
    getRecruiterCompanies(ctx.userId),
  ]);

  const selectedCompany = companies.find((c) => c.id === companyId);

  const [kpis, ttfTrend, appsTrend] = await Promise.all([
    getRecruiterKPIs(
      ctx.userId,
      range,
      scope,
      meta.level,
      meta.organizationId ?? undefined,
      customWindow,
    ),
    getTimeToFillTrend(ctx.userId, scope),
    getAppsReviewedTrend(ctx.userId, scope),
  ]);

  const t = kpis.targets;
  const scopeBits = [
    meta.name,
    RECRUITER_LEVEL_LABELS[meta.level],
    selectedCompany?.name,
    meta.regionCode,
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        title="My KPIs"
        description={`${scopeBits.join(" · ")} · targets from ${t.source}${
          selectedCompany ? " — company-scoped" : ""
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
            Different employers can have very different volumes. Pick a company to avoid mixing
            pipelines.
          </Alert>
        </div>
      ) : null}

      {roles.length === 0 ? (
        <div className="mb-4">
          <Alert tone="warn" title="No sourcing roles assigned">
            KPIs still use applications assigned to you. Ask your franchise admin to assign job
            roles if you need role filters.
          </Alert>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KPICard
          label="Applications reviewed"
          value={metricDisplay(kpis.applicationsReviewed.value)}
          status={kpis.applicationsReviewed.sampleSize > 0 ? "on_target" : "insufficient_data"}
          sampleLabel={
            kpis.applicationsReviewed.sampleSize > 0
              ? `${kpis.applicationsReviewed.numerator} distinct applications`
              : "Not enough data"
          }
          definition="Distinct applications with a meaningful review action by you in the period (advance, reject, assessment/interview review)."
        />
        <KPICard
          label="Active workload"
          value={metricDisplay(kpis.activeWorkload.total)}
          targetLabel={`≤ ${t.maxActiveWorkload}`}
          status={kpis.activeWorkload.status}
          definition="Assigned applications that are not terminal, withdrawn, or on a closed/cancelled job."
        />
        <KPICard
          label="Time to first review"
          value={kpis.timeToFirstReview.display}
          targetLabel={`≤ ${t.maxTimeToFirstReviewHours}h`}
          status={kpis.timeToFirstReview.status}
          sampleLabel={
            kpis.timeToFirstReview.sampleSize > 0
              ? `Median of ${kpis.timeToFirstReview.sampleSize} · awaiting ${kpis.timeToFirstReview.awaitingFirstReview}`
              : `Awaiting first review: ${kpis.timeToFirstReview.awaitingFirstReview}`
          }
          definition="Median hours from application created_at to your first meaningful review. Excludes never-reviewed apps from the median."
        />
        <KPICard
          label="Time to client submission"
          value={kpis.timeToClientSubmission.display}
          targetLabel={`≤ ${t.maxTimeToClientSubmissionDays}d`}
          status={kpis.timeToClientSubmission.status}
          sampleLabel={sampleLine(
            kpis.timeToClientSubmission.numerator,
            kpis.timeToClientSubmission.denominator,
            "reached CS",
          )}
          definition="Median days from application created_at to first client_submission stage entry (actor-attributed)."
        />
        <KPICard
          label="Time to fill"
          value={kpis.timeToFill.display}
          targetLabel={`≤ ${t.timeToFillDays}d`}
          status={kpis.timeToFill.status}
          sampleLabel={
            kpis.timeToFill.unavailableReason ??
            sampleLine(kpis.timeToFill.numerator, kpis.timeToFill.denominator, "placements")
          }
          hint="jobs.published_at → placements.created_at"
          definition="Median days from job published_at to placement created_at. Unfilled jobs are excluded."
        />
        <KPICard
          label="CV review conversion"
          value={metricDisplay(kpis.cvReviewConversion.value, { pct: true })}
          status={kpis.cvReviewConversion.value == null ? "insufficient_data" : "on_target"}
          sampleLabel={sampleLine(
            kpis.cvReviewConversion.numerator,
            kpis.cvReviewConversion.denominator,
          )}
          definition="% of applications with a completed CV review that later reached testing or beyond."
        />
        <KPICard
          label="Testing pass rate"
          value={metricDisplay(kpis.testingPassRate.value, { pct: true })}
          status={kpis.testingPassRate.value == null ? "insufficient_data" : "on_target"}
          sampleLabel={sampleLine(
            kpis.testingPassRate.numerator,
            kpis.testingPassRate.denominator,
            "graded",
          )}
          definition="Graded assessments meeting pass_threshold. Excludes human-review-pending results."
        />
        <KPICard
          label="Interview conversion"
          value={metricDisplay(kpis.interviewConversion.value, { pct: true })}
          targetLabel={`≥ ${t.interviewConversionPct}%`}
          status={kpis.interviewConversion.status}
          sampleLabel={sampleLine(
            kpis.interviewConversion.numerator,
            kpis.interviewConversion.denominator,
          )}
          definition="% with completed interview review that later reached client submission, offer, or hired."
        />
        <KPICard
          label="Client submission acceptance"
          value={metricDisplay(kpis.clientSubmissionAcceptance.value, { pct: true })}
          targetLabel={`≥ ${t.clientSubmissionAcceptancePct}%`}
          status={kpis.clientSubmissionAcceptance.status}
          sampleLabel={sampleLine(
            kpis.clientSubmissionAcceptance.numerator,
            kpis.clientSubmissionAcceptance.denominator,
            "decided",
          )}
          definition="Accepted = shortlisted, interview_requested, or offered."
        />
        <KPICard
          label="Offer → hire"
          value={metricDisplay(kpis.offerToHire.value, { pct: true })}
          targetLabel={`≥ ${t.offerToHireRatioPct}%`}
          status={kpis.offerToHire.status}
          sampleLabel={
            kpis.offerToHire.unavailableReason ??
            sampleLine(kpis.offerToHire.numerator, kpis.offerToHire.denominator, "finalized offers")
          }
          definition="Accepted offers with a valid placement ÷ finalized offers. Never inferred from Hired stage alone."
        />
        <KPICard
          label="Placement rate"
          value={metricDisplay(kpis.placementRate.value, { pct: true })}
          targetLabel={`≥ ${t.placementRatePct}%`}
          status={kpis.placementRate.status}
          sampleLabel={sampleLine(
            kpis.placementRate.numerator,
            kpis.placementRate.denominator,
            "reached CS",
          )}
          definition="% of applications that reached client submission and later have a valid placement."
        />
        <KPICard
          label="Withdrawal rate"
          value={metricDisplay(kpis.withdrawalRate.value, { pct: true })}
          status={kpis.withdrawalRate.value == null ? "insufficient_data" : "on_target"}
          sampleLabel={sampleLine(
            kpis.withdrawalRate.numerator,
            kpis.withdrawalRate.denominator,
            "withdrawn / assigned",
          )}
          definition="Candidate withdrawals on your assigned applications in the period."
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <StageFunnel funnel={kpis.funnel} />
        <WorkloadByStage byStage={kpis.activeWorkload.byStage} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">Median time in stage</h2>
          {Object.keys(kpis.timeInStage).length === 0 ? (
            <p className="text-sm text-ink-muted">No completed stage transitions in this period.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.entries(kpis.timeInStage)
                .sort((a, b) => (b[1].value ?? 0) - (a[1].value ?? 0))
                .map(([stage, m]) => (
                  <li key={stage} className="flex justify-between gap-2">
                    <span className="capitalize text-ink">{stage.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-ink-muted">
                      {m.value == null ? "—" : `${m.value}h`}
                      <span className="ml-2 text-xs">(n={m.sampleSize})</span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-subtle">
            Stalled vs threshold:{" "}
            {Object.entries(
              Object.fromEntries(Object.entries(kpis.sla).filter(([k]) => k === "stalledInStage")),
            ).length >= 0
              ? kpis.sla.stalledInStage
              : 0}{" "}
            applications (target max {t.maxStalledApplicationCount}).
          </p>
        </Card>
        <RejectionBreakdown rejections={kpis.rejections} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <SlaQueuePanel sla={kpis.sla} />
        <div className="space-y-4">
          <TimeToFillChart data={ttfTrend} />
          <AppsReviewedChart data={appsTrend} />
        </div>
      </div>

      <RoleAssignmentTable roles={roles} />
    </div>
  );
}
