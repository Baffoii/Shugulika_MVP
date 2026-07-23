"use client";

import { useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { getStaffAnswerKey } from "@/lib/assessments/question-banks";
import type { AssessmentSeniority } from "@/lib/assessments/question-bank-types";

/** Recruiters and HQ can inspect absolute MCQ keys and free-response rubrics. */
export function ShugulikaAnswerKeyPanel({ seniority }: { seniority: AssessmentSeniority }) {
  const [open, setOpen] = useState(false);
  const bank = getStaffAnswerKey(seniority);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shugulika answer key</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "View answer key & rubric"}
        </Button>
      </CardHeader>
      {open ? (
        <CardBody className="space-y-4">
          <p className="text-sm text-ink-muted">
            {bank.title}. Pass threshold {bank.passThresholdPercent}%. Candidates never see these
            keys.
          </p>
          {bank.questions.map((question, index) => (
            <div
              key={question.id}
              className="rounded-lg border border-surface-border bg-surface-muted/40 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-ink">
                  {index + 1}. {question.prompt}
                </p>
                <Badge tone={question.kind === "mcq" ? "info" : "warn"}>
                  {question.kind === "mcq" ? "MCQ" : "Free response"}
                </Badge>
              </div>
              {question.kind === "mcq" ? (
                <ul className="mt-2 space-y-1 text-ink-muted">
                  {question.choices.map((choice) => {
                    const correct = question.correctChoiceIds.includes(choice.id);
                    return (
                      <li key={choice.id} className={correct ? "font-semibold text-brand-800" : ""}>
                        {choice.id.toUpperCase()}. {choice.label}
                        {correct ? " ✓ correct" : ""}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-2 space-y-2 text-ink-muted">
                  <p className="font-medium text-ink">Rubric</p>
                  {question.rubric.criteria.map((criterion) => (
                    <div key={criterion.id}>
                      <p className="font-medium text-ink">
                        {criterion.label} (max {criterion.maxPoints})
                      </p>
                      <p>{criterion.guidance}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardBody>
      ) : null}
    </Card>
  );
}
