import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { createMediaPerformanceService } from "./media-performance-service";

vi.mock("@/modules/users/permissions/authorization-service", () => ({ getAuthorizationService: () => ({}) }));
const now = new Date("2026-10-01T01:00:00Z"); // Still September 30 in São Paulo.
function setup({ alreadyRun = false, hasFacts = true } = {}) {
  const tx = {
    $executeRaw: vi.fn(), marketingReconciliationRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "run" }), update: vi.fn().mockResolvedValue({ id: "run", status: "COMPLETED" }) },
    marketingReconciliationRuleVersion: { findFirst: vi.fn().mockResolvedValue({ id: "rule", version: 1, absoluteTolerance: 2, relativeToleranceBps: 1000 }) },
    marketingPerformanceFact: { findMany: vi.fn().mockResolvedValue([]) }, auditLog: { create: vi.fn() },
  };
  const database = {
    workspace: { findMany: vi.fn().mockResolvedValue([{ id: "workspace", timeZone: "America/Sao_Paulo" }]) },
    marketingReconciliationRun: { findUnique: vi.fn().mockResolvedValue(alreadyRun ? { id: "run" } : null) },
    marketingPerformanceFact: { findFirst: vi.fn().mockResolvedValue(hasFacts ? { id: "fact" } : null) },
    actor: { findFirst: vi.fn().mockResolvedValue({ id: "system-actor" }) },
    $transaction: vi.fn().mockImplementation((run) => run(tx)),
  };
  return { database, tx, service: createMediaPerformanceService({ database: database as unknown as PrismaClient, now: () => now }) };
}
describe("auditoria diária de mídia", () => {
  it("usa dia anterior no fuso do workspace e chave determinística", async () => {
    const { service, database, tx } = setup();
    expect(await service.processDailyReconciliation()).toEqual({ status: "SUCCEEDED" });
    expect(database.marketingReconciliationRun.findUnique).toHaveBeenCalledWith({ where: { workspaceId_idempotencyKey: { workspaceId: "workspace", idempotencyKey: "media-daily:2026-09-29" } }, select: { id: true } });
    expect(tx.marketingReconciliationRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ periodStart: new Date("2026-09-29T03:00:00Z"), periodEnd: new Date("2026-09-30T03:00:00Z"), requestedByActorId: "system-actor" }) });
  });
  it("não repete auditoria já registrada", async () => {
    const { service, database } = setup({ alreadyRun: true });
    expect(await service.processDailyReconciliation()).toEqual({ status: "IDLE" });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
  it("aguarda fatos de mídia em vez de marcar auditoria vazia como completa", async () => {
    const { service, database } = setup({ hasFacts: false });
    expect(await service.processDailyReconciliation()).toEqual({ status: "IDLE" });
    expect(database.$transaction).not.toHaveBeenCalled();
  });
});
