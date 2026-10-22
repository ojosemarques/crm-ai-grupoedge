import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { createRealtimeDashboardService, realtimeTokenHash } from "@/modules/realtime-dashboard/application/realtime-dashboard-service";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for realtime dashboard schema tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 6 }) });

async function createTenant(label: string) {
  const workspace = await database.workspace.create({
    data: { slug: `realtime-${label}-${randomUUID().slice(0, 8)}`, name: `Realtime ${label}` },
  });
  const actor = await database.actor.create({
    data: { workspaceId: workspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" },
  });
  return { workspaceId: workspace.id, actorId: actor.id };
}

let tenantA: Awaited<ReturnType<typeof createTenant>>;
let tenantB: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  [tenantA, tenantB] = await Promise.all([createTenant("a"), createTenant("b")]);
});

afterAll(() => database.$disconnect());

describe("schema do dashboard tempo real", () => {
  it("mantém um share por workspace e hash globalmente único", async () => {
    const firstHash = "a".repeat(64);
    await database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantA.workspaceId,
        tokenHash: firstHash,
        createdByActorId: tenantA.actorId,
        updatedByActorId: tenantA.actorId,
      },
    });
    await expect(database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantA.workspaceId,
        tokenHash: "b".repeat(64),
        createdByActorId: tenantA.actorId,
        updatedByActorId: tenantA.actorId,
      },
    })).rejects.toThrow();
    await expect(database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantB.workspaceId,
        tokenHash: firstHash,
        createdByActorId: tenantB.actorId,
        updatedByActorId: tenantB.actorId,
      },
    })).rejects.toThrow();
  });

  it("rejeita ator de outro tenant e hash fora do contrato", async () => {
    await expect(database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantB.workspaceId,
        tokenHash: "c".repeat(64),
        createdByActorId: tenantA.actorId,
        updatedByActorId: tenantA.actorId,
      },
    })).rejects.toThrow();
    await expect(database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantB.workspaceId,
        tokenHash: "hash-invalido",
        createdByActorId: tenantB.actorId,
        updatedByActorId: tenantB.actorId,
      },
    })).rejects.toThrow();
  });

  it("consolida fatos e perfis do tenant, exclui meta mensal e usa somente a semana publicada", async () => {
    const tenant = await createTenant("goals");
    const email = "ederafael@politizai.com";
    const user = await database.user.create({ data: { email, normalizedEmail: email, displayName: "Vendedora de teste" } });
    const role = await database.role.create({ data: { workspaceId: tenant.workspaceId, key: "closer", name: "Closer", createdByActorId: tenant.actorId, updatedByActorId: tenant.actorId } });
    const member = await database.workspaceMember.create({ data: { workspaceId: tenant.workspaceId, userId: user.id, roleId: role.id, status: "ACTIVE", createdByActorId: tenant.actorId, updatedByActorId: tenant.actorId } });
    await database.workspace.update({ where: { id: tenant.workspaceId }, data: { timeZone: "America/Sao_Paulo" } });
    await database.dailyGoalProfile.create({ data: { workspaceId: tenant.workspaceId, memberId: member.id, callsTarget: 10, messagesTarget: 5, effectiveContactsTarget: 2, meetingsScheduledTarget: 1, salesValueTargetCents: 10000n, createdByActorId: tenant.actorId, updatedByActorId: tenant.actorId } });
    const occurredAt = new Date("2026-10-22T14:00:00Z");
    for (const eventType of ["TASK_COMPLETED", "CALL_ATTEMPTED", "WHATSAPP_MESSAGE_SENT", "EMAIL_SENT", "SALE_WON"] as const) {
      await database.commercialMetricFact.create({ data: { workspaceId: tenant.workspaceId, eventKey: eventType, eventType, occurredAt, sourceEntityType: "Task", sourceEntityId: randomUUID(), creditedMemberId: member.id, quantity: eventType === "EMAIL_SENT" ? 3 : 1, valueCents: eventType === "SALE_WON" ? 5000n : null, inputFingerprint: "fixture" } });
    }
    const token = "g".repeat(43);
    await database.realtimeDashboardShare.create({ data: { workspaceId: tenant.workspaceId, tokenHash: realtimeTokenHash(token), createdByActorId: tenant.actorId, updatedByActorId: tenant.actorId } });
    const plan = async (key: string, from: string, to: string, targetValue: bigint) => database.goalPlan.create({ data: {
      workspaceId: tenant.workspaceId, key: key.toLowerCase(), version: 1, name: key, periodStart: new Date(from), periodEnd: new Date(to), timeZone: "America/Sao_Paulo", status: "PUBLISHED", publishedAt: occurredAt, idempotencyKey: key, createdByActorId: tenant.actorId, updatedByActorId: tenant.actorId,
      quotas: { create: { targetType: "MEMBER", targetKey: `MEMBER:${member.id}`, memberId: member.id, metricKey: "OPPORTUNITIES_WON", unit: "COUNT", targetValue, targetLabel: key, createdByActorId: tenant.actorId, updatedByActorId: tenant.actorId } },
    } });
    await plan("Mensal", "2026-10-01T03:00:00Z", "2026-11-01T03:00:00Z", 100n);
    const service = createRealtimeDashboardService({ database, authorization: {} as never, now: () => new Date("2026-10-22T15:00:00Z") });
    const withoutWeek = await service.publicSnapshot(token);
    expect(withoutWeek.week.goals.sales.targetValue).toBeNull();
    await plan("Semanal", "2026-10-19T03:00:00Z", "2026-10-26T03:00:00Z", 5n);
    const result = await service.publicSnapshot(token);
    expect(result.today.totals).toMatchObject({ tasksCompleted: 1, calls: 1, messages: 4, sales: 1, salesValueCents: "5000" });
    expect(result.today.goals.messages).toMatchObject({ actualValue: "1", targetValue: "5", progressBasisPoints: 2000 });
    expect(result.week.goals.calls).toMatchObject({ actualValue: "1", targetValue: "50" });
    expect(result.week.goals.sales).toMatchObject({ actualValue: "1", targetValue: "5", source: "WEEKLY_PLAN", progressBasisPoints: 2000 });
    expect(result.week.ranking).toHaveLength(1);
    expect(result.week.ranking[0]!.goals.week.sales.targetValue).toBe("5");
    await database.dailyGoalProfile.update({ where: { workspaceId_memberId: { workspaceId: tenant.workspaceId, memberId: member.id } }, data: { effectiveContactsTarget: 75, meetingsScheduledTarget: 4, meetingsCompletedTarget: 2, weeklySalesTarget: 1 } });
    const recurring = await service.publicSnapshot(token);
    expect(recurring.today.goals.effectiveContacts.targetValue).toBe("75");
    expect(recurring.today.goals.meetingsScheduled.targetValue).toBe("4");
    expect(recurring.today.goals.meetingsCompleted.targetValue).toBe("2");
    expect(recurring.week.goals.sales).toMatchObject({ targetValue: "1", source: "WEEKLY_PROFILE" });
    const nextWeek = await createRealtimeDashboardService({ database, authorization: {} as never, now: () => new Date("2026-10-26T15:00:00Z") }).publicSnapshot(token);
    expect(nextWeek.week.goals.sales).toMatchObject({ targetValue: "1", actualValue: "0", source: "WEEKLY_PROFILE" });
  });
});
