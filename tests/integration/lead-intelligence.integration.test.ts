import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAIExecutionService } from "@/modules/ai/application/ai-execution-service";
import { createLeadIntelligenceService } from "@/modules/ai/application/lead-intelligence-service";
import { MockAIProvider } from "@/modules/ai/providers/mock-ai-provider";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createLeadScoringService } from "@/modules/qualification/application/lead-scoring-service";
import { createPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { ApplicationError } from "@/shared/core/errors/application-error";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-26 tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const fixedNow = new Date("2052-03-11T14:00:00.000Z");
let workspaceId: string;
let leadId: string;
let optOutLeadId: string;
let manager: AuthenticatedContext;
let owner: AuthenticatedContext;
let anotherSdr: AuthenticatedContext;
let viewer: AuthenticatedContext;

async function humanContextByEmail(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email }, deletedAt: null },
    select: { id: true },
  });
  return humanContextByMember(member.id);
}

async function humanContextByMember(memberId: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { id: memberId, workspaceId, deletedAt: null },
    select: {
      id: true,
      userId: true,
      roleId: true,
      role: { select: { key: true, name: true } },
      user: { select: { displayName: true } },
    },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: member.userId, type: "HUMAN" },
    select: { id: true },
  });
  return Object.freeze({
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
  });
}

function uniquePhone() {
  return `+55119${randomUUID().replaceAll("-", "").replace(/[a-f]/g, "7").slice(0, 8)}`;
}

type IntelligenceServiceOptions = Parameters<typeof createLeadIntelligenceService>[0];

function services(executionOverride?: IntelligenceServiceOptions["execution"]) {
  const execution = createAIExecutionService({
    database,
    authorization,
    provider: new MockAIProvider(),
    now: () => new Date(fixedNow),
  });
  return createLeadIntelligenceService({
    database,
    authorization,
    execution: executionOverride ?? execution,
    pacto: createPactoQualificationService({ database, authorization, now: () => new Date(fixedNow) }),
    scoring: createLeadScoringService({ database, authorization, now: () => new Date(fixedNow) }),
    operations: createOperationalHistoryService({ database, authorization, now: () => new Date(fixedNow) }),
    now: () => new Date(fixedNow),
  });
}

function firstInsight(result: Awaited<ReturnType<ReturnType<typeof services>["getScreen"]>>) {
  const insight = result.insights[0];
  if (!insight) throw new Error("Insight esperado não foi retornado.");
  return insight;
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, {
    DATABASE_URL: connectionString,
    NODE_ENV: "test",
  });
  workspaceId = seeded.workspaceId;
  manager = await humanContextByEmail("gestor@demo.politizai.local");
  viewer = await humanContextByEmail("viewer@demo.politizai.local");
  const intake = createLeadIntakeService({ database, authorization, now: () => new Date(fixedNow) });
  const created = await intake.intake({
    channel: "MANUAL",
    idempotencyKey: `crm26:${randomUUID()}`,
    fullName: "Lead fictício CRM-26",
    phone: uniquePhone(),
    jobTitle: "Diretora de operação",
    organizationName: "Organização fictícia",
    city: "São Paulo",
    stateCode: "SP",
    interestSummary: "Precisa reduzir retrabalho no processo comercial",
    budgetCents: 750_000,
    sourceKey: "manual",
    rawPayload: { namespace: "CRM-26" },
    priorityBandCode: "P2",
  }, manager);
  const optedOut = await intake.intake({
    channel: "MANUAL",
    idempotencyKey: `crm26-optout:${randomUUID()}`,
    fullName: "Lead fictício opt-out CRM-26",
    phone: uniquePhone(),
    doNotContact: true,
    sourceKey: "manual",
    rawPayload: { namespace: "CRM-26", scenario: "opt-out" },
    priorityBandCode: "P3",
  }, manager);
  if (created.outcome === "REJECTED") throw new Error("Fixture principal rejeitada.");
  if (optedOut.outcome === "REJECTED") throw new Error("Fixture opt-out rejeitada.");
  leadId = created.leadId;
  optOutLeadId = optedOut.leadId;
  owner = manager;
  const assignedLead = await database.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { ownerMemberId: true },
  });
  const unrelatedSdr = await database.workspaceMember.findFirstOrThrow({
    where: {
      workspaceId,
      ...(assignedLead.ownerMemberId
        ? { id: { not: assignedLead.ownerMemberId } }
        : {}),
      role: { key: "sdr" },
      deletedAt: null,
    },
    select: { id: true },
  });
  anotherSdr = await humanContextByMember(unrelatedSdr.id);
  const score = createLeadScoringService({ database, authorization, now: () => new Date(fixedNow) });
  const current = await score.getScore(owner, { leadId });
  await score.override(owner, {
    leadId,
    expectedRevision: current.revision,
    score: 99,
    reason: "Fixture garante contraste com a recomendação local.",
  });
});

