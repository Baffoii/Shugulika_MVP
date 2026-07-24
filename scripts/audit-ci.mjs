// CI production-dependency audit gate.
//
// Fails on any high/critical advisory in production dependencies, EXCEPT a
// small, documented allowlist of upstream advisories we knowingly accept.
//
// The allowlist is currently empty: the Next.js framework advisories that
// previously forced a waiver were resolved by upgrading to next@16, and the
// bundled `sharp`/libvips advisory (GHSA-f88m-g3jw-g9cj) is pinned to a
// patched release via the `sharp` override in package.json. Re-add a package
// here only for an upstream advisory with no available fix, with justification.
//
// Any high/critical advisory in a package NOT on the allowlist still fails CI,
// so this stays a meaningful gate for our own dependency choices.

import { execFileSync } from "node:child_process";

const ALLOW_PACKAGES = new Set();
const BLOCK_LEVELS = new Set(["high", "critical"]);

let json = "";
try {
  json = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
} catch (err) {
  // `npm audit` exits non-zero when advisories exist; the JSON report is still
  // written to stdout, so recover it from the error rather than failing here.
  json = err.stdout ?? "";
}

if (!json.trim()) {
  console.error("audit-ci: no audit output to parse.");
  process.exit(1);
}

const report = JSON.parse(json);
const vulnerabilities = report.vulnerabilities ?? {};

const blocking = [];
const waived = [];

for (const [pkg, info] of Object.entries(vulnerabilities)) {
  for (const via of info.via ?? []) {
    if (typeof via !== "object" || !BLOCK_LEVELS.has(via.severity)) continue;
    const entry = { pkg, severity: via.severity, title: via.title, url: via.url };
    if (ALLOW_PACKAGES.has(pkg)) waived.push(entry);
    else blocking.push(entry);
  }
}

const fmt = (e) => `  - [${e.severity}] ${e.pkg}: ${e.title} (${e.url})`;

if (waived.length > 0) {
  console.log(`audit-ci: waived ${waived.length} allowlisted advisory(ies):`);
  for (const e of waived) console.log(fmt(e));
}

if (blocking.length > 0) {
  console.error(`audit-ci: ${blocking.length} high/critical advisory(ies) block CI:`);
  for (const e of blocking) console.error(fmt(e));
  console.error("Fix them, or add the package to ALLOW_PACKAGES with justification.");
  process.exit(1);
}

console.log("audit-ci: no blocking high/critical advisories in production dependencies.");
