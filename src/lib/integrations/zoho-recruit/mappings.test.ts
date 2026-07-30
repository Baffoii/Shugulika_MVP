import { describe, expect, it } from "vitest";
import { extractZohoRecordId } from "@/lib/integrations/zoho-recruit/mappings";

describe("extractZohoRecordId", () => {
  it("reads id from Zoho Recruit write details", () => {
    expect(
      extractZohoRecordId({
        data: [{ code: "SUCCESS", details: { id: "111111000000123456" }, status: "success" }],
      }),
    ).toBe("111111000000123456");
  });

  it("returns null when the response has no id", () => {
    expect(extractZohoRecordId({ data: [{ code: "ERROR" }] })).toBeNull();
    expect(extractZohoRecordId({})).toBeNull();
  });
});
