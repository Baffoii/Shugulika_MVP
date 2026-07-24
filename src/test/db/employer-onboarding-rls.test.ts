import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "pg";
import { connect, setupDb, queryAs, commitAs, hasDb, type SeedIds } from "./helpers";

// Opt-in: runs only when DATABASE_URL points at an ephemeral test Postgres.
const d = hasDb ? describe : describe.skip;

/**
 * Employer onboarding — Workflow 1.
 * Asserts the geographic scoping, status machine, and atomic approval that the
 * spec requires to be enforced in database policies (not just queue filters).
 */
d("Employer onboarding applications", () => {
  let client: Client;
  let ids: SeedIds;

  // Fresh public sign-ups (employer_user with NO organization, via the trigger).
  const applicant1 = "f0000000-0000-4000-8000-000000000001";
  const applicant2 = "f0000000-0000-4000-8000-000000000002";
  // Franchise administrators for the two seeded franchises.
  const franchiseAdminA = "f0000000-0000-4000-8000-000000000011";
  const franchiseAdminB = "f0000000-0000-4000-8000-000000000012";

  let app1 = "";
  let app2 = "";
  let approvedOrgId = "";

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);

    for (const [id, email, role, name] of [
      [applicant1, "apply1@test.io", "employer_user", "Applicant One"],
      [applicant2, "apply2@test.io", "employer_user", "Applicant Two"],
      [franchiseAdminA, "fadminA@test.io", "candidate", "Franchise Admin A"],
      [franchiseAdminB, "fadminB@test.io", "candidate", "Franchise Admin B"],
    ]) {
      await client.query(
        `insert into auth.users (id, email, raw_user_meta_data)
           values ($1,$2, jsonb_build_object('role',$3::text,'full_name',$4::text))`,
        [id, email, role, name],
      );
    }
    // Promote the two admin users (the trigger clamped them to candidate).
    const admins = [franchiseAdminA, franchiseAdminB];
    await client.query(`delete from public.memberships where user_id = any($1::uuid[])`, [admins]);
    await client.query(`delete from public.candidate_profiles where user_id = any($1::uuid[])`, [
      admins,
    ]);
    await client.query(
      `insert into public.memberships (user_id, organization_id, role, status) values
         ($1,$3,'franchise_admin','active'), ($2,$4,'franchise_admin','active')`,
      [franchiseAdminA, franchiseAdminB, ids.franchiseA, ids.franchiseB],
    );
    // Distinct geographic coverage so region routing is testable: both seeded
    // franchises are TZ, so scope A to Dar es Salaam and B to Arusha.
    await client.query(
      `update public.organizations set coverage_regions = case id
         when $1::uuid then array['Dar es Salaam'] when $2::uuid then array['Arusha'] end
       where id in ($1::uuid, $2::uuid)`,
      [ids.franchiseA, ids.franchiseB],
    );
  }, 60_000);

  afterAll(async () => {
    await client?.end();
  });

  it("public employer sign-up produces an unscoped membership and no organization", async () => {
    const m = await queryAs(
      client,
      applicant1,
      `select organization_id, role, status from public.memberships where user_id = $1`,
      [applicant1],
    );
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]?.role).toBe("employer_user");
    expect(m.rows[0]?.organization_id).toBeNull();
  });

  it("an applicant can create and read their own draft; others cannot see it", async () => {
    const inserted = await commitAs(
      client,
      applicant1,
      `insert into public.employer_applications
         (applicant_user_id, legal_name, trading_name, organization_type, industry,
          company_size, website, country_code, region, city, physical_address,
          contact_name, contact_job_title, contact_email, contact_phone,
          contact_is_authorized, declared_accurate, declared_authorized, accepted_terms)
       values ($1, 'Acme Logistics Ltd', 'Acme', 'private_company', 'Logistics',
               '11-50', 'https://acme-logistics.example', 'TZ', 'Dar es Salaam',
               'Dar es Salaam', '12 Harbour Road', 'Applicant One', 'Managing Director',
               'apply1@test.io', '+255700000001', true, true, true, true)
       returning id`,
      [applicant1],
    );
    app1 = inserted.rows[0]?.id as string;
    expect(app1).toBeTruthy();

    const other = await queryAs(
      client,
      applicant2,
      `select count(*)::int c from public.employer_applications`,
    );
    expect(other.rows[0]?.c).toBe(0);
    // Draft is not visible to any franchise (not assigned yet).
    const staff = await queryAs(
      client,
      franchiseAdminA,
      `select count(*)::int c from public.employer_applications`,
    );
    expect(staff.rows[0]?.c).toBe(0);
  });

  it("an applicant cannot flip their own application to submitted directly", async () => {
    await expect(
      commitAs(
        client,
        applicant1,
        `update public.employer_applications set status = 'submitted' where id = $1 returning id`,
        [app1],
      ),
    ).rejects.toThrow(/row-level security|violates/i);
  });

  it("submission routes to the single eligible franchise for the geography", async () => {
    await commitAs(client, applicant1, `select public.submit_employer_application($1)`, [app1]);
    const row = await queryAs(
      client,
      applicant1,
      `select status, assigned_org_id, version from public.employer_applications where id = $1`,
      [app1],
    );
    expect(row.rows[0]?.status).toBe("submitted");
    expect(row.rows[0]?.assigned_org_id).toBe(ids.franchiseA);
    expect(row.rows[0]?.version).toBe(1);
    // Employer receives a confirmation notification.
    const notif = await queryAs(
      client,
      applicant1,
      `select count(*)::int c from public.notifications where user_id = $1 and category = 'employer_application'`,
      [applicant1],
    );
    expect(notif.rows[0]?.c).toBeGreaterThanOrEqual(1);
  });

  it("only the assigned, geographically eligible franchise (and HQ) can see it", async () => {
    const a = await queryAs(
      client,
      franchiseAdminA,
      `select count(*)::int c from public.employer_applications where id = $1`,
      [app1],
    );
    expect(a.rows[0]?.c).toBe(1);
    // Direct-id probe from the other franchise returns nothing.
    const b = await queryAs(
      client,
      franchiseAdminB,
      `select count(*)::int c from public.employer_applications where id = $1`,
      [app1],
    );
    expect(b.rows[0]?.c).toBe(0);
    const hq = await queryAs(
      client,
      ids.hqAdmin,
      `select count(*)::int c from public.employer_applications where id = $1`,
      [app1],
    );
    expect(hq.rows[0]?.c).toBe(1);
  });

  it("internal reviewer notes are never visible to the applicant", async () => {
    await commitAs(client, franchiseAdminA, `select public.add_employer_application_note($1,$2)`, [
      app1,
      "Website checks out; approve after phone verification.",
    ]);
    const reviewer = await queryAs(
      client,
      franchiseAdminA,
      `select count(*)::int c from public.employer_application_events where application_id = $1 and action = 'note'`,
      [app1],
    );
    expect(reviewer.rows[0]?.c).toBe(1);
    const applicant = await queryAs(
      client,
      applicant1,
      `select count(*)::int c from public.employer_application_events where application_id = $1 and action = 'note'`,
      [app1],
    );
    expect(applicant.rows[0]?.c).toBe(0);
    // The submitted event itself IS visible to the applicant.
    const visible = await queryAs(
      client,
      applicant1,
      `select count(*)::int c from public.employer_application_events where application_id = $1`,
      [app1],
    );
    expect(visible.rows[0]?.c).toBeGreaterThanOrEqual(1);
  });

  it("changes requested reopens editing; resubmission bumps the version", async () => {
    await commitAs(
      client,
      franchiseAdminA,
      `select public.request_employer_application_changes($1,$2,$3::jsonb)`,
      [
        app1,
        "Please confirm the registered company name spelling.",
        JSON.stringify([{ field: "legal_name", instruction: "Match the certificate spelling." }]),
      ],
    );
    // The applicant can edit again while changes are requested…
    await commitAs(
      client,
      applicant1,
      `update public.employer_applications set legal_name = 'Acme Logistics Limited' where id = $1 returning id`,
      [app1],
    );
    // …and resubmit, which preserves history via a new version.
    await commitAs(client, applicant1, `select public.submit_employer_application($1)`, [app1]);
    const row = await queryAs(
      client,
      applicant1,
      `select status, version from public.employer_applications where id = $1`,
      [app1],
    );
    expect(row.rows[0]?.status).toBe("submitted");
    expect(row.rows[0]?.version).toBe(2);
  });

  it("approval atomically activates the org and the scoped first-admin membership", async () => {
    const res = await commitAs(
      client,
      franchiseAdminA,
      `select public.approve_employer_application($1) as org_id`,
      [app1],
    );
    const orgId = res.rows[0]?.org_id as string;
    expect(orgId).toBeTruthy();
    approvedOrgId = orgId;

    const org = (
      await client.query(
        `select org_type, status, verification_status, parent_id, name from public.organizations where id = $1`,
        [orgId],
      )
    ).rows[0];
    expect(org).toMatchObject({
      org_type: "employer",
      status: "active",
      verification_status: "verified",
      parent_id: ids.franchiseA,
      name: "Acme Logistics Limited",
    });

    const memberships = (
      await client.query(
        `select organization_id, status, is_org_admin from public.memberships
         where user_id = $1 and role = 'employer_user' order by created_at`,
        [applicant1],
      )
    ).rows;
    // Original unscoped membership ended; exactly one active scoped admin membership.
    expect(memberships.filter((m) => m.status === "active")).toHaveLength(1);
    const active = memberships.find((m) => m.status === "active");
    expect(active?.organization_id).toBe(orgId);
    expect(active?.is_org_admin).toBe(true);
    expect(memberships.some((m) => m.status === "ended" && m.organization_id === null)).toBe(true);

    const app = (
      await client.query(
        `select status, resulting_org_id from public.employer_applications where id = $1`,
        [app1],
      )
    ).rows[0];
    expect(app?.status).toBe("approved");
    expect(app?.resulting_org_id).toBe(orgId);
  });

  it("the approved admin may edit ordinary fields but not sensitive ones", async () => {
    // Ordinary company details are directly editable post-approval.
    await commitAs(
      client,
      applicant1,
      `update public.organizations
         set website = 'https://acme.example', city = 'Dodoma', trading_name = 'Acme TZ'
       where id = $1 returning id`,
      [approvedOrgId],
    );
    const org = (
      await client.query(`select website, city from public.organizations where id = $1`, [
        approvedOrgId,
      ])
    ).rows[0];
    expect(org?.city).toBe("Dodoma");

    // Registered legal name / country / responsible office require review.
    for (const set of [
      `name = 'Totally Different Ltd'`,
      `country_code = 'KE'`,
      `parent_id = null`,
      `verification_status = 'pending'`,
    ]) {
      await expect(
        commitAs(
          client,
          applicant1,
          `update public.organizations set ${set} where id = $1 returning id`,
          [approvedOrgId],
        ),
      ).rejects.toThrow(/require Shugulika review/i);
    }

    // HQ can still change sensitive fields.
    await commitAs(
      client,
      ids.hqAdmin,
      `update public.organizations set name = 'Acme Logistics Limited' where id = $1 returning id`,
      [approvedOrgId],
    );
  });

  it("HQ reassignment respects geographic eligibility and moves queue access", async () => {
    const inserted = await commitAs(
      client,
      applicant2,
      `insert into public.employer_applications
         (applicant_user_id, legal_name, organization_type, industry, company_size,
          country_code, region, city, physical_address, contact_name, contact_job_title,
          contact_email, contact_phone, contact_is_authorized,
          declared_accurate, declared_authorized, accepted_terms)
       values ($1, 'Kilima Farms Ltd', 'private_company', 'Agriculture', '1-10',
               'TZ', 'Dar es Salaam', 'Dar es Salaam', '3 Uhuru Street',
               'Applicant Two', 'Owner', 'apply2@test.io', '+255700000002',
               true, true, true, true)
       returning id`,
      [applicant2],
    );
    app2 = inserted.rows[0]?.id as string;
    await commitAs(client, applicant2, `select public.submit_employer_application($1)`, [app2]);

    // Franchise B is not eligible for Dar es Salaam — HQ cannot assign it there.
    await expect(
      commitAs(client, ids.hqAdmin, `select public.reassign_employer_application($1,$2)`, [
        app2,
        ids.franchiseB,
      ]),
    ).rejects.toThrow(/not eligible/i);
    // A franchise admin can never reassign.
    await expect(
      commitAs(client, franchiseAdminA, `select public.reassign_employer_application($1,null)`, [
        app2,
      ]),
    ).rejects.toThrow(/Only HQ/i);

    // HQ pulls it into the HQ queue → franchise A immediately loses access.
    await commitAs(client, ids.hqAdmin, `select public.reassign_employer_application($1,null)`, [
      app2,
    ]);
    const a = await queryAs(
      client,
      franchiseAdminA,
      `select count(*)::int c from public.employer_applications where id = $1`,
      [app2],
    );
    expect(a.rows[0]?.c).toBe(0);
  });

  it("rejection records the reason and allows a linked revised application", async () => {
    await commitAs(
      client,
      ids.hqAdmin,
      `select public.reject_employer_application($1,'information_mismatch',$2,true,$3)`,
      [app2, "The company address could not be confirmed.", "Registry lookup returned no match."],
    );
    const app = (
      await client.query(
        `select status, rejection_category, reapply_allowed from public.employer_applications where id = $1`,
        [app2],
      )
    ).rows[0];
    expect(app?.status).toBe("rejected");
    expect(app?.rejection_category).toBe("information_mismatch");
    expect(app?.reapply_allowed).toBe(true);
    // No access was granted: applicant2 still has no scoped membership.
    const active = (
      await client.query(
        `select count(*)::int c from public.memberships
         where user_id = $1 and status = 'active' and organization_id is not null`,
        [applicant2],
      )
    ).rows[0];
    expect(active?.c).toBe(0);

    const revised = await commitAs(
      client,
      applicant2,
      `select public.start_revised_employer_application($1) as id`,
      [app2],
    );
    const newId = revised.rows[0]?.id as string;
    const draft = (
      await client.query(
        `select status, previous_application_id, legal_name from public.employer_applications where id = $1`,
        [newId],
      )
    ).rows[0];
    expect(draft?.status).toBe("draft");
    expect(draft?.previous_application_id).toBe(app2);
    expect(draft?.legal_name).toBe("Kilima Farms Ltd");
  });
});
