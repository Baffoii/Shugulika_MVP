-- =============================================================================
-- Shugulika MVP — Supabase Storage bucket + policies.
-- Private bucket for candidate documents. Candidates manage files under their
-- own {auth.uid}/... prefix. Authorized staff may read a document only when they
-- can read that candidate (application/searchable) — matched by object_path.
-- Employers never read candidate files directly (they see submission snapshots).
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('candidate-documents', 'candidate-documents', false)
on conflict (id) do nothing;

-- Candidate: full access to their own folder ({auth.uid}/...)
create policy "candidate rw own docs"
on storage.objects for all to authenticated
using (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'candidate-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- Authorized staff: read a candidate document if they may read the candidate.
create policy "staff read candidate docs"
on storage.objects for select to authenticated
using (
  bucket_id = 'candidate-documents'
  and exists (
    select 1 from public.candidate_documents d
    join public.candidate_profiles cp on cp.id = d.candidate_id
    where d.bucket_id = 'candidate-documents'
      and d.object_path = storage.objects.name
      and public.auth_can_read_candidate(cp.id)
  )
);
