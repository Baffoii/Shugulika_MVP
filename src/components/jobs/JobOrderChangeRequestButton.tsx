"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestJobOrderChangesAction } from "@/app/job-order-actions";
import { Alert, Button } from "@/components/ui/primitives";
import { Field, Input, Textarea } from "@/components/ui/form";

export function JobOrderChangeRequestButton({
  jobOrderId,
  jobTitle,
}: {
  jobOrderId: string;
  jobTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [field, setField] = useState("title");
  const [instruction, setInstruction] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Request changes
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-request-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h3 id="change-request-title" className="text-base font-semibold text-ink">
              Request changes
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              Send <span className="font-medium">{jobTitle}</span> back with clear edit
              instructions.
            </p>
            <div className="mt-4 space-y-3">
              <Field label="Summary message" htmlFor={`cr-message-${jobOrderId}`} required>
                <Textarea
                  id={`cr-message-${jobOrderId}`}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  rows={3}
                  minLength={8}
                  required
                  disabled={pending}
                  placeholder="Explain what needs to change…"
                />
              </Field>
              <Field label="Field" htmlFor={`cr-field-${jobOrderId}`} required>
                <Input
                  id={`cr-field-${jobOrderId}`}
                  value={field}
                  onChange={(event) => setField(event.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field label="Instruction" htmlFor={`cr-instruction-${jobOrderId}`} required>
                <Textarea
                  id={`cr-instruction-${jobOrderId}`}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  rows={2}
                  required
                  disabled={pending}
                  placeholder="Specific instruction for this field…"
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
                disabled={
                  pending || message.trim().length < 8 || !field.trim() || !instruction.trim()
                }
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await requestJobOrderChangesAction(jobOrderId, message, [
                      { field: field.trim(), instruction: instruction.trim() },
                    ]);
                    if (!result.ok) {
                      setError(result.error ?? "Could not request changes.");
                      return;
                    }
                    setOpen(false);
                    router.refresh();
                  });
                }}
              >
                {pending ? "Sending…" : "Send change request"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
