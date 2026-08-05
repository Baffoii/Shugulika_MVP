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

  it("keeps the privileged event writer private and non-callable", async () => {
    const signature = "private.job_order_record_event(uuid,text,text,text,text,jsonb)";
    const privileges = await client.query(
      `select
         to_regprocedure('public.job_order_record_event(uuid,text,text,text,text,jsonb)') as public_fn,
         to_regprocedure($1) as private_fn,
         has_function_privilege('anon', $1, 'execute') as anon_execute,
         has_function_privilege('authenticated', $1, 'execute') as authenticated_execute`,
      [signature],
    );

    expect(privileges.rows[0]?.public_fn).toBeNull();
    expect(privileges.rows[0]?.private_fn).not.toBeNull();
    expect(privileges.rows[0]?.anon_execute).toBe(false);
    expect(privileges.rows[0]?.authenticated_execute).toBe(false);

    for (const privateSignature of [
      "private.job_order_invalidate_related_approval(uuid,text,text,uuid)",
      "private.job_order_related_material_reapproval()",
    ]) {
      const relatedPrivileges = await client.query(
        `select
           has_function_privilege('anon', $1, 'execute') as anon_execute,
           has_function_privilege('authenticated', $1, 'execute') as authenticated_execute`,
        [privateSignature],
      );
      expect(relatedPrivileges.rows[0]).toMatchObject({
        anon_execute: false,
        authenticated_execute: false,
      });
    }

    await expect(
      queryAs(
        client,
        ids.recruiterA,
        `select private.job_order_record_event(
           $1, 'draft', 'active', 'forged', null, '{}'::jsonb
         )`,
        [ids.jobOrderA],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("allows change requests only through the checked workflow RPC", async () => {
    const jobOrderId = (
      await commitAs(
        client,
        ids.employerUserA,
        `insert into public.job_orders (
           employer_org_id, responsible_org_id, title, description, country_code,
           vacancy_count, recruitment_path, status, origin, created_by
         ) values ($1, $2, 'Change Request Role', 'Original.', 'TZ', 1, 'B',
                   'submitted_to_shugulika', 'employer_online', $3)
         returning id`,
        [ids.employerA, ids.franchiseA, ids.employerUserA],
      )
    ).rows[0]?.id as string;

    const requested = await commitAs(
      client,
      ids.recruiterA,
      `select public.request_job_order_changes(
         $1, 'Please clarify the benefits package.', '["benefits"]'::jsonb
       ) as id`,
      [jobOrderId],
    );
    const requestId = requested.rows[0]?.id as string;

    const privileges = await client.query(
      `select
         has_table_privilege('authenticated', 'public.job_order_change_requests', 'insert') as can_insert,
         has_table_privilege('authenticated', 'public.job_order_change_requests', 'update') as can_update`,
    );
    expect(privileges.rows[0]).toMatchObject({ can_insert: false, can_update: false });

    await expect(
      commitAs(
        client,
        ids.employerUserA,
        `update public.job_order_change_requests
         set status = 'cancelled', resolved_at = now()
         where id = $1`,
        [requestId],
      ),
    ).rejects.toThrow(/permission denied/i);

    await commitAs(
      client,
      ids.employerUserA,
      `update public.job_orders set benefits = 'Medical cover' where id = $1`,
      [jobOrderId],
    );
    await commitAs(client, ids.employerUserA, "select public.submit_job_order_to_shugulika($1)", [
      jobOrderId,
    ]);

    const addressed = await queryAs(
      client,
      ids.employerUserA,
      `select status, resolved_at from public.job_order_change_requests where id = $1`,
      [requestId],
    );
    expect(addressed.rows[0]?.status).toBe("addressed");
    expect(addressed.rows[0]?.resolved_at).toBeTruthy();
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
           employer_org_id, responsible_org_id, title, department, description,
           responsibilities, requirements, country_code, employment_type,
           work_arrangement, experience_level, salary_public, benefits,
           vacancy_count, recruitment_path, is_confidential, target_start_date,
           status, origin, created_by
         ) values ($1, $2, 'Material Role', 'Finance', 'Original desc.',
                   'Own the close.', 'CPA required.', 'TZ', 'full_time',
                   'hybrid', 'senior', true, 'Medical cover',
                   1, 'B', true, '2026-10-01',
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
      `select status, approved_snapshot, approved_snapshot_hash
       from public.job_orders where id = $1`,
      [jobOrderId],
    );
    expect(approved.rows[0]?.status).toBe("approved_by_shugulika");
    expect(approved.rows[0]?.approved_snapshot_hash).toBeTruthy();
    expect(approved.rows[0]?.approved_snapshot).toMatchObject({
      employer_org_id: ids.employerA,
      responsible_org_id: ids.franchiseA,
      origin: "employer_online",
      department: "Finance",
      responsibilities: "Own the close.",
      employment_type: "full_time",
      work_arrangement: "hybrid",
      experience_level: "senior",
      salary_public: true,
      benefits: "Medical cover",
      is_confidential: true,
      target_start_date: "2026-10-01",
    });

    await commitAs(
      client,
      ids.recruiterA,
      `update public.job_orders set benefits = 'Medical and dental cover', updated_at = now()
       where id = $1`,
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

  it("snapshots assessment configuration and invalidates approval on related-record edits", async () => {
    const jobOrderId = (
      await commitAs(
        client,
        ids.employerUserA,
        `insert into public.job_orders (
           employer_org_id, responsible_org_id, title, description, country_code,
           vacancy_count, recruitment_path, status, origin, created_by,
           assessment_mode, assessment_seniority, assessment_pass_threshold,
           assessment_file_bucket, assessment_file_path, assessment_file_name,
           assessment_file_mime, assessment_file_size
         ) values ($1, $2, 'Assessment Snapshot Role', 'Test the complete snapshot.', 'TZ',
                   1, 'B', 'submitted_to_shugulika', 'employer_online', $3,
                   'both', 'senior', 70,
                   'employer-assessments', 'legacy/test.pdf', 'test.pdf',
                   'application/pdf', 1234)
         returning id`,
        [ids.employerA, ids.franchiseA, ids.employerUserA],
      )
    ).rows[0]?.id as string;

    const questionId = (
      await commitAs(
        client,
        ids.recruiterA,
        `insert into public.job_screening_questions
           (job_order_id, prompt, qtype, options, is_required, ordinal)
         values ($1, 'Can you close the monthly books?', 'boolean', '[true,false]'::jsonb, true, 1)
         returning id`,
        [jobOrderId],
      )
    ).rows[0]?.id as string;

    const assessmentFileId = (
      await commitAs(
        client,
        ids.employerUserA,
        `insert into public.job_order_assessment_files
           (job_order_id, kind, bucket_id, object_path, file_name, mime_type, byte_size, uploaded_by)
         values ($1, 'candidate_test', 'employer-assessments',
                 'snapshot/candidate-test.pdf', 'candidate-test.pdf',
                 'application/pdf', 4321, $2)
         returning id`,
        [jobOrderId, ids.employerUserA],
      )
    ).rows[0]?.id as string;

    await commitAs(client, ids.recruiterA, "select public.approve_job_order_by_shugulika($1)", [
      jobOrderId,
    ]);

    const approved = await queryAs(
      client,
      ids.recruiterA,
      `select approved_snapshot from public.job_orders where id = $1`,
      [jobOrderId],
    );
    expect(approved.rows[0]?.approved_snapshot).toMatchObject({
      assessment_mode: "both",
      assessment_seniority: "senior",
      assessment_pass_threshold: 70,
      assessment_file_bucket: "employer-assessments",
      assessment_file_path: "legacy/test.pdf",
      assessment_file_name: "test.pdf",
      assessment_file_mime: "application/pdf",
      assessment_file_size: 1234,
      assessment_files: [
        {
          id: assessmentFileId,
          kind: "candidate_test",
          object_path: "snapshot/candidate-test.pdf",
          file_name: "candidate-test.pdf",
        },
      ],
      screening_questions: [
        {
          id: questionId,
          prompt: "Can you close the monthly books?",
          qtype: "boolean",
          is_required: true,
          ordinal: 1,
        },
      ],
    });

    await commitAs(
      client,
      ids.recruiterA,
      `update public.job_screening_questions
       set prompt = 'Can you independently close the monthly books?'
       where id = $1`,
      [questionId],
    );

    const questionReset = await queryAs(
      client,
      ids.recruiterA,
      `select status, approved_snapshot, approved_snapshot_hash
       from public.job_orders where id = $1`,
      [jobOrderId],
    );
    expect(questionReset.rows[0]).toMatchObject({
      status: "submitted_to_shugulika",
      approved_snapshot: null,
      approved_snapshot_hash: null,
    });

    await commitAs(client, ids.recruiterA, "select public.approve_job_order_by_shugulika($1)", [
      jobOrderId,
    ]);
    await commitAs(
      client,
      ids.employerUserA,
      `delete from public.job_order_assessment_files where id = $1`,
      [assessmentFileId],
    );

    const fileReset = await queryAs(
      client,
      ids.recruiterA,
      `select status, approved_snapshot_hash from public.job_orders where id = $1`,
      [jobOrderId],
    );
    expect(fileReset.rows[0]).toMatchObject({
      status: "submitted_to_shugulika",
      approved_snapshot_hash: null,
    });

    const relatedEvents = await queryAs(
      client,
      ids.recruiterA,
      `select metadata->>'related_table' as related_table
       from public.job_order_events
       where job_order_id = $1
         and event_type = 'material_edit_reapproval'
         and metadata ? 'related_table'`,
      [jobOrderId],
    );
    expect(relatedEvents.rows.map((row) => row.related_table)).toEqual(
      expect.arrayContaining(["job_screening_questions", "job_order_assessment_files"]),
    );
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
