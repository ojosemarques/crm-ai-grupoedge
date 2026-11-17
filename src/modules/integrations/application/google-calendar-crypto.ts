import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(secret: string) {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptGoogleCalendarSecret(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptGoogleCalendarSecret(value: string, secret: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("GOOGLE_CALENDAR_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function decryptGoogleCalendarSecretWithFallback(value: string, secrets: readonly string[]) {
  let lastError: unknown;
  for (const secret of [...new Set(secrets)]) {
    try { return decryptGoogleCalendarSecret(value, secret); }
    catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("GOOGLE_CALENDAR_CIPHERTEXT_INVALID");
}

export function googleCalendarCiphertextUsesKey(value: string, secret: string) {
  try { decryptGoogleCalendarSecret(value, secret); return true; }
  catch { return false; }
}
