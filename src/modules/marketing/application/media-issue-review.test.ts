import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createMediaPerformanceService } from "./media-performance-service";

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("@/modules/users/permissions/authorization-service", () => ({ getAuthorizationService: () => ({ assertAuthorized: authorize }) }));
const issueId = "5807e645-0ae9-4f91-aa26-4be30bba1300";
const context = { workspaceId: "workspace-a", actorId: "reviewer" } as AuthenticatedContext;
const now = new Date("2026-09-30T12:00:00Z");
function setup(status: string | null = "OPEN") {
  const tx = { marketingReconciliationIssue: { findFirst: vi.fn().mockResolvedValue(status ? { id: issueId, status } : null), update: vi.fn().mockImplementation(({ data }) => ({ id: issueId, ...data })) }, auditLog: { create: vi.fn() } };
  const database = { $transaction: vi.fn().mockImplementation((run) => run(tx)) };
  return { tx, database, service: createMediaPerformanceService({ database: database as unknown as PrismaClient, now: () => now }) };
}
beforeEach(() => authorize.mockReset());
describe("revisão humana de mídia", () => {
  it("exige autorização antes de consultar ou alterar divergências", async () => {
    const { service, database } = setup();
    authorize.mockRejectedValueOnce(new Error("denied"));
    await expect(service.reviewIssue(context, { issueId, status: "RESOLVED", reason: "Conferido" })).rejects.toThrow("denied");
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it("isola workspace e não altera uma divergência ausente", async () => {
    const { service, tx } = setup(null);
    await expect(service.reviewIssue(context, { issueId, status: "RESOLVED", reason: "Conferido" })).rejects.toMatchObject({ code: "MEDIA_ISSUE_NOT_FOUND" });
    expect(tx.marketingReconciliationIssue.findFirst).toHaveBeenCalledWith({ where: { id: issueId, workspaceId: "workspace-a" } });
    expect(tx.marketingReconciliationIssue.update).not.toHaveBeenCalled();
  });
  it("registra motivo, responsável, data e auditoria da resolução", async () => {
    const { service, tx } = setup("ACKNOWLEDGED");
    await service.reviewIssue(context, { issueId, status: "RESOLVED", reason: "Campanha reconciliada" });
    expect(tx.marketingReconciliationIssue.update).toHaveBeenCalledWith({ where: { id: issueId }, data: { status: "RESOLVED", resolvedAt: now, resolvedByActorId: "reviewer", resolutionReason: "Campanha reconciliada" } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workspaceId: "workspace-a", actorId: "reviewer", reason: "Campanha reconciliada" }) });
  });
  it("é idempotente e não reabre divergências resolvidas", async () => {
    const { service, tx } = setup("RESOLVED");
    expect(await service.reviewIssue(context, { issueId, status: "RESOLVED", reason: "Conferido" })).toMatchObject({ idempotentReplay: true });
    await expect(service.reviewIssue(context, { issueId, status: "ACKNOWLEDGED", reason: "Revisar" })).rejects.toMatchObject({ code: "MEDIA_ISSUE_ALREADY_RESOLVED" });
    expect(tx.marketingReconciliationIssue.update).not.toHaveBeenCalled();
  });
  it("rejeita motivo vazio", async () => {
    const { service, database } = setup();
    await expect(service.reviewIssue(context, { issueId, status: "RESOLVED", reason: "  " })).rejects.toThrow();
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
