"use client";

import { useState, useTransition } from "react";
import {
  withdrawEmployerApplicationAction,
  startRevisedEmployerApplicationAction,
} from "@/app/onboarding/employer/actions";
import { Alert, Button } from "@/components/ui/primitives";

export function WithdrawApplicationButton({ applicationId }: { applicationId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Withdraw application
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex items-center gap-2">
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await withdrawEmployerApplicationAction(applicationId);
              if (!result.ok) setError(result.error ?? "Could not withdraw the application.");
            })
          }
        >
          {pending ? "Withdrawing…" : "Confirm withdrawal"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
          Keep application
        </Button>
      </div>
    </div>
  );
}

export function StartRevisionButton({
  previousApplicationId,
  label,
}: {
  previousApplicationId: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startRevisedEmployerApplicationAction(previousApplicationId);
            if (result && !result.ok) setError(result.error ?? "Could not start a new application.");
          })
        }
      >
        {pending ? "Preparing…" : label}
      </Button>
    </div>
  );
}
