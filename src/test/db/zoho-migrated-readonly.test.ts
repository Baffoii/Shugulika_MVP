/**
 * Migrated applications are historical records: readable by candidates and
 * recruiters, writable by nobody except the importer (service_role).
 *
 * This matters because both the candidate and the recruiter hold RLS UPDATE
 * policies on `applications` (app_candidate_update / app_staff_update). Without
 * the trigger, either could edit imported history straight through PostgREST —
 * the UI hiding the buttons would not stop them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connect, setupDb, hasDb, commitAs, type SeedIds } from "./helpers";
import type { Client } from "pg";

const describeDb = hasDb ? describe : describe.skip;

/**
 * Run a statement as trusted server-side code. auth.role() is only populated
 * for PostgREST requests, so a direct connection announces itself with the
 * transaction-local GUC instead — the same convention as app.submitting_interview.
 */
async function asImporter(client: Client, sql: string, params: unknown[] = []) {
  await client.query("begin");
  try {
    await client.query("select set_config('app.migrating_zoho', 'true', true)");
    const res = await client.query(sql, params);
    await client.query("commit");
    return res;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

describeDb("migrated applications are read-only", () => {
  let client: Client;
  let ids: SeedIds;
  let migratedAppId: string;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);

    // Mark the seeded application as migrated history, as the importer would.
    await asImporter(
      client,
      `update public.applications set is_migrated_readonly = true where id = $1`,
      [ids.applicationC1],
    );
    migratedAppId = ids.applicationC1;
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  it("blocks the owning candidate from editing their migrated application", async () => {
    await expect(
      commitAs(
        client,
        ids.candidate1,
        `update public.applications set next_action = 'tampered' where id = $1`,
        [migratedAppId],
      ),
    ).rejects.toThrow(/migrated historical data/i);
  });

  it("blocks a recruiter from editing it", async () => {
    await expect(
      commitAs(
        client,
        ids.recruiterA,
        `update public.applications set priority = 'high' where id = $1`,
        [migratedAppId],
      ),
    ).rejects.toThrow(/migrated historical data/i);
  });

  it("blocks a recruiter from advancing its stage", async () => {
    // The stage is the thing most likely to be "corrected" by a well-meaning
    // recruiter, and the thing that would most distort migration reporting.
    await expect(
      commitAs(
        client,
        ids.recruiterA,
        `update public.applications set current_stage = 'offer' where id = $1`,
        [migratedAppId],
      ),
    ).rejects.toThrow(/migrated historical data/i);
  });

  it("survives a recruiter delete attempt", async () => {
    // RLS exposes no DELETE policy on applications, so the statement matches
    // zero rows before the trigger is ever consulted. Either way the record
    // must still be there afterwards, which is the property worth asserting.
    await commitAs(client, ids.recruiterA, `delete from public.applications where id = $1`, [
      migratedAppId,
    ]);
    const { rows } = await client.query(`select id from public.applications where id = $1`, [
      migratedAppId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("blocks deletion at the trigger even if a DELETE policy is ever added", async () => {
    // RLS currently exposes no DELETE policy on applications, so a client role
    // cannot reach the trigger's delete branch at all. That makes the trigger
    // defence-in-depth rather than the active guard — so grant a permissive
    // policy for the duration of this test to prove the second layer holds if
    // someone ever opens the first one.
    await client.query(
      `create policy tmp_app_delete on public.applications for delete to authenticated using (true)`,
    );
    try {
      await expect(
        commitAs(client, ids.recruiterA, `delete from public.applications where id = $1`, [
          migratedAppId,
        ]),
      ).rejects.toThrow(/cannot be deleted/i);
    } finally {
      await client.query(`drop policy if exists tmp_app_delete on public.applications`);
    }

    const { rows } = await client.query(`select id from public.applications where id = $1`, [
      migratedAppId,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("still allows the candidate to READ it", async () => {
    const result = await commitAs(
      client,
      ids.candidate1,
      `select id, is_migrated_readonly from public.applications where id = $1`,
      [migratedAppId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.is_migrated_readonly).toBe(true);
  });

  it("still allows a recruiter to READ it", async () => {
    const result = await commitAs(
      client,
      ids.recruiterA,
      `select id from public.applications where id = $1`,
      [migratedAppId],
    );
    expect(result.rows).toHaveLength(1);
  });

  it("leaves ordinary non-migrated applications fully editable", async () => {
    // The guard must be scoped to migrated rows only; a WHEN clause regression
    // that fired for every row would freeze the live pipeline.
    await asImporter(
      client,
      `update public.applications set is_migrated_readonly = false where id = $1`,
      [migratedAppId],
    );
    await expect(
      commitAs(
        client,
        ids.recruiterA,
        `update public.applications set priority = 'high' where id = $1`,
        [migratedAppId],
      ),
    ).resolves.toBeDefined();

    await asImporter(
      client,
      `update public.applications set is_migrated_readonly = true where id = $1`,
      [migratedAppId],
    );
  });

  it("lets trusted server-side code still write, so history can be corrected", async () => {
    // The importer must never be locked out of the rows it owns.
    await expect(
      asImporter(client, `update public.applications set next_action = 'reimport' where id = $1`, [
        migratedAppId,
      ]),
    ).resolves.toBeDefined();
  });

  it("blocks an untrusted direct connection that has not set the GUC", async () => {
    // auth.role() is unset outside PostgREST; the guard must fail closed there
    // rather than treating "no claims" as "trusted".
    await expect(
      client.query(`update public.applications set next_action = 'sneaky' where id = $1`, [
        migratedAppId,
      ]),
    ).rejects.toThrow(/migrated historical data/i);
  });

  it("protects migrated stage history from edits", async () => {
    await asImporter(
      client,
      `insert into public.application_stage_history (application_id, to_stage, source)
       values ($1, 'cv_review', 'zoho_migration')`,
      [migratedAppId],
    );
    const { rows } = await client.query(
      `select id from public.application_stage_history
       where application_id = $1 and source = 'zoho_migration' limit 1`,
      [migratedAppId],
    );
    const historyId = rows[0]!.id;

    // Staff hold an UPDATE policy on stage history, so this genuinely reaches
    // the trigger rather than being filtered out by RLS.
    await expect(
      client.query(`update public.application_stage_history set to_stage = 'hired' where id = $1`, [
        historyId,
      ]),
    ).rejects.toThrow(/migrated historical data/i);
  });

  it("does not expose the guard functions to client roles", async () => {
    // Trigger-only functions must never be callable over PostgREST.
    for (const fn of [
      "tg_block_migrated_record_writes",
      "tg_block_migrated_stage_history_writes",
    ]) {
      const { rows } = await client.query(
        `select has_function_privilege('anon', 'public.${fn}()', 'EXECUTE') as anon,
                has_function_privilege('authenticated', 'public.${fn}()', 'EXECUTE') as auth`,
      );
      expect(rows[0]!.anon, `${fn} executable by anon`).toBe(false);
      expect(rows[0]!.auth, `${fn} executable by authenticated`).toBe(false);
    }
  });
});
