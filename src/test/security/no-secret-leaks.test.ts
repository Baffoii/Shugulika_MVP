import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Vitest runs from the repo root; use cwd for a deterministic source root.
const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    // Scan application source only — skip the test tree (test files legitimately
    // contain the forbidden patterns as assertions/regexes).
    if (name === "test" || name === "__mocks__") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (f: string) => readFileSync(f, "utf8");

describe("no service-role key or secrets in browser-reachable code", () => {
  it("the browser Supabase client uses only the publishable key", () => {
    const client = read(join(SRC, "lib/supabase/client.ts"));
    expect(client).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(client).not.toMatch(/createClient\([^)]*serviceRole/i);
    expect(client).toMatch(/supabaseKey/);
  });

  it('no "use client" file reads a server-only secret', () => {
    for (const f of files) {
      const src = read(f);
      const isClient = /^\s*["']use client["']/.test(src);
      if (!isClient) continue;
      // Client bundles must never reference these env var names (server-only).
      expect(src, `${f} is a client component and must not read server secrets`).not.toMatch(
        /SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY/,
      );
    }
  });

  it("no NEXT_PUBLIC_ variable is named like a secret", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} exposes a secret via a NEXT_PUBLIC_ name`).not.toMatch(
        /NEXT_PUBLIC_[A-Z_]*(SERVICE_ROLE|SECRET|PRIVATE_KEY|SERVICE_KEY)/,
      );
    }
  });

  it("no hardcoded Supabase service-role JWT is committed", () => {
    // service-role keys are JWTs whose payload contains "service_role".
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} appears to contain a service-role JWT`).not.toMatch(
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl/,
      );
    }
  });

  it("does not use dangerouslySetInnerHTML with unsanitized input", () => {
    for (const f of files) {
      const src = read(f);
      // We currently render no raw HTML anywhere; guard against regressions.
      expect(src, `${f} uses dangerouslySetInnerHTML`).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});
