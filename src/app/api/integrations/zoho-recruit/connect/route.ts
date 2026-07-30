import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import {
  getZohoRecruitSetupState,
  requireZohoRecruitConfig,
  ZOHO_OAUTH_STATE_COOKIE,
} from "@/lib/integrations/zoho-recruit/config";
import {
  buildZohoAuthorizationUrl,
  createZohoOAuthState,
} from "@/lib/integrations/zoho-recruit/oauth";
import { getZohoRecruitConnectionView } from "@/lib/integrations/zoho-recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function integrationsRedirect(status: string): NextResponse {
  const setup = getZohoRecruitSetupState();
  const url = new URL("/hq/integrations", setup.redirectUri);
  url.searchParams.set("zoho", status);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!ctx.roles.includes("hq_admin")) {
    return NextResponse.json({ error: "HQ administrator access required." }, { status: 403 });
  }

  let config;
  try {
    config = requireZohoRecruitConfig();
  } catch {
    return integrationsRedirect("configuration_required");
  }

  const connection = await getZohoRecruitConnectionView();
  if (!connection.storageReady) return integrationsRedirect("storage_required");
  if (connection.status === "connected") return integrationsRedirect("already_connected");

  const state = createZohoOAuthState();
  const response = NextResponse.redirect(buildZohoAuthorizationUrl(config, state));
  response.cookies.set(ZOHO_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.redirectUri.startsWith("https://"),
    sameSite: "lax",
    path: "/api/integrations/zoho-recruit",
    maxAge: 10 * 60,
  });
  return response;
}
