/**
 * DB-enforced pipeline gates (advance_application / reject_application / stage trigger).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connect, setupDb, hasDb, commitAs, type SeedIds } from "./helpers";
import type { Client } from "pg";

const describeDb = hasDb ? describe : describe.skip;

describeDb("pipeline gates RPC", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  async function advance(
    applicationId: string,
    toStage: string,
    metadata: Record<string, unknown> = {},
    note: string | null = null,
  ) {
    return commitAs(
      client,
      ids.recruiterA,
      `select public.advance_application($1, $2, $3, $4::jsonb) as result`,
      [applicationId, toStage, note, JSON.stringify(metadata)],
    );
  }

  async function reject(applicationId: string, reason: string, note: string | null = null) {
    return commitAs(
      client,
      ids.recruiterA,
      `select public.reject_application($1, $2, $3) as result`,
      [applicationId, reason, note],
    );
  }

  it("blocks direct current_stage updates without the RPC flag", async () => {
    await expect(
      client.query(`update public.applications set current_stage = 'testing' where id = $1`, [
        ids.applicationC1,
      ]),
    ).rejects.toThrow(/advance_application|reject_application|reopen_application/);
  });

  it("requires screening notes before leaving CV Review", async () => {
    await expect(advance(ids.applicationC1, "testing")).rejects.toThrow(/screening notes/i);
  });

  it("advances to testing after a screening note", async () => {
    await client.query(
      `insert into public.recruiter_notes (subject_type, subject_id, owning_org_id, author_id, body)
       values ('application', $1, $2, $3, 'Strong CV — advance to testing')`,
      [ids.applicationC1, ids.franchiseA, ids.recruiterA],
    );

    const res = await advance(ids.applicationC1, "testing", {}, "notes done");
    expect((res.rows[0]?.result as { ok?: boolean })?.ok).toBe(true);

    const stage = await client.query(
      `select current_stage from public.applications where id = $1`,
      [ids.applicationC1],
    );
    expect(stage.rows[0]?.current_stage).toBe("testing");
  });

  it("requires assessment submit or waive for testing → test_review", async () => {
    await expect(
      advance(ids.applicationC1, "test_review", {
        allow_auto: true,
        source: "testing_submitted",
      }),
    ).rejects.toThrow(/Assessment must be submitted/i);

    const waived = await advance(
      ids.applicationC1,
      "test_review",
      {
        allow_auto: true,
        source: "testing_submitted",
        waive_reason: "Manual score",
      },
      "manual",
    );
    expect((waived.rows[0]?.result as { ok?: boolean })?.ok).toBe(true);
  });

  it("requires employer-specific consent before Client Submission", async () => {
    await client.query("begin");
    await client.query(`select set_config('shugulika.stage_rpc', '1', true)`);
    await client.query(
      `update public.applications set current_stage = 'interview_review' where id = $1`,
      [ids.applicationC1],
    );
    await client.query("commit");

    await client.query(
      `update public.candidate_consents set withdrawn_at = now()
       where candidate_id = (select candidate_id from public.applications where id = $1)
         and purpose = 'employer_submission'`,
      [ids.applicationC1],
    );

    await expect(
      advance(ids.applicationC1, "client_submission", {
        waive_reason: "Interview reviewed",
      }),
    ).rejects.toThrow(/Employer-specific consent/i);
  });

  it("rejects without a reason", async () => {
    await expect(reject(ids.applicationC1, "")).rejects.toThrow(/rejection reason/i);
  });

  it("rejects with a reason and blocks further advances", async () => {
    const res = await reject(ids.applicationC1, "Not a fit", "Skills gap");
    expect((res.rows[0]?.result as { ok?: boolean })?.ok).toBe(true);

    const row = await client.query(
      `select current_stage, rejection_reason, rejected_from_stage from public.applications where id = $1`,
      [ids.applicationC1],
    );
    expect(row.rows[0]?.current_stage).toBe("rejected");
    expect(row.rows[0]?.rejection_reason).toBe("Not a fit");

    await expect(advance(ids.applicationC1, "testing")).rejects.toThrow(/rejected/i);
  });

  it("blocks hired without an accepted offer", async () => {
    const job2 = "c1000000-0000-4000-8000-000000000099";
    const app2 = "d1000000-0000-4000-8000-000000000099";
    const cand1Profile = (
      await client.query(`select candidate_id from public.applications where id = $1`, [
        ids.applicationC1,
      ])
    ).rows[0].candidate_id;

    await client.query(
      `insert into public.job_orders (id, employer_org_id, responsible_org_id, title, country_code, recruitment_path, status)
       values ($1,$2,$3,'Second role','TZ','B','active')
       on conflict (id) do nothing`,
      [job2, ids.employerA, ids.franchiseA],
    );
    // INSERT is gated to cv_review unless the stage RPC flag is set.
    await client.query("begin");
    await client.query(`select set_config('shugulika.stage_rpc', '1', true)`);
    await client.query(
      `insert into public.applications (id, candidate_id, job_order_id, owning_org_id, recruitment_path, current_stage, assigned_recruiter_id)
       values ($1,$2,$3,$4,'B','offer',$5)
       on conflict (candidate_id, job_order_id) do update set current_stage = 'offer'`,
      [app2, cand1Profile, job2, ids.franchiseA, ids.recruiterA],
    );
    await client.query("commit");

    await expect(advance(app2, "hired")).rejects.toThrow(/accepted offer/i);
  });

  it("requires placement_id to issue a non-subscription invoice", async () => {
    await expect(
      client.query(
        `insert into public.invoices (invoice_number, owning_org_id, employer_org_id, status, total)
         values ('SHG-TEST-1', $1, $2, 'issued', 100)`,
        [ids.franchiseA, ids.employerA],
      ),
    ).rejects.toThrow(/Placement is required/i);
  });
});
