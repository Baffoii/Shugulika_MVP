import "server-only";

import { env } from "@/lib/env";

export const ZOHO_RECRUIT_ORG_SCOPE = "ZohoRecruit.org.all";
export const ZOHO_RECRUIT_SCOPES = [ZOHO_RECRUIT_ORG_SCOPE] as const;
export const ZOHO_RECRUIT_CALLBACK_PATH = "/api/integrations/zoho-recruit/callback";
export const ZOHO_OAUTH_STATE_COOKIE = "shugulika_zoho_recruit_oauth_state";

const ACCOUNTS_HOSTS = new Set([
  "accounts.zoho.com",
  "accounts.zoho.eu",
  "accounts.zoho.in",
  "accounts.zoho.com.au",
  "accounts.zoho.jp",
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
  "www.zohoapis.sa",
  "www.zohoapis.ca",
  "www.zohoapis.com.cn",
  "recruit.zoho.com",
  "recruit.zoho.eu",
  "recruit.zoho.in",
  "recruit.zoho.com.au",
  "recruit.zoho.jp",
  "recruit.zoho.sa",
  "recruit.zohocloud.ca",
  "recruit.zoho.com.cn",
]);

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

function configuredRedirect(): { uri: string; valid: boolean } {
  const fallback = new URL(ZOHO_RECRUIT_CALLBACK_PATH, env.siteUrl()).toString();
  const raw = process.env.ZOHO_RECRUIT_REDIRECT_URI?.trim();
  if (!raw) return { uri: fallback, valid: true };
  try {
    const url = new URL(raw);
    const protocolAllowed =
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
    const valid =
      protocolAllowed &&
      url.pathname === ZOHO_RECRUIT_CALLBACK_PATH &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash;
    return { uri: valid ? url.toString() : fallback, valid };
  } catch {
    return { uri: fallback, valid: false };
  }
}

export function normalizeZohoAccountsDomain(value: string): string {
  return normalizeZohoOrigin(value, ACCOUNTS_HOSTS, "Zoho Accounts");
}

export function normalizeZohoApiDomain(value: string): string {
  return normalizeZohoOrigin(value, API_HOSTS, "Zoho API");
}

function normalizeZohoOrigin(value: string, hosts: Set<string>, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} domain is invalid.`);
  }
  if (
    url.protocol !== "https:" ||
    !hosts.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} domain is not allowed.`);
  }
  return url.origin;
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
    scopes: ZOHO_RECRUIT_SCOPES,
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
