import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptZohoToken } from "@/lib/integrations/zoho-recruit/crypto";

const KEY = Buffer.alloc(32, 9).toString("base64");

const fromMock = vi.fn();

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: fromMock,
  }),
}));

describe("Zoho Recruit client", () => {
  const envKeys = [
    "ZOHO_RECRUIT_ENABLED",
    "ZOHO_RECRUIT_CLIENT_ID",
    "ZOHO_RECRUIT_CLIENT_SECRET",
    "ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SITE_URL",
  ] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    vi.resetModules();
    fromMock.mockReset();
    for (const key of envKeys) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.shugulika.test";
    process.env.ZOHO_RECRUIT_ENABLED = "true";
    process.env.ZOHO_RECRUIT_CLIENT_ID = "client-id";
    process.env.ZOHO_RECRUIT_CLIENT_SECRET = "client-secret";
    process.env.ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY = KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of envKeys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  function mockConnection(overrides: Record<string, unknown> = {}) {
    const row = {
      encrypted_access_token: encryptZohoToken("access-token", KEY),
      encrypted_refresh_token: encryptZohoToken("refresh-token", KEY),
      access_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
      accounts_domain: "https://accounts.zoho.com",
      api_domain: "https://www.zohoapis.com",
      data_center_location: "us",
      status: "connected",
      id: "conn-1",
      ...overrides,
    };

    const terminal = {
      then: undefined as undefined,
      maybeSingle: async () => ({ data: row, error: null }),
      single: async () => ({ data: row, error: null }),
    };

    const eqResult: Record<string, unknown> = {
      maybeSingle: terminal.maybeSingle,
      single: terminal.single,
      or: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: { id: "conn-1" }, error: null }),
        }),
      }),
      select: () => ({
        maybeSingle: async () => ({ data: { id: "conn-1" }, error: null }),
      }),
      // Allow `await update().eq()` without further chaining.
      then: (resolve: (value: { data: null; error: null }) => void) =>
        resolve({ data: null, error: null }),
    };

    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => eqResult,
      }),
      update: () => ({
        eq: () => eqResult,
      }),
    }));

    return row;
  }

  it("coalesces concurrent refresh calls into a single token exchange", async () => {
    mockConnection();
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/oauth/v2/token")) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 30));
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            api_domain: "https://www.zohoapis.com",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    const { refreshZohoAccessToken } = await import("@/lib/integrations/zoho-recruit/client");
    const [a, b] = await Promise.all([
      refreshZohoAccessToken(fetchMock as typeof fetch),
      refreshZohoAccessToken(fetchMock as typeof fetch),
    ]);
    expect(a.accessToken).toBe("new-access");
    expect(b.accessToken).toBe("new-access");
    expect(refreshCalls).toBe(1);
  });

  it("rejects non-allowlisted API domains before calling fetch", async () => {
    mockConnection({
      api_domain: "https://evil.example.com",
      accounts_domain: "https://accounts.zoho.com",
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });

    const fetchMock = vi.fn();
    const { zohoRecruitRequest } = await import("@/lib/integrations/zoho-recruit/client");
    await expect(
      zohoRecruitRequest({ path: "/recruit/v2/Candidates" }, fetchMock as typeof fetch),
    ).rejects.toThrow(/not allowed|Refusing Zoho request/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
