import "server-only";

import {
  requireZohoRecruitConfig,
  resolveZohoRecruitApiDomain,
  type ZohoRecruitConfig,
} from "@/lib/integrations/zoho-recruit/config";
import { encryptZohoToken } from "@/lib/integrations/zoho-recruit/crypto";
import {
  exchangeZohoAuthorizationCode,
  exchangeZohoGrantCode,
  fetchZohoOrganization,
  type ZohoTokenResponse,
} from "@/lib/integrations/zoho-recruit/oauth";
import { saveZohoRecruitConnection } from "@/lib/integrations/zoho-recruit/store";

function stringValue(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  return String(value);
}

export async function persistZohoRecruitTokens(input: {
  actorId: string;
  config: ZohoRecruitConfig;
  tokens: ZohoTokenResponse;
  accountsDomain: string;
  dataCenterLocation: string | null;
}): Promise<void> {
  const apiDomain = resolveZohoRecruitApiDomain({
    apiDomain: input.tokens.api_domain,
    location: input.dataCenterLocation,
    accountsDomain: input.accountsDomain,
  });
  const organization = await fetchZohoOrganization({
    apiDomain,
    accessToken: input.tokens.access_token,
    location: input.dataCenterLocation,
    accountsDomain: input.accountsDomain,
  });
  const now = Date.now();

  await saveZohoRecruitConnection({
    actorId: input.actorId,
    zohoOrgId: stringValue(organization.zgid ?? organization.id),
    zohoOrgName: organization.company_name ?? null,
    zohoOrgCountry: organization.country_code ?? organization.country ?? null,
    zohoPlan: organization.license_details?.plan_type ?? null,
    accountsDomain: input.accountsDomain,
    apiDomain,
    dataCenterLocation: input.dataCenterLocation,
    encryptedAccessToken: encryptZohoToken(input.tokens.access_token, input.config.encryptionKey),
    encryptedRefreshToken: encryptZohoToken(input.tokens.refresh_token, input.config.encryptionKey),
    accessTokenExpiresAt: new Date(now + input.tokens.expires_in * 1000).toISOString(),
    grantedScopes: input.config.scopes,
  });
}

export async function connectZohoRecruitWithGrantCode(input: {
  actorId: string;
  code: string;
  accountsDomain?: string;
}): Promise<void> {
  const config = requireZohoRecruitConfig();
  const accountsDomain = input.accountsDomain?.trim() || config.initialAccountsDomain;
  const tokens = await exchangeZohoGrantCode({
    config,
    code: input.code.trim(),
    accountsDomain,
  });
  await persistZohoRecruitTokens({
    actorId: input.actorId,
    config,
    tokens,
    accountsDomain,
    dataCenterLocation: null,
  });
}

export async function connectZohoRecruitWithRedirectCode(input: {
  actorId: string;
  code: string;
  accountsDomain: string;
  dataCenterLocation: string | null;
}): Promise<void> {
  const config = requireZohoRecruitConfig();
  const tokens = await exchangeZohoAuthorizationCode({
    config,
    code: input.code,
    accountsDomain: input.accountsDomain,
    includeRedirectUri: true,
  });
  await persistZohoRecruitTokens({
    actorId: input.actorId,
    config,
    tokens,
    accountsDomain: input.accountsDomain,
    dataCenterLocation: input.dataCenterLocation,
  });
}
