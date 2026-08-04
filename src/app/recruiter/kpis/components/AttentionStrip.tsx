import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import {
  ATTENTION_KIND_LABELS,
  PRIMARY_ATTENTION_KINDS,
  type AttentionKind,
} from "@/lib/kpi/attention";

/**
 * Compact "what needs me today" strip. Rendered on the recruiter dashboard and
 * at the top of /recruiter/kpis. Counts only — the full queue (with owner and
 * next action) lives on the KPI page.
 */
export function AttentionStrip({
  countsByKind,
  overdueCountsByKind,
  totalOverdue,
  href = "/recruiter/kpis",
}: {
  countsByKind: Record<AttentionKind, number>;
  overdueCountsByKind: Record<AttentionKind, number>;
  totalOverdue: number;
  href?: string;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Needs attention
          {totalOverdue > 0 ? (
            <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
              {totalOverdue} overdue
            </span>
          ) : null}
        </h2>
        <Link href={href} className="text-xs text-brand-700 hover:underline">
          Open the full queue
        </Link>
      </div>

      {totalOverdue === 0 && PRIMARY_ATTENTION_KINDS.every((k) => countsByKind[k] === 0) ? (
        <p className="text-sm text-ink-muted">
          Nothing overdue or blocked in your queue right now.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRIMARY_ATTENTION_KINDS.map((kind) => {
            const total = countsByKind[kind] ?? 0;
            const overdue = overdueCountsByKind[kind] ?? 0;
            return (
              <li key={kind}>
                <Link
                  href={`${href}?kind=${kind}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/70 px-3 py-2 transition-colors hover:bg-surface-muted"
                >
                  <span className="text-xs text-ink">{ATTENTION_KIND_LABELS[kind]}</span>
                  <span
                    className={
                      overdue > 0
                        ? "text-sm font-semibold tabular-nums text-orange-800"
                        : "text-sm font-semibold tabular-nums text-ink-muted"
                    }
                  >
                    {total}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
