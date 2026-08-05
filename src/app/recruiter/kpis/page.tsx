import { Suspense } from "react";
import type { Metadata } from "next";
import { requirePortal } from "@/lib/auth";
import {
  getMyRecruiterMeta,
  getRecruiterAttentionDashboard,
  getTimeToFillTrend,
  getAppsReviewedTrend,
  type KpiScope,
} from "@/lib/data/recruiter-kpis";
import { parseKpiFilters } from "@/lib/kpi/filters";
import { RECRUITER_LEVEL_LABELS } from "@/lib/rbac";
import { Alert, PageHeader, Skeleton, Card } from "@/components/ui/primitives";
import { KPICard, metricDisplay, sampleLine } from "./components/KPICard";
import { TimeToFillChart } from "./components/TimeToFillChart";
import { AppsReviewedChart } from "./components/AppsReviewedChart";
import { RoleAssignmentTable } from "./components/RoleAssignmentTable";
import { KpiFilters } from "./components/KpiFilters";
import { WorkloadByStage } from "./components/WorkloadByStage";
import { RejectionBreakdown } from "./components/RejectionBreakdown";
import { StageFunnel } from "./components/StageFunnel";
import { AttentionStrip } from "./components/AttentionStrip";
import { AttentionQueuePanel } from "./components/AttentionQueuePanel";
import { TargetProgressPanel } from "./components/TargetProgressPanel";
import { CxGuardrailsPanel } from "./components/CxGuardrailsPanel";
import { Drilldown } from "./components/Drilldown";
import { DRILLDOWN_LABELS } from "@/lib/kpi/drilldowns";

export const metadata: Metadata = { title: "My KPIs" };

export default async function RecruiterKpisPage({
  searchParams,
}: {
  searchParams:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const ctx = await requirePortal("recruiter");
  const params = await Promise.resolve(searchParams);
  // Filters come from the URL; ownership and organization come from the
  // session. A hand-edited query string can narrow this view, never widen it.
  const requested = parseKpiFilters(params);

  const meta = await getMyRecruiterMeta(ctx.userId);
  const dash = await getRecruiterAttentionDashboard({
    recruiterId: ctx.userId,
    filters: requested,
    recruiterLevel: meta.level,
    organizationId: meta.organizationId,
  });

  const { filters, kpis, queue, options, drilldowns } = dash;
  const t = kpis.targets;
  const scope: KpiScope = {
    jobRoleId: filters.roleId,
    employerOrgId: filters.employerOrgId,
  };
  const [ttfTrend, appsTrend] = await Promise.all([
    getTimeToFillTrend(ctx.userId, scope),
    getAppsReviewedTrend(ctx.userId, scope),
  ]);

  const selectedEmployer = options.employers.find((c) => c.id === filters.employerOrgId);
  const scopeBits = [
    meta.name,
    RECRUITER_LEVEL_LABELS[meta.level],
    selectedEmployer?.name,
    meta.regionCode,
  ].filter(Boolean);

  const dd = (key: keyof typeof DRILLDOWN_LABELS) => (
    <Drilldown label={DRILLDOWN_LABELS[key]} applicationIds={drilldowns[key] ?? []} />
  );

  return (
    <div>
      <PageHeader
        title="My KPIs"
        description={`${scopeBits.join(" · ")} · ${dash.window.label} · targets from ${t.source}`}
      />

      <Suspense fallback={<Skeleton className="mb-6 h-10 w-full max-w-xl" />}>
        <div className="mb-6">
          <KpiFilters
            filters={filters}
            roles={options.roles}
            companies={options.employers}
            jobs={options.jobs}
            stages={options.stages}
          />
        </div>
      </Suspense>

      {/* Attention first: what needs doing today, before any trend chart. */}
      <div className="mb-6">
        <AttentionStrip
          countsByKind={queue.countsByKind}
          overdueCountsByKind={queue.overdueCountsByKind}
          totalOverdue={queue.totalOverdue}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttentionQueuePanel queue={queue} viewerId={ctx.userId} selectedKind={filters.kind} />
        </div>
        <TargetProgressPanel
          rows={dash.progress}
          targetVersion={dash.targetVersion}
          targetVersionLabel={dash.targetVersionLabel}
          periodElapsedPct={dash.periodElapsedPct}
          periodLabel={dash.window.label}
        />
      </div>

      {options.roles.length === 0 ? (
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
        >
          {dd("applications_reviewed")}
        </KPICard>
        <KPICard
          label="Active workload"
          value={metricDisplay(kpis.activeWorkload.total)}
          targetLabel={`≤ ${t.maxActiveWorkload}`}
          status={kpis.activeWorkload.status}
          definition="Assigned applications that are not terminal, withdrawn, or on a closed/cancelled job."
        >
          {dd("active_workload")}
        </KPICard>
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
        >
          {dd("time_to_first_review")}
          {dd("awaiting_first_review")}
        </KPICard>
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
        >
          {dd("time_to_client_submission")}
        </KPICard>
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
        >
          {dd("time_to_fill")}
        </KPICard>
        <KPICard
          label="CV review conversion"
          value={metricDisplay(kpis.cvReviewConversion.value, { pct: true })}
          status={kpis.cvReviewConversion.value == null ? "insufficient_data" : "on_target"}
          sampleLabel={sampleLine(
            kpis.cvReviewConversion.numerator,
            kpis.cvReviewConversion.denominator,
          )}
          definition="% of applications with a completed CV review that later reached testing or beyond."
        >
          {dd("cv_review_conversion")}
          {dd("cv_review_conversion_advanced")}
        </KPICard>
        <KPICard
          label="Testing pass rate"
          value={metricDisplay(kpis.testingPassRate.value, { pct: true })}
          status={kpis.testingPassRate.value == null ? "insufficient_data" : "on_target"}
          sampleLabel={sampleLine(
            kpis.testingPassRate.numerator,
            kpis.testingPassRate.denominator,
            "graded",
          )}
          definition="Graded assessments meeting pass_threshold. Excludes human-review-pending results. Advisory only — never an automatic reject."
        >
          {dd("testing_pass_rate")}
          {dd("testing_pass_rate_passed")}
        </KPICard>
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
        >
          {dd("interview_conversion")}
          {dd("interview_conversion_converted")}
        </KPICard>
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
        >
          {dd("client_submission_acceptance")}
          {dd("client_submission_acceptance_accepted")}
        </KPICard>
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
        >
          {dd("offer_to_hire")}
        </KPICard>
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
        >
          {dd("placement_rate")}
          {dd("placement_rate_placed")}
        </KPICard>
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
        >
          {dd("withdrawals")}
        </KPICard>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <CxGuardrailsPanel cx={dash.cx} responseTimes={dash.responseTimes} />
        <div className="space-y-4">
          <StageFunnel funnel={kpis.funnel} />
          <WorkloadByStage byStage={kpis.activeWorkload.byStage} />
        </div>
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
            Stalled vs threshold: {queue.countsByKind.stalled_in_stage} applications (target max{" "}
            {t.maxStalledApplicationCount}).
          </p>
          <Drilldown
            label="Applications stalled past their stage threshold"
            applicationIds={drilldowns.stalled_in_stage ?? []}
          />
        </Card>
        <RejectionBreakdown rejections={kpis.rejections} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <TimeToFillChart data={ttfTrend} />
        <AppsReviewedChart data={appsTrend} />
      </div>

      <RoleAssignmentTable roles={options.roles} />
    </div>
  );
}
