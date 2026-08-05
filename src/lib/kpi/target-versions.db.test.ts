/**
 * DB-backed proof of the KPI target-version contract (Workstream A).
 *
 * Opt-in: runs only when DATABASE_URL is set (CI provides an ephemeral
 * Postgres). Asserts the trigger side of the acceptance criterion —
 * "changing a target creates a new version" — that the pure resolver in
 * target-versions.test.ts cannot cover.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { connect, setupDb, hasDb, type SeedIds } from "@/test/db/helpers";
import type { Client } from "pg";
import { resolveTargetsAt, type TargetVersionRecord } from "@/lib/kpi/target-versions";
import { toTargetVersion, type RecruiterKpiTargetVersionRow } from "@/lib/kpi/db-extensions";

const describeDb = hasDb ? describe : describe.skip;

const DEFAULTS = {
  maxTimeToFirstReviewHours: 48,
  maxTimeToClientSubmissionDays: 14,
  timeToFillDays: 14,
  placementRatePct: 70,
  interviewConversionPct: 40,
  clientSubmissionAcceptancePct: 40,
  offerToHireRatioPct: 50,
  maxActiveWorkload: 40,
  maxStalledApplicationCount: 10,
  appsReviewedPerWeek: 20,
};

describeDb("recruiter_kpi_target_versions", () => {
  let client: Client;
  let ids: SeedIds;

  beforeAll(async () => {
    client = await connect();
    ids = await setupDb(client);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
  });

  async function versionsFor(level: string): Promise<TargetVersionRecord[]> {
    const { rows } = await client.query(
      `select * from public.recruiter_kpi_target_versions
       where recruiter_level = $1 order by effective_from asc`,
      [level],
    );
    return (rows as RecruiterKpiTargetVersionRow[]).map((r) => toTargetVersion(r, DEFAULTS));
  }

  it("backfills one open version per existing target", async () => {
    const { rows } = await client.query(
      `select count(*)::int as targets,
              (select count(*)::int from public.recruiter_kpi_target_versions
                where superseded_at is null) as open_versions
       from public.recruiter_kpi_targets`,
    );
    expect(rows[0].targets).toBeGreaterThan(0);
    expect(rows[0].open_versions).toBe(rows[0].targets);
  });

  it("creates a new version on update and closes the previous one", async () => {
    const before = await versionsFor("recruiter");
    expect(before.length).toBeGreaterThan(0);

    await client.query(
      `update public.recruiter_kpi_targets
       set target_placement_rate_pct = 99
       where recruiter_level = 'recruiter' and organization_id is null`,
    );

    const after = await versionsFor("recruiter");
    expect(after.length).toBe(before.length + 1);

    const open = after.filter((v) => v.supersededAt == null);
    expect(open).toHaveLength(1);
    expect(open[0]!.metrics.placementRatePct).toBe(99);

    // The previously-open version was closed, not rewritten.
    const closed = after.filter((v) => v.supersededAt != null);
    expect(closed.length).toBe(after.length - 1);
    expect(closed.every((v) => v.supersededAt! >= v.effectiveFrom)).toBe(true);
  });

  it("recomputing a closed past period still uses the old version", async () => {
    const versions = await versionsFor("recruiter");
    const superseded = versions.find((v) => v.supersededAt != null);
    expect(superseded).toBeDefined();

    // A period that ended before the change → old target.
    const past = resolveTargetsAt({
      versions,
      recruiterLevel: "recruiter",
      organizationId: null,
      atIso: superseded!.effectiveFrom,
      platformDefaults: DEFAULTS,
    });
    expect(past.targetVersionId).toBe(superseded!.id);
    expect(past.metrics.placementRatePct).not.toBe(99);

    // An open period → current target.
    const now = new Date().toISOString();
    const current = resolveTargetsAt({
      versions,
      recruiterLevel: "recruiter",
      organizationId: null,
      atIso: now,
      platformDefaults: DEFAULTS,
    });
    expect(current.metrics.placementRatePct).toBe(99);
  });

  it("is append-only: deletes are rejected and payload columns are immutable", async () => {
    const { rows } = await client.query(
      `select id from public.recruiter_kpi_target_versions limit 1`,
    );
    const id = rows[0].id as string;

    await expect(
      client.query(`delete from public.recruiter_kpi_target_versions where id = $1`, [id]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      client.query(
        `update public.recruiter_kpi_target_versions set metrics = '{}'::jsonb where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/i);

    await expect(
      client.query(
        `update public.recruiter_kpi_target_versions
         set effective_from = now() where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/append-only/i);
  });

  it("does not re-close an already superseded window", async () => {
    const { rows } = await client.query(
      `select id from public.recruiter_kpi_target_versions
       where superseded_at is not null limit 1`,
    );
    if (rows.length === 0) return;
    await expect(
      client.query(
        `update public.recruiter_kpi_target_versions set superseded_at = now() where id = $1`,
        [rows[0].id],
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it("closes the open version when its current target is deleted", async () => {
    const inserted = await client.query(
      `insert into public.recruiter_kpi_targets
         (recruiter_level, organization_id, target_placement_rate_pct)
       values ('head_recruiter', $1, 97)
       returning id`,
      [ids.franchiseB],
    );
    const targetId = inserted.rows[0]?.id as string;
    const version = await client.query(
      `select id from public.recruiter_kpi_target_versions
       where target_id = $1 and superseded_at is null`,
      [targetId],
    );
    const versionId = version.rows[0]?.id as string;
    expect(versionId).toBeTruthy();

    await client.query(`delete from public.recruiter_kpi_targets where id = $1`, [targetId]);

    const closed = await client.query(
      `select target_id, superseded_at
       from public.recruiter_kpi_target_versions where id = $1`,
      [versionId],
    );
    expect(closed.rows[0]?.target_id).toBeNull();
    expect(closed.rows[0]?.superseded_at).not.toBeNull();

    const future = resolveTargetsAt({
      versions: await versionsFor("head_recruiter"),
      recruiterLevel: "head_recruiter",
      organizationId: ids.franchiseB,
      atIso: "2099-01-01T00:00:00.000Z",
      platformDefaults: DEFAULTS,
    });
    expect(future.source).toBe("platform");
    expect(future.targetVersionId).not.toBe(versionId);
  });
});
