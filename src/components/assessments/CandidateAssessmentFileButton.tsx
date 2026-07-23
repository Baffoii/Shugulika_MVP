"use client";

import { useState, useTransition } from "react";
import { getEmployerAssessmentUrlAction } from "@/app/job-order-actions";
import { Button } from "@/components/ui/primitives";

export function CandidateAssessmentFileButton({
  jobOrderId,
  fileName,
  fileId,
}: {
  jobOrderId: string;
  fileName: string;
  /** When set, opens a specific job_order_assessment_files row. */
  fileId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await getEmployerAssessmentUrlAction(jobOrderId, fileId);
            if (!result.ok || !result.url) {
              setError(result.error ?? "Could not open assessment.");
              return;
            }
            window.open(result.url, "_blank", "noopener,noreferrer");
          });
        }}
      >
        {pending ? "Opening…" : `Open ${fileName}`}
      </Button>
      {error ? <p className="max-w-64 text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}
