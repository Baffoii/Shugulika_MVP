/**
 * Privilege lockdown for CV unlock grant helpers (blocker #1).
 * Asserts private minting helpers are not executable by anon/authenticated,
 * and that authorized activate/purchase wrappers still grant credits.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connect, setupDb, hasDb, commitAs, queryAs, type SeedIds } from "./helpers";
import type { Client } from "pg";

const describeDb = hasDb ? describe : describe.skip;

const GRANT_FN = "private.grant_cv_unlock_tokens(uuid,integer,text,text,uuid,uuid,date,date)";
const ENSURE_FN = "private.ensure_cv_unlock_balance(uuid)";
const AI_SCREENS_FN = "public.ai_cv_screens_used(uuid,timestamp with time zone)";
const EXPIRE_FN = "public.expire_stale_employer_trials()";

describeDb("cv unlock grant helper privileges", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  async function balanceOf(orgId: string): Promise<number> {
    const res = await client.query(
      `select coalesce(balance, 0)::int as balance
       from public.employer_cv_unlock_balances where employer_org_id = $1`,
      [orgId],
    );
    return (res.rows[0]?.balance as number) ?? 0;
  }

  it("revokes execute on private minting helpers from anon and authenticated", async () => {
    const priv = await client.query(
      `select
         has_function_privilege('anon', $1, 'execute') as anon_grant,
         has_function_privilege('authenticated', $1, 'execute') as auth_grant,
         has_function_privilege('anon', $2, 'execute') as anon_ensure,
         has_function_privilege('authenticated', $2, 'execute') as auth_ensure,
         to_regprocedure('public.grant_cv_unlock_tokens(uuid,integer,text,text,uuid)') as public_grant,
         to_regprocedure('public.ensure_cv_unlock_balance(uuid)') as public_ensure,
         to_regprocedure($1) as private_grant,
         to_regprocedure($2) as private_ensure,
         has_function_privilege('anon', $3, 'execute') as anon_expire,
         has_function_privilege('authenticated', $3, 'execute') as auth_expire,
         has_function_privilege('service_role', $3, 'execute') as service_expire`,
      [GRANT_FN, ENSURE_FN, EXPIRE_FN],
    );
    const row = priv.rows[0];
    expect(row.anon_grant).toBe(false);
    expect(row.auth_grant).toBe(false);
    expect(row.anon_ensure).toBe(false);
    expect(row.auth_ensure).toBe(false);
    expect(row.public_grant).toBeNull();
    expect(row.public_ensure).toBeNull();
    expect(row.private_grant).not.toBeNull();
    expect(row.private_ensure).not.toBeNull();
    expect(row.anon_expire).toBe(false);
    expect(row.auth_expire).toBe(false);
    expect(row.service_expire).toBe(true);
  });

  it("anon cannot mint CV credits via private.grant_cv_unlock_tokens", async () => {
    const before = await balanceOf(ids.employerA);
    await expect(
      queryAs(
        client,
        null,
        `select private.grant_cv_unlock_tokens($1, 10, 'probe', null, null, null, null, null)`,
        [ids.employerA],
      ),
    ).rejects.toThrow(/permission denied/i);
    expect(await balanceOf(ids.employerA)).toBe(before);
  });

  it("employer cannot mint credits for own or other org via private helpers", async () => {
    const beforeA = await balanceOf(ids.employerA);
    const beforeB = await balanceOf(ids.employerB);

    await expect(
      commitAs(
        client,
        ids.employerUserA,
        `select private.grant_cv_unlock_tokens($1, 10, 'self_mint', null, null, null, null, null)`,
        [ids.employerA],
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      commitAs(
        client,
        ids.employerUserA,
        `select private.grant_cv_unlock_tokens($1, 10, 'cross_org', null, null, null, null, null)`,
        [ids.employerB],
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      commitAs(client, ids.employerUserA, `select private.ensure_cv_unlock_balance($1)`, [
        ids.employerB,
      ]),
    ).rejects.toThrow(/permission denied/i);

    expect(await balanceOf(ids.employerA)).toBe(beforeA);
    expect(await balanceOf(ids.employerB)).toBe(beforeB);
  });

  it("authorized activate_employer_package still grants trial credits", async () => {
    const before = await balanceOf(ids.employerA);
    const activated = await commitAs(
      client,
      ids.employerUserA,
      `select public.activate_employer_package('trial', true) as result`,
    );
    const result = activated.rows[0]?.result as {
      package_key?: string;
      is_trial?: boolean;
      cv_unlock_balance?: number;
    };
    expect(result.package_key).toBe("trial");
    expect(result.is_trial).toBe(true);
    expect(result.cv_unlock_balance).toBeGreaterThan(before);
    expect(await balanceOf(ids.employerA)).toBe(result.cv_unlock_balance);
  });

  it("authorized purchase_employer_addon still grants CV unlock top-ups", async () => {
    const before = await balanceOf(ids.employerA);
    const purchased = await commitAs(
      client,
      ids.employerUserA,
      `select public.purchase_employer_addon('cv_unlocks_5') as result`,
    );
    const result = purchased.rows[0]?.result as {
      addon_key?: string;
      cv_unlock_balance?: number;
    };
    expect(result.addon_key).toBe("cv_unlocks_5");
    expect(result.cv_unlock_balance).toBe(before + 5);
    expect(await balanceOf(ids.employerA)).toBe(before + 5);
  });

  it("ai_cv_screens_used denies anon and cross-tenant metering", async () => {
    const screensPriv = await client.query(
      `select
         has_function_privilege('anon', $1, 'execute') as anon_exec,
         has_function_privilege('authenticated', $1, 'execute') as auth_exec`,
      [AI_SCREENS_FN],
    );
    expect(screensPriv.rows[0].anon_exec).toBe(false);
    expect(screensPriv.rows[0].auth_exec).toBe(true);

    await expect(
      queryAs(client, null, `select public.ai_cv_screens_used($1, now() - interval '30 days')`, [
        ids.employerA,
      ]),
    ).rejects.toThrow(/permission denied/i);

    const cross = await queryAs(
      client,
      ids.employerUserA,
      `select public.ai_cv_screens_used($1, now() - interval '30 days') as used`,
      [ids.employerB],
    );
    expect(cross.rows[0]?.used).toBe(0);

    const own = await queryAs(
      client,
      ids.employerUserA,
      `select public.ai_cv_screens_used($1, now() - interval '30 days') as used`,
      [ids.employerA],
    );
    expect(typeof own.rows[0]?.used).toBe("number");
  });
});
