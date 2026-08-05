import "server-only";

/**
 * Reads candidate records out of Zoho Recruit for the inventory stage.
 *
 * Read-only: it uses the existing outbound client's request helper and calls
 * nothing that writes. The outbound satellite (outbox, projection, reconcile)
 * is untouched — import is a separate, inbound path with its own gates.
 */
import { listRecords } from "@/lib/integrations/zoho-recruit/records";
import type { ZohoCandidateRecord } from "@/lib/integrations/zoho-recruit/import/mapping";
import type { ZohoCandidateSource } from "@/lib/integrations/zoho-recruit/import/pipeline";

/** Zoho's list envelope. Anything else is treated as an empty page. */
interface ZohoListResponse {
  data?: unknown;
  info?: { more_records?: boolean };
}

function readId(record: ZohoCandidateRecord): string | null {
  const id = record.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number") return String(id);
  return null;
}

export function liveZohoCandidateSource(): ZohoCandidateSource {
  return {
    async listCandidates({ page, perPage }) {
      const result = await listRecords("Candidates", { page, per_page: perPage });
      const body = (result.data ?? {}) as ZohoListResponse;
      const rows = Array.isArray(body.data) ? body.data : [];

      const records: Array<{ id: string; record: ZohoCandidateRecord }> = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const record = row as ZohoCandidateRecord;
        const id = readId(record);
        // A record with no Zoho id cannot be mapped back for reconciliation, so
        // it is dropped here rather than staged under a synthetic key.
        if (!id) continue;
        records.push({ id, record });
      }

      return { records, hasMore: body.info?.more_records === true };
    },
  };
}

/**
 * A source backed by records supplied in-process. Used for dry runs against a
 * fixture set, so an operator can rehearse an import — and see the quarantine
 * report — without any Zoho connection.
 */
export function fixtureZohoCandidateSource(
  records: ReadonlyArray<{ id: string; record: ZohoCandidateRecord }>,
): ZohoCandidateSource {
  return {
    async listCandidates({ page, perPage }) {
      const start = (page - 1) * perPage;
      const slice = records.slice(start, start + perPage);
      return { records: [...slice], hasMore: start + perPage < records.length };
    },
  };
}
