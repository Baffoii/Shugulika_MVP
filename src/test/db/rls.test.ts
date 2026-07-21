import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { connect, setupDb, queryAs, hasDb, type SeedIds } from "./helpers";

// Opt-in: runs only when DATABASE_URL points at an ephemeral test Postgres.
const d = hasDb ? describe : describe.skip;

d("Row-Level Security & tenant isolation", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  it("anonymous users see only advertised jobs + reference data, never applications", async () => {
    expect(
      (await queryAs(client, null, "select count(*)::int c from public.applications")).rows[0]?.c,
    ).toBe(0);
    expect(
      (await queryAs(client, null, "select count(*)::int c from public.candidate_profiles")).rows[0]
        ?.c,
    ).toBe(0);
    expect(
      (await queryAs(client, null, "select count(*)::int c from public.recruiter_notes")).rows[0]
        ?.c,
    ).toBe(0);
    const jobs = (await queryAs(client, null, "select count(*)::int c from public.public_jobs"))
      .rows[0]?.c as number;
    expect(jobs).toBeGreaterThanOrEqual(3);
    expect(
      (await queryAs(client, null, "select count(*)::int c from public.countries")).rows[0]?.c,
    ).toBe(3);
  });

  it("a candidate sees their own application but not another candidate's", async () => {
    const own = await queryAs(
      client,
      ids.candidate1,
      "select count(*)::int c from public.applications",
    );
    expect(own.rows[0]?.c).toBe(1);
    const other = await queryAs(
      client,
      ids.candidate2,
      "select count(*)::int c from public.applications",
    );
    expect(other.rows[0]?.c).toBe(0);
  });

  it("a candidate cannot read another candidate's profile", async () => {
    const c1Profile = (
      await queryAs(client, ids.candidate1, "select id from public.candidate_profiles")
    ).rows;
    expect(c1Profile).toHaveLength(1);
    // candidate2 attempts to read candidate1's profile by id → 0 rows (RLS)
    const probe = await queryAs(
      client,
      ids.candidate2,
      "select count(*)::int c from public.candidate_profiles where id = $1",
      [c1Profile[0]?.id],
    );
    expect(probe.rows[0]?.c).toBe(0);
  });

  it("franchise A recruiter sees franchise A applications; franchise B recruiter does not", async () => {
    const a = await queryAs(
      client,
      ids.recruiterA,
      "select count(*)::int c from public.applications",
    );
    expect(a.rows[0]?.c).toBe(1);
    const b = await queryAs(
      client,
      ids.recruiterB,
      "select count(*)::int c from public.applications",
    );
    expect(b.rows[0]?.c).toBe(0);
  });

  it("recruiter-private notes never leak to candidates or employers", async () => {
    // franchise A recruiter writes a private note on the application
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids.recruiterA, role: "authenticated" }),
    ]);
    await client.query(
      `insert into public.recruiter_notes (subject_type, subject_id, owning_org_id, author_id, body, visibility)
       values ('application',$1,$2,$3,'private note','recruiter_private')`,
      [ids.applicationC1, ids.franchiseA, ids.recruiterA],
    );
    await client.query("commit");

    const candView = await queryAs(
      client,
      ids.candidate1,
      "select count(*)::int c from public.recruiter_notes",
    );
    expect(candView.rows[0]?.c).toBe(0);
    const empView = await queryAs(
      client,
      ids.employerUserA,
      "select count(*)::int c from public.recruiter_notes",
    );
    expect(empView.rows[0]?.c).toBe(0);
  });

  it("employer sees only submissions to its own organization", async () => {
    const emp = await queryAs(
      client,
      ids.employerUserA,
      "select count(*)::int c from public.employer_submissions",
    );
    expect(emp.rows[0]?.c).toBe(1);
    // A candidate cannot read employer_submissions at all
    const cand = await queryAs(
      client,
      ids.candidate2,
      "select count(*)::int c from public.employer_submissions",
    );
    expect(cand.rows[0]?.c).toBe(0);
  });

  it("a candidate cannot forge an application for someone else (WITH CHECK)", async () => {
    // Resolve candidate1's profile id with the superuser client (bypasses RLS).
    const c1Profile = (
      await client.query(`select id from public.candidate_profiles where user_id=$1`, [
        ids.candidate1,
      ])
    ).rows[0].id as string;
    // candidate2 attempts to insert an application carrying candidate1's id → the
    // INSERT ... WITH CHECK (candidate_id = my candidate id) must reject it.
    await expect(
      queryAs(
        client,
        ids.candidate2,
        `insert into public.applications (candidate_id, job_order_id, owning_org_id, recruitment_path, current_stage)
         values ($1, $2, $3, 'B', 'cv_review')`,
        [c1Profile, ids.jobOrderA, ids.franchiseA],
      ),
    ).rejects.toThrow();
  });

  it("candidates cannot read the memberships/roles of others", async () => {
    const mine = await queryAs(
      client,
      ids.candidate1,
      "select count(*)::int c from public.memberships",
    );
    // Own membership row only (candidate role).
    expect(mine.rows[0]?.c).toBe(1);
  });

  it("resume parse runs & field suggestions are candidate-private (migration 0006 RLS)", async () => {
    // candidate1's profile id (resolved with the superuser client; bypasses RLS).
    const cand1 = (
      await client.query(`select id from public.candidate_profiles where user_id=$1`, [
        ids.candidate1,
      ])
    ).rows[0].id as string;

    // Prerequisite: a CV document for candidate1 (seeded via the superuser client).
    const docId = (
      await client.query(
        `insert into public.candidate_documents (candidate_id, doc_type, object_path)
         values ($1,'cv',$2) returning id`,
        [cand1, `${cand1}/cv.pdf`],
      )
    ).rows[0].id as string;

    // candidate1 creates their own parse run + suggestion — exercises the INSERT
    // WITH CHECK (candidate_id = auth_candidate_id()). Commit so later reads see it.
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ids.candidate1, role: "authenticated" }),
    ]);
    const runId = (
      await client.query(
        `insert into public.resume_parse_runs (candidate_id, document_id, status)
         values ($1,$2,'succeeded') returning id`,
        [cand1, docId],
      )
    ).rows[0].id as string;
    await client.query(
      `insert into public.resume_field_suggestions
         (parse_run_id, candidate_id, target_entity, field_path, suggested_value, confidence)
       values ($1,$2,'profile','headline','"Senior Analyst"'::jsonb,0.9)`,
      [runId, cand1],
    );
    await client.query("commit");

    // The owner sees their own parse data.
    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "select count(*)::int c from public.resume_parse_runs",
        )
      ).rows[0]?.c,
    ).toBe(1);
    expect(
      (
        await queryAs(
          client,
          ids.candidate1,
          "select count(*)::int c from public.resume_field_suggestions",
        )
      ).rows[0]?.c,
    ).toBe(1);

    // No one else does — not another candidate, a recruiter, or an employer user.
    for (const uid of [ids.candidate2, ids.recruiterA, ids.employerUserA]) {
      expect(
        (await queryAs(client, uid, "select count(*)::int c from public.resume_parse_runs")).rows[0]
          ?.c,
      ).toBe(0);
      expect(
        (await queryAs(client, uid, "select count(*)::int c from public.resume_field_suggestions"))
          .rows[0]?.c,
      ).toBe(0);
    }

    // Another candidate cannot forge a suggestion carrying candidate1's id (WITH CHECK).
    await expect(
      queryAs(
        client,
        ids.candidate2,
        `insert into public.resume_field_suggestions
           (parse_run_id, candidate_id, target_entity, field_path, suggested_value, confidence)
         values ($1,$2,'profile','headline','"x"'::jsonb,0.5)`,
        [runId, cand1],
      ),
    ).rejects.toThrow();
  });
});
