import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

/** Provider families that share the common outbox/inbox contracts. */
export const PROVIDER_FAMILIES = [
  "email",
  "whatsapp",
  "payments",
  "accounting",
  "recruitment",
  "assessment",
] as const;

export type ProviderFamily = (typeof PROVIDER_FAMILIES)[number];

export const OUTBOX_STATUSES = [
  "pending",
  "claimed",
  "succeeded",
  "failed",
  "dead_letter",
  "cancelled",
] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** Initial core event catalogue (versioned). */
export const CORE_EVENT_TYPES = [
  "notification.email.v1",
  "notification.whatsapp.template.v1",
  "payment.intent.created.v1",
  "payment.verified.v1",
  "accounting.customer.upsert.v1",
  "accounting.invoice.upsert.v1",
  "accounting.payment.upsert.v1",
  "recruitment.zoho.project.v1",
  "recruitment.zoho.reconcile.v1",
  "assessment.external.order.v1",
] as const;

export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];

const CoreEventTypeSchema = z.enum(CORE_EVENT_TYPES);

export const OutboxEnvelopeSchema = z.object({
  id: z.string().uuid(),
  providerFamily: z.enum(PROVIDER_FAMILIES),
  eventType: CoreEventTypeSchema,
  eventVersion: z.number().int().positive(),
  aggregateType: z.string().min(1).max(100),
  aggregateId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8).max(200),
  status: z.enum(OUTBOX_STATUSES),
  availableAt: z.string().datetime(),
  claimExpiresAt: z.string().datetime().nullable(),
  attemptCount: z.number().int().nonnegative(),
  lastErrorCode: z.string().max(100).nullable(),
  lastErrorSummary: z.string().max(500).nullable(),
  createdAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
  correlationId: z.string().min(1).max(100),
});

export type OutboxEnvelope = z.infer<typeof OutboxEnvelopeSchema>;

export const ProviderEventInboxSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(PROVIDER_FAMILIES),
  providerEventId: z.string().min(1).max(200).nullable(),
  signatureVerified: z.boolean(),
  rawBodyDigest: z.string().min(16).max(128),
  eventType: z.string().min(1).max(100),
  eventVersion: z.number().int().positive(),
  internalReference: z.string().max(200).nullable(),
  receivedAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
  status: z.enum(["received", "processing", "succeeded", "ignored", "failed"]),
  attemptCount: z.number().int().nonnegative(),
  lastErrorSummary: z.string().max(500).nullable(),
});

export type ProviderEventInbox = z.infer<typeof ProviderEventInboxSchema>;

export function parseCoreEventType(value: string): CoreEventType {
  return CoreEventTypeSchema.parse(value);
}

export function validateOutboxEnvelope(input: unknown): OutboxEnvelope {
  return OutboxEnvelopeSchema.parse(input);
}

export function validateProviderEventInbox(input: unknown): ProviderEventInbox {
  return ProviderEventInboxSchema.parse(input);
}

/**
 * Deterministic idempotency key for outbox instructions.
 * Does not include mutable payload fields.
 */
export function buildIdempotencyKey(input: {
  providerFamily: ProviderFamily;
  eventType: CoreEventType;
  aggregateId: string;
  businessKey: string;
}): string {
  const material = [
    input.providerFamily,
    input.eventType,
    input.aggregateId,
    input.businessKey.trim(),
  ].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 64);
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function digestRawBody(rawBody: string | Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex");
}
