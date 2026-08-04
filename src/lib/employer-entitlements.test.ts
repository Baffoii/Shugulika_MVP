import { afterEach, describe, expect, it } from "vitest";
import {
  buildEmployerPaymentsCapability,
  isEmployerPaymentsSandbox,
  isNonProductionDeployment,
} from "@/lib/employer-entitlements";

describe("isEmployerPaymentsSandbox", () => {
  const previous = process.env.EMPLOYER_PAYMENTS_SANDBOX;

  afterEach(() => {
    if (previous === undefined) delete process.env.EMPLOYER_PAYMENTS_SANDBOX;
    else process.env.EMPLOYER_PAYMENTS_SANDBOX = previous;
  });

  it("is false by default (production-safe)", () => {
    delete process.env.EMPLOYER_PAYMENTS_SANDBOX;
    expect(isEmployerPaymentsSandbox()).toBe(false);
  });

  it("is false for explicit false/empty values", () => {
    process.env.EMPLOYER_PAYMENTS_SANDBOX = "false";
    expect(isEmployerPaymentsSandbox()).toBe(false);
    process.env.EMPLOYER_PAYMENTS_SANDBOX = "1";
    expect(isEmployerPaymentsSandbox()).toBe(false);
  });

  it("is true only for explicit true", () => {
    process.env.EMPLOYER_PAYMENTS_SANDBOX = "true";
    expect(isEmployerPaymentsSandbox()).toBe(true);
  });
});

describe("isNonProductionDeployment", () => {
  it("uses VERCEL_ENV when set", () => {
    expect(isNonProductionDeployment({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
    expect(isNonProductionDeployment({ VERCEL_ENV: "development", NODE_ENV: "production" })).toBe(
      true,
    );
    expect(isNonProductionDeployment({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(
      false,
    );
  });

  it("falls back to NODE_ENV when VERCEL_ENV is unset", () => {
    expect(isNonProductionDeployment({ NODE_ENV: "development" })).toBe(true);
    expect(isNonProductionDeployment({ NODE_ENV: "test" })).toBe(true);
    expect(isNonProductionDeployment({ NODE_ENV: "production" })).toBe(false);
  });
});

describe("buildEmployerPaymentsCapability", () => {
  const cases: Array<{
    name: string;
    isNonProduction: boolean;
    envSandboxEnabled: boolean;
    dbSandboxEnabled: boolean;
    expected: boolean;
  }> = [
    {
      name: "all false",
      isNonProduction: false,
      envSandboxEnabled: false,
      dbSandboxEnabled: false,
      expected: false,
    },
    {
      name: "production + env off + db on",
      isNonProduction: false,
      envSandboxEnabled: false,
      dbSandboxEnabled: true,
      expected: false,
    },
    {
      name: "production + env on + db off",
      isNonProduction: false,
      envSandboxEnabled: true,
      dbSandboxEnabled: false,
      expected: false,
    },
    {
      name: "production + env on + db on (must never allow)",
      isNonProduction: false,
      envSandboxEnabled: true,
      dbSandboxEnabled: true,
      expected: false,
    },
    {
      name: "non-prod + env off + db off",
      isNonProduction: true,
      envSandboxEnabled: false,
      dbSandboxEnabled: false,
      expected: false,
    },
    {
      name: "non-prod + env off + db on",
      isNonProduction: true,
      envSandboxEnabled: false,
      dbSandboxEnabled: true,
      expected: false,
    },
    {
      name: "non-prod + env on + db off",
      isNonProduction: true,
      envSandboxEnabled: true,
      dbSandboxEnabled: false,
      expected: false,
    },
    {
      name: "non-prod + env on + db on (only allowed case)",
      isNonProduction: true,
      envSandboxEnabled: true,
      dbSandboxEnabled: true,
      expected: true,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const cap = buildEmployerPaymentsCapability({
        isNonProduction: c.isNonProduction,
        envSandboxEnabled: c.envSandboxEnabled,
        dbSandboxEnabled: c.dbSandboxEnabled,
      });
      expect(cap.openPaymentsAllowed).toBe(c.expected);
      expect(cap.isNonProduction).toBe(c.isNonProduction);
      expect(cap.envSandboxEnabled).toBe(c.envSandboxEnabled);
      expect(cap.dbSandboxEnabled).toBe(c.dbSandboxEnabled);
      if (c.expected) {
        expect(cap.blockedReasons).toEqual([]);
      } else {
        expect(cap.blockedReasons.length).toBeGreaterThan(0);
      }
    });
  }
});
