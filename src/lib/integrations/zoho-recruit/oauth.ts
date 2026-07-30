import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  normalizeZohoAccountsDomain,
  normalizeZohoApiDomain,
  type ZohoRecruitConfig,
} from "@/lib/integrations/zoho-recruit/config";

const TokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  api_domain: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.coerce.number().positive().default(3600),
});

const OrganizationRecord = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    zgid: z.union([z.string(), z.number()]).optional(),
    company_name: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    country_code: z.string().nullable().optional(),
    license_details: z
      .object({
        plan_type: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const OrganizationResponse = z.object({
  org: z.array(OrganizationRecord).min(1),
});

export type ZohoTokenResponse = z.infer<typeof TokenResponse>;
export type ZohoOrganization = z.infer<typeof OrganizationRecord>;

export function createZohoOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function zohoOAuthStatesMatch(
  expected: string | undefined,
  received: string | null,
): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildZohoAuthorizationUrl(config: ZohoRecruitConfig, state: string): URL {
  const url = new URL("/oauth/v2/auth", config.initialAccountsDomain);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeZohoAuthorizationCode(input: {
  config: ZohoRecruitConfig;
  code: string;
  accountsDomain: string;
  fetchImpl?: typeof fetch;
}): Promise<ZohoTokenResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const accountsDomain = normalizeZohoAccountsDomain(input.accountsDomain);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    redirect_uri: input.config.redirectUri,
    code: input.code,
  });
  const response = await fetchImpl(`${accountsDomain}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Zoho did not accept the authorization code.");
  const parsed = TokenResponse.safeParse(payload);
  if (!parsed.success) throw new Error("Zoho returned an incomplete token response.");
  return { ...parsed.data, api_domain: normalizeZohoApiDomain(parsed.data.api_domain) };
}

export async function fetchZohoOrganization(input: {
  apiDomain: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<ZohoOrganization> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const apiDomain = normalizeZohoApiDomain(input.apiDomain);
  const response = await fetchImpl(`${apiDomain}/recruit/v2/org`, {
    method: "GET",
    headers: { Authorization: `Zoho-oauthtoken ${input.accessToken}` },
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Zoho Recruit organization verification failed.");
  const parsed = OrganizationResponse.safeParse(payload);
  if (!parsed.success) throw new Error("Zoho Recruit returned incomplete organization data.");
  return parsed.data.org[0]!;
}

export async function revokeZohoRefreshToken(input: {
  accountsDomain: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const accountsDomain = normalizeZohoAccountsDomain(input.accountsDomain);
  const url = new URL("/oauth/v2/token/revoke", accountsDomain);
  url.searchParams.set("token", input.refreshToken);
  const response = await fetchImpl(url, { method: "POST", cache: "no-store" });
  return response.ok;
}
