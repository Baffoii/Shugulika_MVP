import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getZohoRecruitSetupState,
  normalizeZohoAccountsDomain,
  normalizeZohoApiDomain,
  requireZohoRecruitConfig,
} from "@/lib/integrations/zoho-recruit/config";
import {
  buildZohoAuthorizationUrl,
  createZohoOAuthState,
  exchangeZohoAuthorizationCode,
  fetchZohoOrganization,
  zohoOAuthStatesMatch,
} from "@/lib/integrations/zoho-recruit/oauth";

const KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ZOHO_RECRUIT_ENABLED",
  "ZOHO_RECRUIT_CLIENT_ID",
  "ZOHO_RECRUIT_CLIENT_SECRET",
  "ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY",
  "ZOHO_RECRUIT_REDIRECT_URI",
  "ZOHO_RECRUIT_ACCOUNTS_DOMAIN",
] as const;

describe("Zoho Recruit OAuth foundation", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.shugulika.test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  function configure() {
    process.env.ZOHO_RECRUIT_ENABLED = "true";
    process.env.ZOHO_RECRUIT_CLIENT_ID = "client-id";
    process.env.ZOHO_RECRUIT_CLIENT_SECRET = "client-secret";
    process.env.ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  }

  it("is disabled and incomplete by default", () => {
    const state = getZohoRecruitSetupState();
    expect(state.enabled).toBe(false);
    expect(state.ready).toBe(false);
    expect(state.redirectUri).toBe(
      "https://app.shugulika.test/api/integrations/zoho-recruit/callback",
    );
    expect(state.scopes).toEqual(["ZohoRecruit.org.all"]);
  });

  it("becomes ready only with all server-side credentials", () => {
    configure();
    expect(getZohoRecruitSetupState()).toMatchObject({ enabled: true, ready: true, missing: [] });
  });

  it("rejects a malformed token-encryption key before authorization starts", () => {
    configure();
    process.env.ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY = "not-a-32-byte-key";
    const state = getZohoRecruitSetupState();
    expect(state.ready).toBe(false);
    expect(state.missing).toContain("ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY (invalid)");
  });

  it("fails closed without crashing the HQ page when optional URLs are malformed", () => {
    configure();
    process.env.ZOHO_RECRUIT_REDIRECT_URI = "javascript:alert(1)";
    process.env.ZOHO_RECRUIT_ACCOUNTS_DOMAIN = "https://accounts.zoho.com.evil.test";
    const state = getZohoRecruitSetupState();
    expect(state.ready).toBe(false);
    expect(state.redirectUri).toBe(
      "https://app.shugulika.test/api/integrations/zoho-recruit/callback",
    );
    expect(state.initialAccountsDomain).toBe("https://accounts.zoho.com");
    expect(state.missing).toEqual(
      expect.arrayContaining([
        "ZOHO_RECRUIT_REDIRECT_URI (invalid)",
        "ZOHO_RECRUIT_ACCOUNTS_DOMAIN (invalid)",
      ]),
    );
  });

  it("accepts only known HTTPS Zoho domains", () => {
    expect(normalizeZohoAccountsDomain("https://accounts.zoho.eu")).toBe(
      "https://accounts.zoho.eu",
    );
    expect(normalizeZohoApiDomain("https://www.zohoapis.com.au")).toBe(
      "https://www.zohoapis.com.au",
    );
    expect(() => normalizeZohoAccountsDomain("https://accounts.zoho.com.evil.test")).toThrow(
      /not allowed/,
    );
    expect(() => normalizeZohoApiDomain("http://www.zohoapis.com")).toThrow(/not allowed/);
  });

  it("builds a server authorization request with state and org-only scope", () => {
    configure();
    const url = buildZohoAuthorizationUrl(requireZohoRecruitConfig(), "state-value");
    expect(url.origin).toBe("https://accounts.zoho.com");
    expect(url.pathname).toBe("/oauth/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("ZohoRecruit.org.all");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.toString()).not.toContain("client-secret");
  });

  it("uses constant-time comparable random state values", () => {
    const state = createZohoOAuthState();
    expect(state.length).toBeGreaterThan(30);
    expect(zohoOAuthStatesMatch(state, state)).toBe(true);
    expect(zohoOAuthStatesMatch(state, `${state}x`)).toBe(false);
    expect(zohoOAuthStatesMatch(undefined, state)).toBe(false);
  });

  it("exchanges the one-time code in the POST body and adopts the returned API domain", async () => {
    configure();
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const body = init?.body as URLSearchParams;
      expect(body.get("code")).toBe("one-time-code");
      expect(body.get("client_secret")).toBe("client-secret");
      return new Response(
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          api_domain: "https://www.zohoapis.eu",
          expires_in: 3600,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const result = await exchangeZohoAuthorizationCode({
      config: requireZohoRecruitConfig(),
      code: "one-time-code",
      accountsDomain: "https://accounts.zoho.eu",
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(result.api_domain).toBe("https://www.zohoapis.eu");
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("one-time-code");
  });

  it("verifies the connected Recruit organization without requesting records", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://www.zohoapis.com/recruit/v2/org");
      expect(init?.headers).toEqual({ Authorization: "Zoho-oauthtoken access" });
      return new Response(
        JSON.stringify({
          org: [
            {
              zgid: "12345",
              company_name: "Shugulika",
              country_code: "TZ",
              license_details: { plan_type: "enterprise" },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const organization = await fetchZohoOrganization({
      apiDomain: "https://www.zohoapis.com",
      accessToken: "access",
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(organization).toMatchObject({ zgid: "12345", company_name: "Shugulika" });
  });
});
