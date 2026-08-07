import "server-only";

import { env } from "@/lib/env";

export const ZOHO_RECRUIT_ORG_SCOPE = "ZohoRecruit.org.all";
/** Minimum scopes for org verify + metadata + candidate/job projection. */
export const ZOHO_RECRUIT_SYNC_SCOPES = [
  ZOHO_RECRUIT_ORG_SCOPE,
  "ZohoRecruit.settings.ALL",
  "ZohoRecruit.modules.candidates.CREATE",
  "ZohoRecruit.modules.candidates.UPDATE",
  "ZohoRecruit.modules.candidates.READ",
  "ZohoRecruit.modules.jobopening.CREATE",
  "ZohoRecruit.modules.jobopening.UPDATE",
  "ZohoRecruit.modules.jobopening.READ",
] as const;
/**
 * Read-only scopes for the rehearsal migration.
 *
 * The import path only ever issues GETs, but a token minted with CREATE/UPDATE
 * is *capable* of writing — which leaves code discipline as the only thing
 * standing between a rehearsal and live Zoho data. Consenting to read-only
 * moves that guarantee to Zoho's authorization server: a stray write is
 * rejected by Zoho instead of mutating the production workspace.
 *
 * `settings.ALL` is retained because the importer reads field metadata to build
 * the consent field mapping; it confers no record-write capability.
 */
export const ZOHO_RECRUIT_READONLY_SCOPES = [
  ZOHO_RECRUIT_ORG_SCOPE,
  "ZohoRecruit.settings.ALL",
  "ZohoRecruit.modules.candidates.READ",
  "ZohoRecruit.modules.jobopening.READ",
] as const;

/**
 * True when this process is an explicitly acknowledged rehearsal migration.
 * Mirrors the guard in import/test-source.ts.
 */
export function isZohoTestMigration(): boolean {
  return process.env.ZOHO_TEST_MIGRATION === "true" && process.env.NODE_ENV !== "production";
}

/** Scopes requested at consent time — read-only during a rehearsal. */
export function activeZohoRecruitScopes(): readonly string[] {
  return isZohoTestMigration() ? ZOHO_RECRUIT_READONLY_SCOPES : ZOHO_RECRUIT_SYNC_SCOPES;
}

/** Org-only scopes used by the current connected foundation until HQ reconnects. */
export const ZOHO_RECRUIT_SCOPES = ZOHO_RECRUIT_SYNC_SCOPES;
export const ZOHO_RECRUIT_CALLBACK_PATH = "/api/integrations/zoho-recruit/callback";
export const ZOHO_OAUTH_STATE_COOKIE = "shugulika_zoho_recruit_oauth_state";

export function scopesMissing(
  granted: readonly string[],
  required: readonly string[] = ZOHO_RECRUIT_SYNC_SCOPES,
): string[] {
  const have = new Set(granted.map((s) => s.trim()).filter(Boolean));
  return required.filter((scope) => !have.has(scope));
}

const ACCOUNTS_HOSTS = new Set([
  "accounts.zoho.com",
  "accounts.zoho.eu",
  "accounts.zoho.in",
  "accounts.zoho.com.au",
  "accounts.zoho.jp",
  "accounts.zoho.uk",
  "accounts.zoho.sa",
  "accounts.zohocloud.ca",
  "accounts.zoho.com.cn",
]);

const API_HOSTS = new Set([
  "www.zohoapis.com",
  "www.zohoapis.eu",
  "www.zohoapis.in",
  "www.zohoapis.com.au",
  "www.zohoapis.jp",
  "www.zohoapis.uk",
  "www.zohoapis.sa",
  "www.zohoapis.ca",
  "www.zohoapis.com.cn",
  "recruit.zoho.com",
  "recruit.zoho.eu",
  "recruit.zoho.in",
  "recruit.zoho.com.au",
  "recruit.zoho.jp",
  "recruit.zoho.uk",
  "recruit.zoho.sa",
  "recruit.zohocloud.ca",
  "recruit.zoho.com.cn",
]);

