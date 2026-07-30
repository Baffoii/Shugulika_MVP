import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const EXISTING_FLOW_ROOTS = [
  join(SRC, "app", "candidate"),
  join(SRC, "app", "employer"),
  join(SRC, "app", "franchise"),
  join(SRC, "app", "recruiter"),
  join(SRC, "lib", "data"),
];

function sourceFiles(dir: string, result: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, result);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) result.push(path);
  }
  return result;
}

describe("Zoho Recruit isolation from existing website flows", () => {
  it("does not import the integration from candidate, employer, franchise, recruiter, or data loaders", () => {
    for (const root of EXISTING_FLOW_ROOTS) {
      for (const file of sourceFiles(root)) {
        expect(
          readFileSync(file, "utf8"),
          `${file} must not make existing website behavior depend on Zoho`,
        ).not.toMatch(/integrations\/zoho-recruit|ZOHO_RECRUIT_/);
      }
    }
  });
});
