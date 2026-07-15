# 09 — Storage Architecture (Supabase Storage)

Files never live in Postgres. Postgres holds secure metadata (`documents`, `document_versions`, `document_previews`, `ai_media_assets`, `ai_transcripts`) and access rules; **Supabase Storage** holds the bytes. All personal-data buckets are **private**; access is via short-lived signed URLs minted server-side only after a permission + consent check, and every mint is audited.

## 1. Buckets

| Bucket | Public? | Contents | Path structure | Max size | MIME allow-list |
|---|---|---|---|---|---|
| `candidate-cvs` | **private** | CVs + versions | `candidate/{candidate_id}/cv/{document_id}/{version_no}.{ext}` | 15 MB | pdf, docx |
| `candidate-documents` | **private** | certs, licences, transcripts, cover letters, work samples, portfolio | `candidate/{candidate_id}/docs/{document_type}/{document_id}.{ext}` | 25 MB | pdf, docx, jpg, png |
| `candidate-id-evidence` | **private, restricted** | ID scans, verification/liveness evidence | `candidate/{candidate_id}/id/{verification_id}/{n}.{ext}` | 15 MB | pdf, jpg, png | 
| `interview-recordings` | **private** | AI/live interview video | `org/{owning_org}/interview/{session_or_interview_id}/{asset_id}.mp4` | 500 MB | mp4, webm |
| `interview-audio` | **private** | audio tracks | `org/{owning_org}/interview/{id}/{asset_id}.m4a` | 100 MB | m4a, mp3, wav |
| `interview-transcripts` | **private** | generated transcript files | `org/{owning_org}/interview/{id}/transcript/{id}.json|txt` | 5 MB | json, txt, vtt |
| `document-previews` | **private** | watermarked previews, thumbnails, redacted previews | `previews/{document_id}/{version_no}/{preview_type}.{ext}` | 10 MB | pdf, png, webp |
| `employer-documents` | **private** | employer registration/verification docs, offer docs | `org/{employer_org}/docs/{document_id}.{ext}` | 25 MB | pdf, docx, jpg, png |
| `payment-evidence` | **private** | manual payment proofs | `org/{owning_org}/payments/{payment_id}/{n}.{ext}` | 10 MB | pdf, jpg, png |
| `org-branding` | **public-read** | logos, brand assets only (no personal data) | `branding/{organization_id}/{asset}.{ext}` | 2 MB | svg, png, jpg, webp |
| `public-content` | **public-read** | blog/about/marketing images (no personal data) | `content/{slug}/{asset}.{ext}` | 5 MB | png, jpg, webp, svg |

Only `org-branding` and `public-content` are public, and they **never** hold personal data (scenario 11 defense).

## 2. Ownership & access model
- Every private object has a `documents` (or `ai_media_assets`) row that carries `owner_candidate_id`/`owning_organization_id`, `visibility`, `scan_status`, `retention_status`.
- **Path-encoded tenant**: the first path segment (`candidate/{id}` or `org/{id}`) lets Storage RLS derive ownership cheaply and cross-check against the metadata row.
- **Upload permissions**: candidates upload to their own `candidate/*` paths; recruiters/employers upload to their org paths (with permission). Uploads set `scan_status='pending'`; a scan worker sets `clean`/`infected`.
- **Read permissions**: never a raw public URL for private objects. A server function verifies (a) caller ownership/grant via `private.*` helpers, (b) consent where required (e.g. employer preview needs an active submission + employer-submission consent; interview recording needs recording consent), (c) `scan_status='clean'`, then mints a **short-lived signed URL** (e.g. 60–300 s) and writes `document_access_grants` + `audit_log`.

## 3. Storage RLS policy shape
Supabase Storage uses `storage.objects` RLS. Policies parse the path and call the same `private.*` helpers:

```sql
-- candidate can read own CV objects
create policy "candidate reads own cvs"
on storage.objects for select
using (
  bucket_id = 'candidate-cvs'
  and (storage.foldername(name))[2] = private.current_candidate_id()::text
);

-- franchise/HQ read via an active grant (checked in metadata) — enforced by only
-- minting signed URLs server-side after private.has_document_access(document_id);
-- direct anon/authenticated select on private buckets is otherwise denied.
create policy "no direct read of private buckets"
on storage.objects for select
using ( bucket_id in ('org-branding','public-content') );  -- all others go through signed URLs
```

The pattern: **private buckets have no broad SELECT policy**; all reads go through server-minted signed URLs after a full check. This makes path-guessing useless.

## 4. Watermarked previews & view-only
- On CV upload, a preview worker generates a **watermarked, view-only** rendering (candidate ref + employer name + timestamp) into `document-previews` and records a `document_previews` row.
- Employers are served the **preview** object (signed URL), never the original CV. `document_access_grants.scope='preview'`.
- Original files carry `scope='download'` grants available only to the candidate (own) and Super Admin (export), always audited (S1/S3 "no downloads except Super Admin").
- Redacted previews (for AI/interview transcripts where needed) similarly live in `document-previews`.

## 5. Interview & AI media
- Raw video/audio → `interview-recordings`/`interview-audio`, referenced by `ai_media_assets`/`interviews.recording_document_id`.
- Access requires recording consent (`recording_consent_id`/AI session consent). Transcripts → `interview-transcripts` referenced by `ai_transcripts`.
- The AI evaluator reads a session's media only via a scoped signed URL bound to that session (scenario 10).

## 6. Retention & cleanup
- Each metadata row carries `retention_status` and (for media) `delete_after`.
- Scheduled jobs (see `13`) sweep:
  - `documents (retention_status='pending_purge')` and `ai_media_assets (retention_status='active' AND delete_after < now())` → **delete the Storage object first**, then mark row `purged` (keep the metadata stub for audit, or anonymize).
  - Independent schedules for **recording** vs **transcript** vs **model output** (R-082): deleting a recording does not delete its evaluation lineage unless policy says so.
- `legal_holds` block purge for named subjects/entities.
- ID-evidence bucket (`candidate-id-evidence`) has the **shortest** retention (delete evidence soon after verification outcome), keeping only the verification status.

## 7. Security summary
- Private by default; personal data never in public buckets.
- Signed URLs short-lived, minted only after permission+consent+scan checks, and logged.
- Suspended users fail the mint check → no new URLs (scenario 12).
- Path-guessing defeated by "no direct read" policy on private buckets (scenario 11).
- Virus/malware scan gate (`scan_status`) before any preview generation or serving.
- Checksums (`checksum_sha256`) detect tampering/duplicate uploads.
