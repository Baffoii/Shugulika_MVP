"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Alert } from "@/components/ui/primitives";
import { Select, Textarea } from "@/components/ui/form";
import { requestCandidateSupportAction } from "@/app/candidate/progress-actions";
import type { CandidateHelpRequestType } from "@/lib/candidate/constants";

interface SubjectOption {
  type: "application" | "assessment" | "interview";
  id: string;
  label: string;
}

export function HelpRequestForm({
  candidateId,
  subjects,
}: {
  candidateId: string;
  subjects: SubjectOption[];
}) {
  const [requestType, setRequestType] = useState<CandidateHelpRequestType>("help");
  const [subjectKey, setSubjectKey] = useState(
    subjects[0] ? `${subjects[0].type}:${subjects[0].id}` : "",
  );
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = useMemo(
    () => subjects.find((subject) => `${subject.type}:${subject.id}` === subjectKey),
    [subjectKey, subjects],
  );

  function submit() {
    startTransition(async () => {
      const duplicate = requestType === "duplicate_review";
      if (!duplicate && !selected) {
        setResult({ ok: false, message: "Choose the application, assessment, or interview." });
        return;
      }
      const response = await requestCandidateSupportAction({
        requestType,
        subjectType: duplicate ? "candidate" : (selected?.type ?? "candidate"),
        subjectId: duplicate ? candidateId : (selected?.id ?? candidateId),
        message,
      });
      setResult({
        ok: response.ok,
        message: response.error ?? response.message ?? "Request sent.",
      });
      if (response.ok) setMessage("");
    });
  }

  return (
    <div className="space-y-4">
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <label className="block text-sm text-ink">
        Request type
        <Select
          className="mt-1"
          value={requestType}
          onChange={(event) => setRequestType(event.target.value as CandidateHelpRequestType)}
        >
          <option value="help">Technical or accessibility help</option>
          <option value="reschedule">Request a reschedule</option>
          <option value="duplicate_review">Request duplicate account review</option>
        </Select>
      </label>
      {requestType !== "duplicate_review" ? (
        <label className="block text-sm text-ink">
          Related item
          <Select
            className="mt-1"
            value={subjectKey}
            onChange={(event) => setSubjectKey(event.target.value)}
          >
            {subjects.map((subject) => (
              <option key={`${subject.type}:${subject.id}`} value={`${subject.type}:${subject.id}`}>
                {subject.label}
              </option>
            ))}
          </Select>
        </label>
      ) : (
        <Alert tone="info">
          Staff will review the accounts. This request never merges or deletes accounts
          automatically.
        </Alert>
      )}
      <label className="block text-sm text-ink">
        Tell us what you need
        <Textarea
          className="mt-1"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          minLength={10}
          maxLength={2000}
          placeholder={
            requestType === "reschedule"
              ? "Explain why you need a new time and suggest your availability."
              : requestType === "duplicate_review"
                ? "Describe the other account details you recognize. Do not include passwords."
                : "Describe the issue, device, browser, and any accessibility support you need."
          }
        />
      </label>
      <Button onClick={submit} disabled={pending || message.trim().length < 10}>
        {pending ? "Sending…" : "Send request to staff"}
      </Button>
    </div>
  );
}
