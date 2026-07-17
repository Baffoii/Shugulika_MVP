-- File 0007: grant base table privileges on the two tables added in
-- migration 0006 (resume_parse_runs, resume_field_suggestions).
--
-- Migration 0002 ran `grant select, insert, update, delete on all tables in
-- schema public to authenticated`, but that is a one-time snapshot — it only
-- applies to tables that existed at the moment it ran. Tables created later
-- (like these two) are never covered by it and need an explicit grant.
-- RLS policies are evaluated only AFTER Postgres checks base table
-- privileges, so without this grant every query fails with
-- "permission denied for table ..." (SQLSTATE 42501) even though the RLS
-- policies from 0006 are correct.
grant select, insert, update, delete on public.resume_parse_runs to authenticated;
grant select, insert, update, delete on public.resume_field_suggestions to authenticated;

notify pgrst, 'reload schema';