afterAll(async () => {
  await database.$disconnect();
});

describe("CRM-26 — inteligência no fluxo do lead", () => {
  it("analisa o lead com fatos, ausências, score, ação explicada e rastreabilidade", async () => {
    const beforeScore = await database.leadScore.count({ where: { workspaceId, leadId } });
    const result = await services().run(owner, { leadId, useCase: "LEAD_ANALYSIS" });
    const insight = firstInsight(result);

    expect(insight).toMatchObject({
      useCase: "LEAD_ANALYSIS",
      status: "OPEN",
      provider: { mode: "LOCAL_DETERMINISTIC", key: "mock" },
      output: {
        inferences: [],
        priority: "P3",
        action: { requiresConfirmation: true },
      },
    });
    expect(insight.output.facts.some((fact) => fact.statement.includes("reduzir retrabalho"))).toBe(true);
    expect(insight.proposals.map((proposal) => proposal.id)).toEqual(expect.arrayContaining(["task", "score"]));
    expect(await database.leadScore.count({ where: { workspaceId, leadId } })).toBe(beforeScore);
    expect(await database.activity.count({ where: { workspaceId, leadId, type: "AI_ACTION", subject: "Agente de qualificação" } })).toBe(1);
    expect(await database.auditLog.count({ where: { workspaceId, aiInsightId: insight.id, action: "ai.insight.generated" } })).toBe(1);
  });

  it("prepara briefing de até dez minutos com três linhas e três perguntas sem inventar objeção", async () => {
    const result = await services().run(owner, { leadId, useCase: "CALL_PREPARATION" });
    const insight = firstInsight(result);

    expect(insight.output.summary.split("\n")).toHaveLength(3);
    expect(insight.output.questions).toHaveLength(3);
    expect(insight.output.action).toMatchObject({
      title: "Conduzir ligação de descoberta",
      requiresConfirmation: true,
    });
    expect(insight.output.risks).toContain("Objeção provável não identificada nos dados persistidos.");
  });

  it("extrai somente marcadores explícitos, mantém ausências e aplica parcialmente o PACTO após edição humana", async () => {
    const result = await services().run(owner, {
      leadId,
      useCase: "CONVERSATION_EXTRACTION",
      text: [
        "Dor: atraso na consolidação dos contatos",
        "Decisor: decisão conjunta com a diretoria",
        "Objeção: receio com o tempo de implantação",
        "Próxima ação: retornar em dois dias",
      ].join("\n"),
    });
    const insight = firstInsight(result);
    const painProposal = insight.proposals.find((proposal) => proposal.id === "pacto:AFFLICTION");
    expect(painProposal?.target).toBe("PACTO");
    expect(insight.output.missingFields).toEqual(expect.arrayContaining(["capacity", "intent", "context"]));
    expect(JSON.stringify(insight.output.facts)).toContain("atraso na consolidação dos contatos");

    const reviewed = await services().review(owner, {
      leadId,
      insightId: insight.id,
      decision: "APPLY",
      reason: "Evidência revisada nas palavras do lead.",
      items: [{
        target: "PACTO",
        proposalId: "pacto:AFFLICTION",
        status: "PARTIAL",
        evidence: "atraso na consolidação de contatos confirmado pelo SDR",
        note: "Revisão humana parcial",
      }],
    });
    const reviewedInsight = reviewed.insights.find((item) => item.id === insight.id);
    expect(reviewedInsight?.review).toMatchObject({
      decision: "PARTIALLY_ACCEPTED",
      selectedProposalIds: ["pacto:AFFLICTION"],
      editedProposalIds: ["pacto:AFFLICTION"],
    });
    const pacto = await createPactoQualificationService({ database, authorization, now: () => new Date(fixedNow) }).getPacto(owner, { leadId });
    expect(pacto.dimensions.find((item) => item.dimension === "AFFLICTION")).toMatchObject({
      status: "PARTIAL",
      origin: "AI",
      evidence: "atraso na consolidação de contatos confirmado pelo SDR",
    });
    const reviewAudit = await database.auditLog.findFirstOrThrow({
      where: { workspaceId, aiInsightId: insight.id, action: "ai.insight.review_applied" },
      select: { changes: true, metadata: true },
    });
    expect(reviewAudit.changes).toMatchObject({ decision: "PARTIALLY_ACCEPTED" });
    expect(reviewAudit.metadata).toMatchObject({
      selectedProposalIds: ["pacto:AFFLICTION"],
      editedProposalIds: ["pacto:AFFLICTION"],
    });
  });

  it("aplica somente a tarefa selecionada e não altera silenciosamente o score", async () => {
    const generated = await services().run(owner, { leadId, useCase: "LEAD_ANALYSIS" });
    const insight = firstInsight(generated);
    const task = insight.proposals.find((proposal) => proposal.target === "TASK");
    expect(task?.target).toBe("TASK");
    if (!task || task.target !== "TASK") throw new Error("Proposta de tarefa ausente.");
    const beforeScore = await database.leadCurrentScore.findUniqueOrThrow({
      where: { workspaceId_leadId: { workspaceId, leadId } },
      select: { leadScoreId: true },
    });
    const reviewed = await services().review(owner, {
      leadId,
      insightId: insight.id,
      decision: "APPLY",
      items: [{
        target: "TASK",
        proposalId: "task",
        title: task.suggestedValue.title,
        dueAt: task.suggestedValue.dueAt,
      }],
    });

    expect(reviewed.insights.find((item) => item.id === insight.id)?.review?.decision).toBe("PARTIALLY_ACCEPTED");
    expect(await database.task.count({ where: { workspaceId, leadId, description: { contains: insight.id } } })).toBe(1);
    expect((await database.leadCurrentScore.findUniqueOrThrow({
      where: { workspaceId_leadId: { workspaceId, leadId } },
      select: { leadScoreId: true },
    })).leadScoreId).toBe(beforeScore.leadScoreId);
  });

  it("registra rejeição sem aplicar propostas", async () => {
    const generated = await services().run(owner, { leadId, useCase: "NEXT_BEST_ACTION" });
    const insight = firstInsight(generated);
    const beforeTasks = await database.task.count({ where: { workspaceId, leadId } });
    const reviewed = await services().review(owner, {
      leadId,
      insightId: insight.id,
      decision: "REJECT",
      reason: "A ação não corresponde ao contato combinado.",
      items: [],
    });

    expect(reviewed.insights.find((item) => item.id === insight.id)?.review?.decision).toBe("REJECTED");
    expect(await database.task.count({ where: { workspaceId, leadId } })).toBe(beforeTasks);
    expect(await database.auditLog.count({
      where: { workspaceId, aiInsightId: insight.id, action: "ai.insight.rejected" },
    })).toBe(1);
    expect(await database.activity.count({
      where: {
        workspaceId,
        leadId,
        type: "AI_ACTION",
        subject: "Recomendação de IA rejeitada",
      },
    })).toBe(1);
  });

  it("respeita opt-out e não sugere mensagem", async () => {
    const result = await services().run(manager, { leadId: optOutLeadId, useCase: "NEXT_BEST_ACTION" });

    expect(result.doNotContact).toBe(true);
    const insight = firstInsight(result);
    expect(insight.output.action).toMatchObject({
      title: "Revisar preferência de contato",
      message: null,
    });
    expect(JSON.stringify(insight)).not.toContain("Olá,");
  });

  it("nega visualizador e SDR fora do escopo sem expor análises", async () => {
    await expect(services().getScreen(viewer, { leadId })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(services().run(anotherSdr, { leadId, useCase: "LEAD_ANALYSIS" })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("controla falha do caso de uso sem persistência parcial", async () => {
    const before = await database.aIInsight.count({ where: { workspaceId, leadId } });
    const failing = services({
      async execute() {
        throw new ApplicationError("Falha controlada de teste.", {
          code: "AI_CASE_FAILURE",
          statusCode: 503,
        });
      },
    });
    await expect(failing.run(owner, { leadId, useCase: "LEAD_ANALYSIS" })).rejects.toMatchObject({
      code: "AI_CASE_FAILURE",
    });
    expect(await database.aIInsight.count({ where: { workspaceId, leadId } })).toBe(before);
  });
});
