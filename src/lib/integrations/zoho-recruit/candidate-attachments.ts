import "server-only";

import { downloadAttachment, listAttachments } from "@/lib/integrations/zoho-recruit/records";

export type ZohoAttachmentMeta = {
  id: string;
  fileName: string | null;
  size: number | null;
  createdTime: string | null;
};

const RESUME_NAME_PATTERN = /(^|[^a-z0-9])(cv|resume|curriculum|vitae)([^a-z0-9]|$)/i;
const SUPPORTED_EXT = /\.(pdf|docx?|png|jpe?g|txt|rtf)$/i;
const UNSUPPORTED_EXT = /\.(exe|bat|cmd|sh|js|msi|dll|zip|rar|7z|html?)$/i;

function asText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  return null;
}

function asStringId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function parseAttachmentList(payload: unknown): ZohoAttachmentMeta[] {
  if (!payload || typeof payload !== "object" || !("data" in payload)) return [];
  const data = (payload as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const obj = row as Record<string, unknown>;
      const id = asStringId(obj.id);
      if (!id) return null;
      return {
        id,
        fileName:
          asText(obj.File_Name) ??
          asText(obj.file_Name) ??
          asText(obj.file_name) ??
          asText(obj.name),
        size:
          typeof obj.Size === "number" ? obj.Size : typeof obj.size === "number" ? obj.size : null,
        createdTime: asText(obj.Created_Time) ?? asText(obj.created_time),
      };
    })
    .filter((row): row is ZohoAttachmentMeta => Boolean(row));
}

/** Prefer filenames that look like resumes/CVs among supported types. */
export function selectResumeAttachment(
  attachments: ZohoAttachmentMeta[],
): ZohoAttachmentMeta | null {
  const usable = attachments.filter((a) => {
    const name = a.fileName ?? "";
    if (UNSUPPORTED_EXT.test(name)) return false;
    return !name || SUPPORTED_EXT.test(name) || RESUME_NAME_PATTERN.test(name);
  });
  if (usable.length === 0) return null;

  const named = usable.filter((a) => a.fileName && RESUME_NAME_PATTERN.test(a.fileName));
  if (named.length > 0) return named[0] ?? null;

  const byExt = usable.filter((a) => a.fileName && SUPPORTED_EXT.test(a.fileName));
  if (byExt.length > 0) return byExt[0] ?? null;

  return usable[0] ?? null;
}

export async function resolveCandidateResumeAttachment(zohoCandidateId: string): Promise<{
  hasResume: boolean;
  attachment: ZohoAttachmentMeta | null;
}> {
  const result = await listAttachments("Candidates", zohoCandidateId);
  const attachments = parseAttachmentList(result.data);
  const selected = selectResumeAttachment(attachments);
  return { hasResume: Boolean(selected), attachment: selected };
}

export async function downloadCandidateResumeAttachment(
  zohoCandidateId: string,
  attachmentId: string,
) {
  return downloadAttachment("Candidates", zohoCandidateId, attachmentId);
}

export function isSupportedResumeContentType(
  contentType: string | null,
  fileName: string | null,
): boolean {
  const ct = (contentType ?? "").toLowerCase();
  const name = fileName ?? "";
  if (UNSUPPORTED_EXT.test(name)) return false;
  if (
    ct.includes("pdf") ||
    ct.includes("msword") ||
    ct.includes("officedocument") ||
    ct.includes("image/") ||
    ct.includes("text/plain") ||
    ct.includes("rtf")
  ) {
    return true;
  }
  // Zoho attachment downloads often use application/x-download; trust the extension.
  if (
    !ct ||
    ct.includes("octet-stream") ||
    ct.includes("x-download") ||
    /(^|\/)download([;+]|$)/.test(ct)
  ) {
    return !name || SUPPORTED_EXT.test(name);
  }
  return false;
}

/** Extract a filename from a Content-Disposition header when list metadata is incomplete. */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^"|"$/g, "")) || null;
    } catch {
      return utf8[1].trim().replace(/^"|"$/g, "") || null;
    }
  }
  const plain = header.match(/filename\s*=\s*("?)([^";]+)\1/i);
  return plain?.[2]?.trim() || null;
}
