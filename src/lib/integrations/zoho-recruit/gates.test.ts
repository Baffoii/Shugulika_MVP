import { describe, expect, it } from "vitest";
import { buildGateStatus } from "@/lib/integrations/zoho-recruit/gates";

describe("Zoho Recruit gates", () => {
  it("defaults every flag to false and blocks sync", () => {
    const status = buildGateStatus({});
    expect(status.enabled).toBe(false);
    expect(status.dataSyncEnabled).toBe(false);
    expect(status.productionDataEnabled).toBe(false);
    expect(status.sandboxSyncEnabled).toBe(false);
    expect(status.syncAllowed).toBe(false);
    expect(status.productionExportAllowed).toBe(false);
    expect(status.sandboxExportAllowed).toBe(false);
    expect(status.blockedReasons.length).toBeGreaterThan(0);
  });

  it("allows sandbox export only when master + data_sync + sandbox are on", () => {
    const status = buildGateStatus({
      zoho_recruit_enabled: true,
      zoho_recruit_data_sync_enabled: true,
      zoho_recruit_sandbox_sync_enabled: true,
    });
    expect(status.syncAllowed).toBe(true);
    expect(status.sandboxExportAllowed).toBe(true);
    expect(status.productionExportAllowed).toBe(false);
  });

  it("never treats a lone production gate as sufficient without data sync", () => {
    const status = buildGateStatus({
      zoho_recruit_enabled: true,
      zoho_recruit_production_data_enabled: true,
    });
    expect(status.syncAllowed).toBe(false);
    expect(status.productionExportAllowed).toBe(false);
  });
});
