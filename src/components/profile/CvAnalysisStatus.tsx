"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, RotateCcw } from "lucide-react";
import { parseResumeAction } from "@/app/candidate/resume-actions";
import { Alert, Button } from "@/components/ui/primitives";
import type { CandidateDocumentRow, ResumeParseRunRow } from "@/lib/database.types";

/**
 * Inline CV analysis status shown under the CV/Resume card: queued/processing
 * spinner (polls for updates), succeeded confirmation, or a failure Alert
 * with a specific message and a "Try again" retry. Also exposes a manual
 * "Re-analyze CV" action once a run has completed, and notes when the free
 * rule-based extractor (no AI provider configured) was used instead of AI.
 */
export function CvAnalysisStatus({
  document,
  run,
}: {
  document: CandidateDocumentRow | null;
  run: ResumeParseRunRow | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const status = document?.parse_status ?? "none";
  const isRunning = status === "queued" || status === "processing";
  const usedFreeExtractor = run?.provider === "rule_based";

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => {
      router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [isRunning, router]);

  if (!document) return null;
  const documentId = document.id;

  function reanalyze() {
    start(async () => {
      await parseResumeAction(documentId);
      router.refresh();
    });
  }

  if (isRunning) {
    return (
      <div className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin text-brand-500" aria-hidden />
        Analyzing your CV…
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mt-3 space-y-2">
        <Alert tone="danger" title="We couldn't analyze this CV">
          {run?.error_message ?? "Something went wrong while analyzing your CV. Please try again."}
        </Alert>
        <Button variant="outline" size="sm" onClick={reanalyze} disabled={pending}>
          <RotateCcw className="h-4 w-4" /> {pending ? "Retrying…" : "Try again"}
        </Button>
      </div>
    );
  }

  if (status === "succeeded") {
    return (
      <div className="mt-3 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm text-status-success">
            <Sparkles className="h-4 w-4" aria-hidden /> CV analyzed for profile suggestions
          </p>
          <Button variant="ghost" size="sm" onClick={reanalyze} disabled={pending}>
            <RotateCcw className="h-4 w-4" /> {pending ? "Analyzing…" : "Re-analyze CV"}
          </Button>
        </div>
        {usedFreeExtractor ? (
          <p className="text-xs text-ink-subtle">
            Used the free pattern-based extractor (no AI provider configured) — accuracy is lower
            than AI, so please double-check suggestions carefully. Configure an AI provider for
            higher-accuracy extraction.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" onClick={reanalyze} disabled={pending}>
        <Sparkles className="h-4 w-4" />{" "}
        {pending ? "Analyzing…" : "Analyze CV for profile suggestions"}
      </Button>
    </div>
  );
}
