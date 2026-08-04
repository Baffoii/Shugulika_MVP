# Zoho Recruit satellite setup

Connect Zoho Recruit as an offline satellite. Shugulika/Supabase remains authoritative.

**Hard rule for the current phase:** do **not** change the Zoho Recruit portal (no custom modules,
fields, layouts, or workflows). Use a **sandbox Zoho organization** and API Console OAuth only.
Identity is stored in Shugulika (`zoho_recruit_external_mappings`).

## 1. Create the OAuth client (API Console only)

In the [Zoho API Console](https://api-console.zoho.com/), choose **Server-based Applications**:

| Field | Value |
| --- | --- |
| Client name | `Shugulika Zoho Recruit Satellite` |
| Homepage URL | Your Shugulika origin (e.g. `http://localhost:3000`) |
| Authorized redirect URI | `<origin>/api/integrations/zoho-recruit/callback` |

Local example redirect:

`http://localhost:3000/api/integrations/zoho-recruit/callback`

Prefer registering this client against a **sandbox** Zoho Recruit org so live recruiter work is
untouched. Enable Multi-DC if needed.

Do not use Client-based, Mobile-based, or Non-browser app types for this integration.

## 2. Server environment

```dotenv
ZOHO_RECRUIT_ENABLED=false
ZOHO_RECRUIT_CLIENT_ID=<Zoho Client ID>
ZOHO_RECRUIT_CLIENT_SECRET=<Zoho Client Secret>
ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY=<base64 32-byte key>
ZOHO_RECRUIT_REDIRECT_URI=http://localhost:3000/api/integrations/zoho-recruit/callback
ZOHO_RECRUIT_ACCOUNTS_DOMAIN=https://accounts.zoho.com
# Optional workers / webhooks
# ZOHO_RECRUIT_WORKER_SECRET=
# ZOHO_RECRUIT_WEBHOOK_SECRET=
```

Also require `SUPABASE_SERVICE_ROLE_KEY` on the server. Never use `NEXT_PUBLIC_` for Zoho secrets.

## 3. Migrations

Apply in order:

1. `20260730105827_zoho_recruit_satellite_foundation.sql`
2. `20260730122000_zoho_recruit_satellite_sync.sql`
3. `20260730130000_zoho_recruit_mapping_identity.sql` (clarifies mapping-only identity)

## 4. Authorize from HQ

1. Keep DB sync gates **false**.
2. Set `ZOHO_RECRUIT_ENABLED=true` and restart.
3. HQ admin → `/hq/integrations` → **Connect Zoho Recruit**.
4. Approve scopes (`ZohoRecruit.org.all`, `ZohoRecruit.settings.ALL`, `ZohoRecruit.modules.ALL`).
   Prefer these group scopes — per-module scope names are inconsistently accepted by Zoho Accounts.
5. If scopes are missing later: Disconnect → Connect again (does not log out Zoho users).

OAuth alone does **not** export or import candidates. For employer Find candidates sync, also enable
DB gates `zoho_recruit_enabled`, `zoho_recruit_data_sync_enabled`, and either
`zoho_recruit_production_data_enabled` or `zoho_recruit_sandbox_sync_enabled`, then run
**Sync candidates from Zoho** on this page.

## 5. How identity works (no Zoho UI fields)

| Step | Behavior |
| --- | --- |
| First export | Create Zoho record with standard fields only → store Zoho id in `zoho_recruit_external_mappings` |
| Later export | Update that Zoho id from the mapping table |
| Match key | Never email/phone/name |

## 6. Gates (remain false by default)

- `zoho_recruit_enabled`
- `zoho_recruit_data_sync_enabled`
- `zoho_recruit_sandbox_sync_enabled` — synthetic/sandbox cases only
- `zoho_recruit_production_data_enabled` — requires real DPO/legal evidence; leave off

## 7. Disconnect

**Disconnect and revoke** on `/hq/integrations` clears Shugulika’s tokens only. Zoho Recruit users
stay signed in.
