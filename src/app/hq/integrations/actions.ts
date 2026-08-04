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
import { runZohoRecruitReconciliation } from "@/lib/integrations/zoho-recruit/reconcile";
import {
  disconnectZohoRecruitConnection,
  getZohoRecruitConnectionView,
  getZohoRecruitCredentialRecord,
} from "@/lib/integrations/zoho-recruit/store";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

async function requireHqAdmin() {
  const ctx = await requirePortal("hq");
  if (!ctx.roles.includes("hq_admin")) redirect("/unauthorized");
  return ctx;
}

export async function disconnectZohoRecruitAction(): Promise<void> {
  const ctx = await requireHqAdmin();

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
  const ctx = await requireHqAdmin();

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

export async function pauseZohoSyncAction(formData: FormData): Promise<void> {
  const ctx = await requireHqAdmin();
  const client = createServiceRoleClient();
  if (!client) redirect("/hq/integrations?zoho=storage_required");

  const reason =
    String(formData.get("reason") ?? "")
      .trim()
      .slice(0, 500) || "Paused by HQ admin";
  const now = new Date().toISOString();

  const { error } = await client
    .from("zoho_recruit_connections")
    .update({
      sync_paused_at: now,
      sync_paused_reason: reason,
    })
    .eq("connection_key", "primary");

  if (error) {
    console.error("[zoho-recruit/pause]", error.message);
    redirect("/hq/integrations?zoho=sync_pause_failed");
  }

  await client.from("audit_logs").insert({
    actor_id: ctx.userId,
    action: "integration.zoho_recruit.sync_paused",
    entity_type: "zoho_recruit_connection",
    entity_id: null,
    after_value: { sync_paused_at: now, sync_paused_reason: reason },
    metadata: { provider: "zoho_recruit" },
  });

  redirect("/hq/integrations?zoho=sync_paused");
}

export async function resumeZohoSyncAction(): Promise<void> {
  const ctx = await requireHqAdmin();
  const client = createServiceRoleClient();
  if (!client) redirect("/hq/integrations?zoho=storage_required");

  const { error } = await client
    .from("zoho_recruit_connections")
    .update({
      sync_paused_at: null,
      sync_paused_reason: null,
    })
    .eq("connection_key", "primary");

  if (error) {
    console.error("[zoho-recruit/resume]", error.message);
    redirect("/hq/integrations?zoho=sync_resume_failed");
  }

  await client.from("audit_logs").insert({
    actor_id: ctx.userId,
    action: "integration.zoho_recruit.sync_resumed",
    entity_type: "zoho_recruit_connection",
    entity_id: null,
    after_value: { sync_paused_at: null },
    metadata: { provider: "zoho_recruit" },
  });

  redirect("/hq/integrations?zoho=sync_resumed");
}

export async function retryZohoDeadLetterAction(formData: FormData): Promise<void> {
  await requireHqAdmin();
  const client = createServiceRoleClient();
  if (!client) redirect("/hq/integrations?zoho=storage_required");

  const outboxId = String(formData.get("outbox_id") ?? "").trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(outboxId)
  ) {
    redirect("/hq/integrations?zoho=dead_letter_invalid");
  }

  const { data, error } = await client
    .from("zoho_recruit_outbox")
    .update({
      status: "retry",
      available_at: new Date().toISOString(),
      claim_token: null,
      claim_expires_at: null,
      processing_started_at: null,
      last_error: null,
    })
    .eq("id", outboxId)
    .eq("status", "dead_letter")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[zoho-recruit/dead-letter-retry]", error.message);
    redirect("/hq/integrations?zoho=dead_letter_retry_failed");
  }
  if (!data) redirect("/hq/integrations?zoho=dead_letter_not_found");

  redirect("/hq/integrations?zoho=dead_letter_retried");
}

export async function runZohoDryRunReconcileAction(): Promise<void> {
  await requireHqAdmin();
  const client = createServiceRoleClient();
  if (!client) redirect("/hq/integrations?zoho=storage_required");

  const { data: connection } = await client
    .from("zoho_recruit_connections")
    .select("id")
    .eq("connection_key", "primary")
    .maybeSingle();

  if (!connection) redirect("/hq/integrations?zoho=connection_missing");

  try {
    const result = await runZohoRecruitReconciliation({
      connectionId: (connection as { id: string }).id,
      dryRun: true,
    });
    if (result.skipped) {
      redirect("/hq/integrations?zoho=reconcile_skipped");
    }
    redirect("/hq/integrations?zoho=reconcile_dry_run_ok");
  } catch (error) {
    console.error(
      "[zoho-recruit/reconcile-dry-run]",
      error instanceof Error ? error.message : "Unknown reconciliation error",
    );
    redirect("/hq/integrations?zoho=reconcile_failed");
  }
}
