"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  advanceStageAction,
  addNoteAction,
  markTestingSubmittedAction,
  markInterviewCompleteAction,
} from "@/app/recruiter/actions";
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
  REJECTION_REASONS,
  interviewReviewBadge,
  stageByKey,
  allowedNextStages,
} from "@/lib/constants";
import type { InterviewAssignmentRow, InterviewTemplateRow } from "@/lib/database.types";
import { formatDate, titleCase } from "@/lib/format";
import Link from "next/link";
import { PlayCircle } from "lucide-react";
import { ViewCvButton } from "@/components/documents/ViewCvButton";

export { ViewCvButton };

export function StageControl({
  applicationId,
  currentStage,
  rejectedFromStage,
  rejectionReason,
  withdrawnAt,
  testName: initialTestName,
  testScore: initialTestScore,
  assessmentScore,
}: {
  applicationId: string;
  currentStage: string;
  rejectedFromStage?: string | null;
  rejectionReason?: string | null;
  withdrawnAt?: string | null;
  testName?: string | null;
  testScore?: string | null;
  /** Graded aptitude percent — auto-fills Test score when present. */
  assessmentScore?: number | null;
}) {
  const router = useRouter();
  const [toStage, setToStage] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [testName, setTestName] = useState(initialTestName?.trim() || "Skills assessment");
  const [testScore, setTestScore] = useState(
    initialTestScore?.trim() || (assessmentScore != null ? String(assessmentScore) : ""),
  );
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isReject = toStage === "rejected";
  const nextStages = useMemo(() => allowedNextStages(currentStage), [currentStage]);
  const isRejected = currentStage === "rejected";
  const isTesting = currentStage === "testing";
  const isInterviewScreening = currentStage === "interview_screening";
  const isWithdrawn = Boolean(withdrawnAt);

  useEffect(() => {
    if (initialTestName?.trim()) setTestName(initialTestName.trim());
  }, [initialTestName]);

  useEffect(() => {
    if (assessmentScore != null) {
      setTestScore(String(assessmentScore));
      return;
    }
    if (initialTestScore?.trim()) setTestScore(initialTestScore.trim());
  }, [assessmentScore, initialTestScore]);

  if (isWithdrawn) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pipeline stage</CardTitle>
        </CardHeader>
        <CardBody>
          <Alert tone="warn" title="Application withdrawn">
            Stage changes are paused while the candidate&apos;s application is withdrawn. If they
            reapply, it returns to CV Review.
          </Alert>
        </CardBody>
      </Card>
    );
  }
  function run(
    action: (fd: FormData) => Promise<{ ok: boolean; error?: string; warning?: string }>,
    extra?: Record<string, string>,
  ) {
    setError(null);
    setWarning(null);
    const fd = new FormData();
    fd.set("application_id", applicationId);
    fd.set("note", note);
    if (extra) {
      for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    }
    start(async () => {
      const res = await action(fd);
      if (!res.ok) {
        setError(res.error ?? "Could not update.");
        return;
      }
      setToStage("");
      setNote("");
      setReason("");
      if (res.warning) setWarning(res.warning);
      router.refresh();
    });
  }

  function submit() {
    if (!toStage) {
      setError("Choose a stage.");
      return;
    }
    if (isReject && !reason) {
      setError("A rejection reason is required.");
      return;
    }
    run(advanceStageAction, {
      to_stage: toStage,
      rejection_reason: reason,
    });
  }

  if (isRejected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Move candidate</CardTitle>
          <Badge tone="danger">Rejected</Badge>
        </CardHeader>
        <CardBody className="space-y-2">
          <Alert tone="danger">
            This candidate was rejected
            {rejectedFromStage
              ? ` during ${stageByKey(rejectedFromStage)?.label ?? titleCase(rejectedFromStage)}`
              : ""}
            . Rejection is permanent and cannot be undone.
          </Alert>
          {rejectionReason ? (
            <p className="text-sm text-ink-muted">Reason: {rejectionReason}</p>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Move candidate</CardTitle>
        <Badge tone="neutral">Now: {stageByKey(currentStage)?.label ?? currentStage}</Badge>
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {warning ? <Alert tone="warn">{warning}</Alert> : null}

        {isTesting ? (
          <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3 space-y-3">
            <p className="text-sm text-ink">
              When the candidate submits their assessment, mark it submitted to move them to{" "}
              <span className="font-medium">Test Review / Grading</span>. The test score fills in
              automatically after you grade free-response answers.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Test name">
                <Input
                  value={testName}
                  onChange={(e) => setTestName(e.target.value)}
                  placeholder="Skills assessment"
                />
              </Field>
              <Field
                label="Test score"
                hint={
                  assessmentScore != null
                    ? "Synced from the aptitude assessment grade."
                    : "Appears here after free-response review is saved."
                }
              >
                <Input
                  value={testScore}
                  onChange={(e) => setTestScore(e.target.value)}
                  placeholder="Fills in after grading"
                  readOnly={assessmentScore != null}
                />
              </Field>
            </div>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(markTestingSubmittedAction, {
                  test_name: testName.trim(),
                  test_score: testScore.trim(),
                })
              }
            >
              {pending ? "Saving…" : "Mark testing submitted"}
            </Button>
          </div>
        ) : null}

        {isInterviewScreening ? (
          <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3 space-y-2">
            <p className="text-sm text-ink">
              When the interview is finished, mark it complete to move them to{" "}
              <span className="font-medium">Interview Review</span> automatically.
            </p>
            <Button size="sm" disabled={pending} onClick={() => run(markInterviewCompleteAction)}>
              {pending ? "Saving…" : "Mark interview complete"}
            </Button>
          </div>
        ) : null}

        <Field label="Change stage to" htmlFor="to-stage">
          <Select id="to-stage" value={toStage} onChange={(e) => setToStage(e.target.value)}>
            <option value="">Select…</option>
            {nextStages.map((s) => (
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
          label="Internal note (optional)"
          htmlFor="stage-note"
          hint="Never shown to the candidate. Used for recruiter/franchise records only."
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
            disabled={pending || !toStage}
            variant={isReject ? "danger" : "primary"}
            size="sm"
          >
            {pending ? "Saving…" : isReject ? "Reject permanently" : "Move forward"}
          </Button>
          <p className="text-xs text-ink-subtle">
            Forward only — earlier stages are not available.
          </p>
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
