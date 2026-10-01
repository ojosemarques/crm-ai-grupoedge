import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createSalesGateService } from "@/modules/opportunities/application/sales-gate-service";
import { seedCrm29DemoData } from "@/modules/settings/application/crm29-demo-data-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for unified activity queue tests.");

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 12 }),
});
const authorization = createAuthorizationService({ database });
const now = new Date("2038-03-15T14:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;

async function human(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email }, deletedAt: null },
    include: { user: true, role: true },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: member.userId, type: "HUMAN" },
  });
  return {
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: "politizai",
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database)).workspaceId;
  await seedCrm29DemoData(
    database,
    { DATABASE_URL: connectionString, NODE_ENV: "test" },
    { now },
  );
  admin = await human("admin@demo.politizai.local");
});

afterAll(async () => database.$disconnect());

describe("fila unificada de atividades", () => {
  it("reúne lead, cadência, reunião, oportunidade, etapa e pós-venda sem duplicar reunião", async () => {
    const suffix = randomUUID().slice(0, 8);
    const lead = await database.lead.findFirstOrThrow({
      where: { workspaceId, deletedAt: null },
      select: { id: true },
    });
    const opportunity = await database.opportunity.findFirstOrThrow({
      where: { workspaceId, deletedAt: null },
      select: { id: true, leadId: true, pipelineId: true, currentStageId: true },
    });
    const stageHistory = await database.stageHistory.findFirstOrThrow({
      where: {
        workspaceId,
        opportunityId: opportunity.id,
        pipelineId: opportunity.pipelineId,
        stageId: opportunity.currentStageId,
      },
      orderBy: { enteredAt: "desc" },
      select: { id: true },
    });
    const rule = await database.automationRule.findFirstOrThrow({
      where: { workspaceId },
      select: { id: true, version: true, triggerType: true, actionType: true },
    });
    const automationRun = await database.automationRun.create({
      data: {
        workspaceId,
        automationRuleId: rule.id,
        leadId: lead.id,
        actorId: admin.actorId,
        status: "SUCCEEDED",
        idempotencyKey: `unified-queue:${suffix}`,
        ruleVersion: rule.version,
        triggerType: rule.triggerType,
        actionType: rule.actionType,
        conditionsSnapshot: {},
        actionConfigSnapshot: { category: "OUTREACH_CADENCE" },
        triggeredAt: now,
        startedAt: now,
        finishedAt: now,
      },
    });
    const meeting = await database.meeting.create({
      data: {
        workspaceId,
        leadId: lead.id,
        ownerMemberId: admin.memberId,
        title: `Reunião unificada ${suffix}`,
        status: "SCHEDULED",
        startsAt: new Date(now.getTime() + 3_600_000),
        endsAt: new Date(now.getTime() + 5_400_000),
        durationMinutes: 30,
        timeZone: "America/Sao_Paulo",
        createdByActorId: admin.actorId,
        updatedByActorId: admin.actorId,
      },
    });
    const baseTask = {
      workspaceId,
      assigneeMemberId: admin.memberId,
      status: "OPEN" as const,
      priority: "MEDIUM" as const,
      dueAt: new Date(now.getTime() + 7_200_000),
      createdByActorId: admin.actorId,
      updatedByActorId: admin.actorId,
    };
    const [leadTask, cadenceTask, opportunityTask, meetingTask, postSaleTask, stageTask] = await Promise.all([
      database.task.create({ data: { ...baseTask, leadId: lead.id, title: `Lead ${suffix}`, kind: "CALL" } }),
      database.task.create({ data: { ...baseTask, leadId: lead.id, automationRunId: automationRun.id, title: `Cadência ${suffix}`, kind: "MESSAGE" } }),
      database.task.create({ data: { ...baseTask, leadId: opportunity.leadId, opportunityId: opportunity.id, title: `Oportunidade ${suffix}`, kind: "EMAIL" } }),
      database.task.create({ data: { ...baseTask, leadId: lead.id, meetingId: meeting.id, title: `Reunião ${suffix}`, kind: "MEETING" } }),
      database.task.create({ data: { ...baseTask, leadId: lead.id, title: `Pós-venda ${suffix}`, kind: "FOLLOW_UP", context: "POST_SALE" } }),
      database.task.create({ data: { ...baseTask, leadId: opportunity.leadId, opportunityId: opportunity.id, title: `Etapa ${suffix}`, kind: "FOLLOW_UP" } }),
    ]);
    const template = await database.pipelineTemplate.create({
      data: { workspaceId, key: `unified-${suffix}`, name: `Fila unificada ${suffix}`, entityType: "OPPORTUNITY", createdByActorId: admin.actorId },
    });
    const version = await database.pipelineTemplateVersion.create({
      data: { workspaceId, templateId: template.id, version: 1, name: template.name, changeReason: "Teste da fila unificada", createdByActorId: admin.actorId },
    });
    const stage = await database.pipelineTemplateStage.create({
      data: { workspaceId, templateVersionId: version.id, stableKey: `stage-${suffix}`, name: "Etapa de teste", position: 0, type: "OPEN" },
    });
    const definition = await database.pipelineTemplateActivityDefinition.create({
      data: { workspaceId, templateVersionId: version.id, stageId: stage.id, activityType: "FOLLOW_UP", title: stageTask.title, dueOffsetDays: 0, position: 0, required: false },
    });
    await database.opportunityStageActivityInstance.create({
      data: { workspaceId, opportunityId: opportunity.id, stageHistoryId: stageHistory.id, definitionId: definition.id, taskId: stageTask.id, entrySequence: 1, title: stageTask.title, activityType: "FOLLOW_UP", dueAt: stageTask.dueAt, reentryPolicy: "RECREATE_ON_REENTRY" },
    });

    const screen = await createSalesGateService({ database, authorization, now: () => now }).getActivityQueue(admin);
    const byId = new Map(screen.items.map((item) => [item.id, item]));

    expect(byId.get(leadTask.id)).toMatchObject({ origin: "LEAD", kind: "CALL", leadId: lead.id });
    expect(byId.get(cadenceTask.id)).toMatchObject({ origin: "CADENCE", kind: "MESSAGE" });
    expect(byId.get(opportunityTask.id)).toMatchObject({ origin: "OPPORTUNITY", kind: "EMAIL", opportunityId: opportunity.id });
    expect(byId.get(meetingTask.id)).toMatchObject({ origin: "MEETING", kind: "MEETING", meetingId: meeting.id });
    expect(byId.get(postSaleTask.id)).toMatchObject({ origin: "POST_SALE", kind: "FOLLOW_UP" });
    expect(byId.get(stageTask.id)).toMatchObject({ origin: "OPPORTUNITY_STAGE", opportunityId: opportunity.id });
    expect(screen.items.filter((item) => item.meetingId === meeting.id)).toHaveLength(1);
    expect(screen.counts.total).toBe(screen.items.length);
  });
});
