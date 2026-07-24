"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  withdrawApplicationAction,
  grantEmployerSubmissionConsentAction,
} from "@/app/candidate/actions";
import { Button } from "@/components/ui/primitives";

export function WithdrawButton({ applicationId }: { applicationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(() => {
              void withdrawApplicationAction(applicationId);
            })
          }
        >
          {pending ? "Withdrawing…" : "Confirm"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </span>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
      Withdraw
    </Button>
  );
}

export function GrantEmployerConsentButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await grantEmployerSubmissionConsentAction(applicationId);
            if (!res.ok) {
              setError(res.error ?? "Could not grant consent.");
              return;
            }
            router.refresh();
          })
        }
      >
        {pending ? "Saving…" : "Allow employer share"}
      </Button>
      {error ? <span className="text-xs text-red-700">{error}</span> : null}
    </span>
  );
}
