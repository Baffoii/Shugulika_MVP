-- =============================================================================
-- Shugulika Africa — DRAFT schema (Supabase/PostgreSQL). DO NOT APPLY AUTOMATICALLY.
-- File 00: extensions, schemas, shared trigger functions, helper skeletons.
-- Concrete apply order: 00,01,02,03,04,05(consent before submissions),06,07,08,
--   09(functions),10(views),11(rls),12(storage),13(seed). See docs/database/13.
-- =============================================================================

-- ---- Extensions ------------------------------------------------------------
create extension if not exists pgcrypto;    -- gen_random_uuid(), digest()
create extension if not exists citext;      -- case-insensitive email/slug
create extension if not exists pg_trgm;     -- fuzzy name/skill/title search
create extension if not exists unaccent;    -- accent-insensitive FTS
create extension if not exists btree_gin;   -- mixed btree+gin composite indexes
-- create extension if not exists vector;   -- RESERVED: enable only for AI matching (OD-8/R-140)

-- ---- Schemas ---------------------------------------------------------------
create schema if not exists private;  -- RLS helper functions; NOT exposed to PostgREST
create schema if not exists audit;    -- append-only audit log; NOT exposed to PostgREST

comment on schema private is 'SECURITY DEFINER RLS helpers; not exposed via API.';
comment on schema audit is 'Append-only audit trail; no UPDATE/DELETE grants.';

-- ---- Shared: updated_at trigger --------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---- Helper skeletons (real bodies defined in 08_functions_triggers.sql) ----
-- IMPORTANT: these stubs MUST NOT reference application tables, because Postgres
-- validates LANGUAGE sql function bodies at CREATE time and those tables do not
-- exist yet (they are created in files 02/03). File 08 CREATE OR REPLACEs each
-- of these with its real, table-backed body AFTER all tables exist.
create or replace function private.authorized_org_ids()
returns setof uuid language sql stable security definer set search_path = private, public as $$
  select null::uuid where false  -- stub; real body in 08_functions_triggers.sql
$$;

create or replace function private.has_permission(p_key text, p_org uuid default null)
returns boolean language sql stable security definer set search_path = private, public as $$
  select false  -- stub; real body in 08_functions_triggers.sql
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = private, public as $$
  select false  -- stub; real body in 08_functions_triggers.sql
$$;

create or replace function private.current_candidate_id()
returns uuid language sql stable security definer set search_path = private, public as $$
  select null::uuid  -- stub; real body in 08_functions_triggers.sql
$$;

-- Convention reminder: all PKs uuid (gen_random_uuid()); all timestamps timestamptz;
-- created_at/updated_at on mutable tables; created_by/updated_by on operational tables.
