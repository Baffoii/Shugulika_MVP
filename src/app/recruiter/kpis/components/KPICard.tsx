import { Badge, Card, type BadgeTone } from "@/components/ui/primitives";
import type { KpiStatus } from "@/lib/data/recruiter-kpis";
import { cn } from "@/lib/cn";

const statusTone: Record<KpiStatus, BadgeTone> = {
  on_track: "success",
  at_risk: "warn",
  exceeded: "brand",
};

const statusLabel: Record<KpiStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  exceeded: "Exceeded",
};

export function KPICard({
  label,
  value,
  unit,
  targetLabel,
  status,
  hint,
  progressPct,
}: {
  label: string;
  value: string | number;
  unit?: string;
  targetLabel: string;
  status: KpiStatus;
  hint?: string;
  /** 0–100 for progress bar (apps reviewed). */
  progressPct?: number;
}) {
  const tone = statusTone[status];
  const valueTone: Record<BadgeTone, string> = {
    success: "text-emerald-700",
    info: "text-blue-700",
    warn: "text-amber-700",
    danger: "text-red-700",
    neutral: "text-ink",
    brand: "text-brand-700",
  };

  return (
    <Card className="flex flex-col gap-3 p-4" aria-label={`${label}: ${value}${unit ?? ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
        <Badge tone={tone}>{statusLabel[status]}</Badge>
      </div>
      <p className={cn("text-2xl font-semibold", valueTone[tone])}>
        {value}
        {unit ? <span className="ml-1 text-base font-medium text-ink-muted">{unit}</span> : null}
      </p>
      <p className="text-xs text-ink-subtle">Target: {targetLabel}</p>
      {typeof progressPct === "number" ? (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={Math.round(Math.min(100, Math.max(0, progressPct)))}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} progress`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              status === "exceeded" || status === "on_track" ? "bg-emerald-500" : "bg-amber-500",
            )}
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
      ) : null}
      {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
    </Card>
  );
}
