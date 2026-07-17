import { Badge, type BadgeTone } from "@/components/ui/primitives";
import { confidenceBand, CONFIDENCE_BAND_LABEL } from "@/lib/resume-suggestions";

const TONE: Record<ReturnType<typeof confidenceBand>, BadgeTone> = {
  high: "success",
  medium: "warn",
  low: "info",
};

/** >=0.85 -> "High confidence", >=0.6 -> "Review recommended", else "Uncertain — please verify". */
export function ConfidenceBadge({ confidence }: { confidence: number }) {
  const band = confidenceBand(confidence);
  return <Badge tone={TONE[band]}>{CONFIDENCE_BAND_LABEL[band]}</Badge>;
}
