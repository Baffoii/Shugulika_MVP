"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { Checkbox } from "@/components/ui/form";
import { startInterviewAction } from "@/app/candidate/interview-actions";

export function StartInterviewForm({
  assignmentId,
  alreadyStarted,
}: {
  assignmentId: string;
  alreadyStarted: boolean;
}) {
  const router = useRouter();
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function continueToInterview() {
    setError(null);
    startTransition(async () => {
      if (!alreadyStarted) {
        const result = await startInterviewAction(assignmentId, consented);
        if (!result.ok) {
          setError(result.error ?? "Could not start the interview.");
          return;
        }
      }
      router.push(`/candidate/interviews/${assignmentId}/session`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recording and privacy notice</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="space-y-2 text-sm text-ink-muted">
          <p>
            Your camera and microphone will record your responses. Authorized Shugulika recruiters
            working on this application may review the recordings to assess your application.
          </p>
          <p>
            Recordings are collected only for this recruitment process and retained for the period
            shown in the invitation. You may contact Shugulika for technical help, access requests,
            or other applicable privacy rights.
          </p>
          <p className="font-medium text-ink">
            This MVP does not use facial analysis, emotion recognition, personality analysis, lie
            detection, or automated hiring recommendations.
          </p>
        </div>

        {error ? <Alert tone="danger">{error}</Alert> : null}

        {!alreadyStarted ? (
          <Checkbox
            checked={consented}
            onChange={(event) => setConsented(event.target.checked)}
            label="I understand the notice above and consent to recording my interview responses."
          />
        ) : (
          <Alert tone="info">
            Your interview is already in progress. Continue from your last completed question.
          </Alert>
        )}

        <Button
          type="button"
          onClick={continueToInterview}
          disabled={pending || (!alreadyStarted && !consented)}
        >
          {pending
            ? "Opening interview…"
            : alreadyStarted
              ? "Continue interview"
              : "Start device check"}
        </Button>
      </CardBody>
    </Card>
  );
}
