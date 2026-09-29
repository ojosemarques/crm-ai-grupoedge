import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createLeadScoringService } from "@/modules/qualification/application/lead-scoring-service";
import { createPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for scoring tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 20 }) });
const authorization = createAuthorizationService({ database });
let workspaceId: string;
let managerContext: AuthenticatedContext;
let viewerContext: AuthenticatedContext;
let systemContext: ServiceActorContext;
let aiContext: ServiceActorContext;
const now = new Date("2035-06-12T14:00:00.000Z");

async function humanContext(email: string): Promise<AuthenticatedContext> {
  const user = await database.user.findUniqueOrThrow({ where: { normalizedEmail: email } });
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, userId: user.id, deletedAt: null },
    include: { role: true },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: user.id, type: "HUMAN" },
  });
  return {
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: "politizai",
    userId: user.id,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: user.displayName,
  };
}

async function createLead() {
  const phone = `+55119${(BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 12)}`) % 100_000_000n).toString().padStart(8, "0")}`;
  const service = createLeadIntakeService({ database, authorization, now: () => now });
  const result = await service.intake({
    channel: "MANUAL",
    idempotencyKey: `crm13:${randomUUID()}`,
    fullName: `Lead score ${randomUUID().slice(0, 8)}`,
    phone,
    jobTitle: "Diretora de comunicação",
    organizationName: "Organização fictícia",
    city: "São Paulo",
    stateCode: "SP",
    interestSummary: "Dor explícita na comunicação institucional",
    budgetCents: 1_200_000,
    sourceKey: "manual",
    priorityBandCode: "P3",
    rawPayload: { test: "crm13" },
  }, systemContext);
  if (result.outcome === "REJECTED") throw new Error(result.issues[0]?.message ?? result.code);
  return result;
}

beforeAll(async () => {
  const seed = await seedDemoDatabase(database);
  workspaceId = seed.workspaceId;
  [managerContext, viewerContext] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
  ]);
  const [system, ai] = await Promise.all([
    database.actor.findFirstOrThrow({ where: { workspaceId, key: "system", type: "SYSTEM" } }),
    database.actor.findFirstOrThrow({ where: { workspaceId, key: "ai:recommendation", type: "AI_AGENT" } }),
  ]);
  systemContext = { workspaceId, actorId: system.id, actorKey: system.key, actorType: "SYSTEM" };
  aiContext = { workspaceId, actorId: ai.id, actorKey: ai.key, actorType: "AI_AGENT" };
});

afterAll(async () => database.$disconnect());

describe("scoring configurável e prioridade explicável", () => {
  it("calcula a pré-pontuação do formulário, ignora a prioridade informada e persiste componentes", async () => {
    const lead = await createLead();
    const view = await createLeadScoringService({ database, authorization, now: () => now }).getScore(managerContext, { leadId: lead.leadId });
    expect(lead.priorityBandCode).toBe("P1");
    expect(view).toMatchObject({
      revision: 1,
      current: {
        score: 80,
        priorityBandCode: "P1",
        source: "FORM_PROVISIONAL",
        rule: { version: 1, algorithmKey: "pacto-weighted-v1" },
      },
    });
    expect(view.current?.components.map((item) => item.factor)).toEqual([
      "PAIN", "CAPACITY", "DECISION", "INTENT", "CONTEXT",
    ]);
    expect(view.current?.components.find((item) => item.factor === "INTENT")).toMatchObject({ missingData: true, points: 0 });
    expect(await database.auditLog.count({ where: { workspaceId, entityId: view.current!.id, action: "lead.score.form_provisional_calculated" } })).toBe(1);
  });

  it("torna o PACTO validado a pontuação vigente sem apagar a provisória", async () => {
    const lead = await createLead();
    const pacto = createPactoQualificationService({ database, authorization, now: () => now });
    await pacto.validate(managerContext, {
      leadId: lead.leadId,
      expectedRevision: 0,
      dimensions: pactoDimensions.map((dimension) => ({
        dimension,
        status: "POSITIVE",
        evidence: `Evidência validada ${dimension}`,
        origin: "SDR",
      })),
    });
    const view = await createLeadScoringService({ database, authorization, now: () => now }).getScore(managerContext, { leadId: lead.leadId });
    expect(view.current).toMatchObject({ score: 100, priorityBandCode: "P1", source: "SDR_VALIDATED" });
    expect(view.history.map((item) => item.source)).toEqual(["SDR_VALIDATED", "FORM_PROVISIONAL"]);
    expect(view.history.map((item) => item.currentRevision)).toEqual([2, 1]);
  });

  it("mantém sugestão de IA separada e exige reconciliação dos componentes", async () => {
    const lead = await createLead();
    const service = createLeadScoringService({ database, authorization, now: () => now });
    await service.recordAiSuggestion(aiContext, {
      leadId: lead.leadId,
      score: 60,
      reason: "Sugestão baseada em sinais disponíveis; requer decisão humana.",
      components: [
        { factor: "AI_SUGGESTION", points: 60, maxPoints: 100, reason: "Sinais estruturados da sugestão", missingData: false },
      ],
    });
    const view = await service.getScore(managerContext, { leadId: lead.leadId });
    expect(view.current).toMatchObject({ score: 80, source: "FORM_PROVISIONAL" });
    expect(view.suggestions).toHaveLength(1);
    expect(view.suggestions[0]).toMatchObject({ score: 60, priorityBandCode: "P2" });
    await expect(service.recordAiSuggestion(aiContext, {
      leadId: lead.leadId,
      score: 70,
      reason: "Total inconsistente",
      components: [{ factor: "AI_SUGGESTION", points: 60, maxPoints: 100, reason: "Inconsistente" }],
    })).rejects.toMatchObject({ code: "INVALID_AI_SCORE" });
  });

  it("exige motivo no override, audita, preserva o histórico e bloqueia concorrência", async () => {
    const lead = await createLead();
    const service = createLeadScoringService({ database, authorization, now: () => now });
    const initial = await service.getScore(managerContext, { leadId: lead.leadId });
    const settled = await Promise.allSettled([
      service.override(managerContext, { leadId: lead.leadId, expectedRevision: initial.revision, score: 45, reason: "Gestor confirmou urgência menor na ligação." }),
      service.override(managerContext, { leadId: lead.leadId, expectedRevision: initial.revision, score: 75, reason: "SDR confirmou urgência maior na ligação." }),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(settled.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "SCORE_CONCURRENT_UPDATE" } });
    const view = await service.getScore(managerContext, { leadId: lead.leadId });
    expect(view.revision).toBe(2);
    expect(view.current?.source).toBe("HUMAN_OVERRIDE");
    expect(view.history).toHaveLength(2);
    expect(await database.auditLog.count({ where: { workspaceId, entityId: view.current!.id, action: "lead.score.overridden" } })).toBe(1);
    await expect(database.leadScore.update({ where: { id: view.current!.id }, data: { score: 10 } })).rejects.toThrow(/append-only/);
  });

  it("reprocessa com nova versão sem reescrever a anterior e permite rollback integral", async () => {
    const lead = await createLead();
    const baseRule = await database.scoringRuleVersion.findFirstOrThrow({ where: { workspaceId, key: "pacto-default", active: true } });
    await database.scoringRuleVersion.update({ where: { id: baseRule.id }, data: { active: false } });
    let versionTwo = await database.scoringRuleVersion.findUnique({
      where: {
        workspaceId_key_version: { workspaceId, key: "pacto-default", version: 2 },
      },
    });
    versionTwo ??= await database.scoringRuleVersion.create({
      data: {
        workspaceId,
        key: "pacto-default",
        version: 2,
        algorithmKey: "pacto-weighted-v1",
        painMaxPoints: 30,
        capacityMaxPoints: 30,
        decisionMaxPoints: 15,
        intentMaxPoints: 20,
        contextMaxPoints: 5,
        partialFactorBasisPoints: 5_000,
        noCapacityPenalty: 30,
        noPainPenalty: 30,
        curiosityPenalty: 10,
        invalidContactPenalty: 100,
        noDecisionAccessPenalty: 15,
        capacityFullThresholdCents: 500_000n,
        p1Minimum: 70,
        p2Minimum: 40,
        active: true,
        createdByActorId: systemContext.actorId,
      },
    });
    if (!versionTwo.active) {
      versionTwo = await database.scoringRuleVersion.update({
        where: { id: versionTwo.id },
        data: { active: true },
      });
    }
    try {
      const service = createLeadScoringService({ database, authorization, now: () => now });
      const before = await service.getScore(managerContext, { leadId: lead.leadId });
      await service.recalculate(managerContext, { leadId: lead.leadId, expectedRevision: before.revision });
      const after = await service.getScore(managerContext, { leadId: lead.leadId });
      expect(after.current?.rule?.version).toBe(2);
      expect(after.history.map((item) => item.ruleVersion)).toEqual([2, 1]);
      await expect(database.scoringRuleVersion.update({ where: { id: baseRule.id }, data: { painMaxPoints: 26 } })).rejects.toThrow(/immutable/);

      const counts = await Promise.all([
        database.leadScore.count({ where: { workspaceId, leadId: lead.leadId } }),
        database.activity.count({ where: { workspaceId, leadId: lead.leadId } }),
        database.auditLog.count({ where: { workspaceId, entityType: "LeadScore", changes: { path: ["leadId"], equals: lead.leadId } } }),
      ]);
      const rollback = createLeadScoringService({
        database,
        authorization,
        now: () => new Date(now.getTime() + 1_000),
        beforeCommit: async () => { throw new Error("falha transacional simulada CRM-13"); },
      });
      await expect(rollback.override(managerContext, { leadId: lead.leadId, expectedRevision: after.revision, score: 50, reason: "Teste de rollback controlado." })).rejects.toThrow("falha transacional simulada CRM-13");
      expect(await Promise.all([
        database.leadScore.count({ where: { workspaceId, leadId: lead.leadId } }),
        database.activity.count({ where: { workspaceId, leadId: lead.leadId } }),
        database.auditLog.count({ where: { workspaceId, entityType: "LeadScore", changes: { path: ["leadId"], equals: lead.leadId } } }),
      ])).toEqual(counts);
    } finally {
      await database.scoringRuleVersion.update({ where: { id: versionTwo.id }, data: { active: false } });
      await database.scoringRuleVersion.update({ where: { id: baseRule.id }, data: { active: true } });
    }
  });

  it("aplica RBAC no servidor", async () => {
    const lead = await createLead();
    const service = createLeadScoringService({ database, authorization, now: () => now });
    const view = await service.getScore(viewerContext, { leadId: lead.leadId });
    expect(view.canWrite).toBe(false);
    await expect(service.override(viewerContext, { leadId: lead.leadId, expectedRevision: view.revision, score: 50, reason: "Tentativa sem permissão." })).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
