import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { describe, expect, it, vi } from "vitest";

import { createAssistantService } from "./assistant-service";

const now = new Date("2026-09-30T12:00:00.000Z");
const admin = Object.freeze({
  workspaceId: "10000000-0000-4000-8000-000000000001",
  workspaceSlug: "workspace-teste",
  sessionId: "20000000-0000-4000-8000-000000000001",
  userId: "30000000-0000-4000-8000-000000000001",
  memberId: "40000000-0000-4000-8000-000000000001",
  actorId: "50000000-0000-4000-8000-000000000001",
  roleId: "60000000-0000-4000-8000-000000000001",
  roleKey: "administrator",
  roleName: "Administrador",
  displayName: "Admin",
}) satisfies AuthenticatedContext;
const member = Object.freeze({ ...admin, actorId: "50000000-0000-4000-8000-000000000002", memberId: "40000000-0000-4000-8000-000000000002", roleKey: "commercial_manager", roleName: "Gestor" }) satisfies AuthenticatedContext;

function harness(initial: Array<Record<string, unknown>> = []) {
  const proposals = [...initial];
  const versions: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const domainCommand = vi.fn();
  const proposalApi = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => proposals.filter((row) => row.workspaceId === where.workspaceId && (!where.requestedByActorId || row.requestedByActorId === where.requestedByActorId))),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => proposals.find((row) => row.workspaceId === where.workspaceId && row.requestedByActorId === where.requestedByActorId && row.requestFingerprint === where.requestFingerprint && row.status === where.status) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: crypto.randomUUID(), status: "DRAFT", revision: 1, createdAt: now, updatedAt: now, publishedTargetType: null, publishedTargetId: null, publishedVersionId: null, ...data };
      proposals.push(row); return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = proposals.find((candidate) => candidate.id === where.id && candidate.workspaceId === where.workspaceId && (!where.status || candidate.status === where.status) && (!where.revision || candidate.revision === where.revision) && (!where.requestedByActorId || candidate.requestedByActorId === where.requestedByActorId));
      if (!row) return { count: 0 };
      for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
      row.updatedAt = now; return { count: 1 };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = proposals.find((candidate) => candidate.id === where.id)!;
      for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? Number(row[key]) + Number(value.increment) : value;
      return row;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => proposals.find((row) => row.id === where.id)!),
  };
  const versionApi = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { createdAt: now, ...data }; versions.push(row); return row; }),
    findFirstOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => versions.find((row) => row.id === where.id)!),
  };
  const database = {
    aIAssistantProposal: proposalApi,
    aIAssistantConfigurationVersion: versionApi,
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; }) },
    teamMember: { findFirst: vi.fn(async () => ({ teamId: "70000000-0000-4000-8000-000000000001" })) },
    pipelineTemplate: { updateMany: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(database)),
  };
  const authorization = {
    authorize: vi.fn(async () => ({ allowed: true, contextIsValid: true, reason: "allowed" })),
    assertAuthorized: vi.fn(async () => undefined),
  };
  const service = createAssistantService({
    database: database as unknown as PrismaClient,
    authorization: authorization as never,
    analytics: { getShell: vi.fn(), answer: vi.fn() } as never,
    agents: { command: domainCommand } as never,
    automations: { command: domainCommand } as never,
    pipelines: { execute: domainCommand } as never,
    now: () => now,
  });
  return { service, proposals, versions, audits, database, domainCommand };
}

describe("approval assistant service", () => {
  it("filtra propostas por ator para não administrador", async () => {
    const own = { id: crypto.randomUUID(), workspaceId: admin.workspaceId, requestedByActorId: member.actorId, status: "DRAFT", revision: 1, type: "CHART", request: "x", diff: [], impact: [], preview: {}, createdAt: now, updatedAt: now, publishedTargetType: null, publishedTargetId: null, publishedVersionId: null };
    const other = { ...own, id: crypto.randomUUID(), requestedByActorId: admin.actorId };
    const { service } = harness([own, other]);
    const screen = await service.screen(member);
    expect(screen.proposals).toHaveLength(1);
    expect(screen.proposals[0]?.id).toBe(own.id);
  });

  it("devolve ausência estruturada para texto sem métrica homologada", async () => {
    const { service } = harness();
    await expect(service.command(member, { action: "QUERY", payload: { question: "Conte algo interessante", preset: "MONTH" } })).resolves.toMatchObject({ answer: null, classification: { data: [], inference: [], absence: [expect.stringContaining("não corresponde")] } });
  });

  it("cria e cancela rascunho sem mutar serviço de domínio", async () => {
    const { service, domainCommand, proposals } = harness();
    const draft = await service.command(member, { action: "PROPOSE", payload: { request: "Crie um gráfico mensal de conversão", type: "CHART" } }) as { id: string; revision: number };
    expect(domainCommand).not.toHaveBeenCalled();
    await service.command(member, { action: "CANCEL", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Não será necessário" } });
    expect(proposals[0]?.status).toBe("CANCELLED");
    expect(domainCommand).not.toHaveBeenCalled();
  });

  it("reaproveita o mesmo rascunho quando o cliente repete a proposta", async () => {
    const { service, proposals } = harness();
    const command = { action: "PROPOSE" as const, payload: { request: "Crie um gráfico mensal de conversão", type: "CHART" as const } };
    const first = await service.command(member, command) as { id: string };
    const replay = await service.command(member, command) as { id: string };
    expect(replay.id).toBe(first.id);
    expect(proposals).toHaveLength(1);
  });

  it("rejeita comando malformado como erro controlado de cliente", async () => {
    const { service } = harness();
    await expect(service.command(member, { action: "PROPOSE", payload: { request: "curto" } })).rejects.toMatchObject({ code: "INVALID_ASSISTANT_COMMAND", statusCode: 400 });
  });

  it("recusa aprovação por não administrador", async () => {
    const { service } = harness();
    const draft = await service.command(member, { action: "PROPOSE", payload: { request: "Crie um gráfico mensal de conversão", type: "CHART" } }) as { id: string; revision: number };
    await expect(service.command(member, { action: "APPROVE", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Aprovado para teste" } })).rejects.toMatchObject({ code: "ADMIN_APPROVAL_REQUIRED" });
  });

  it("publica gráfico com identidade versionada, impede replay e cria undo imutável", async () => {
    const { service, versions } = harness();
    const draft = await service.command(admin, { action: "PROPOSE", payload: { request: "Crie um gráfico mensal de conversão", type: "CHART" } }) as { id: string; revision: number };
    const published = await service.command(admin, { action: "APPROVE", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Aprovado pelo administrador" } }) as { proposal: { publishedTarget: { id: string; versionId: string }; publishedVersionId: string } };
    expect(published.proposal.publishedTarget.id).toBe(draft.id);
    expect(published.proposal.publishedTarget.versionId).toBe(published.proposal.publishedVersionId);
    expect(versions).toHaveLength(1);
    await expect(service.command(admin, { action: "APPROVE", payload: { proposalId: draft.id, expectedRevision: draft.revision, reason: "Replay" } })).rejects.toMatchObject({ code: "PROPOSAL_REVISION_CONFLICT" });
    expect(versions).toHaveLength(1);
    await service.command(admin, { action: "UNDO", payload: { proposalId: draft.id, reason: "Reversão controlada" } });
    expect(versions).toHaveLength(2);
    expect(versions[1]).toMatchObject({ version: 2, status: "UNDONE", rollbackOfVersionId: published.proposal.publishedVersionId });
  });
});
