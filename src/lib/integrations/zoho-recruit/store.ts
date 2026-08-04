import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type {
  Json,
  ZohoRecruitConnectionRow,
  ZohoRecruitConnectionStatus,
} from "@/lib/database.types";

export interface ZohoRecruitConnectionView {
  storageReady: boolean;
  status: ZohoRecruitConnectionStatus;
  organizationName: string | null;
  organizationCountry: string | null;
  plan: string | null;
  dataCenterLocation: string | null;
  accountsDomain: string | null;
  apiDomain: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
}

const EMPTY_VIEW: ZohoRecruitConnectionView = {
  storageReady: false,
  status: "disconnected",
  organizationName: null,
  organizationCountry: null,
  plan: null,
  dataCenterLocation: null,
  accountsDomain: null,
  apiDomain: null,
  scopes: [],
  connectedAt: null,
  lastVerifiedAt: null,
  lastError: null,
};

function requireServiceClient() {
  const client = createServiceRoleClient();
  if (!client) throw new Error("Server credential storage is not configured.");
  return client;
}

export async function getZohoRecruitConnectionView(): Promise<ZohoRecruitConnectionView> {
  const client = createServiceRoleClient();
  if (!client) return EMPTY_VIEW;
  const { data, error } = await client
    .from("zoho_recruit_connections")
    .select("*")
    .eq("connection_key", "primary")
    .maybeSingle();
  if (error) return EMPTY_VIEW;
  if (!data) return { ...EMPTY_VIEW, storageReady: true };
  const row = data as ZohoRecruitConnectionRow;
  return {
    storageReady: true,
    status: row.status,
    organizationName: row.zoho_org_name,
    organizationCountry: row.zoho_org_country,
    plan: row.zoho_plan,
    dataCenterLocation: row.data_center_location,
    accountsDomain: row.accounts_domain,
    apiDomain: row.api_domain,
    scopes: row.granted_scopes,
    connectedAt: row.connected_at,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
  };
}

export async function saveZohoRecruitConnection(input: {
  actorId: string;
  zohoOrgId: string | null;
  zohoOrgName: string | null;
  zohoOrgCountry: string | null;
  zohoPlan: string | null;
  accountsDomain: string;
  apiDomain: string;
  dataCenterLocation: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt: string;
  grantedScopes: readonly string[];
}): Promise<void> {
  const client = requireServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("zoho_recruit_connections")
    .upsert(
      {
        connection_key: "primary",
        status: "connected",
        zoho_org_id: input.zohoOrgId,
        zoho_org_name: input.zohoOrgName,
        zoho_org_country: input.zohoOrgCountry,
        zoho_plan: input.zohoPlan,
        accounts_domain: input.accountsDomain,
        api_domain: input.apiDomain,
        data_center_location: input.dataCenterLocation,
        encrypted_access_token: input.encryptedAccessToken,
        encrypted_refresh_token: input.encryptedRefreshToken,
        access_token_expires_at: input.accessTokenExpiresAt,
        granted_scopes: [...input.grantedScopes],
        connected_by: input.actorId,
        connected_at: now,
        disconnected_at: null,
        last_verified_at: now,
        last_error: null,
      },
      { onConflict: "connection_key" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error("Secure Zoho connection storage is unavailable.");

  await Promise.all([
    client.from("integration_connections").upsert(
      {
        key: "zoho_recruit",
        name: "Zoho Recruit (offline satellite)",
        status: "connected",
        config: { mode: "satellite", data_sync_enabled: false },
        updated_at: now,
      },
      { onConflict: "key" },
    ),
    client.from("audit_logs").insert({
      actor_id: input.actorId,
      action: "integration.zoho_recruit.connected",
      entity_type: "zoho_recruit_connection",
      entity_id: (data as { id: string }).id,
      after_value: {
        status: "connected",
        organization_name: input.zohoOrgName,
        data_center_location: input.dataCenterLocation,
        scopes: [...input.grantedScopes],
        data_sync_enabled: false,
      } as Json,
      metadata: { provider: "zoho_recruit", mode: "satellite" },
    }),
  ]);
}

export async function getZohoRecruitCredentialRecord(): Promise<ZohoRecruitConnectionRow | null> {
  const client = requireServiceClient();
  const { data, error } = await client
    .from("zoho_recruit_connections")
    .select("*")
    .eq("connection_key", "primary")
    .maybeSingle();
  if (error) throw new Error("Secure Zoho connection storage is unavailable.");
  return (data as ZohoRecruitConnectionRow | null) ?? null;
}

export async function disconnectZohoRecruitConnection(input: {
  actorId: string;
  remoteRevocationSucceeded: boolean;
}): Promise<void> {
  const client = requireServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("zoho_recruit_connections")
    .update({
      status: "disconnected",
      encrypted_access_token: null,
      encrypted_refresh_token: null,
      access_token_expires_at: null,
      disconnected_at: now,
      last_error: input.remoteRevocationSucceeded
        ? null
        : "Zoho token revocation could not be confirmed; verify Connected Apps in Zoho.",
    })
    .eq("connection_key", "primary")
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Secure Zoho connection storage is unavailable.");

  await Promise.all([
    client
      .from("integration_connections")
      .update({
        status: "not_enabled",
        config: { mode: "satellite", data_sync_enabled: false },
        updated_at: now,
      })
      .eq("key", "zoho_recruit"),
    client.from("audit_logs").insert({
      actor_id: input.actorId,
      action: "integration.zoho_recruit.disconnected",
      entity_type: "zoho_recruit_connection",
      entity_id: (data as { id: string } | null)?.id ?? null,
      after_value: {
        status: "disconnected",
        remote_revocation_succeeded: input.remoteRevocationSucceeded,
      },
      metadata: { provider: "zoho_recruit", mode: "satellite" },
    }),
  ]);
}
