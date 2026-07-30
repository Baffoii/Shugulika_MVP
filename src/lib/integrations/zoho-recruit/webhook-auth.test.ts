import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyZohoWebhookAuth } from "@/lib/integrations/zoho-recruit/webhook-auth";

describe("Zoho webhook auth", () => {
  const KEY = "ZOHO_RECRUIT_WEBHOOK_SECRET";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("fails closed when the secret is not configured", () => {
    const result = verifyZohoWebhookAuth(
      new Request("https://example.test/webhook", {
        headers: { Authorization: "Bearer anything" },
      }),
    );
    expect(result).toEqual({ ok: false, reason: "webhook_secret_not_configured" });
  });

  it("accepts Authorization Bearer matching the shared secret", () => {
    process.env[KEY] = "webhook-secret-value";
    expect(
      verifyZohoWebhookAuth(
        new Request("https://example.test/webhook", {
          headers: { Authorization: "Bearer webhook-secret-value" },
        }),
      ).ok,
    ).toBe(true);
  });

  it("accepts X-Shugulika-Zoho-Webhook-Secret", () => {
    process.env[KEY] = "webhook-secret-value";
    expect(
      verifyZohoWebhookAuth(
        new Request("https://example.test/webhook", {
          headers: { "X-Shugulika-Zoho-Webhook-Secret": "webhook-secret-value" },
        }),
      ).ok,
    ).toBe(true);
  });

  it("rejects mismatched secrets", () => {
    process.env[KEY] = "webhook-secret-value";
    expect(
      verifyZohoWebhookAuth(
        new Request("https://example.test/webhook", {
          headers: { Authorization: "Bearer wrong" },
        }),
      ),
    ).toEqual({ ok: false, reason: "invalid_webhook_secret" });
  });
});
