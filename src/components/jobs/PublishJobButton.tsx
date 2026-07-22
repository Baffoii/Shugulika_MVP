"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAndPublishJobOrderAction } from "@/app/job-order-actions";
import { Button } from "@/components/ui/primitives";

export function PublishJobButton({ jobOrderId }: { jobOrderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await approveAndPublishJobOrderAction(jobOrderId);
            if (!result.ok) setError(result.error ?? "Could not publish job.");
            else router.refresh();
          });
        }}
      >
        {pending ? "Publishing…" : "Approve & publish"}
      </Button>
      {error ? <p className="max-w-48 text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}
