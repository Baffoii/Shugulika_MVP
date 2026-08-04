import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Webhook authenticity for Zoho Recruit workflow webhooks.
 *
 * Zoho workflow webhooks do not provide cryptographic signatures (HMAC) over the
 * body. Authenticity here is a shared secret carried in Authorization: Bearer
 * or X-Shugulika-Zoho-Webhook-Secret, compared with ZOHO_RECRUIT_WEBHOOK_SECRET
 * using a timing-safe equality check. Replay protection relies on inbox
 * dedupe_key / payload_hash, not on Zoho signatures.
 */

function secretsEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractProvidedSecret(request: Request): string | null {
  const headerSecret = request.headers.get("x-shugulika-zoho-webhook-secret")?.trim();
  if (headerSecret) return headerSecret;

  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}

export function verifyZohoWebhookAuth(request: Request): {
  ok: boolean;
  reason?: string;
} {
  const expected = process.env.ZOHO_RECRUIT_WEBHOOK_SECRET?.trim();
  if (!expected) {
    return { ok: false, reason: "webhook_secret_not_configured" };
  }

  const provided = extractProvidedSecret(request);
  if (!provided) {
    return { ok: false, reason: "missing_webhook_secret" };
  }

  if (!secretsEqual(expected, provided)) {
    return { ok: false, reason: "invalid_webhook_secret" };
  }

  return { ok: true };
}