/** OAuth returns zohoapis hosts; Recruit REST APIs are served on recruit.zoho.* */
const ZOHOAPIS_TO_RECRUIT_HOST: Record<string, string> = {
  "www.zohoapis.com": "recruit.zoho.com",
  "www.zohoapis.eu": "recruit.zoho.eu",
  "www.zohoapis.in": "recruit.zoho.in",
  "www.zohoapis.com.au": "recruit.zoho.com.au",
  "www.zohoapis.jp": "recruit.zoho.jp",
  "www.zohoapis.uk": "recruit.zoho.uk",
  "www.zohoapis.sa": "recruit.zoho.sa",
  "www.zohoapis.ca": "recruit.zohocloud.ca",
  "www.zohoapis.com.cn": "recruit.zoho.com.cn",
};

const LOCATION_TO_RECRUIT_HOST: Record<string, string> = {
  us: "recruit.zoho.com",
  eu: "recruit.zoho.eu",
  in: "recruit.zoho.in",
  au: "recruit.zoho.com.au",
  jp: "recruit.zoho.jp",
  uk: "recruit.zoho.uk",
  sa: "recruit.zoho.sa",
  ca: "recruit.zohocloud.ca",
  cn: "recruit.zoho.com.cn",
};

export interface ZohoRecruitConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  initialAccountsDomain: string;
  encryptionKey: string;
  scopes: readonly string[];
}

export interface ZohoRecruitSetupState {
  enabled: boolean;
  ready: boolean;
  redirectUri: string;
  initialAccountsDomain: string;
  scopes: readonly string[];
  missing: string[];
}

function enabledFromEnv(): boolean {
  return process.env.ZOHO_RECRUIT_ENABLED?.trim().toLowerCase() === "true";
}

function encryptionKeyIsValid(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return false;
  const decoded = Buffer.from(normalized, "base64");
  return (
    decoded.length === 32 &&
    decoded.toString("base64").replace(/=+$/, "") === normalized.replace(/=+$/, "")
  );
}

function normalizeRedirectUri(url: URL): string {
  // Zoho compares redirect URIs exactly. Keep a stable origin+path form with no
  // trailing slash on the callback path and no default-port artifacts.
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.protocol}//${url.host}${path}`;
}

function configuredRedirect(): { uri: string; valid: boolean } {
  const fallback = normalizeRedirectUri(new URL(ZOHO_RECRUIT_CALLBACK_PATH, env.siteUrl()));
  const raw = process.env.ZOHO_RECRUIT_REDIRECT_URI?.trim();
  if (!raw) return { uri: fallback, valid: true };
  try {
    const url = new URL(raw);
    const protocolAllowed =
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const valid =
      protocolAllowed &&
      pathname === ZOHO_RECRUIT_CALLBACK_PATH &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
    return { uri: valid ? normalizeRedirectUri(url) : fallback, valid };
  } catch {
    return { uri: fallback, valid: false };
  }
}

export function normalizeZohoAccountsDomain(value: string): string {
  return normalizeZohoOrigin(value, ACCOUNTS_ORIGINS, "Zoho Accounts");
}

export function normalizeZohoApiDomain(value: string): string {
  return normalizeZohoOrigin(value, API_ORIGINS, "Zoho API");
}

function recruitOriginForHost(host: string): string | null {
  return RECRUIT_ORIGINS.get(host) ?? null;
}

/**
 * Recruit REST calls must use recruit.zoho.* — OAuth's api_domain is usually
 * www.zohoapis.*, which 404s for /recruit/v2/*.
 */
