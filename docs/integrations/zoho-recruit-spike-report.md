# Zoho Recruit spike report

Spike status for the Zoho Recruit offline-recruitment satellite. Shugulika/Supabase remains
authoritative. This report does **not** authorize production candidate export.

## Verified facts

- HQ OAuth connect / callback / disconnect flows work against a Server-based Zoho API Console client.
- Organization verification succeeds with Recruit scopes when the connection is configured.
- Recruit REST calls must use the `recruit.zoho.*` host family. OAuth often returns
  `www.zohoapis.*`; those hosts 404 for `/recruit/v2/*` and are rewritten by
  `resolveZohoRecruitApiDomain`.
- Redirect URI must match `ZOHO_RECRUIT_REDIRECT_URI` exactly; Homepage URL alone is not enough.
- Encrypted tokens are stored server-side only. HQ UI receives sanitized connection and ops views —
  no tokens, secrets, raw payloads, or env values.
- Sync feature gates are seeded `false` and are not flipped by migrations or the HQ integrations UI.
- Outbox / inbox / reconcile workers fail closed when gates disallow sync.
- Field-map defaults exist but remain disabled; unmapped fields do not sync.

## Measurements

Synthetic load and latency measurements are **TBD**. Do not treat production timing assumptions as
validated until a controlled synthetic run records:

- token refresh concurrency under parallel workers;
- outbox claim / process throughput;
- reconcile page walk cost for Candidates and Job_Openings;
- rate-limit observation shape returned by Zoho.

## Assumptions

- Zoho workflow webhooks authenticate with a shared secret
  (`ZOHO_RECRUIT_WEBHOOK_SECRET`) rather than a body HMAC.
- Replay protection relies on inbox dedupe keys / payload hashes.
- Offline cases are synthetic (`is_synthetic = true`) until an explicit production path is approved.
- `Shugulika_ID` custom unique fields will be created manually in Zoho before projection is enabled.
- Portal UX and public site routes never depend on Zoho availability.

## Manual Zoho configuration steps

1. Create a **Server-based** client in the [Zoho API Console](https://api-console.zoho.com/).
2. Set Authorized Redirect URI to
   `<origin>/api/integrations/zoho-recruit/callback`.
3. Enable Multi-DC if the org may live outside the client registration DC.
4. Store Client ID / Secret and a 32-byte base64 token encryption key in server env only.
5. Apply foundation + sync migrations.
6. Connect from `/hq/integrations` as an HQ administrator.
7. If scopes are missing after a scope expansion, disconnect and reconnect to re-consent.
8. Create unique custom fields `Shugulika_ID` on Candidates and Job Openings.

See also `docs/integrations/zoho-recruit-setup.md` and `docs/integrations/zoho-recruit-operations.md`.

## Outstanding compliance approvals

- DPO review of field map, sensitivity, retention, and deletion behavior
- Legal basis / cross-border processing for the Zoho data center in use
- Consent / restriction handling for offline cases
- Recorded production-data approval evidence before enabling
  `zoho_recruit_production_data_enabled`
- Tenant-isolation and deletion/reconciliation test sign-off

## Go / no-go

**NO-GO for production data** until DPO/legal approvals and production-approval evidence are
recorded.

Allowed now (with gates still false by default):

- OAuth organization connection verification
- HQ ops visibility (sanitized)
- Code and migration readiness for synthetic/sandbox work after controlled gate review

Not allowed:

- Enabling production candidate/job export
- Flipping `zoho_recruit_production_data_enabled` from HQ without approval metadata
- Syncing unmapped fields or treating Zoho as authoritative for portal workflow state
