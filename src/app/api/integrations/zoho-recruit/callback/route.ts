import { NextResponse, type NextRequest } from "next/server";
import { getSessionContext } from "@/lib/auth";
import {
  normalizeZohoAccountsDomain,
  requireZohoRecruitConfig,
  ZOHO_OAUTH_STATE_COOKIE,
} from "@/lib/integrations/zoho-recruit/config";
import { connectZohoRecruitWithRedirectCode } from "@/lib/integrations/zoho-recruit/connect";
import { zohoOAuthStatesMatch } from "@/lib/integrations/zoho-recruit/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    await connectZohoRecruitWithRedirectCode({
      actorId: ctx.userId,
      code,
      accountsDomain,
      dataCenterLocation: request.nextUrl.searchParams.get("location"),
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
