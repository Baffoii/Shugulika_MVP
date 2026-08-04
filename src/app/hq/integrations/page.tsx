import type { Metadata } from "next";
import { CloudOff, KeyRound, PauseCircle, PlugZap, ShieldCheck } from "lucide-react";
import { requirePortal } from "@/lib/auth";
import {
  Alert,
  Badge,
  Button,
  buttonClass,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  PageHeader,
  StatCard,
} from "@/components/ui/primitives";
import { PlaceholderCard } from "@/components/PlaceholderCard";
import { placeholdersForPortal } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { getZohoRecruitSetupState } from "@/lib/integrations/zoho-recruit/config";
import type { ZohoRecruitGateKey } from "@/lib/integrations/zoho-recruit/gates";
import { getZohoRecruitOpsSnapshot } from "@/lib/integrations/zoho-recruit/ops";
import { getZohoSandboxReadiness } from "@/lib/integrations/zoho-recruit/readiness";
import { getZohoRecruitConnectionView } from "@/lib/integrations/zoho-recruit/store";
import {
  connectZohoRecruitWithCodeAction,
  disconnectZohoRecruitAction,
  pauseZohoSyncAction,
  resumeZohoSyncAction,
  retryZohoDeadLetterAction,
  runZohoDryRunReconcileAction,
  syncZohoCandidatesAction,
} from "@/app/hq/integrations/actions";
import { probeZohoCandidateAccess } from "@/lib/integrations/zoho-recruit/candidate-probe";

export const metadata: Metadata = { title: "Integrations" };

const STATUS_MESSAGES: Record<string, { tone: "success" | "warn" | "danger"; text: string }> = {
  connected: {
    tone: "success",
    text: "Zoho Recruit is connected. No Zoho portal customization is required; sync stays gated.",
  },
  disconnected: { tone: "success", text: "Zoho Recruit access was revoked and disconnected." },
  disconnected_unconfirmed: {
    tone: "warn",
    text: "The local connection was removed, but remote revocation was not confirmed. Revoke Shugulika under Zoho Connected Apps.",
  },
  configuration_required: {
    tone: "warn",
    text: "Complete the server configuration before connecting Zoho Recruit.",
  },
  storage_required: {
    tone: "warn",
    text: "Apply the Zoho Recruit database migration before starting authorization.",
  },
  already_connected: {
    tone: "warn",
    text: "Zoho Recruit is already connected. Disconnect it before authorizing a different organization.",
  },
  authorization_denied: { tone: "warn", text: "Zoho authorization was cancelled." },
  invalid_state: {
    tone: "danger",
    text: "The Zoho response failed its security-state check. Start the connection again.",
  },
  missing_code: { tone: "danger", text: "Zoho did not return an authorization code." },
  connection_failed: {
    tone: "danger",
    text: "Zoho connection verification failed. No existing Shugulika data was changed.",
  },
  sync_paused: { tone: "success", text: "Zoho synchronization is paused." },
  sync_pause_failed: { tone: "danger", text: "Could not pause Zoho synchronization." },
  sync_resumed: { tone: "success", text: "Zoho synchronization pause was cleared." },
  sync_resume_failed: { tone: "danger", text: "Could not resume Zoho synchronization." },
  dead_letter_retried: {
    tone: "success",
    text: "Dead-letter outbox event was returned to retry.",
  },
  dead_letter_retry_failed: { tone: "danger", text: "Could not retry the dead-letter event." },
  dead_letter_not_found: {
    tone: "warn",
    text: "No dead-letter outbox event matched that id.",
  },
  dead_letter_invalid: { tone: "warn", text: "Provide a valid outbox event id." },
  reconcile_dry_run_ok: {
    tone: "success",
    text: "Dry-run reconciliation completed. No automatic repairs were applied.",
  },
  reconcile_skipped: {
    tone: "warn",
    text: "Dry-run reconciliation was skipped because sync gates are not open.",
  },
  reconcile_failed: { tone: "danger", text: "Dry-run reconciliation failed." },
  connection_missing: {
    tone: "warn",
    text: "No primary Zoho Recruit connection row is available.",
  },
  candidate_sync_ok: {
    tone: "success",
    text: "Zoho candidate search cache sync completed.",
  },
  candidate_sync_skipped: {
    tone: "warn",
    text: "Candidate sync was skipped (gates, connection, scopes, or another run in progress).",
  },
  candidate_sync_failed: {
    tone: "danger",
    text: "Candidate sync failed. Check server logs for a non-sensitive error summary.",
  },
};

