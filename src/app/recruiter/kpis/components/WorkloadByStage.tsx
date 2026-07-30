import { Card } from "@/components/ui/primitives";

export function WorkloadByStage({ byStage }: { byStage: Record<string, number> }) {
  const entries = Object.entries(byStage).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return (
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Workload by stage</h2>
        <p className="text-sm text-ink-muted">No active assigned applications.</p>
      </Card>
    );
  }
  const max = Math.max(...entries.map(([, n]) => n), 1);
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">Workload by stage</h2>
      <ul className="space-y-2">
        {entries.map(([stage, n]) => (
          <li key={stage}>
            <div className="mb-1 flex justify-between text-xs text-ink-muted">
              <span className="capitalize text-ink">{stage.replace(/_/g, " ")}</span>
              <span className="tabular-nums">{n}</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-surface-muted">
              <div
                className="h-full rounded bg-brand-600/80"
                style={{ width: `${(n / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
