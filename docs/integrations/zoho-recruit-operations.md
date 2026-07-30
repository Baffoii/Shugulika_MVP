# Zoho Recruit operations

Operational guide for the Zoho Recruit offline satellite. Shugulika remains authoritative; Zoho is
optional and isolated from core portal flows.

## Environment variables

Server-only. Never prefix with `NEXT_PUBLIC_` or render values in the HQ UI.

| Variable | Purpose |
| --- | --- |
| `ZOHO_RECRUIT_ENABLED` | Allows OAuth setup / connect when `true`. Does **not** open database sync gates. |
| `ZOHO_RECRUIT_CLIENT_ID` | Zoho Server-based client id |
| `ZOHO_RECRUIT_CLIENT_SECRET` | Zoho client secret |
| `ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte key for token encryption at rest |
| `ZOHO_RECRUIT_REDIRECT_URI` | Exact callback URI, e.g. `https://<host>/api/integrations/zoho-recruit/callback` |
| `ZOHO_RECRUIT_ACCOUNTS_DOMAIN` | Optional Accounts origin (default `https://accounts.zoho.com`) |
| `ZOHO_RECRUIT_WORKER_SECRET` | Bearer secret for worker/cron routes (preferred) |
| `CRON_SECRET` | Fallback worker bearer secret if `ZOHO_RECRUIT_WORKER_SECRET` is unset |
| `ZOHO_RECRUIT_WEBHOOK_SECRET` | Shared secret for Zoho workflow webhooks |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for connection ledger and worker access |

Generate the encryption key once:

```sh
openssl rand -base64 32
```

## Worker routes and suggested cron

All worker routes require `Authorization: Bearer <ZOHO_RECRUIT_WORKER_SECRET|CRON_SECRET>` and are
no-ops (HTTP 200 skipped) when sync gates disallow work.

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/api/integrations/zoho-recruit/workers/outbox` | Claim and process outbound events |
| `POST` | `/api/integrations/zoho-recruit/workers/inbox` | Claim and process inbound webhook ledger rows |
| `POST` | `/api/integrations/zoho-recruit/workers/reconcile` | Walk Zoho modules vs local mappings |
| `POST` | `/api/integrations/zoho-recruit/webhook` | Accept authenticated Zoho workflow webhooks |

Reconcile dry-run query flags: `?dry_run=1` or `?dry_run=true`.

Suggested cadence (adjust after synthetic measurements):

| Job | Cadence |
| --- | --- |
| Outbox worker | every 1–5 minutes |
| Inbox worker | every 1–5 minutes |
| Reconcile dry-run | daily (or on demand from HQ) |
| Reconcile non-dry | only after gates + approvals allow |

OAuth routes (HQ session, not worker secret):

- `GET /api/integrations/zoho-recruit/connect`
- `GET /api/integrations/zoho-recruit/callback`

## Gate meanings

Database flags in `feature_flags` (all seeded false):

| Key | Meaning |
| --- | --- |
| `zoho_recruit_enabled` | Master runtime gate for Zoho Recruit synchronization |
| `zoho_recruit_data_sync_enabled` | Kill switch for any record synchronization |
| `zoho_recruit_sandbox_sync_enabled` | Allows synthetic/sandbox offline-case projection when data sync is also on |
| `zoho_recruit_production_data_enabled` | Allows production candidate/job export; requires DPO/legal approval evidence |

`syncAllowed` requires master + data-sync. Production export additionally requires the production-data
gate. Sandbox export additionally requires the sandbox gate. Do not enable gates from the HQ
integrations page; that UI is informational only for gate state.

## Pause and resume

HQ administrators can set `sync_paused_at` / `sync_paused_reason` on the primary
`zoho_recruit_connections` row from `/hq/integrations` (Pause sync / Resume sync). Pausing is an
operational brake; it does not replace database gates and does not revoke OAuth tokens.

## Reconnect for scopes

When `scopesMissing` is non-empty on a connected org, HQ shows: **Reconnect to approve additional
permissions**. Disconnect and revoke, then Connect again so Zoho presents the updated consent
screen. Connect remains unavailable while a connection already exists.

## Apply migrations

Apply in order:

1. `supabase/migrations/20260730105827_zoho_recruit_satellite_foundation.sql`
2. `supabase/migrations/20260730122000_zoho_recruit_satellite_sync.sql`

Example:

```sh
supabase db push
```

Or apply with your project's approved migration process. Confirm tables remain revoked from `anon`
and `authenticated`; only `service_role` may read the credential and sync ledgers.

## HQ safe actions

On `/hq/integrations` (hq_admin only):

- Pause / resume sync
- Retry one dead-letter outbox id (status → `retry`, `available_at = now`)
- Run dry-run reconciliation

Never expect tokens, secrets, raw payloads, or env values in that UI.
