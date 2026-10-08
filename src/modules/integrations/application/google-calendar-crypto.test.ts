import { describe, expect, it } from "vitest";

import { decryptGoogleCalendarSecret, encryptGoogleCalendarSecret } from "@/modules/integrations/application/google-calendar-crypto";

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
});
