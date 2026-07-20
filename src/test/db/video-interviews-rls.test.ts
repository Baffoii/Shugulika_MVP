import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { commitAs, connect, hasDb, queryAs, setupDb, type SeedIds } from "./helpers";

const d = hasDb ? describe : describe.skip;

interface InterviewFixture {
  assignmentId: string;
  questionId: string;
  candidateProfileId: string;
  organizationId: string;
}

d("asynchronous video interview database security", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  async function seedInterview({
    status = "in_progress",
    expiresAt = "now() + interval '7 days'",
    maxAttempts = 2,
    required = true,
  }: {
    status?: string;
    expiresAt?: string;
    maxAttempts?: number;
    required?: boolean;
  } = {}): Promise<InterviewFixture> {
    const candidateProfileId = (
      await client.query("select id from public.candidate_profiles where user_id = $1", [
        ids.candidate1,
      ])
    ).rows[0].id as string;
    const templateId = (
      await client.query(
        `insert into public.interview_templates
           (organization_id, name, created_by, default_max_attempts)
         values ($1, 'RLS test template', $2, $3)
         returning id`,
        [ids.franchiseA, ids.recruiterA, maxAttempts],
      )
    ).rows[0].id as string;
    const sourceQuestionId = (
      await client.query(
        `insert into public.interview_template_questions
           (template_id, question_text, display_order, max_attempts, is_required)
         values ($1, 'Describe a recent project.', 1, $2, $3)
         returning id`,
        [templateId, maxAttempts, required],
      )
    ).rows[0].id as string;
    const assignmentId = (
      await client.query(
        `insert into public.interview_assignments
           (template_id, candidate_id, application_id, job_order_id, organization_id,
            assigned_by, status, invited_at, started_at, expires_at,
            consented_at, privacy_notice_version, instructions_version,
            template_name_snapshot)
         values ($1, $2, $3, $4, $5, $6, $7, now() - interval '1 hour',
                 case when $7 = 'in_progress' then now() - interval '10 minutes' end,
                 ${expiresAt},
                 case when $7 = 'in_progress' then now() - interval '10 minutes' end,
                 case when $7 = 'in_progress' then 'test-v1' end,
                 case when $7 = 'in_progress' then 'test-v1' end,
                 'Original template name')
         returning id`,
        [
          templateId,
          candidateProfileId,
          ids.applicationC1,
          ids.jobOrderA,
          ids.franchiseA,
          ids.recruiterA,
          status,
        ],
      )
    ).rows[0].id as string;
    const questionId = (
      await client.query(
        `insert into public.interview_assignment_questions
           (assignment_id, source_template_question_id, question_text_snapshot,
            display_order, preparation_seconds, response_seconds, max_attempts, is_required)
         values ($1, $2, 'Original snapshot question', 1, 30, 120, $3, $4)
         returning id`,
        [assignmentId, sourceQuestionId, maxAttempts, required],
      )
    ).rows[0].id as string;
    return { assignmentId, questionId, candidateProfileId, organizationId: ids.franchiseA };
  }

  function attemptPath(fixture: InterviewFixture, attemptId: string, extension = "webm") {
    return `organization/${fixture.organizationId}/interviews/${fixture.assignmentId}/questions/${fixture.questionId}/attempts/${attemptId}.${extension}`;
  }

  async function seedAttempt(
    fixture: InterviewFixture,
    {
      attemptNumber = 1,
      selected = false,
      uploadStatus = "pending",
      duration = null,
      fileSize = null,
    }: {
      attemptNumber?: number;
      selected?: boolean;
      uploadStatus?: string;
      duration?: number | null;
      fileSize?: number | null;
    } = {},
  ) {
    const attemptId = crypto.randomUUID();
    const storagePath = attemptPath(fixture, attemptId);
    if (uploadStatus === "uploaded") {
      await client.query(
        `insert into storage.objects (bucket_id, name, owner, metadata, created_at, updated_at)
         values ('interview-recordings', $1, $2, jsonb_build_object('size', $3::text), now(), now())`,
        [storagePath, ids.candidate1, fileSize ?? 1024],
      );
    }
    await client.query(
      `insert into public.interview_response_attempts
         (id, assignment_question_id, assignment_id, candidate_id, attempt_number,
          storage_path, upload_status, is_selected_submission, duration_seconds,
          file_size_bytes, recording_started_at, recording_ended_at, uploaded_at)
       values ($1, $2, $3, $4, $5, $6,
               case when $7 = 'uploaded' then 'pending' else $7 end,
               false, $8, $9, now() - interval '30 seconds', now() - interval '5 seconds', null)`,
      [
        attemptId,
        fixture.questionId,
        fixture.assignmentId,
        fixture.candidateProfileId,
        attemptNumber,
        storagePath,
        uploadStatus,
        duration,
        fileSize,
      ],
    );
    if (uploadStatus === "uploaded") {
      await client.query(
        `update public.interview_response_attempts
         set upload_status = 'uploaded',
             is_selected_submission = $2,
             uploaded_at = now(),
             file_size_bytes = coalesce(file_size_bytes, $3)
         where id = $1`,
        [attemptId, selected, fileSize ?? 1024],
      );
    } else if (selected) {
      await client.query(
        `update public.interview_response_attempts
         set is_selected_submission = true
         where id = $1`,
        [attemptId],
      );
    }
    return { attemptId, storagePath };
  }

  async function completeQuestion(fixture: InterviewFixture) {
    const attempt = await seedAttempt(fixture, {
      selected: true,
      uploadStatus: "uploaded",
      duration: 42,
      fileSize: 1_024,
    });
    await client.query(
      `update public.interview_assignment_questions
       set status = 'in_progress', started_at = now() - interval '1 minute'
       where id = $1`,
      [fixture.questionId],
    );
    await client.query(
      `update public.interview_assignment_questions
       set status = 'completed', completed_at = now()
       where id = $1`,
      [fixture.questionId],
    );
    return attempt;
  }

  it("limits assignment and recording metadata to the candidate owner and scoped staff", async () => {
    const fixture = await seedInterview();
    await seedAttempt(fixture);

    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "select id from public.interview_assignments where id = $1",
          [fixture.assignmentId],
        )
      ).rows,
    ).toHaveLength(1);
    for (const userId of [ids.candidate2, ids.recruiterB, ids.employerUserA]) {
      expect(
        (
          await queryAs(
            client,
            userId,
            "select id from public.interview_assignments where id = $1",
            [fixture.assignmentId],
          )
        ).rows,
      ).toHaveLength(0);
    }
    expect(
      (
        await queryAs(
          client,
          ids.recruiterA,
          "select id from public.interview_response_attempts where assignment_id = $1",
          [fixture.assignmentId],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("keeps recruiter reviews private and franchise-scoped", async () => {
    const fixture = await seedInterview();
    await client.query(
      `insert into public.interview_reviews
         (assignment_id, recruiter_id, overall_rating, internal_notes)
       values ($1, $2, 4, 'Recruiter-only note')`,
      [fixture.assignmentId, ids.recruiterA],
    );

    expect(
      (
        await queryAs(
          client,
          ids.recruiterA,
          "select internal_notes from public.interview_reviews where assignment_id = $1",
          [fixture.assignmentId],
        )
      ).rows[0]?.internal_notes,
    ).toBe("Recruiter-only note");
    for (const userId of [ids.candidate1, ids.candidate2, ids.recruiterB, ids.employerUserA]) {
      expect(
        (
          await queryAs(
            client,
            userId,
            "select id from public.interview_reviews where assignment_id = $1",
            [fixture.assignmentId],
          )
        ).rows,
      ).toHaveLength(0);
    }
  });

  it("makes assignment question snapshots and assignment ownership immutable", async () => {
    const fixture = await seedInterview();
    await expect(
      queryAs(
        client,
        ids.candidate1,
        `update public.interview_assignment_questions
         set question_text_snapshot = 'Changed'
         where id = $1`,
        [fixture.questionId],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      queryAs(
        client,
        ids.recruiterA,
        "update public.interview_assignments set candidate_id = $1 where id = $2",
        [fixture.candidateProfileId, fixture.assignmentId],
      ),
    ).resolves.toBeDefined();
    const otherCandidateProfile = (
      await client.query("select id from public.candidate_profiles where user_id = $1", [
        ids.candidate2,
      ])
    ).rows[0].id as string;
    await expect(
      queryAs(
        client,
        ids.recruiterA,
        "update public.interview_assignments set candidate_id = $1 where id = $2",
        [otherCandidateProfile, fixture.assignmentId],
      ),
    ).rejects.toThrow(/immutable|must match the application/i);
  });

  it("enforces positive unique attempt numbers, the cap, and one selected response", async () => {
    const fixture = await seedInterview({ maxAttempts: 5 });
    await expect(seedAttempt(fixture, { attemptNumber: 0 })).rejects.toThrow();
    await seedAttempt(fixture, { attemptNumber: 1, selected: true });
    await expect(seedAttempt(fixture, { attemptNumber: 1 })).rejects.toThrow();
    await expect(seedAttempt(fixture, { attemptNumber: 2, selected: true })).rejects.toThrow();

    const capped = await seedInterview({ maxAttempts: 2 });
    await seedAttempt(capped, { attemptNumber: 1 });
    await seedAttempt(capped, { attemptNumber: 2 });
    await expect(seedAttempt(capped, { attemptNumber: 3 })).rejects.toThrow(/maximum attempts/i);
  });

  it("rejects incomplete submission", async () => {
    const fixture = await seedInterview();
    await expect(
      queryAs(client, ids.candidate1, "select public.submit_interview($1)", [fixture.assignmentId]),
    ).rejects.toThrow(/required questions are incomplete/i);
  });

  it("submits a complete interview idempotently", async () => {
    const fixture = await seedInterview();
    await completeQuestion(fixture);
    const result = await queryAs(
      client,
      ids.candidate1,
      `with first_call as materialized (
         select (public.submit_interview($1)).status as first_status
       )
       select first_status, (public.submit_interview($1)).status as second_status
       from first_call`,
      [fixture.assignmentId],
    );
    expect(result.rows[0]).toMatchObject({
      first_status: "submitted",
      second_status: "submitted",
    });
  });

  it("rejects starting or submitting an expired assignment", async () => {
    const fixture = await seedInterview({
      status: "invited",
      expiresAt: "now() - interval '1 minute'",
    });
    await expect(
      queryAs(
        client,
        ids.candidate1,
        `update public.interview_assignments
         set status = 'in_progress', started_at = now(), consented_at = now(),
             privacy_notice_version = 'test-v1', instructions_version = 'test-v1'
         where id = $1`,
        [fixture.assignmentId],
      ),
    ).rejects.toThrow(/expired/i);
    await expect(
      queryAs(client, ids.candidate1, "select public.submit_interview($1)", [fixture.assignmentId]),
    ).rejects.toThrow(/expired|not been started/i);
  });

  it("prevents candidate mutation after submission", async () => {
    const fixture = await seedInterview();
    const { attemptId } = await completeQuestion(fixture);
    await client.query("begin");
    await client.query("select set_config('app.submitting_interview', 'true', true)");
    await client.query(
      "update public.interview_assignments set status = 'submitted', submitted_at = now() where id = $1",
      [fixture.assignmentId],
    );
    await client.query("commit");

    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "update public.interview_assignments set candidate_instructions = 'changed' where id = $1 returning id",
          [fixture.assignmentId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "update public.interview_response_attempts set duration_seconds = 1 where id = $1 returning id",
          [attemptId],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("exposes factual analytics only to the owner and scoped staff", async () => {
    const fixture = await seedInterview({ maxAttempts: 3 });
    await seedAttempt(fixture, {
      attemptNumber: 1,
      uploadStatus: "failed",
      duration: 18,
    });
    await seedAttempt(fixture, {
      attemptNumber: 2,
      uploadStatus: "uploaded",
      selected: true,
      duration: 42,
      fileSize: 2_048,
    });
    await client.query(
      `insert into public.interview_events
         (assignment_id, assignment_question_id, actor_user_id, event_type)
       values ($1, $2, $3, 'upload_failed')`,
      [fixture.assignmentId, fixture.questionId, ids.candidate1],
    );
    await client.query(
      `update public.interview_assignment_questions
       set status = 'in_progress', started_at = now() - interval '1 minute'
       where id = $1`,
      [fixture.questionId],
    );
    await client.query(
      "update public.interview_assignment_questions set status = 'completed', completed_at = now() where id = $1",
      [fixture.questionId],
    );

    const analytics = await queryAs(
      client,
      ids.candidate1,
      `select total_attempts, total_retries, total_recording_duration_seconds,
              upload_failure_count, total_uploaded_bytes
       from public.interview_assignment_analytics where assignment_id = $1`,
      [fixture.assignmentId],
    );
    expect(analytics.rows[0]).toMatchObject({
      total_attempts: 2,
      total_retries: 1,
      upload_failure_count: 1,
      total_uploaded_bytes: "2048",
    });
    expect(Number(analytics.rows[0]?.total_recording_duration_seconds)).toBe(60);
    expect(
      (
        await queryAs(
          client,
          ids.recruiterA,
          "select assignment_id from public.interview_assignment_analytics where assignment_id = $1",
          [fixture.assignmentId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await queryAs(
          client,
          ids.recruiterB,
          "select assignment_id from public.interview_assignment_analytics where assignment_id = $1",
          [fixture.assignmentId],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("enforces private storage write and read policies", async () => {
    const fixture = await seedInterview();
    const { storagePath } = await seedAttempt(fixture);

    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          `insert into storage.objects (bucket_id, name, owner)
           values ('interview-recordings', $1, $2) returning name`,
          [storagePath, ids.candidate1],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      queryAs(
        client,
        ids.candidate2,
        `insert into storage.objects (bucket_id, name, owner)
         values ('interview-recordings', $1, $2)`,
        [storagePath, ids.candidate2],
      ),
    ).rejects.toThrow();

    await client.query(
      "insert into storage.objects (bucket_id, name, owner) values ('interview-recordings', $1, $2)",
      [storagePath, ids.candidate1],
    );
    for (const userId of [ids.candidate1, ids.recruiterA]) {
      expect(
        (
          await queryAs(client, userId, "select name from storage.objects where name = $1", [
            storagePath,
          ])
        ).rows,
      ).toHaveLength(1);
    }
    for (const userId of [ids.candidate2, ids.recruiterB, ids.employerUserA]) {
      expect(
        (
          await queryAs(client, userId, "select name from storage.objects where name = $1", [
            storagePath,
          ])
        ).rows,
      ).toHaveLength(0);
    }
  });

  it("creates scoped, rate-limited in-app deadline reminders", async () => {
    const fixture = await seedInterview({
      status: "invited",
      expiresAt: "now() + interval '1 day'",
    });
    const sent = await commitAs(
      client,
      ids.recruiterA,
      "select public.send_interview_deadline_reminder($1) as sent",
      [fixture.assignmentId],
    );
    expect(sent.rows[0]).toMatchObject({ sent: true });
    expect(
      (
        await client.query(
          `select id from public.notifications
           where subject_type = 'interview_assignment'
             and subject_id = $1
             and category = 'interview_reminder'`,
          [fixture.assignmentId],
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      queryAs(client, ids.recruiterB, "select public.send_interview_deadline_reminder($1)", [
        fixture.assignmentId,
      ]),
    ).rejects.toThrow(/not authorized/i);
  });

  it("locks documents during an active interview and flags change attempts", async () => {
    const fixture = await seedInterview({ status: "in_progress" });

    // A live session is required to record client-driven attempt events.
    const session = await commitAs(
      client,
      ids.candidate1,
      `select session_token from public.begin_or_resume_interview_session($1, null, 'initial')`,
      [fixture.assignmentId],
    );
    const token = (session.rows[0] as { session_token: string }).session_token;

    await commitAs(
      client,
      ids.candidate1,
      "select public.lock_interview_document_snapshot($1) as snapshot",
      [fixture.assignmentId],
    );
    const locked = await client.query(
      `select documents_locked_at is not null as locked,
              jsonb_typeof(document_snapshot) as snap_type
       from public.interview_assignments where id = $1`,
      [fixture.assignmentId],
    );
    expect(locked.rows[0]).toMatchObject({ locked: true, snap_type: "array" });

    // The DB hard-blocks any document mutation while the lock is active.
    await expect(
      queryAs(
        client,
        ids.candidate1,
        `insert into public.candidate_documents
           (candidate_id, doc_type, object_path, title)
         values ($1, 'passport', 'locked-test/passport.pdf', 'Passport')`,
        [fixture.candidateProfileId],
      ),
    ).rejects.toThrow(/locked/i);

    // The attempt is recorded out-of-band via the session-event RPC (the blocked
    // write's own transaction rolls back, so it cannot persist its own audit row).
    const recorded = await commitAs(
      client,
      ids.candidate1,
      `select public.record_interview_session_event($1, $2, 'document_change_attempted', null, $3::jsonb) as ok`,
      [fixture.assignmentId, token, JSON.stringify({ operation: "INSERT", doc_type: "passport" })],
    );
    expect(recorded.rows[0]).toMatchObject({ ok: true });

    const flagged = await client.query(
      `select event_type, metadata->>'operation' as operation
       from public.interview_events
       where assignment_id = $1 and event_type = 'document_change_attempted'
       order by id desc limit 1`,
      [fixture.assignmentId],
    );
    expect(flagged.rows[0]).toMatchObject({
      event_type: "document_change_attempted",
      operation: "INSERT",
    });
  });

  it("supports controlled reconnect and flags unauthorized session restarts", async () => {
    const fixture = await seedInterview({ status: "in_progress" });
    const first = await commitAs(
      client,
      ids.candidate1,
      `select * from public.begin_or_resume_interview_session($1, null, 'initial')`,
      [fixture.assignmentId],
    );
    const firstRow = first.rows[0] as {
      session_token: string;
      resumed: boolean;
      interruption_count: number;
    };
    const token = firstRow.session_token;
    expect(token).toBeTruthy();
    expect(firstRow.resumed).toBe(false);

    const resumed = await commitAs(
      client,
      ids.candidate1,
      `select * from public.begin_or_resume_interview_session($1, $2, 'accidental_reconnect')`,
      [fixture.assignmentId, token],
    );
    expect(resumed.rows[0]).toMatchObject({
      session_token: token,
      resumed: true,
    });

    const replaced = await commitAs(
      client,
      ids.candidate1,
      `select * from public.begin_or_resume_interview_session($1, 'wrong-token', 'unauthorized_restart')`,
      [fixture.assignmentId],
    );
    const replacedRow = replaced.rows[0] as {
      session_token: string;
      interruption_count: number;
    };
    expect(replacedRow.session_token).not.toBe(token);
    expect(Number(replacedRow.interruption_count)).toBeGreaterThanOrEqual(1);

    await commitAs(
      client,
      ids.candidate1,
      `select public.record_interview_session_event($1, $2, 'page_unload_warned', null, $3::jsonb)`,
      [
        fixture.assignmentId,
        replacedRow.session_token,
        JSON.stringify({ reason: "tab_close", during_recording: true }),
      ],
    );
    const assignment = await client.query(
      `select has_unusual_interruptions, interruption_count
       from public.interview_assignments where id = $1`,
      [fixture.assignmentId],
    );
    expect(assignment.rows[0]?.has_unusual_interruptions).toBe(true);
  });
});
