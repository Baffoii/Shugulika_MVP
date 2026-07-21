/**
 * Postgres-backed RLS test harness. Opt-in: only runs when DATABASE_URL is set
 * (CI provides an ephemeral Postgres service; never point this at production).
 *
 * It resets the public schema, installs a Supabase-compatible shim
 * (auth/storage/roles + a JWT-claims-based auth.uid()), applies the full
 * migration history (skipping the destructive reset + the real-auth seed), and
 * seeds two franchises so tenant isolation can be asserted.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIG = join(process.cwd(), "supabase", "migrations");
const readSql = (f: string) => readFileSync(join(MIG, f), "utf8");

export const hasDb = !!process.env.DATABASE_URL;

// Mirrors Supabase: auth.uid() derives from the request.jwt.claims GUC, so RLS
// behaves exactly as in production when we set that claim per query.
const SHIM = `
-- Fresh auth/storage each run so re-applying the migrations is deterministic
-- (CI uses an ephemeral DB; this makes local re-runs idempotent too).
drop schema if exists auth cascade;
drop schema if exists storage cascade;
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant anon, authenticated, service_role to current_user;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}',
  raw_app_meta_data jsonb default '{}', created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon')
$$;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
`;

const RESET = `drop schema if exists public cascade; create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to service_role;`;

export interface SeedIds {
  hq: string;
  franchiseA: string;
  franchiseB: string;
  employerA: string;
  employerB: string;
  candidate1: string; // user id
  candidate2: string;
  recruiterA: string;
  recruiterB: string;
  employerUserA: string;
  jobOrderA: string;
  applicationC1: string; // candidate1 application (owned by franchise A)
  submissionC1: string; // candidate1 submitted to employerA
}

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** Fully rebuild the schema + seed. Returns the ids the tests assert against. */
export async function setupDb(client: Client): Promise<SeedIds> {
  // SHIM first: it creates the anon/authenticated/service_role roles + auth/storage
  // schemas that RESET's grants (and the migrations) depend on.
  await client.query(SHIM);
  await client.query(RESET);
  // Apply the FULL migration history in order so the harness schema matches
  // production (not a hardcoded subset). pgcrypto/citext live in public, which
  // RESET dropped — migration 0001 re-creates them. Three files are intentionally
  // skipped:
  //   0000 — a destructive public-schema reset (RESET above already did that);
  //   0005 — seeds real Supabase auth.users/auth.identities rows using columns
  //          the lightweight auth shim doesn't have. The harness seeds its own
  //          users below, so this convenience seed isn't needed (or applicable);
  //   0015 — the same: a demo-data seed that writes real Supabase
  //          auth.users/auth.identities (encrypted_password, identities, …). It
  //          adds no schema/RLS, so skipping it keeps harness schema parity.
  const SKIP = new Set([
    "0000_reset_public_schema.sql",
    "0005_seed_test_users.sql",
    "0015_demo_expansion.sql",
  ]);
  const migrations = readdirSync(MIG)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !SKIP.has(f))
    .sort();
  for (const f of migrations) {
    await client.query(readSql(f));
  }

  const hq = "11111111-1111-1111-1111-111111111111";
  const franchiseA = "22222222-2222-2222-2222-222222222222";
  const employerA = "33333333-3333-3333-3333-333333333333";
  const franchiseB = "b2222222-2222-2222-2222-222222222222";
  const employerB = "b3333333-3333-3333-3333-333333333333";

  // Second franchise + its employer (franchise A/employer A come from 0004).
  await client.query(
    `insert into public.organizations (id, org_type, name, country_code, parent_id, status, verification_status) values
       ($1,'franchise','Shugulika Kenya (Nairobi)','TZ',$2,'active','verified'),
       ($3,'employer','Nairobi Retail Co','TZ',$1,'active','verified')`,
    [franchiseB, hq, employerB],
  );

  // Users via the auth trigger, then fix staff roles (trigger clamps to candidate).
  // Named ids (not a destructured .map) so they stay typed as `string` under
  // noUncheckedIndexedAccess.
  const c1 = "a0000000-0000-4000-8000-000000000001";
  const c2 = "a0000000-0000-4000-8000-000000000002";
  const recA = "a0000000-0000-4000-8000-000000000011";
  const recB = "a0000000-0000-4000-8000-000000000012";
  const empUserA = "a0000000-0000-4000-8000-000000000021";
  const users: Array<[string, string, string, string]> = [
    [c1, "cand1@test.io", "candidate", "Cand One"],
    [c2, "cand2@test.io", "candidate", "Cand Two"],
    [recA, "recA@test.io", "recruiter", "Recruiter A"],
    [recB, "recB@test.io", "recruiter", "Recruiter B"],
    [empUserA, "empA@test.io", "employer_user", "Employer A User"],
  ];
  for (const [id, email, role, name] of users) {
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1,$2, jsonb_build_object('role',$3::text,'full_name',$4::text))`,
      [id, email, role, name],
    );
  }

  // Staff memberships (remove the trigger's clamped candidate rows first).
  // node-postgres allows one statement per parameterized query, so run each.
  const staff = [recA, recB, empUserA];
  await client.query(`delete from public.memberships where user_id = any($1::uuid[])`, [staff]);
  await client.query(`delete from public.candidate_profiles where user_id = any($1::uuid[])`, [
    staff,
  ]);
  await client.query(
    `insert into public.memberships (user_id, organization_id, role, status) values ($1,$2,'recruiter','active')`,
    [recA, franchiseA],
  );
  await client.query(
    `insert into public.memberships (user_id, organization_id, role, status) values ($1,$2,'recruiter','active')`,
    [recB, franchiseB],
  );
  await client.query(
    `insert into public.memberships (user_id, organization_id, role, status) values ($1,$2,'employer_user','active')`,
    [empUserA, employerA],
  );

  // A job order (franchise A / employer A) + candidate1 application owned by A.
  const jobOrderA = "c1000000-0000-4000-8000-000000000001";
  const applicationC1 = "d1000000-0000-4000-8000-000000000001";
  const submissionC1 = "e1000000-0000-4000-8000-000000000001";
  const cand1Profile = (
    await client.query(`select id from public.candidate_profiles where user_id=$1`, [c1])
  ).rows[0].id;

  await client.query(
    `insert into public.job_orders (id, employer_org_id, responsible_org_id, title, country_code, recruitment_path, status)
       values ($1,$2,$3,'Analyst','TZ','B','active')`,
    [jobOrderA, employerA, franchiseA],
  );
  await client.query(
    `insert into public.applications (id, candidate_id, job_order_id, owning_org_id, recruitment_path, current_stage, assigned_recruiter_id)
       values ($1,$2,$3,$4,'B','cv_review',$5)`,
    [applicationC1, cand1Profile, jobOrderA, franchiseA, recA],
  );
  await client.query(
    `insert into public.employer_submissions (id, application_id, candidate_id, job_order_id, employer_org_id, submitting_org_id, status, submitted_at)
       values ($1,$2,$3,$4,$5,$6,'submitted', now())`,
    [submissionC1, applicationC1, cand1Profile, jobOrderA, employerA, franchiseA],
  );

  return {
    hq,
    franchiseA,
    franchiseB,
    employerA,
    employerB,
    candidate1: c1,
    candidate2: c2,
    recruiterA: recA,
    recruiterB: recB,
    employerUserA: empUserA,
    jobOrderA,
    applicationC1,
    submissionC1,
  };
}

/** Run a query as an authenticated user (sub = userId) or anon (userId null). */
export async function queryAs(
  client: Client,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: Array<Record<string, unknown>> }> {
  await client.query("begin");
  try {
    if (userId) {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
    } else {
      await client.query("set local role anon");
      await client.query("select set_config('request.jwt.claims', '', true)");
    }
    const res = await client.query(sql, params);
    return { rows: res.rows };
  } finally {
    await client.query("rollback");
  }
}

/** Run and commit a mutation as an authenticated user (use sparingly in isolated fixtures). */
export async function commitAs(
  client: Client,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<{ rows: Array<Record<string, unknown>> }> {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const res = await client.query(sql, params);
    await client.query("commit");
    return { rows: res.rows };
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
