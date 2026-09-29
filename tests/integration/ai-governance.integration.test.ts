import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAIExecutionService } from "@/modules/ai/application/ai-execution-service";
import { createAIGovernanceService } from "@/modules/ai/application/ai-governance-service";
import { MockAIProvider } from "@/modules/ai/providers/mock-ai-provider";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-59 tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 10 }) });
const authorization = createAuthorizationService({ database });
const governance = createAIGovernanceService({ database, authorization });
let workspaceId: string;
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email } },
    include: { user: true, role: true },
  });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  const seeded = await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  workspaceId = seeded.workspaceId;
  [admin, manager, viewer] = await Promise.all([
    context("admin@demo.politizai.local"), context("gestor@demo.politizai.local"), context("viewer@demo.politizai.local"),
  ]);
});

afterAll(async () => database.$disconnect());

describe("CRM-59 — governança persistida", () => {
  it("expõe somente metadados governados a gestor e nega visualizador", async () => {
    const screen = await governance.getScreen(manager);
    expect(screen).toMatchObject({ mode: "LOCAL_DETERMINISTIC", externalProviderEnabled: false });
    expect(screen.versions).toHaveLength(4);
    expect(JSON.stringify(screen)).not.toContain("allowedInputFields");
    await expect(governance.getScreen(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("exige avaliação aprovada e RBAC administrativo antes de publicar", async () => {
    const source = await database.aIUseCaseVersion.findFirstOrThrow({ where: { workspaceId, key: "operational-summary", status: "APPROVED" } });
    const draft = await database.aIUseCaseVersion.create({ data: {
      workspaceId, key: source.key, version: source.version + 1, name: source.name, description: source.description,
      ownerMemberId: source.ownerMemberId, riskLevel: source.riskLevel, agentType: source.agentType,
      logicalProviderKey: source.logicalProviderKey, logicalModel: source.logicalModel,
      promptKey: source.promptKey, promptVersion: source.promptVersion, configurationVersion: source.configurationVersion + 1,
      inputSchemaVersion: source.inputSchemaVersion, outputSchemaVersion: source.outputSchemaVersion,
      allowedInputFields: source.allowedInputFields!, forbiddenInputFields: source.forbiddenInputFields!,
      confidenceThresholdBps: source.confidenceThresholdBps, fallbackPolicy: source.fallbackPolicy,
      timeoutMs: source.timeoutMs, maxRetries: source.maxRetries, rateLimitPerMinute: source.rateLimitPerMinute,
      maxInputTokens: source.maxInputTokens, maxOutputTokens: source.maxOutputTokens,
      maxEstimatedCostCents: source.maxEstimatedCostCents, supersedesVersionId: source.id, createdByActorId: admin.actorId,
    } });
    await expect(governance.transition(admin, { useCaseVersionId: draft.id, action: "APPROVE", reason: "tentativa precoce" })).rejects.toMatchObject({ code: "INVALID_AI_GOVERNANCE_TRANSITION" });
    await expect(governance.runEvaluation(manager, draft.id)).resolves.toMatchObject({ status: "PASSED", failed: 0 });
    await expect(governance.transition(manager, { useCaseVersionId: draft.id, action: "APPROVE", reason: "gestor sem alçada" })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(governance.transition(admin, { useCaseVersionId: draft.id, action: "APPROVE", reason: "Avaliação revisada e aprovada pelo administrador." })).resolves.toMatchObject({ status: "APPROVED" });
    await expect(database.aIUseCaseVersion.update({ where: { id: draft.id }, data: { description: "tentativa de sobrescrita" } })).rejects.toThrow(/immutable/i);
    await expect(governance.transition(admin, {
      useCaseVersionId: draft.id,
      action: "ROLLBACK",
      reason: "Rollback local para a versão estável anterior.",
      rollbackTargetVersionId: source.id,
    })).resolves.toMatchObject({ status: "DISABLED" });
    await expect(database.aIUseCaseVersion.findUniqueOrThrow({ where: { id: source.id } })).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("registra execução e decisão humana idempotente sem aplicar mutação comercial", async () => {
    const execution = createAIExecutionService({ database, authorization, provider: new MockAIProvider() });
    const result = await execution.execute(admin, { agent: "MANAGER_COPILOT", target: { type: "WORKSPACE" }, input: { facts: [], requiredFields: [], currentState: {} } });
    const trace = await database.aIExecutionTrace.findUniqueOrThrow({ where: { id: result.executionTraceId } });
    expect(trace).toMatchObject({ status: "SUCCEEDED", aiInsightId: result.insightId, estimatedCostCents: 0 });
    const input = { executionTraceId: trace.id, insightId: result.insightId, idempotencyKey: `crm59:${randomUUID()}`, decision: "EDITED" as const, reason: "Rascunho revisado pelo administrador.", currentInputFingerprint: trace.inputFingerprint, proposedDraft: { note: "revisar" } };
    const first = await governance.recordHumanDecision(admin, input);
    const second = await governance.recordHumanDecision(admin, input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ decision: "EDITED", stale: false, applied: false });
  });

  it("marca sugestão obsoleta e preserva a decisão como fato append-only", async () => {
    const trace = await database.aIExecutionTrace.findFirstOrThrow({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
    const decision = await governance.recordHumanDecision(admin, { executionTraceId: trace.id, insightId: trace.aiInsightId!, idempotencyKey: `crm59-stale:${randomUUID()}`, decision: "ACCEPTED", reason: "Tentativa com base antiga.", currentInputFingerprint: "0".repeat(64) });
    expect(decision).toMatchObject({ decision: "REJECTED", stale: true, applied: false });
    await expect(database.aIHumanDecision.delete({ where: { id: decision.id } })).rejects.toThrow(/append-only/i);
  });
});
