import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader, Card, EmptyState, Badge } from "@/components/ui/primitives";
import { getPipeline, type PipelineApplication } from "@/lib/data/recruiter";
import { APPLICATION_PHASES, stageByKey } from "@/lib/constants";
import { relativeDays } from "@/lib/format";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const applications = await getPipeline();

  // Group by phase (understandable grouping over the 15 internal stages).
  const byPhase = new Map<string, PipelineApplication[]>();
  for (const a of applications) {
    const phase = stageByKey(a.current_stage)?.phase ?? "new";
    const arr = byPhase.get(phase) ?? [];
    arr.push(a);
    byPhase.set(phase, arr);
  }
  const phasesToShow = APPLICATION_PHASES.filter((p) => p.key !== "closed");

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Candidate applications grouped into phases. The full 15-stage Spine is preserved; open a candidate to move them stage by stage."
      />
      {applications.length === 0 ? (
        <EmptyState
          title="No candidates in your pipeline yet"
          description="Applications to your assigned jobs will appear here."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {phasesToShow.map((phase) => {
            const items = byPhase.get(phase.key) ?? [];
            return (
              <Card key={phase.key} className="flex flex-col">
                <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-ink">{phase.label}</h2>
                  <Badge tone="neutral">{items.length}</Badge>
                </div>
                <div className="flex-1 space-y-2 p-3">
                  {items.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-ink-subtle">No candidates</p>
                  ) : (
                    items.map((a) => (
                      <Link
                        key={a.id}
                        href={`/recruiter/applications/${a.id}`}
                        className="block rounded-lg border border-surface-border bg-white p-3 hover:border-brand-300 hover:shadow-card"
                      >
                        <p className="text-sm font-medium text-ink">
                          {a.candidate_profiles?.given_name ?? "Candidate"}{" "}
                          {a.candidate_profiles?.family_name ?? ""}
                        </p>
                        <p className="truncate text-xs text-ink-subtle">
                          {a.candidate_profiles?.headline ?? a.job_orders?.title ?? "—"}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-2xs text-ink-subtle">
                          <span>{stageByKey(a.current_stage)?.label}</span>
                          <span>{relativeDays(a.created_at)}</span>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
