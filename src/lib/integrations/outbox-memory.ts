import "server-only";

import { randomUUID } from "node:crypto";

import type { CoreEventType, OutboxEnvelope, ProviderFamily } from "@/lib/integrations/contracts";
import { backoffDelayMs, isLeaseExpired, ProviderError } from "@/lib/integrations/errors";

export type InMemoryOutboxRow = OutboxEnvelope & {
  claimToken: string | null;
};

/** In-memory outbox for unit tests and disabled adapters. Not a production store. */
export class InMemoryOutboxRepository {
  private readonly rows = new Map<string, InMemoryOutboxRow>();

  upsert(row: InMemoryOutboxRow): InMemoryOutboxRow {
    const existing = [...this.rows.values()].find((r) => r.idempotencyKey === row.idempotencyKey);
    if (existing) return existing;
    this.rows.set(row.id, { ...row });
    return this.rows.get(row.id)!;
  }

  getById(id: string): InMemoryOutboxRow | null {
    return this.rows.get(id) ?? null;
  }

  /** Claim the next available pending/failed row whose lease is free or expired. */
  claimNext(input: { workerId: string; leaseMs: number; now?: Date }): InMemoryOutboxRow | null {
    const now = input.now ?? new Date();
    const candidates = [...this.rows.values()]
      .filter((row) => {
        if (
          row.status === "succeeded" ||
          row.status === "dead_letter" ||
          row.status === "cancelled"
        ) {
          return false;
        }
        if (row.status === "claimed" && !isLeaseExpired(row.claimExpiresAt, now)) return false;
        return Date.parse(row.availableAt) <= now.getTime();
      })
      .sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt));

    const next = candidates[0];
    if (!next) return null;

    const claimed: InMemoryOutboxRow = {
      ...next,
      status: "claimed",
      claimToken: input.workerId,
      claimExpiresAt: new Date(now.getTime() + input.leaseMs).toISOString(),
      attemptCount: next.attemptCount + 1,
    };
    this.rows.set(claimed.id, claimed);
    return claimed;
  }

  complete(id: string, claimToken: string, now = new Date()): InMemoryOutboxRow {
    const row = this.requireClaim(id, claimToken);
    const done: InMemoryOutboxRow = {
      ...row,
      status: "succeeded",
      processedAt: now.toISOString(),
      claimToken: null,
      claimExpiresAt: null,
      lastErrorCode: null,
      lastErrorSummary: null,
    };
    this.rows.set(id, done);
    return done;
  }

  fail(
    id: string,
    claimToken: string,
    error: ProviderError,
    input?: { maxAttempts?: number; now?: Date },
  ): InMemoryOutboxRow {
    const now = input?.now ?? new Date();
    const maxAttempts = input?.maxAttempts ?? 8;
    const row = this.requireClaim(id, claimToken);
    const attempts = row.attemptCount;
    const permanent = !error.retryable || attempts >= maxAttempts;
    const delay = permanent ? 0 : backoffDelayMs(attempts);
    const failed: InMemoryOutboxRow = {
      ...row,
      status: permanent ? "dead_letter" : "failed",
      availableAt: permanent ? row.availableAt : new Date(now.getTime() + delay).toISOString(),
      claimToken: null,
      claimExpiresAt: null,
      lastErrorCode: error.code,
      lastErrorSummary: error.message.slice(0, 500),
      processedAt: permanent ? now.toISOString() : null,
    };
    this.rows.set(id, failed);
    return failed;
  }

  private requireClaim(id: string, claimToken: string): InMemoryOutboxRow {
    const row = this.rows.get(id);
    if (!row) throw new Error("Outbox row not found.");
    if (row.status !== "claimed" || row.claimToken !== claimToken) {
      throw new Error("Outbox claim token mismatch.");
    }
    return row;
  }
}

export function createPendingEnvelope(input: {
  providerFamily: ProviderFamily;
  eventType: CoreEventType;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  organizationId: string | null;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string;
  id?: string;
  availableAt?: string;
}): InMemoryOutboxRow {
  const now = new Date().toISOString();
  return {
    id: input.id ?? randomUUID(),
    providerFamily: input.providerFamily,
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    organizationId: input.organizationId,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    status: "pending",
    availableAt: input.availableAt ?? now,
    claimExpiresAt: null,
    attemptCount: 0,
    lastErrorCode: null,
    lastErrorSummary: null,
    createdAt: now,
    processedAt: null,
    correlationId: input.correlationId,
    claimToken: null,
  };
}
