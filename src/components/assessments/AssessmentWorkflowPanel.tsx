"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignAssessmentAction } from "@/app/recruiter/actions";
import { getEmployerAssessmentUrlAction } from "@/app/job-order-actions";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { ShugulikaAnswerKeyPanel } from "@/components/assessments/ShugulikaAnswerKeyPanel";
import type { AssessmentAssignmentRow } from "@/lib/database.types";
import { formatDate, titleCase } from "@/lib/format";

export function AssessmentWorkflowPanel({
  applicationId,
  jobOrderId,
  currentStage,
  mode,
  seniority,
  passThreshold,
  employerFileName,
  employerFiles = [],
  assignment,
}: {
  applicationId: string;
  jobOrderId: string;
  currentStage: string;
  mode: "shugulika" | "employer" | "both";
  seniority: "junior" | "senior";
  passThreshold: number;
  employerFileName: string | null;
  employerFiles?: Array<{ id: string; file_name: string; kind: "candidate_test" | "answer_key" }>;
  assignment: AssessmentAssignmentRow | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const includesEmployer = mode === "employer" || mode === "both";
  const includesShugulika = mode === "shugulika" || mode === "both";
  const candidateFiles = employerFiles.filter((file) => file.kind === "candidate_test");
  const answerKeyFiles = employerFiles.filter((file) => file.kind === "answer_key");

  function assign() {
    const form = new FormData();
    form.set("application_id", applicationId);
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await assignAssessmentAction(form);
      if (!result.ok) setError(result.error ?? "Could not assign assessment.");
      else {
        if (result.warning) setWarning(result.warning);
        router.refresh();
      }
    });
  }

  function openFile(fileId?: string) {
    setError(null);
    startTransition(async () => {
      const result = await getEmployerAssessmentUrlAction(jobOrderId, fileId);
      if (!result.ok || !result.url) {
        setError(result.error ?? "Could not open assessment.");
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Aptitude assessment</CardTitle>
          <Badge tone={assignment ? "success" : "neutral"}>
            {assignment ? titleCase(assignment.status) : "Not assigned"}
          </Badge>
        </CardHeader>
        <CardBody className="space-y-3">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {warning ? <Alert tone="warn">{warning}</Alert> : null}
          <div className="text-sm text-ink-muted">
            <p>
              <span className="font-medium text-ink">Plan:</span>{" "}
              {mode === "both"
                ? "Shugulika + employer tests"
                : mode === "employer"
                  ? "Employer test"
                  : "Shugulika test"}
            </p>
            <p>
              <span className="font-medium text-ink">Level:</span> {titleCase(seniority)}
            </p>
            <p>
              <span className="font-medium text-ink">Pass threshold:</span> {passThreshold}%
            </p>
            {assignment?.due_at ? (
              <p>
                <span className="font-medium text-ink">Deadline:</span>{" "}
                {formatDate(assignment.due_at)}
              </p>
            ) : null}
            {assignment?.score != null ? (
              <p>
                <span className="font-medium text-ink">Score:</span> {assignment.score}%
                {assignment.result_band ? ` (${assignment.result_band})` : ""}
              </p>
            ) : null}
            {assignment?.human_review_required ? (
              <Alert tone="warn">
                Free-response grading needs human review before any reject decision.
              </Alert>
            ) : null}
          </div>
          {includesEmployer ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Candidate-facing employer files
              </p>
              <div className="flex flex-wrap gap-2">
                {candidateFiles.length ? (
                  candidateFiles.map((file) => (
                    <Button
                      key={file.id}
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => openFile(file.id)}
                    >
                      Open {file.file_name}
                    </Button>
                  ))
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || !employerFileName}
                    onClick={() => openFile()}
                  >
                    Open employer test{employerFileName ? ` — ${employerFileName}` : ""}
                  </Button>
                )}
              </div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Answer keys (staff only)
              </p>
              <div className="flex flex-wrap gap-2">
                {answerKeyFiles.length ? (
                  answerKeyFiles.map((file) => (
                    <Button
                      key={file.id}
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => openFile(file.id)}
                    >
                      Open key — {file.file_name}
                    </Button>
                  ))
                ) : (
                  <p className="text-xs text-ink-subtle">No separate answer-key files attached.</p>
                )}
              </div>
            </div>
          ) : null}
          {!assignment ? (
            currentStage === "testing" ? (
              <>
                <Alert tone="warn">
                  This candidate is in Testing but has no assignment yet. Send it so they can open
                  Assessments.
                </Alert>
                <Button size="sm" disabled={pending} onClick={assign}>
                  {pending ? "Sending…" : "Send assessment to candidate"}
                </Button>
              </>
            ) : (
              <Alert tone="info">
                Moving the candidate to Testing delivers the assessment automatically.
              </Alert>
            )
          ) : (
            <Alert tone="success">
              The candidate can take this assessment under Assessments. Moving into Testing delivers
              it automatically; use Send only if delivery failed.
            </Alert>
          )}
        </CardBody>
      </Card>
      {includesShugulika ? <ShugulikaAnswerKeyPanel seniority={seniority} /> : null}
    </div>
  );
}
