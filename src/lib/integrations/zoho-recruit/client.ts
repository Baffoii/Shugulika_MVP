import "server-only";

import { z } from "zod";
import {
  normalizeZohoAccountsDomain,
  requireZohoRecruitConfig,
  resolveZohoRecruitApiDomain,
} from "@/lib/integrations/zoho-recruit/config";
import { decryptZohoToken, encryptZohoToken } from "@/lib/integrations/zoho-recruit/crypto";
import {
  classifyZohoHttpError,
  createZohoCorrelationId,
  parseZohoRateLimitHeaders,
  zohoBackoffDelayMs,
  type ZohoRateLimitInfo,
} from "@/lib/integrations/zoho-recruit/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const RefreshTokenResponse = z.object({
  access_token: z.string().min(1),
  api_domain: z.string().min(1).optional(),
  expires_in: z.coerce.number().positive().default(3600),
  token_type: z.string().optional(),
});

export interface ZohoRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Skip automatic 401→refresh→retry once. */
  skipAuthRetry?: boolean;
}

export interface ZohoBinaryResult {
  bytes: Uint8Array;
  contentType: string | null;
  contentDisposition: string | null;
  status: number;
  rateLimit: ZohoRateLimitInfo;
  correlationId: string;
  apiDomain: string;
}

export interface ZohoRequestResult<T> {
  data: T;
  status: number;
  rateLimit: ZohoRateLimitInfo;
  correlationId: string;
  apiDomain: string;
}

type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  accountsDomain: string;
  apiDomain: string;
  dataCenterLocation: string | null;
  expiresAtMs: number;
};

const REFRESH_SKEW_MS = 60_000;
const REFRESH_LOCK_MS = 15_000;
let inFlightRefresh: Promise<TokenBundle> | null = null;

function requireServiceClient() {
  const client = createServiceRoleClient();
  if (!client) throw new Error("Server credential storage is not configured.");
  return client;
}

async function loadTokenBundle(): Promise<TokenBundle> {
  const client = requireServiceClient();
  const config = requireZohoRecruitConfig();
  const { data, error } = await client
    .from("zoho_recruit_connections")
    .select(
      "encrypted_access_token, encrypted_refresh_token, access_token_expires_at, accounts_domain, api_domain, data_center_location, status",
    )
    .eq("connection_key", "primary")
    .maybeSingle();
  if (error || !data) throw new Error("Zoho Recruit connection is not available.");
  if (data.status !== "connected") throw new Error("Zoho Recruit is not connected.");
  if (!data.encrypted_access_token || !data.encrypted_refresh_token || !data.accounts_domain) {
    throw new Error("Zoho Recruit credentials are incomplete.");
  }
  return {
    accessToken: decryptZohoToken(data.encrypted_access_token, config.encryptionKey),
    refreshToken: decryptZohoToken(data.encrypted_refresh_token, config.encryptionKey),
    accountsDomain: normalizeZohoAccountsDomain(data.accounts_domain),
    apiDomain: resolveZohoRecruitApiDomain({
      apiDomain: data.api_domain,
      location: data.data_center_location,
      accountsDomain: data.accounts_domain,
    }),
    dataCenterLocation: data.data_center_location,
    expiresAtMs: data.access_token_expires_at
      ? new Date(data.access_token_expires_at).getTime()
      : 0,
  };
}

async function persistRefreshedAccessToken(input: {
  accessToken: string;
  apiDomain?: string;
  expiresIn: number;
  accountsDomain: string;
  dataCenterLocation: string | null;
}): Promise<void> {
  const client = requireServiceClient();
  const config = requireZohoRecruitConfig();
  const apiDomain = resolveZohoRecruitApiDomain({
    apiDomain: input.apiDomain,
    location: input.dataCenterLocation,
    accountsDomain: input.accountsDomain,
  });
  const { error } = await client
    .from("zoho_recruit_connections")
    .update({
      encrypted_access_token: encryptZohoToken(input.accessToken, config.encryptionKey),
      access_token_expires_at: new Date(Date.now() + input.expiresIn * 1000).toISOString(),
      api_domain: apiDomain,
      last_verified_at: new Date().toISOString(),
      last_error: null,
      // Clear refresh lock if the column exists (added by sync migration).
      token_refresh_lock_until: null,
    } as never)
    .eq("connection_key", "primary");
  if (error) throw new Error("Failed to persist refreshed Zoho access token.");
}

async function claimRefreshLock(): Promise<boolean> {
  const client = requireServiceClient();
  const lockUntil = new Date(Date.now() + REFRESH_LOCK_MS).toISOString();
  const now = new Date().toISOString();
  // Best-effort concurrency lock. If the column is missing (pre-migration), fall through.
  const { data, error } = await client
    .from("zoho_recruit_connections")
    .update({ token_refresh_lock_until: lockUntil } as never)
    .eq("connection_key", "primary")
    .or(`token_refresh_lock_until.is.null,token_refresh_lock_until.lt.${now}`)
    .select("id")
    .maybeSingle();
  if (error) return true;
  return !!data;
}

