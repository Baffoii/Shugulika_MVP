"use server";

import { redirect } from "next/navigation";
import { requirePortal } from "@/lib/auth";
import {
  getZohoRecruitSetupState,
  getZohoTokenEncryptionKey,
  requireZohoRecruitConfig,
} from "@/lib/integrations/zoho-recruit/config";
import { connectZohoRecruitWithGrantCode } from "@/lib/integrations/zoho-recruit/connect";
import { decryptZohoToken } from "@/lib/integrations/zoho-recruit/crypto";
import { revokeZohoRefreshToken } from "@/lib/integrations/zoho-recruit/oauth";
import {
  disconnectZohoRecruitConnection,
  getZohoRecruitConnectionView,
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

export async function connectZohoRecruitWithCodeAction(formData: FormData): Promise<void> {
  const ctx = await requirePortal("hq");
  if (!ctx.roles.includes("hq_admin")) redirect("/unauthorized");

  try {
    requireZohoRecruitConfig();
  } catch {
    redirect("/hq/integrations?zoho=configuration_required");
  }

  const connection = await getZohoRecruitConnectionView();
  if (!connection.storageReady) redirect("/hq/integrations?zoho=storage_required");
  if (connection.status === "connected") redirect("/hq/integrations?zoho=already_connected");

  const code = String(formData.get("code") ?? "").trim();
  if (!code) redirect("/hq/integrations?zoho=missing_code");

  const setup = getZohoRecruitSetupState();
  try {
    await connectZohoRecruitWithGrantCode({
      actorId: ctx.userId,
      code,
      accountsDomain: setup.initialAccountsDomain,
    });
    redirect("/hq/integrations?zoho=connected");
  } catch (error) {
    console.error(
      "[zoho-recruit/grant-code]",
      error instanceof Error ? error.message : "Unknown connection error",
    );
    redirect("/hq/integrations?zoho=connection_failed");
  }
}
