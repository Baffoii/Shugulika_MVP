import { describe, expect, it } from "vitest";
import { decryptZohoToken, encryptZohoToken } from "@/lib/integrations/zoho-recruit/crypto";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("Zoho token encryption", () => {
  it("round-trips without storing the plaintext", () => {
    const plaintext = "1000.private-refresh-token";
    const encrypted = encryptZohoToken(plaintext, KEY);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptZohoToken(encrypted, KEY)).toBe(plaintext);
  });

  it("uses a fresh nonce for each encryption", () => {
    expect(encryptZohoToken("same-token", KEY)).not.toBe(encryptZohoToken("same-token", KEY));
  });

  it("rejects malformed keys and tampered ciphertext", () => {
    expect(() => encryptZohoToken("token", Buffer.alloc(12).toString("base64"))).toThrow(/32-byte/);
    const encrypted = encryptZohoToken("token", KEY);
    expect(() => decryptZohoToken(`${encrypted}x`, KEY)).toThrow(/could not be decrypted/);
  });
});
