import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { createRealtimeDashboardService } from "@/modules/realtime-dashboard/application/realtime-dashboard-service";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const client = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 4 }) });
afterAll(() => client.$disconnect());

it("configura 12/6 por dia e 60/30 na semana, sem alterar outras metas ou tenants, com auditoria idempotente", async () => {
  const rollback = new Error("Rollback da fixture de metas");
  await expect(client.$transaction(async (transaction) => {
  const database = transaction as unknown as PrismaClient;
  const workspace = await database.workspace.create({ data: { slug: `meeting-goals-${randomUUID()}`, name: "Politizai", timeZone: "America/Sao_Paulo" } });
  const other = await database.workspace.create({ data: { slug: `other-${randomUUID()}`, name: "Outro" } });
  const actor = await database.actor.create({ data: { workspaceId: workspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" } });
  const otherActor = await database.actor.create({ data: { workspaceId: other.id, type: "SYSTEM", key: "system", displayName: "Sistema" } });
  const role = await database.role.create({ data: { workspaceId: workspace.id, key: "closer", name: "Closer", createdByActorId: actor.id, updatedByActorId: actor.id } });
  const otherRole = await database.role.create({ data: { workspaceId: other.id, key: "closer", name: "Closer", createdByActorId: otherActor.id, updatedByActorId: otherActor.id } });
  for (const [index, email] of ["carloshenrique@politizai.com", "ederafael@politizai.com", "jhoncunha@politizai.com"].entries()) {
    const user = await database.user.upsert({ where: { normalizedEmail: email }, update: {}, create: { email, normalizedEmail: email, displayName: `Vendedor ${index}` } });
    for (const [tenant, system, memberRole] of [[workspace, actor, role], [other, otherActor, otherRole]] as const) {
      const member = await database.workspaceMember.create({ data: { workspaceId: tenant.id, userId: user.id, roleId: memberRole.id, status: "ACTIVE", createdByActorId: system.id, updatedByActorId: system.id } });
      await database.dailyGoalProfile.create({ data: { workspaceId: tenant.id, memberId: member.id, callsTarget: 50, messagesTarget: 40, effectiveContactsTarget: 75, meetingsScheduledTarget: 4, meetingsCompletedTarget: index === 0 ? 0 : 2, createdByActorId: system.id, updatedByActorId: system.id } });
    }
  }
  const service = createRealtimeDashboardService({ database, authorization: {} as never, now: () => new Date("2026-10-22T15:00:00Z"), publicWorkspaceSlug: workspace.slug });
  await database.realtimeDashboardShare.create({ data: { workspaceId: workspace.id, tokenHash: "d".repeat(64), createdByActorId: actor.id, updatedByActorId: actor.id } });
  const before = await database.dailyGoalProfile.findMany({ orderBy: { id: "asc" } });
  expect((await service.publicTvSnapshot()).today.goals.meetingsCompleted.targetValue).toBe("4");
  // Somente o slug da fixture varia para coexistir com o seed da suíte completa.
  const setup = readFileSync("scripts/sql/configure-politizai-meeting-goals.sql", "utf8").replace("slug = 'politizai'", `slug = '${workspace.slug}'`);
  await database.$executeRawUnsafe(setup);
  const result = await service.publicTvSnapshot();
  expect(result.today.goals.meetingsScheduled.targetValue).toBe("12");
  expect(result.today.goals.meetingsCompleted.targetValue).toBe("6");
  expect(result.week.goals.meetingsScheduled.targetValue).toBe("60");
  expect(result.week.goals.meetingsCompleted.targetValue).toBe("30");
  for (const metric of ["calls", "messages", "effectiveContacts", "meetingsScheduled", "meetingsCompleted"] as const) {
    expect(BigInt(result.week.goals[metric].targetValue!)).toBe(5n * BigInt(result.today.goals[metric].targetValue!));
  }
  const after = await database.dailyGoalProfile.findMany({ orderBy: { id: "asc" } });
  for (const [index, previous] of before.entries()) {
    const updated = after[index]!;
    if (previous.workspaceId !== workspace.id || previous.meetingsCompletedTarget === 0) expect(updated).toEqual(previous);
    else expect(updated).toEqual({ ...previous, meetingsCompletedTarget: 3, revision: previous.revision + 1, updatedAt: expect.any(Date) });
  }
  await database.$executeRawUnsafe(setup);
  expect(await database.dailyGoalProfile.findMany({ orderBy: { id: "asc" } })).toEqual(after);
  const audits = await database.auditLog.findMany({ where: { workspaceId: workspace.id, action: "goals.daily.updated" } });
  expect(audits).toHaveLength(2);
  expect(audits[0]!.changes).toMatchObject({ before: { meetingsCompletedTarget: 2, revision: 1 }, after: { meetingsCompletedTarget: 3, revision: 2 } });
  // Um perfil alterado desde a inspeção deve bloquear a configuração inteira.
  await database.dailyGoalProfile.updateMany({ where: { workspaceId: workspace.id }, data: { meetingsScheduledTarget: 5 } });
  await expect(database.$executeRawUnsafe(setup)).rejects.toThrow("Os perfis de metas mudaram");
  // As contas do ranking são compartilhadas por outros testes; não persistir fixtures.
  throw rollback;
  }, { timeout: 20_000 })).rejects.toBe(rollback);
});
