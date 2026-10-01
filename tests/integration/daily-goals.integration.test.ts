import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createDailyGoalService } from "@/modules/goals/application/daily-goal-service";
import { createSdrQueueService } from "@/modules/leads/application/sdr-queue-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for daily goal tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString) });
const authorization = createAuthorizationService({ database });
const now = new Date("2033-05-10T15:00:00.000Z");
let manager: AuthenticatedContext;
let sdr: AuthenticatedContext;

async function contextFor(workspaceId: string, email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return Object.freeze({ sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName });
}

beforeAll(async () => {
  const seed = await seedDemoDatabase(database);
  manager = await contextFor(seed.workspaceId, "gestor@demo.politizai.local");
  sdr = await contextFor(seed.workspaceId, "sdr1@demo.politizai.local");
});

afterAll(async () => database.$disconnect());

describe("metas diárias configuráveis", () => {
  it("permite ao gestor configurar uma pessoa e o Meu Dia usa os alvos persistidos", async () => {
    const service = createDailyGoalService({ database, authorization });
    const profile = await service.save(manager, { memberId: sdr.memberId, expectedRevision: null, callsTarget: 50, messagesTarget: 40, effectiveContactsTarget: 10, qualificationsTarget: 5, meetingsScheduledTarget: 3, proposalsTarget: 2, salesValueTargetCents: "2500000" });
    expect(profile).toMatchObject({ memberId: sdr.memberId, callsTarget: 50, salesValueTargetCents: "2500000", revision: 1 });

    const screen = await createSdrQueueService({ database, authorization, now: () => now }).getScreen(sdr, {});
    expect(screen.permissions.manageDailyGoals).toBe(false);
    expect(screen.dailyGoalProfiles).toEqual([]);
    expect(screen.dailyProduction.dailyGoal).toMatchObject({ configured: true, configuredMembers: 1, expectedMembers: 1, target: 7 });
    expect(screen.dailyProduction.dailyGoal.metrics.find((metric) => metric.key === "CALLS")?.targetValue).toBe("50");
    expect(screen.dailyProduction.dailyGoal.metrics.find((metric) => metric.key === "SALES_VALUE_CENTS")?.targetValue).toBe("2500000");

    const managerScreen = await createSdrQueueService({ database, authorization, now: () => now }).getScreen(manager, {});
    expect(managerScreen.dailyGoalMemberOptions.some((member) => member.name === "Closer 1 de demonstração")).toBe(true);
  });

  it("bloqueia vendedor sem permissão de gestão", async () => {
    await expect(createDailyGoalService({ database, authorization }).save(sdr, { memberId: sdr.memberId, expectedRevision: 1, callsTarget: 60, messagesTarget: 40, effectiveContactsTarget: 10, qualificationsTarget: 5, meetingsScheduledTarget: 3, proposalsTarget: 2, salesValueTargetCents: "2500000" })).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
