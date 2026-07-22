"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawJobOrderAction } from "@/app/job-order-actions";
import { Button } from "@/components/ui/primitives";

export function WithdrawJobOrderButton({
  jobOrderId,
  jobTitle,
}: {
  jobOrderId: string;
  jobTitle: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          const confirmed = window.confirm(
            `Withdraw “${jobTitle}”? This cancels the role request and removes any public posting.`,
          );
          if (!confirmed) return;
          setError(null);
          startTransition(async () => {
            const result = await withdrawJobOrderAction(jobOrderId);
            if (!result.ok) setError(result.error ?? "Could not withdraw role.");
            else router.refresh();
          });
        }}
      >
        {pending ? "Withdrawing…" : "Withdraw"}
      </Button>
      {error ? <p className="max-w-48 text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}
