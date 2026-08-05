"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  runPostInterviewProcessingAction,
  saveEvidenceOverridesAction,
} from "@/app/recruiter/ai-interview-actions";
import type {
  InterviewAiEvaluationRow,
  InterviewAssignmentQuestionRow,
  InterviewLiveSessionRow,
  InterviewTurnRow,
} from "@/lib/database.types";
import { Alert, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/client";

type QuestionResult = {
  assignment_question_id: string;
  competency?: string;
  rubric_level?: number | null;
  evidence_text?: string | null;
  explanation?: string;
  confidence?: string;
  insufficient_evidence?: boolean;
  possible_transcription_error?: boolean;
  suggested_human_follow_up?: string | null;
};

export function LiveAiEvidencePanel({
  assignmentId,
  liveSession,
  turns,
  questions,
  aiEvaluation,
}: {
  assignmentId: string;
  liveSession: InterviewLiveSessionRow | null;
  turns: InterviewTurnRow[];
  questions: InterviewAssignmentQuestionRow[];
  aiEvaluation: InterviewAiEvaluationRow | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [overrideNotes, setOverrideNotes] = useState("");

  const results = (aiEvaluation?.question_results ?? []) as QuestionResult[];
  const summary =
    aiEvaluation &&
    typeof aiEvaluation.structured_evidence === "object" &&
    aiEvaluation.structured_evidence &&
    "summary_for_recruiter" in (aiEvaluation.structured_evidence as object)
      ? String(
          (aiEvaluation.structured_evidence as { summary_for_recruiter?: string })
            .summary_for_recruiter ?? "",
        )
      : "";

  function loadAudio() {
    if (!liveSession?.candidate_audio_bucket || !liveSession.candidate_audio_path) return;
    start(async () => {
      const supabase = createClient();
      const { data, error: signedError } = await supabase.storage
        .from(liveSession.candidate_audio_bucket!)
        .createSignedUrl(liveSession.candidate_audio_path!, 120);
      if (signedError || !data?.signedUrl) {
        setError(signedError?.message ?? "Could not load audio.");
        return;
      }
      setAudioUrl(data.signedUrl);
    });
  }

  function reprocess() {
    if (!liveSession) return;
    setError(null);
    start(async () => {
      const result = await runPostInterviewProcessingAction(liveSession.id);
      if (!result.ok) setError(result.error ?? "Processing failed");
      router.refresh();
    });
  }

  function saveOverrides() {
    setError(null);
    const fd = new FormData();
    fd.set("assignment_id", assignmentId);
    if (aiEvaluation?.id) fd.set("ai_evaluation_id", aiEvaluation.id);
    fd.set(
      "evidence_overrides",
      JSON.stringify([{ note: overrideNotes, at: new Date().toISOString() }]),
    );
    start(async () => {
      const result = await saveEvidenceOverridesAction(fd);
      if (!result.ok) setError(result.error ?? "Could not save overrides");
      else router.refresh();
    });
  }

  return (
    <Card className="mt-5">
      <CardHeader>
        <CardTitle>AI voice evidence (assistive only)</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <Alert tone="warn">
          AI evidence never advances or rejects a candidate. Complete your human review, then use
          the pipeline controls to change stage.
        </Alert>
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {liveSession ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase text-ink-subtle">Session</dt>
              <dd>{liveSession.status}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-ink-subtle">Duration</dt>
              <dd>{liveSession.duration_seconds ?? "—"}s</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-ink-subtle">Model</dt>
              <dd>{liveSession.model}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-ink-muted">No live session recorded yet.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={loadAudio}>
            Load candidate audio
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={reprocess}
          >
            Re-run transcript + evidence
          </Button>
        </div>
        {audioUrl ? (
          <audio
            controls
            src={audioUrl}
            className="w-full"
            aria-label="Candidate interview audio"
          />
        ) : null}

        {summary ? (
          <div className="rounded-lg border border-surface-border bg-surface-muted/40 p-3 text-sm">
            <p className="font-medium text-ink">AI summary for recruiter</p>
            <p className="mt-1 text-ink-muted">{summary}</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {questions.map((q) => {
            const item = results.find((r) => r.assignment_question_id === q.id);
            const turn = turns.find(
              (t) => t.assignment_question_id === q.id && t.speaker === "candidate",
            );
            return (
              <div key={q.id} className="rounded-lg border border-surface-border p-3 text-sm">
                <p className="font-medium text-ink">
                  Q{q.display_order}. {q.question_text_snapshot}
                </p>
                {q.competency ? (
                  <p className="text-xs text-ink-subtle">Competency: {q.competency}</p>
                ) : null}
                <p className="mt-2 text-ink-muted">
                  Transcript: {turn?.transcript?.trim() || "(none yet)"}
                </p>
                {item ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">
                    <li>
                      Rubric level: {item.rubric_level ?? "n/a"} · Confidence:{" "}
                      {item.confidence ?? "n/a"}
                    </li>
                    <li>{item.explanation}</li>
                    {item.insufficient_evidence ? <li>Flag: insufficient evidence</li> : null}
                    {item.possible_transcription_error ? (
                      <li>Flag: possible transcription error</li>
                    ) : null}
                    {item.suggested_human_follow_up ? (
                      <li>Suggested human follow-up: {item.suggested_human_follow_up}</li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-subtle">
                    No AI evidence yet for this question.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-ink" htmlFor="evidence-override">
            Recruiter evidence override / correction notes
          </label>
          <textarea
            id="evidence-override"
            className="min-h-24 w-full rounded-lg border border-surface-border bg-white px-3 py-2 text-sm"
            value={overrideNotes}
            onChange={(e) => setOverrideNotes(e.target.value)}
            placeholder="Correct transcript issues or override AI rubric observations with reasons…"
          />
          <Button
            type="button"
            size="sm"
            disabled={pending || !overrideNotes.trim()}
            onClick={saveOverrides}
          >
            Save override notes
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
