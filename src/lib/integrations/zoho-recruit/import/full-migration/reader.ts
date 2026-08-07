import "server-only";

/**
 * GET-only readers for the modules the full rehearsal migration needs.
 *
 * Deliberately does not import `insertRecords` / `updateRecords` /
 * `upsertRecords` from records.ts. Every function here issues `method: "GET"`
 * and nothing else, so no code path in the rehearsal can mutate Zoho.
 *
 * Zoho Recruit v2 endpoints used:
 *   GET /recruit/v2/Clients
 *   GET /recruit/v2/Job_Openings
 *   GET /recruit/v2/Job_Openings/{id}/associate     (candidates on a job)
 *   GET /recruit/v2/Candidates/{id}/Attachments
 *   GET /recruit/v2/Candidates/{id}/Attachments/{attachmentId}
 */
import { zohoRecruitRequest } from "@/lib/integrations/zoho-recruit/client";

export interface ZohoRecord {
  [key: string]: unknown;
  id?: unknown;
}

interface ListEnvelope {
  data?: unknown;
  info?: { more_records?: boolean };
}

const PER_PAGE = 200;

function rows(payload: unknown): ZohoRecord[] {
  const body = (payload ?? {}) as ListEnvelope;
  return Array.isArray(body.data) ? (body.data as ZohoRecord[]) : [];
}

function hasMore(payload: unknown): boolean {
  const body = (payload ?? {}) as ListEnvelope;
  return body.info?.more_records === true;
}

/** Zoho ids arrive as strings or numbers depending on module. */
export function readZohoId(record: ZohoRecord): string | null {
  const id = record.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number") return String(id);
  return null;
}

/**
 * Walks every page of a module. `limit` caps the pull so a rehearsal can be
 * run small first — an unbounded first run against a large Recruit org is a
 * slow way to discover a mapping bug.
 */
export async function listAllRecords(
  module: string,
  options: { limit?: number; maxPages?: number } = {},
): Promise<ZohoRecord[]> {
  const limit = options.limit ?? Infinity;
  const maxPages = options.maxPages ?? 200;
  const collected: ZohoRecord[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const result = await zohoRecruitRequest({
      method: "GET",
      path: `/recruit/v2/${module}`,
      query: { page, per_page: PER_PAGE },
    });
    // 204 (no content) is how Zoho reports an empty module.
    if (result.status === 204) break;
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Zoho ${module} list failed with status ${result.status}`);
    }
    const batch = rows(result.data);
    for (const row of batch) {
      collected.push(row);
      if (collected.length >= limit) return collected;
    }
    if (!hasMore(result.data) || batch.length === 0) break;
  }
  return collected;
}

export function listClients(options?: { limit?: number }) {
  return listAllRecords("Clients", options);
}

export function listJobOpenings(options?: { limit?: number }) {
  return listAllRecords("Job_Openings", options);
}

/**
 * Candidates associated with a job opening — Zoho's representation of "this
 * person applied to / was submitted for this role". Each row carries the
 * candidate record plus the per-application status we map to a pipeline stage.
 */
export async function listJobCandidates(jobOpeningId: string): Promise<ZohoRecord[]> {
  const collected: ZohoRecord[] = [];
  for (let page = 1; page <= 50; page++) {
    const result = await zohoRecruitRequest({
      method: "GET",
      path: `/recruit/v2/Job_Openings/${encodeURIComponent(jobOpeningId)}/associate`,
      query: { page, per_page: PER_PAGE },
    });
    if (result.status === 204) break;
    if (result.status === 404) break;
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Zoho associate list failed for job ${jobOpeningId} (${result.status})`);
    }
    const batch = rows(result.data);
    collected.push(...batch);
    if (!hasMore(result.data) || batch.length === 0) break;
  }
  return collected;
}

export interface ZohoAttachmentMeta {
  id: string;
  fileName: string;
  size: number | null;
}

/** Attachment metadata for a candidate (CVs live here). */
export async function listCandidateAttachments(candidateId: string): Promise<ZohoAttachmentMeta[]> {
  const result = await zohoRecruitRequest({
    method: "GET",
    path: `/recruit/v2/Candidates/${encodeURIComponent(candidateId)}/Attachments`,
    query: { page: 1, per_page: PER_PAGE },
  });
  if (result.status === 204 || result.status === 404) return [];
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Zoho attachment list failed for candidate ${candidateId} (${result.status})`);
  }
  const out: ZohoAttachmentMeta[] = [];
  for (const row of rows(result.data)) {
    const id = readZohoId(row);
    const name = row.File_Name;
    if (!id || typeof name !== "string" || !name.trim()) continue;
    const rawSize = row.Size;
    const size =
      typeof rawSize === "number"
        ? rawSize
        : typeof rawSize === "string" && /^\d+$/.test(rawSize)
          ? Number(rawSize)
          : null;
    out.push({ id, fileName: name.trim(), size });
  }
  return out;
}

/**
 * Downloads one attachment. Returns raw bytes so the caller can put them in
 * Supabase Storage without the content ever being logged.
 */
export async function downloadCandidateAttachment(
  candidateId: string,
  attachmentId: string,
): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  const result = await zohoRecruitRequest<unknown>({
    method: "GET",
    path: `/recruit/v2/Candidates/${encodeURIComponent(candidateId)}/Attachments/${encodeURIComponent(attachmentId)}`,
    responseType: "arrayBuffer",
  });
  if (result.status < 200 || result.status >= 300) return null;
  const body = result.data;
  if (body instanceof ArrayBuffer) {
    return { bytes: new Uint8Array(body), contentType: result.contentType ?? null };
  }
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    return {
      bytes: new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      contentType: result.contentType ?? null,
    };
  }
  return null;
}
