"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceStageAction, addNoteAction, createSubmissionAction } from "@/app/recruiter/actions";
import { Card, CardHeader, CardTitle, CardBody, Button, Alert, Badge } from "@/components/ui/primitives";
import { Field, Select, Textarea } from "@/components/ui/form";
import { CANDIDATE_STAGES, REJECTION_REASONS, stageByKey } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

export function StageControl({ applicationId, currentStage }: { applicationId: string; currentStage: string }) {
  const router = useRouter();
  const [toStage, setToStage] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isReject = toStage === "rejected";

  function submit() {
    setError(null);
    if (!toStage) { setError("Choose a stage."); return; }
    const fd = new FormData();
    fd.set("application_id", applicationId);
    fd.set("to_stage", toStage);
    fd.set("note", note);
    fd.set("rejection_reason", reason);
    start(async () => {
      const res = await advanceStageAction(fd);
      if (!res.ok) { setError(res.error ?? "Could not update."); return; }
      setToStage(""); setNote(""); setReason("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle>Move candidate</CardTitle><Badge tone="neutral">Now: {stageByKey(currentStage)?.label ?? currentStage}</Badge></CardHeader>
      <CardBody className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Change stage to" htmlFor="to-stage">
          <Select id="to-stage" value={toStage} onChange={(e) => setToStage(e.target.value)}>
            <option value="">Select…</option>
            {CANDIDATE_STAGES.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
            <option value="rejected">Reject candidate</option>
          </Select>
        </Field>
        {isReject ? (
          <Field label="Rejection reason" htmlFor="reason" required>
            <Select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Select a reason…</option>
              {REJECTION_REASONS.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
            </Select>
          </Field>
        ) : null}
        <Field label="Note (optional)" htmlFor="stage-note">
          <Textarea id="stage-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add context for this change…" className="min-h-[64px]" />
        </Field>
        <div className="flex items-center gap-2">
          <Button onClick={submit} disabled={pending} variant={isReject ? "danger" : "primary"} size="sm">
            {pending ? "Saving…" : isReject ? "Reject" : "Move forward"}
          </Button>
          <p className="text-xs text-ink-subtle">A screening note is required before advancing past Shortlisted.</p>
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
      if (!res.ok) { setError(res.error ?? "Could not save."); return; }
      setBody(""); setError(null); router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a recruiter note (never visible to the candidate or employer)…" className="min-h-[72px]" />
      <div className="flex items-center gap-2">
        <Select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="w-52">
          <option value="recruiter_private">Private to me</option>
          <option value="franchise_internal">Franchise internal</option>
          <option value="hq_accessible">HQ-accessible</option>
        </Select>
        <Button onClick={submit} disabled={pending || !body.trim()} size="sm">{pending ? "Saving…" : "Add note"}</Button>
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
      if (!res.ok) { setError(res.error ?? "Could not create."); return; }
      setOpen(false); setError(null); router.refresh();
    });
  }

  if (!open) return <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Prepare client submission</Button>;
  return (
    <div className="space-y-2 rounded-lg border border-surface-border bg-surface-muted p-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Client-facing summary" htmlFor="sub-summary">
        <Textarea id="sub-summary" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Why this candidate fits the role (employer will see this)." className="min-h-[64px]" />
      </Field>
      <p className="text-xs text-ink-subtle">
        A masked, view-only submission is created. If the candidate hasn&apos;t given employer-specific consent, it stays pending until they approve — the employer
        cannot see it before then.
      </p>
      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending} size="sm">{pending ? "Creating…" : "Create submission"}</Button>
        <Button onClick={() => setOpen(false)} variant="ghost" size="sm">Cancel</Button>
      </div>
    </div>
  );
}

export function ViewCvButton({ bucketId, objectPath, label }: { bucketId: string; objectPath: string; label: string }) {
  const [pending, start] = useTransition();
  function open() {
    start(async () => {
      const supabase = createClient();
      const { data } = await supabase.storage.from(bucketId).createSignedUrl(objectPath, 120);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    });
  }
  return <Button variant="ghost" size="sm" onClick={open} disabled={pending}>{pending ? "Opening…" : label}</Button>;
}
