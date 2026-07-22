"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignJobOrderRecruiterAction } from "@/app/job-order-actions";
import { Button } from "@/components/ui/primitives";
import type { ScopedRecruiter } from "@/lib/data/staff";

export function AssignJobRecruiterControl({
  jobOrderId,
  responsibleOrgId,
  currentRecruiterId,
  currentRecruiterName,
  recruiters,
  preferredRecruiterId,
}: {
  jobOrderId: string;
  responsibleOrgId: string;
  currentRecruiterId?: string | null;
  currentRecruiterName?: string | null;
  recruiters: ScopedRecruiter[];
  /** Pre-select this recruiter when the job is still unassigned. */
  preferredRecruiterId?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(currentRecruiterId || preferredRecruiterId || "");
  const [error, setError] = useState<string | null>(null);
  const options = recruiters.filter((r) => r.organization_id === responsibleOrgId);

  if (options.length === 0) {
    return (
      <p className="text-xs text-ink-muted">
        No recruiters in this franchise yet. Add one under Users & roles first.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-ink-muted">
        Owner:{" "}
        <span className="font-medium text-ink">{currentRecruiterName?.trim() || "Unassigned"}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input-base max-w-[14rem] py-1.5 text-xs"
          value={selected}
          disabled={pending}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Assign recruiter"
        >
          <option value="">Select recruiter…</option>
          {options.map((recruiter) => (
            <option key={recruiter.id} value={recruiter.id}>
              {recruiter.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !selected || selected === currentRecruiterId}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await assignJobOrderRecruiterAction(jobOrderId, selected);
              if (!result.ok) setError(result.error ?? "Could not assign recruiter.");
              else router.refresh();
            });
          }}
        >
          {pending ? "Saving…" : currentRecruiterId ? "Reassign" : "Assign"}
        </Button>
      </div>
      {error ? <p className="text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}
