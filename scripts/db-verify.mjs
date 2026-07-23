// =============================================================================
// scripts/db-verify.mjs — verify a migrated database matches expectations and
// that the hand-authored Supabase types stay in sync with the schema.
//
// Runs against DATABASE_URL (an ephemeral test DB in CI). Skips (exit 0) if
// DATABASE_URL is unset. Never prints secrets.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.log("• DATABASE_URL not set — skipping db:verify.");
  process.exit(0);
}

// Core tables + critical columns/constraints the app relies on.
const REQUIRED = {
  profiles: ["id", "email"],
  organizations: ["id", "org_type", "parent_id"],
  memberships: ["user_id", "organization_id", "role", "status"],
  candidate_profiles: ["user_id", "completion_pct"],
  candidate_documents: ["candidate_id", "bucket_id", "object_path", "is_primary"],
  candidate_consents: ["candidate_id", "purpose", "covered_org_id", "withdrawn_at"],
  job_orders: [
    "employer_org_id",
    "responsible_org_id",
    "recruitment_path",
    "status",
    "assessment_mode",
    "assessment_seniority",
    "assessment_pass_threshold",
    "assessment_file_path",
  ],
  jobs: ["job_order_id", "status", "public_slug"],
  applications: ["candidate_id", "job_order_id", "owning_org_id", "current_stage"],
  assessment_assignments: [
    "application_id",
    "job_order_id",
    "candidate_id",
    "assessment_mode",
    "status",
    "assigned_by",
    "human_review_required",
    "grading_payload",
  ],
  job_order_assessment_files: ["job_order_id", "kind", "object_path", "file_name"],
  application_stage_history: ["application_id", "from_stage", "to_stage"],
  recruiter_notes: ["owning_org_id", "visibility"],
  employer_submissions: ["employer_org_id", "submitting_org_id", "status", "access_revoked_at"],
  invoices: ["owning_org_id", "status", "payment_status"],
  audit_logs: ["actor_id", "action", "entity_type"],
};
const REQUIRED_VIEWS = ["public_jobs", "apply_targets"];

const errors = [];
const warnings = [];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const cols = (
  await client.query(
    `select table_name, column_name from information_schema.columns where table_schema='public'`,
  )
).rows;
const byTable = new Map();
for (const { table_name, column_name } of cols) {
  if (!byTable.has(table_name)) byTable.set(table_name, new Set());
  byTable.get(table_name).add(column_name);
}

for (const [table, columns] of Object.entries(REQUIRED)) {
  if (!byTable.has(table)) {
    errors.push(`Missing table: public.${table}`);
    continue;
  }
  for (const c of columns) {
    if (!byTable.get(table).has(c)) errors.push(`Missing column: public.${table}.${c}`);
  }
}

const views = (
  await client.query(`select table_name from information_schema.views where table_schema='public'`)
).rows.map((r) => r.table_name);
for (const v of REQUIRED_VIEWS) if (!views.includes(v)) errors.push(`Missing view: public.${v}`);

// RLS must be enabled on the sensitive tables, and policies must exist.
const rls = (
  await client.query(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r'`,
  )
).rows;
for (const t of [
  "applications",
  "employer_submissions",
  "recruiter_notes",
  "candidate_profiles",
  "invoices",
  "assessment_assignments",
]) {
  const row = rls.find((r) => r.relname === t);
  if (row && !row.relrowsecurity) errors.push(`RLS not enabled on public.${t}`);
}
const policyCount = (
  await client.query(`select count(*)::int c from pg_policies where schemaname='public'`)
).rows[0].c;
if (policyCount < 40) errors.push(`Too few RLS policies (${policyCount}); expected the full set.`);

// Types-in-sync check: every table declared in database.types.ts must exist,
// and every base table should be typed (warn only, to avoid blocking on new WIP).
try {
  const typesSrc = readFileSync(resolve(__dirname, "..", "src/lib/database.types.ts"), "utf8");
  const tablesBlock = typesSrc.slice(typesSrc.indexOf("Tables: {"), typesSrc.indexOf("Views: {"));
  const typed = new Set([...tablesBlock.matchAll(/^\s{6}([a-z_]+):\s*Tbl</gm)].map((m) => m[1]));
  for (const t of typed) {
    if (!byTable.has(t))
      errors.push(`database.types.ts declares "${t}" but the table is missing in the DB.`);
  }
  const baseTables = rls.map((r) => r.relname).filter((n) => !n.startsWith("pg_"));
  for (const t of baseTables) {
    if (!typed.has(t))
      warnings.push(
        `Table public.${t} exists but is not in database.types.ts (types may be stale).`,
      );
  }
} catch (e) {
  warnings.push(`Could not run types-in-sync check: ${e instanceof Error ? e.message : String(e)}`);
}

await client.end();

for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✖ ${e}`);
  console.error(`\ndb:verify FAILED (${errors.length} error(s)).`);
  process.exit(1);
}
console.log(
  `✔ db:verify passed — ${Object.keys(REQUIRED).length} tables, ${REQUIRED_VIEWS.length} views, ${policyCount} RLS policies` +
    (warnings.length ? ` (${warnings.length} warning(s))` : "") +
    ".",
);
