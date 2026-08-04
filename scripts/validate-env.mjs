// =============================================================================
// scripts/validate-env.mjs — environment-variable validation for build/deploy.
//
// Fails (exit 1) when:
//   • a required public variable is missing (unless --soft),
//   • a server secret is exposed under a NEXT_PUBLIC_ name,
//   • the Supabase URL is malformed.
//
// Never prints secret VALUES — only names and pass/fail. Loads .env.local for
// local runs; in CI the values come from the job environment.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const soft = process.argv.includes("--soft");

function loadEnvFile(file) {
  try {
    for (const raw of readFileSync(resolve(__dirname, "..", file), "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}
loadEnvFile(".env.local");

const errors = [];
const warnings = [];

const REQUIRED_PUBLIC = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
for (const key of REQUIRED_PUBLIC) {
  if (!process.env[key]) (soft ? warnings : errors).push(`Missing required env var: ${key}`);
}

// A server secret must never be exposed to the browser via a NEXT_PUBLIC_ name.
const FORBIDDEN_PUBLIC =
  /^NEXT_PUBLIC_.*(SERVICE_ROLE|SERVICE_KEY|SECRET|PRIVATE_KEY|OPENAI|ZOHO)/i;
for (const key of Object.keys(process.env)) {
  if (FORBIDDEN_PUBLIC.test(key)) {
    errors.push(`Server secret exposed to the browser via a NEXT_PUBLIC_ name: ${key}`);
  }
}

// Sanity-check the Supabase URL shape (no value printed).
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (
  url &&
  !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net)$|^http:\/\/(localhost|127\.0\.0\.1)/i.test(url)
) {
  warnings.push("NEXT_PUBLIC_SUPABASE_URL does not look like a Supabase project URL.");
}

// The publishable key should look publishable, and must not be a service JWT.
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
if (/service_role/.test(Buffer.from(key.split(".")[1] ?? "", "base64").toString("utf8"))) {
  errors.push(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY appears to be a SERVICE-ROLE key — never expose it.",
  );
}

if (process.env.ZOHO_RECRUIT_ENABLED?.trim().toLowerCase() === "true") {
  for (const required of [
    "ZOHO_RECRUIT_CLIENT_ID",
    "ZOHO_RECRUIT_CLIENT_SECRET",
    "ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY",
    "ZOHO_RECRUIT_REDIRECT_URI",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (!process.env[required]) errors.push(`Zoho Recruit is enabled but ${required} is missing.`);
  }

  const encryptionKey = process.env.ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY;
  if (encryptionKey && Buffer.from(encryptionKey, "base64").length !== 32) {
    errors.push("ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  const redirectUri = process.env.ZOHO_RECRUIT_REDIRECT_URI;
  if (redirectUri) {
    try {
      const redirect = new URL(redirectUri);
      if (
        !["https:", "http:"].includes(redirect.protocol) ||
        (redirect.protocol === "http:" &&
          !["localhost", "127.0.0.1"].includes(redirect.hostname)) ||
        redirect.pathname !== "/api/integrations/zoho-recruit/callback"
      ) {
        errors.push(
          "ZOHO_RECRUIT_REDIRECT_URI must be HTTPS (except localhost) and use the Zoho callback path.",
        );
      }
    } catch {
      errors.push("ZOHO_RECRUIT_REDIRECT_URI is not a valid URL.");
    }
  }
}

for (const w of warnings) console.warn(`⚠ ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`✖ ${e}`);
  console.error(`\nEnvironment validation FAILED (${errors.length} error(s)).`);
  process.exit(1);
}
console.log(
  "✔ Environment validation passed" +
    (warnings.length ? ` (${warnings.length} warning(s))` : "") +
    ".",
);
