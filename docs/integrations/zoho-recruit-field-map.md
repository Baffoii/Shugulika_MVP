# Zoho Recruit field map

This document describes the default rows seeded into `zoho_recruit_field_mappings` by
`supabase/migrations/20260730122000_zoho_recruit_satellite_sync.sql`. Every row is inserted with
`enabled = false`. Unmapped fields do **not** sync. Enabling a row still requires open sync gates,
offline-case eligibility, and recorded approvals for production data.

Shugulika/Supabase remains the authoritative system for portal workflow state. Zoho Recruit is an
offline-recruitment satellite only.

## Correlation key (manual Zoho setup)

Before any candidate or job projection can succeed, create a custom unique field in Zoho Recruit:

| Zoho module | API name | Type | Unique | Purpose |
| --- | --- | --- | --- | --- |
| Candidates | `Shugulika_ID` | Text (single line) | Yes | Immutable correlation to `candidates.id` |
| Job Openings | `Shugulika_ID` | Text (single line) | Yes | Immutable correlation to local job id |

Setup notes:

1. In Zoho Recruit → Setup → Customization → Modules → Candidates / Job Openings, add the field.
2. Set the API name exactly to `Shugulika_ID` (case-sensitive for the mapper).
3. Mark the field unique. Do not use email or phone as a match key.
4. Do not map any other Zoho field as the correlation key.

## Default mapped fields

Retention defaults for every seeded row:

- `retention_behavior`: `mirror_local`
- `deletion_behavior`: `restrict_then_delete`

| Local entity | Local field | Zoho module | Zoho field | Owner (authoritative) | Direction | Purpose | Sensitivity | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| candidate | `id` | Candidates | `Shugulika_ID` | shugulika | outbound | Immutable external correlation id | internal | mirror_local / restrict_then_delete |
| candidate | `full_name` | Candidates | `Full_Name` | shugulika | outbound | Offline recruiter identification | confidential | mirror_local / restrict_then_delete |
| candidate | `email` | Candidates | `Email` | shugulika | outbound | Offline recruiter contact for approved cases only | confidential | mirror_local / restrict_then_delete |
| candidate | `phone` | Candidates | `Mobile` | shugulika | outbound | Offline recruiter contact for approved cases only | confidential | mirror_local / restrict_then_delete |
| candidate | `city` | Candidates | `City` | shugulika | outbound | Location context for offline sourcing | internal | mirror_local / restrict_then_delete |
| candidate | `country` | Candidates | `Country` | shugulika | outbound | Location context for offline sourcing | internal | mirror_local / restrict_then_delete |
| job | `id` | Job_Openings | `Shugulika_ID` | shugulika | outbound | Immutable external correlation id | internal | mirror_local / restrict_then_delete |
| job | `title` | Job_Openings | `Job_Opening_Name` | shugulika | outbound | Offline requisition title | internal | mirror_local / restrict_then_delete |
| candidate | `zoho_offline_status` | Candidates | `Candidate_Status` | zoho_recruit | inbound | Zoho-owned offline status/outcome summary only | internal | mirror_local / restrict_then_delete |

Inbound `Candidate_Status` never overwrites portal application stage, pipeline, assessment, interview,
billing, or other Shugulika workflow fields.

## Unmapped fields

Any local or Zoho field that is not listed above (or not present as an enabled row in
`zoho_recruit_field_mappings`) does **not** sync in either direction. Examples that stay local-only
unless explicitly approved and mapped later:

- resumes / documents / attachments
- assessments, interview scores, and video responses
- portal application stage and pipeline history
- billing, invoices, and commercial terms
- franchise org internals beyond approved offline-case metadata
- free-text recruiter notes not covered by an enabled mapping

Do not invent ad-hoc field projection outside this registry.

## Enabling a mapping

1. Confirm DPO/legal and product ownership for the field and direction.
2. Confirm sensitivity and retention are acceptable for the Zoho tenant and data center.
3. Ensure the Zoho custom field exists when required (`Shugulika_ID`).
4. Set `enabled = true` only through a controlled change with gates still respected.
5. Keep `zoho_recruit_production_data_enabled` false until production approval evidence is recorded.
