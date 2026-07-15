-- =============================================================================
-- File 11: Supabase Storage buckets + storage RLS. See docs/database/09.
-- Private buckets have NO broad SELECT policy: all reads go through server-minted
-- short-lived signed URLs after a permission + consent + scan check.
-- =============================================================================

-- Create buckets (id, name, public flag). File-size/MIME limits enforced at upload API + edge fn.
insert into storage.buckets (id, name, public) values
  ('candidate-cvs','candidate-cvs', false),
  ('candidate-documents','candidate-documents', false),
  ('candidate-id-evidence','candidate-id-evidence', false),
  ('interview-recordings','interview-recordings', false),
  ('interview-audio','interview-audio', false),
  ('interview-transcripts','interview-transcripts', false),
  ('document-previews','document-previews', false),
  ('employer-documents','employer-documents', false),
  ('payment-evidence','payment-evidence', false),
  ('org-branding','org-branding', true),
  ('public-content','public-content', true)
on conflict (id) do nothing;

-- Public buckets: world-readable (no personal data stored here).
create policy "public read branding" on storage.objects for select
  using (bucket_id in ('org-branding','public-content'));

-- Candidates may upload/manage their own objects (path: candidate/{candidate_id}/...)
create policy "candidate writes own" on storage.objects for insert
  with check (
    bucket_id in ('candidate-cvs','candidate-documents','candidate-id-evidence')
    and (storage.foldername(name))[2] = private.current_candidate_id()::text
  );
create policy "candidate reads own" on storage.objects for select
  using (
    bucket_id in ('candidate-cvs','candidate-documents','candidate-id-evidence')
    and (storage.foldername(name))[2] = private.current_candidate_id()::text
  );

-- Org staff may upload to their org paths (path: org/{org_id}/...)
create policy "org writes own" on storage.objects for insert
  with check (
    bucket_id in ('employer-documents','payment-evidence','interview-recordings','interview-audio','interview-transcripts','org-branding')
    and (storage.foldername(name))[2] in (select private.authorized_org_ids()::text)
  );

-- IMPORTANT: no broad SELECT policy on the remaining private buckets.
-- Reads for franchises/employers happen only via server-minted signed URLs after
-- private.* permission + consent + scan checks (documented in docs/database/09).
-- This defeats path-guessing (adversarial scenario 11) and stale-URL reuse (scenario 12).
