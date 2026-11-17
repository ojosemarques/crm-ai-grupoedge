import { describe, expect, it } from "vitest";

import {
  decryptGoogleCalendarSecret,
  decryptGoogleCalendarSecretWithFallback,
  encryptGoogleCalendarSecret,
  googleCalendarCiphertextUsesKey,
} from "@/modules/integrations/application/google-calendar-crypto";

describe("google calendar secret encryption", () => {
  it("round-trips without persisting plaintext", () => {
    const plaintext = "refresh-token-sensitive-value";
    const ciphertext = encryptGoogleCalendarSecret(plaintext, "a-production-grade-key-with-at-least-32-characters");
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain(plaintext);
    expect(decryptGoogleCalendarSecret(ciphertext, "a-production-grade-key-with-at-least-32-characters")).toBe(plaintext);
  });

  it("rejects decryption with another key", () => {
    const ciphertext = encryptGoogleCalendarSecret("token", "first-production-grade-key-with-at-least-32-characters");
    expect(() => decryptGoogleCalendarSecret(ciphertext, "second-production-grade-key-with-at-least-32-characters")).toThrow();
  });

  it("reads the old and new keys during a controlled rotation", () => {
    const oldKey = "old-production-grade-key-with-at-least-32-characters";
    const nextKey = "next-production-grade-key-with-at-least-32-characters";
    const oldCiphertext = encryptGoogleCalendarSecret("old-token", oldKey);
    const nextCiphertext = encryptGoogleCalendarSecret("next-token", nextKey);
    expect(decryptGoogleCalendarSecretWithFallback(oldCiphertext, [nextKey, oldKey])).toBe("old-token");
    expect(decryptGoogleCalendarSecretWithFallback(nextCiphertext, [nextKey, oldKey])).toBe("next-token");
    expect(googleCalendarCiphertextUsesKey(oldCiphertext, nextKey)).toBe(false);
    expect(googleCalendarCiphertextUsesKey(nextCiphertext, nextKey)).toBe(true);
  });
});
