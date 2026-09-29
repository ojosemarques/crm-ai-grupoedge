import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAIExecutionService } from "@/modules/ai/application/ai-execution-service";
import type {
  AIProvider,
  AIProviderRequest,
} from "@/modules/ai/providers/ai-provider";
import { AIProviderError } from "@/modules/ai/providers/ai-provider";
import { MockAIProvider } from "@/modules/ai/providers/mock-ai-provider";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { ApplicationError } from "@/shared/core/errors/application-error";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-25 tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const fixedNow = new Date("2052-03-10T14:00:00.000Z");
let workspaceId: string;
let leadId: string;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;
let owner: AuthenticatedContext;

async function humanContextByEmail(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email }, deletedAt: null },
    select: {
      id: true,
      userId: true,
      roleId: true,
      role: { select: { key: true, name: true } },
      user: { select: { displayName: true } },
    },
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

const minimizedInput = {
  facts: [
    {
      field: "pain",
      value: "MARCADOR-SENSIVEL-CRM25",
      source: "HUMAN" as const,
      evidence: "Relato confirmado durante o atendimento.",
    },
  ],
  requiredFields: ["pain", "capacity"],
  scoreSignals: {
    pain: "POSITIVE" as const,
    capacity: "UNKNOWN" as const,
    decision: "PARTIAL" as const,
    intent: "POSITIVE" as const,
    context: "POSITIVE" as const,
  },
  currentState: { hasHumanAttempt: false },
};

function service(provider: AIProvider, monotonicValues: number[] = [10, 17]) {
  let index = 0;
  return createAIExecutionService({
    database,
    authorization,
    provider,
    now: () => new Date(fixedNow),
    monotonicNow: () => monotonicValues[index++] ?? monotonicValues.at(-1) ?? 0,
  });
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, {
    DATABASE_URL: connectionString,
    NODE_ENV: "test",
  });
  workspaceId = seeded.workspaceId;
  [manager, viewer] = await Promise.all([
    humanContextByEmail("gestor@demo.politizai.local"),
    humanContextByEmail("viewer@demo.politizai.local"),
  ]);
  const intake = createLeadIntakeService({
    database,
    authorization,
    now: () => new Date(fixedNow),
  });
  const result = await intake.intake(
    {
      channel: "MANUAL",
      idempotencyKey: `crm25:${randomUUID()}`,
      fullName: "Lead fictício CRM-25",
      phone: `+55119${randomUUID().replaceAll("-", "").replace(/[a-f]/g, "7").slice(0, 8)}`,
      sourceKey: "manual",
      rawPayload: { test: "CRM-25" },
      priorityBandCode: "P2",
    },
    manager,
  );
  if (result.outcome === "REJECTED" || !result.operationalOwner.memberId) {
    throw new Error("Fixture CRM-25 não criou um lead atribuído.");
  }
  leadId = result.leadId;
  owner = await humanContextByMember(result.operationalOwner.memberId);
});

afterAll(async () => {
  await database.$disconnect();
});

