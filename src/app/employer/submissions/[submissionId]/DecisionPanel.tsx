"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideSubmissionAction, addEmployerCommentAction } from "@/app/employer/actions";
import { Button, Alert } from "@/components/ui/primitives";
import { Field, Select, Textarea } from "@/components/ui/form";

const DECISIONS = [
  { key: "shortlisted", label: "Shortlist" },
  { key: "interview_requested", label: "Request interview" },
  { key: "rejected", label: "Reject" },
];

export function DecisionPanel({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    if (!decision) { setError("Choose a decision."); return; }
    const fd = new FormData();
    fd.set("submission_id", submissionId);
    fd.set("decision", decision);
    fd.set("reason", reason);
    start(async () => {
      const res = await decideSubmissionAction(fd);
      if (!res.ok) { setError(res.error ?? "Could not save."); return; }
      setDecision(""); setReason(""); router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Decision" htmlFor="decision">
        <Select id="decision" value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="">Select…</option>
          {DECISIONS.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
        </Select>
      </Field>
      {decision === "rejected" ? (
        <Field label="Reason (required)" htmlFor="reason" required>
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[64px]" />
        </Field>
      ) : null}
      <Button onClick={submit} disabled={pending} variant={decision === "rejected" ? "danger" : "primary"} size="sm">
        {pending ? "Saving…" : "Record decision"}
      </Button>
    </div>
  );
}

export function CommentForm({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  function submit() {
    if (!body.trim()) return;
    const fd = new FormData();
    fd.set("submission_id", submissionId);
    fd.set("body", body);
    start(async () => {
      await addEmployerCommentAction(fd);
      setBody(""); router.refresh();
    });
  }
  return (
    <div className="space-y-2">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment for the recruiter…" className="min-h-[64px]" />
      <Button onClick={submit} size="sm" variant="outline" disabled={pending || !body.trim()}>{pending ? "Saving…" : "Add comment"}</Button>
    </div>
  );
}
