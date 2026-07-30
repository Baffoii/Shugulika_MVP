import { Card } from "@/components/ui/primitives";
import type { RecruiterKPIs } from "@/lib/data/recruiter-kpis";

export function RejectionBreakdown({ rejections }: { rejections: RecruiterKPIs["rejections"] }) {
  const reasonEntries = Object.entries(rejections.byReasonKey).sort((a, b) => b[1] - a[1]);
  const stageEntries = Object.entries(rejections.byStage).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="p-4">
      <h2 className="mb-1 text-sm font-semibold text-ink">Rejections</h2>
      <p className="mb-3 text-xs text-ink-muted">
        Total {rejections.total}
        {rejections.rate.value != null
          ? ` · rate ${rejections.rate.value}% (${rejections.rate.numerator}/${rejections.rate.denominator})`
          : " · not enough data for rate"}
      </p>
      {rejections.total === 0 ? (
        <p className="text-sm text-ink-muted">No rejections in this period.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-ink-subtle">By stage</p>
            <ul className="space-y-1 text-sm">
              {stageEntries.map(([k, n]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span className="capitalize text-ink">{k.replace(/_/g, " ")}</span>
                  <span className="tabular-nums text-ink-muted">{n}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-ink-subtle">By reason</p>
            <ul className="space-y-1 text-sm">
              {reasonEntries.map(([k, n]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span className="capitalize text-ink">{k.replace(/_/g, " ")}</span>
                  <span className="tabular-nums text-ink-muted">{n}</span>
                </li>
              ))}
            </ul>
            {rejections.otherReasons.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-ink-subtle">Other (free text)</p>
                <ul className="space-y-1 text-xs text-ink-muted">
                  {rejections.otherReasons.slice(0, 8).map((t, i) => (
                    <li key={`${t}-${i}`}>“{t}”</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  );
}
