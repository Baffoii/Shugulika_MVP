/**
 * Regression guard: server-only credentials must never cross into the browser.
 *
 * Two independent checks, because either alone can miss a real leak:
 *   1. Source boundary — no `"use client"` module may reach server-only config,
 *      directly or by importing a module that does.
 *   2. Build output — no client chunk may contain a permanent credential value.
 *
 * The browser is only ever allowed the short-lived Realtime client secret that
 * the server mints per authorized assignment.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");
const CLIENT_STATIC = join(process.cwd(), ".next", "static");

/** Names that must never be readable from client code. */
const SERVER_ONLY_IMPORTS = ["@/lib/env.server", "lib/env.server"];
/** Permanent credential env names that must not be referenced in client modules. */
const SERVER_ONLY_ENV = ["OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = walk(SRC);
const isClientModule = (src: string) => /^\s*["']use client["']/m.test(src);

describe("server-only credentials never reach client code", () => {
  it("no 'use client' module imports the server-only env module", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, "utf8");
      if (!isClientModule(src)) continue;
      if (SERVER_ONLY_IMPORTS.some((name) => src.includes(name))) {
        offenders.push(file.replace(process.cwd() + "/", ""));
      }
    }
    expect(offenders, `client modules importing server-only env: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("no 'use client' module references a permanent credential env var", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const src = readFileSync(file, "utf8");
      if (!isClientModule(src)) continue;
      for (const name of SERVER_ONLY_ENV) {
        if (src.includes(name)) offenders.push(`${file.replace(process.cwd() + "/", "")}:${name}`);
      }
    }
    expect(offenders, `client modules referencing server secrets: ${offenders.join(", ")}`).toEqual(
      [],
    );
  });

  it("the server-only env module is marked server-only", () => {
    const src = readFileSync(join(SRC, "lib", "env.server.ts"), "utf8");
    expect(src).toMatch(/import\s+["']server-only["']/);
  });

  it("the browser-safe env module exposes no OpenAI configuration", () => {
    const src = readFileSync(join(SRC, "lib", "env.ts"), "utf8");
    // Strip comments first: prose explaining *why* OpenAI config lives elsewhere
    // is fine; a real reference to it is not.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/process\.env\.OPENAI/);
    expect(code).not.toMatch(/openai[A-Za-z]*\s*:/i);
    expect(code).not.toMatch(/OPENAI_[A-Z_]+/);
  });

  // Build-output scan. Runs only when a production build is present (CI builds
  // before this suite in the `build` job); locally it is skipped rather than
  // silently passing, so a green run here never implies the bundle was checked.
  it("client build output contains no permanent credential value", () => {
    if (!existsSync(CLIENT_STATIC)) {
      console.warn("skip: .next/static absent — run `npm run build` to scan bundle output");
      return;
    }
    const chunks = walk2(CLIENT_STATIC).filter((f) => /\.(js|mjs)$/.test(f));
    expect(chunks.length).toBeGreaterThan(0);

    const leaks: string[] = [];
    for (const file of chunks) {
      const content = readFileSync(file, "utf8");
      // A real key value, not the variable name: OpenAI keys are `sk-...`.
      if (/\bsk-[A-Za-z0-9_-]{20,}/.test(content)) leaks.push(`${file}: openai key value`);
      // Supabase service-role JWTs carry this role claim.
      if (content.includes("service_role")) leaks.push(`${file}: service_role`);
    }
    expect(leaks, `credential values in client bundle: ${leaks.join(", ")}`).toEqual([]);
  });
});

function walk2(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk2(full, out);
    else out.push(full);
  }
  return out;
}
