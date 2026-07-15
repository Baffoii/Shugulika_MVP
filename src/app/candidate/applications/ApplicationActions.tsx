"use client";

import { useState, useTransition } from "react";
import { withdrawApplicationAction } from "@/app/candidate/actions";
import { Button } from "@/components/ui/primitives";

export function WithdrawButton({ applicationId }: { applicationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <Button variant="danger" size="sm" disabled={pending} onClick={() => start(() => { void withdrawApplicationAction(applicationId); })}>
          {pending ? "Withdrawing…" : "Confirm"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
      </span>
    );
  }
  return <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>Withdraw</Button>;
}
