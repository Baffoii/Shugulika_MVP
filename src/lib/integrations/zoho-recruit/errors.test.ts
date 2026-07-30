import { describe, expect, it, vi } from "vitest";
import {
  classifyZohoHttpError,
  createZohoCorrelationId,
  parseZohoRateLimitHeaders,
  redactZohoLogText,
  ZohoRecruitApiError,
  zohoBackoffDelayMs,
} from "@/lib/integrations/zoho-recruit/errors";

describe("Zoho Recruit errors", () => {
  it("redacts oauth tokens and secrets from log text", () => {
    const redacted = redactZohoLogText(
      'Authorization Zoho-oauthtoken abc.def access_token":"sekrit" refresh_token=xyz client_secret=shh',
    );
    expect(redacted).not.toMatch(/abc\.def|sekrit|xyz|shh/);
    expect(redacted).toContain("[REDACTED]");
  });

  it("parses known rate-limit header variants", () => {
    const headers = new Headers({
      "X-RATELIMIT-REMAINING": "12",
      "X-RATELIMIT-LIMIT": "100",
      "Retry-After": "5",
    });
    expect(parseZohoRateLimitHeaders(headers)).toEqual({
      remainingCredits: 12,
      limitCredits: 100,
      concurrencyLimit: null,
      retryAfterSeconds: 5,
    });
  });

  it("classifies retryable and non-retryable HTTP statuses", () => {
    const base = {
      body: { code: "RATE", message: "slow down" },
      correlationId: "zr_test",
      rateLimit: null,
    };
    expect(classifyZohoHttpError({ ...base, status: 429 }).retryable).toBe(true);
    expect(classifyZohoHttpError({ ...base, status: 403 }).retryable).toBe(false);
    expect(classifyZohoHttpError({ ...base, status: 409 })).toBeInstanceOf(ZohoRecruitApiError);
    expect(classifyZohoHttpError({ ...base, status: 401 }).status).toBe(401);
  });

  it("creates correlation ids and bounded jittered backoff", () => {
    expect(createZohoCorrelationId()).toMatch(/^zr_/);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const delay = zohoBackoffDelayMs(2, 500, 30_000);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(2000);
  });
});
