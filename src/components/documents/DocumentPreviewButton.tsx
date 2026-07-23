"use client";

import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { X, FileText, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { DocumentSourceKind } from "@/lib/documents/access-types";

export type PreviewOpenParams = {
  source: DocumentSourceKind;
  id: string;
  label: string;
  applicationId?: string;
  submissionId?: string;
  jobOrderId?: string;
};

function previewUrl(params: PreviewOpenParams): string {
  const q = new URLSearchParams({
    source: params.source,
    id: params.id,
  });
  if (params.applicationId) q.set("applicationId", params.applicationId);
  if (params.submissionId) q.set("submissionId", params.submissionId);
  if (params.jobOrderId) q.set("jobOrderId", params.jobOrderId);
  return `/api/documents/preview?${q.toString()}`;
}

/** Opens a watermarked, view-only in-app preview (no ordinary download). */
export function DocumentPreviewButton({
  source,
  id,
  label,
  applicationId,
  submissionId,
  jobOrderId,
  variant = "ghost",
  size = "sm",
}: PreviewOpenParams & {
  variant?: "ghost" | "outline" | "primary" | "danger" | "secondary";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const titleId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setSrc(null);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  function openPreview() {
    setError(null);
    start(() => {
      setSrc(
        previewUrl({
          source,
          id,
          label,
          applicationId,
          submissionId,
          jobOrderId,
        }),
      );
      setOpen(true);
    });
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={openPreview} disabled={pending}>
        {pending ? "Opening…" : label}
      </Button>
      {open && src ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="flex h-[min(92vh,920px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-surface shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-surface-border px-4 py-3">
              <div className="min-w-0">
                <p id={titleId} className="truncate text-sm font-semibold text-ink">
                  {label}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-subtle">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Watermarked view-only preview · access is audited · no download
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink"
                aria-label="Close preview"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {error ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <FileText className="h-10 w-10 text-ink-subtle" aria-hidden />
                <p className="text-sm text-status-danger">{error}</p>
                <Button variant="outline" size="sm" onClick={close}>
                  Close
                </Button>
              </div>
            ) : (
              <iframe
                title={label}
                src={src}
                className="h-full w-full flex-1 bg-surface-muted"
                onError={() => setError("Could not load the watermarked preview.")}
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Back-compat alias used by employer/recruiter pages. */
export function ViewCvButton({
  documentId,
  label,
  applicationId,
  submissionId,
}: {
  documentId: string;
  label: string;
  applicationId?: string;
  submissionId?: string;
  /** @deprecated Ignored — originals are never exposed via signed URL. */
  bucketId?: string;
  /** @deprecated Ignored — originals are never exposed via signed URL. */
  objectPath?: string;
}) {
  return (
    <DocumentPreviewButton
      source="candidate_document"
      id={documentId}
      label={label}
      applicationId={applicationId}
      submissionId={submissionId}
    />
  );
}
