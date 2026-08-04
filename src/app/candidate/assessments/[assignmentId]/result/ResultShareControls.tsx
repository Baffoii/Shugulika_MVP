"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import {
  revokeAssessmentResultShareAction,
  shareAssessmentResultAction,
} from "@/app/candidate/progress-actions";
import type { ResultShareGrant } from "@/lib/candidate/types";

export function ResultShareControls({
  assignmentId,
  grants,
  canCreateShare,
  asOf,
}: {
  assignmentId: string;
  grants: ResultShareGrant[];
  canCreateShare: boolean;
  asOf: string;
}) {
  const router = useRouter();
  const [purpose, setPurpose] = useState("Share with the employer for this job application");
  const [expiresAt, setExpiresAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function share() {
    startTransition(async () => {
      setMessage(null);
      const result = await shareAssessmentResultAction({ assignmentId, purpose, expiresAt });
      setMessage(result.error ?? result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  function revoke(grantId: string) {
    startTransition(async () => {
      setMessage(null);
      const result = await revokeAssessmentResultShareAction(grantId, assignmentId);
      setMessage(result.error ?? result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canCreateShare ? (
        <div className="space-y-3 rounded-lg border border-surface-border p-4">
          <p className="text-sm font-medium text-ink">Share this result</p>
          <label className="block text-sm text-ink-muted">
            Why are you sharing it?
            <Input
              className="mt-1"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              maxLength={240}
            />
          </label>
          <label className="block text-sm text-ink-muted">
            Expiry (optional)
            <Input
              className="mt-1"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <Button onClick={share} disabled={pending}>
            {pending ? "Saving…" : "Share with this job's employer"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          Employer-paid results stay scoped to the hiring team and job that assigned them.
          Candidate-managed sharing is available only for candidate-paid results.
        </p>
      )}

      <div>
        <h3 className="text-sm font-medium text-ink">Sharing history</h3>
        {grants.length ? (
          <ul className="mt-2 space-y-2">
            {grants.map((grant) => {
              const expired = grant.expires_at
                ? Date.parse(grant.expires_at) <= Date.parse(asOf)
                : false;
              const active = !grant.revoked_at && !expired;
              return (
                <li key={grant.id} className="rounded-lg border border-surface-border p-3 text-sm">
                  <p className="font-medium text-ink">{grant.recipient_name}</p>
                  <p className="text-ink-muted">Job: {grant.job_title}</p>
                  <p className="text-ink-muted">Why: {grant.purpose}</p>
                  <p className="text-xs text-ink-subtle">
                    Shared {new Date(grant.shared_at).toLocaleDateString()}
                    {grant.expires_at
                      ? ` · Expires ${new Date(grant.expires_at).toLocaleDateString()}`
                      : " · No expiry"}
                    {grant.revoked_at
                      ? ` · Revoked ${new Date(grant.revoked_at).toLocaleDateString()}`
                      : expired
                        ? " · Expired"
                        : " · Active"}
                  </p>
                  {active ? (
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() => revoke(grant.id)}
                    >
                      Revoke access
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">You have not shared this result.</p>
        )}
      </div>
      {message ? (
        <p className="text-sm text-ink-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
