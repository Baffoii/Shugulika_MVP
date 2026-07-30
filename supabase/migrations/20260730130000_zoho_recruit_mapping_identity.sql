-- Clarify mapping-table identity: Zoho portal custom fields are not required.
-- Additive only; does not enable sync gates.

update public.zoho_recruit_field_mappings
set
  enabled = false,
  notes = 'Unused at runtime. Sandbox identity uses zoho_recruit_external_mappings (local UUID ↔ Zoho record id). Do not create Zoho custom fields for Shugulika.',
  updated_at = now()
where zoho_field_api_name = 'Shugulika_ID';

update public.zoho_recruit_field_mappings
set
  notes = coalesce(notes, '') ||
    case
      when notes is null or notes = '' then 'Email is never used as a match key.'
      when notes ilike '%match key%' then ''
      else ' Email is never used as a match key.'
    end,
  updated_at = now()
where local_entity_type = 'candidate'
  and local_field = 'email';
