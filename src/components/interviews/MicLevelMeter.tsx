"use client";

import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MicLevelSample, MicLevelStatus } from "@/lib/media/recording";

const SEGMENT_COUNT = 12;

const STATUS_COPY: Record<MicLevelStatus, string> = {
  disconnected: "Microphone disconnected",
  muted: "Microphone muted",
  too_quiet: "Input too quiet — move closer or raise mic volume",
  normal: "Microphone level normal",
  hot: "Input is loud — lower mic volume if possible",
  clipping: "Clipping — reduce microphone volume",
};

function segmentTone(index: number, filled: number, status: MicLevelStatus): string {
  if (index >= filled) return "bg-slate-600/80";
  if (status === "disconnected" || status === "muted") return "bg-slate-500";
  if (status === "too_quiet") return "bg-amber-400";
  if (status === "clipping") return "bg-red-500";
  if (status === "hot" && index >= SEGMENT_COUNT - 3) return "bg-amber-400";
  // Zoom-like default: green for healthy activity (never brand orange).
  return "bg-emerald-500";
}

export function MicLevelMeter({
  sample,
  className,
  label = "Microphone activity",
  compact = false,
}: {
  sample: MicLevelSample;
  className?: string;
  label?: string;
  /** HireVue-style corner badge without the verbose status line. */
  compact?: boolean;
}) {
  const filled =
    sample.status === "disconnected" || sample.status === "muted"
      ? 0
      : Math.max(sample.status === "too_quiet" ? 1 : 0, Math.round(sample.level * SEGMENT_COUNT));
  const Icon = sample.status === "muted" || sample.status === "disconnected" ? MicOff : Mic;

  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-white shadow-sm",
          sample.status === "normal" || sample.status === "hot"
            ? "bg-emerald-600/90"
            : sample.status === "clipping"
              ? "bg-red-600/90"
              : "bg-black/70",
          className,
        )}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(sample.level * 100)}
        aria-label={STATUS_COPY[sample.status]}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="flex h-2.5 items-end gap-px">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={cn(
                "w-1 rounded-[1px]",
                index < Math.ceil(filled / (SEGMENT_COUNT / 5)) ? "bg-white" : "bg-white/30",
                index === 0 ? "h-1.5" : index === 1 ? "h-2" : index === 2 ? "h-2.5" : "h-3",
              )}
            />
          ))}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs font-medium text-ink-muted">
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{label}</span>
      </div>
      <div
        className="flex h-3 items-end gap-0.5"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(sample.level * 100)}
        aria-label={STATUS_COPY[sample.status]}
      >
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <span
            key={index}
            className={cn(
              "min-w-0 flex-1 rounded-[2px] transition-colors duration-75",
              index % 3 === 2 ? "h-full" : index % 3 === 1 ? "h-[85%]" : "h-[70%]",
              segmentTone(index, filled, sample.status),
            )}
          />
        ))}
      </div>
      <p
        className={cn(
          "text-xs",
          sample.status === "normal"
            ? "text-emerald-700"
            : sample.status === "clipping" || sample.status === "disconnected"
              ? "text-status-danger"
              : sample.status === "too_quiet" ||
                  sample.status === "hot" ||
                  sample.status === "muted"
                ? "text-amber-700"
                : "text-ink-subtle",
        )}
      >
        {STATUS_COPY[sample.status]}
      </p>
    </div>
  );
}
