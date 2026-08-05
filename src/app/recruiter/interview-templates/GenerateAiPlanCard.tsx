"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { generateAndFreezeAiInterviewPlanAction } from "@/app/recruiter/ai-interview-actions";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Field, Select } from "@/components/ui/form";

export type AiPlanJobOption = {
  id: string;
  title: string;
  status: string;
  hasAiBrief: boolean;
};

const GENERATING_STAGES = [
  "Reading the job description…",
  "Drafting interview questions…",
  "Standardizing the template…",
] as const;

/** Quick path for staff: generate a frozen live AI template from a job order + brief. */
export function GenerateAiPlanCard({ jobs }: { jobs: AiPlanJobOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [jobOrderId, setJobOrderId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stageIndex, setStageIndex] = useState(0);

  const eligibleJobs = useMemo(() => jobs.filter((job) => job.hasAiBrief), [jobs]);
  const otherJobs = useMemo(() => jobs.filter((job) => !job.hasAiBrief), [jobs]);
  const selected = jobs.find((job) => job.id === jobOrderId) ?? null;

  useEffect(() => {
    if (!pending) {
      setStageIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setStageIndex((index) => (index + 1) % GENERATING_STAGES.length);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [pending]);

  function run() {
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("job_order_id", jobOrderId);
    start(async () => {
      const result = await generateAndFreezeAiInterviewPlanAction(fd);
      if (!result.ok) {
        setError(result.error ?? "Could not generate plan.");
        return;
      }
      setMessage(`Standardized AI voice template ready for ${selected?.title ?? "this role"}.`);
      router.refresh();
      if (result.id) router.push(`/recruiter/interview-templates/${result.id}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate AI voice plan</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="mt-0 text-sm text-ink-muted">
          Pick a role with AI voice enabled. Questions are drafted from that role’s description and
          requirements (optional notes if any), then standardized into an assignable template.
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}
        {!jobs.length ? (
          <p className="text-sm text-ink-muted">No job orders available yet.</p>
        ) : (
          <Field
            label="Role"
            htmlFor="ai-job-order-id"
            required
            hint={
              selected && !selected.hasAiBrief
                ? "This role has no AI voice brief yet. Open Jobs & orders → View role details → AI voice interview, enable it, and Save interview brief."
                : eligibleJobs.length === 0
                  ? "No roles have an AI voice brief yet. Add one under Jobs & orders → View role details → AI voice interview."
                  : "Roles with a brief are listed first."
            }
          >
            <Select
              id="ai-job-order-id"
              value={jobOrderId}
              onChange={(event) => setJobOrderId(event.target.value)}
              required
              disabled={pending}
            >
              <option value="" disabled>
                Select a role…
              </option>
              {eligibleJobs.length ? (
                <optgroup label="Ready (has AI brief)">
                  {eligibleJobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} · {job.status}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {otherJobs.length ? (
                <optgroup label="Needs AI brief">
                  {otherJobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} · {job.status}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>
        )}
        <Button
          type="button"
          disabled={pending || !jobOrderId || !selected?.hasAiBrief}
          onClick={run}
          aria-busy={pending}
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Generating…
            </>
          ) : (
            "Generate & standardize"
          )}
        </Button>
        {pending ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="progress-indeterminate" aria-hidden />
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-500" aria-hidden />
              {GENERATING_STAGES[stageIndex]}
            </p>
            <p className="text-2xs text-ink-subtle">Usually takes a few seconds.</p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
