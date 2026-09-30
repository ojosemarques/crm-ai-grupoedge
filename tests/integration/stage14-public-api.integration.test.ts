import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createPublicApiService } from "@/modules/acquisition-api/application/public-api-service";
import { createN8nGovernanceService } from "@/modules/integrations/application/n8n-governance-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for Stage 14 public API integration tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage 14 public API integration tests require an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const now = new Date("2048-06-01T16:00:00.000Z");
const governance = createN8nGovernanceService({ database, now: () => now });
const api = createPublicApiService({ database, now: () => now });
const intake = createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now });

let admin: AuthenticatedContext;
let token: string;

function responseId(value: unknown): string {
  if (!value || typeof value !== "object" || !("result" in value)) throw new Error("Public API response is missing result.");
  const result = value.result;
  if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string") throw new Error("Public API response is missing result.id.");
  return result.id;
}

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspace: { slug: "politizai" }, user: { normalizedEmail: email } }, include: { workspace: true, user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" });
  admin = await context("admin@demo.politizai.local");
  const machine = await governance.createMachine(admin, { key: `stage14-api-${randomUUID().slice(0, 8)}`, name: "API pública Etapa 14", purpose: "Validar CRUD versionado e idempotente da Etapa 14.", ownerMemberId: admin.memberId, scopes: ["RECORDS_READ", "RECORDS_WRITE"], expiresAt: "2048-07-01T16:00:00.000Z" });
  await governance.setMachineStatus(admin, { machineId: machine.machine.id, revision: machine.machine.revision, status: "ACTIVE", reason: "Ativação para teste integrado da API pública." });
  token = machine.credential;
});

afterAll(async () => database.$disconnect());

describe("Etapa 14 — API CRM pública integrada", () => {
  it("executa CRUD idempotente de contato com cursor, revisão e outbox", async () => {
    const createKey = `stage14.contact.${randomUUID()}`;
    const created = await api.create(token, "contacts", createKey, { preferredName: "Contato API Etapa 14", legalName: "Contato Integrado", locale: "pt-BR" });
    const replay = await api.create(token, "contacts", createKey, { preferredName: "Contato API Etapa 14", legalName: "Contato Integrado", locale: "pt-BR" });
    const contactId = responseId(created);
    expect(created).toMatchObject({ contractVersion: "2026-09-30", idempotentReplay: false, result: { id: expect.any(String) } });
    expect(replay).toMatchObject({ idempotentReplay: true, result: { id: contactId } });

    const row = await database.contact.findUniqueOrThrow({ where: { id: contactId } });
    const updated = await api.update(token, "contacts", row.id, `stage14.contact.update.${randomUUID()}`, { preferredName: "Contato API Atualizado", expectedUpdatedAt: row.updatedAt.toISOString() });
    expect(updated).toMatchObject({ result: { preferredName: "Contato API Atualizado" } });
    await expect(api.update(token, "contacts", row.id, `stage14.contact.stale.${randomUUID()}`, { preferredName: "Não aplicar", expectedUpdatedAt: row.updatedAt.toISOString() })).rejects.toMatchObject({ code: "API_REVISION_CONFLICT" });

    const current = await database.contact.findUniqueOrThrow({ where: { id: row.id } });
    await api.remove(token, "contacts", row.id, `stage14.contact.delete.${randomUUID()}`, { expectedUpdatedAt: current.updatedAt.toISOString(), reason: "Remoção integrada da API" });
    expect(await database.contact.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "INACTIVE", deletedAt: expect.any(Date) });
    expect(await database.outboxEvent.count({ where: { workspaceId: admin.workspaceId, aggregateId: row.id, status: "DELIVERED_LOCAL" } })).toBe(3);
  });

  it("mantém histórico e atividade ao criar e remover negócio", async () => {
    const source = await database.leadSource.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, deletedAt: null }, orderBy: { createdAt: "asc" } });
    const intakeResult = await intake.intake({ channel: "FORM", idempotencyKey: `stage14-public-api-lead-${randomUUID()}`, formIdentifier: "stage14-public-api", fullName: "Lead da API pública", phone: "+5511999981919", email: "public-api-stage14@example.test", sourceKey: source.key, consent: true, submittedAt: now, rawPayload: { fixture: true }, priorityBandCode: "P3" }, admin);
    if (intakeResult.outcome === "REJECTED") throw new Error(`Fixture de lead rejeitada: ${intakeResult.code}`);
    const lead = await database.lead.findUniqueOrThrow({ where: { id: intakeResult.leadId } });
    const owner = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, status: "ACTIVE", deletedAt: null }, orderBy: { createdAt: "asc" } });
    const created = await api.create(token, "deals", `stage14.deal.${randomUUID()}`, { leadId: lead.id, ownerMemberId: owner.id, name: "Negócio API Etapa 14", interestDescription: "Interesse comercial validado pela API pública.", amountCents: "150000", probabilityPercent: 25 });
    const opportunityId = responseId(created);
    expect(await database.stageHistory.count({ where: { workspaceId: admin.workspaceId, opportunityId, exitedAt: null } })).toBe(1);
    expect(await database.activity.count({ where: { workspaceId: admin.workspaceId, opportunityId, subject: { startsWith: "Negócio criado pela API" } } })).toBe(1);

    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
    await api.remove(token, "deals", opportunityId, `stage14.deal.delete.${randomUUID()}`, { expectedRevision: opportunity.revision, reason: "Cancelamento integrado via API" });
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).toMatchObject({ status: "CANCELLED", closedAt: expect.any(Date), deletedAt: expect.any(Date) });
    expect(await database.stageHistory.count({ where: { workspaceId: admin.workspaceId, opportunityId, exitedAt: null } })).toBe(0);
    expect(await database.activity.count({ where: { workspaceId: admin.workspaceId, opportunityId, subject: { startsWith: "Negócio removido pela API" } } })).toBe(1);
  });
});
