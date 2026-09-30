import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { getGovernedAgentService } from "@/modules/ai-agents/application/governed-agent-service";
import { createAssistantService } from "@/modules/ai-assistant/application/assistant-service";
import { getManagerAnalyticsService } from "@/modules/metrics/application/manager-analytics-service";
import { getAutomationBuilderService } from "@/modules/automations/application/automation-builder-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getPipelineTemplateService } from "@/modules/pipeline-templates/application/pipeline-template-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for Stage 13 integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 10 }) });
const authorization = createAuthorizationService({ database });
const service = createAssistantService({ database, authorization, analytics: getManagerAnalyticsService(), agents: getGovernedAgentService(), automations: getAutomationBuilderService(), pipelines: getPipelineTemplateService(), now: () => new Date("2048-05-01T12:00:00.000Z") });

let admin: AuthenticatedContext;
let manager: AuthenticatedContext;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspace: { slug: "politizai" }, user: { normalizedEmail: email } }, include: { workspace: true, user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  admin = await context("admin@demo.politizai.local");
  manager = await context("gestor@demo.politizai.local");
  const permissions = await database.permission.findMany({ where: { key: { in: [PermissionKeys.AI_USE, PermissionKeys.AI_MANAGER_QUERY] } }, select: { id: true } });
  await database.rolePermission.createMany({ data: permissions.map(({ id }) => ({ workspaceId: manager.workspaceId, roleId: manager.roleId, permissionId: id, createdByActorId: admin.actorId })), skipDuplicates: true });
});

afterAll(async () => database.$disconnect());

describe("Etapa 13 — assistente com aprovação", () => {
  it("retorna ausência para pergunta desconhecida e filtra propostas não administrativas", async () => {
    await expect(service.command(manager, { action: "QUERY", payload: { question: "Conte algo interessante", preset: "MONTH" } })).resolves.toMatchObject({ answer: null, classification: { data: [], inference: [], absence: [expect.stringContaining("não corresponde")] } });
    const own = await service.command(manager, { action: "PROPOSE", payload: { request: "Crie um gráfico mensal de conversão", type: "CHART" } }) as { id: string };
    await service.command(admin, { action: "PROPOSE", payload: { request: "Crie outro gráfico mensal de conversão", type: "CHART" } });
    const screen = await service.screen(manager);
    expect(screen.proposals.map((proposal) => proposal.id)).toEqual([own.id]);
  });

  it("cancela sem criar configuração e bloqueia aprovação não administrativa", async () => {
    const draft = await service.command(manager, { action: "PROPOSE", payload: { request: "Crie uma automação comercial controlada", type: "AUTOMATION" } }) as { id: string; revision: number };
    const before = await database.automationRule.count({ where: { workspaceId: manager.workspaceId } });
    await expect(service.command(manager, { action: "APPROVE", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Tentativa sem privilégio" } })).rejects.toMatchObject({ code: "ADMIN_APPROVAL_REQUIRED" });
    await service.command(manager, { action: "CANCEL", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Cancelado pelo solicitante" } });
    expect(await database.automationRule.count({ where: { workspaceId: manager.workspaceId } })).toBe(before);
  });

  it.each([
    ["AGENT", "Crie um agente para triagem comercial segura", "GovernedAgent"],
    ["AUTOMATION", "Crie uma automação para qualificação com handoff", "AutomationRule"],
    ["PIPELINE_MODEL", "Crie um modelo de funil consultivo para oportunidades", "PipelineTemplate"],
  ] as const)("publica %s pelo serviço existente com alvo e versão reais", async (type, request, targetType) => {
    const draft = await service.command(admin, { action: "PROPOSE", payload: { request, type } }) as { id: string; revision: number };
    const published = await service.command(admin, { action: "APPROVE", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Aceite integrado da Etapa 13" } }) as { proposal: { status: string; publishedTarget: { type: string; id: string; versionId: string }; publishedVersionId: string } };
    expect(published.proposal).toMatchObject({ status: "PUBLISHED", publishedTarget: { type: targetType, id: expect.any(String), versionId: expect.any(String) }, publishedVersionId: expect.any(String) });
    await expect(service.command(admin, { action: "APPROVE", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Replay indevido" } })).rejects.toMatchObject({ code: "PROPOSAL_REVISION_CONFLICT" });
    await service.command(admin, { action: "UNDO", payload: { proposalId: draft.id, reason: "Undo integrado da Etapa 13" } });
    const targetId = published.proposal.publishedTarget.id;
    if (type === "AGENT") expect(await database.governedAgent.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ status: "PAUSED" });
    if (type === "AUTOMATION") expect(await database.automationRule.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({ status: "PAUSED" });
    if (type === "PIPELINE_MODEL") expect((await database.pipelineTemplate.findUniqueOrThrow({ where: { id: targetId } })).archivedAt).toBeInstanceOf(Date);
    expect(await database.aIAssistantProposal.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: "UNDONE" });
  });

  it("publica gráfico como configuração real e desfaz com nova versão imutável", async () => {
    const draft = await service.command(admin, { action: "PROPOSE", payload: { request: "Crie um gráfico mensal de conversão do funil", type: "CHART" } }) as { id: string; revision: number };
    const published = await service.command(admin, { action: "APPROVE", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Gráfico aprovado" } }) as { proposal: { publishedTarget: { id: string; versionId: string }; publishedVersionId: string } };
    expect(published.proposal.publishedTarget).toEqual({ type: "AssistantChart", id: draft.id, versionId: published.proposal.publishedVersionId });
    await service.command(admin, { action: "UNDO", payload: { proposalId: draft.id, reason: "Reversão validada" } });
    const versions = await database.aIAssistantConfigurationVersion.findMany({ where: { workspaceId: admin.workspaceId, proposalId: draft.id }, orderBy: { version: "asc" } });
    expect(versions.map(({ version, status }) => ({ version, status }))).toEqual([{ version: 1, status: "PUBLISHED" }, { version: 2, status: "UNDONE" }]);
    await expect(database.aIAssistantConfigurationVersion.update({ where: { id: versions[0]!.id }, data: { status: "UNDONE" } })).rejects.toThrow(/immutable/i);
  });
});
