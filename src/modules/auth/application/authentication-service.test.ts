import { describe, expect, it, vi } from "vitest";

import { createAuthenticationService } from "@/modules/auth/application/authentication-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { hashPassword } from "@/modules/auth/domain/password";

const context = {
  sessionId: "session-1",
  workspaceId: "workspace-1",
  workspaceSlug: "politizai",
  userId: "user-1",
  memberId: "member-1",
  actorId: "actor-1",
  roleId: "role-1",
  roleKey: "administrator",
  roleName: "Administrador",
  displayName: "Administrador",
} satisfies AuthenticatedContext;

const currentPassword = "SenhaAtual#Forte2026";
const newPassword = "OutraSenha#Forte2026";

describe("troca de senha autenticada", () => {
  it("rejeita senha atual incorreta sem alterar credenciais", async () => {
    const passwordHash = await hashPassword(currentPassword);
    const transaction = vi.fn();
    const service = createAuthenticationService({
      database: {
        localCredential: { findUnique: vi.fn().mockResolvedValue({ id: "credential-1", passwordHash, credentialVersion: 1 }) },
        $transaction: transaction,
      } as never,
      sessionTtlHours: 8,
      maxFailedAttempts: 5,
      lockMinutes: 15,
    });

    await expect(service.changePassword(context, "SenhaIncorreta#2026", newPassword))
      .rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("atualiza a senha, revoga as sessões e registra auditoria sem senhas", async () => {
    const passwordHash = await hashPassword(currentPassword);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const revokeSessions = vi.fn().mockResolvedValue({ count: 2 });
    const audit = vi.fn().mockResolvedValue({});
    const transaction = { localCredential: { updateMany }, authSession: { updateMany: revokeSessions }, auditLog: { create: audit } };
    const service = createAuthenticationService({
      database: {
        localCredential: { findUnique: vi.fn().mockResolvedValue({ id: "credential-1", passwordHash, credentialVersion: 1 }) },
        $transaction: vi.fn(async (callback) => callback(transaction)),
      } as never,
      sessionTtlHours: 8,
      maxFailedAttempts: 5,
      lockMinutes: 15,
      now: () => new Date("2026-09-29T12:00:00.000Z"),
    });

    await service.changePassword(context, currentPassword, newPassword);

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "credential-1", credentialVersion: 1 },
      data: expect.objectContaining({ credentialVersion: { increment: 1 }, failedAttempts: 0, lockedUntil: null }),
    }));
    expect(revokeSessions).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1", revokedAt: null } }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "auth.password.changed" }) }));
    const writes = JSON.stringify([updateMany.mock.calls, revokeSessions.mock.calls, audit.mock.calls]);
    expect(writes).not.toContain(currentPassword);
    expect(writes).not.toContain(newPassword);
  });

  it("exige uma nova senha forte antes de consultar o banco", async () => {
    const findUnique = vi.fn();
    const service = createAuthenticationService({
      database: { localCredential: { findUnique } } as never,
      sessionTtlHours: 8,
      maxFailedAttempts: 5,
      lockMinutes: 15,
    });

    await expect(service.changePassword(context, currentPassword, "fraca123"))
      .rejects.toMatchObject({ code: "PASSWORD_POLICY_VIOLATION" });
    expect(findUnique).not.toHaveBeenCalled();
  });
});