export async function refreshZohoAccessToken(
  fetchImpl: typeof fetch = fetch,
): Promise<TokenBundle> {
  if (inFlightRefresh) return inFlightRefresh;

  inFlightRefresh = (async () => {
    const claimed = await claimRefreshLock();
    if (!claimed) {
      await new Promise((r) => setTimeout(r, 250));
      return loadTokenBundle();
    }

    const current = await loadTokenBundle();
    if (current.expiresAtMs - Date.now() > REFRESH_SKEW_MS) return current;

    const config = requireZohoRecruitConfig();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: current.refreshToken,
    });
    const response = await fetchImpl(`${current.accountsDomain}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw classifyZohoHttpError({
        status: response.status,
        body: payload,
        correlationId: createZohoCorrelationId(),
        rateLimit: parseZohoRateLimitHeaders(response.headers),
      });
    }
    const parsed = RefreshTokenResponse.safeParse(payload);
    if (!parsed.success) throw new Error("Zoho returned an incomplete refresh response.");

    await persistRefreshedAccessToken({
      accessToken: parsed.data.access_token,
      apiDomain: parsed.data.api_domain,
      expiresIn: parsed.data.expires_in,
      accountsDomain: current.accountsDomain,
      dataCenterLocation: current.dataCenterLocation,
    });

    return {
      ...current,
      accessToken: parsed.data.access_token,
      apiDomain: resolveZohoRecruitApiDomain({
        apiDomain: parsed.data.api_domain ?? current.apiDomain,
        location: current.dataCenterLocation,
        accountsDomain: current.accountsDomain,
      }),
      expiresAtMs: Date.now() + parsed.data.expires_in * 1000,
    };
  })().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}

async function ensureFreshToken(): Promise<TokenBundle> {
  const bundle = await loadTokenBundle();
  if (bundle.expiresAtMs - Date.now() > REFRESH_SKEW_MS) return bundle;
  return refreshZohoAccessToken();
}

function buildUrl(apiDomain: string, path: string, query?: ZohoRequestOptions["query"]): URL {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, apiDomain);
  if (!url.hostname.startsWith("recruit.") && !url.hostname.includes("zohoapis.")) {
    throw new Error("Refusing Zoho request to a non-allowlisted host.");
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function zohoRecruitRequest<T = unknown>(
  options: ZohoRequestOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<ZohoRequestResult<T>> {
  const maxAttempts = options.maxAttempts ?? 4;
  const timeoutMs = options.timeoutMs ?? 20_000;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const correlationId = createZohoCorrelationId();
    const tokens = await ensureFreshToken();
    const url = buildUrl(tokens.apiDomain, options.path, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort);

    try {
      const response = await fetchImpl(url, {
        method: options.method ?? (options.body ? "POST" : "GET"),
        headers: {
          Authorization: `Zoho-oauthtoken ${tokens.accessToken}`,
          "Content-Type": "application/json",
          "X-ZOHO-SERVICE": "shugulika-satellite",
          "X-Correlation-Id": correlationId,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        cache: "no-store",
      });
      const rateLimit = parseZohoRateLimitHeaders(response.headers);
      const payload: unknown = await response.json().catch(() => ({}));

      if (response.status === 401 && !options.skipAuthRetry && attempt === 0) {
        await refreshZohoAccessToken(fetchImpl);
        continue;
      }

      if (!response.ok) {
        const err = classifyZohoHttpError({
          status: response.status,
          body: payload,
          correlationId,
          rateLimit,
        });
        if (!err.retryable || attempt === maxAttempts - 1) throw err;
        lastError = err;
        await new Promise((r) =>
          setTimeout(
            r,
            err.rateLimit?.retryAfterSeconds
              ? err.rateLimit.retryAfterSeconds * 1000
              : zohoBackoffDelayMs(attempt),
          ),
        );
        continue;
      }

      return {
        data: payload as T,
        status: response.status,
        rateLimit,
        correlationId,
        apiDomain: tokens.apiDomain,
      };
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw error;
      await new Promise((r) => setTimeout(r, zohoBackoffDelayMs(attempt)));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Zoho Recruit request failed.");
}

/**
 * Authenticated binary download (attachments). Never logs body contents.
 * Uses the same token refresh / host allowlist as JSON requests.
 */
export async function zohoRecruitDownload(
  options: Omit<ZohoRequestOptions, "body">,
  fetchImpl: typeof fetch = fetch,
): Promise<ZohoBinaryResult> {
  const maxAttempts = options.maxAttempts ?? 4;
  const timeoutMs = options.timeoutMs ?? 30_000;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const correlationId = createZohoCorrelationId();
    const tokens = await ensureFreshToken();
    const url = buildUrl(tokens.apiDomain, options.path, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort);

    try {
      const response = await fetchImpl(url, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Zoho-oauthtoken ${tokens.accessToken}`,
          "X-ZOHO-SERVICE": "shugulika-satellite",
          "X-Correlation-Id": correlationId,
        },
        signal: controller.signal,
        cache: "no-store",
      });
      const rateLimit = parseZohoRateLimitHeaders(response.headers);

      if (response.status === 401 && !options.skipAuthRetry && attempt === 0) {
        await refreshZohoAccessToken(fetchImpl);
        continue;
      }

      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => ({}));
        const err = classifyZohoHttpError({
          status: response.status,
          body: payload,
          correlationId,
          rateLimit,
        });
        if (!err.retryable || attempt === maxAttempts - 1) throw err;
        lastError = err;
        await new Promise((r) =>
          setTimeout(
            r,
            err.rateLimit?.retryAfterSeconds
              ? err.rateLimit.retryAfterSeconds * 1000
              : zohoBackoffDelayMs(attempt),
          ),
        );
        continue;
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      return {
        bytes: buffer,
        contentType: response.headers.get("content-type"),
        contentDisposition: response.headers.get("content-disposition"),
        status: response.status,
        rateLimit,
        correlationId,
        apiDomain: tokens.apiDomain,
      };
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw error;
      await new Promise((r) => setTimeout(r, zohoBackoffDelayMs(attempt)));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Zoho Recruit download failed.");
}
