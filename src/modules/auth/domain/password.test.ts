import { describe, expect, it } from "vitest";

import { PasswordPolicyError } from "@/modules/auth/domain/auth-errors";
import {
  hashPassword,
  verifyPassword,
} from "@/modules/auth/domain/password";

describe("password", () => {
  it("gera hash scrypt com salt e valida a senha correta", async () => {
    const firstHash = await hashPassword("uma-senha-local-segura");
    const secondHash = await hashPassword("uma-senha-local-segura");

    expect(firstHash).toMatch(/^scrypt\$65536\$8\$1\$/);
    expect(firstHash).not.toBe(secondHash);
    await expect(
      verifyPassword("uma-senha-local-segura", firstHash),
    ).resolves.toBe(true);
    await expect(verifyPassword("senha-incorreta", firstHash)).resolves.toBe(
      false,
    );
  });

  it("rejeita senha fora da política e hash malformado", async () => {
    await expect(hashPassword("curta")).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
    await expect(verifyPassword("qualquer-senha", "hash-invalido")).resolves.toBe(
      false,
    );
  });
});
