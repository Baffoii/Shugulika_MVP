"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  openAssessmentAction,
  submitEmployerAssessmentAction,
} from "@/app/candidate/assessment-actions";
import { Button, ButtonLink, Alert } from "@/components/ui/primitives";

export function CandidateAssessmentActions({
  assignmentId,
  mode,
  status,
}: {
  assignmentId: string;
  jobOrderId: string;
  mode: "shugulika" | "employer" | "both";
  status: string;
  fileName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const closed = ["submitted", "graded", "cancelled", "expired"].includes(status);
  const includesShugulika = mode === "shugulika" || mode === "both";
  const includesEmployer = mode === "employer" || mode === "both";

  return (
    <div className="flex max-w-md flex-col gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!closed ? (
        <div className="flex flex-wrap gap-2">
          {includesShugulika || includesEmployer ? (
            <ButtonLink href={`/candidate/assessments/${assignmentId}`} size="sm">
              {status === "assigned" ? "Begin assessment" : "Continue assessment"}
            </ButtonLink>
          ) : null}
          {mode === "employer" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  await openAssessmentAction(assignmentId);
                  const result = await submitEmployerAssessmentAction(assignmentId);
                  if (!result.ok) {
                    setError(result.error ?? "Could not submit.");
                    return;
                  }
                  router.refresh();
                });
              }}
            >
              {pending ? "Submitting…" : "Mark employer test submitted"}
            </Button>
          ) : null}
        </div>
      ) : (
        <ButtonLink href={`/candidate/assessments/${assignmentId}`} size="sm" variant="outline">
          View result
        </ButtonLink>
      )}
    </div>
  );
}
