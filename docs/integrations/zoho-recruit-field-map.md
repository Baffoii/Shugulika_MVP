# Zoho Recruit field map

Default rows in `zoho_recruit_field_mappings` are seeded **disabled**. Unmapped fields do not sync.
Enabling a row still requires open sync gates, offline-case eligibility, and (for real people)
recorded production approvals.

Shugulika/Supabase remains authoritative. Zoho Recruit is an offline satellite only.

## Identity (no Zoho portal customization required)

**Sandbox / current rule:** do **not** create custom fields in Zoho Recruit.

Correlation is stored only in Shugulika:

| Store | Key |
| --- | --- |
| `zoho_recruit_external_mappings` | `local_entity_id` (Shugulika UUID) ↔ `zoho_record_id` (Zoho’s own id) |

Outbound worker behavior:

1. If a mapping exists → **update** that Zoho record by id.
2. If not → **create** in Zoho, then save the returned Zoho id in the mapping table.
3. Never match on email, phone, or name.

Optional later hardening (not required): a Zoho custom unique `Shugulika_ID` field. That is a Zoho
UI change and is **out of scope** while operating against an untouched Recruit portal / sandbox.

## Default mapped fields

Retention defaults:

- `retention_behavior`: `mirror_local`
- `deletion_behavior`: `restrict_then_delete`

| Local entity | Local field | Zoho module | Zoho field | Owner | Direction | Purpose | Sensitivity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| candidate | `id` | Candidates | *(mapping table only)* | shugulika | outbound | Correlation via `zoho_recruit_external_mappings` | internal |
| candidate | `full_name` | Candidates | `Full_Name` | shugulika | outbound | Offline recruiter identification | confidential |
| candidate | `email` | Candidates | `Email` | shugulika | outbound | Offline contact for approved cases only — **not** a match key | confidential |
| candidate | `phone` | Candidates | `Mobile` | shugulika | outbound | Offline contact for approved cases only | confidential |
| candidate | `city` | Candidates | `City` | shugulika | outbound | Location context | internal |
| candidate | `country` | Candidates | `Country` | shugulika | outbound | Location context | internal |
| job | `id` | Job_Openings | *(mapping table only)* | shugulika | outbound | Correlation via mapping table | internal |
| job | `title` | Job_Openings | `Job_Opening_Name` | shugulika | outbound | Offline requisition title | internal |
| candidate | `zoho_offline_status` | Candidates | `Candidate_Status` | zoho_recruit | inbound | Zoho-owned offline status summary only | internal |

Inbound `Candidate_Status` never overwrites portal application stage, pipeline, assessments,
interviews, billing, or other Shugulika workflow fields.

Seeded DB rows that still mention `Shugulika_ID` remain **disabled** legacy placeholders; the
runtime path ignores them.

## Unmapped fields

Anything not enabled in `zoho_recruit_field_mappings` does not sync, including resumes, media,
assessments, interviews, billing, and portal pipeline state.

## Employer search cache — discovery consent fields

The inbound candidate-search worker (`candidate-sync`) uses runtime field discovery
(`candidate-field-map.ts`) and **fail-closed** eligibility
(`candidate-eligibility.ts`). Candidates without affirmative portal-discovery
evidence are skipped / inactivated and never enter employer Find Candidates.

Required for production discovery (not seeded as outbound field-map rows; configure
in the Zoho org only after legal/DPO approval):

| Internal key | Preferred Zoho API names | Affirmative examples |
| --- | --- | --- |
| `portalEligible` | `Portal_Eligible`, `Portal_Eligible__s` | true / eligible / granted |
| `consentStatus` | `Consent_Status`, `Consent_Status__s` | Granted / opt-in |
| `profileVisibility` | `Profile_Visibility`, `Profile_Visibility__s` | Public / searchable |

Missing mappings, blank values, withdrawn consent, private/restricted visibility,
converted records, and disallowed statuses all make a candidate ineligible.
See `docs/integrations/zoho-recruit-setup.md` §7.

## Enabling a mapping

1. Prefer a **sandbox Zoho org** (separate Client ID / connection) for experiments.
2. Keep production Recruit day-to-day org free of Shugulika writes until gates + approvals say otherwise.
3. Confirm ownership, sensitivity, and retention.
4. Set `enabled = true` only through a controlled change with gates still respected.
5. Keep `zoho_recruit_production_data_enabled` false until real DPO/legal approval is recorded.
