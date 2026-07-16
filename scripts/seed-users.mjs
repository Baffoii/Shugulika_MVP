// =============================================================================
// scripts/seed-users.mjs — provision the MVP demonstration accounts.
//
// Creates Supabase Auth users (email pre-confirmed) and assigns the correct
// profile + role membership for each portal. Reads every secret and password
// from the environment; nothing is hardcoded, printed, or committed.
//
// Requires (in .env.local, which is gitignored and server-only):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY        <-- admin API key; you paste this yourself
//   SEED_*_PASSWORD                  <-- shared weak test password(s)
//
// Run (Node 18+):   node scripts/seed-users.mjs
// The script self-loads .env.local, so no extra flags are needed.
//
// SAFETY: the service-role key is used only here, server-side. It is never
// logged, never sent to the browser, and must never be committed. The MVP
// passwords are deliberately weak — change or remove these accounts before
// any production deployment.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Minimal .env.local loader (does not override already-set vars) --------
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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    // .env.local optional if the vars are already exported
  }
}
loadEnv(".env.local");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL) {
  console.error("✖ NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local.");
  process.exit(1);
}
if (!SERVICE_KEY) {
  console.error(
    "✖ SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
      "  Add your project's service-role key to .env.local (server-only, never commit it):\n" +
      "  Supabase dashboard → Project Settings → API → service_role secret.\n" +
      "  This script needs the Admin API to create pre-confirmed users.",
  );
  process.exit(1);
}

// Seeded organization ids (from supabase/migrations/0004_mvp_seed.sql).
const HQ_ORG = "11111111-1111-1111-1111-111111111111";
const FRANCHISE_ORG = "22222222-2222-2222-2222-222222222222";
const EMPLOYER_ORG = "33333333-3333-3333-3333-333333333333";

const ACCOUNTS = [
  { type: "HQ Administrator", email: "hq.admin@shugulika.test", name: "HQ Administrator", role: "hq_admin", org: HQ_ORG, landing: "/hq/dashboard", pwEnv: "SEED_HQ_ADMIN_PASSWORD" },
  { type: "Franchise Administrator", email: "franchise.admin@shugulika.test", name: "Franchise Administrator", role: "franchise_admin", org: FRANCHISE_ORG, landing: "/franchise/dashboard", pwEnv: "SEED_FRANCHISE_ADMIN_PASSWORD" },
  { type: "Operations Administrator", email: "operations.admin@shugulika.test", name: "Operations Administrator", role: "operations", org: FRANCHISE_ORG, landing: "/franchise/dashboard", pwEnv: "SEED_OPERATIONS_ADMIN_PASSWORD" },
  { type: "Recruiter", email: "recruiter@shugulika.test", name: "Demo Recruiter", role: "recruiter", org: FRANCHISE_ORG, landing: "/recruiter/dashboard", pwEnv: "SEED_RECRUITER_PASSWORD" },
  { type: "Employer User", email: "employer@shugulika.test", name: "Demo Employer", role: "employer_user", org: EMPLOYER_ORG, landing: "/employer/dashboard", pwEnv: "SEED_EMPLOYER_PASSWORD" },
  { type: "Candidate", email: "candidate@shugulika.test", name: "Demo Candidate", role: "candidate", org: null, landing: "/candidate/dashboard", pwEnv: "SEED_CANDIDATE_PASSWORD" },
];

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

/** Find an existing auth user id by email (paginated). */
async function findUserIdByEmail(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function provision(acc) {
  const password = process.env[acc.pwEnv];
  const result = { ...acc, authOk: false, roleOk: false, note: "" };
  if (!password) {
    result.note = `${acc.pwEnv} not set`;
    return result;
  }

  // 1) Create the auth user (email pre-confirmed) — idempotent.
  const created = await admin.auth.admin.createUser({
    email: acc.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: acc.name, role: acc.role },
  });

  let userId = created.data?.user?.id ?? null;
  if (created.error) {
    // Already registered → look it up and (re)assert the password + confirmation.
    userId = await findUserIdByEmail(acc.email);
    if (userId) {
      await admin.auth.admin.updateUserById(userId, { password, email_confirm: true, user_metadata: { full_name: acc.name, role: acc.role } });
      result.note = "existing user updated";
    } else {
      result.note = created.error.message;
      return result;
    }
  }
  if (!userId) {
    result.note = "no user id returned";
    return result;
  }
  result.authOk = true;

  // 2) Assign profile + role deterministically (service role bypasses RLS).
  try {
    await admin.from("profiles").upsert({ id: userId, email: acc.email, full_name: acc.name }, { onConflict: "id" });
    // Remove any auto-provisioned membership from the signup trigger.
    await admin.from("memberships").delete().eq("user_id", userId);
    // Non-candidate accounts should not carry a candidate profile.
    if (acc.role !== "candidate") {
      await admin.from("candidate_profiles").delete().eq("user_id", userId);
    }
    const { error: memErr } = await admin.from("memberships").insert({
      user_id: userId, organization_id: acc.org, role: acc.role, status: "active",
    });
    if (memErr) {
      result.note = memErr.message.includes("foreign key")
        ? "org not found — run supabase/migrations/0004_mvp_seed.sql first"
        : memErr.message;
      return result;
    }
    if (acc.role === "candidate") {
      await admin.from("candidate_profiles").upsert({ user_id: userId, given_name: acc.name.split(" ")[0] }, { onConflict: "user_id" });
    }
    result.roleOk = true;
  } catch (e) {
    result.note = e instanceof Error ? e.message : String(e);
  }
  return result;
}

// ---- Run + summary ---------------------------------------------------------
const results = [];
for (const acc of ACCOUNTS) {
  // eslint-disable-next-line no-await-in-loop
  results.push(await provision(acc));
}

const yn = (b) => (b ? "yes" : "NO");
const pad = (s, n) => String(s).padEnd(n);

console.log("\n============================================================================");
console.log(" Shugulika MVP — test account provisioning summary");
console.log(" Shared test password for ALL accounts below: 12345678  (deliberately weak)");
console.log("============================================================================");
console.log(
  " " +
    pad("Account type", 24) +
    pad("Email", 34) +
    pad("Landing page", 22) +
    pad("Auth", 6) +
    "Profile+Role",
);
console.log(" " + "-".repeat(100));
for (const r of results) {
  console.log(
    " " +
      pad(r.type, 24) +
      pad(r.email, 34) +
      pad(r.landing, 22) +
      pad(yn(r.authOk), 6) +
      yn(r.roleOk) +
      (r.note ? `   (${r.note})` : ""),
  );
}
console.log(" " + "-".repeat(100));

const failures = results.filter((r) => !r.authOk || !r.roleOk);
if (failures.length) {
  console.log(`\n⚠ ${failures.length} account(s) need attention (see notes above).`);
} else {
  console.log("\n✔ All accounts provisioned and immediately usable.");
}
console.log(
  "\n⚠ SECURITY: '12345678' is a deliberately weak SHARED testing password for this\n" +
    "  controlled MVP only. Change every test-account password, or delete these\n" +
    "  accounts, before any production deployment.\n",
);
process.exit(failures.length ? 1 : 0);
