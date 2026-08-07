/**
 * The rehearsal migration must not be able to write to Zoho — not merely
 * "does not", but "cannot". These assert the token it consents to is
 * incapable of mutating the live workspace.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  ZOHO_RECRUIT_READONLY_SCOPES,
  ZOHO_RECRUIT_SYNC_SCOPES,
  activeZohoRecruitScopes,
  isZohoTestMigration,
  scopesMissing,
} from "@/lib/integrations/zoho-recruit/config";

const ORIGINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** NODE_ENV is typed readonly; tests still need to vary it. */
function setNodeEnv(value: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

const isWriteScope = (scope: string) => /\.(CREATE|UPDATE|DELETE)$/.test(scope);

describe("read-only rehearsal scopes", () => {
  it("contain no write capability at all", () => {
    const writable = ZOHO_RECRUIT_READONLY_SCOPES.filter(isWriteScope);
    expect(writable, `write scopes leaked: ${writable.join(", ")}`).toEqual([]);
  });

  it("still allow reading the modules the import needs", () => {
    expect(ZOHO_RECRUIT_READONLY_SCOPES).toContain("ZohoRecruit.modules.candidates.READ");
    // Field metadata drives the consent field mapping.
    expect(ZOHO_RECRUIT_READONLY_SCOPES).toContain("ZohoRecruit.settings.ALL");
  });

  it("are a strict subset of the normal sync scopes", () => {
    const sync = new Set<string>(ZOHO_RECRUIT_SYNC_SCOPES);
    for (const scope of ZOHO_RECRUIT_READONLY_SCOPES) expect(sync.has(scope)).toBe(true);
    expect(ZOHO_RECRUIT_READONLY_SCOPES.length).toBeLessThan(ZOHO_RECRUIT_SYNC_SCOPES.length);
  });

  it("the normal sync scopes DO carry write capability (guards the comparison)", () => {
    expect(ZOHO_RECRUIT_SYNC_SCOPES.some(isWriteScope)).toBe(true);
  });
});

describe("isZohoTestMigration", () => {
  it("is off unless explicitly acknowledged", () => {
    delete process.env.ZOHO_TEST_MIGRATION;
    expect(isZohoTestMigration()).toBe(false);
  });

  it("is on when acknowledged outside production", () => {
    process.env.ZOHO_TEST_MIGRATION = "true";
    setNodeEnv("development");
    expect(isZohoTestMigration()).toBe(true);
  });

  it("refuses to activate in production even when acknowledged", () => {
    process.env.ZOHO_TEST_MIGRATION = "true";
    setNodeEnv("production");
    expect(isZohoTestMigration()).toBe(false);
  });
});

describe("activeZohoRecruitScopes", () => {
  it("requests read-only scopes during a rehearsal", () => {
    process.env.ZOHO_TEST_MIGRATION = "true";
    setNodeEnv("development");
    expect(activeZohoRecruitScopes().some(isWriteScope)).toBe(false);
  });

  it("requests the full sync scopes in normal operation", () => {
    delete process.env.ZOHO_TEST_MIGRATION;
    setNodeEnv("development");
    expect(activeZohoRecruitScopes()).toEqual(ZOHO_RECRUIT_SYNC_SCOPES);
  });

  it("does not downgrade production scopes even if the flag is set", () => {
    process.env.ZOHO_TEST_MIGRATION = "true";
    setNodeEnv("production");
    expect(activeZohoRecruitScopes()).toEqual(ZOHO_RECRUIT_SYNC_SCOPES);
  });
});

describe("scopesMissing against a read-only grant", () => {
  it("reports a read-only token as complete for rehearsal requirements", () => {
    expect(scopesMissing([...ZOHO_RECRUIT_READONLY_SCOPES], ZOHO_RECRUIT_READONLY_SCOPES)).toEqual(
      [],
    );
  });

  it("reports a read-only token as insufficient for outbound projection", () => {
    // Outbound sync genuinely needs write scopes; a rehearsal token must fail
    // that check rather than appear ready to project into Zoho.
    const missing = scopesMissing([...ZOHO_RECRUIT_READONLY_SCOPES], ZOHO_RECRUIT_SYNC_SCOPES);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every(isWriteScope)).toBe(true);
  });
});
