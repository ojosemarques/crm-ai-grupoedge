import { describe, expect, it, vi } from "vitest";

import {
  createRealtimeDashboardService,
  readRealtimeBearer,
  realtimeTokenHash,
} from "@/modules/realtime-dashboard/application/realtime-dashboard-service";

const validToken = "a".repeat(43);
const now = new Date("2026-10-22T15:00:00.000Z");

function authorization() {
  return {
    assertAuthorized: vi.fn().mockResolvedValue({ allowed: true, scope: "WORKSPACE" }),
    authorize: vi.fn().mockResolvedValue({ allowed: true, scope: "WORKSPACE" }),
  };
}

describe("serviço do dashboard tempo real", () => {
  it("aceita somente bearer estrito e produz fingerprint sem preservar o segredo", () => {
    expect(readRealtimeBearer(`Bearer ${validToken}`)).toBe(validToken);
    expect(realtimeTokenHash(validToken)).toMatch(/^[0-9a-f]{64}$/);
    expect(realtimeTokenHash(validToken)).not.toContain(validToken);
    expect(() => readRealtimeBearer(`bearer ${validToken}`)).toThrowError("Placar indisponível.");
    expect(() => readRealtimeBearer(`Bearer ${validToken}x`)).toThrowError("Placar indisponível.");
  });

  it("responde igual para token malformado, desconhecido e revogado", async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ workspaceId: "workspace-sentinel", revokedAt: now });
    const service = createRealtimeDashboardService({
      database: { realtimeDashboardShare: { findUnique } } as never,
      authorization: authorization() as never,
      now: () => now,
    });

    const outcomes = await Promise.all([
      service.publicSnapshot("inválido").catch((error: unknown) => error),
      service.publicSnapshot(validToken).catch((error: unknown) => error),
      service.publicSnapshot("b".repeat(43)).catch((error: unknown) => error),
    ]);
    expect(outcomes.map((error) => ({
      code: (error as { code: string }).code,
      statusCode: (error as { statusCode: number }).statusCode,
      message: (error as Error).message,
    }))).toEqual(Array(3).fill({
      code: "REALTIME_SHARE_NOT_FOUND",
      statusCode: 404,
      message: "Placar indisponível.",
    }));
  });

  it("retorna snapshot público agregado sem IDs internos, token ou PII de contato", async () => {
    const database = {
      realtimeDashboardShare: { findUnique: vi.fn().mockResolvedValue({ workspaceId: "workspace-sentinel", revokedAt: null }) },
      workspace: { findFirst: vi.fn().mockResolvedValue({ name: "Empresa Exemplo", timeZone: "America/Sao_Paulo" }) },
      commercialMetricFact: { findMany: vi.fn().mockResolvedValue([{
        id: "fact-sentinel",
        eventType: "SALE_WON",
        sourceEntityType: "Opportunity",
        occurredAt: new Date("2026-10-22T14:00:00.000Z"),
        recordedAt: new Date("2026-10-22T14:01:00.000Z"),
        leadId: "lead-sentinel",
        creditedMemberId: "member-sentinel",
        performedByMemberId: null,
        bookedByMemberId: null,
        taskKind: null,
        result: null,
        cadenceStepKey: null,
        quantity: 1,
        valueCents: 10000n,
      }]) },
      workspaceMember: { findMany: vi.fn().mockResolvedValue([{
        id: "member-sentinel",
        user: { displayName: "Ana Exemplo", normalizedEmail: "carloshenrique@politizai.com" },
        role: { key: "closer" },
        teamMemberships: [],
      }]) },
      commercialMetricBackfillRun: { findFirst: vi.fn().mockResolvedValue(null) },
      commercialMetricReconciliationRun: { findFirst: vi.fn().mockResolvedValue(null) },
      goalPlan: { findFirst: vi.fn().mockResolvedValue(null) },
      dailyGoalProfile: { findMany: vi.fn().mockResolvedValue([{ memberId: "member-sentinel", callsTarget: 10, messagesTarget: 20, effectiveContactsTarget: 5, meetingsScheduledTarget: 2, salesValueTargetCents: 20000n }]) },
    };
    const service = createRealtimeDashboardService({
      database: database as never,
      authorization: authorization() as never,
      now: () => now,
    });

    const snapshot = await service.publicSnapshot(validToken);
    const serialized = JSON.stringify(snapshot);
    expect(snapshot.week.totals).toMatchObject({ sales: 1, salesValueCents: "10000" });
    expect(snapshot.week.ranking[0]).toMatchObject({ name: "Ana Exemplo", initials: "AE", sales: 1 });
    expect(snapshot.today.goals.salesValueCents).toMatchObject({ actualValue: "10000", targetValue: "20000", progressBasisPoints: 5000 });
    expect(snapshot.week.goals.calls.targetValue).toBe("50");
    expect(database.goalPlan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      workspaceId: "workspace-sentinel", status: "PUBLISHED", timeZone: "America/Sao_Paulo",
      periodStart: new Date("2026-10-19T03:00:00Z"),
      periodEnd: { in: [new Date("2026-10-24T03:00:00Z"), new Date("2026-10-26T03:00:00Z")] },
    } }));
    expect(database.dailyGoalProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace-sentinel" } }));
    expect(serialized).not.toContain("workspace-sentinel");
    expect(serialized).not.toContain("member-sentinel");
    expect(serialized).not.toContain("lead-sentinel");
    expect(serialized).not.toContain(validToken);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("@politizai.com");
  });

  it("mostra somente as três contas comerciais no ranking público e autenticado, inclusive com histórico de outros membros", async () => {
    const members = [
      { id: "carlos", user: { displayName: "Carlos Henrique", normalizedEmail: "carloshenrique@politizai.com" }, role: { key: "closer" }, teamMemberships: [] },
      { id: "ede", user: { displayName: "Ede Rafael", normalizedEmail: "ederafael@politizai.com" }, role: { key: "sdr" }, teamMemberships: [] },
      { id: "jhon", user: { displayName: "Jhon Cunha", normalizedEmail: "jhoncunha@politizai.com" }, role: { key: "sdr" }, teamMemberships: [] },
      { id: "admin", user: { displayName: "Administrador", normalizedEmail: "admin@example.test" }, role: { key: "administrator" }, teamMemberships: [{ teamId: "team", function: "SDR" }] },
      { id: "namesake", user: { displayName: "Carlos Henrique", normalizedEmail: "other@example.test" }, role: { key: "sdr" }, teamMemberships: [] },
    ];
    const database = {
      workspace: { findFirst: vi.fn().mockResolvedValue({ name: "Workspace", timeZone: "America/Sao_Paulo" }) },
      workspaceMember: { findMany: vi.fn().mockImplementation(({ where }) => Promise.resolve(where.id ? [{ id: "matheus", user: { displayName: "Matheus Mendon", normalizedEmail: "matheus@example.test" } }] : members)) },
      commercialMetricFact: { findMany: vi.fn().mockResolvedValue(["admin", "matheus", "jhon"].map((id) => ({ id: `fact-${id}`, eventType: "CALL_ATTEMPTED", sourceEntityType: "Task", occurredAt: new Date("2026-10-22T14:00:00Z"), recordedAt: now, leadId: null, creditedMemberId: id, performedByMemberId: null, bookedByMemberId: null, taskKind: null, result: null, cadenceStepKey: null, quantity: 1, valueCents: null }))) },
      realtimeDashboardShare: { findUnique: vi.fn().mockResolvedValue({ workspaceId: "workspace", revokedAt: null, createdAt: now, rotatedAt: null, revision: 1 }) },
      commercialMetricBackfillRun: { findFirst: vi.fn().mockResolvedValue(null) },
      commercialMetricReconciliationRun: { findFirst: vi.fn().mockResolvedValue(null) },
      goalPlan: { findFirst: vi.fn().mockResolvedValue(null) },
      dailyGoalProfile: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = createRealtimeDashboardService({ database: database as never, authorization: authorization() as never, now: () => now });
    const publicSnapshot = await service.publicSnapshot(validToken);
    const screen = await service.screen({ workspaceId: "workspace" } as never);
    expect(screen.snapshot).toEqual(publicSnapshot);
    expect(publicSnapshot.week.ranking.map((row) => [row.name, row.position, row.calls])).toEqual([
      ["Jhon Cunha", 1, 1], ["Carlos Henrique", 2, 0], ["Ede Rafael", 3, 0],
    ]);
    expect(publicSnapshot.today.totals.calls).toBe(3);
    expect(publicSnapshot.week.totals.calls).toBe(3);
    expect(JSON.stringify(publicSnapshot)).not.toMatch(/Matheus|Administrador|@|namesake|rankingVisible/);
    expect(database.workspaceMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "workspace", id: { in: ["matheus"] } } }));
  });

  it("persiste somente o hash e não coloca segredo no audit durante rotação", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "share-id",
      revision: 1,
      createdAt: now,
      rotatedAt: now,
      revokedAt: null,
    });
    const auditCreate = vi.fn().mockResolvedValue({ id: "audit-id" });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      realtimeDashboardShare: { findUnique: vi.fn().mockResolvedValue(null), create },
      auditLog: { create: auditCreate },
    };
    const database = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    };
    const service = createRealtimeDashboardService({
      database: database as never,
      authorization: authorization() as never,
      now: () => now,
      randomToken: () => validToken,
    });

    const result = await service.rotate({ workspaceId: "workspace", actorId: "actor" } as never, "https://crm.example");
    expect(result.shareUrl).toBe(`https://crm.example/tempo-real-publico#${validToken}`);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tokenHash: realtimeTokenHash(validToken) }),
    }));
    expect(JSON.stringify(create.mock.calls)).not.toContain(validToken);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(validToken);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(realtimeTokenHash(validToken));
  });
});
