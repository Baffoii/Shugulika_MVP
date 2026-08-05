import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { commitAs, connect, hasDb, queryAs, setupDb, type SeedIds } from "./helpers";

const d = hasDb ? describe : describe.skip;

d("candidate progress, result sharing, and CV consent security", () => {
  let client: Client;
  let ids: SeedIds;
  let candidate1Profile: string;
  let assignmentId: string;
  let documentId: string;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
    candidate1Profile = (
      await client.query("select id from public.candidate_profiles where user_id = $1", [
        ids.candidate1,
      ])
    ).rows[0].id as string;
    assignmentId = (
      await client.query(
        `insert into public.assessment_assignments
          (application_id, job_order_id, candidate_id, assessment_mode,
           assessment_seniority, status, assigned_by, due_at, submitted_at,
           score, result_band, graded_at, paid_by, provider)
         values ($1, $2, $3, 'shugulika', 'junior', 'graded', $4,
                 now() + interval '2 days', now() - interval '1 minute',
                 84, 'strong', now(), 'candidate', 'offline-test-provider')
         returning id`,
        [ids.applicationC1, ids.jobOrderA, candidate1Profile, ids.recruiterA],
      )
    ).rows[0].id as string;
    documentId = (
      await client.query(
        `insert into public.candidate_documents
          (candidate_id, doc_type, title, object_path, mime_type, is_primary)
         values ($1, 'cv', 'Candidate CV', $2, 'application/pdf', true)
         returning id`,
        [candidate1Profile, `${candidate1Profile}/candidate-cv.pdf`],
      )
    ).rows[0].id as string;
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  it("serves an immutable permitted snapshot without provider availability", async () => {
    const own = await queryAs(
      client,
      ids.candidate1,
      `select provider, permitted_payload, visibility_tier
       from public.assessment_result_snapshots where assignment_id = $1`,
      [assignmentId],
    );
    expect(own.rows[0]).toMatchObject({
      provider: "offline-test-provider",
      visibility_tier: "candidate_full",
      permitted_payload: {
        completion_status: "completed",
        score_percent: 84,
        result_band: "strong",
      },
    });
    expect(
      (
        await queryAs(
          client,
          ids.candidate2,
          "select assignment_id from public.assessment_result_snapshots where assignment_id = $1",
          [assignmentId],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      client.query(
        "update public.assessment_result_snapshots set permitted_payload = '{}' where assignment_id = $1",
        [assignmentId],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it("shows the candidate exactly what was shared and scopes the recipient by job", async () => {
    const shared = await commitAs(
      client,
      ids.candidate1,
      `select public.candidate_share_assessment_result(
         $1, 'Employer review for this application', now() + interval '7 days'
       ) as id`,
      [assignmentId],
    );
    const grantId = shared.rows[0]?.id as string;
    const candidateView = await queryAs(
      client,
      ids.candidate1,
      `select recipient_org_id, purpose, job_order_id, expires_at, revoked_at
       from public.result_share_grants where id = $1`,
      [grantId],
    );
    expect(candidateView.rows[0]).toMatchObject({
      recipient_org_id: ids.employerA,
      purpose: "Employer review for this application",
      job_order_id: ids.jobOrderA,
      revoked_at: null,
    });
    expect(
      (
        await queryAs(
          client,
          ids.employerUserA,
          "select id from public.result_share_grants where id = $1",
          [grantId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await queryAs(
          client,
          ids.employerUserB,
          "select id from public.result_share_grants where id = $1",
          [grantId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await queryAs(
          client,
          ids.candidate2,
          "select id from public.result_share_grants where id = $1",
          [grantId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await queryAs(
          client,
          ids.employerUserA,
          "select assignment_id from public.assessment_result_snapshots where assignment_id = $1",
          [assignmentId],
        )
      ).rows,
    ).toHaveLength(1);

    await commitAs(client, ids.candidate1, "select public.candidate_revoke_result_share($1)", [
      grantId,
    ]);
    const revoked = await queryAs(
      client,
      ids.candidate1,
      "select revoked_at, revoked_by from public.result_share_grants where id = $1",
      [grantId],
    );
    expect(revoked.rows[0]?.revoked_at).not.toBeNull();
    expect(revoked.rows[0]?.revoked_by).toBe(ids.candidate1);
    expect(
      (
        await queryAs(
          client,
          ids.employerUserA,
          "select assignment_id from public.assessment_result_snapshots where assignment_id = $1",
          [assignmentId],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("creates job-scoped CV consent and only a secure portal link", async () => {
    const result = await commitAs(
      client,
      ids.candidate1,
      "select public.candidate_share_cv($1, $2) as id",
      [ids.applicationC1, documentId],
    );
    const eventId = result.rows[0]?.id as string;
    const own = await queryAs(
      client,
      ids.candidate1,
      `select application_id, recipient_org_id, document_id, consent_id, channel, portal_path
       from public.cv_share_events where id = $1`,
      [eventId],
    );
    expect(own.rows[0]).toMatchObject({
      application_id: ids.applicationC1,
      recipient_org_id: ids.employerA,
      document_id: documentId,
      channel: "portal_link",
    });
    expect(String(own.rows[0]?.portal_path)).toBe(`/employer/submissions/${ids.submissionC1}`);
    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "select cv_document_id from public.applications where id = $1",
          [ids.applicationC1],
        )
      ).rows[0]?.cv_document_id,
    ).toBe(documentId);
    expect(
      (
        await queryAs(
          client,
          ids.employerUserA,
          "select cv_document_id from public.employer_submissions where id = $1",
          [ids.submissionC1],
        )
      ).rows[0]?.cv_document_id,
    ).toBe(documentId);
    expect(
      (
        await queryAs(
          client,
          ids.employerUserA,
          "select id from public.cv_share_events where id = $1",
          [eventId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await queryAs(
          client,
          ids.employerUserB,
          "select id from public.cv_share_events where id = $1",
          [eventId],
        )
      ).rows,
    ).toHaveLength(0);
    const consent = await queryAs(
      client,
      ids.candidate1,
      "select purpose, scope from public.candidate_consents where id = $1",
      [own.rows[0]?.consent_id],
    );
    expect(consent.rows[0]?.purpose).toBe("share_document");
    expect(consent.rows[0]?.scope).toMatchObject({
      application_id: ids.applicationC1,
      document_id: documentId,
      channel: "portal_link",
    });
  });

  it("exposes only allowlisted candidate events, never raw deliberations or another candidate", async () => {
    await client.query(
      `insert into public.application_stage_history
        (application_id, from_stage, to_stage, actor_id, actor_role, reason, note, source)
       values ($1, 'cv_review', 'testing', $2, 'recruiter',
               'internal reason', 'employer deliberation', 'test')`,
      [ids.applicationC1, ids.recruiterA],
    );
    await client.query(
      `insert into public.recruiter_notes
        (subject_type, subject_id, owning_org_id, author_id, body)
       values ('application', $1, $2, $3, 'private recruiter note')`,
      [ids.applicationC1, ids.franchiseA, ids.recruiterA],
    );
    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "select * from public.application_stage_history where application_id = $1",
          [ids.applicationC1],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "select * from public.recruiter_notes where subject_id = $1",
          [ids.applicationC1],
        )
      ).rows,
    ).toHaveLength(0);
    const safe = await queryAs(
      client,
      ids.candidate1,
      `select label, details::text as details
       from public.candidate_visible_events
       where application_id = $1 and event_type = 'stage_changed'`,
      [ids.applicationC1],
    );
    expect(safe.rows.some((row) => row.label === "Skills assessment")).toBe(true);
    expect(safe.rows.map((row) => row.details).join(" ")).not.toMatch(
      /deliberation|internal reason/i,
    );
    expect(
      (
        await queryAs(
          client,
          ids.candidate2,
          "select id from public.candidate_visible_events where application_id = $1",
          [ids.applicationC1],
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("writes help and duplicate-review events and notifies staff without merging", async () => {
    await commitAs(
      client,
      ids.candidate1,
      `select public.candidate_request_support(
        'reschedule', 'assessment', $1, 'Please move this deadline because I need an accessible testing setup.'
      )`,
      [assignmentId],
    );
    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "select id from public.candidate_visible_events where event_type = 'reschedule_requested' and candidate_id = $1",
          [candidate1Profile],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await queryAs(
          client,
          ids.recruiterA,
          "select id from public.notifications where category = 'candidate_support' and subject_id = $1",
          [assignmentId],
        )
      ).rows,
    ).toHaveLength(1);

    await commitAs(
      client,
      ids.candidate1,
      `select public.candidate_request_support(
        'duplicate_review', 'candidate', $1, 'I may have another account using my previous contact email address.'
      )`,
      [candidate1Profile],
    );
    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "select id from public.candidate_visible_events where event_type = 'duplicate_review_requested' and candidate_id = $1",
          [candidate1Profile],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await client.query(
          "select count(*)::int as count from public.candidate_profiles where user_id = $1",
          [ids.candidate1],
        )
      ).rows[0]?.count,
    ).toBe(1);
  });

  it("routes unassigned support only to HQ and the responsible franchise", async () => {
    const franchiseAdminB = "a0000000-0000-4000-8000-000000000033";
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'fa-b@test.io', jsonb_build_object(
         'role', 'candidate', 'full_name', 'Franchise Admin B'
       ))`,
      [franchiseAdminB],
    );
    await client.query(`delete from public.memberships where user_id = $1`, [franchiseAdminB]);
    await client.query(`delete from public.candidate_profiles where user_id = $1`, [
      franchiseAdminB,
    ]);
    await client.query(
      `insert into public.memberships
         (user_id, organization_id, role, status, country_code)
       values ($1, $2, 'franchise_admin', 'active', 'TZ')`,
      [franchiseAdminB, ids.franchiseB],
    );
    await client.query(
      `update public.applications set assigned_recruiter_id = null where id = $1`,
      [ids.applicationC1],
    );

    const orgMessage = "Please help me understand the next step for this application.";
    await commitAs(
      client,
      ids.candidate1,
      `select public.candidate_request_support('help', 'application', $1, $2)`,
      [ids.applicationC1, orgMessage],
    );
    const orgRecipients = (
      await client.query(
        `select user_id from public.notifications
         where category = 'candidate_support' and body = $1`,
        [orgMessage],
      )
    ).rows.map((row) => row.user_id);
    expect(orgRecipients).toContain(ids.hqAdmin);
    expect(orgRecipients).toContain(ids.franchiseAdminA);
    expect(orgRecipients).not.toContain(franchiseAdminB);

    const hqMessage = "Please review a possible duplicate account for this candidate profile.";
    await commitAs(
      client,
      ids.candidate1,
      `select public.candidate_request_support('duplicate_review', 'candidate', $1, $2)`,
      [candidate1Profile, hqMessage],
    );
    const duplicateRecipients = (
      await client.query(
        `select user_id from public.notifications
         where category = 'candidate_support' and body = $1`,
        [hqMessage],
      )
    ).rows.map((row) => row.user_id);
    expect(duplicateRecipients).toEqual([ids.hqAdmin]);
  });
});
