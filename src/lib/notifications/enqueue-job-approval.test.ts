import { beforeEach, describe, expect, it } from "vitest";
import {
  enqueueJobApprovalNotification,
  getJobApprovalNotificationOutbox,
} from "@/lib/notifications/enqueue-job-approval";

describe("enqueueJobApprovalNotification", () => {
  beforeEach(() => {
    // Fresh module state is not reset between tests; drain by claiming.
    const outbox = getJobApprovalNotificationOutbox();
    for (;;) {
      const next = outbox.claimNext({ workerId: "test-drain", leaseMs: 1_000 });
      if (!next) break;
      outbox.complete(next.id, "test-drain");
    }
  });

  it("queues a pending email notification envelope for job approval", async () => {
    const jobOrderId = "11111111-1111-4111-8111-111111111111";
    const result = await enqueueJobApprovalNotification({
      jobOrderId,
      kind: "submitted_to_shugulika",
      organizationId: "22222222-2222-4222-8222-222222222222",
      title: "New job order submitted",
      body: 'Acme submitted "Analyst" for approval.',
      recipientUserIds: ["33333333-3333-4333-8333-333333333333"],
    });

    expect(result.queued).toBe(true);
    expect(result.kind).toBe("submitted_to_shugulika");
    expect(result.envelope).toMatchObject({
      providerFamily: "email",
      eventType: "notification.email.v1",
      aggregateType: "job_order",
      aggregateId: jobOrderId,
      status: "pending",
    });
    expect(result.envelope.payload).toMatchObject({
      kind: "submitted_to_shugulika",
      title: "New job order submitted",
    });
  });

  it("is idempotent for the same business key", async () => {
    const jobOrderId = "44444444-4444-4444-8444-444444444444";
    const first = await enqueueJobApprovalNotification({
      jobOrderId,
      kind: "approved_by_shugulika",
      title: "Approved",
      body: "Ready to publish",
      businessKey: "approve:once",
    });
    const second = await enqueueJobApprovalNotification({
      jobOrderId,
      kind: "approved_by_shugulika",
      title: "Approved again",
      body: "Should not duplicate",
      businessKey: "approve:once",
    });

    expect(second.envelope.id).toBe(first.envelope.id);
    expect(second.envelope.payload).toMatchObject({ title: "Approved" });
  });
});
