import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createAdvertisingWorkspaceService } from "@/modules/advertising/application/advertising-workspace-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { ADVERTISING_PIPELINE_NAME } from "@/modules/pipelines/domain/prospecting-pipeline-profile";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");

const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
const now = new Date("2026-10-21T15:00:00.000Z");
const authorization = createAuthorizationService({ database });
let context: AuthenticatedContext;
let workspaceId: string;

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" })).workspaceId;
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: "admin@demo.politizai.local" } },
    include: { user: true, role: true },
  });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  context = {
    workspaceId,
    workspaceSlug: "politizai",
    sessionId: randomUUID(),
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  };
});

afterAll(async () => { await database.$disconnect(); });

describe("workspace de Anúncios", () => {
  it("cria o pipeline completo, vazio e mantém estoque, tarefas e métricas isolados", async () => {
    await ensureAdvertisingPipeline(database, workspaceId, context.actorId);
    const pipeline = await database.pipeline.findFirstOrThrow({
      where: { workspaceId, name: ADVERTISING_PIPELINE_NAME, entityType: "LEAD", deletedAt: null },
      include: {
        stages: { where: { deletedAt: null }, orderBy: { position: "asc" } },
        transitions: { where: { active: true } },
      },
    });
    expect(pipeline.stages.map((stage) => stage.name)).toEqual([
      "Novo lead",
      "Abordagem inicial",
      "Cadência ativa",
      "Conversa iniciada",
      "Reunião marcada",
      "Noshow",
      "Reunião feita",
      "Proposta",
      "Cliente",
      "Encerrado — sem retorno",
      "Descartado",
    ]);
    expect(pipeline.transitions).toHaveLength(23);
    await expect(database.lead.count({ where: { workspaceId, pipelineId: pipeline.id } })).resolves.toBe(0);

    const service = createAdvertisingWorkspaceService({ database, authorization, now: () => now });
    const empty = await service.getScreen(context, { pipelineId: pipeline.id, metricsPreset: "MONTH" });
    expect(empty).toMatchObject({ pipeline: { total: 0 }, stock: { total: 0 }, activities: { total: 0 } });
    expect(empty.metrics.totals).toMatchObject({ leadsReceived: 0, calls: 0, sales: 0, revenueCents: "0" });

    const system = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM", key: "system" } });
    const intake = await createLeadIntakeService({ database, authorization, now: () => now }).intake({
      channel: "MANUAL",
      idempotencyKey: `advertising-test:${randomUUID()}`,
      fullName: "Lead exclusivo de Anúncios",
      phone: "+5511999990001",
      sourceKey: "manual",
      pipelineId: pipeline.id,
      priorityBandCode: "P1",
      rawPayload: { test: true },
    }, { workspaceId, actorId: system.id, actorKey: system.key, actorType: "SYSTEM" });
    if (intake.outcome === "REJECTED") throw new Error(intake.code);
    const salesPipeline = await database.pipeline.findFirstOrThrow({
      where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null },
      select: { id: true },
    });
    await database.$transaction(async (transaction) => {
      await recordCommercialMetricFactInTransaction(transaction, {
        workspaceId,
        eventKey: `advertising-test-sale:${randomUUID()}`,
        eventType: "SALE_WON",
        occurredAt: now,
        sourceEntityType: "OpportunityOutcomeSnapshot",
        sourceEntityId: randomUUID(),
        leadId: intake.leadId,
        pipelineId: salesPipeline.id,
        creditedMemberId: context.memberId,
        valueCents: 1_800_000n,
        result: "WON",
        executionMode: "MANUAL",
      });
    });

    const populated = await service.getScreen(context, { pipelineId: pipeline.id, metricsPreset: "MONTH" });
    expect(populated.pipeline.total).toBe(1);
    expect(populated.stock.items.map((lead) => lead.fullName)).toEqual(["Lead exclusivo de Anúncios"]);
    expect(populated.activities.total).toBeGreaterThan(0);
    expect(populated.metrics.totals.leadsReceived).toBe(1);
    expect(populated.metrics.totals.sales).toBe(1);
    expect(populated.metrics.totals.revenueCents).toBe("1800000");
    expect(populated.stock.items.some((lead) => lead.fullName.includes("Prospecção"))).toBe(false);
  });
});
