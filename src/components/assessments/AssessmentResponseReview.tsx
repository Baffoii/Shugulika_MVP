"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptAiAssessmentGradesAction,
  completeAssessmentReviewAction,
  regradeAssessmentWithAiAction,
} from "@/app/recruiter/actions";
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
type FrEvidence = {
  criterionId: string;
  pointsAwarded: number | null;
  quote: string | null;
  note: string;
};
type FrAuthenticityEvidence = {
  quote: string;
  label: "supports_ai" | "supports_human" | "neutral" | string;
  note: string;
};
type FrAuthenticitySentence = {
  sentence: string;
  label: "human" | "ai" | "mixed" | string;
};
type FrAuthenticity = {
  classification: "human_likely" | "mixed" | "ai_likely" | string;
  aiProbability: number;
  confidence: number;
  rationale: string;
  evidence: FrAuthenticityEvidence[];
  sentenceLabels: FrAuthenticitySentence[];
  signals: string[];
  flaggedForReview: boolean;
};

type FrGrade = {
  questionId: string;
  score: number;
  maxScore: number;
  percent: number;
  explanation: string;
  evidence: FrEvidence[];
  confidence: number;
  humanReviewRequired: boolean;
  model: string;
  authenticity: FrAuthenticity | null;
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

function parseEvidence(value: unknown): FrEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item as Json);
    if (!row || typeof row.criterionId !== "string") return [];
    return [
      {
        criterionId: row.criterionId,
        pointsAwarded: typeof row.pointsAwarded === "number" ? row.pointsAwarded : null,
        quote: typeof row.quote === "string" ? row.quote : null,
        note: typeof row.note === "string" ? row.note : "",
      },
    ];
  });
}

function parseAuthenticityEvidence(value: unknown): FrAuthenticityEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item as Json);
    if (!row || typeof row.quote !== "string" || !row.quote.trim()) return [];
    return [
      {
        quote: row.quote,
        label: typeof row.label === "string" ? row.label : "neutral",
        note: typeof row.note === "string" ? row.note : "",
      },
    ];
  });
}

function parseAuthenticitySentences(value: unknown): FrAuthenticitySentence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item as Json);
    if (!row || typeof row.sentence !== "string" || !row.sentence.trim()) return [];
    return [
      {
        sentence: row.sentence,
        label: typeof row.label === "string" ? row.label : "mixed",
      },
    ];
  });
}

function parseAuthenticity(value: unknown): FrAuthenticity | null {
  const row = asRecord(value as Json);
  if (!row) return null;
  const classification = typeof row.classification === "string" ? row.classification : "mixed";
  const signals = Array.isArray(row.signals)
    ? row.signals.filter((item): item is string => typeof item === "string")
    : [];
  const evidence = parseAuthenticityEvidence(row.evidence);
  const sentenceLabels = parseAuthenticitySentences(row.sentenceLabels);
  return {
    classification,
    aiProbability: typeof row.aiProbability === "number" ? row.aiProbability : 0,
    confidence: typeof row.confidence === "number" ? row.confidence : 0,
    rationale: typeof row.rationale === "string" ? row.rationale : "",
    evidence,
    sentenceLabels,
    signals,
    flaggedForReview: Boolean(row.flaggedForReview),
  };
}

function authenticityEvidenceTone(label: string): "danger" | "success" | "neutral" {
  if (label === "supports_ai") return "danger";
  if (label === "supports_human") return "success";
  return "neutral";
}

function authenticityEvidenceLabel(label: string): string {
  if (label === "supports_ai") return "Supports AI";
  if (label === "supports_human") return "Supports human";
  return "Neutral";
}

function authenticitySentenceTone(label: string): "danger" | "success" | "warn" | "neutral" {
  if (label === "ai") return "danger";
  if (label === "human") return "success";
  if (label === "mixed") return "warn";
  return "neutral";
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
        evidence: parseEvidence(row.evidence),
        confidence: typeof row.confidence === "number" ? row.confidence : 0,
        humanReviewRequired: Boolean(row.humanReviewRequired),
        model: typeof row.model === "string" ? row.model : "none",
        authenticity: parseAuthenticity(row.authenticity),
      },
    ];
  });
}

