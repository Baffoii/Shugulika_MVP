"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { shareCvAction } from "@/app/candidate/progress-actions";

export function CvShareButton({
  applicationId,
  documentId,
}: {
  applicationId: string;
  documentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div>
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await shareCvAction(applicationId, documentId);
            setMessage(result.error ?? result.message ?? null);
            if (result.ok) router.refresh();
          })
        }
      >
        {pending ? "Sharing…" : "Consent and send CV"}
      </Button>
      {message ? (
        <p className="mt-2 text-xs text-ink-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
