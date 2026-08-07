/**
 * scripts/zoho-rehearsal.ts — run the Zoho → Supabase rehearsal migration.
 *
 * Drives the TypeScript pipeline directly (hence tsx) so the rehearsal can
 * inject the consent-override source. The HTTP worker route deliberately keeps
 * using the live, consent-enforcing source; this path is the opt-in one.
 *
 * Reads nothing from Zoho but GETs, and refuses to start unless outbound sync
 * is disabled — Shugulika must never push data or actions into Zoho.
 *
 * Usage:
 *   npm run zoho:rehearsal -- --org <responsible-org-uuid> [options]
 *
 *   --org <uuid>     Organization that will own imported jobs/applications.
 *                    Omit to list candidate orgs and exit.
 *   --limit <n>      Cap each Zoho module (do a small run first).
 *   --dry-run        Report what would happen; write nothing.
 *   --skip-cvs       Skip the attachment download pass.
 *   --passwords      After importing, set the shared test password on every
 *                    migrated candidate account.
 *
 * Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * the ZOHO_RECRUIT_* connection values, ZOHO_TEST_MIGRATION=true, and
 * TEST_MIGRATION_PASSWORD when --passwords is used.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(file: string) {
  try {
    const text = readFileSync(resolve(here, "..", file), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // Already-exported values are fine.
  }
}
loadEnv(".env.local");

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  // Imported after env is loaded: these modules read process.env at import time.
  const { createServiceRoleClient } = await import("../src/lib/supabase/service-role");
  const { getZohoRecruitGateStatus } = await import("../src/lib/integrations/zoho-recruit/gates");
  const { runFullRehearsal } =
    await import("../src/lib/integrations/zoho-recruit/import/full-migration/runner");

  const client = createServiceRoleClient();
  if (!client) {
    console.error("✖ SUPABASE_SERVICE_ROLE_KEY is not configured.");
    process.exit(1);
  }

  console.log(`Target project : ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

  // Say the safety state out loud before doing anything.
  const gates = await getZohoRecruitGateStatus();
  console.log(`Outbound sync  : ${gates.syncAllowed ? "ENABLED ⚠" : "disabled ✔"}`);
  if (gates.syncAllowed) {
    console.error(
      "\n✖ Refusing to run: Zoho outbound sync is enabled.\n" +
        "  Set zoho_recruit_data_sync_enabled and zoho_recruit_production_data_enabled\n" +
        "  to false in feature_flags first. Shugulika must not push into Zoho.",
    );
    process.exit(1);
  }

  const orgId = option("org");
  if (!orgId) {
    const { data } = await client
      .from("organizations")
      .select("id,name,org_type")
      .in("org_type", ["hq", "franchise"])
      .order("org_type");
    console.log("\nPass --org <uuid> naming the org that will own imported jobs:\n");
    for (const org of (data as { id: string; name: string; org_type: string }[] | null) ?? []) {
      console.log(`  ${org.id}  ${org.org_type.padEnd(10)} ${org.name}`);
    }
    process.exit(1);
  }

  const limitRaw = option("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limitRaw && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    console.error(`✖ --limit must be a positive number, got "${limitRaw}".`);
    process.exit(1);
  }

  const dryRun = flag("dry-run");
  console.log(`Mode           : ${dryRun ? "DRY RUN (no writes)" : "APPLY"}`);
  if (limit) console.log(`Limit          : ${limit} per module`);
  console.log("");

  const report = await runFullRehearsal({
    responsibleOrgId: orgId,
    limit,
    dryRun,
    skipCvs: flag("skip-cvs"),
    onProgress: (message) => console.log(`  ${message}`),
  });

  console.log("\n──────── rehearsal report ────────");
  console.log(`organizations : ${JSON.stringify(report.organizations)}`);
  console.log(`job orders    : ${JSON.stringify(report.jobOrders)}`);
  console.log(`candidates    : ${JSON.stringify(report.candidates)}`);
  console.log(`applications  : ${JSON.stringify(report.applications)}`);
  console.log(`CVs           : ${JSON.stringify(report.cvs)}`);

  if (Object.keys(report.stages).length) {
    console.log("\nimported application stages:");
    for (const [stage, count] of Object.entries(report.stages).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(6)}  ${stage}`);
    }
  }

  if (Object.keys(report.problems).length) {
    // These are the numbers that make the rehearsal worth running.
    console.log("\nmapping problems (count by reason):");
    for (const [reason, count] of Object.entries(report.problems).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(6)}  ${reason}`);
    }
  }

  if (report.errors.length) {
    console.log(`\nerrors (${report.errors.length}, first 20):`);
    for (const line of report.errors.slice(0, 20)) console.log(`  ${line}`);
  }

  if (flag("passwords") && !dryRun) {
    console.log("\nSetting the shared test password on migrated accounts…");
    const password = process.env.TEST_MIGRATION_PASSWORD;
    if (!password) {
      console.error("✖ TEST_MIGRATION_PASSWORD is not set; skipping.");
    } else {
      let updated = 0;
      let failed = 0;
      for (let page = 1; page <= 500; page++) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
        if (error) {
          console.error(`✖ listUsers failed: ${error.message}`);
          break;
        }
        for (const user of data.users) {
          if (user.user_metadata?.source !== "zoho_import") continue;
          const { error: updateError } = await client.auth.admin.updateUserById(user.id, {
            password,
            email_confirm: true,
          });
          if (updateError) failed += 1;
          else updated += 1;
        }
        if (data.users.length < 200) break;
      }
      console.log(`  ${updated} accounts updated${failed ? `, ${failed} failed` : ""}.`);
    }
  }

  console.log(
    dryRun
      ? "\nDry run complete — nothing was written."
      : "\nRehearsal complete. Imported applications are read-only history.",
  );
  // A run that logged errors should not look like a clean success.
  process.exit(report.errors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
