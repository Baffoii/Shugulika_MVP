"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, RotateCcw, AlertTriangle } from "lucide-react";
import { screenApplicationAction } from "@/app/recruiter/screening-actions";
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Button,
  Badge,
  Alert,
  type BadgeTone,
} from "@/components/ui/primitives";
import type {
  ApplicationAiReviewRow,
  ApplicationAiReviewItemRow,
  ApplicationAiReviewVerdict,
  ApplicationAiReviewItemAssessment,
} from "@/lib/database.types";

const VERDICT_LABEL: Record<ApplicationAiReviewVerdict, string> = {
  strong_fit: "Strong fit",
  possible_fit: "Possible fit",
  weak_fit: "Weak fit",
  insufficient_evidence: "Insufficient evidence",
};
const VERDICT_TONE: Record<ApplicationAiReviewVerdict, BadgeTone> = {
  strong_fit: "success",
  possible_fit: "brand",
  weak_fit: "warn",
  insufficient_evidence: "neutral",
};
const ASSESSMENT_TONE: Record<ApplicationAiReviewItemAssessment, BadgeTone> = {
  met: "success",
  partial: "warn",
  missing: "danger",
  unclear: "neutral",
};
const ASSESSMENT_LABEL: Record<ApplicationAiReviewItemAssessment, string> = {
  met: "Met",
  partial: "Partial",
  missing: "Missing",
  unclear: "Unclear",
};

const DISCLAIMER =
  "This is the AI's holistic judgment of the CV against the job description — decision support for triage, not a calibrated score. Every point links to evidence from the CV; verify before acting.";

