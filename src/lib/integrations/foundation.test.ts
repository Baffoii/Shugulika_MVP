import { describe, expect, it, vi } from "vitest";
import {
  buildIdempotencyKey,
  digestRawBody,
  parseCoreEventType,
  validateOutboxEnvelope,
  validateProviderEventInbox,
} from "@/lib/integrations/contracts";
import {
  backoffDelayMs,
  classifyHttpStatus,
  isLeaseExpired,
  ProviderError,
  redactErrorText,
} from "@/lib/integrations/errors";
import {
  DisabledEmailAdapter,
  DisabledPaymentsAdapter,
  isProviderEnabled,
} from "@/lib/integrations/adapters";
import { createPendingEnvelope, InMemoryOutboxRepository } from "@/lib/integrations/outbox-memory";

describe("integration contracts", () => {
  it("parses the core event catalogue and rejects unknown types", () => {
    expect(parseCoreEventType("payment.verified.v1")).toBe("payment.verified.v1");
    expect(() => parseCoreEventType("payment.verified.v2")).toThrow();
  });

  it("builds deterministic idempotency keys", () => {
    const a = buildIdempotencyKey({
      providerFamily: "payments",
      eventType: "payment.verified.v1",
      aggregateId: "11111111-1111-4111-8111-111111111111",
      businessKey: "tx-99",
    });
    const b = buildIdempotencyKey({
      providerFamily: "payments",
      eventType: "payment.verified.v1",
      aggregateId: "11111111-1111-4111-8111-111111111111",
      businessKey: "tx-99",
    });
    const c = buildIdempotencyKey({
      providerFamily: "payments",
      eventType: "payment.verified.v1",
      aggregateId: "11111111-1111-4111-8111-111111111111",
      businessKey: "tx-100",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64);
  });

  it("validates outbox envelopes and inbox records", () => {
    const now = new Date().toISOString();
    const envelope = validateOutboxEnvelope({
      id: "22222222-2222-4222-8222-222222222222",
      providerFamily: "email",
      eventType: "notification.email.v1",
      eventVersion: 1,
      aggregateType: "employer_application",
      aggregateId: "33333333-3333-4333-8333-333333333333",
      organizationId: null,
      payload: { template: "decision" },
      idempotencyKey: "a".repeat(32),
      status: "pending",
      availableAt: now,
      claimExpiresAt: null,
      attemptCount: 0,
      lastErrorCode: null,
      lastErrorSummary: null,
      createdAt: now,
      processedAt: null,
      correlationId: "corr-1",
    });
    expect(envelope.eventType).toBe("notification.email.v1");

    const inbox = validateProviderEventInbox({
      id: "44444444-4444-4444-8444-444444444444",
      provider: "payments",
      providerEventId: "flw-1",
      signatureVerified: true,
      rawBodyDigest: digestRawBody('{"id":1}'),
      eventType: "charge.completed",
      eventVersion: 1,
      internalReference: "pi_1",
      receivedAt: now,
      processedAt: null,
      status: "received",
      attemptCount: 0,
      lastErrorSummary: null,
    });
    expect(inbox.signatureVerified).toBe(true);
  });
});

describe("integration errors", () => {
  it("redacts bearer tokens and secret fields", () => {
    const redacted = redactErrorText(
      'Authorization: Bearer super-secret-token access_token":"abc123secret" refresh_token":"xyz"',
    );
    expect(redacted).not.toMatch(/super-secret-token/);
    expect(redacted).toMatch(/REDACTED/);
  });

  it("classifies HTTP statuses and computes backoff", () => {
    expect(classifyHttpStatus(429)).toBe("transient");
    expect(classifyHttpStatus(500)).toBe("transient");
    expect(classifyHttpStatus(400)).toBe("permanent");
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(backoffDelayMs(1, { baseMs: 1000, maxMs: 10_000 })).toBe(1000);
    expect(backoffDelayMs(3, { baseMs: 1000, maxMs: 10_000 })).toBe(4000);
    vi.restoreAllMocks();
  });

  it("detects expired leases", () => {
    expect(isLeaseExpired(null)).toBe(true);
    expect(isLeaseExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isLeaseExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
  });
});

describe("in-memory outbox", () => {
  it("dedupes by idempotency key and supports claim/complete", () => {
    const repo = new InMemoryOutboxRepository();
    const base = createPendingEnvelope({
      providerFamily: "email",
      eventType: "notification.email.v1",
      eventVersion: 1,
      aggregateType: "application",
      aggregateId: "55555555-5555-4555-8555-555555555555",
      organizationId: null,
      payload: { ok: true },
      idempotencyKey: "idem-1",
      correlationId: "c1",
      id: "66666666-6666-4666-8666-666666666666",
    });
    const first = repo.upsert(base);
    const second = repo.upsert({ ...base, id: "77777777-7777-4777-8777-777777777777" });
    expect(second.id).toBe(first.id);

    const claimed = repo.claimNext({ workerId: "w1", leaseMs: 60_000 });
    expect(claimed?.status).toBe("claimed");
    expect(repo.claimNext({ workerId: "w2", leaseMs: 60_000 })).toBeNull();
    const done = repo.complete(claimed!.id, "w1");
    expect(done.status).toBe("succeeded");
  });

  it("reclaims expired leases and dead-letters permanent errors", () => {
    const repo = new InMemoryOutboxRepository();
    // The lease clock below is fixed, so the envelope must be pinned to the same
    // timeline. `createPendingEnvelope` defaults `availableAt` to the real wall
    // clock, and `claimNext` only claims rows where `availableAt <= now` — left
    // to default, this row stops being claimable once real time passes the fixed
    // `now`, which is a time bomb rather than a test.
    const CLAIM_AT = new Date("2026-08-04T10:00:00.000Z");
    const row = repo.upsert(
      createPendingEnvelope({
        providerFamily: "whatsapp",
        eventType: "notification.whatsapp.template.v1",
        eventVersion: 1,
        aggregateType: "notification",
        aggregateId: "88888888-8888-4888-8888-888888888888",
        organizationId: null,
        payload: {},
        idempotencyKey: "idem-2",
        correlationId: "c2",
        availableAt: "2026-08-04T09:59:00.000Z",
      }),
    );
    const claimed = repo.claimNext({
      workerId: "w1",
      leaseMs: 1,
      now: CLAIM_AT,
    });
    expect(claimed?.id).toBe(row.id);

    const reclaimed = repo.claimNext({
      workerId: "w2",
      leaseMs: 60_000,
      now: new Date(CLAIM_AT.getTime() + 5_000),
    });
    expect(reclaimed?.claimToken).toBe("w2");
    expect(reclaimed?.attemptCount).toBe(2);

    const failed = repo.fail(
      reclaimed!.id,
      "w2",
      new ProviderError({
        code: "whatsapp_disabled",
        message: "disabled",
        errorClass: "permanent",
      }),
    );
    expect(failed.status).toBe("dead_letter");
  });
});

describe("disabled adapters and flags", () => {
  it("fails closed when providers are disabled", async () => {
    const email = new DisabledEmailAdapter();
    expect(email.health().enabled).toBe(false);
    await expect(
      email.send({
        to: "a@example.com",
        subject: "t",
        html: "<p>x</p>",
        correlationId: "c",
        idempotencyKey: "k",
      }),
    ).rejects.toMatchObject({ code: "email_disabled", retryable: false });

    const payments = new DisabledPaymentsAdapter();
    await expect(
      payments.createHostedCheckout({
        paymentIntentId: "pi",
        amountMinor: 1000,
        currency: "TZS",
        organizationId: "org",
        correlationId: "c",
      }),
    ).rejects.toMatchObject({ code: "payments_disabled" });
  });

  it("reads feature flags as fail-closed", () => {
    delete process.env.FLUTTERWAVE_ENABLED;
    expect(isProviderEnabled("payments")).toBe(false);
    process.env.FLUTTERWAVE_ENABLED = "true";
    expect(isProviderEnabled("payments")).toBe(true);
    delete process.env.FLUTTERWAVE_ENABLED;
  });
});