export function resolveZohoRecruitApiDomain(input: {
  apiDomain?: string | null;
  location?: string | null;
  accountsDomain?: string | null;
}): string {
  if (input.apiDomain) {
    const normalized = normalizeZohoApiDomain(input.apiDomain);
    const host = new URL(normalized).hostname.toLowerCase();
    const mapped = ZOHOAPIS_TO_RECRUIT_HOST[host];
    if (mapped) {
      const origin = recruitOriginForHost(mapped);
      if (origin) return origin;
    }
    const recruit = recruitOriginForHost(host);
    if (recruit) return recruit;
  }

  const location = input.location?.trim().toLowerCase();
  if (location && LOCATION_TO_RECRUIT_HOST[location]) {
    const origin = recruitOriginForHost(LOCATION_TO_RECRUIT_HOST[location]);
    if (origin) return origin;
  }

  if (input.accountsDomain) {
    const accountsHost = new URL(
      normalizeZohoAccountsDomain(input.accountsDomain),
    ).hostname.toLowerCase();
    const suffix = accountsHost.replace(/^accounts\./, "");
    if (suffix === "zohocloud.ca") {
      return recruitOriginForHost("recruit.zohocloud.ca") ?? "https://recruit.zoho.com";
    }
    if (suffix.startsWith("zoho.")) {
      const origin = recruitOriginForHost(`recruit.${suffix}`);
      if (origin) return origin;
    }
  }

  return "https://recruit.zoho.com";
}

/** Canonical https origins keyed by allowlisted host — returned instead of user input. */
function canonicalHttpsOrigins(hosts: Set<string>): ReadonlyMap<string, string> {
  return new Map([...hosts].map((host) => [host, `https://${host}`]));
}

const ACCOUNTS_ORIGINS = canonicalHttpsOrigins(ACCOUNTS_HOSTS);
const API_ORIGINS = canonicalHttpsOrigins(API_HOSTS);
const RECRUIT_ORIGINS = canonicalHttpsOrigins(
  new Set([...API_HOSTS].filter((host) => host.startsWith("recruit."))),
);

function normalizeZohoOrigin(
  value: string,
  origins: ReadonlyMap<string, string>,
  label: string,
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} domain is invalid.`);
  }
  const host = url.hostname.toLowerCase();
  const canonical = origins.get(host);
  if (
    url.protocol !== "https:" ||
    !canonical ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} domain is not allowed.`);
  }
  // Return the precomputed constant origin so fetch URLs are not user-tainted.
  return canonical;
}

export function getZohoRecruitSetupState(): ZohoRecruitSetupState {
  const missing: string[] = [];
  const enabled = enabledFromEnv();
  const redirect = configuredRedirect();
  if (!process.env.ZOHO_RECRUIT_CLIENT_ID?.trim()) missing.push("ZOHO_RECRUIT_CLIENT_ID");
  if (!process.env.ZOHO_RECRUIT_CLIENT_SECRET?.trim()) missing.push("ZOHO_RECRUIT_CLIENT_SECRET");
  if (!process.env.ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY?.trim()) {
    missing.push("ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY");
  } else if (!encryptionKeyIsValid(process.env.ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY)) {
    missing.push("ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY (invalid)");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!redirect.valid) missing.push("ZOHO_RECRUIT_REDIRECT_URI (invalid)");

  let initialAccountsDomain = "https://accounts.zoho.com";
  try {
    initialAccountsDomain = normalizeZohoAccountsDomain(
      process.env.ZOHO_RECRUIT_ACCOUNTS_DOMAIN?.trim() || initialAccountsDomain,
    );
  } catch {
    missing.push("ZOHO_RECRUIT_ACCOUNTS_DOMAIN (invalid)");
  }

  return {
    enabled,
    ready: enabled && missing.length === 0,
    redirectUri: redirect.uri,
    initialAccountsDomain,
    scopes: activeZohoRecruitScopes(),
    missing,
  };
}

export function getZohoTokenEncryptionKey(): string | null {
  return process.env.ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY?.trim() || null;
}

export function requireZohoRecruitConfig(): ZohoRecruitConfig {
  const setup = getZohoRecruitSetupState();
  if (!setup.enabled) throw new Error("Zoho Recruit connection setup is disabled.");
  if (setup.missing.length > 0) {
    throw new Error(
      `Zoho Recruit server configuration is incomplete: ${setup.missing.join(", ")}.`,
    );
  }
  return {
    enabled: true,
    clientId: process.env.ZOHO_RECRUIT_CLIENT_ID!.trim(),
    clientSecret: process.env.ZOHO_RECRUIT_CLIENT_SECRET!.trim(),
    redirectUri: setup.redirectUri,
    initialAccountsDomain: setup.initialAccountsDomain,
    encryptionKey: process.env.ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY!.trim(),
    scopes: setup.scopes,
  };
}
