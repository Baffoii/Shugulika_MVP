# Zoho Recruit incident runbook

Use this runbook for the Zoho Recruit offline satellite. The Shugulika portal and public site must
remain available even when Zoho is degraded. Do not paste tokens, secrets, or raw webhook payloads
into tickets or chat.

## Revoked or invalid tokens

Symptoms:

- Connection status moves to error / last verified fails
- Workers report unauthorized Zoho API responses
- HQ shows a connection error message (sanitized)

Actions:

1. Confirm whether an HQ admin disconnected intentionally.
2. In Zoho Accounts → Sessions → Connected Apps, check whether Shugulika is still listed.
3. From `/hq/integrations`, use **Disconnect and revoke** if a local connection still exists.
4. If remote revocation was unconfirmed, revoke the app manually in Zoho Connected Apps.
5. Reconnect as an HQ administrator and re-approve scopes.
6. Leave sync gates unchanged unless a separate change control already approved them.

## Rate limits

Symptoms:

- Outbox events accumulate in `queued` / `retry`
- Ops snapshot shows pending age increasing
- Sanitized `last_rate_limit` observation may update on the connection row

Actions:

1. Pause sync from HQ to stop further outbound pressure if needed.
2. Slow or temporarily disable cron hits to the outbox worker.
3. Inspect sanitized ops metrics only — do not dump payloads.
4. Resume after Zoho rate windows recover; process backlog gradually.
5. Record the incident window for later synthetic capacity planning.

## Dead letters

Symptoms:

- `deadLetterCount` > 0 on `/hq/integrations`
- Outbox rows stuck in `status = dead_letter` after max attempts

Actions:

1. Identify the outbox id from server-side tooling (service role). Do not display payloads in HQ.
2. Fix the underlying cause (mapping, eligibility, Zoho field missing, gate/pause state).
3. From HQ, submit **Retry dead letter** with that outbox UUID, or update the row to
   `status = retry` and `available_at = now()` via service role.
4. Run the outbox worker and confirm the event leaves dead-letter state.
5. If the same event dead-letters again, keep it paused and open a defect — do not loop blindly.

## Webhook replay

Symptoms:

- Duplicate Zoho workflow deliveries
- Inbox rows with matching dedupe / payload hash

Actions:

1. Confirm `ZOHO_RECRUIT_WEBHOOK_SECRET` is configured and Zoho sends it via
   `Authorization: Bearer` or `X-Shugulika-Zoho-Webhook-Secret`.
2. Rely on inbox dedupe_key / payload_hash — duplicate authentic deliveries should not double-apply.
3. To reprocess a failed inbox row, use the inbox worker after the root cause is fixed; do not
   disable authenticity checks.
4. If the webhook secret was leaked, rotate it (see below) before re-enabling Zoho workflows.

Zoho workflow webhooks do not provide body HMAC. Authenticity is the shared secret plus ledger
dedupe.

## Zoho outage

Symptoms:

- Zoho Accounts or Recruit API unavailable
- Connect / refresh / workers fail

Actions:

1. **Do nothing to the portal.** Core Shugulika flows must not call Zoho and should keep working.
2. Pause sync if workers are noisy or creating avoidable dead letters.
3. Communicate that offline satellite projection is deferred; portal hiring continues.
4. When Zoho recovers, resume sync (if gates allow), drain outbox/inbox, then consider a dry-run
   reconcile from HQ.

## Secret rotation

Rotate one secret at a time; never commit values.

| Secret | Steps |
| --- | --- |
| `ZOHO_RECRUIT_CLIENT_SECRET` | Regenerate in Zoho API Console → update server env → redeploy → reconnect if required |
| `ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY` | Requires a controlled re-encrypt or reconnect plan; do not rotate casually in production |
| `ZOHO_RECRUIT_WORKER_SECRET` / `CRON_SECRET` | Update env → redeploy → update cron callers’ Bearer token |
| `ZOHO_RECRUIT_WEBHOOK_SECRET` | Update env → redeploy → update Zoho workflow webhook headers |

After rotation, verify:

- HQ connect/disconnect still works (OAuth secrets)
- Worker routes return 401 with the old bearer and 200/skipped with the new one
- Webhook route rejects requests with the old secret

## Escalation checklist

- Keep production-data gate off unless approval evidence already exists
- Prefer pause over enabling ad-hoc bypasses
- Preserve audit logs; avoid deleting ledger rows during an active incident
- Capture sanitized metrics (counts, ages, gate flags) for the post-incident note
