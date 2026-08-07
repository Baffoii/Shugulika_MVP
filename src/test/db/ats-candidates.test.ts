/**
 * DB-backed proof of the ATS §9 guarantees that only the database can enforce.
 *
 * Opt-in: runs only when DATABASE_URL is set (CI provides an ephemeral
 * Postgres). These assert the things a pure unit test cannot:
 *
 *   * a candidate-confirmed value cannot be overwritten by a machine re-parse,
 *     whatever code path attempts it;
 *   * a duplicate link cannot be created already resolved, and no candidate can
 *     be flagged merged without an audited merge event;
 *   * merge and import are HQ-only, and an employer cannot reach the queue;
 *   * work-authorization data is invisible while its feature flag is off, and
 *     the schema carries no nationality column anywhere.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { commitAs, connect, hasDb, queryAs, setupDb, type SeedIds } from "./helpers";

const describeDb = hasDb ? describe : describe.skip;

/**
 * `queryAs` returns loosely-typed rows; these narrow the two shapes the
 * assertions below need, and fail loudly rather than reading `undefined` when a
 * query unexpectedly returns nothing.
 */
function firstRow(result: { rows: Array<Record<string, unknown>> }): Record<string, unknown> {
  const row = result.rows[0];
  if (!row) throw new Error("expected the query to return at least one row");
  return row;
}

function countOf(result: { rows: Array<Record<string, unknown>> }): number {
  return Number(firstRow(result).c);
}

