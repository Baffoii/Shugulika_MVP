import "server-only";

import { z } from "zod";
import {
  zohoRecruitDownload,
  zohoRecruitRequest,
  type ZohoBinaryResult,
  type ZohoRequestResult,
} from "@/lib/integrations/zoho-recruit/client";

/**
 * Thin Zoho Recruit record helpers.
 *
 * Documented endpoints:
 * - POST /recruit/v2/{module}/upsert
 * - GET  /recruit/v2/{module}/{id}
 * - GET  /recruit/v2/{module}/search?criteria=
 * - GET  /recruit/v2/{module}?page=&per_page=
 * - GET  /recruit/v2/settings/modules
 * - GET  /recruit/v2/settings/fields?module=
 */

const ModuleName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_]+$/);

function assertModule(module: string): string {
  return ModuleName.parse(module);
}

export async function insertRecords(
  module: string,
  data: Record<string, unknown>[],
): Promise<ZohoRequestResult<unknown>> {
  const mod = assertModule(module);
  return zohoRecruitRequest({
    method: "POST",
    path: `/recruit/v2/${mod}`,
    body: { data, trigger: [] },
  });
}

export async function updateRecords(
  module: string,
  data: Record<string, unknown>[],
): Promise<ZohoRequestResult<unknown>> {
  const mod = assertModule(module);
  return zohoRecruitRequest({
    method: "PUT",
    path: `/recruit/v2/${mod}`,
    body: { data, trigger: [] },
  });
}

export async function upsertRecords(
  module: string,
  data: Record<string, unknown>[],
): Promise<ZohoRequestResult<unknown>> {
  const mod = assertModule(module);
  return zohoRecruitRequest({
    method: "POST",
    path: `/recruit/v2/${mod}/upsert`,
    body: { data, trigger: [] },
  });
}

export async function getRecord(module: string, id: string): Promise<ZohoRequestResult<unknown>> {
  const mod = assertModule(module);
  const recordId = z.string().min(1).max(100).parse(id);
  return zohoRecruitRequest({
    method: "GET",
    path: `/recruit/v2/${mod}/${encodeURIComponent(recordId)}`,
  });
}

export async function searchRecords(
  module: string,
  criteria: string,
): Promise<ZohoRequestResult<unknown>> {
  const mod = assertModule(module);
  return zohoRecruitRequest({
    method: "GET",
    path: `/recruit/v2/${mod}/search`,
    query: { criteria: z.string().min(1).max(2000).parse(criteria) },
  });
}

export async function listRecords(
  module: string,
  options: { page?: number; per_page?: number; fields?: string[] } = {},
): Promise<ZohoRequestResult<unknown>> {
  const mod = assertModule(module);
  const page = options.page ?? 1;
  const perPage = options.per_page ?? 200;
  const fields =
    options.fields && options.fields.length > 0
      ? options.fields
          .map((f) => f.trim())
          .filter(Boolean)
          .slice(0, 100)
          .join(",")
      : undefined;
  return zohoRecruitRequest({
    method: "GET",
    path: `/recruit/v2/${mod}`,
    query: {
      page: z.number().int().positive().parse(page),
      per_page: z.number().int().positive().max(200).parse(perPage),
      fields,
    },
  });
}

export async function getModules(): Promise<ZohoRequestResult<unknown>> {
  return zohoRecruitRequest({
    method: "GET",
    path: "/recruit/v2/settings/modules",
  });
}

export async function getFields(module: string): Promise<ZohoRequestResult<unknown>> {
  const mod = assertModule(module);
  return zohoRecruitRequest({
    method: "GET",
    path: "/recruit/v2/settings/fields",
    query: { module: mod },
  });
}

export async function listAttachments(
  module: string,
  recordId: string,
): Promise<ZohoRequestResult<unknown>> {
  const mod = assertModule(module);
  const id = z.string().min(1).max(100).parse(recordId);
  return zohoRecruitRequest({
    method: "GET",
    path: `/recruit/v2/${mod}/${encodeURIComponent(id)}/Attachments`,
  });
}

export async function downloadAttachment(
  module: string,
  recordId: string,
  attachmentId: string,
): Promise<ZohoBinaryResult> {
  const mod = assertModule(module);
  const id = z.string().min(1).max(100).parse(recordId);
  const att = z.string().min(1).max(100).parse(attachmentId);
  return zohoRecruitDownload({
    method: "GET",
    path: `/recruit/v2/${mod}/${encodeURIComponent(id)}/Attachments/${encodeURIComponent(att)}`,
  });
}
