import "server-only";

/** Correlation ID for redacted Zoho logs — never include PII. */
export function createZohoCorrelationId(): string {
  return `zr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class ZohoRecruitApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly rateLimit: ZohoRateLimitInfo | null;

  constructor(input: {
    message: string;
    status: number;
    code?: string | null;
    retryable: boolean;
    correlationId: string;
    rateLimit?: ZohoRateLimitInfo | null;
  }) {
    super(input.message);
    this.name = "ZohoRecruitApiError";
    this.status = input.status;
    this.code = input.code ?? null;
    this.retryable = input.retryable;
    this.correlationId = input.correlationId;
    this.rateLimit = input.rateLimit ?? null;
  }
}

export interface ZohoRateLimitInfo {
  remainingCredits: number | null;
  limitCredits: number | null;
  concurrencyLimit: number | null;
  retryAfterSeconds: number | null;
}

const SECRET_PATTERNS = [
  /Zoho-oauthtoken\s+\S+/gi,
  /access_token["']?\s*[:=]\s*["']?[^"'&\s]+/gi,
  /refresh_token["']?\s*[:=]\s*["']?[^"'&\s]+/gi,
  /client_secret["']?\s*[:=]\s*["']?[^"'&\s]+/gi,
];

export function redactZohoLogText(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function parseZohoRateLimitHeaders(headers: Headers): ZohoRateLimitInfo {
  const num = (name: string): number | null => {
    const raw = headers.get(name);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  // Zoho documents rolling API credits; header names vary by product generation.
  // Capture known variants without inventing values when absent.
  return {
    remainingCredits:
      num("X-RATELIMIT-REMAINING") ?? num("X-API-CREDIT-REMAINING") ?? num("X-ZCREDITS-REMAINING"),
    limitCredits: num("X-RATELIMIT-LIMIT") ?? num("X-API-CREDIT-LIMIT") ?? num("X-ZCREDITS-LIMIT"),
    concurrencyLimit: num("X-CONCURRENCY-LIMIT"),
    retryAfterSeconds: num("Retry-After"),
  };
}

export function isRetryableZohoStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

export function classifyZohoHttpError(input: {
  status: number;
  body: unknown;
  correlationId: string;
  rateLimit: ZohoRateLimitInfo | null;
}): ZohoRecruitApiError {
  const code =
    typeof input.body === "object" &&
    input.body &&
    "code" in input.body &&
    typeof (input.body as { code: unknown }).code === "string"
      ? (input.body as { code: string }).code
      : null;
  const message =
    typeof input.body === "object" &&
    input.body &&
    "message" in input.body &&
    typeof (input.body as { message: unknown }).message === "string"
      ? redactZohoLogText((input.body as { message: string }).message)
      : `Zoho Recruit request failed (HTTP ${input.status})`;

  if (input.status === 401) {
    return new ZohoRecruitApiError({
      message: `Zoho authorization rejected (${code ?? "unauthorized"}).`,
      status: 401,
      code,
      retryable: true,
      correlationId: input.correlationId,
      rateLimit: input.rateLimit,
    });
  }
  if (input.status === 403) {
    return new ZohoRecruitApiError({
      message: `Zoho permission denied (${code ?? "forbidden"}).`,
      status: 403,
      code,
      retryable: false,
      correlationId: input.correlationId,
      rateLimit: input.rateLimit,
    });
  }
  if (input.status === 409) {
    return new ZohoRecruitApiError({
      message: `Zoho conflict (${code ?? "conflict"}).`,
      status: 409,
      code,
      retryable: false,
      correlationId: input.correlationId,
      rateLimit: input.rateLimit,
    });
  }
  if (input.status === 429) {
    return new ZohoRecruitApiError({
      message: "Zoho rate limit or API-credit budget exhausted.",
      status: 429,
      code,
      retryable: true,
      correlationId: input.correlationId,
      rateLimit: input.rateLimit,
    });
  }
  return new ZohoRecruitApiError({
    message,
    status: input.status,
    code,
    retryable: isRetryableZohoStatus(input.status),
    correlationId: input.correlationId,
    rateLimit: input.rateLimit,
  });
}

/** Bounded exponential backoff with full jitter. */
export function zohoBackoffDelayMs(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(Math.random() * (exp + 1));
}