const GATE_LABELS: Record<ZohoRecruitGateKey, string> = {
  zoho_recruit_enabled: "Master runtime gate",
  zoho_recruit_data_sync_enabled: "Data sync kill switch",
  zoho_recruit_production_data_enabled: "Production data export",
  zoho_recruit_sandbox_sync_enabled: "Sandbox / synthetic sync",
};

function statusTone(status: string) {
  if (status === "connected") return "success" as const;
  if (status === "error") return "danger" as const;
  return "neutral" as const;
}

function formatAgeSeconds(seconds: number | null): string {
  if (seconds == null) return "None";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export default async function HqIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ zoho?: string }>;
}) {
  await requirePortal("hq");
  const setup = getZohoRecruitSetupState();
  const [connection, ops, readiness, candidateAccess] = await Promise.all([
    getZohoRecruitConnectionView(),
    getZohoRecruitOpsSnapshot(),
    getZohoSandboxReadiness(),
    probeZohoCandidateAccess(),
  ]);
  const params = await searchParams;
  const message = params.zoho ? STATUS_MESSAGES[params.zoho] : undefined;
  const placeholders = placeholdersForPortal("hq");
  const isConnected = connection.status === "connected";
  const needsReconnectForScopes = isConnected && ops.scopesMissing.length > 0;
  const syncPaused = Boolean(ops.syncPausedAt);

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="External services are isolated from the core Shugulika workflow. Zoho Recruit is an offline-recruitment satellite; Shugulika remains authoritative."
      />

      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Zoho connection"
          value={isConnected ? "Connected" : "Not connected"}
          tone={isConnected ? "success" : "neutral"}
          hint={connection.organizationName ?? "Offline satellite only"}
        />
        <StatCard
          label="Record synchronization"
          value={ops.gates.syncAllowed ? "Gated open" : "Off"}
          tone={ops.gates.syncAllowed ? "warn" : "success"}
          hint={
            ops.gates.productionExportAllowed
              ? "Production export gate is open"
              : "No candidates, jobs, or applications are exported"
          }
        />
        <StatCard
          label="Website dependency"
          value="None"
          tone="success"
          hint="Existing Shugulika flows do not call Zoho"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <PlugZap className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <CardTitle>Zoho Recruit — offline satellite</CardTitle>
              <p className="mt-0.5 text-xs text-ink-subtle">
                HQ-only OAuth connection and organization verification
              </p>
            </div>
          </div>
          <Badge tone={statusTone(connection.status)}>{connection.status.replace("_", " ")}</Badge>
        </CardHeader>
        <CardBody className="space-y-5">
          <Alert tone="success" title="Safe by default">
            No Zoho Recruit portal customization is required. Sync gates stay off until separate
            approvals land. Production candidate export cannot be flipped from this page. Tokens and
            secrets never appear in the HQ UI.
          </Alert>

          <Alert
            tone={readiness.readyForSandboxExperiments ? "success" : "neutral"}
            title="Sandbox operating mode"
          >
            <p className="mb-2">
              Identity uses <code>zoho_recruit_external_mappings</code> only (Shugulika UUID ↔ Zoho
              record id). Prefer a sandbox Zoho org so day-to-day Recruit is untouched.
            </p>
            <ul className="list-disc space-y-1 pl-4 text-sm">
              {readiness.checks.map((check) => (
                <li key={check.id}>
                  <span className="font-medium text-ink">{check.ok ? "OK" : "Check"}:</span>{" "}
                  {check.detail}
                </li>
              ))}
            </ul>
          </Alert>

          {!connection.storageReady ? (
            <Alert tone="warn">
              Apply the Zoho Recruit satellite migration and configure the server service credential
              before connecting.
            </Alert>
          ) : null}

          {needsReconnectForScopes ? (
            <Alert tone="warn" title="Reconnect to approve additional permissions">
              The connection is missing scopes required for satellite sync:{" "}
              <code className="text-xs">{ops.scopesMissing.join(", ")}</code>. Disconnect, then
              connect again so Zoho can show the updated consent screen. The Connect button stays
              disabled while a connection already exists.
            </Alert>
          ) : null}

          <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle">Organization</p>
              <p className="mt-1 font-medium text-ink">
                {connection.organizationName ?? "Not verified"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle">Data center</p>
              <p className="mt-1 font-medium text-ink">
                {connection.dataCenterLocation?.toUpperCase() ?? "Not known"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle">Plan</p>
              <p className="mt-1 font-medium text-ink">{connection.plan ?? "Not verified"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle">
                {isConnected ? "Granted scope" : "Requested scope"}
              </p>
              <p className="mt-1 font-medium text-ink">
                {isConnected
                  ? connection.scopes.join(", ") || "None recorded"
                  : setup.scopes.join(", ")}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle">Last verified</p>
              <p className="mt-1 font-medium text-ink">
                {connection.lastVerifiedAt ? formatDateTime(connection.lastVerifiedAt) : "Never"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-ink-subtle">Access</p>
              <p className="mt-1 font-medium text-ink">HQ administrators only</p>
            </div>
          </div>

          {connection.lastError ? <Alert tone="warn">{connection.lastError}</Alert> : null}

          <div className="flex flex-wrap gap-2">
            {isConnected ? (
              <form action={disconnectZohoRecruitAction}>
                <Button type="submit" variant="danger">
                  Disconnect and revoke
                </Button>
              </form>
            ) : (
              // Plain <a>: this hits an API route that 307s to Zoho. Next.js Link
              // tries an RSC fetch first and surfaces a noisy "Failed to fetch".
              <a
                href="/api/integrations/zoho-recruit/connect"
                className={buttonClass(
                  "primary",
                  "md",
                  !setup.ready || !connection.storageReady
                    ? "pointer-events-none opacity-50"
                    : undefined,
                )}
              >
                Connect Zoho Recruit
              </a>
            )}
          </div>

          {!isConnected && setup.ready && connection.storageReady ? (
            <div className="space-y-3 rounded-lg border border-surface-border bg-surface-muted/40 p-4">
              <Alert tone="warn" title="If Zoho shows “Invalid Redirect Uri”">
                Open the{" "}
                <a
                  className="font-medium text-ink underline"
                  href="https://api-console.zoho.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Zoho API Console
                </a>
                , select the <strong className="text-ink">Server-based</strong> client whose Client
                ID is in your env, and set{" "}
                <strong className="text-ink">Authorized Redirect URI</strong> to exactly:
                <code className="mt-2 block break-all rounded bg-white px-2 py-1 text-xs text-ink">
                  {setup.redirectUri}
                </code>
                Then click Update and use Connect again. Homepage URL alone is not enough.
              </Alert>
              <form action={connectZohoRecruitWithCodeAction} className="space-y-2">
                <p className="text-sm text-ink-muted">
                  Or paste a one-time grant code from Zoho API Console → Self Client → Generate Code
                  (scope <code>{setup.scopes.join(",")}</code>):
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    name="code"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="1000.…"
                    className="min-w-0 flex-1 rounded-md border border-surface-border bg-white px-3 py-2 font-mono text-sm text-ink"
                  />
                  <Button type="submit" variant="secondary">
                    Connect with code
                  </Button>
                </div>
              </form>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Synchronization gates</CardTitle>
            <Badge tone={ops.gates.syncAllowed ? "warn" : "success"}>
              {ops.gates.syncAllowed ? "sync allowed" : "blocked"}
            </Badge>
          </CardHeader>
          <CardBody className="space-y-4 text-sm">
            <p className="text-ink-muted">
              Informational only. Production-data and other gates cannot be flipped here without
              recorded approval metadata.
            </p>
            <ul className="space-y-2">
              {(Object.keys(GATE_LABELS) as ZohoRecruitGateKey[]).map((key) => {
                const enabled = ops.gates.flags[key] === true;
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-md border border-surface-border px-3 py-2"
                  >
                    <div>
                      <p className="font-medium text-ink">{GATE_LABELS[key]}</p>
                      <p className="text-xs text-ink-subtle">{key}</p>
                    </div>
                    <Badge tone={enabled ? "warn" : "neutral"}>
                      {enabled ? "enabled" : "disabled"}
                    </Badge>
                  </li>
                );
              })}
            </ul>
            {ops.gates.blockedReasons.length > 0 ? (
              <Alert tone="neutral" title="Why sync is blocked">
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {ops.gates.blockedReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <Alert tone="warn" title="Sync gates are open">
                Workers may process satellite work when connection and pause state also allow it.
              </Alert>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Operations metrics</CardTitle>
            <PauseCircle className="h-5 w-5 text-ink-subtle" aria-hidden />
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-subtle">Pending outbox</p>
                <p className="mt-1 font-medium text-ink">{ops.pendingOutboxCount}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-subtle">
                  Oldest pending age
                </p>
                <p className="mt-1 font-medium text-ink">
                  {formatAgeSeconds(ops.oldestPendingAgeSeconds)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-subtle">Dead letters</p>
                <p className="mt-1 font-medium text-ink">{ops.deadLetterCount}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-subtle">Open conflicts</p>
                <p className="mt-1 font-medium text-ink">{ops.openConflictCount}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-subtle">Sync paused</p>
                <p className="mt-1 font-medium text-ink">
                  {syncPaused
                    ? `Yes${ops.syncPausedReason ? ` — ${ops.syncPausedReason}` : ""}`
                    : "No"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-subtle">Missing scopes</p>
                <p className="mt-1 font-medium text-ink">
                  {ops.scopesMissing.length > 0 ? ops.scopesMissing.length : "None"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-ink-subtle">
                  Last reconciliation
                </p>
                <p className="mt-1 font-medium text-ink">
                  {ops.lastReconciliation
                    ? `${ops.lastReconciliation.status} · checked ${ops.lastReconciliation.recordsChecked} · diffs ${ops.lastReconciliation.differencesFound} · ${formatDateTime(ops.lastReconciliation.startedAt)}`
                    : "Never"}
                </p>
              </div>
            </div>

            <Alert
              tone={candidateAccess.ready ? "success" : "warn"}
              title="Inbound candidate search cache"
            >
              <p className="mb-2 text-sm">
                Experimental: pull Zoho Candidates into a local searchable cache for Employer Find
                candidates. Requires OAuth connect, candidate READ scopes, and open sync gates.
              </p>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {candidateAccess.checks.map((check) => (
                  <li key={check.id}>
                    <span className="font-medium text-ink">{check.ok ? "OK" : "Check"}:</span>{" "}
                    {check.detail}
                  </li>
                ))}
              </ul>
            </Alert>

            <div className="flex flex-wrap gap-2 border-t border-surface-border pt-4">
              {syncPaused ? (
                <form action={resumeZohoSyncAction}>
                  <Button type="submit" variant="secondary">
                    Resume sync
                  </Button>
                </form>
              ) : (
                <form action={pauseZohoSyncAction} className="flex flex-wrap items-center gap-2">
                  <input
                    name="reason"
                    placeholder="Pause reason"
                    autoComplete="off"
                    className="rounded-md border border-surface-border bg-white px-3 py-2 text-sm text-ink"
                  />
                  <Button type="submit" variant="secondary">
                    Pause sync
                  </Button>
                </form>
              )}
              <form action={runZohoDryRunReconcileAction}>
                <Button type="submit" variant="secondary">
                  Run dry-run reconcile
                </Button>
              </form>
              <form action={syncZohoCandidatesAction}>
                <Button type="submit" variant="primary" disabled={!candidateAccess.ready}>
                  Sync candidates from Zoho
                </Button>
              </form>
            </div>

            <form
              action={retryZohoDeadLetterAction}
              className="space-y-2 border-t border-surface-border pt-4"
            >
              <p className="text-xs text-ink-muted">
                Retry one dead-letter outbox event by id. Payload contents are never shown here.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  name="outbox_id"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Outbox event UUID"
                  className="min-w-0 flex-1 rounded-md border border-surface-border bg-white px-3 py-2 font-mono text-sm text-ink"
                />
                <Button type="submit" variant="secondary" disabled={ops.deadLetterCount === 0}>
                  Retry dead letter
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Zoho API Console setup</CardTitle>
            <KeyRound className="h-5 w-5 text-brand-600" aria-hidden />
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-ink-muted">
            <p>
              Choose <strong className="text-ink">Server-based Applications</strong>. Shugulika has
              a dedicated HTTP server and must keep the client secret confidential.
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Client name: <code>Shugulika Zoho Recruit Satellite</code>
              </li>
              <li>
                Homepage URL: <code>{new URL(setup.redirectUri).origin}</code>
              </li>
              <li>
                Authorized redirect URI: <code>{setup.redirectUri}</code>
              </li>
              <li>Enable Multi-DC support if the Zoho organization is outside the client DC.</li>
            </ol>
            <p className="text-xs text-ink-subtle">
              API Console only — do not change Zoho Recruit Modules/Fields for Shugulika. Self
              Client is acceptable only for a disposable manual sandbox test.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Server configuration</CardTitle>
            <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden />
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-ink-muted">
            <p>Add the Client ID and Client Secret to server environment variables only:</p>
            <ul className="space-y-1 font-mono text-xs text-ink">
              <li>ZOHO_RECRUIT_ENABLED=true</li>
              <li>ZOHO_RECRUIT_CLIENT_ID=…</li>
              <li>ZOHO_RECRUIT_CLIENT_SECRET=…</li>
              <li>ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY=…</li>
              <li>ZOHO_RECRUIT_REDIRECT_URI={setup.redirectUri}</li>
            </ul>
            {setup.missing.length > 0 ? (
              <Alert tone="warn" title="Still required">
                {setup.missing.join(", ")}
              </Alert>
            ) : !setup.enabled ? (
              <Alert tone="neutral">Set ZOHO_RECRUIT_ENABLED=true when setup is ready.</Alert>
            ) : (
              <Alert tone="success">Server configuration is ready for authorization.</Alert>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6">
        <Alert tone="neutral" title="Other integrations remain placeholders">
          These modules are unchanged and still produce no external actions.
        </Alert>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {placeholders.map((feature) => (
            <PlaceholderCard key={feature.key} feature={feature} />
          ))}
        </div>
      </div>

      <div className="mt-6">
        <Alert tone="info" title="Sandbox path">
          <span className="inline-flex items-center gap-2">
            <CloudOff className="h-4 w-4" aria-hidden />
            Connect a sandbox Zoho org, keep production-data gated off, and use mapping-table
            identity only. Day-to-day Zoho Recruit UI stays unchanged. Production exports stay
            blocked until real DPO/legal approval is recorded.
          </span>
        </Alert>
      </div>
    </div>
  );
}
