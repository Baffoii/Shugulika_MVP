"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeAssessmentReviewAction } from "@/app/recruiter/actions";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
} from "@/components/ui/primitives";
import { Field, Input, Textarea } from "@/components/ui/form";
import { getStaffAnswerKey } from "@/lib/assessments/question-banks";
import type { AssessmentSeniority } from "@/lib/assessments/question-bank-types";
import type { AssessmentAssignmentRow, Json } from "@/lib/database.types";

type McqResponse = { questionId: string; selectedChoiceIds: string[] };
type FrResponse = { questionId: string; text: string };
type FrGrade = {
  questionId: string;
  score: number;
  maxScore: number;
  percent: number;
  explanation: string;
  confidence: number;
  humanReviewRequired: boolean;
  model: string;
};

function asRecord(value: Json | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseResponses(value: Json): { mcq: McqResponse[]; freeResponse: FrResponse[] } {
  const root = asRecord(value);
  const mcqRaw = Array.isArray(root?.mcq) ? root.mcq : [];
  const frRaw = Array.isArray(root?.freeResponse) ? root.freeResponse : [];
  return {
    mcq: mcqRaw.flatMap((item) => {
      const row = asRecord(item as Json);
      if (!row || typeof row.questionId !== "string") return [];
      const selected = Array.isArray(row.selectedChoiceIds)
        ? row.selectedChoiceIds.filter((id): id is string => typeof id === "string")
        : [];
      return [{ questionId: row.questionId, selectedChoiceIds: selected }];
    }),
    freeResponse: frRaw.flatMap((item) => {
      const row = asRecord(item as Json);
      if (!row || typeof row.questionId !== "string") return [];
      return [{ questionId: row.questionId, text: typeof row.text === "string" ? row.text : "" }];
    }),
  };
}

function parseFrGrades(value: Json): FrGrade[] {
  const root = asRecord(value);
  const freeResponse = asRecord(root?.freeResponse as Json);
  const results = Array.isArray(freeResponse?.results) ? freeResponse.results : [];
  return results.flatMap((item) => {
    const row = asRecord(item as Json);
    if (!row || typeof row.questionId !== "string") return [];
    return [
      {
        questionId: row.questionId,
        score: typeof row.score === "number" ? row.score : 0,
        maxScore: typeof row.maxScore === "number" ? row.maxScore : 0,
        percent: typeof row.percent === "number" ? row.percent : 0,
        explanation: typeof row.explanation === "string" ? row.explanation : "",
        confidence: typeof row.confidence === "number" ? row.confidence : 0,
        humanReviewRequired: Boolean(row.humanReviewRequired),
        model: typeof row.model === "string" ? row.model : "none",
      },
    ];
  });
}

function parseRecruiterNotes(value: Json): string {
  const root = asRecord(value);
  const freeResponse = asRecord(root?.freeResponse as Json);
  const review = asRecord(freeResponse?.recruiterReview as Json);
  return typeof review?.notes === "string" ? review.notes : "";
}

function parseMcqCorrectness(value: Json): Map<string, boolean> {
  const root = asRecord(value);
  const mcq = asRecord(root?.mcq as Json);
  const items = Array.isArray(mcq?.items) ? mcq.items : [];
  const map = new Map<string, boolean>();
  for (const item of items) {
    const row = asRecord(item as Json);
    if (!row || typeof row.questionId !== "string") continue;
    map.set(row.questionId, Boolean(row.correct));
  }
  return map;
}

/** Staff-only review of submitted Shugulika answers, with free-response score entry. */
export function AssessmentResponseReview({
  assignment,
  seniority,
}: {
  assignment: AssessmentAssignmentRow;
  seniority: AssessmentSeniority;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(
    assignment.human_review_required || ["submitted", "graded"].includes(assignment.status),
  );
  const bank = getStaffAnswerKey(seniority);
  const responses = useMemo(() => parseResponses(assignment.responses), [assignment.responses]);
  const frGrades = useMemo(
    () => parseFrGrades(assignment.grading_payload),
    [assignment.grading_payload],
  );
  const mcqCorrect = useMemo(
    () => parseMcqCorrectness(assignment.grading_payload),
    [assignment.grading_payload],
  );
  const recruiterNotes = useMemo(
    () => parseRecruiterNotes(assignment.grading_payload),
    [assignment.grading_payload],
  );
  const frById = new Map(responses.freeResponse.map((item) => [item.questionId, item]));
  const mcqById = new Map(responses.mcq.map((item) => [item.questionId, item]));
  const gradeById = new Map(frGrades.map((item) => [item.questionId, item]));
  const canGrade = ["submitted", "graded"].includes(assignment.status);
  const alreadyGraded = assignment.status === "graded" && !assignment.human_review_required;

  const hasAnswers = responses.mcq.length > 0 || responses.freeResponse.length > 0;
  if (!hasAnswers && !["submitted", "graded"].includes(assignment.status)) {
    return null;
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await completeAssessmentReviewAction(formData);
      if (!result.ok) setError(result.error ?? "Could not save review.");
      else router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Candidate answers</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide answers" : "Review answers"}
        </Button>
      </CardHeader>
      {open ? (
        <CardBody className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {!hasAnswers ? (
            <Alert tone="warn">No stored answers for this assignment yet.</Alert>
          ) : (
            <form
              key={`${assignment.id}-${assignment.graded_at ?? ""}-${assignment.score ?? ""}`}
              onSubmit={(event) => {
                event.preventDefault();
                submit(new FormData(event.currentTarget));
              }}
              className="space-y-4"
            >
              <input type="hidden" name="assignment_id" value={assignment.id} />
              {bank.questions.map((question, index) => {
                if (question.kind === "mcq") {
                  const answer = mcqById.get(question.id);
                  const selected = new Set(answer?.selectedChoiceIds ?? []);
                  const correct = mcqCorrect.get(question.id);
                  return (
                    <div
                      key={question.id}
                      className="rounded-lg border border-surface-border bg-surface-muted/40 p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">
                          {index + 1}. {question.prompt}
                        </p>
                        <Badge tone="info">MCQ</Badge>
                        {correct != null ? (
                          <Badge tone={correct ? "success" : "danger"}>
                            {correct ? "Correct" : "Incorrect"}
                          </Badge>
                        ) : null}
                      </div>
                      <ul className="mt-2 space-y-1 text-ink-muted">
                        {question.choices.map((choice) => {
                          const picked = selected.has(choice.id);
                          const isKey = question.correctChoiceIds.includes(choice.id);
                          return (
                            <li
                              key={choice.id}
                              className={
                                picked
                                  ? "font-semibold text-ink"
                                  : isKey
                                    ? "text-brand-800"
                                    : undefined
                              }
                            >
                              {choice.id.toUpperCase()}. {choice.label}
                              {picked ? " ← candidate" : ""}
                              {isKey ? " ✓ key" : ""}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                }

                const answer = frById.get(question.id);
                const ai = gradeById.get(question.id);
                return (
                  <div
                    key={question.id}
                    className="rounded-lg border border-surface-border bg-surface-muted/40 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">
                        {index + 1}. {question.prompt}
                      </p>
                      <Badge tone="warn">Free response</Badge>
                      <Badge tone="neutral">
                        Max {question.points} pt{question.points === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap rounded-md border border-surface-border bg-surface p-3 text-ink">
                      {answer?.text?.trim() || "(No answer submitted)"}
                    </p>
                    {ai?.explanation ? (
                      <p className="mt-2 text-ink-muted">
                        Auto-grade note: {ai.explanation}
                        {ai.maxScore > 0
                          ? ` (suggested ${ai.score}/${ai.maxScore}, confidence ${Math.round(ai.confidence * 100)}%)`
                          : ""}
                      </p>
                    ) : null}
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                        Rubric
                      </p>
                      {question.rubric.criteria.map((criterion) => (
                        <div key={criterion.id} className="text-ink-muted">
                          <p className="font-medium text-ink">
                            {criterion.label} (max {criterion.maxPoints})
                          </p>
                          <p>{criterion.guidance}</p>
                        </div>
                      ))}
                    </div>
                    {canGrade ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field
                          label={`Your score (0–${question.points})`}
                          htmlFor={`fr_score_${question.id}`}
                          required
                        >
                          <Input
                            id={`fr_score_${question.id}`}
                            name={`fr_score_${question.id}`}
                            type="number"
                            min={0}
                            max={question.points}
                            step={0.1}
                            defaultValue={
                              ai && (ai.model === "recruiter" || ai.score > 0)
                                ? String(ai.score)
                                : ""
                            }
                            required
                            disabled={pending}
                          />
                        </Field>
                      </div>
                    ) : ai ? (
                      <p className="mt-2 text-sm text-ink-muted">
                        Recorded score: {ai.score}/{ai.maxScore}
                      </p>
                    ) : null}
                  </div>
                );
              })}

              {canGrade ? (
                <div className="space-y-3 border-t border-surface-border pt-4">
                  <Field label="Review notes (optional)" htmlFor="review_notes">
                    <Textarea
                      id="review_notes"
                      name="review_notes"
                      rows={3}
                      disabled={pending}
                      placeholder="Why you awarded these free-response scores…"
                      defaultValue={recruiterNotes || undefined}
                    />
                  </Field>
                  <Alert tone="info">
                    {alreadyGraded
                      ? "Update scores anytime. The overall assessment score and the pipeline Test score field update automatically."
                      : "Saving review sets free-response scores, updates the overall assessment score and pipeline Test score, and clears the human-review hold. AI alone never rejects."}
                  </Alert>
                  <Button type="submit" size="sm" disabled={pending}>
                    {pending
                      ? "Saving…"
                      : alreadyGraded
                        ? "Update free-response grades"
                        : "Save free-response review"}
                  </Button>
                </div>
              ) : null}
            </form>
          )}
        </CardBody>
      ) : null}
    </Card>
  );
}
