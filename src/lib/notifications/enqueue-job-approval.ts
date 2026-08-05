import "server-only";

import { randomUUID } from "node:crypto";
import {
  buildIdempotencyKey,
  newCorrelationId,
  type OutboxEnvelope,
} from "@/lib/integrations/contracts";
import { InMemoryOutboxRepository } from "@/lib/integrations/outbox-memory";
import type { JobApprovalNotificationKind } from "@/lib/jobs/types";

export type EnqueueJobApprovalNotificationInput = {
  jobOrderId: string;
  kind: JobApprovalNotificationKind;
  organizationId?: string | null;
  title: string;
  body: string;
  /** Optional recipient user ids for future delivery adapters. */
  recipientUserIds?: string[];
  /** Stable business key for idempotent retries of the same intent. */
  businessKey?: string;
};

export type EnqueuedJobApprovalNotification = {
  envelope: OutboxEnvelope;
  kind: JobApprovalNotificationKind;
  queued: true;
};

/** Shared in-process queue until the common notification outbox table lands. */
const jobApprovalOutbox = new InMemoryOutboxRepository();

export function getJobApprovalNotificationOutbox(): InMemoryOutboxRepository {
  return jobApprovalOutbox;
}

/**
 * Enqueue a job-approval notification intent.
 * Provider outages must not lose the approval task — callers should keep the
 * DB transition and this enqueue in the same user-facing action path.
 */
export async function enqueueJobApprovalNotification(
  input: EnqueueJobApprovalNotificationInput,
): Promise<EnqueuedJobApprovalNotification> {
  const now = new Date().toISOString();
  const businessKey = input.businessKey ?? `${input.kind}:${input.jobOrderId}`;
  const idempotencyKey = buildIdempotencyKey({
    providerFamily: "email",
    eventType: "notification.email.v1",
    aggregateId: input.jobOrderId,
    businessKey,
  });

  const envelope: OutboxEnvelope = {
    id: randomUUID(),
    providerFamily: "email",
    eventType: "notification.email.v1",
    eventVersion: 1,
    aggregateType: "job_order",
    aggregateId: input.jobOrderId,
    organizationId: input.organizationId ?? null,
    payload: {
      kind: input.kind,
      title: input.title,
      body: input.body,
      recipientUserIds: input.recipientUserIds ?? [],
      channelHints: ["in_app", "email"],
    },
    idempotencyKey,
    status: "pending",
    availableAt: now,
    claimExpiresAt: null,
    attemptCount: 0,
    lastErrorCode: null,
    lastErrorSummary: null,
    createdAt: now,
    processedAt: null,
    correlationId: newCorrelationId(),
  };

  const stored = jobApprovalOutbox.upsert({ ...envelope, claimToken: null });
  return { envelope: stored, kind: input.kind, queued: true };
}
