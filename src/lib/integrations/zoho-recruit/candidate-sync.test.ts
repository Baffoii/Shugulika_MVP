import { beforeEach, describe, expect, it, vi } from "vitest";

const listRecords = vi.fn();
const getFields = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/integrations/zoho-recruit/records", () => ({
  listRecords: (...args: unknown[]) => listRecords(...args),
  getFields: (...args: unknown[]) => getFields(...args),
}));

vi.mock("@/lib/integrations/zoho-recruit/gates", () => ({
  getZohoRecruitGateStatus: async () => ({
    enabled: true,
    dataSyncEnabled: true,
    productionDataEnabled: true,
    sandboxSyncEnabled: false,
    syncAllowed: true,
    productionExportAllowed: true,
    sandboxExportAllowed: false,
    blockedReasons: [],
    flags: {
      zoho_recruit_enabled: true,
      zoho_recruit_data_sync_enabled: true,
      zoho_recruit_production_data_enabled: true,
      zoho_recruit_sandbox_sync_enabled: false,
    },
  }),
}));

vi.mock("@/lib/integrations/zoho-recruit/candidate-probe", () => ({
  probeZohoCandidateAccess: async () => ({
    ready: true,
    checks: [{ id: "ok", ok: true, detail: "ready" }],
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ from: fromMock }),
}));

describe("syncZohoCandidatesToSearchCache pagination", () => {
  beforeEach(() => {
    vi.resetModules();
    listRecords.mockReset();
    getFields.mockReset();
    fromMock.mockReset();
  });

  function chain(result: unknown = { data: null, error: null, count: 0 }) {
    const api: Record<string, unknown> = {};
    const self = () => api;
    api.select = self;
    api.insert = () => api;
    api.update = () => api;
    api.upsert = async () => ({ data: null, error: null });
    api.eq = self;
    api.in = self;
    api.or = self;
    api.maybeSingle = async () => result;
    api.single = async () => result;
    api.then = undefined;
    return api;
  }

  it("paginates beyond 200 records and upserts by zoho_candidate_id", async () => {
    getFields.mockResolvedValue({
      data: {
        fields: [
          { api_name: "id", field_label: "Record Id" },
          { api_name: "Current_Job_Title", field_label: "Current Job Title" },
          { api_name: "Candidate_Status", field_label: "Candidate Status" },
          { api_name: "$converted", field_label: "Converted" },
        ],
      },
    });

    listRecords
      .mockResolvedValueOnce({
        data: {
          data: Array.from({ length: 200 }, (_, i) => ({
            id: `id-${i}`,
            Current_Job_Title: `Role ${i}`,
            Candidate_Status: "New",
            $converted: false,
          })),
          info: { more_records: true },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: "id-200",
              Current_Job_Title: "Role 200",
              Candidate_Status: "New",
              $converted: false,
            },
          ],
          info: { more_records: false },
        },
      });

    const upserts: unknown[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "zoho_recruit_connections") {
        return chain({ data: { id: "conn-1" }, error: null });
      }
      if (table === "zoho_recruit_candidate_sync_runs") {
        const api = chain({ data: { id: "run-1" }, error: null });
        api.insert = () => ({
          select: () => ({
            single: async () => ({ data: { id: "run-1" }, error: null }),
          }),
        });
        api.update = () => ({
          eq: async () => ({ data: null, error: null }),
        });
        return api;
      }
      if (table === "zoho_recruit_candidate_sync_lock") {
        return {
          update: () => ({
            eq: () => ({
              or: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { lock_key: "primary" }, error: null }),
                }),
              }),
              eq: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "zoho_recruit_candidate_search") {
        return {
          upsert: async (rows: unknown[]) => {
            upserts.push(...rows);
            return { data: null, error: null };
          },
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
          update: () => ({
            in: () => ({
              select: async () => ({ data: null, error: null, count: 0 }),
            }),
          }),
        };
      }
      return chain();
    });

    const { syncZohoCandidatesToSearchCache } =
      await import("@/lib/integrations/zoho-recruit/candidate-sync");
    const result = await syncZohoCandidatesToSearchCache({ lockedBy: "test" });

    expect(listRecords).toHaveBeenCalledTimes(2);
    expect(listRecords.mock.calls[0]?.[1]).toMatchObject({ page: 1, per_page: 200 });
    expect(listRecords.mock.calls[1]?.[1]).toMatchObject({ page: 2, per_page: 200 });
    expect(result.status).toBe("succeeded");
    expect(result.pagesFetched).toBe(2);
    expect(result.candidatesSeen).toBe(201);
    expect(upserts.length).toBe(201);
    expect(
      new Set(upserts.map((r) => (r as { zoho_candidate_id: string }).zoho_candidate_id)).size,
    ).toBe(201);
  });

  it("returns empty success path when Zoho has no candidates", async () => {
    getFields.mockResolvedValue({
      data: { fields: [{ api_name: "id", field_label: "Record Id" }] },
    });
    listRecords.mockResolvedValue({
      data: { data: [], info: { more_records: false } },
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "zoho_recruit_connections") {
        return chain({ data: { id: "conn-1" }, error: null });
      }
      if (table === "zoho_recruit_candidate_sync_runs") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "run-2" }, error: null }),
            }),
          }),
          update: () => ({
            eq: async () => ({ data: null, error: null }),
          }),
        };
      }
      if (table === "zoho_recruit_candidate_sync_lock") {
        return {
          update: () => ({
            eq: () => ({
              or: () => ({
                select: () => ({
                  maybeSingle: async () => ({ data: { lock_key: "primary" }, error: null }),
                }),
              }),
              eq: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "zoho_recruit_candidate_search") {
        return {
          upsert: async () => ({ data: null, error: null }),
          select: () => ({
            eq: async () => ({ data: [], error: null }),
          }),
          update: () => ({
            in: () => ({
              select: async () => ({ data: null, error: null, count: 0 }),
            }),
          }),
        };
      }
      return chain();
    });

    const { syncZohoCandidatesToSearchCache } =
      await import("@/lib/integrations/zoho-recruit/candidate-sync");
    const result = await syncZohoCandidatesToSearchCache({ lockedBy: "test" });
    expect(result.status).toBe("succeeded");
    expect(result.candidatesSeen).toBe(0);
    expect(result.candidatesUpserted).toBe(0);
  });
});
