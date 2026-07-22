-- Client Submission packs share identity + CV with the employer (no separate
-- consent gate). Track optional skills-test results on the application so the
-- employer pack can show a score or N/A.

alter table public.applications
  add column if not exists test_name text,
  add column if not exists test_score text;

comment on column public.applications.test_name is
  'Skills / aptitude test label shown to employers after Client Submission.';
comment on column public.applications.test_score is
  'Skills / aptitude test result (free-text). Null means not taken → N/A.';

-- Employers may read the CV document attached to a live submission for their org.
drop policy if exists candidate_documents_employer_submission_read on public.candidate_documents;
create policy candidate_documents_employer_submission_read
on public.candidate_documents
for select to authenticated
using (
  exists (
    select 1
    from public.employer_submissions es
    where es.cv_document_id = candidate_documents.id
      and es.employer_org_id in (select public.auth_scoped_org_ids())
      and es.status in ('submitted','viewed','shortlisted','interview_requested','offered','rejected')
      and es.access_revoked_at is null
      and (
        es.application_id is null
        or private.application_is_active(es.application_id)
      )
  )
);

-- Matching Storage read for signed CV URLs.
drop policy if exists "employer read submitted cvs" on storage.objects;
create policy "employer read submitted cvs"
on storage.objects
for select to authenticated
using (
  bucket_id = 'candidate-documents'
  and exists (
    select 1
    from public.candidate_documents d
    join public.employer_submissions es on es.cv_document_id = d.id
    where d.bucket_id = 'candidate-documents'
      and d.object_path = storage.objects.name
      and es.employer_org_id in (select public.auth_scoped_org_ids())
      and es.status in ('submitted','viewed','shortlisted','interview_requested','offered','rejected')
      and es.access_revoked_at is null
      and (
        es.application_id is null
        or private.application_is_active(es.application_id)
      )
  )
);

notify pgrst, 'reload schema';
