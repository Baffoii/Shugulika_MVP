import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("ZOHO_RECRUIT_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function encryptZohoToken(token: string, encodedKey: string): string {
  if (!token) throw new Error("Cannot encrypt an empty Zoho token.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, decodeKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptZohoToken(encrypted: string, encodedKey: string): string {
  const [version, ivPart, tagPart, ciphertextPart, extra] = encrypted.split(".");
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart || extra) {
    throw new Error("Encrypted Zoho token has an unsupported format.");
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      decodeKey(encodedKey),
      Buffer.from(ivPart, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Encrypted Zoho token could not be decrypted.");
  }
}
