/**
 * Source-aware dual-approval gates for job_orders.
 * Requires DATABASE_URL (same harness as rls.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { commitAs, connect, hasDb, queryAs, setupDb, type SeedIds } from "./helpers";

const describeDb = hasDb ? describe : describe.skip;

describeDb("job order approval workflow", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  it("rejects offline publish without employer approval", async () => {
    const draftId = (
      await commitAs(
        client,
        ids.recruiterA,
        `select public.create_offline_job_order_draft(
           $1, 'Offline CFO', 'TZ', 'Lead finance.', 'CPA preferred.', 'Dar', 1, 'B'
         ) as id`,
        [ids.employerA],
      )
    ).rows[0]?.id as string;

    await commitAs(client, ids.recruiterA, "select public.submit_job_order_to_shugulika($1)", [
      draftId,
    ]);

    const awaiting = await queryAs(
      client,
      ids.recruiterA,
      `select status, origin from public.job_orders where id = $1`,
      [draftId],
    );
    expect(awaiting.rows[0]).toMatchObject({
      status: "awaiting_employer_approval",
      origin: "shugulika_offline",
    });

    await expect(
      queryAs(client, ids.recruiterA, "select public.publish_job_order($1)", [draftId]),
    ).rejects.toThrow(/employer approval/i);
  });

  it("rejects online publish without Shugulika approval", async () => {
    const jobOrderId = (
      await commitAs(
        client,
        ids.employerUserA,
        `insert into public.job_orders (
           employer_org_id, responsible_org_id, title, description, country_code,
           vacancy_count, recruitment_path, status, origin, created_by
         ) values ($1, $2, 'Online Controller', 'Close books.', 'TZ', 1, 'B',
                   'submitted_to_shugulika', 'employer_online', $3)
         returning id`,
        [ids.employerA, ids.franchiseA, ids.employerUserA],
      )
    ).rows[0]?.id as string;

    await expect(
      queryAs(client, ids.recruiterA, "select public.publish_job_order($1)", [jobOrderId]),
    ).rejects.toThrow(/Shugulika approval/i);
  });

  it("denies cross-org approve and publish", async () => {
    const jobOrderId = (
      await commitAs(
        client,
        ids.employerUserA,
        `insert into public.job_orders (
           employer_org_id, responsible_org_id, title, description, country_code,
           vacancy_count, recruitment_path, status, origin, created_by
         ) values ($1, $2, 'Scoped Role', 'Scoped.', 'TZ', 1, 'B',
                   'submitted_to_shugulika', 'employer_online', $3)
         returning id`,
        [ids.employerA, ids.franchiseA, ids.employerUserA],
      )
    ).rows[0]?.id as string;

    await expect(
      queryAs(client, ids.recruiterB, "select public.approve_job_order_by_shugulika($1)", [
        jobOrderId,
      ]),
    ).rejects.toThrow();

    await commitAs(client, ids.recruiterA, "select public.approve_job_order_by_shugulika($1)", [
      jobOrderId,
    ]);

    await expect(
      queryAs(client, ids.recruiterB, "select public.publish_job_order($1)", [jobOrderId]),
    ).rejects.toThrow();
  });

  it("material edit resets approval and writes job_order_events", async () => {
    const jobOrderId = (
      await commitAs(
        client,
        ids.employerUserA,
        `insert into public.job_orders (
           employer_org_id, responsible_org_id, title, description, country_code,
           vacancy_count, recruitment_path, status, origin, created_by
         ) values ($1, $2, 'Material Role', 'Original desc.', 'TZ', 1, 'B',
                   'submitted_to_shugulika', 'employer_online', $3)
         returning id`,
        [ids.employerA, ids.franchiseA, ids.employerUserA],
      )
    ).rows[0]?.id as string;

    await commitAs(client, ids.recruiterA, "select public.approve_job_order_by_shugulika($1)", [
      jobOrderId,
    ]);

    const approved = await queryAs(
      client,
      ids.recruiterA,
      `select status, approved_snapshot_hash from public.job_orders where id = $1`,
      [jobOrderId],
    );
    expect(approved.rows[0]?.status).toBe("approved_by_shugulika");
    expect(approved.rows[0]?.approved_snapshot_hash).toBeTruthy();

    await commitAs(
      client,
      ids.recruiterA,
      `update public.job_orders set title = 'Material Role Revised', updated_at = now() where id = $1`,
      [jobOrderId],
    );

    const reset = await queryAs(
      client,
      ids.recruiterA,
      `select status, approved_snapshot_hash from public.job_orders where id = $1`,
      [jobOrderId],
    );
    expect(reset.rows[0]).toMatchObject({
      status: "submitted_to_shugulika",
      approved_snapshot_hash: null,
    });

    const events = await queryAs(
      client,
      ids.recruiterA,
      `select event_type, from_status, to_status
       from public.job_order_events
       where job_order_id = $1 and event_type = 'material_edit_reapproval'
       order by occurred_at desc
       limit 1`,
      [jobOrderId],
    );
    expect(events.rows[0]).toMatchObject({
      event_type: "material_edit_reapproval",
      from_status: "approved_by_shugulika",
      to_status: "submitted_to_shugulika",
    });
  });

  it("employer cannot call publish_job_order", async () => {
    const jobOrderId = (
      await commitAs(
        client,
        ids.employerUserA,
        `insert into public.job_orders (
           employer_org_id, responsible_org_id, title, description, country_code,
           vacancy_count, recruitment_path, status, origin, created_by
         ) values ($1, $2, 'Employer Publish Block', 'Blocked.', 'TZ', 1, 'B',
                   'submitted_to_shugulika', 'employer_online', $3)
         returning id`,
        [ids.employerA, ids.franchiseA, ids.employerUserA],
      )
    ).rows[0]?.id as string;

    await commitAs(client, ids.recruiterA, "select public.approve_job_order_by_shugulika($1)", [
      jobOrderId,
    ]);

    await expect(
      queryAs(client, ids.employerUserA, "select public.publish_job_order($1)", [jobOrderId]),
    ).rejects.toThrow(/cannot publish|authorized staff/i);
  });

  it("offline path: employer approve then staff publish", async () => {
    const draftId = (
      await commitAs(
        client,
        ids.recruiterA,
        `select public.create_offline_job_order_draft(
           $1, 'Offline Counsel', 'TZ', 'Legal lead.', null, 'Arusha', 1, 'B'
         ) as id`,
        [ids.employerA],
      )
    ).rows[0]?.id as string;

    await commitAs(client, ids.recruiterA, "select public.submit_job_order_to_shugulika($1)", [
      draftId,
    ]);
    await commitAs(client, ids.employerUserA, "select public.approve_job_order_by_employer($1)", [
      draftId,
    ]);
    await commitAs(client, ids.recruiterA, "select public.publish_job_order($1)", [draftId]);

    const published = await queryAs(
      client,
      ids.recruiterA,
      `select jo.status job_order_status, j.status publication_status, jo.origin
       from public.job_orders jo join public.jobs j on j.job_order_id = jo.id
       where jo.id = $1`,
      [draftId],
    );
    expect(published.rows[0]).toMatchObject({
      job_order_status: "active",
      publication_status: "advertised",
      origin: "shugulika_offline",
    });
  });
});
