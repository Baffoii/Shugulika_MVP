import { Card, Badge } from "@/components/ui/primitives";
import { PLACEHOLDER_STATUS_LABELS, type PlaceholderFeature } from "@/lib/constants";
import { Sparkles, Lock } from "lucide-react";

const TONE = {
  coming_soon: "info" as const,
  integration_pending: "warn" as const,
  not_enabled: "neutral" as const,
};

/** Consistent, clearly-labelled placeholder for a later-phase integration.
 *  Actions are disabled; it never shows fake completed results. */
export function PlaceholderCard({ feature }: { feature: PlaceholderFeature }) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-500">
          <Sparkles className="h-5 w-5" aria-hidden />
        </div>
        <Badge tone={TONE[feature.status]}>{PLACEHOLDER_STATUS_LABELS[feature.status]}</Badge>
      </div>
      <h3 className="text-sm font-semibold text-ink">{feature.title}</h3>
      <p className="mt-1 flex-1 text-sm text-ink-muted">{feature.description}</p>
      <button
        type="button"
        disabled
        aria-disabled
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-muted px-3 py-1.5 text-sm font-medium text-ink-subtle"
        title="Not available in this MVP"
      >
        <Lock className="h-3.5 w-3.5" aria-hidden /> Not available yet
      </button>
    </Card>
  );
}

export function PlaceholderInline({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-badge border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
      <Sparkles className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}
