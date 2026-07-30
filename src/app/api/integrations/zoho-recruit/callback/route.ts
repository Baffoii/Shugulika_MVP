import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth";
import {
  normalizeZohoAccountsDomain,
  requireZohoRecruitConfig,
  ZOHO_OAUTH_STATE_COOKIE,
} from "@/lib/integrations/zoho-recruit/config";
import { encryptZohoToken } from "@/lib/integrations/zoho-recruit/crypto";
import {
  exchangeZohoAuthorizationCode,
  fetchZohoOrganization,
  zohoOAuthStatesMatch,
} from "@/lib/integrations/zoho-recruit/oauth";
import { saveZohoRecruitConnection } from "@/lib/integrations/zoho-recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringValue(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  return String(value);
}

function finish(configuredRedirectUri: string, status: string): NextResponse {
  const url = new URL("/hq/integrations", configuredRedirectUri);
  url.searchParams.set("zoho", status);
  const response = NextResponse.redirect(url, { status: 303 });
  response.cookies.set(ZOHO_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/integrations/zoho-recruit",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!ctx.roles.includes("hq_admin")) {
    return NextResponse.json({ error: "HQ administrator access required." }, { status: 403 });
  }

  let config;
  try {
    config = requireZohoRecruitConfig();
  } catch {
    return finish(request.url, "configuration_required");
  }

  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) return finish(config.redirectUri, "authorization_denied");

  const expectedState = request.cookies.get(ZOHO_OAUTH_STATE_COOKIE)?.value;
  const receivedState = request.nextUrl.searchParams.get("state");
  if (!zohoOAuthStatesMatch(expectedState, receivedState)) {
    return finish(config.redirectUri, "invalid_state");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return finish(config.redirectUri, "missing_code");

  try {
    const accountsDomain = normalizeZohoAccountsDomain(
      request.nextUrl.searchParams.get("accounts-server") || config.initialAccountsDomain,
    );
    const location = request.nextUrl.searchParams.get("location");
    const tokens = await exchangeZohoAuthorizationCode({
      config,
      code,
      accountsDomain,
    });
    const organization = await fetchZohoOrganization({
      apiDomain: tokens.api_domain,
      accessToken: tokens.access_token,
    });
    const now = Date.now();

    await saveZohoRecruitConnection({
      actorId: ctx.userId,
      zohoOrgId: stringValue(organization.zgid ?? organization.id),
      zohoOrgName: organization.company_name ?? null,
      zohoOrgCountry: organization.country_code ?? organization.country ?? null,
      zohoPlan: organization.license_details?.plan_type ?? null,
      accountsDomain,
      apiDomain: tokens.api_domain,
      dataCenterLocation: location,
      encryptedAccessToken: encryptZohoToken(tokens.access_token, config.encryptionKey),
      encryptedRefreshToken: encryptZohoToken(tokens.refresh_token, config.encryptionKey),
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000).toISOString(),
      grantedScopes: config.scopes,
    });

    return finish(config.redirectUri, "connected");
  } catch (error) {
    console.error(
      "[zoho-recruit/callback]",
      error instanceof Error ? error.message : "Unknown connection error",
    );
    return finish(config.redirectUri, "connection_failed");
  }
}