describeDb("ATS parser provenance", () => {
  let client: Client;
  let ids: SeedIds;
  let candidateId: string;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
    const { rows } = await client.query(
      `select id from public.candidate_profiles where user_id = $1`,
      [ids.candidate1],
    );
    candidateId = rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  async function seedConfirmed(field: string) {
    await client.query(
      `insert into public.candidate_field_provenance
         (candidate_id, target_entity, field_path, value_text, source, confirmed_at, confirmed_by)
       values ($1,'profile',$2,'Mwakalinga','candidate_confirmed', now(), $3)
       on conflict do nothing`,
      [candidateId, field, ids.candidate1],
    );
  }

  it("stamps a parser version on every parse run", async () => {
    const { rows } = await client.query(
      `select column_name, column_default, is_nullable
         from information_schema.columns
        where table_name = 'resume_parse_runs' and column_name = 'parser_version'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe("NO");
  });

  it("refuses to overwrite a candidate-confirmed value with a lower-confidence re-parse", async () => {
    await seedConfirmed("family_name_confirmed_guard");
    await expect(
      client.query(
        `update public.candidate_field_provenance
            set source = 'cv_parse', confidence = 0.2, value_text = 'Wrong'
          where candidate_id = $1 and field_path = 'family_name_confirmed_guard'`,
        [candidateId],
      ),
    ).rejects.toThrow(/human-established/);
  });

  it("refuses even a maximally confident re-parse", async () => {
    await seedConfirmed("family_name_high_conf_guard");
    await expect(
      client.query(
        `update public.candidate_field_provenance
            set source = 'cv_parse', confidence = 1.0, value_text = 'Wrong'
          where candidate_id = $1 and field_path = 'family_name_high_conf_guard'`,
        [candidateId],
      ),
    ).rejects.toThrow(/human-established/);
  });

  it("refuses a lower-confidence machine value over a higher-confidence one", async () => {
    await client.query(
      `insert into public.candidate_field_provenance
         (candidate_id, target_entity, field_path, value_text, source, confidence)
       values ($1,'profile','headline_conf_guard','Accountant','cv_parse',0.9)`,
      [candidateId],
    );
    await expect(
      client.query(
        `update public.candidate_field_provenance
            set confidence = 0.3, value_text = 'Acct'
          where candidate_id = $1 and field_path = 'headline_conf_guard'`,
        [candidateId],
      ),
    ).rejects.toThrow(/lower-confidence/);
  });

  it("lets a human decision replace a machine extraction", async () => {
    await client.query(
      `insert into public.candidate_field_provenance
         (candidate_id, target_entity, field_path, value_text, source, confidence)
       values ($1,'profile','city_upgrade','Dar','cv_parse',0.9)`,
      [candidateId],
    );
    await client.query(
      `update public.candidate_field_provenance
          set source = 'candidate_confirmed', confidence = null,
              value_text = 'Dodoma', confirmed_at = now(), confirmed_by = $2
        where candidate_id = $1 and field_path = 'city_upgrade'`,
      [candidateId, ids.candidate1],
    );
    const { rows } = await client.query(
      `select value_text, source from public.candidate_field_provenance
        where candidate_id = $1 and field_path = 'city_upgrade'`,
      [candidateId],
    );
    expect(rows[0]).toMatchObject({ value_text: "Dodoma", source: "candidate_confirmed" });
  });

  it("refuses a confirmed row with no recorded confirmation time", async () => {
    await expect(
      client.query(
        `insert into public.candidate_field_provenance
           (candidate_id, target_entity, field_path, value_text, source)
         values ($1,'profile','no_actor','x','candidate_confirmed')`,
        [candidateId],
      ),
    ).rejects.toThrow(/ck_candidate_provenance_confirmed_actor/);
  });

  it("keeps provenance candidate-private, readable by HQ, invisible to employers", async () => {
    await seedConfirmed("visibility_probe");

    const own = await queryAs(
      client,
      ids.candidate1,
      `select count(*)::int c from public.candidate_field_provenance`,
    );
    expect(countOf(own)).toBeGreaterThan(0);

    const otherCandidate = await queryAs(
      client,
      ids.candidate2,
      `select count(*)::int c from public.candidate_field_provenance`,
    );
    expect(countOf(otherCandidate)).toBe(0);

    const hq = await queryAs(
      client,
      ids.hqAdmin,
      `select count(*)::int c from public.candidate_field_provenance`,
    );
    expect(countOf(hq)).toBeGreaterThan(0);

    const employer = await queryAs(
      client,
      ids.employerUserA,
      `select count(*)::int c from public.candidate_field_provenance`,
    );
    expect(countOf(employer)).toBe(0);
  });
});

describeDb("candidate dedupe and merge", () => {
  let client: Client;
  let ids: SeedIds;
  let candidateA: string;
  let candidateB: string;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
    const { rows } = await client.query(
      `select id from public.candidate_profiles where user_id = any($1::uuid[]) order by id`,
      [[ids.candidate1, ids.candidate2]],
    );
    candidateA = rows[0].id;
    candidateB = rows[1].id;
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  async function seedLink(): Promise<string> {
    const { rows } = await client.query(
      `insert into public.candidate_duplicate_links
         (candidate_id_low, candidate_id_high, status, match_kind, score, signals)
       values ($1,$2,'suspected','probabilistic',0.91,'[]'::jsonb)
       on conflict (candidate_id_low, candidate_id_high)
         do update set score = excluded.score
       returning id`,
      [candidateA, candidateB],
    );
    return rows[0].id;
  }

  it("stores a pair once, whichever order it is detected in", async () => {
    await seedLink();
    await expect(
      client.query(
        `insert into public.candidate_duplicate_links
           (candidate_id_low, candidate_id_high, status, match_kind, score)
         values ($1,$2,'suspected','exact',1.0)`,
        [candidateB, candidateA],
      ),
    ).rejects.toThrow(/ck_candidate_duplicate_pair_ordered/);
  });

  it("refuses a link that arrives already resolved — detection cannot decide", async () => {
    await expect(
      client.query(
        `insert into public.candidate_duplicate_links
           (candidate_id_low, candidate_id_high, status, match_kind, score)
         select least(id_a, id_b), greatest(id_a, id_b), 'merged', 'exact', 1.0
           from (select $1::uuid id_a, $2::uuid id_b) t`,
        [candidateA, candidateB],
      ),
    ).rejects.toThrow(/must enter review as suspected/);
  });

  it("refuses to flag a candidate merged without an audited merge event", async () => {
    await expect(
      client.query(
        `update public.candidate_profiles
            set merged_into_candidate_id = $2
          where id = $1`,
        [candidateB, candidateA],
      ),
    ).rejects.toThrow(/without an audited candidate_merge_events row/);
  });

  it("requires HQ and a named actor to apply a merge", async () => {
    const linkId = await seedLink();

    // A recruiter may not merge.
    await expect(
      queryAs(
        client,
        ids.recruiterA,
        `select public.apply_candidate_merge($1,$2,$3,'[]'::jsonb,'{}'::jsonb,'{"primary":{}}'::jsonb)`,
        [candidateA, candidateB, linkId],
      ),
    ).rejects.toThrow(/HQ role required/);

    // Nor may an employer.
    await expect(
      queryAs(
        client,
        ids.employerUserA,
        `select public.apply_candidate_merge($1,$2,$3,'[]'::jsonb,'{}'::jsonb,'{"primary":{}}'::jsonb)`,
        [candidateA, candidateB, linkId],
      ),
    ).rejects.toThrow(/HQ role required/);
  });

  it("refuses a merge with no before-snapshot, because it would not be reversible", async () => {
    const linkId = await seedLink();
    await expect(
      queryAs(
        client,
        ids.hqAdmin,
        `select public.apply_candidate_merge($1,$2,$3,'[]'::jsonb,'{}'::jsonb,'{}'::jsonb)`,
        [candidateA, candidateB, linkId],
      ),
    ).rejects.toThrow(/before-snapshot/);
  });

  it("applies, records, and reverses a merge performed by HQ", async () => {
    const linkId = await seedLink();
    await client.query(`update public.candidate_profiles set city = 'Dar' where id = $1`, [
      candidateA,
    ]);
    await client.query(`update public.candidate_profiles set city = 'Dodoma' where id = $1`, [
      candidateB,
    ]);
    const child = await client.query(
      `insert into public.candidate_experiences
         (candidate_id, title, employer_name, kind)
       values ($1, 'Imported role', 'Example Ltd', 'formal')
       returning id`,
      [candidateB],
    );
    const experienceId = child.rows[0].id as string;

    const snapshot = JSON.stringify({
      primary: { id: candidateA, city: "Dar" },
      duplicate: { id: candidateB, city: "Dodoma" },
      reassigned: {},
    });

    // commitAs, not queryAs: queryAs rolls back, and this test asserts on the
    // state the merge leaves behind.
    const applied = await commitAs(
      client,
      ids.hqAdmin,
      `select public.apply_candidate_merge($1,$2,$3,
         '[{"fieldPath":"city","winner":"duplicate"}]'::jsonb,
         '{"city":"Dodoma"}'::jsonb, $4::jsonb) as event_id`,
      [candidateA, candidateB, linkId, snapshot],
    );
    const eventId = firstRow(applied).event_id as string;
    expect(eventId).toBeTruthy();

    const after = await client.query(
      `select p.city,
              d.merged_into_candidate_id,
              l.status as link_status,
              e.performed_by,
              e.before_snapshot->'reassigned'->'experiences' as moved_experiences,
              x.candidate_id as experience_candidate_id
         from public.candidate_profiles p
         join public.candidate_profiles d on d.id = $2
         join public.candidate_duplicate_links l on l.id = $3
         join public.candidate_merge_events e on e.id = $4
         join public.candidate_experiences x on x.id = $5
        where p.id = $1`,
      [candidateA, candidateB, linkId, eventId, experienceId],
    );
    expect(after.rows[0]).toMatchObject({
      city: "Dodoma",
      merged_into_candidate_id: candidateA,
      link_status: "merged",
      experience_candidate_id: candidateA,
    });
    expect(after.rows[0].moved_experiences).toContain(experienceId);
    // The merge is attributed to a real person, not to the system.
    expect(after.rows[0].performed_by).toBeTruthy();

    // …and it can be undone.
    await commitAs(
      client,
      ids.hqAdmin,
      `select public.revert_candidate_merge($1, '{"city":"Dar"}'::jsonb, 'wrong person')`,
      [eventId],
    );

    const reverted = await client.query(
      `select p.city, d.merged_into_candidate_id, d.open_to_work,
              e.status, e.reverted_by, l.status as link_status,
              x.candidate_id as experience_candidate_id
         from public.candidate_profiles p
         join public.candidate_profiles d on d.id = $2
         join public.candidate_merge_events e on e.id = $3
         join public.candidate_duplicate_links l on l.id = $4
         join public.candidate_experiences x on x.id = $5
        where p.id = $1`,
      [candidateA, candidateB, eventId, linkId, experienceId],
    );
    expect(reverted.rows[0]).toMatchObject({
      city: "Dar",
      merged_into_candidate_id: null,
      status: "reverted",
      link_status: "suspected",
      open_to_work: true,
      experience_candidate_id: candidateB,
    });
    expect(reverted.rows[0].reverted_by).toBeTruthy();
  });

  it("moves and reverses consent, assessment, interview, sharing, visibility and provenance data", async () => {
    const linkId = await seedLink();
    const applicationOwner = await client.query(
      `select candidate_id from public.applications where id = $1`,
      [ids.applicationC1],
    );
    const mergedId = applicationOwner.rows[0].candidate_id as string;
    const primaryId = mergedId === candidateA ? candidateB : candidateA;
    const consent = await client.query(
      `insert into public.candidate_consents (candidate_id, purpose, method)
       values ($1, 'merge-regression', 'imported') returning id`,
      [mergedId],
    );
    const consentId = consent.rows[0].id as string;
    await client.query(
      `insert into public.candidate_preferences (candidate_id, desired_roles, salary_private)
       values ($1, array['Primary role'], true), ($2, array['Duplicate role'], false)
       on conflict (candidate_id) do update set desired_roles = excluded.desired_roles`,
      [primaryId, mergedId],
    );
    await client.query(
      `insert into public.candidate_search_visibility (candidate_id, is_searchable, approved_fields)
       values ($1, true, array['headline','city']), ($2, false, array['headline'])
       on conflict (candidate_id) do update set is_searchable = excluded.is_searchable, approved_fields = excluded.approved_fields`,
      [primaryId, mergedId],
    );
    await client.query(
      `insert into public.candidate_work_authorizations (candidate_id, work_country_code, eligibility_status)
       values ($1, 'TZ', 'unknown'), ($2, 'TZ', 'eligible_without_permit')
       on conflict (candidate_id) do update set eligibility_status = excluded.eligibility_status`,
      [primaryId, mergedId],
    );
    const provenance = await client.query(
      `insert into public.candidate_field_provenance
         (candidate_id, target_entity, field_path, value_text, source, confidence)
       values ($1, 'profile', 'merge-regression-field', 'value', 'zoho_import', 0.8)
       returning id`,
      [mergedId],
    );
    const assessment = await client.query(
      `insert into public.assessment_assignments
         (application_id, job_order_id, candidate_id, assessment_mode, assessment_seniority, assigned_by)
       values ($1,$2,$3,'shugulika','junior',$4) returning id`,
      [ids.applicationC1, ids.jobOrderA, mergedId, ids.recruiterA],
    );
    const assessmentId = assessment.rows[0].id as string;
    const template = await client.query(
      `insert into public.interview_templates (organization_id, name, created_by)
       values ($1, 'Merge regression', $2) returning id`,
      [ids.franchiseA, ids.recruiterA],
    );
    const interview = await client.query(
      `insert into public.interview_assignments
         (template_id, candidate_id, application_id, job_order_id, organization_id, assigned_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [
        template.rows[0].id,
        mergedId,
        ids.applicationC1,
        ids.jobOrderA,
        ids.franchiseA,
        ids.recruiterA,
      ],
    );
    const resultShare = await client.query(
      `insert into public.result_share_grants
         (candidate_id, assignment_id, recipient_org_id, purpose, job_order_id, consent_id)
       values ($1,$2,$3,'merge regression',$4,$5) returning id`,
      [mergedId, assessmentId, ids.employerA, ids.jobOrderA, consentId],
    );
    const visibleEvent = await client.query(
      `insert into public.candidate_visible_events
         (candidate_id, application_id, event_type, label, source_type, source_id)
       values ($1,$2,'help_requested','Merge regression','test',$3) returning id`,
      [mergedId, ids.applicationC1, crypto.randomUUID()],
    );

    const applied = await commitAs(
      client,
      ids.hqAdmin,
      `select public.apply_candidate_merge($1,$2,$3,'[]'::jsonb,'{}'::jsonb,'{"requestedBy":"db-test"}'::jsonb) as event_id`,
      [primaryId, mergedId, linkId],
    );
    const eventId = firstRow(applied).event_id as string;

    const moved = await client.query(
      `select
         (select candidate_id from public.candidate_consents where id = $2) consent_candidate,
         (select candidate_id from public.assessment_assignments where id = $3) assessment_candidate,
         (select candidate_id from public.interview_assignments where id = $4) interview_candidate,
         (select candidate_id from public.result_share_grants where id = $5) share_candidate,
         (select candidate_id from public.candidate_visible_events where id = $6) event_candidate,
         (select candidate_id from public.candidate_field_provenance where id = $7) provenance_candidate,
         (select is_searchable from public.candidate_search_visibility where candidate_id = $1) is_searchable,
         (select array_agg(role order by role) from unnest((select desired_roles from public.candidate_preferences where candidate_id = $1)) role) roles`,
      [
        primaryId,
        consentId,
        assessmentId,
        interview.rows[0].id,
        resultShare.rows[0].id,
        visibleEvent.rows[0].id,
        provenance.rows[0].id,
      ],
    );
    expect(moved.rows[0]).toMatchObject({
      consent_candidate: primaryId,
      assessment_candidate: primaryId,
      interview_candidate: primaryId,
      share_candidate: primaryId,
      event_candidate: primaryId,
      provenance_candidate: primaryId,
      is_searchable: false,
      roles: ["Duplicate role", "Primary role"],
    });

    await commitAs(
      client,
      ids.hqAdmin,
      `select public.revert_candidate_merge($1, '{}'::jsonb, 'merge regression complete')`,
      [eventId],
    );
    const restored = await client.query(
      `select
         (select candidate_id from public.candidate_consents where id = $2) consent_candidate,
         (select candidate_id from public.assessment_assignments where id = $3) assessment_candidate,
         (select candidate_id from public.interview_assignments where id = $4) interview_candidate,
         (select candidate_id from public.result_share_grants where id = $5) share_candidate,
         (select candidate_id from public.candidate_visible_events where id = $6) event_candidate,
         (select candidate_id from public.candidate_field_provenance where id = $7) provenance_candidate,
         (select is_searchable from public.candidate_search_visibility where candidate_id = $1) duplicate_searchable`,
      [
        mergedId,
        consentId,
        assessmentId,
        interview.rows[0].id,
        resultShare.rows[0].id,
        visibleEvent.rows[0].id,
        provenance.rows[0].id,
      ],
    );
    expect(restored.rows[0]).toMatchObject({
      consent_candidate: mergedId,
      assessment_candidate: mergedId,
      interview_candidate: mergedId,
      share_candidate: mergedId,
      event_candidate: mergedId,
      provenance_candidate: mergedId,
      duplicate_searchable: false,
    });
  });

  it("keeps the merge queue away from employers, recruiters, and candidates", async () => {
    await seedLink();
    for (const table of ["candidate_duplicate_links", "candidate_merge_events"]) {
      for (const actor of [
        ids.employerUserA,
        ids.recruiterA,
        ids.candidate1,
        ids.franchiseAdminA,
      ]) {
        const { rows } = await queryAs(
          client,
          actor,
          `select count(*)::int c from public.${table}`,
        );
        expect(countOf({ rows })).toBe(0);
      }
      const hq = await queryAs(client, ids.hqAdmin, `select count(*)::int c from public.${table}`);
      expect(countOf(hq)).toBeGreaterThanOrEqual(0);
    }

    // HQ can actually see the link; the zero above is a policy result, not an
    // empty table.
    const hqLinks = await queryAs(
      client,
      ids.hqAdmin,
      `select count(*)::int c from public.candidate_duplicate_links`,
    );
    expect(countOf(hqLinks)).toBeGreaterThan(0);
  });
});

describeDb("staged Zoho candidate import", () => {
  let client: Client;
  let ids: SeedIds;
  let batchId: string;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);

    const { rows: conn } = await client.query(
      `insert into public.zoho_recruit_connections (connection_key, status)
       values ('import-test','connected') returning id`,
    );
    const { rows: batch } = await client.query(
      `insert into public.zoho_candidate_import_batches (connection_id, is_dry_run)
       values ($1, true) returning id`,
      [conn[0].id],
    );
    batchId = batch[0].id;
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  it("ships with both import gates off", async () => {
    const { rows } = await client.query(
      `select key, is_enabled from public.feature_flags
        where key like 'zoho_candidate_import%' order by key`,
    );
    expect(rows).toEqual([
      { key: "zoho_candidate_import_enabled", is_enabled: false },
      { key: "zoho_candidate_import_write_enabled", is_enabled: false },
    ]);
  });

  it("refuses a quarantined record with no stated reason", async () => {
    await expect(
      client.query(
        `insert into public.zoho_candidate_import_records
           (batch_id, zoho_record_id, status, quarantine_reasons)
         values ($1,'z-no-reason','quarantined','{}')`,
        [batchId],
      ),
    ).rejects.toThrow(/ck_zoho_import_quarantine_has_reason/);
  });

  it("accepts a quarantined record that says why", async () => {
    await client.query(
      `insert into public.zoho_candidate_import_records
         (batch_id, zoho_record_id, status, quarantine_reasons)
       values ($1,'z-quarantined','quarantined','{missing_contact}')`,
      [batchId],
    );
    const { rows } = await client.query(
      `select quarantine_reasons from public.zoho_candidate_import_records
        where batch_id = $1 and zoho_record_id = 'z-quarantined'`,
      [batchId],
    );
    expect(rows[0].quarantine_reasons).toEqual(["missing_contact"]);
  });

  it("refuses a decision with no named reviewer", async () => {
    await expect(
      client.query(
        `insert into public.zoho_candidate_import_records
           (batch_id, zoho_record_id, status, decision)
         values ($1,'z-no-reviewer','matched','link_existing')`,
        [batchId],
      ),
    ).rejects.toThrow(/ck_zoho_import_review_has_actor/);
  });

  it("refuses to mark a dry-run batch's record as written", async () => {
    await expect(
      client.query(
        `insert into public.zoho_candidate_import_records (batch_id, zoho_record_id, status)
         values ($1,'z-dry-upsert','upserted')`,
        [batchId],
      ),
    ).rejects.toThrow(/dry-run batch cannot upsert/);
  });

  it("keeps staging tables server-only — every browser role is denied", async () => {
    for (const table of ["zoho_candidate_import_batches", "zoho_candidate_import_records"]) {
      for (const actor of [ids.hqAdmin, ids.recruiterA, ids.employerUserA, ids.candidate1]) {
        await expect(queryAs(client, actor, `select * from public.${table}`)).rejects.toThrow(
          /permission denied/,
        );
      }
    }
  });

  it("purges a batch's staging rows without touching the external mapping ledger", async () => {
    const before = await client.query(
      `select count(*)::int c from public.zoho_recruit_external_mappings`,
    );
    await client.query(`select public.purge_zoho_candidate_import_batch($1)`, [batchId]);
    const remaining = await client.query(
      `select count(*)::int c from public.zoho_candidate_import_records where batch_id = $1`,
      [batchId],
    );
    const after = await client.query(
      `select count(*)::int c from public.zoho_recruit_external_mappings`,
    );
    expect(countOf(remaining)).toBe(0);
    expect(countOf(after)).toBe(before.rows[0].c);
  });
});

