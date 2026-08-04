import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import {
  ATTENTION_KIND_LABELS,
  ATTENTION_KINDS,
  NEXT_ACTION_LABELS,
  PRIMARY_ATTENTION_KINDS,
  type AttentionItem,
  type AttentionKind,
  type AttentionQueue,
} from "@/lib/kpi/attention";
import { formatDurationHours } from "@/lib/kpi/definitions";

function OwnerBadge({ item, viewerId }: { item: AttentionItem; viewerId: string }) {
  const mine = item.ownerUserId === viewerId;
  const label =
    item.ownerSource === "assigned_recruiter"
      ? mine
        ? "You (assigned)"
        : "Assigned recruiter"
      : item.ownerSource === "job_owner"
        ? "Job owner"
        : "You (unassigned — no owner recorded)";
  return (
    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
      {label}
    </span>
  );
}

function ItemRow({ item, viewerId }: { item: AttentionItem; viewerId: string }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/recruiter/applications/${item.applicationId}`}
            className="font-mono text-xs text-brand-700 hover:underline"
          >
            {item.applicationId}
          </Link>
          <span className="text-[11px] capitalize text-ink-subtle">
            {item.stage.replace(/_/g, " ")}
          </span>
          <OwnerBadge item={item} viewerId={viewerId} />
        </div>
        <p className="mt-1 text-xs text-ink-muted">{item.detail}</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium text-ink">{NEXT_ACTION_LABELS[item.nextAction]}</p>
        <p
          className={
            item.overdueHours != null
              ? "text-[11px] font-medium text-orange-800"
              : "text-[11px] text-ink-subtle"
          }
        >
          {item.overdueHours != null
            ? `${formatDurationHours(item.overdueHours)} overdue`
            : item.dueAt
              ? `Due ${item.dueAt.slice(0, 10)}`
              : "No deadline recorded"}
        </p>
      </div>
    </li>
  );
}

/**
 * The daily queue. Overdue first, grouped by SLA kind; every row states who
 * owns it, what the next action is, and when it was due.
 */
export function AttentionQueuePanel({
  queue,
  viewerId,
  selectedKind,
  maxPerKind = 10,
}: {
  queue: AttentionQueue;
  viewerId: string;
  selectedKind?: string;
  maxPerKind?: number;
}) {
  const kinds: AttentionKind[] = selectedKind
    ? ATTENTION_KINDS.filter((k) => k === selectedKind)
    : [
        ...PRIMARY_ATTENTION_KINDS,
        ...ATTENTION_KINDS.filter((k) => !PRIMARY_ATTENTION_KINDS.includes(k)),
      ];

  const visible = kinds.filter((k) => queue.countsByKind[k] > 0);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">
          Attention queue
          <span className="ml-2 text-xs font-normal text-ink-muted">
            {queue.items.length} items · {queue.totalOverdue} overdue
          </span>
        </h2>
        {selectedKind ? (
          <Link href="/recruiter/kpis" className="text-xs text-brand-700 hover:underline">
            Clear filter
          </Link>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing in this queue. Overdue reviews, past-due assessments, overdue interviews, employer
          approvals, stalled applications, and missing screening notes all appear here.
        </p>
      ) : (
        <div className="space-y-5">
          {visible.map((kind) => {
            const items = queue.items.filter((i) => i.kind === kind);
            const shown = items.slice(0, maxPerKind);
            return (
              <section key={kind}>
                <h3 className="flex items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                  <span>{ATTENTION_KIND_LABELS[kind]}</span>
                  <span className="tabular-nums">
                    {queue.overdueCountsByKind[kind]} overdue / {items.length}
                  </span>
                </h3>
                <ul className="divide-y divide-border/60">
                  {shown.map((item) => (
                    <ItemRow key={item.id} item={item} viewerId={viewerId} />
                  ))}
                </ul>
                {items.length > shown.length ? (
                  <Link
                    href={`/recruiter/kpis?kind=${kind}`}
                    className="text-[11px] text-brand-700 hover:underline"
                  >
                    Show all {items.length}
                  </Link>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
