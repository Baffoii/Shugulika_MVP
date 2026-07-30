# Zoho Recruit satellite setup

This setup connects Zoho Recruit for HQ organization verification only. It does **not** synchronize
candidates, jobs, applications, documents, assessments, interviews, billing, or pipeline stages.
Shugulika/Supabase remains authoritative.

## 1. Create the correct Zoho client

In the [Zoho API Console](https://api-console.zoho.com/), choose:

**Server-based Applications**

Use:

| Field | Value |
| --- | --- |
| Client name | `Shugulika Zoho Recruit Satellite` |
| Homepage URL | The deployed Shugulika origin, for example `https://app.example.com` |
| Authorized redirect URI | `<Shugulika origin>/api/integrations/zoho-recruit/callback` |

For local testing, add:

`http://localhost:3000/api/integrations/zoho-recruit/callback`

The redirect URI must match `ZOHO_RECRUIT_REDIRECT_URI` exactly. Enable Multi-DC support in the
Zoho client if the connected Zoho organization may live outside the client registration data center.

Do not use:

- **Client-based Applications** — these cannot safely hold the Client Secret.
- **Mobile-based Applications** — Shugulika is not using an installed-app OAuth flow.
- **Non-browser Applications** — this is for limited-input devices.
- **Self Client** — suitable only for temporary manual tests without a redirect flow, not this
  production integration.

## 2. Store credentials on the server

After creating the client, Zoho displays a **Client ID** and **Client Secret**. Store them in the
deployment's server environment. Never commit them, paste them into chat, or prefix them with
`NEXT_PUBLIC_`.

```dotenv
ZOHO_RECRUIT_ENABLED=false
ZOHO_RECRUIT_CLIENT_ID=<Zoho Client ID>
ZOHO_RECRUIT_CLIENT_SECRET=<Zoho Client Secret>
ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY=<base64 32-byte key>
ZOHO_RECRUIT_REDIRECT_URI=https://<host>/api/integrations/zoho-recruit/callback
ZOHO_RECRUIT_ACCOUNTS_DOMAIN=https://accounts.zoho.com
```

Generate the encryption key once:

```sh
openssl rand -base64 32
```

The existing `SUPABASE_SERVICE_ROLE_KEY` must also be present on the server so the connection can
write to the server-only credential ledger. It must never reach the browser.

## 3. Apply the database migration

Apply:

`supabase/migrations/20260730105827_zoho_recruit_satellite_foundation.sql`

It creates:

- encrypted OAuth connection storage;
- local-to-Zoho mapping records;
- outbound and inbound ledgers;
- conflict and reconciliation evidence; and
- three disabled feature gates.

All six Zoho integration tables revoke access from `anon` and `authenticated`. Even an HQ user's
browser session cannot read them; the HQ page receives only sanitized status through checked server
code.

## 4. Authorize from HQ

1. Deploy once with `ZOHO_RECRUIT_ENABLED=false`.
2. Confirm the existing website behaves normally.
3. Set `ZOHO_RECRUIT_ENABLED=true` and redeploy.
4. Sign in as an HQ administrator.
5. Open `/hq/integrations`.
6. Select **Connect Zoho Recruit** and approve the Zoho consent screen.

The current implementation requests only:

`ZohoRecruit.org.all`

It verifies the organization, plan, and data-center metadata. It does not request candidate,
application, job-opening, interview, assessment, document, or billing scopes.

## 5. Safety gates

These database flags are inserted as `false` and must remain false for this release:

- `zoho_recruit_enabled`
- `zoho_recruit_data_sync_enabled`
- `zoho_recruit_production_data_enabled`

The server environment switch enables OAuth setup only. It does not change these database gates and
does not activate synchronization.

Production candidate export requires a separate implementation and review covering consent,
field-level ownership, DPO/legal approval, cross-border processing, deletion, reconciliation, and
tenant-isolation tests.

## 6. Disconnect

Use **Disconnect and revoke** on `/hq/integrations`. Shugulika asks Zoho to revoke the refresh token,
then clears both encrypted tokens locally. If Zoho revocation cannot be confirmed, the page warns
the administrator to revoke Shugulika manually under Zoho Accounts → Sessions → Connected Apps.
