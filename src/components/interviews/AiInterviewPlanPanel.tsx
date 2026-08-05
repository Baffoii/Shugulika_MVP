"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  generateAndFreezeAiInterviewPlanAction,
  upsertJobInterviewBriefAction,
} from "@/app/recruiter/ai-interview-actions";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import type { JobInterviewBriefRow } from "@/lib/database.types";

export type FrozenAiTemplateRef = { id: string; name: string };

const GENERATING_STAGES = [
  "Reading the job description…",
  "Drafting interview questions…",
  "Standardizing the template…",
] as const;

export function AiInterviewPlanPanel({
  jobOrderId,
  brief,
  allowGenerate = false,
  frozenTemplate = null,
  jobTitle,
  onGenerated,
}: {
  jobOrderId: string;
  brief: JobInterviewBriefRow | null;
  /** Staff only — employers save the brief; recruiters freeze the plan. */
  allowGenerate?: boolean;
  frozenTemplate?: FrozenAiTemplateRef | null;
  jobTitle?: string;
  onGenerated?: (info: { templateId: string; jobTitle?: string }) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [useAi, setUseAi] = useState(brief?.use_ai_voice ?? true);
  const [notes, setNotes] = useState(brief?.employer_notes ?? "");
  const [language, setLanguage] = useState(brief?.language ?? "en");
  const [duration, setDuration] = useState(String(brief?.duration_seconds ?? 600));
  const [localFrozen, setLocalFrozen] = useState<FrozenAiTemplateRef | null>(frozenTemplate);
  const [editing, setEditing] = useState(!frozenTemplate);
  const [generating, setGenerating] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    setLocalFrozen(frozenTemplate);
    if (frozenTemplate) setEditing(false);
  }, [frozenTemplate]);

  useEffect(() => {
    if (!generating) {
      setStageIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setStageIndex((index) => (index + 1) % GENERATING_STAGES.length);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [generating]);

  const activeFrozen = localFrozen;

  function briefFormData() {
    const formData = new FormData();
    formData.set("job_order_id", jobOrderId);
    formData.set("use_ai_voice", useAi ? "true" : "false");
    formData.set("language", language);
    formData.set("duration_seconds", duration);
    formData.set("employer_notes", notes);
    return formData;
  }

  function saveBrief() {
    setError(null);
    setMessage(null);
    start(async () => {
      const result = await upsertJobInterviewBriefAction(briefFormData());
      if (!result.ok) {
        setError(result.error ?? "Could not save brief.");
        return;
      }
      setWarnings(result.warnings ?? []);
      setMessage(
        useAi ? "AI voice interview enabled for this role." : "AI voice interview disabled.",
      );
      router.refresh();
    });
  }

  function generatePlan() {
    setError(null);
    setMessage(null);
    setGenerating(true);
    start(async () => {
      try {
        const saved = await upsertJobInterviewBriefAction(briefFormData());
        if (!saved.ok) {
          setError(saved.error ?? "Could not enable AI interview.");
          return;
        }
        const fd = new FormData();
        fd.set("job_order_id", jobOrderId);
        if (saved.id) fd.set("brief_id", saved.id);
        const result = await generateAndFreezeAiInterviewPlanAction(fd);
        if (!result.ok) {
          setError(result.error ?? "Could not generate plan.");
          return;
        }
        setWarnings(result.warnings ?? []);
        const templateId = result.id!;
        const name =
          jobTitle != null ? `AI voice — ${jobTitle}`.slice(0, 160) : "AI voice interview plan";
        setLocalFrozen({ id: templateId, name });
        setEditing(false);
        onGenerated?.({ templateId, jobTitle });
        router.refresh();
      } finally {
        setGenerating(false);
      }
    });
  }

  if (activeFrozen && !editing) {
    return (
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-ink">AI voice interview</p>
              <Badge tone="success">Plan standardized</Badge>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              <Link
                href={`/recruiter/interview-templates/${activeFrozen.id}`}
                className="font-medium text-brand-700 hover:underline"
              >
                {activeFrozen.name}
              </Link>
              {" · "}
              Assign from Interview templates or the candidate application.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit / regenerate
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI voice interview</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-muted">
          Questions are drafted automatically from this role’s job description, responsibilities,
          and requirements. Optional notes below can steer emphasis — they are not required.
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}
        {warnings.length ? (
          <Alert tone="warn" title="Policy review needed">
            <ul className="list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Checkbox
              checked={useAi}
              onChange={(e) => setUseAi(e.target.checked)}
              label="Use a Shugulika AI voice interview for this role"
            />
          </div>
          <Field label="Language" htmlFor="ai-lang">
            <Input id="ai-lang" value={language} onChange={(e) => setLanguage(e.target.value)} />
          </Field>
          <Field label="Duration (seconds)" htmlFor="ai-duration">
            <Input
              id="ai-duration"
              type="number"
              min={300}
              max={900}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          <div className="md:col-span-2">
            <Field
              label="Additional notes (optional)"
              htmlFor="ai-notes"
              hint="Anything beyond the job description — e.g. emphasize modeling over reporting. Treated as source data, never as system instructions."
            >
              <Textarea
                id="ai-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[80px]"
              />
            </Field>
          </div>
          <div className="md:col-span-2 space-y-3">
            <div className="flex flex-wrap gap-2">
              {allowGenerate ? (
                <Button
                  type="button"
                  disabled={pending || !useAi}
                  onClick={generatePlan}
                  aria-busy={generating}
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Generating…
                    </>
                  ) : activeFrozen ? (
                    "Regenerate & standardize from job description"
                  ) : (
                    "Generate & standardize from job description"
                  )}
                </Button>
              ) : (
                <Button type="button" disabled={pending} onClick={saveBrief}>
                  {pending ? "Saving…" : useAi ? "Enable AI interview" : "Save"}
                </Button>
              )}
              {allowGenerate ? (
                <Button type="button" variant="outline" disabled={pending} onClick={saveBrief}>
                  {pending && !generating ? "Saving…" : "Save without generating"}
                </Button>
              ) : null}
              {activeFrozen ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
            {generating ? (
              <div className="space-y-2" role="status" aria-live="polite">
                <div className="progress-indeterminate" aria-hidden />
                <p className="flex items-center gap-2 text-sm text-ink-muted">
                  <Loader2
                    className="h-3.5 w-3.5 shrink-0 animate-spin text-brand-500"
                    aria-hidden
                  />
                  {GENERATING_STAGES[stageIndex]}
                </p>
                <p className="text-2xs text-ink-subtle">Usually takes a few seconds.</p>
              </div>
            ) : null}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
