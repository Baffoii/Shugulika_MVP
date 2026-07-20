"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceStageAction, addNoteAction, createSubmissionAction } from "@/app/recruiter/actions";
import { cancelAssignmentAction, createAssignmentAction } from "@/app/recruiter/interview-actions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Button,
  Alert,
  Badge,
} from "@/components/ui/primitives";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  CANDIDATE_STAGES,
  REJECTION_REASONS,
  interviewReviewBadge,
  stageByKey,
} from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import type { InterviewAssignmentRow, InterviewTemplateRow } from "@/lib/database.types";
import { formatDate } from "@/lib/format";
import Link from "next/link";
import { PlayCircle } from "lucide-react";

export function StageControl({
  applicationId,
  currentStage,
}: {
  applicationId: string;
  currentStage: string;
}) {
  const router = useRouter();
  const [toStage, setToStage] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isReject = toStage === "rejected";
  const targetStage = toStage ? stageByKey(toStage) : undefined;
  const shortlisted = stageByKey("shortlisted");
  const needsScreeningNote = Boolean(
    targetStage &&
    shortlisted &&
    targetStage.stageClass === "candidate" &&
    targetStage.ordinal > shortlisted.ordinal,
  );

  function submit() {
    setError(null);
    if (!toStage) {
      setError("Choose a stage.");
      return;
    }
    if (needsScreeningNote && !note.trim()) {
      setError(
        "Add an internal screening note before advancing past Shortlisted. Candidates never see this note.",
      );
      return;
    }
    const fd = new FormData();
    fd.set("application_id", applicationId);
    fd.set("to_stage", toStage);
    fd.set("note", note);
    fd.set("rejection_reason", reason);
    start(async () => {
      const res = await advanceStageAction(fd);
      if (!res.ok) {
        setError(res.error ?? "Could not update.");
        return;
      }
      setToStage("");
      setNote("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Move candidate</CardTitle>
        <Badge tone="neutral">Now: {stageByKey(currentStage)?.label ?? currentStage}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Change stage to" htmlFor="to-stage">
          <Select id="to-stage" value={toStage} onChange={(e) => setToStage(e.target.value)}>
            <option value="">Select…</option>
            {CANDIDATE_STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
            <option value="rejected">Reject candidate</option>
          </Select>
        </Field>
        {isReject ? (
          <Field label="Rejection reason" htmlFor="reason" required>
            <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select a reason…</option>
              {REJECTION_REASONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field
          label={needsScreeningNote ? "Internal screening note" : "Internal note (optional)"}
          htmlFor="stage-note"
          hint="Never shown to the candidate. Used for recruiter/franchise records only."
          required={needsScreeningNote}
        >
          <Textarea
            id="stage-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add internal context for this change…"
            className="min-h-[64px]"
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button
            onClick={submit}
            disabled={pending}
            variant={isReject ? "danger" : "primary"}
            size="sm"
          >
            {pending ? "Saving…" : isReject ? "Reject" : "Move forward"}
          </Button>
          {needsScreeningNote ? (
            <p className="text-xs text-ink-subtle">
              Required to advance past Shortlisted — candidates never see this.
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

export function NoteForm({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("franchise_internal");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!body.trim()) return;
    const fd = new FormData();
    fd.set("application_id", applicationId);
    fd.set("body", body);
    fd.set("visibility", visibility);
    start(async () => {
      const res = await addNoteAction(fd);
      if (!res.ok) {
        setError(res.error ?? "Could not save.");
        return;
      }
      setBody("");
      setError(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a recruiter note (never visible to the candidate or employer)…"
        className="min-h-[72px]"
      />
      <div className="flex items-center gap-2">
        <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="w-52">
          <option value="recruiter_private">Private to me</option>
          <option value="franchise_internal">Franchise internal</option>
          <option value="hq_accessible">HQ-accessible</option>
        </Select>
        <Button onClick={submit} disabled={pending || !body.trim()} size="sm">
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </div>
  );
}

export function SubmissionButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const fd = new FormData();
    fd.set("application_id", applicationId);
    fd.set("summary", summary);
    start(async () => {
      const res = await createSubmissionAction(fd);
      if (!res.ok) {
        setError(res.error ?? "Could not create.");
        return;
      }
      setOpen(false);
      setError(null);
      router.refresh();
    });
  }

  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Prepare client submission
      </Button>
    );
  return (
    <div className="space-y-2 rounded-lg border border-surface-border bg-surface-muted p-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Client-facing summary" htmlFor="sub-summary">
        <Textarea
          id="sub-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Why this candidate fits the role (employer will see this)."
          className="min-h-[64px]"
        />
      </Field>
      <p className="text-xs text-ink-subtle">
        A masked, view-only submission is created. If the candidate hasn&apos;t given
        employer-specific consent, it stays pending until they approve — the employer cannot see it
        before then.
      </p>
      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending} size="sm">
          {pending ? "Creating…" : "Create submission"}
        </Button>
        <Button onClick={() => setOpen(false)} variant="ghost" size="sm">
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ViewCvButton({
  bucketId,
  objectPath,
  label,
}: {
  bucketId: string;
  objectPath: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  function open() {
    start(async () => {
      const supabase = createClient();
      const { data } = await supabase.storage.from(bucketId).createSignedUrl(objectPath, 120);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    });
  }
  return (
    <Button variant="ghost" size="sm" onClick={open} disabled={pending}>
      {pending ? "Opening…" : label}
    </Button>
  );
}

export function VideoInterviewCard({
  applicationId,
  templates,
  assignments,
  layout = "sidebar",
}: {
  applicationId: string;
  templates: InterviewTemplateRow[];
  assignments: InterviewAssignmentRow[];
  /** Spotlight = main column, larger review affordance for submitted responses. */
  layout?: "sidebar" | "spotlight";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const defaultDeadline = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [deadlineDaysByTemplate] = useState(() =>
    Object.fromEntries(templates.map((t) => [t.id, t.default_deadline_days ?? 7])),
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const suggestedDeadline = useMemo(() => {
    const days = deadlineDaysByTemplate[selectedTemplateId] ?? 7;
    return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  }, [deadlineDaysByTemplate, selectedTemplateId]);
  const spotlight = layout === "spotlight";
  const awaitingReview = assignments.filter((a) => a.status === "submitted");
  const alreadyCompleted = assignments.some(
    (a) => a.status === "submitted" || a.status === "reviewed",
  );
  const canAssign = templates.length > 0 && !alreadyCompleted;
  const sortedAssignments = useMemo(() => {
    const rank = (status: string) =>
      status === "submitted" ? 0 : status === "reviewed" ? 1 : status === "in_progress" ? 2 : 3;
    return [...assignments].sort((a, b) => rank(a.status) - rank(b.status));
  }, [assignments]);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error ?? "Could not update interview.");
      done?.();
      router.refresh();
    });
  }

  return (
    <Card className={spotlight ? "border-brand-200 shadow-sm" : undefined}>
      <CardHeader>
        <div>
          <CardTitle>Video interview</CardTitle>
          {spotlight && awaitingReview.length > 0 ? (
            <p className="mt-0.5 text-sm text-ink-muted">
              {awaitingReview.length === 1
                ? "New responses are ready for review."
                : `${awaitingReview.length} interviews awaiting review.`}
            </p>
          ) : alreadyCompleted ? (
            <p className="mt-0.5 text-sm text-ink-muted">
              This candidate has already completed their video interview for this application.
            </p>
          ) : null}
        </div>
        {!open && canAssign ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Assign
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {sortedAssignments.length ? (
          <ul className={spotlight ? "space-y-3" : "space-y-2"}>
            {sortedAssignments.map((assignment) => {
              const badge = interviewReviewBadge(assignment.status);
              const canPlay = assignment.status === "submitted" || assignment.status === "reviewed";
              return (
                <li
                  key={assignment.id}
                  className={
                    spotlight
                      ? "rounded-xl border border-surface-border bg-surface-muted/40 p-4"
                      : "rounded-lg border border-surface-border p-3"
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p
                        className={
                          spotlight
                            ? "text-base font-semibold text-ink"
                            : "text-sm font-medium text-ink"
                        }
                      >
                        {assignment.template_name_snapshot}
                      </p>
                      <p className="text-xs text-ink-subtle">
                        {assignment.submitted_at
                          ? `Submitted ${formatDate(assignment.submitted_at)}`
                          : `Due ${formatDate(assignment.expires_at)}`}
                      </p>
                    </div>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  <div className={`flex flex-wrap gap-2 ${spotlight ? "mt-3" : "mt-2"}`}>
                    {canPlay ? (
                      <Link
                        href={`/recruiter/interviews/${assignment.id}`}
                        className={
                          spotlight
                            ? "inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                            : "inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
                        }
                      >
                        <PlayCircle className={spotlight ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
                        {assignment.status === "submitted"
                          ? "Review recordings"
                          : "View recordings"}
                      </Link>
                    ) : (
                      <Link
                        href={`/recruiter/interviews/${assignment.id}`}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        Open interview
                      </Link>
                    )}
                    {["draft", "invited", "in_progress"].includes(assignment.status) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => {
                          if (!window.confirm("Cancel this interview invitation?")) return;
                          const data = new FormData();
                          data.set("assignment_id", assignment.id);
                          run(() => cancelAssignmentAction(data));
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : !open ? (
          <p className="text-sm text-ink-subtle">No video interview assigned.</p>
        ) : null}
        {!templates.length ? (
          <p className="text-sm text-ink-muted">
            Create an active{" "}
            <Link href="/recruiter/interview-templates" className="text-brand-700 hover:underline">
              interview template
            </Link>{" "}
            first.
          </p>
        ) : null}
        {open && canAssign ? (
          <form
            className="space-y-3 rounded-lg bg-surface-muted p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              data.set("application_id", applicationId);
              run(
                () => createAssignmentAction(data),
                () => setOpen(false),
              );
            }}
          >
            <Field label="Template" htmlFor="interview-template" required>
              <Select
                id="interview-template"
                name="template_id"
                required
                defaultValue=""
                onChange={(event) => setSelectedTemplateId(event.target.value)}
              >
                <option value="" disabled>
                  Select a template…
                </option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.default_deadline_days ?? 7}d deadline)
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Submission deadline"
              htmlFor="interview-deadline"
              hint="End of the selected local day. Suggested from the template deadline setting."
              required
            >
              <Input
                id="interview-deadline"
                name="expires_at"
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                key={suggestedDeadline}
                defaultValue={selectedTemplateId ? suggestedDeadline : defaultDeadline}
                required
              />
            </Field>
            <Field label="Additional instructions" htmlFor="interview-instructions">
              <Textarea
                id="interview-instructions"
                name="candidate_instructions"
                className="min-h-[64px]"
                maxLength={2000}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Assigning…" : "Send invitation"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
