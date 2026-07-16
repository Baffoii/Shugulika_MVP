-- =============================================================================
-- 0000 — RESET public schema  ⚠️ DESTRUCTIVE — run ONLY on a project with no
-- data you want to keep.
--
-- WHY: this app's MVP schema (0001–0004) is a *different, app-owned* schema from
-- the reference architecture in docs/database/ (supabase/migrations_draft/).
-- If that draft (or any earlier schema) was already applied to this project, the
-- MVP migrations collide — e.g. a pre-existing `organizations` table without an
-- `org_type` column makes `create table if not exists` skip it and a later index
-- fail with: ERROR 42703: column "org_type" does not exist.
--
-- This wipes everything in the `public` schema and recreates it empty, then
-- restores the default grants Supabase expects. Auth and Storage schemas are NOT
-- touched. Run this ONCE, then run 0001, 0002, 0003, 0004 in order.
-- Do NOT run this on a project that already has real data.
-- =============================================================================

drop schema if exists public cascade;
create schema public;

-- Restore the standard Supabase grants on the fresh public schema.
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;

-- Ask PostgREST to reload its schema cache (harmless if nothing is listening).
notify pgrst, 'reload schema';
