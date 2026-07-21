import type { CandidateQualityScore } from "@/lib/data/recruiter-kpis";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";

function BarRow({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="font-medium text-ink">{Math.round(value)}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function QualityBreakdown({
  quality,
  weights = { aptitude: 0.4, interview: 0.35, engagement: 0.25 },
}: {
  quality: CandidateQualityScore;
  weights?: { aptitude: number; interview: number; engagement: number };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Candidate quality breakdown</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-muted">
          Composite score{" "}
          <span className="font-semibold text-ink">{Math.round(quality.overallScore)}</span> / 100
          <span className="text-ink-subtle">
            {" "}
            (aptitude ×{weights.aptitude}, interview ×{weights.interview}, engagement ×
            {weights.engagement})
          </span>
        </p>
        <BarRow label="Aptitude (proxy)" value={quality.averageAptitudeScore} />
        <BarRow label="Interview performance" value={quality.interviewPerformance} />
        <BarRow label="Engagement" value={quality.engagementScore} />
        <p className="text-xs text-ink-subtle">
          Aptitude uses pipeline progression as a proxy until dedicated assessments ship.
        </p>
      </CardBody>
    </Card>
  );
}
