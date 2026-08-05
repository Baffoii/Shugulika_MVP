"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitJobOrderWorkflowAction } from "@/app/job-order-actions";
import { ApproveJobOrderByShugulikaButton } from "@/components/jobs/ApproveJobOrderButton";
import { JobOrderChangeRequestButton } from "@/components/jobs/JobOrderChangeRequestButton";
import { PublishJobButton } from "@/components/jobs/PublishJobButton";
import { DenyJobOrderButton } from "@/components/jobs/DenyJobOrderButton";
import { Button } from "@/components/ui/primitives";
import {
  canStaffApproveByShugulika,
  canStaffPublish,
  canStaffRequestChanges,
  canStaffSubmitOffline,
} from "@/lib/jobs";
import type { JobOrderOrigin } from "@/lib/jobs/types";
import { JOB_ORDER_DENIABLE_STATUSES, JOB_ORDER_ORIGIN_LABELS } from "@/lib/jobs/constants";

function SubmitOfflineForApprovalButton({ jobOrderId }: { jobOrderId: string }) {
  const router = useRouter();
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
          startTransition(async () => {
            const result = await submitJobOrderWorkflowAction(jobOrderId);
            if (!result.ok) setError(result.error ?? "Could not submit draft.");
            else router.refresh();
          });
        }}
      >
        {pending ? "Sending…" : "Send for employer approval"}
      </Button>
      {error ? <p className="max-w-48 text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}

export function JobOrderWorkflowActions({
  jobOrderId,
  jobTitle,
  status,
  origin,
  canApprove = false,
  canPublish = false,
  canDeny = false,
  canRequestChanges = false,
  canSubmitOffline = false,
}: {
  jobOrderId: string;
  jobTitle: string;
  status: string;
  origin: JobOrderOrigin | string | null | undefined;
  canApprove?: boolean;
  canPublish?: boolean;
  canDeny?: boolean;
  canRequestChanges?: boolean;
  canSubmitOffline?: boolean;
}) {
  const resolvedOrigin = (
    origin === "shugulika_offline" ? "shugulika_offline" : "employer_online"
  ) as JobOrderOrigin;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
        {JOB_ORDER_ORIGIN_LABELS[resolvedOrigin]}
      </p>
      <div className="flex flex-wrap items-start gap-2">
        {canSubmitOffline && canStaffSubmitOffline(status, resolvedOrigin) ? (
          <SubmitOfflineForApprovalButton jobOrderId={jobOrderId} />
        ) : null}
        {canApprove && canStaffApproveByShugulika(status, resolvedOrigin) ? (
          <ApproveJobOrderByShugulikaButton jobOrderId={jobOrderId} />
        ) : null}
        {canPublish && canStaffPublish(status, resolvedOrigin) ? (
          <PublishJobButton jobOrderId={jobOrderId} />
        ) : null}
        {canRequestChanges && canStaffRequestChanges(status) ? (
          <JobOrderChangeRequestButton jobOrderId={jobOrderId} jobTitle={jobTitle} />
        ) : null}
        {canDeny && JOB_ORDER_DENIABLE_STATUSES.has(status) ? (
          <DenyJobOrderButton jobOrderId={jobOrderId} jobTitle={jobTitle} />
        ) : null}
      </div>
    </div>
  );
}
