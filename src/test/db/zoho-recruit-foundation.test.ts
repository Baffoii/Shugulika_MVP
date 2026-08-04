import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connect, hasDb, queryAs, setupDb, type SeedIds } from "./helpers";

const d = hasDb ? describe : describe.skip;

d("Zoho Recruit server-only satellite foundation", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  it("creates all feature gates disabled", async () => {
    const result = await client.query(
      `select key, is_enabled
       from public.feature_flags
       where key like 'zoho_recruit_%'
       order by key`,
    );
    expect(result.rows).toEqual([
      { key: "zoho_recruit_data_sync_enabled", is_enabled: false },
      { key: "zoho_recruit_enabled", is_enabled: false },
      { key: "zoho_recruit_production_data_enabled", is_enabled: false },
    ]);
  });

  it("denies every browser role, including HQ, from credential and queue tables", async () => {
    for (const table of [
      "zoho_recruit_connections",
      "zoho_recruit_external_mappings",
      "zoho_recruit_outbox",
      "zoho_recruit_inbox",
      "zoho_recruit_conflicts",
      "zoho_recruit_reconciliations",
    ]) {
      await expect(queryAs(client, ids.hqAdmin, `select * from public.${table}`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        queryAs(client, ids.candidate1, `select * from public.${table}`),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it("allows only the server role to use the private integration ledger", async () => {
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      const result = await client.query(
        `insert into public.zoho_recruit_connections (connection_key, status)
         values ('test', 'disconnected')
         returning connection_key, status`,
      );
      expect(result.rows[0]).toEqual({ connection_key: "test", status: "disconnected" });
    } finally {
      await client.query("rollback");
    }
  });

  it("attaches no Zoho triggers to existing recruitment tables", async () => {
    const result = await client.query(
      `select event_object_table, trigger_name
       from information_schema.triggers
       where event_object_schema = 'public'
         and event_object_table in (
           'candidate_profiles', 'candidate_documents', 'candidate_consents',
           'job_orders', 'jobs', 'applications', 'assessment_assignments',
           'interviews', 'offers', 'placements'
         )
         and lower(trigger_name) like '%zoho%'`,
    );
    expect(result.rows).toEqual([]);
  });
});
