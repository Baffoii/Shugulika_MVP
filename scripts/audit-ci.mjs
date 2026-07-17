// CI production-dependency audit gate.
//
// Fails on any high/critical advisory in production dependencies, EXCEPT a
// small, documented allowlist of upstream advisories we knowingly accept.
//
// Currently allowlisted: the Next.js framework. Its outstanding high advisories
// are self-hosted DoS / cache / CSP-nonce classes (e.g. GHSA-h25m-26qc-wcjf,
// GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj, GHSA-c4j6-fc7j-m34r,
// GHSA-36qx-fr4f-26g5) whose only fix is a breaking major upgrade (next@16).
// The app deploys on Vercel, where the image-optimizer / DoS classes are
// platform-mitigated. Drop "next" from ALLOW_PACKAGES when the framework is
// upgraded so these advisories block again.
//
// Any high/critical advisory in a package NOT on the allowlist still fails CI,
// so this stays a meaningful gate for our own dependency choices.

import { execFileSync } from "node:child_process";

const ALLOW_PACKAGES = new Set(["next"]);
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
