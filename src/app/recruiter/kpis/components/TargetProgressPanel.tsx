import { Card } from "@/components/ui/primitives";
import type { ResolvedTargets, TargetProgressRow } from "@/lib/data/recruiter-kpis";
import { statusClass } from "./KPICard";

function Bar({ pct, over }: { pct: number | null; over: boolean }) {
  if (pct == null) {
    return <div className="h-1.5 w-full rounded-full bg-surface-muted" aria-hidden />;
  }
  const width = Math.max(2, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-muted" aria-hidden>
      <div
        className={`h-1.5 rounded-full ${over ? "bg-orange-500" : "bg-brand-600"}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/**
 * Personal target progress: what is left to hit each target, how much of the
 * period has elapsed, and — explicitly — which target *version* the numbers
 * were graded against.
 */
export function TargetProgressPanel({
  rows,
  targetVersion,
  targetVersionLabel,
  periodElapsedPct,
  periodLabel,
}: {
  rows: TargetProgressRow[];
  targetVersion: ResolvedTargets;
  targetVersionLabel: string;
  periodElapsedPct: number;
  periodLabel: string;
}) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">My target progress</h2>
        <span className="text-xs text-ink-muted">
          {periodLabel} · {periodElapsedPct}% of the period elapsed
        </span>
      </div>

      <p className="mb-3 text-[11px] text-ink-subtle">
        Target version used:{" "}
        <span className="font-medium text-ink-muted">{targetVersionLabel}</span>
        {targetVersion.targetVersionId ? (
          <span className="ml-1 font-mono">({targetVersion.targetVersionId.slice(0, 8)})</span>
        ) : null}
      </p>

      <ul className="space-y-3">
        {rows.map((row) => {
          const over =
            row.direction !== "higher_is_better" &&
            row.achieved != null &&
            row.achieved > row.target;
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-ink">{row.label}</span>
                <span className={`tabular-nums ${statusClass(row.status)}`}>
                  {row.achieved == null ? "—" : row.achieved}
                  <span className="text-ink-subtle">
                    {" "}
                    / {row.direction === "higher_is_better" ? "" : "≤ "}
                    {row.target}
                    {row.unit === "%" ? "%" : ""}
                  </span>
                </span>
              </div>
              <Bar pct={row.progressPct} over={over} />
              <p className="mt-1 text-[11px] text-ink-subtle">
                {row.achieved == null
                  ? "Not enough data in this period"
                  : row.direction === "higher_is_better"
                    ? row.remaining > 0
                      ? `${row.remaining}${row.unit === "%" ? " percentage points" : ` ${row.unit}`} to go`
                      : "Target met"
                    : over
                      ? `Over the cap by ${Math.round((row.achieved - row.target) * 10) / 10}`
                      : `${row.remaining} of headroom left`}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
