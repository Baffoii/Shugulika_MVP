"use client";

import { DocumentPreviewButton } from "@/components/documents/DocumentPreviewButton";

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
  const id = fileId ?? jobOrderId;
  return (
    <div className="space-y-1">
      <DocumentPreviewButton
        source="assessment_file"
        id={id}
        jobOrderId={jobOrderId}
        label={`Preview ${fileName}`}
        variant="outline"
        size="sm"
      />
      <p className="max-w-64 text-xs text-ink-subtle">
        Watermarked in-app preview · no download · access audited
      </p>
    </div>
  );
}
