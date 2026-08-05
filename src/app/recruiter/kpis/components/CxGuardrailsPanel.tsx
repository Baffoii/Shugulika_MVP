import { Card } from "@/components/ui/primitives";
import type { RecruiterCxGuardrails } from "@/lib/data/recruiter-kpis";
import type { ResponseTimeResult } from "@/lib/kpi/definitions";
import { formatDurationHours } from "@/lib/kpi/definitions";
import { Drilldown } from "./Drilldown";

function ResponseLine({ label, result }: { label: string; result: ResponseTimeResult }) {
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink">{label}</span>
        <span className="tabular-nums text-ink-muted">
          {result.medianHours == null ? "—" : formatDurationHours(result.medianHours)}
        </span>
      </div>
      <p className="text-[11px] text-ink-subtle">
        {result.unavailableReason ??
          `Median of ${result.sampleSize} replies · ${result.overdue.length} overdue, ${result.awaiting.length} still waiting`}
      </p>
    </li>
  );
}

/**
 * Candidate-experience guardrails. Everything here is advisory — it prompts a
 * follow-up, and never scores or ranks a candidate.
 */
export function CxGuardrailsPanel({
  cx,
  responseTimes,
}: {
  cx: RecruiterCxGuardrails;
  responseTimes: { employer: ResponseTimeResult; candidate: ResponseTimeResult };
}) {
  const withdrawalReasons = Object.entries(cx.withdrawals.byReason).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">Candidate experience guardrails</h2>

      <ul className="divide-y divide-border/60">
        <ResponseLine label="Employer response time" result={responseTimes.employer} />
        <ResponseLine label="Candidate response time" result={responseTimes.candidate} />

        <li className="py-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink">Overdue candidate updates</span>
            <span className="tabular-nums text-ink-muted">{cx.overdueCandidateUpdates.length}</span>
          </div>
          <p className="text-[11px] text-ink-subtle">
            Active applications silent for more than {cx.maxCandidateSilenceHours}h.
          </p>
          <Drilldown
            label="Applications where the candidate has heard nothing recently"
            applicationIds={cx.overdueCandidateUpdates.map((u) => u.applicationId)}
          />
        </li>

        <li className="py-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink">Withdrawals</span>
            <span className="tabular-nums text-ink-muted">{cx.withdrawals.total}</span>
          </div>
          {withdrawalReasons.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-[11px] text-ink-muted">
              {withdrawalReasons.map(([reason, count]) => (
                <li key={reason} className="flex justify-between gap-2">
                  <span>{reason}</span>
                  <span className="tabular-nums">{count}</span>
                </li>
              ))}
              {cx.withdrawals.unspecified > 0 ? (
                <li className="flex justify-between gap-2">
                  <span>Unspecified</span>
                  <span className="tabular-nums">{cx.withdrawals.unspecified}</span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-[11px] text-ink-subtle">
              {cx.withdrawals.note ?? "No withdrawals in this period."}
            </p>
          )}
          <Drilldown
            label="Applications withdrawn in this period"
            applicationIds={cx.withdrawals.appIds}
          />
        </li>

        <li className="py-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink">Interview reschedules</span>
            <span className="tabular-nums text-ink-muted">{cx.reschedules.rescheduled}</span>
          </div>
          <p className="text-[11px] text-ink-subtle">
            {cx.reschedules.cancelled} cancelled · {cx.reschedules.repeatOffenderAppIds.length}{" "}
            application(s) rescheduled more than once.
            {cx.reschedules.historyStartsAt
              ? ` Schedule history starts ${cx.reschedules.historyStartsAt.slice(0, 10)}.`
              : " No schedule changes recorded yet — the log starts at the 2026-08-05 migration."}
          </p>
          <Drilldown
            label="Applications with interview schedule changes"
            applicationIds={cx.reschedules.appIds}
          />
        </li>

        <li className="py-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink">Unanswered candidate notifications</span>
            <span className="tabular-nums text-ink-muted">
              {cx.unansweredNotifications.overdue}
            </span>
          </div>
          <p className="text-[11px] text-ink-subtle">
            {cx.unansweredNotifications.total} unread in the period; {""}
            {cx.unansweredNotifications.overdue} unread for more than 48h. Read status only — no
            message content is exposed to KPI reporting.
          </p>
          <Drilldown
            label="Applications with an unread candidate notification"
            applicationIds={cx.unansweredNotifications.appIds}
          />
        </li>
      </ul>
    </Card>
  );
}
