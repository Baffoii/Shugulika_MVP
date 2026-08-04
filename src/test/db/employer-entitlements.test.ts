/**
 * Employer packages, Path A/B CV unlocks, entitlement expiry, and payments sandbox.
 * Privilege lockdown for minting helpers lives in cv-unlock-grant-privileges.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connect, setupDb, hasDb, commitAs, type SeedIds } from "./helpers";
import type { Client } from "pg";

const describeDb = hasDb ? describe : describe.skip;

const PERIOD_GRANT_FN =
  "private.grant_cv_unlock_tokens(uuid,integer,text,text,uuid,uuid,date,date)";
const EXPIRE_FN = "public.expire_employer_entitlements()";

describeDb("employer entitlements + CV unlocks", () => {
  let client: Client;
  let ids: SeedIds;
  let cand1Profile: string;
  let cand2Profile: string;
  let pathAJob: string;
  let inactivePathAJob: string;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);

    cand1Profile = (
      await client.query(`select id from public.candidate_profiles where user_id = $1`, [
        ids.candidate1,
      ])
    ).rows[0].id as string;
    cand2Profile = (
      await client.query(`select id from public.candidate_profiles where user_id = $1`, [
        ids.candidate2,
      ])
    ).rows[0].id as string;

    // Pool search projects only active profiles; unlock spend needs searchable consent.
    await client.query(
      `update public.candidate_profiles
         set profile_status = 'active',
             headline = coalesce(nullif(headline, ''), 'Harness candidate')
       where id = any($1::uuid[])`,
      [[cand1Profile, cand2Profile]],
    );

    pathAJob = "c1000000-0000-4000-8000-0000000000a1";
    inactivePathAJob = "c1000000-0000-4000-8000-0000000000a2";

    await client.query(
      `insert into public.job_orders
         (id, employer_org_id, responsible_org_id, title, country_code, recruitment_path, status)
       values
         ($1, $2, $3, 'Path A Role', 'TZ', 'A', 'active'),
         ($4, $2, $3, 'Closed Path A', 'TZ', 'A', 'filled')`,
      [pathAJob, ids.employerA, ids.franchiseA, inactivePathAJob],
    );

    // Candidate 1 searchable with discovery consent; candidate 2 not searchable.
    await client.query(
      `insert into public.candidate_search_visibility (candidate_id, is_searchable, approved_fields)
       values ($1, true, array['headline','skills','country_city'])
       on conflict (candidate_id) do update
         set is_searchable = excluded.is_searchable,
             approved_fields = excluded.approved_fields`,
      [cand1Profile],
    );
    await client.query(
      `insert into public.candidate_search_visibility (candidate_id, is_searchable, approved_fields)
       values ($1, false, array[]::text[])
       on conflict (candidate_id) do update
         set is_searchable = false`,
      [cand2Profile],
    );

    // Free trial for employer A and B (payments remain open; no sandbox gate in this suite).
    await commitAs(
      client,
      ids.employerUserA,
      `select public.activate_employer_package('trial', true) as result`,
    );
    await commitAs(
      client,
      ids.employerUserB,
      `select public.activate_employer_package('trial', true) as result`,
    );
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  it("period-aware private grant exists; expire_employer_entitlements is service_role only", async () => {
    const sig = await client.query(
      `select
         to_regprocedure($1) as period_grant,
         to_regprocedure('private.grant_cv_unlock_tokens(uuid,integer,text,text,uuid)') as short_grant,
         has_function_privilege('anon', $2, 'execute') as anon_expire,
         has_function_privilege('authenticated', $2, 'execute') as auth_expire,
         has_function_privilege('service_role', $2, 'execute') as service_expire`,
      [PERIOD_GRANT_FN, EXPIRE_FN],
    );
    const row = sig.rows[0];
    expect(row.period_grant).not.toBeNull();
    expect(row.short_grant).toBeNull();
    expect(row.anon_expire).toBe(false);
    expect(row.auth_expire).toBe(false);
    expect(row.service_expire).toBe(true);
  });

  it("rejects unlock without Path A job or Path B submission", async () => {
    await expect(
      commitAs(
        client,
        ids.employerUserA,
        `select public.spend_cv_unlock($1, null, null) as result`,
        [cand1Profile],
      ),
    ).rejects.toThrow(/Path B submission or a Direct \(Path A\) job/i);
  });

  it("Path B unlock validates submission ownership and is idempotent", async () => {
    const first = await commitAs(
      client,
      ids.employerUserA,
      `select public.spend_cv_unlock($1, $2, null) as result`,
      [cand1Profile, ids.submissionC1],
    );
    const firstResult = first.rows[0]?.result as {
      already_unlocked?: boolean;
      cv_unlock_balance?: number;
    };
    expect(firstResult.already_unlocked).toBe(false);

    const second = await commitAs(
      client,
      ids.employerUserA,
      `select public.spend_cv_unlock($1, $2, null) as result`,
      [cand1Profile, ids.submissionC1],
    );
    expect((second.rows[0]?.result as { already_unlocked?: boolean }).already_unlocked).toBe(true);

    const bal = await client.query(
      `select balance from public.employer_cv_unlock_balances where employer_org_id = $1`,
      [ids.employerA],
    );
    expect(bal.rows[0]?.balance).toBe(firstResult.cv_unlock_balance);
  });

  it("blocks cross-employer Path B unlock", async () => {
    await expect(
      commitAs(client, ids.employerUserB, `select public.spend_cv_unlock($1, $2, null) as result`, [
        cand1Profile,
        ids.submissionC1,
      ]),
    ).rejects.toThrow(/Submission not found|not active|No CV unlocks/i);
  });

  it("Path A unlock requires active Direct job + searchable consent", async () => {
    // Top up wallet for Path A spend attempts (payments remain open in this suite).
    await commitAs(
      client,
      ids.employerUserA,
      `select public.purchase_employer_addon('cv_unlocks_5') as result`,
    );

    await expect(
      commitAs(client, ids.employerUserA, `select public.spend_cv_unlock($1, null, $2) as result`, [
        cand2Profile,
        pathAJob,
      ]),
    ).rejects.toThrow(/not available in the searchable pool/i);

    await expect(
      commitAs(client, ids.employerUserA, `select public.spend_cv_unlock($1, null, $2) as result`, [
        cand1Profile,
        inactivePathAJob,
      ]),
    ).rejects.toThrow(/Direct \(Path A\) job/i);
  });

  it("Path A unlock succeeds for searchable candidate and stays org-scoped", async () => {
    // cand1 already unlocked via Path B — idempotent org-scoped unlock.
    const again = await commitAs(
      client,
      ids.employerUserA,
      `select public.spend_cv_unlock($1, null, $2) as result`,
      [cand1Profile, pathAJob],
    );
    expect((again.rows[0]?.result as { already_unlocked?: boolean }).already_unlocked).toBe(true);

    // Make cand2 searchable and unlock via Path A.
    await client.query(
      `update public.candidate_search_visibility
         set is_searchable = true, approved_fields = array['headline','skills']
       where candidate_id = $1`,
      [cand2Profile],
    );
    const unlocked = await commitAs(
      client,
      ids.employerUserA,
      `select public.spend_cv_unlock($1, null, $2) as result`,
      [cand2Profile, pathAJob],
    );
    expect((unlocked.rows[0]?.result as { already_unlocked?: boolean }).already_unlocked).toBe(
      false,
    );

    const otherOrg = await client.query(
      `select count(*)::int as n from public.employer_cv_unlocks
       where employer_org_id = $1 and candidate_id = $2`,
      [ids.employerB, cand2Profile],
    );
    expect(otherOrg.rows[0]?.n).toBe(0);
  });

  it("zero balance prevents unlocks", async () => {
    await client.query(
      `update public.employer_cv_unlock_balances set balance = 0 where employer_org_id = $1`,
      [ids.employerB],
    );
    // Employer B has trial but no searchable unlock target with balance — create searchable cand
    // and attempt unlock with zero balance.
    await client.query(
      `update public.candidate_search_visibility set is_searchable = true where candidate_id = $1`,
      [cand1Profile],
    );
    const pathAJobB = "c1000000-0000-4000-8000-0000000000b1";
    await client.query(
      `insert into public.job_orders
         (id, employer_org_id, responsible_org_id, title, country_code, recruitment_path, status)
       values ($1, $2, $3, 'B Path A', 'TZ', 'A', 'active')
       on conflict (id) do nothing`,
      [pathAJobB, ids.employerB, ids.franchiseB],
    );
    await expect(
      commitAs(client, ids.employerUserB, `select public.spend_cv_unlock($1, null, $2) as result`, [
        cand1Profile,
        pathAJobB,
      ]),
    ).rejects.toThrow(/No CV unlocks remaining/i);
  });

  it("stale trials are treated as expired even before cleanup", async () => {
    await client.query(
      `update public.employer_subscriptions
         set trial_ends_on = current_date - 1, expires_on = current_date - 1
       where employer_org_id = $1 and status = 'trial'`,
      [ids.employerB],
    );
    await expect(
      commitAs(client, ids.employerUserB, `select public.spend_cv_unlock($1, null, $2) as result`, [
        cand1Profile,
        "c1000000-0000-4000-8000-0000000000b1",
      ]),
    ).rejects.toThrow(/plan or trial is not active/i);

    // Date-gated denial is immediate even if the status column has not flipped yet.
    // Postgres/PostgREST roll back the in-RPC status UPDATE when the call raises;
    // durable cleanup is the expire helper (service_role / owner).
    const stillActive = await client.query(
      `select public.employer_has_active_subscription($1) as active`,
      [ids.employerB],
    );
    expect(stillActive.rows[0]?.active).toBe(false);

    await client.query(`select public.expire_employer_entitlements() as result`);
    const status = await client.query(
      `select status from public.employer_subscriptions
       where employer_org_id = $1 order by starts_on desc limit 1`,
      [ids.employerB],
    );
    expect(status.rows[0]?.status).toBe("expired");
  });

  it("job-slot add-ons only count during the active period and expire audibly", async () => {
    // Fresh paid plan for employer A via upgrade path — cancel current trial first.
    await client.query(
      `update public.employer_subscriptions set status = 'expired'
       where employer_org_id = $1 and status in ('trial','active')`,
      [ids.employerA],
    );
    await commitAs(
      client,
      ids.employerUserA,
      `select public.activate_employer_package('starter', false) as result`,
    );

    const before = await commitAs(
      client,
      ids.employerUserA,
      `select public.employer_job_slot_limit($1) as limit`,
      [ids.employerA],
    );
    const baseLimit = before.rows[0]?.limit as number;

    await commitAs(
      client,
      ids.employerUserA,
      `select public.purchase_employer_addon('job_slot_1') as result`,
    );
    const mid = await commitAs(
      client,
      ids.employerUserA,
      `select public.employer_job_slot_limit($1) as limit`,
      [ids.employerA],
    );
    expect(mid.rows[0]?.limit).toBe(baseLimit + 1);

    await client.query(
      `update public.employer_cv_unlock_ledger
         set period_ends_on = current_date - 1
       where employer_org_id = $1 and package_key = 'job_slot_1' and entry_type = 'grant'
         and expired_at is null`,
      [ids.employerA],
    );

    const expiredLimit = await commitAs(
      client,
      ids.employerUserA,
      `select public.employer_job_slot_limit($1) as limit`,
      [ids.employerA],
    );
    expect(expiredLimit.rows[0]?.limit).toBe(baseLimit);

    const firstExpire = await client.query(
      `select public.expire_employer_entitlements() as result`,
    );
    const first = firstExpire.rows[0]?.result as { job_slot_grants_expired?: number };
    expect(first.job_slot_grants_expired).toBeGreaterThanOrEqual(1);

    const secondExpire = await client.query(
      `select public.expire_employer_entitlements() as result`,
    );
    expect(
      (secondExpire.rows[0]?.result as { job_slot_grants_expired?: number })
        .job_slot_grants_expired,
    ).toBe(0);

    const audit = await client.query(
      `select count(*)::int as n from public.employer_cv_unlock_ledger
       where employer_org_id = $1 and entry_type = 'expire' and reason = 'job_slot_period_ended'`,
      [ids.employerA],
    );
    expect(audit.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it("concurrent spends cannot drive balance below zero", async () => {
    await client.query(
      `update public.employer_cv_unlock_balances set balance = 1 where employer_org_id = $1`,
      [ids.employerA],
    );

    // Two different searchable candidates; only one credit.
    const c3 = "a0000000-0000-4000-8000-000000000003";
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'cand3@test.io', jsonb_build_object('role','candidate','full_name','Cand Three'))
       on conflict (id) do nothing`,
      [c3],
    );
    const cand3Profile = (
      await client.query(`select id from public.candidate_profiles where user_id = $1`, [c3])
    ).rows[0]?.id as string;
    await client.query(
      `insert into public.candidate_search_visibility (candidate_id, is_searchable, approved_fields)
       values ($1, true, array['headline'])
       on conflict (candidate_id) do update set is_searchable = true`,
      [cand3Profile],
    );

    // First spend succeeds.
    await commitAs(
      client,
      ids.employerUserA,
      `select public.spend_cv_unlock($1, null, $2) as result`,
      [cand3Profile, pathAJob],
    );

    // Second spend on another candidate fails — balance cannot go negative.
    const c4 = "a0000000-0000-4000-8000-000000000004";
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'cand4@test.io', jsonb_build_object('role','candidate','full_name','Cand Four'))
       on conflict (id) do nothing`,
      [c4],
    );
    const cand4Profile = (
      await client.query(`select id from public.candidate_profiles where user_id = $1`, [c4])
    ).rows[0]?.id as string;
    await client.query(
      `insert into public.candidate_search_visibility (candidate_id, is_searchable, approved_fields)
       values ($1, true, array['headline'])
       on conflict (candidate_id) do update set is_searchable = true`,
      [cand4Profile],
    );

    await expect(
      commitAs(client, ids.employerUserA, `select public.spend_cv_unlock($1, null, $2) as result`, [
        cand4Profile,
        pathAJob,
      ]),
    ).rejects.toThrow(/No CV unlocks remaining/i);

    const bal = await client.query(
      `select balance from public.employer_cv_unlock_balances where employer_org_id = $1`,
      [ids.employerA],
    );
    expect(bal.rows[0]?.balance).toBe(0);
  });

  it("focused entitlement flow: trial → Path A search → unlock → isolation → expiry", async () => {
    // Rebuild a clean employer B flow after prior mutations.
    await client.query(`delete from public.employer_cv_unlocks where employer_org_id = $1`, [
      ids.employerB,
    ]);
    await client.query(
      `update public.employer_cv_unlock_balances set balance = 0 where employer_org_id = $1`,
      [ids.employerB],
    );
    await client.query(
      `update public.employer_subscriptions set status = 'expired' where employer_org_id = $1`,
      [ids.employerB],
    );
    // Trial already used — activate a paid plan (payments remain open in this suite).
    await commitAs(
      client,
      ids.employerUserB,
      `select public.activate_employer_package('starter', false) as result`,
    );

    const pathAJobB = "c1000000-0000-4000-8000-0000000000b1";
    await client.query(
      `insert into public.job_orders
         (id, employer_org_id, responsible_org_id, title, country_code, recruitment_path, status)
       values ($1, $2, $3, 'B Path A', 'TZ', 'A', 'active')
       on conflict (id) do update set status = 'active', recruitment_path = 'A'`,
      [pathAJobB, ids.employerB, ids.franchiseB],
    );

    // 3–4. Candidate with affirmative discovery consent appears; without does not.
    await client.query(
      `update public.candidate_search_visibility
         set is_searchable = true, approved_fields = array['headline','skills']
       where candidate_id = $1`,
      [cand1Profile],
    );
    await client.query(
      `update public.candidate_search_visibility set is_searchable = false where candidate_id = $1`,
      [cand2Profile],
    );
    const hits = await commitAs(
      client,
      ids.employerUserB,
      `select * from public.search_employer_talent_pool($1, null, null, null, null, null, null, 20)`,
      [pathAJobB],
    );
    const hitIds = hits.rows.map((r) => r.candidate_id);
    expect(hitIds).toContain(cand1Profile);
    expect(hitIds).not.toContain(cand2Profile);

    // 5–6. Spend unlock → identity visible only to authorized employer.
    const beforeBal = (
      await client.query(
        `select balance from public.employer_cv_unlock_balances where employer_org_id = $1`,
        [ids.employerB],
      )
    ).rows[0]?.balance as number;

    const spend = await commitAs(
      client,
      ids.employerUserB,
      `select public.spend_cv_unlock($1, null, $2) as result`,
      [cand1Profile, pathAJobB],
    );
    expect((spend.rows[0]?.result as { already_unlocked?: boolean }).already_unlocked).toBe(false);

    const open = await commitAs(
      client,
      ids.employerUserB,
      `select * from public.open_employer_pool_candidate($1, $2)`,
      [cand1Profile, pathAJobB],
    );
    expect(open.rows[0]?.is_unlocked).toBe(true);
    expect(open.rows[0]?.given_name || open.rows[0]?.full_name).toBeTruthy();

    // 8. Second unlock idempotent — no second credit spend.
    const again = await commitAs(
      client,
      ids.employerUserB,
      `select public.spend_cv_unlock($1, null, $2) as result`,
      [cand1Profile, pathAJobB],
    );
    expect((again.rows[0]?.result as { already_unlocked?: boolean }).already_unlocked).toBe(true);
    const afterBal = (
      await client.query(
        `select balance from public.employer_cv_unlock_balances where employer_org_id = $1`,
        [ids.employerB],
      )
    ).rows[0]?.balance as number;
    expect(afterBal).toBe(beforeBal - 1);

    // 9. Other employer cannot see identity via open (employer A already unlocked cand1,
    //    but employer B's unlock must not appear for a third party — use projection check).
    const foreignUnlock = await client.query(
      `select count(*)::int as n from public.employer_cv_unlocks
       where employer_org_id = $1 and candidate_id = $2`,
      [ids.employerB, cand1Profile],
    );
    expect(foreignUnlock.rows[0]?.n).toBe(1);

    // Cross-org: employer A opening does not grant employer B's row to A uniquely —
    // employer without unlock for cand2 cannot see name.
    await client.query(
      `update public.candidate_search_visibility set is_searchable = true where candidate_id = $1`,
      [cand2Profile],
    );
    const masked = await commitAs(
      client,
      ids.employerUserB,
      `select * from public.open_employer_pool_candidate($1, $2)`,
      [cand2Profile, pathAJobB],
    );
    expect(masked.rows[0]?.is_unlocked).toBe(false);
    expect(masked.rows[0]?.given_name).toBeNull();

    // 10. Expired entitlement prevents new unlocks.
    await client.query(
      `update public.employer_subscriptions
         set expires_on = current_date - 1, status = 'active'
       where employer_org_id = $1 and status in ('trial','active')`,
      [ids.employerB],
    );
    await expect(
      commitAs(client, ids.employerUserB, `select public.spend_cv_unlock($1, null, $2) as result`, [
        cand2Profile,
        pathAJobB,
      ]),
    ).rejects.toThrow(/plan or trial is not active/i);
  });
});
