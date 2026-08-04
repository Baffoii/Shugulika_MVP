import "server-only";

/** Permanent failures must not be retried; transient failures use backoff. */
export type ErrorClass = "transient" | "permanent";

export class ProviderError extends Error {
  readonly code: string;
  readonly errorClass: ErrorClass;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; errorClass: ErrorClass }) {
    super(input.message);
    this.name = "ProviderError";
    this.code = input.code;
    this.errorClass = input.errorClass;
    this.retryable = input.errorClass === "transient";
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /sk-[A-Za-z0-9]{10,}/g,
  /-----BEGIN[^-]+PRIVATE KEY-----[\s\S]*?-----END[^-]+PRIVATE KEY-----/g,
  /("?(?:access_token|refresh_token|client_secret|webhook_secret|authorization)"?\s*[:=]\s*")([^"]+)(")/gi,
];

/** Redact secrets and truncate for logs / last_error_summary. */
export function redactErrorText(input: string, maxLen = 400): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, ...args) => {
      if (args.length >= 3 && typeof args[0] === "string" && typeof args[2] === "string") {
        return `${args[0]}[REDACTED]${args[2]}`;
      }
      return "[REDACTED]";
    });
  }
  out = out.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "[REDACTED_B64]");
  if (out.length <= maxLen) return out;
  return `${out.slice(0, maxLen - 1)}…`;
}

export function classifyHttpStatus(status: number): ErrorClass {
  if (status === 408 || status === 425 || status === 429) return "transient";
  if (status >= 500) return "transient";
  return "permanent";
}

/** Exponential backoff with jitter; caps at maxMs. */
export function backoffDelayMs(
  attempt: number,
  input?: { baseMs?: number; maxMs?: number },
): number {
  const baseMs = input?.baseMs ?? 1_000;
  const maxMs = input?.maxMs ?? 15 * 60_000;
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.1));
  return Math.min(maxMs, exp + jitter);
}

export function isLeaseExpired(
  claimExpiresAt: string | null | undefined,
  now = new Date(),
): boolean {
  if (!claimExpiresAt) return true;
  return Date.parse(claimExpiresAt) <= now.getTime();
}
