import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createAIGovernanceService } from "@/modules/ai/application/ai-governance-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for isolated governance tests.");
if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL, { max: 8 }) });
const governance = createAIGovernanceService({ database, authorization: createAuthorizationService({ database }) });

async function createFixture() {
  const workspace = await database.workspace.create({ data: { name: "Governança sem seed", slug: `copilot-governance-${randomUUID()}` } });
  const system = await database.actor.create({ data: { workspaceId: workspace.id, key: "system", type: "SYSTEM", displayName: "Sistema" } });
  async function member(key: string, permissions: string[]): Promise<AuthenticatedContext> {
    const role = await database.role.create({ data: { workspaceId: workspace.id, key, name: key, createdByActorId: system.id, updatedByActorId: system.id } });
    for (const permissionKey of permissions) {
      const permission = await database.permission.upsert({ where: { key: permissionKey }, update: {}, create: { key: permissionKey, description: permissionKey } });
      await database.rolePermission.create({ data: { workspaceId: workspace.id, roleId: role.id, permissionId: permission.id, scope: "WORKSPACE", createdByActorId: system.id } });
    }
    const email = `${key}-${randomUUID()}@example.test`;
    const user = await database.user.create({ data: { email, normalizedEmail: email, displayName: key } });
    const membership = await database.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, roleId: role.id, status: "ACTIVE", createdByActorId: system.id, updatedByActorId: system.id } });
    const actor = await database.actor.create({ data: { workspaceId: workspace.id, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: key } });
    return { workspaceId: workspace.id, workspaceSlug: workspace.slug, sessionId: randomUUID(), userId: user.id, memberId: membership.id, actorId: actor.id, roleId: role.id, roleKey: key, roleName: key, displayName: key };
  }
  return {
    admin: await member("administrator", [PermissionKeys.AI_GOVERNANCE_READ, PermissionKeys.AI_GOVERNANCE_MANAGE, PermissionKeys.AI_EVALUATIONS_RUN]),
    reader: await member("reader", [PermissionKeys.AI_GOVERNANCE_READ]),
  };
}

let fixture: Awaited<ReturnType<typeof createFixture>>;
let other: Awaited<ReturnType<typeof createFixture>>;
beforeAll(async () => { fixture = await createFixture(); other = await createFixture(); });
beforeEach(() => vi.stubEnv("OPENAI_MODEL", "gpt-5.5"));
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => database.$disconnect());

describe("inicialização canônica do Copilot sem dados de demonstração", () => {
  it("nega usuário sem permissão e contexto de outro tenant antes de escrever", async () => {
    await expect(governance.initializeCopilot(fixture.reader)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(governance.initializeCopilot({ ...fixture.admin, workspaceId: other.admin.workspaceId })).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await database.aIUseCaseVersion.count({ where: { workspaceId: fixture.admin.workspaceId } })).toBe(0);
  });

  it("exige modelo real configurado sem criar rascunho parcial", async () => {
    vi.stubEnv("OPENAI_MODEL", "  ");
    await expect(governance.initializeCopilot(fixture.admin)).rejects.toMatchObject({ code: "COPILOT_MODEL_NOT_CONFIGURED" });
    expect(await database.aIUseCaseVersion.count({ where: { workspaceId: fixture.admin.workspaceId } })).toBe(0);
    expect(await database.aIGovernanceEvent.count({ where: { workspaceId: fixture.admin.workspaceId } })).toBe(0);
  });

  it("serializa inicializações concorrentes e registra somente um rascunho com auditoria", async () => {
    const results = await Promise.all([governance.initializeCopilot(fixture.admin), governance.initializeCopilot(fixture.admin)]);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const version = await database.aIUseCaseVersion.findUniqueOrThrow({ where: { id: results[0]!.id } });
    expect(version).toMatchObject({ workspaceId: fixture.admin.workspaceId, key: "metric-synthesis", version: 1, status: "DRAFT", ownerMemberId: fixture.admin.memberId, createdByActorId: fixture.admin.actorId, logicalProviderKey: "openai-compatible", logicalModel: "gpt-5.5", promptKey: "politizai.operational-copilot", timeoutMs: 45_000, maxOutputTokens: 12_000, approvedByActorId: null, approvedAt: null, approvalReason: null });
    expect(await database.aIEvaluationRun.count({ where: { useCaseVersionId: version.id } })).toBe(0);
    const events = await database.aIGovernanceEvent.findMany({ where: { useCaseVersionId: version.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: null, toStatus: "DRAFT", createdByActorId: fixture.admin.actorId });
    const audits = await database.auditLog.findMany({ where: { workspaceId: fixture.admin.workspaceId, action: "ai.governance.copilot_initialized" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityId: version.id, actorId: fixture.admin.actorId });
    expect(await database.lead.count({ where: { workspaceId: fixture.admin.workspaceId } })).toBe(0);
  });

  it("mantém avaliação e aprovação explícitas e preserva versão existente mesmo após mudar configuração", async () => {
    const draft = await governance.initializeCopilot(fixture.admin);
    await expect(governance.transition(fixture.admin, { action: "APPROVE", useCaseVersionId: draft.id, reason: "Tentativa sem avaliação." })).rejects.toMatchObject({ code: "INVALID_AI_GOVERNANCE_TRANSITION" });
    await expect(governance.runEvaluation(fixture.admin, draft.id)).resolves.toMatchObject({ status: "PASSED" });
    await expect(governance.transition(fixture.admin, { action: "APPROVE", useCaseVersionId: draft.id, reason: "Avaliação local revisada pelo administrador." })).resolves.toMatchObject({ status: "APPROVED" });
    vi.stubEnv("OPENAI_MODEL", "outro-modelo");
    await expect(governance.initializeCopilot(fixture.admin)).resolves.toEqual({ id: draft.id, status: "APPROVED", created: false });
    expect(await database.aIUseCaseVersion.count({ where: { workspaceId: fixture.admin.workspaceId } })).toBe(1);
    expect(await database.aIUseCaseVersion.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ logicalModel: "gpt-5.5" });
  });

  it("inicializa outro workspace com owner próprio sem reutilizar a aprovação anterior", async () => {
    const result = await governance.initializeCopilot(other.admin);
    expect(result).toMatchObject({ status: "DRAFT", created: true });
    expect(await database.aIUseCaseVersion.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ workspaceId: other.admin.workspaceId, ownerMemberId: other.admin.memberId, approvedAt: null });
  });
});
