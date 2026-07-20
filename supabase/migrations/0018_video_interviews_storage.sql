-- =============================================================================
-- Shugulika MVP — asynchronous video interviews: private Storage bucket.
-- Recordings are NEVER public. A candidate may write only to paths that match
-- one of their own attempt rows on an actively in-progress assignment (the row
-- is created server-side first, so the path is server-generated). Staff may
-- read a recording only when the attempt's assignment sits inside their org
-- scope — playback uses short-lived signed URLs created under the user's JWT.
-- Employer users get no access. 100 MB cap + video-only MIME types.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interview-recordings', 'interview-recordings', false,
  104857600, array['video/webm','video/mp4']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Candidate: upload (insert/update for retryable uploads) to a path that
-- matches one of their own attempt rows while the assignment is in progress.
create policy "candidate write own interview recordings"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'interview-recordings'
  and exists (
    select 1
    from public.interview_response_attempts a
    join public.interview_assignments ia on ia.id = a.assignment_id
    where a.storage_bucket = 'interview-recordings'
      and a.storage_path = storage.objects.name
      and a.candidate_id = public.auth_candidate_id()
      and ia.status = 'in_progress'
      and (ia.expires_at is null or ia.expires_at > now())
  )
);

create policy "candidate update own interview recordings"
on storage.objects for update to authenticated
using (
  bucket_id = 'interview-recordings'
  and exists (
    select 1
    from public.interview_response_attempts a
    join public.interview_assignments ia on ia.id = a.assignment_id
    where a.storage_bucket = 'interview-recordings'
      and a.storage_path = storage.objects.name
      and a.candidate_id = public.auth_candidate_id()
      and ia.status = 'in_progress'
      and (ia.expires_at is null or ia.expires_at > now())
  )
);

-- Candidate: read back their own recordings (local previews are preferred, but
-- the review screen may need to re-play an uploaded attempt).
create policy "candidate read own interview recordings"
on storage.objects for select to authenticated
using (
  bucket_id = 'interview-recordings'
  and exists (
    select 1
    from public.interview_response_attempts a
    where a.storage_bucket = 'interview-recordings'
      and a.storage_path = storage.objects.name
      and a.candidate_id = public.auth_candidate_id()
  )
);

-- Staff: read recordings for assignments inside their org scope.
create policy "staff read interview recordings"
on storage.objects for select to authenticated
using (
  bucket_id = 'interview-recordings'
  and public.auth_is_interview_staff()
  and exists (
    select 1
    from public.interview_response_attempts a
    join public.interview_assignments ia on ia.id = a.assignment_id
    where a.storage_bucket = 'interview-recordings'
      and a.storage_path = storage.objects.name
      and ia.organization_id in (select public.auth_scoped_org_ids())
  )
);

-- Staff/HQ cleanup of orphaned or retention-expired objects is done with the
-- service context outside the app (documented in README); no broad delete
-- policy is granted to authenticated users.
