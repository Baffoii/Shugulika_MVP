-- =============================================================================
-- Nationality, ethnicity and religion on candidate_profiles, for ATS migration
-- fidelity.
--
-- This REVERSES part of 20260809093000_work_authorization, which deliberately
-- stored no such column and cited Tanzania's Employment and Labour Relations
-- Act. That Act still applies, and the reason those fields were excluded has not
-- gone away — so the boundary moves rather than disappearing:
--
--   STORING these values (migrating what the source ATS already held, so a
--   migration can be reconciled against Zoho) is now permitted.
--
--   USING them to screen, score, rank, match, filter or report is NOT, and the
--   guardrails that enforce that are untouched:
--     * src/lib/screening/nationality-ban.test.ts — the AI screening prompt must
--       still instruct the model to ignore protected characteristics, and no
--       screening module may read one.
--     * src/lib/kpi/no-nationality.test.ts — nationality must never become a KPI
--       filter, score or rank signal.
--
--   Verified when this was written: the screening prompt is built from the job
--   title, structured requirements, screening answers and CV text only. It does
--   not read candidate_profiles columns, so these fields do not reach the model.
--
-- Anyone widening the use of these columns should treat that as a legal
-- decision, not a schema change.
-- =============================================================================

alter table public.candidate_profiles
  add column if not exists nationality text,
  add column if not exists ethnicity text,
  add column if not exists religion text;

comment on column public.candidate_profiles.nationality is
  'Migrated from the source ATS for reconciliation. Never a screening, scoring, matching, ranking or KPI signal — see nationality-ban.test.ts and no-nationality.test.ts.';
comment on column public.candidate_profiles.ethnicity is
  'Migrated from the source ATS for reconciliation. Never a screening, scoring, matching, ranking or KPI signal.';
comment on column public.candidate_profiles.religion is
  'Migrated from the source ATS for reconciliation. Never a screening, scoring, matching, ranking or KPI signal.';

notify pgrst, 'reload schema';
