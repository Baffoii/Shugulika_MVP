"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { denyJobOrderAction } from "@/app/job-order-actions";
import { Alert, Button } from "@/components/ui/primitives";
import { Field, Textarea } from "@/components/ui/form";

export function DenyJobOrderButton({
  jobOrderId,
  jobTitle,
}: {
  jobOrderId: string;
  jobTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Deny
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deny-job-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 id="deny-job-title" className="text-base font-semibold text-ink">
              Deny job order
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              Provide a clear reason for denying <span className="font-medium">{jobTitle}</span>.
              This reason is required and will be recorded in the audit history.
            </p>
            <div className="mt-4">
              <Field label="Denial reason" htmlFor={`deny-reason-${jobOrderId}`} required>
                <Textarea
                  id={`deny-reason-${jobOrderId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  minLength={8}
                  required
                  disabled={pending}
                  placeholder="Explain why this job order is being denied…"
                />
              </Field>
            </div>
            {error ? (
              <div className="mt-3">
                <Alert tone="danger">{error}</Alert>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={pending || reason.trim().length < 8}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await denyJobOrderAction(jobOrderId, reason);
                    if (!result.ok) {
                      setError(result.error ?? "Could not deny job order.");
                      return;
                    }
                    setOpen(false);
                    router.refresh();
                  });
                }}
              >
                {pending ? "Denying…" : "Confirm denial"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
