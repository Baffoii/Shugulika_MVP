"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveJobOrderByEmployerAction,
  approveJobOrderByShugulikaAction,
} from "@/app/job-order-actions";
import { Button } from "@/components/ui/primitives";

export function ApproveJobOrderByShugulikaButton({ jobOrderId }: { jobOrderId: string }) {
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
            const result = await approveJobOrderByShugulikaAction(jobOrderId);
            if (!result.ok) setError(result.error ?? "Could not approve job order.");
            else router.refresh();
          });
        }}
      >
        {pending ? "Approving…" : "Approve"}
      </Button>
      {error ? <p className="max-w-48 text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}

export function ApproveJobOrderByEmployerButton({ jobOrderId }: { jobOrderId: string }) {
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
            const result = await approveJobOrderByEmployerAction(jobOrderId);
            if (!result.ok) setError(result.error ?? "Could not approve job order.");
            else router.refresh();
          });
        }}
      >
        {pending ? "Approving…" : "Approve job order"}
      </Button>
      {error ? <p className="max-w-48 text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}
