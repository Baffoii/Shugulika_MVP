import { Badge, Card, type BadgeTone } from "@/components/ui/primitives";
import type { KpiStatus } from "@/lib/kpi/definitions";
import { cn } from "@/lib/cn";

const statusTone: Record<KpiStatus, BadgeTone> = {
  on_target: "success",
  at_risk: "warn",
  off_target: "orange",
  insufficient_data: "neutral",
};

const statusLabel: Record<KpiStatus, string> = {
  on_target: "On target",
  at_risk: "At risk",
  off_target: "Off target",
  insufficient_data: "Insufficient data",
};

const statusIcon: Record<KpiStatus, string> = {
  on_target: "✓",
  at_risk: "!",
  off_target: "✕",
  insufficient_data: "—",
};

export function KPICard({
  label,
  value,
  unit,
  targetLabel,
  status,
  hint,
  sampleLabel,
  definition,
  children,
}: {
  label: string;
  value: string | number;
  unit?: string;
  targetLabel?: string;
  status: KpiStatus;
  hint?: string;
  sampleLabel?: string;
  definition?: string;
  /** Drill-down affordance rendered at the foot of the card. */
  children?: React.ReactNode;
}) {
  const tone = statusTone[status];

  return (
    <Card
      className="flex flex-col gap-2 p-4"
      aria-label={`${label}: ${value}${unit ?? ""}, ${statusLabel[status]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="text-xs font-medium uppercase tracking-wide text-ink-subtle"
          title={definition}
        >
          {label}
        </p>
        <Badge tone={tone}>
          <span aria-hidden className="mr-1">
            {statusIcon[status]}
          </span>
          {statusLabel[status]}
        </Badge>
      </div>
      <p className="text-2xl font-semibold text-ink">
        {value}
        {unit ? <span className="ml-1 text-base font-medium text-ink-muted">{unit}</span> : null}
      </p>
      {targetLabel ? <p className="text-xs text-ink-subtle">Target: {targetLabel}</p> : null}
      {sampleLabel ? <p className="text-xs text-ink-muted">{sampleLabel}</p> : null}
      {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
      {definition ? (
        <p className="mt-auto border-t border-border/60 pt-2 text-[11px] leading-snug text-ink-subtle">
          {definition}
        </p>
      ) : null}
      {children}
    </Card>
  );
}

export function metricDisplay(
  value: number | null,
  opts?: { pct?: boolean; suffix?: string },
): string {
  if (value == null) return "—";
  if (opts?.pct) return `${value}%`;
  if (opts?.suffix) return `${value}${opts.suffix}`;
  return String(value);
}

export function sampleLine(numerator: number, denominator: number, label = "n"): string {
  if (denominator <= 0) return "Not enough data (denominator 0)";
  return `${label}: ${numerator} / ${denominator}`;
}

export function statusClass(status: KpiStatus): string {
  return cn(
    status === "on_target" && "text-emerald-800",
    status === "at_risk" && "text-amber-800",
    status === "off_target" && "text-orange-800",
    status === "insufficient_data" && "text-ink-muted",
  );
}
