import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createGoalBackfillService } from "@/modules/goals/application/goal-backfill-service";
import { createGoalService } from "@/modules/goals/application/goal-service";
import { recordCommercialMetricCorrectionInTransaction, recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { seedGoalDemoData } from "@/modules/settings/application/goal-demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-55 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-55 requires an ephemeral politizai_test_* schema.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2026-09-13T15:00:00.000Z");
const service = createGoalService({ database, authorization, now: () => clock });
let workspaceId: string; let admin: AuthenticatedContext; let sdr: AuthenticatedContext; let viewer: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  await seedGoalDemoData(database);
  [admin, sdr, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("sdr1@demo.politizai.local"), context("viewer@demo.politizai.local")]);
});
afterAll(async () => database.$disconnect());

describe("CRM-55 metas e quotas", () => {
  it("cria rascunho idempotente, publica atomicamente e congela quota", async () => {
    const input = { key: "meta-integracao", name: "Meta integração", description: "Plano criado por teste.", periodStartDate: "2026-09-01", periodEndDate: "2026-09-30", idempotencyKey: "crm55:test:create:001", quotas: [{ targetType: "MEMBER", memberId: sdr.memberId, metricKey: "LEADS_ASSIGNED", unit: "COUNT", targetValue: "30", targetLabel: "ignorado" }] };
    const [first, replay] = await Promise.all([service.createDraft(admin, input), service.createDraft(admin, input)]);
    expect(replay.id).toBe(first.id);
    expect(await database.goalPlan.count({ where: { workspaceId, key: input.key } })).toBe(1);
    const published = await service.act(admin, first.id, { action: "PUBLISH", expectedRevision: first.revision, reason: "Plano revisado e aprovado.", idempotencyKey: "crm55:test:publish:001" });
    expect(published.status).toBe("PUBLISHED");
    const quota = await database.goalQuota.findFirstOrThrow({ where: { workspaceId, planId: first.id } });
    await expect(database.goalQuota.update({ where: { id: quota.id }, data: { targetValue: 31n } })).rejects.toThrow();
    expect(await database.goalPlanEvent.count({ where: { workspaceId, planId: first.id } })).toBe(2);
    expect(await database.auditLog.count({ where: { workspaceId, entityType: "GoalPlan", entityId: first.id } })).toBe(2);
  });

  it("cria nova versão sem reescrever a publicada e supersede só ao publicar", async () => {
    const current = await database.goalPlan.findFirstOrThrow({ where: { workspaceId, key: "meta-integracao", status: "PUBLISHED" } });
    const draft = await service.act(admin, current.id, { action: "CREATE_VERSION", expectedRevision: current.revision, reason: "Novo ciclo de revisão.", idempotencyKey: "crm55:test:version:001" });
    expect(draft).toMatchObject({ version: 2, status: "DRAFT", supersedesPlanId: current.id });
    expect((await database.goalPlan.findUniqueOrThrow({ where: { id: current.id } })).status).toBe("PUBLISHED");
    await service.act(admin, draft.id, { action: "PUBLISH", expectedRevision: draft.revision, reason: "Versão substituta aprovada.", idempotencyKey: "crm55:test:version:publish:001" });
    expect((await database.goalPlan.findUniqueOrThrow({ where: { id: current.id } })).status).toBe("RETIRED");
  });

  it("calcula por asOf, expõe evidência e distingue zero de ausência", async () => {
    const screen = await service.screen(sdr, { asOf: "2026-09-13T15:00:00.000Z" });
    expect(screen.timeZone).toBe("America/Sao_Paulo");
    expect(screen.progress.length).toBeGreaterThan(0);
    expect(screen.progress.every((item) => item.actualValue !== null || ["NO_DENOMINATOR", "PARTIAL", "NOT_APPLICABLE"].includes(item.state))).toBe(true);
    expect(screen.progress.every((item) => item.drilldownHref.startsWith("/"))).toBe(true);
    expect(screen.definitions.precedence).toContain("membro > equipe > função");
  });

  it("não inverte estorno monetário ao calcular receita ganha", async () => {
    const key = `meta-estorno-${randomUUID()}`;
    const plan = await service.createDraft(admin, {
      key, name: "Meta de receita com estorno", periodStartDate: "2032-07-01", periodEndDate: "2032-07-31",
      idempotencyKey: `crm55:test:revenue:${randomUUID()}`,
      quotas: [
        { targetType: "MEMBER", memberId: sdr.memberId, metricKey: "REVENUE_WON_CENTS", unit: "CURRENCY_CENTS", targetValue: "1000", targetLabel: "Receita" },
        { targetType: "MEMBER", memberId: sdr.memberId, metricKey: "LEAD_TO_SALE_BPS", unit: "BASIS_POINTS", targetValue: "5000", targetLabel: "Conversão" },
      ],
    });
    await service.act(admin, plan.id, { action: "PUBLISH", expectedRevision: plan.revision, reason: "Teste de estorno.", idempotencyKey: `crm55:test:publish:${randomUUID()}` });
    const sourceEntityId = randomUUID();
    const original = await recordCommercialMetricFactInTransaction(database, {
      workspaceId, eventKey: `crm55:${sourceEntityId}:won:v1`, eventType: "SALE_WON", occurredAt: new Date("2032-07-12T12:00:00.000Z"),
      sourceEntityType: "OpportunityOutcomeSnapshot", sourceEntityId, creditedMemberId: sdr.memberId, valueCents: 1_000n,
    });
    await recordCommercialMetricCorrectionInTransaction(database, {
      workspaceId, eventKey: `crm55:${sourceEntityId}:reversed:v1`, eventType: "SALE_WON", occurredAt: new Date("2032-07-12T13:00:00.000Z"),
      sourceEntityType: "OpportunityOutcomeSnapshot", sourceEntityId, creditedMemberId: sdr.memberId, valueCents: -1_000n,
      quantity: -1, correctionOfFactId: original.fact.id, reversalReason: "Estorno no mesmo período.",
    });
    const [cohortLead, otherCohortLead, oldLead] = [randomUUID(), randomUUID(), randomUUID()];
    for (const leadId of [cohortLead, otherCohortLead]) await recordCommercialMetricFactInTransaction(database, {
      workspaceId, eventKey: `crm55:${leadId}:created:v1`, eventType: "LEAD_CREATED", occurredAt: new Date("2032-07-12T10:00:00.000Z"),
      sourceEntityType: "Lead", sourceEntityId: leadId, leadId, creditedMemberId: sdr.memberId,
    });
    for (const leadId of [cohortLead, oldLead]) {
      const outcomeId = randomUUID();
      await recordCommercialMetricFactInTransaction(database, {
        workspaceId, eventKey: `crm55:${outcomeId}:won:v1`, eventType: "SALE_WON", occurredAt: new Date("2032-07-12T14:00:00.000Z"),
        sourceEntityType: "OpportunityOutcomeSnapshot", sourceEntityId: outcomeId, leadId, creditedMemberId: sdr.memberId,
      });
    }
    const screen = await service.screen(sdr, { planId: plan.id, asOf: "2032-07-13T15:00:00.000Z" });
    expect(screen.progress.find((item) => item.metricKey === "REVENUE_WON_CENTS")?.actualValue).toBe("0");
    expect(screen.progress.find((item) => item.metricKey === "LEAD_TO_SALE_BPS")?.actualValue).toBe("5000");
  });

  it("aplica RBAC no servidor e não aceita workspace adulterado", async () => {
    await expect(service.createDraft(viewer, { key: "negada", name: "Meta negada", periodStartDate: "2026-09-01", periodEndDate: "2026-09-30", idempotencyKey: "crm55:test:denied:001", quotas: [{ targetType: "MEMBER", memberId: viewer.memberId, metricKey: "LEADS_ASSIGNED", unit: "COUNT", targetValue: 1, targetLabel: "viewer" }] })).rejects.toThrow();
    await expect(service.screen({ ...admin, workspaceId: randomUUID() }, {})).rejects.toThrow();
  });

  it("backfill é conservador, repetível e não inventa plano oficial", async () => {
    const backfill = createGoalBackfillService({ database, authorization, now: () => clock });
    const before = await database.goalPlan.count({ where: { workspaceId } });
    const first = await backfill.run(admin, { mode: "DRY_RUN", runKey: "crm55:test:backfill:001" });
    const replay = await backfill.run(admin, { mode: "DRY_RUN", runKey: "crm55:test:backfill:001" });
    expect(first.replay).toBe(false); expect(replay.replay).toBe(true);
    expect(await database.goalPlan.count({ where: { workspaceId } })).toBe(before);
  });
});