function formatScore(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function authenticityBadgeTone(aiProbability: number): "success" | "warn" | "orange" | "danger" {
  // 0–15% green, 15–40% amber, 40–70% orange, ≥70% red.
  if (aiProbability >= 0.7) return "danger";
  if (aiProbability >= 0.4) return "orange";
  if (aiProbability >= 0.15) return "warn";
  return "success";
}

/** Color the AI grade badge by score quality (not review-hold state). */
function aiGradeBadgeTone(
  score: number,
  maxScore: number,
): "success" | "warn" | "orange" | "danger" | "neutral" {
  if (maxScore <= 0) return "neutral";
  const pct = score / maxScore;
  if (pct >= 0.85) return "success";
  if (pct >= 0.6) return "warn";
  if (pct >= 0.4) return "orange";
  return "danger";
}

function authenticityLabel(auth: FrAuthenticity): string {
  const pct = Math.round(auth.aiProbability * 100);
  const conf = auth.confidence > 0 ? ` · ${Math.round(auth.confidence * 100)}% conf` : "";
  return `${pct}% chance AI-written${conf}`;
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
  const [warning, setWarning] = useState<string | null>(null);
  const [overrideScores, setOverrideScores] = useState(false);
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
  const canReview = ["submitted", "graded"].includes(assignment.status);
  const alreadyGraded = assignment.status === "graded" && !assignment.human_review_required;
  const aiGraded = frGrades.some((item) => item.model !== "none" && item.model !== "recruiter");
  const stubbedOnly = frGrades.length > 0 && frGrades.every((item) => item.model === "none");
  const needsManualEntry =
    canReview && (assignment.human_review_required || overrideScores || !aiGraded);

  const hasAnswers = responses.mcq.length > 0 || responses.freeResponse.length > 0;
  if (!hasAnswers && !["submitted", "graded"].includes(assignment.status)) {
    return null;
  }

  function runAction(
    action: (formData: FormData) => Promise<{ ok: boolean; error?: string; warning?: string }>,
    formData?: FormData,
  ) {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await action(formData ?? new FormData());
      if (!result.ok) setError(result.error ?? "Action failed.");
      else {
        if (result.warning) setWarning(result.warning);
        setOverrideScores(false);
        router.refresh();
      }
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
          {warning ? <Alert tone="warn">{warning}</Alert> : null}
          {!hasAnswers ? (
            <Alert tone="warn">No stored answers for this assignment yet.</Alert>
          ) : (
            <>
              {canReview ? (
                <div className="flex flex-wrap gap-2">
                  {stubbedOnly || assignment.human_review_required || alreadyGraded ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("assignment_id", assignment.id);
                        runAction(regradeAssessmentWithAiAction, fd);
                      }}
                    >
                      {pending ? "Grading…" : "Re-grade free responses with AI"}
                    </Button>
                  ) : null}
                  {assignment.human_review_required && aiGraded ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        const fd = new FormData();
                        fd.set("assignment_id", assignment.id);
                        runAction(acceptAiAssessmentGradesAction, fd);
                      }}
                    >
                      {pending ? "Saving…" : "Accept AI grades"}
                    </Button>
                  ) : null}
                  {aiGraded && alreadyGraded && !overrideScores ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => setOverrideScores(true)}
                    >
                      Override AI scores
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {stubbedOnly ? (
                <Alert tone="warn">
                  OpenAI was not configured when this assessment was submitted. Use “Re-grade free
                  responses with AI” to score both free-response answers against the rubric.
                </Alert>
              ) : null}

              {aiGraded && alreadyGraded && !overrideScores ? (
                <Alert tone="success">
                  Free-response answers were graded by AI. Review the explanations below. Override
                  only if you disagree.
                </Alert>
              ) : null}

              {assignment.human_review_required && aiGraded ? (
                <Alert tone="info">
                  AI graded these answers but flagged them for recruiter review (low confidence,
                  borderline score, and/or AI-writing likelihood). Accept the AI grades or enter
                  your own scores.
                </Alert>
              ) : null}

              <form
                key={`${assignment.id}-${assignment.graded_at ?? ""}-${assignment.score ?? ""}-${overrideScores}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  runAction(completeAssessmentReviewAction, new FormData(event.currentTarget));
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
                  const evidenceByCriterion = new Map(
                    (ai?.evidence ?? []).map((item) => [item.criterionId, item]),
                  );
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
                        {ai && ai.model !== "none" ? (
                          <Badge tone={aiGradeBadgeTone(ai.score, ai.maxScore)}>
                            AI grade {formatScore(ai.score)}/{ai.maxScore}
                            {ai.confidence > 0 ? ` · ${Math.round(ai.confidence * 100)}% conf` : ""}
                          </Badge>
                        ) : null}
                        {ai?.authenticity ? (
                          <Badge tone={authenticityBadgeTone(ai.authenticity.aiProbability)}>
                            {authenticityLabel(ai.authenticity)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-3 whitespace-pre-wrap rounded-md border border-surface-border bg-surface p-3 text-ink">
                        {answer?.text?.trim() || "(No answer submitted)"}
                      </p>

                      {ai?.authenticity ? (
                        <div className="mt-3 rounded-md border border-surface-border bg-surface p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                            AI-writing check
                          </p>
                          <p className="mt-1 text-ink">
                            {ai.authenticity.rationale || authenticityLabel(ai.authenticity)}
                          </p>

                          {ai.authenticity.evidence.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                                Proof
                              </p>
                              {ai.authenticity.evidence.map((item, evidenceIndex) => (
                                <div
                                  key={`${item.quote}-${evidenceIndex}`}
                                  className="rounded-md border border-surface-border/70 bg-surface-muted/40 p-2"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge tone={authenticityEvidenceTone(item.label)}>
                                      {authenticityEvidenceLabel(item.label)}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 italic text-ink">“{item.quote}”</p>
                                  {item.note ? (
                                    <p className="mt-1 text-ink-muted">{item.note}</p>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : ai.authenticity.signals.length > 0 ? (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
                              {ai.authenticity.signals.map((signal) => (
                                <li key={signal}>{signal}</li>
                              ))}
                            </ul>
                          ) : null}

                          {ai.authenticity.sentenceLabels.length > 0 ? (
                            <div className="mt-3 space-y-1">
                              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                                Sentence labels
                              </p>
                              <ul className="space-y-1">
                                {ai.authenticity.sentenceLabels.map((item, sentenceIndex) => (
                                  <li
                                    key={`${item.sentence}-${sentenceIndex}`}
                                    className="flex flex-wrap items-start gap-2 text-ink-muted"
                                  >
                                    <Badge tone={authenticitySentenceTone(item.label)}>
                                      {item.label}
                                    </Badge>
                                    <span className="min-w-0 flex-1 text-ink">{item.sentence}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          <p className="mt-3 text-xs text-ink-subtle">
                            Heuristic review signal (OpenAI), not a forensic GPTZero score. Does not
                            auto-fail the assessment.
                          </p>
                          {ai.authenticity.flaggedForReview ? (
                            <p className="mt-1 text-sm text-ink-muted">
                              Flagged for recruiter review only.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {ai?.explanation ? (
                        <div className="mt-3 rounded-md border border-surface-border bg-surface p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                            AI grading decision
                            {ai.model !== "none" && ai.model !== "recruiter"
                              ? ` (${ai.model})`
                              : ""}
                          </p>
                          <p className="mt-1 text-ink">{ai.explanation}</p>
                          {ai.maxScore > 0 ? (
                            <p className="mt-2 text-ink-muted">
                              Score {formatScore(ai.score)}/{ai.maxScore}
                              {ai.confidence > 0
                                ? ` · confidence ${Math.round(ai.confidence * 100)}%`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                          Rubric breakdown
                        </p>
                        {question.rubric.criteria.map((criterion) => {
                          const evidence = evidenceByCriterion.get(criterion.id);
                          return (
                            <div
                              key={criterion.id}
                              className="rounded-md border border-surface-border/70 bg-surface/60 p-2 text-ink-muted"
                            >
                              <p className="font-medium text-ink">
                                {criterion.label}{" "}
                                {evidence?.pointsAwarded != null
                                  ? `(${formatScore(evidence.pointsAwarded)}/${criterion.maxPoints})`
                                  : `(max ${criterion.maxPoints})`}
                              </p>
                              <p>{criterion.guidance}</p>
                              {evidence?.note ? (
                                <p className="mt-1 text-ink">
                                  <span className="font-medium">AI note:</span> {evidence.note}
                                </p>
                              ) : null}
                              {evidence?.quote ? (
                                <p className="mt-1 italic text-ink-muted">“{evidence.quote}”</p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      {needsManualEntry ? (
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
                              defaultValue={ai && ai.model !== "none" ? formatScore(ai.score) : ""}
                              required
                              disabled={pending}
                            />
                          </Field>
                        </div>
                      ) : ai ? (
                        <p className="mt-2 text-sm text-ink-muted">
                          Recorded score: {formatScore(ai.score)}/{ai.maxScore}
                          {ai.model === "recruiter" ? " (recruiter)" : " (AI grade)"}
                        </p>
                      ) : null}
                    </div>
                  );
                })}

                {needsManualEntry ? (
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
                        ? "Saving overrides the AI free-response scores and updates the overall assessment score and pipeline Test score."
                        : "Saving review sets free-response scores, updates the overall assessment score and pipeline Test score, and clears the human-review hold. AI alone never rejects."}
                    </Alert>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" size="sm" disabled={pending}>
                        {pending
                          ? "Saving…"
                          : alreadyGraded
                            ? "Save score override"
                            : "Save free-response review"}
                      </Button>
                      {overrideScores ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => setOverrideScores(false)}
                        >
                          Cancel override
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </form>
            </>
          )}
        </CardBody>
      ) : null}
    </Card>
  );
}
