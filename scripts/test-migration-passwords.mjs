// =============================================================================
// scripts/test-migration-passwords.mjs — make migrated candidate accounts
// signable-in for the Zoho rehearsal.
//
// The candidate import creates one Supabase Auth user per candidate
// (canonical-upsert.ts → provisionCandidateAccount), but deliberately sets no
// password and leaves the email unconfirmed. That is correct for production:
// real candidates set their own password via an invite.
//
// A rehearsal needs to actually log in as those candidates, so this script
// assigns a shared weak password and confirms the email — but ONLY for accounts
// the importer created (`user_metadata.source === "zoho_import"`), and ONLY on
// a non-production project.
//
// Requires (in .env.local, gitignored and server-only):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ZOHO_TEST_MIGRATION=true            <-- explicit acknowledgement
//   TEST_MIGRATION_PASSWORD             <-- e.g. 12345678
//   PRODUCTION_SUPABASE_URL             <-- optional; refuses if it matches
//
// Run:   node scripts/test-migration-passwords.mjs [--dry-run]
//
// SAFETY: this hands every migrated candidate the same weak password. It exists
// for an isolated rehearsal project holding disposable data. Never point it at
// production, and delete the project when the rehearsal is done.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(file) {
  try {
    const text = readFileSync(resolve(__dirname, "..", file), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // No .env.local is fine when the values are already exported.
  }
}
loadEnv(".env.local");

const DRY_RUN = process.argv.includes("--dry-run");
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.TEST_MIGRATION_PASSWORD;

const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

// ---- Guards ---------------------------------------------------------------
// Same three fences as the test source, for the same reason: the cost of a
// mistake here is a production account pool with one shared weak password.
if (process.env.ZOHO_TEST_MIGRATION !== "true") {
  fail("Set ZOHO_TEST_MIGRATION=true to acknowledge this assigns a shared weak password.");
}
if (process.env.NODE_ENV === "production") {
  fail("NODE_ENV is production. This script is for rehearsal projects only.");
}
if (!URL) fail("NEXT_PUBLIC_SUPABASE_URL is not set, so the target project cannot be verified.");
if (!SERVICE_KEY) fail("SUPABASE_SERVICE_ROLE_KEY is not set.");
if (!PASSWORD) fail("TEST_MIGRATION_PASSWORD is not set.");
if (
  process.env.PRODUCTION_SUPABASE_URL &&
  URL.trim() === process.env.PRODUCTION_SUPABASE_URL.trim()
) {
  fail("NEXT_PUBLIC_SUPABASE_URL points at the production project. Refusing.");
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Every auth user the Zoho importer created, across all pages. */
async function listImportedUsers() {
  const found = [];
  for (let page = 1; page <= 500; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`Could not list users: ${error.message}`);
    for (const user of data.users) {
      if (user.user_metadata?.source === "zoho_import") found.push(user);
    }
    if (data.users.length < 200) break;
  }
  return found;
}

console.log(`Target project : ${URL}`);
console.log(`Mode           : ${DRY_RUN ? "DRY RUN (no writes)" : "APPLY"}`);

const users = await listImportedUsers();
console.log(`Migrated accounts found: ${users.length}`);

if (users.length === 0) {
  console.log("Nothing to do — run the candidate import first.");
  process.exit(0);
}

if (DRY_RUN) {
  for (const user of users.slice(0, 10)) console.log(`  would update ${user.email}`);
  if (users.length > 10) console.log(`  … and ${users.length - 10} more`);
  process.exit(0);
}

let updated = 0;
const failures = [];
for (const user of users) {
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password: PASSWORD,
    email_confirm: true,
  });
  // Check every write: a partial run must report honestly, not look complete.
  if (error) failures.push(`${user.email}: ${error.message}`);
  else updated += 1;
}

console.log(`\n✔ Updated ${updated}/${users.length} migrated candidate accounts.`);
if (failures.length) {
  console.error(`✖ ${failures.length} failed:`);
  for (const line of failures.slice(0, 20)) console.error(`   ${line}`);
  process.exit(1);
}
console.log(
  "\n⚠ Every migrated candidate now shares one weak password on this rehearsal\n" +
    "  project. Do not expose it publicly, and delete the project when finished.",
);
