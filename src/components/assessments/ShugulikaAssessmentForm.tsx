"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitShugulikaAssessmentAction } from "@/app/candidate/assessment-actions";
import { Alert, Button } from "@/components/ui/primitives";
import { Field, Textarea } from "@/components/ui/form";
import type { CandidateFacingQuestion } from "@/lib/assessments/question-bank-types";

export function ShugulikaAssessmentForm({
  assignmentId,
  questions,
}: {
  assignmentId: string;
  questions: CandidateFacingQuestion[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        setWarning(null);
        startTransition(async () => {
          const result = await submitShugulikaAssessmentAction(assignmentId, formData);
          if (!result.ok) {
            setError(result.error ?? "Could not submit assessment.");
            return;
          }
          if (result.warning) setWarning(result.warning);
          router.push("/candidate/assessments");
          router.refresh();
        });
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {warning ? <Alert tone="warn">{warning}</Alert> : null}
      {questions.map((question, index) => (
        <div key={question.id} className="rounded-lg border border-surface-border bg-white p-4">
          <p className="text-sm font-medium text-ink">
            {index + 1}. {question.prompt}
          </p>
          <p className="mt-1 text-xs text-ink-subtle">{question.points} point(s)</p>
          {question.kind === "mcq" ? (
            <div className="mt-3 space-y-2">
              {question.choices.map((choice) => (
                <label
                  key={choice.id}
                  className="flex cursor-pointer items-start gap-2 text-sm text-ink-muted"
                >
                  <input
                    type="radio"
                    name={`mcq_${question.id}`}
                    value={choice.id}
                    required
                    className="mt-1"
                    disabled={pending}
                  />
                  <span>{choice.label}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="mt-3">
              <Field label="Your answer" htmlFor={`fr_${question.id}`} required>
                <Textarea
                  id={`fr_${question.id}`}
                  name={`fr_${question.id}`}
                  required
                  minLength={40}
                  rows={5}
                  disabled={pending}
                  placeholder="Write a clear, structured answer…"
                />
              </Field>
            </div>
          )}
        </div>
      ))}
      <Button type="submit" disabled={pending}>
        {pending ? "Submitting & grading…" : "Submit assessment"}
      </Button>
    </form>
  );
}
