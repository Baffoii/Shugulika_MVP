import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Authorize protected Zoho Recruit worker / cron route handlers.
 * Accepts Authorization: Bearer matching ZOHO_RECRUIT_WORKER_SECRET or CRON_SECRET.
 * Fails closed when neither secret is configured.
 */
export function requireWorkerAuthorization(request: Request): Response | null {
  const workerSecret = process.env.ZOHO_RECRUIT_WORKER_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const expected = workerSecret || cronSecret;

  if (!expected) {
    return new Response(JSON.stringify({ error: "worker_secret_not_configured" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authorization = request.headers.get("authorization");
  const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization.trim()) : null;
  const provided = match?.[1]?.trim() ?? "";

  if (!provided || !secretsEqual(expected, provided)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

function secretsEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