describeDb("work authorization", () => {
  let client: Client;
  let ids: SeedIds;
  let candidateId: string;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
    const { rows } = await client.query(
      `select id from public.candidate_profiles where user_id = $1`,
      [ids.candidate1],
    );
    candidateId = rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  it("ships with the feature flag off", async () => {
    const { rows } = await client.query(
      `select is_enabled from public.feature_flags where key = 'work_authorization_fields_enabled'`,
    );
    expect(rows[0].is_enabled).toBe(false);
  });

  it("is invisible to every role while the flag is off", async () => {
    await client.query(
      `insert into public.candidate_work_authorizations (candidate_id, eligibility_status)
       values ($1,'eligible_with_permit')`,
      [candidateId],
    );

    for (const actor of [ids.candidate1, ids.hqAdmin, ids.recruiterA, ids.employerUserA]) {
      const { rows } = await queryAs(
        client,
        actor,
        `select count(*)::int c from public.candidate_work_authorizations`,
      );
      expect(countOf({ rows })).toBe(0);
    }
  });

  it("becomes visible to its owner and HQ — and only them — once enabled", async () => {
    await client.query(
      `update public.feature_flags set is_enabled = true
        where key = 'work_authorization_fields_enabled'`,
    );
    try {
      const own = await queryAs(
        client,
        ids.candidate1,
        `select count(*)::int c from public.candidate_work_authorizations`,
      );
      expect(countOf(own)).toBe(1);

      const hq = await queryAs(
        client,
        ids.hqAdmin,
        `select count(*)::int c from public.candidate_work_authorizations`,
      );
      expect(countOf(hq)).toBe(1);

      for (const actor of [ids.employerUserA, ids.recruiterA, ids.candidate2]) {
        const { rows } = await queryAs(
          client,
          actor,
          `select count(*)::int c from public.candidate_work_authorizations`,
        );
        expect(countOf({ rows })).toBe(0);
      }
    } finally {
      await client.query(
        `update public.feature_flags set is_enabled = false
          where key = 'work_authorization_fields_enabled'`,
      );
    }
  });

  it("confines nationality, ethnicity and religion to candidate_profiles", async () => {
    // 20260813090000_candidate_source_demographics added these three columns to
    // candidate_profiles so an ATS migration can carry what the source system
    // held. The ban still applies everywhere else: no other table may acquire a
    // protected characteristic, and citizenship / national_origin remain absent
    // entirely. Using these values to screen, score, rank or report is still
    // prohibited — see nationality-ban.test.ts and no-nationality.test.ts.
    const { rows } = await client.query(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and (column_name ilike '%nationalit%'
            or column_name ilike '%citizenship%'
            or column_name ilike '%national_origin%'
            or column_name ilike '%ethnicit%'
            or column_name ilike '%religion%')
        order by table_name, column_name`,
    );
    expect(rows).toEqual([
      { table_name: "candidate_profiles", column_name: "ethnicity" },
      { table_name: "candidate_profiles", column_name: "nationality" },
      { table_name: "candidate_profiles", column_name: "religion" },
    ]);
  });
});
