import "server-only";

/**
 * Reads candidate records out of Zoho Recruit for the inventory stage.
 *
 * Read-only: it uses the existing outbound client's request helper and calls
 * nothing that writes. The outbound satellite (outbox, projection, reconcile)
 * is untouched — import is a separate, inbound path with its own gates.
 */
import { getFields, getRecord, listRecords } from "@/lib/integrations/zoho-recruit/records";
import {
  buildCandidateFieldMapping,
  consentListFields,
  type CandidateFieldMapping,
  type ZohoFieldMeta,
} from "@/lib/integrations/zoho-recruit/candidate-field-map";
import { evaluateCandidateEligibility } from "@/lib/integrations/zoho-recruit/candidate-eligibility";
import type { ZohoCandidateRecord } from "@/lib/integrations/zoho-recruit/import/mapping";
import type { ZohoCandidateSource } from "@/lib/integrations/zoho-recruit/import/pipeline";

/** Zoho's list envelope. Anything else is treated as an empty page. */
interface ZohoListResponse {
  data?: unknown;
  info?: { more_records?: boolean };
}

interface ZohoFieldsResponse {
  fields?: unknown;
}

const BASE_CANDIDATE_FIELDS = [
  "id",
  "First_Name",
  "Last_Name",
  "Middle_Name",
  "Email",
  "Phone",
  "Mobile",
  "City",
  "Country",
  "Current_Job_Title",
  "Candidate_Summary",
  "Availability",
  "Skill_Set",
  "Current_Employer",
  "Highest_Qualification_Held",
  "Institute_Name",
];

function parseFieldMetadata(value: unknown): ZohoFieldMeta[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) => {
    if (!field || typeof field !== "object") return [];
    const raw = field as Record<string, unknown>;
    if (typeof raw.api_name !== "string" || !raw.api_name.trim()) return [];
    return [
      {
        api_name: raw.api_name,
        ...(typeof raw.field_label === "string" ? { field_label: raw.field_label } : {}),
        ...(typeof raw.data_type === "string" ? { data_type: raw.data_type } : {}),
      },
    ];
  });
}

function readId(record: ZohoCandidateRecord): string | null {
  const id = record.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number") return String(id);
  return null;
}

export function liveZohoCandidateSource(): ZohoCandidateSource {
  let mappingPromise: Promise<CandidateFieldMapping> | null = null;
  const consentMapping = () => {
    mappingPromise ??= getFields("Candidates").then((result) => {
      if (result.status < 200 || result.status >= 300) return {};
      const body = (result.data ?? {}) as ZohoFieldsResponse;
      return buildCandidateFieldMapping(parseFieldMetadata(body.fields));
    });
    return mappingPromise;
  };

  return {
    async listCandidates({ page, perPage }) {
      const mapping = await consentMapping();
      const result = await listRecords("Candidates", {
        page,
        per_page: perPage,
        fields: [...new Set([...BASE_CANDIDATE_FIELDS, ...consentListFields(mapping)])],
      });
      const body = (result.data ?? {}) as ZohoListResponse;
      const rows = Array.isArray(body.data) ? body.data : [];

      const records: Array<{
        id: string;
        record: ZohoCandidateRecord;
        eligibility: { eligible: boolean; reasons: string[]; evidence: string[] };
      }> = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const record = row as ZohoCandidateRecord;
        const id = readId(record);
        // A record with no Zoho id cannot be mapped back for reconciliation, so
        // it is dropped here rather than staged under a synthetic key.
        if (!id) continue;
        const eligibility = evaluateCandidateEligibility(record, mapping);
        records.push({ id, record, eligibility });
      }

      return { records, hasMore: body.info?.more_records === true };
    },
    async getCandidate(id) {
      const mapping = await consentMapping();
      const result = await getRecord("Candidates", id);
      const body = (result.data ?? {}) as ZohoListResponse;
      const row = Array.isArray(body.data) ? body.data[0] : null;
      if (!row || typeof row !== "object") return null;
      const record = row as ZohoCandidateRecord;
      return { record, eligibility: evaluateCandidateEligibility(record, mapping) };
    },
  };
}

/**
 * A source backed by records supplied in-process. Used for dry runs against a
 * fixture set, so an operator can rehearse an import — and see the quarantine
 * report — without any Zoho connection.
 */
export function fixtureZohoCandidateSource(
  records: ReadonlyArray<{
    id: string;
    record: ZohoCandidateRecord;
    eligibility?: { eligible: boolean; reasons: string[]; evidence: string[] };
  }>,
): ZohoCandidateSource {
  return {
    async listCandidates({ page, perPage }) {
      const start = (page - 1) * perPage;
      const slice = records.slice(start, start + perPage);
      return {
        records: slice.map((row) => ({
          ...row,
          eligibility: row.eligibility ?? {
            eligible: false,
            reasons: ["portal_consent_missing"],
            evidence: [],
          },
        })),
        hasMore: start + perPage < records.length,
      };
    },
    async getCandidate(id) {
      const row = records.find((candidate) => candidate.id === id);
      if (!row) return null;
      return {
        record: row.record,
        eligibility: row.eligibility ?? {
          eligible: false,
          reasons: ["portal_consent_missing"],
          evidence: [],
        },
      };
    },
  };
}
