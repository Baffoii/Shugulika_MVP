"use client";

import { useState, useTransition } from "react";
import { Card, Button, Alert } from "@/components/ui/primitives";
import type { RecruiterKpiTargetRow } from "@/lib/database.types";
import { RECRUITER_LEVEL_LABELS, type RecruiterLevel, RECRUITER_LEVELS } from "@/lib/rbac";

type FieldKey =
  | "max_time_to_first_review_hours"
  | "max_time_to_client_submission_days"
  | "target_time_to_fill_days"
  | "target_placement_rate_pct"
  | "min_interview_conversion_pct"
  | "min_client_submission_acceptance_pct"
  | "target_offer_to_hire_ratio_pct"
  | "max_active_workload"
  | "max_stalled_application_count";

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "max_time_to_first_review_hours", label: "Max time to first review (hours)" },
  { key: "max_time_to_client_submission_days", label: "Max time to client submission (days)" },
  { key: "target_time_to_fill_days", label: "Max time to fill (days)" },
  { key: "target_placement_rate_pct", label: "Min placement rate (%)" },
  { key: "min_interview_conversion_pct", label: "Min interview conversion (%)" },
  { key: "min_client_submission_acceptance_pct", label: "Min CS acceptance (%)" },
  { key: "target_offer_to_hire_ratio_pct", label: "Min offer-to-hire (%)" },
  { key: "max_active_workload", label: "Max active workload" },
  { key: "max_stalled_application_count", label: "Max stalled applications" },
];

export function KpiTargetsForm({
  initial,
  organizationId,
  sourceLabel,
  saveAction,
}: {
  initial: RecruiterKpiTargetRow[];
  organizationId: string | null;
  sourceLabel: string;
  saveAction: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [level, setLevel] = useState<RecruiterLevel>("recruiter");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const row =
    initial.find((r) => r.recruiter_level === level && r.organization_id === organizationId) ??
    initial.find((r) => r.recruiter_level === level && r.organization_id == null);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">KPI targets</h2>
          <p className="text-xs text-ink-muted">
            Editing {sourceLabel}. Effective targets resolve franchise override → platform default.
          </p>
        </div>
        <label className="text-xs text-ink-muted">
          Level
          <select
            className="ml-2 rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
            value={level}
            onChange={(e) => setLevel(e.target.value as RecruiterLevel)}
          >
            {RECRUITER_LEVELS.map((l) => (
              <option key={l} value={l}>
                {RECRUITER_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message ? (
        <div className="mb-3">
          <Alert tone="success" title="Saved">
            {message}
          </Alert>
        </div>
      ) : null}
      {error ? (
        <div className="mb-3">
          <Alert tone="danger" title="Could not save">
            {error}
          </Alert>
        </div>
      ) : null}

      <form
        className="grid gap-3 sm:grid-cols-2"
        action={(fd) => {
          start(async () => {
            setMessage(null);
            setError(null);
            fd.set("recruiter_level", level);
            if (organizationId) fd.set("organization_id", organizationId);
            else fd.set("organization_id", "");
            const res = await saveAction(fd);
            if (res.ok) setMessage(`Updated targets for ${RECRUITER_LEVEL_LABELS[level]}.`);
            else setError(res.error ?? "Unknown error");
          });
        }}
      >
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-xs text-ink-muted">
            {f.label}
            <input
              name={f.key}
              type="number"
              min={0}
              required
              defaultValue={row?.[f.key] ?? 0}
              key={`${level}-${f.key}-${row?.id ?? "new"}`}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
        ))}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save targets"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