describe("CRM-25 — execução segura e rastreável", () => {
  it("funciona sem chave, respeita escopo próprio e persiste resultado e auditoria atômicos", async () => {
    const result = await service(new MockAIProvider()).execute(owner, {
      agent: "QUALIFICATION",
      target: { type: "LEAD", id: leadId },
      input: minimizedInput,
    });

    expect(result).toMatchObject({
      requestedProviderKey: "mock",
      providerKey: "mock",
      mode: "LOCAL_DETERMINISTIC",
      providerFailureCode: null,
      prompt: { key: "politizai.qualification", version: 2 },
      output: {
        facts: [expect.objectContaining({ statement: expect.stringContaining("MARCADOR-SENSIVEL") })],
        inferences: [],
        missingFields: ["capacity"],
      },
    });
    const [insight, audit] = await Promise.all([
      database.aIInsight.findUniqueOrThrow({ where: { id: result.insightId } }),
      database.auditLog.findFirstOrThrow({ where: { aiInsightId: result.insightId } }),
    ]);
    expect(insight).toMatchObject({
      agentType: "QUALIFICATION",
      engine: "RULE_ENGINE",
      providerKey: "mock",
      providerMode: "LOCAL_DETERMINISTIC",
      promptKey: "politizai.qualification",
      promptVersion: 2,
      confidenceBps: 5_000,
      durationMs: 7,
      requestedByActorId: owner.actorId,
    });
    expect(insight.requestFingerprint).toHaveLength(64);
    expect(insight.createdByActorId).not.toBe(owner.actorId);
    expect(audit).toMatchObject({
      actorId: insight.createdByActorId,
      action: "ai.insight.generated",
      origin: "AI",
      entityType: "AIInsight",
      entityId: insight.id,
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("MARCADOR-SENSIVEL-CRM25");
  });

  it("autoriza o gestor somente com equipe explícita em análises de workspace", async () => {
    const preSalesTeam = await database.team.findFirstOrThrow({
      where: { workspaceId, name: "Pré-vendas", deletedAt: null },
      select: { id: true },
    });
    await expect(
      service(new MockAIProvider()).execute(manager, {
        agent: "MANAGER_COPILOT",
        target: { type: "WORKSPACE", teamId: preSalesTeam.id },
        input: { facts: [], requiredFields: [], currentState: {} },
      }),
    ).resolves.toMatchObject({ mode: "LOCAL_DETERMINISTIC" });
    await expect(
      service(new MockAIProvider()).execute(manager, {
        agent: "MANAGER_COPILOT",
        target: { type: "WORKSPACE" },
        input: { facts: [], requiredFields: [], currentState: {} },
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("nega visualizador e não cria insight para a tentativa", async () => {
    const before = await database.aIInsight.count({ where: { workspaceId } });
    await expect(
      service(new MockAIProvider()).execute(viewer, {
        agent: "QUALIFICATION",
        target: { type: "LEAD", id: leadId },
        input: minimizedInput,
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await database.aIInsight.count({ where: { workspaceId } })).toBe(before);
  });

  it("não confirma um ID de outro workspace", async () => {
    const foreignWorkspace = await database.workspace.create({
      data: { name: `Outro workspace ${randomUUID()}`, slug: `outro-${randomUUID()}` },
    });
    const foreignSystem = await database.actor.create({
      data: {
        workspaceId: foreignWorkspace.id,
        type: "SYSTEM",
        key: "system",
        displayName: "Sistema estrangeiro",
      },
    });
    const foreignTeam = await database.team.create({
      data: {
        workspaceId: foreignWorkspace.id,
        name: "Equipe estrangeira",
        createdByActorId: foreignSystem.id,
        updatedByActorId: foreignSystem.id,
      },
    });

    await expect(
      service(new MockAIProvider()).execute(manager, {
        agent: "MANAGER_COPILOT",
        target: { type: "WORKSPACE", teamId: foreignTeam.id },
        input: { currentState: {} },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each([
    ["saída inválida", { output: { agent: "QUALIFICATION" }, model: "broken" }, "PROVIDER_INVALID_RESPONSE"],
    ["falha do provedor", new AIProviderError("PROVIDER_UNAVAILABLE", "offline"), "PROVIDER_UNAVAILABLE"],
    ["timeout", new AIProviderError("PROVIDER_TIMEOUT", "timeout"), "PROVIDER_TIMEOUT"],
  ] as const)("usa fallback determinístico em %s sem quebrar o CRM", async (_label, behavior, code) => {
    const provider: AIProvider = {
      key: "external-test",
      mode: "EXTERNAL",
      engineVersion: "external-test-v1",
      async generate() {
        if (behavior instanceof Error) throw behavior;
        return behavior;
      },
    };
    const result = await service(provider).execute(owner, {
      agent: "QUALIFICATION",
      target: { type: "LEAD", id: leadId },
      input: minimizedInput,
    });

    expect(result).toMatchObject({
      requestedProviderKey: "external-test",
      providerKey: "mock",
      mode: "FALLBACK_LOCAL",
      providerFailureCode: code,
      output: { agent: "QUALIFICATION" },
    });
    expect(
      await database.aIInsight.count({
        where: { id: result.insightId, providerFailureCode: code, providerMode: "FALLBACK_LOCAL" },
      }),
    ).toBe(1);
  });

  it("envia ao provider somente o DTO minimizado e não IDs de tenant ou ator", async () => {
    let captured: AIProviderRequest | null = null;
    const local = new MockAIProvider();
    const provider: AIProvider = {
      key: "capturing-compatible",
      mode: "EXTERNAL",
      engineVersion: "capturing-v1",
      async generate(request) {
        captured = request;
        return local.generate(request);
      },
    };
    const result = await service(provider).execute(owner, {
      agent: "NEXT_BEST_ACTION",
      target: { type: "LEAD", id: leadId },
      input: minimizedInput,
    });

    expect(result.mode).toBe("EXTERNAL");
    expect(captured).not.toBeNull();
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain(workspaceId);
    expect(serialized).not.toContain(owner.actorId);
    expect(serialized).not.toContain(leadId);
  });

  it("rejeita payload desconhecido antes de chamar o provider", async () => {
    let called = false;
    const provider: AIProvider = {
      key: "never-called",
      mode: "EXTERNAL",
      engineVersion: "test",
      async generate() {
        called = true;
        throw new Error("Não deveria executar.");
      },
    };
    await expect(
      service(provider).execute(owner, {
        agent: "QUALIFICATION",
        target: { type: "LEAD", id: leadId },
        input: { currentState: {}, segredoInesperado: "não permitido" } as never,
      }),
    ).rejects.toMatchObject({ code: "INVALID_AI_REQUEST" });
    expect(called).toBe(false);
  });

  it("preserva evidência e proveniência no banco, permitindo apenas o ciclo de confirmação", async () => {
    const result = await service(new MockAIProvider()).execute(owner, {
      agent: "AUDIT_AGENT",
      target: { type: "LEAD", id: leadId },
      input: minimizedInput,
    });
    await expect(
      database.aIInsight.update({
        where: { id: result.insightId },
        data: { recommendation: "Tentativa de reescrever o fato" },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(
      database.aIInsight.update({
        where: { id: result.insightId },
        data: {
          status: "REJECTED",
          confirmedByActorId: owner.actorId,
          confirmedAt: fixedNow,
        },
      }),
    ).resolves.toMatchObject({ status: "REJECTED" });
  });

  it("falha sem persistência parcial quando o ator técnico não existe", async () => {
    const original = await database.actor.findFirstOrThrow({
      where: { workspaceId, key: "ai:recommendation", type: "AI_AGENT" },
    });
    await database.actor.update({ where: { id: original.id }, data: { key: "ai:temporarily-disabled" } });
    const before = await database.aIInsight.count({ where: { workspaceId } });
    try {
      await expect(
        service(new MockAIProvider()).execute(owner, {
          agent: "QUALIFICATION",
          target: { type: "LEAD", id: leadId },
          input: minimizedInput,
        }),
      ).rejects.toBeInstanceOf(ApplicationError);
      expect(await database.aIInsight.count({ where: { workspaceId } })).toBe(before);
    } finally {
      await database.actor.update({ where: { id: original.id }, data: { key: "ai:recommendation" } });
    }
  });
});
