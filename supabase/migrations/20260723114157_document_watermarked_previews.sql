-- =============================================================================
-- R-021 — Watermarked document previews & access audit
--
-- - document_access_events: every preview / original export is logged
-- - document-previews bucket: reserved for cached derived assets (optional)
-- - Employers lose direct Storage SELECT on candidate originals; they receive
--   bytes only through the server watermark pipeline after an entitlement check
-- - Mark watermarking integration as connected
-- =============================================================================

-- ---- Access events (preview vs original/export) -----------------------------
create table if not exists public.document_access_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  source_kind text not null
    check (source_kind in ('candidate_document', 'assessment_file')),
  source_id uuid not null,
  access_scope text not null check (access_scope in ('preview', 'export')),
  bucket_id text not null,
  object_path text not null,
  job_order_id uuid references public.job_orders(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  submission_id uuid references public.employer_submissions(id) on delete set null,
  org_context_id uuid references public.organizations(id) on delete set null,
  watermark_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_doc_access_source
  on public.document_access_events (source_kind, source_id, created_at desc);
create index if not exists idx_doc_access_actor
  on public.document_access_events (actor_id, created_at desc);
create index if not exists idx_doc_access_scope
  on public.document_access_events (access_scope, created_at desc);

comment on table public.document_access_events is
  'Audited document preview (watermarked) and Super Admin export of originals (R-021).';

alter table public.document_access_events enable row level security;

drop policy if exists document_access_events_hq_read on public.document_access_events;
create policy document_access_events_hq_read
on public.document_access_events
for select to authenticated
using (public.auth_is_hq());

drop policy if exists document_access_events_insert on public.document_access_events;
create policy document_access_events_insert
on public.document_access_events
for insert to authenticated
with check (actor_id = auth.uid());

grant select, insert on public.document_access_events to authenticated;
grant all on public.document_access_events to service_role;
grant usage, select on sequence public.document_access_events_id_seq to authenticated, service_role;

-- ---- Previews bucket (optional cache for derived assets) --------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'document-previews',
  'document-previews',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No broad SELECT: only service role / server-minted signed URLs after authz.
drop policy if exists "no direct read document-previews" on storage.objects;

-- Candidates / staff / employers must not list or read preview objects directly.
-- Uploads are performed by the service role from the Next.js server.

-- ---- Harden: employers cannot mint signed URLs to original CVs --------------
drop policy if exists "employer read submitted cvs" on storage.objects;

-- Employer metadata read of candidate_documents rows for submission packs stays
-- (candidate_documents_employer_submission_read). Bytes are served only via the
-- watermarked preview API after an entitlement check.

-- ---- Feature flag / integration status --------------------------------------
update public.integration_connections
set status = 'connected', updated_at = now()
where key = 'watermarking';

notify pgrst, 'reload schema';