export function AiScreeningPanel({
  applicationId,
  hasCv,
  review,
  items,
}: {
  applicationId: string;
  hasCv: boolean;
  review: ApplicationAiReviewRow | null;
  items: ApplicationAiReviewItemRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const status = review?.status ?? null;
  const isRunning = status === "queued" || status === "processing";

  // Poll while a screen is in flight (mirrors the CV-analysis status card).
  useEffect(() => {
    if (!isRunning) return;
    console.info("[ai:screening:ui] polling_while_in_flight", {
      applicationId,
      status,
      reviewId: review?.id ?? null,
    });
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [isRunning, router, applicationId, status, review?.id]);

  useEffect(() => {
    if (!review) return;
    console.info("[ai:screening:ui] review_state", {
      applicationId,
      reviewId: review.id,
      status: review.status,
      score: review.overall_score,
      verdict: review.fit_verdict,
      itemCount: items.length,
    });
  }, [applicationId, review, items.length]);

  function runScreen(force: boolean) {
    setActionError(null);
    console.info("[ai:screening:ui] click", {
      applicationId,
      force,
      hasCv,
      currentStatus: review?.status ?? null,
      tip: force
        ? "Force/Re-screen bypasses cache — expect a paid OpenAI call in the server terminal"
        : "First screen bills once; later clicks should log CACHE_HIT_FREE if CV+reqs unchanged",
    });
    start(async () => {
      // Synchronous rejections (no CV, entitlement exhausted, key missing) never
      // create a review row, so surface them inline here; run-time failures live
      // on the failed review row and render via <FailedScreen>.
      const res = await screenApplicationAction(applicationId, { force });
      console.info("[ai:screening:ui] action_result", {
        applicationId,
        ok: res.ok,
        cached: res.cached ?? false,
        reviewId: res.reviewId ?? null,
        error: res.error ?? null,
        billedLikely: res.ok && !res.cached,
      });
      if (!res.ok) setActionError(res.error ?? "Could not start the AI screen.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-500" aria-hidden />
          AI CV screening
        </CardTitle>
        {review?.status === "succeeded" ? (
          <Button variant="secondary" size="sm" onClick={() => runScreen(true)} disabled={pending}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Re-screen
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-4">
        {actionError ? (
          <Alert tone="danger" title="Couldn’t start screening">
            {actionError}
          </Alert>
        ) : null}
        {!hasCv ? (
          <p className="text-sm text-ink-subtle">
            No CV is attached to this application, so it can’t be screened.
          </p>
        ) : !review ? (
          <EmptyScreen pending={pending} onRun={() => runScreen(false)} />
        ) : isRunning ? (
          <RunningScreen />
        ) : review.status === "failed" ? (
          <FailedScreen
            message={review.error_message}
            pending={pending}
            onRetry={() => runScreen(true)}
          />
        ) : (
          <SucceededScreen review={review} items={items} />
        )}
      </CardBody>
    </Card>
  );
}

function EmptyScreen({ pending, onRun }: { pending: boolean; onRun: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Run an AI review of this candidate’s CV against the role. It scores fit, flags gaps and
        vague claims, and suggests interview questions — each point backed by a quote from the CV.
      </p>
      <Button onClick={onRun} disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Sparkles className="h-4 w-4" aria-hidden />
        )}
        Screen with AI
      </Button>
      <p className="text-2xs text-ink-subtle">{DISCLAIMER}</p>
    </div>
  );
}

function RunningScreen() {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted">
      <Loader2 className="h-4 w-4 animate-spin text-brand-500" aria-hidden />
      Screening the CV against the role… this usually takes a few seconds.
    </div>
  );
}

function FailedScreen({
  message,
  pending,
  onRetry,
}: {
  message: string | null;
  pending: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-3">
      <Alert tone="danger" title="Screening failed">
        {message ?? "The AI provider could not screen this CV."}
      </Alert>
      <Button variant="secondary" size="sm" onClick={onRetry} disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        )}
        Try again
      </Button>
    </div>
  );
}

function SucceededScreen({
  review,
  items,
}: {
  review: ApplicationAiReviewRow;
  items: ApplicationAiReviewItemRow[];
}) {
  const verdict = review.fit_verdict;
  const requirementItems = items.filter((i) => i.item_type === "requirement_match");
  const strengthItems = items.filter((i) => i.item_type === "strength");
  const flagItems = items.filter((i) => i.item_type === "gap" || i.item_type === "concern");
  const questions = Array.isArray(review.recommended_questions)
    ? (review.recommended_questions as unknown[]).filter((q): q is string => typeof q === "string")
    : [];

  return (
    <div className="space-y-4">
      {/* Score header */}
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-full border-2 border-brand-200 bg-brand-50">
          <span className="text-xl font-semibold text-brand-700">
            {review.overall_score ?? "–"}
          </span>
          <span className="text-2xs text-ink-subtle">/ 100</span>
        </div>
        <div className="space-y-1">
          {verdict ? <Badge tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Badge> : null}
          {review.summary ? (
            <p className="text-sm text-ink whitespace-pre-line">{review.summary}</p>
          ) : null}
        </div>
      </div>

      {requirementItems.length > 0 ? (
        <Section title="Requirement match">
          <ul className="space-y-2">
            {requirementItems.map((item) => (
              <li key={item.id} className="rounded-lg border border-surface-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{item.label}</p>
                  {item.assessment ? (
                    <Badge tone={ASSESSMENT_TONE[item.assessment]}>
                      {ASSESSMENT_LABEL[item.assessment]}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-ink-muted">{item.explanation}</p>
                <Evidence text={item.evidence_text} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {strengthItems.length > 0 ? (
        <Section title="Strengths">
          <PointList items={strengthItems} />
        </Section>
      ) : review.strengths ? (
        <Section title="Strengths">
          <p className="text-sm text-ink-muted whitespace-pre-line">{review.strengths}</p>
        </Section>
      ) : null}

      {flagItems.length > 0 ? (
        <Section
          title="Gaps & concerns"
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        >
          <PointList items={flagItems} />
        </Section>
      ) : review.concerns ? (
        <Section
          title="Gaps & concerns"
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
        >
          <p className="text-sm text-ink-muted whitespace-pre-line">{review.concerns}</p>
        </Section>
      ) : null}

      {questions.length > 0 ? (
        <Section title="Suggested interview questions">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="border-t border-surface-border pt-3 text-2xs text-ink-subtle">{DISCLAIMER}</p>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">
        {icon}
        {title}
      </h4>
      {children}
    </div>
  );
}

function PointList({ items }: { items: ApplicationAiReviewItemRow[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg border border-surface-border p-3">
          <p className="text-sm font-medium text-ink">{item.label}</p>
          <p className="mt-1 text-sm text-ink-muted">{item.explanation}</p>
          <Evidence text={item.evidence_text} />
        </li>
      ))}
    </ul>
  );
}

function Evidence({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <blockquote className="mt-2 border-l-2 border-surface-border pl-2 text-xs italic text-ink-subtle">
      “{text}”
    </blockquote>
  );
}
