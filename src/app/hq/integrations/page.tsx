import type { Metadata } from "next";
import { CloudOff, KeyRound, PlugZap, ShieldCheck } from "lucide-react";
import { requirePortal } from "@/lib/auth";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
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
import { getZohoRecruitConnectionView } from "@/lib/integrations/zoho-recruit/store";
import {
  connectZohoRecruitWithCodeAction,
  disconnectZohoRecruitAction,
} from "@/app/hq/integrations/actions";

export const metadata: Metadata = { title: "Integrations" };

const STATUS_MESSAGES: Record<string, { tone: "success" | "warn" | "danger"; text: string }> = {
  connected: {
    tone: "success",
    text: "Zoho Recruit is connected for organization verification. Record synchronization remains off.",
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
};

function statusTone(status: string) {
  if (status === "connected") return "success" as const;
  if (status === "error") return "danger" as const;
  return "neutral" as const;
}

export default async function HqIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ zoho?: string }>;
}) {
  await requirePortal("hq");
  const setup = getZohoRecruitSetupState();
  const connection = await getZohoRecruitConnectionView();
  const params = await searchParams;
  const message = params.zoho ? STATUS_MESSAGES[params.zoho] : undefined;
  const placeholders = placeholdersForPortal("hq");

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
          value={connection.status === "connected" ? "Connected" : "Not connected"}
          tone={connection.status === "connected" ? "success" : "neutral"}
          hint={connection.organizationName ?? "Offline satellite only"}
        />
        <StatCard
          label="Record synchronization"
          value="Off"
          tone="success"
          hint="No candidates, jobs, or applications are exported"
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
            The connection requests organization metadata only. Candidate, job, application,
            document, assessment, billing, and pipeline scopes are not requested. Data sync has a
            separate database kill switch that remains off.
          </Alert>

          {!connection.storageReady ? (
            <Alert tone="warn">
              Apply the Zoho Recruit satellite migration and configure the server service credential
              before connecting.
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
                {connection.status === "connected" ? "Granted scope" : "Requested scope"}
              </p>
              <p className="mt-1 font-medium text-ink">
                {connection.status === "connected"
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
            {connection.status === "connected" ? (
              <form action={disconnectZohoRecruitAction}>
                <Button type="submit" variant="danger">
                  Disconnect and revoke
                </Button>
              </form>
            ) : (
              <ButtonLink
                href="/api/integrations/zoho-recruit/connect"
                variant="primary"
                prefetch={false}
                className={
                  !setup.ready || !connection.storageReady ? "pointer-events-none opacity-50" : ""
                }
              >
                Connect Zoho Recruit
              </ButtonLink>
            )}
          </div>

          {connection.status !== "connected" && setup.ready && connection.storageReady ? (
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
                ID is in your env, and set <strong className="text-ink">Authorized Redirect URI</strong>{" "}
                to exactly:
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
              Do not choose Client-based, Mobile-based, or Non-browser Applications. Self Client is
              acceptable only for a disposable manual sandbox test and is not used by this
              implementation.
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
        <Alert tone="info" title="Next controlled phase">
          <span className="inline-flex items-center gap-2">
            <CloudOff className="h-4 w-4" aria-hidden />
            Synthetic-data mapping and reconciliation can be added after the Zoho organization is
            connected. Production candidate data remains blocked.
          </span>
        </Alert>
      </div>
    </div>
  );
}
