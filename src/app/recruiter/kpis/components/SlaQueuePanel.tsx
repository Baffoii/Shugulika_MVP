import { Card } from "@/components/ui/primitives";
import type { SlaQueue } from "@/lib/kpi/definitions";

export function SlaQueuePanel({ sla }: { sla: SlaQueue }) {
  const rows: { label: string; value: string | number; note?: string }[] = [
    { label: "Awaiting first review", value: sla.awaitingFirstReview },
    { label: "Assessments past deadline", value: sla.assessmentsPastDeadline },
    { label: "Interviews overdue", value: sla.interviewsOverdue },
    { label: "Stalled in stage", value: sla.stalledInStage },
    { label: "Offers awaiting response", value: sla.offersAwaitingResponse },
    {
      label: "Hires awaiting placement / invoice",
      value: sla.hiresAwaitingPlacementOrInvoice,
    },
    {
      label: "Employer feedback overdue",
      value: "Unavailable",
      note: sla.employerFeedbackOverdue.reason,
    },
  ];

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">SLA / action queue</h2>
      <ul className="divide-y divide-border/70">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start justify-between gap-3 py-2 text-sm">
            <div>
              <p className="text-ink">{r.label}</p>
              {r.note ? <p className="text-xs text-ink-subtle">{r.note}</p> : null}
            </div>
            <span className="font-medium tabular-nums text-ink">{r.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
