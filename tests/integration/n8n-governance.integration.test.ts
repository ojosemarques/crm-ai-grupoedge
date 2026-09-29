import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createN8nGovernanceService } from "@/modules/integrations/application/n8n-governance-service";
import { createOutboxEventInTransaction } from "@/modules/integrations/application/integration-platform-service";
import { signN8nRequest } from "@/modules/integrations/domain/n8n-policy";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-60 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-60 integration test requires an ephemeral politizai_test_* schema.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const now = new Date("2055-09-13T12:00:00.000Z"); let workspaceId: string; let admin: AuthenticatedContext; let manager: AuthenticatedContext; let viewer: AuthenticatedContext; let accountId: string;
const service = () => createN8nGovernanceService({ database, now: () => now });
async function context(email: string): Promise<AuthenticatedContext> { const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } }); const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } }); return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName }; }
beforeAll(async () => { workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId; [admin, manager, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("gestor@demo.politizai.local"), context("viewer@demo.politizai.local")]); accountId = (await database.account.create({ data: { workspaceId, name: "Conta fictícia CRM-60", normalizedName: "conta ficticia crm 60", origin: "SEED", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } })).id; });
afterAll(async () => database.$disconnect());

describe("CRM-60 — extensibilidade n8n governada", () => {
  it("nega por padrão e permite somente administração humana autorizada", async () => {
    await expect(service().list(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service().createMachine(manager, { key: "forbidden-machine", name: "Não permitida", purpose: "Tentativa sem permissão administrativa.", ownerMemberId: manager.memberId, scopes: ["EVENTS_READ"], expiresAt: "2055-10-01T12:00:00Z" })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service().list(manager)).resolves.toMatchObject({ externalEgress: false, databaseAccess: false, permissions: { canManage: false, canReview: true } });
  });

  it("cria identidade com token único, escopo mínimo, rotação e kill switch", async () => {
    const created = await service().createMachine(admin, { key: "crm60-local", name: "n8n CRM-60 local", purpose: "Executar contratos locais governados no teste CRM-60.", ownerMemberId: admin.memberId, scopes: ["EVENTS_READ", "RECORDS_READ", "ACTION_PROPOSAL_CREATE", "AUTOMATION_RESULT_WRITE"], expiresAt: "2055-10-01T12:00:00Z" });
    expect(created.credential).toMatch(/^n8n_local_/); expect(JSON.stringify(created.machine)).not.toContain(created.credential);
    const persisted = await database.n8nMachineIdentity.findUniqueOrThrow({ where: { id: created.machine.id } }); expect(persisted.tokenHash).not.toBe(created.credential); expect(persisted.actorId).toBeTruthy();
    const active = await service().setMachineStatus(admin, { machineId: created.machine.id, revision: created.machine.revision, status: "ACTIVE", reason: "Ativação explícita para o teste local." }); expect(active.status).toBe("ACTIVE");
    await expect(service().authenticate(created.credential, "NEXT_ACTION_DRAFT_CREATE")).rejects.toMatchObject({ code: "N8N_MACHINE_SCOPE_DENIED" });
    await expect(service().authenticate(created.credential, "EVENTS_READ")).resolves.toMatchObject({ workspaceId });
    const rotated = await service().rotateMachine(admin, { machineId: created.machine.id, revision: active.revision }); expect(rotated.credential).not.toBe(created.credential);
    await expect(service().authenticate(created.credential, "EVENTS_READ")).rejects.toMatchObject({ code: "N8N_MACHINE_UNAUTHENTICATED" });
    await expect(service().authenticate(rotated.credential, "EVENTS_READ")).resolves.toBeTruthy();
  });

  it("publica envelope mínimo ordenado e cria proposta idempotente com decisão humana", async () => {
    const machine = await database.n8nMachineIdentity.findFirstOrThrow({ where: { workspaceId, key: "crm60-local" } });
    const rotated = await service().rotateMachine(admin, { machineId: machine.id, revision: machine.revision });
    await database.$transaction((tx) => createOutboxEventInTransaction(tx, { workspaceId, actorId: admin.actorId, eventType: "customer_service.critical_request", aggregateType: "Account", aggregateId: accountId, correlationId: "crm60.event.001", idempotencyKey: "crm60:event:001", payload: { accountId, email: "must-not-leave@example.test", severity: "critical" } }));
    const feed = await service().listEvents(rotated.credential, { limit: 10, eventType: "customer_service.critical_request" }); expect(feed.items).toHaveLength(1); expect(feed.items[0]).toMatchObject({ type: "customer_service.critical_request", workspace: { id: workspaceId }, redaction: "MINIMIZED", correlationId: "crm60.event.001" }); expect(JSON.stringify(feed)).not.toContain("must-not-leave");
    const command = { type: "CONSEQUENTIAL_ACTION", targetType: "ACCOUNT", targetId: accountId, action: "CHANGE_OWNER", reason: "O workflow local sugere revisão da responsabilidade comercial.", proposedValue: admin.memberId }; const rawBody = JSON.stringify(command); const timestamp = now.toISOString(); const nonce = "crm60_nonce_fixture_001"; const idempotencyKey = "crm60.command.001"; const headers = { authorization: `Bearer ${rotated.credential}`, timestamp, nonce, signature: signN8nRequest(rotated.credential, timestamp, nonce, idempotencyKey, rawBody), idempotencyKey, correlationId: "crm60.command.001", causationDepth: 1 };
    const first = await service().receiveCommand(rawBody, headers);
    if (!("proposalId" in first) || !first.proposalId) throw new Error("A proposta governada deveria ter sido criada.");
    const replay = await service().receiveCommand(rawBody, headers); expect(first).toMatchObject({ accepted: true, humanConfirmationRequired: true, idempotentReplay: false }); expect(replay).toMatchObject({ proposalId: first.proposalId, idempotentReplay: true });
    const revisionBefore = (await database.account.findUniqueOrThrow({ where: { id: accountId } })).revision; const reviewed = await service().reviewProposal(manager, { proposalId: first.proposalId, decision: "APPROVED", reason: "Sugestão revisada; execução seguirá o serviço de ownership." }); expect(reviewed).toMatchObject({ status: "APPROVED", executionPerformed: false }); expect((await database.account.findUniqueOrThrow({ where: { id: accountId } })).revision).toBe(revisionBefore);
    await expect(database.n8nCommandReceipt.deleteMany({ where: { workspaceId } })).rejects.toThrow(/append-only/i);
  });

  it("bloqueia replay de nonce, conteúdo divergente, outro workspace e identidade revogada", async () => {
    const machine = await database.n8nMachineIdentity.findFirstOrThrow({ where: { workspaceId, key: "crm60-local" } }); const rotated = await service().rotateMachine(admin, { machineId: machine.id, revision: machine.revision });
    const command = { type: "AUTOMATION_RESULT", targetType: "ACCOUNT", targetId: accountId, outcome: "SUCCEEDED", resultCode: "LOCAL_OK", summary: "Resultado local determinístico." }; const rawBody = JSON.stringify(command); const timestamp = now.toISOString(); const nonce = "crm60_nonce_fixture_002"; const firstKey = "crm60.command.002"; const base = { authorization: `Bearer ${rotated.credential}`, timestamp, nonce, correlationId: "crm60.command.002", causationDepth: 0 };
    await service().receiveCommand(rawBody, { ...base, idempotencyKey: firstKey, signature: signN8nRequest(rotated.credential, timestamp, nonce, firstKey, rawBody) });
    const secondKey = "crm60.command.003"; await expect(service().receiveCommand(rawBody, { ...base, idempotencyKey: secondKey, signature: signN8nRequest(rotated.credential, timestamp, nonce, secondKey, rawBody) })).rejects.toMatchObject({ code: "N8N_NONCE_REPLAY" });
    await expect(service().getRecord(rotated.credential, "account", randomUUID())).rejects.toMatchObject({ code: "N8N_RECORD_NOT_FOUND" });
    const current = await database.n8nMachineIdentity.findUniqueOrThrow({ where: { id: machine.id } }); await service().setMachineStatus(admin, { machineId: machine.id, revision: current.revision, status: "REVOKED", reason: "Encerramento explícito do teste de kill switch." }); await expect(service().authenticate(rotated.credential, "EVENTS_READ")).rejects.toMatchObject({ code: "N8N_MACHINE_DISABLED" });
  });

  it("mantém catálogo allowlisted e receita versionada sob gestão administrativa", async () => {
    await expect(service().createRecipe(manager, { catalogKey: "lead-assigned", ownerMemberId: manager.memberId })).rejects.toBeInstanceOf(AccessDeniedError);
    const recipe = await service().createRecipe(admin, { catalogKey: "lead-assigned", ownerMemberId: admin.memberId }); expect(recipe.status).toBe("DRAFT"); const active = await service().setRecipeStatus(admin, { recipeId: recipe.id, revision: recipe.revision, status: "ACTIVE", reason: "Receita revisada no sandbox local." }); expect(active.status).toBe("ACTIVE");
    await expect(database.n8nRecipeVersion.updateMany({ where: { workspaceId }, data: { actionKind: "SQL" } })).rejects.toThrow(/append-only/i);
  });
});
