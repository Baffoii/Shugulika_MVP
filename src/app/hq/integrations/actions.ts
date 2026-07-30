"use server";

import { redirect } from "next/navigation";
import { requirePortal } from "@/lib/auth";
import { getZohoTokenEncryptionKey } from "@/lib/integrations/zoho-recruit/config";
import { decryptZohoToken } from "@/lib/integrations/zoho-recruit/crypto";
import { revokeZohoRefreshToken } from "@/lib/integrations/zoho-recruit/oauth";
import {
  disconnectZohoRecruitConnection,
  getZohoRecruitCredentialRecord,
} from "@/lib/integrations/zoho-recruit/store";

export async function disconnectZohoRecruitAction(): Promise<void> {
  const ctx = await requirePortal("hq");
  if (!ctx.roles.includes("hq_admin")) redirect("/unauthorized");

  let revoked = false;
  try {
    const connection = await getZohoRecruitCredentialRecord();
    const encryptionKey = getZohoTokenEncryptionKey();
    if (connection?.encrypted_refresh_token && connection.accounts_domain && encryptionKey) {
      const refreshToken = decryptZohoToken(connection.encrypted_refresh_token, encryptionKey);
      revoked = await revokeZohoRefreshToken({
        accountsDomain: connection.accounts_domain,
        refreshToken,
      });
    }
  } catch (error) {
    console.error(
      "[zoho-recruit/disconnect]",
      error instanceof Error ? error.message : "Unknown revocation error",
    );
  }

  await disconnectZohoRecruitConnection({
    actorId: ctx.userId,
    remoteRevocationSucceeded: revoked,
  });
  redirect(`/hq/integrations?zoho=${revoked ? "disconnected" : "disconnected_unconfirmed"}`);
}
