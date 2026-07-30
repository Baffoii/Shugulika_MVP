"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, Alert } from "@/components/ui/primitives";
import { unlockEmployerCvAction } from "@/app/employer/plan-actions";

export function UnlockCvButton({
  candidateId,
  submissionId,
  jobOrderId,
  balance,
  teaserCopy,
}: {
  candidateId: string;
  /** Path B submission unlock. Omit for Path A pool unlocks. */
  submissionId?: string;
  /** Path A job scope — used to revalidate pool pages after unlock. */
  jobOrderId?: string;
  balance: number;
  teaserCopy?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function unlock() {
    setError(null);
    startTransition(async () => {
      const result = await unlockEmployerCvAction(candidateId, submissionId ?? null, jobOrderId);
      if (!result.ok) setError(result.error ?? "Could not unlock this CV.");
    });
  }

  return (
    <div className="space-y-2">
      <Alert tone="info">
        {teaserCopy ??
          "This is a masked teaser. Spend 1 CV unlock to reveal the full candidate pack inside Shugulika"}{" "}
        ({balance} unlock{balance === 1 ? "" : "s"} left).
      </Alert>
      {error ? <p className="text-sm text-status-danger">{error}</p> : null}
      {balance < 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled>No unlocks left — buy more</Button>
          <Link href="/employer/billing" className="text-sm font-medium text-brand-700 underline">
            Go to Billing
          </Link>
        </div>
      ) : (
        <Button disabled={pending} onClick={unlock}>
          {pending ? "Unlocking…" : "Unlock CV (1 unlock)"}
        </Button>
      )}
    </div>
  );
}
