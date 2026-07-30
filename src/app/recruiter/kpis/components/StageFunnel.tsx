import { Card } from "@/components/ui/primitives";

export function StageFunnel({ funnel }: { funnel: Record<string, number> }) {
  const stages = [
    { key: "applied", label: "Applied" },
    { key: "cv_review", label: "CV review" },
    { key: "testing", label: "Testing" },
    { key: "interview_review", label: "Interview review" },
    { key: "client_submission", label: "Client submission" },
    { key: "offer", label: "Offer" },
    { key: "hired", label: "Hired" },
  ];
  const max = Math.max(...stages.map((s) => funnel[s.key] ?? 0), 1);

  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">Stage funnel</h2>
      <p className="mb-3 text-xs text-ink-muted">
        Distinct applications that reached each stage (not a conversion leaderboard).
      </p>
      <ul className="space-y-2">
        {stages.map((s) => {
          const n = funnel[s.key] ?? 0;
          return (
            <li key={s.key} className="flex items-center gap-3">
              <span className="w-36 shrink-0 text-xs text-ink">{s.label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded bg-surface-muted">
                <div
                  className="h-full rounded bg-teal-700/70"
                  style={{ width: `${(n / max) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right text-xs tabular-nums text-ink-muted">{n}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
