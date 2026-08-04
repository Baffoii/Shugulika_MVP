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
  join(SRC, "components"),
];

function sourceFiles(dir: string, result: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return result;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, result);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) result.push(path);
  }
  return result;
}

function isClientModule(source: string): boolean {
  return /^\s*["']use client["']\s*;/m.test(source);
}

describe("Zoho Recruit isolation from existing website flows", () => {
  it("does not import the integration from candidate, employer, franchise, recruiter, data loaders, or shared components", () => {
    for (const root of EXISTING_FLOW_ROOTS) {
      for (const file of sourceFiles(root)) {
        expect(
          readFileSync(file, "utf8"),
          `${file} must not make existing website behavior depend on Zoho`,
        ).not.toMatch(/integrations\/zoho-recruit|ZOHO_RECRUIT_/);
      }
    }
  });

  it("keeps Zoho modules out of browser client components", () => {
    for (const file of sourceFiles(join(SRC, "app"))) {
      const source = readFileSync(file, "utf8");
      if (!isClientModule(source)) continue;
      expect(source, `${file} is a client component and must not import Zoho Recruit`).not.toMatch(
        /integrations\/zoho-recruit|ZOHO_RECRUIT_/,
      );
    }
  });
});
