import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { searchCopilotRecords } from "@/modules/ai-assistant/application/copilot-record-search";
import { copilotRecordEntities } from "@/modules/ai-assistant/domain/copilot-record-contracts";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
let workspaceId: string;
let admin: AuthenticatedContext;
let sdr: AuthenticatedContext;
let viewer: AuthenticatedContext;
let leadId: string;
const customerId = randomUUID();
const taskId = randomUUID();
const categoryId = randomUUID();
const financialAccountId = randomUUID();
const expenseId = randomUUID();

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { workspaceId, workspaceSlug: "politizai", sessionId: randomUUID(), userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" })).workspaceId;
  [admin, sdr, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("sdr1@demo.politizai.local"), context("viewer@demo.politizai.local")]);
  const createdBy = { workspaceId, createdByActorId: admin.actorId, updatedByActorId: admin.actorId };
  await database.account.createMany({ data: [...Array.from({ length: 120 }, (_, index) => ({ ...createdBy, name: `Busca ${String(index).padStart(3, "0")}`, normalizedName: `busca ${index}`, origin: "MANUAL" as const })), { ...createdBy, id: customerId, name: "Busca Zzz Alvo", normalizedName: "busca zzz alvo", origin: "MANUAL" }] });
  const customers = await database.account.findMany({ where: { workspaceId, name: { startsWith: "Busca " } }, select: { id: true } });
  await database.customerPortfolioAssignment.createMany({ data: customers.map((item) => ({ workspaceId, accountId: item.id, ownerMemberId: admin.memberId, reason: "Fixture de busca completa do Copilot", priority: item.id === customerId ? 3 : 1, nextActionDescription: "Revisar saúde do cliente", nextActionAt: new Date(Date.now() + 86_400_000), validFrom: new Date(), idempotencyKey: `copilot-search:${item.id}`, createdByActorId: admin.actorId })) });
  const system = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
  const intake = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => new Date() }).intake({ channel: "MANUAL", idempotencyKey: `record-search:${randomUUID()}`, fullName: "Lead Busca Autorizada", phone: "+5511998877123", sourceKey: "manual", priorityBandCode: "P1", interestSummary: "Busca de tarefas autorizadas", rawPayload: { test: true } }, { workspaceId, actorId: system.id, actorKey: system.key, actorType: "SYSTEM" });
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  leadId = intake.leadId;
  await database.lead.update({ where: { id: leadId }, data: { ownerMemberId: admin.memberId, queueId: null } });
  await database.task.createMany({ data: [...Array.from({ length: 120 }, (_, index) => ({ ...createdBy, leadId, assigneeMemberId: admin.memberId, title: `Busca tarefa ${index}`, dueAt: new Date("2026-01-01T12:00:00Z") })), { ...createdBy, id: taskId, leadId, assigneeMemberId: admin.memberId, title: "Tarefa Zzz Distante", dueAt: new Date("2030-01-01T12:00:00Z") }] });
  await database.financialCategory.createMany({ data: [...Array.from({ length: 110 }, (_, index) => ({ ...createdBy, key: `busca_${index}`, name: `Busca categoria ${String(index).padStart(3, "0")}`, kind: "EXPENSE" as const })), { ...createdBy, id: categoryId, key: "busca_zeta", name: "Zeta categoria distante", kind: "EXPENSE" }] });
  await database.financialAccount.createMany({ data: [...Array.from({ length: 110 }, (_, index) => ({ ...createdBy, name: `Busca banco ${String(index).padStart(3, "0")}`, type: "BANK" as const })), { ...createdBy, id: financialAccountId, name: "Zeta banco distante", type: "BANK" }] });
  await database.financialEntry.create({ data: { ...createdBy, id: expenseId, categoryId, financialAccountId, direction: "EXPENSE", description: "Licença histórica distante", amountCents: 45000n, competenceAt: new Date("2020-01-15T12:00:00Z"), dueAt: new Date("2020-01-15T12:00:00Z"), idempotencyKey: `record-search:${expenseId}` } });
});
afterAll(async () => database.$disconnect());

describe("recuperação paginada autorizada do Copilot", () => {
  it("encontra cliente além dos primeiros100, pagina sem duplicação e abre revision por ID", async () => {
    const first = await searchCopilotRecords(admin, { entity: "CUSTOMER", query: "Busca", pageSize: 25 });
    const fifth = await searchCopilotRecords(admin, { entity: "CUSTOMER", query: "Busca", page: 5, pageSize: 25 });
    expect(first).toMatchObject({ total: 121, hasMore: true, nextPage: 2 });
    expect(fifth).toMatchObject({ total: 121, hasMore: false, nextPage: null });
    expect(fifth.records.map((item) => item.id)).toContain(customerId);
    expect(first.records.some((item) => fifth.records.some((other) => other.id === item.id))).toBe(false);
    const found = await searchCopilotRecords(admin, { entity: "CUSTOMER", query: "Zzz Alvo" });
    expect(found.records.map((item) => item.id)).toEqual([customerId]);
    expect((await searchCopilotRecords(admin, { entity: "CUSTOMER", id: customerId })).records[0]?.data).toMatchObject({ id: customerId, revision: 1, name: "Busca Zzz Alvo" });
  });

  it("busca tarefas além do teto100 da tela e aplica prazo no banco antes da página", async () => {
    const found = await searchCopilotRecords(admin, { entity: "TASK", leadId, query: "Distante" });
    expect(found).toMatchObject({ total: 1, records: [{ id: taskId }] });
    expect((await searchCopilotRecords(admin, { entity: "TASK", leadId, from: "2030-01-01", to: "2030-01-01" })).records.map((item) => item.id)).toEqual([taskId]);
    expect((await searchCopilotRecords(admin, { entity: "TASK", leadId, id: taskId })).records[0]?.data).toMatchObject({ leadId, title: "Tarefa Zzz Distante" });
    await expect(searchCopilotRecords(sdr, { entity: "TASK", leadId, query: "Distante" })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("consulta despesa histórica e cadastros financeiros além100 sem conceder escrita", async () => {
    expect((await searchCopilotRecords(admin, { entity: "CATEGORY", query: "Zeta categoria" })).records).toMatchObject([{ id: categoryId, data: { kind: "EXPENSE", active: true } }]);
    expect((await searchCopilotRecords(admin, { entity: "FINANCIAL_ACCOUNT", query: "Zeta banco" })).records).toMatchObject([{ id: financialAccountId, data: { active: true } }]);
    expect((await searchCopilotRecords(admin, { entity: "EXPENSE", query: "histórica" })).records).toMatchObject([{ id: expenseId, data: { amountCents: "45000", revision: 1 } }]);
    expect((await searchCopilotRecords(admin, { entity: "EXPENSE", query: "histórica", from: "2026-01-01", to: "2026-12-31" })).total).toBe(0);
    await expect(searchCopilotRecords(viewer, { entity: "EXPENSE", id: expenseId })).rejects.toMatchObject({ statusCode: 403 });
  });

  it("busca carteira de pós-venda fora da primeira página e abre revisão canônica do cliente", async () => {
    const first = await searchCopilotRecords(admin, { entity: "CUSTOMER_SUCCESS", pageSize: 25 });
    expect(first.records.some((item) => item.id === customerId)).toBe(false);
    const found = await searchCopilotRecords(admin, { entity: "CUSTOMER_SUCCESS", query: "Zzz Alvo" });
    expect(found).toMatchObject({ total: 1, records: [{ id: customerId, data: { accountId: customerId, state: "ACTIVE" } }] });
    expect((await searchCopilotRecords(admin, { entity: "CUSTOMER_SUCCESS", id: customerId })).records[0]?.data).toHaveProperty("adoption");
  });

  it("nega outro workspace e IDs fora do escopo sem retornar valores ou nomes", async () => {
    await expect(searchCopilotRecords({ ...admin, workspaceId: randomUUID() }, { entity: "CUSTOMER", id: customerId })).rejects.toMatchObject({ statusCode: 403 });
    await expect(searchCopilotRecords({ ...admin, workspaceId: randomUUID() }, { entity: "EXPENSE", id: expenseId })).rejects.toMatchObject({ statusCode: 403 });
    await expect(searchCopilotRecords(admin, { entity: "TASK", leadId, id: randomUUID() })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("consulta os14 adaptadores canônicos e nega workspace externo em todas as fontes", async () => {
    for (const entity of copilotRecordEntities) {
      const query = { entity, pageSize: 2, ...(entity === "TASK" ? { leadId } : {}) };
      const result = await searchCopilotRecords(admin, query);
      expect(result.entity).toBe(entity);
      expect(result.records.length).toBeLessThanOrEqual(2);
      expect(result.coverage.length).toBeGreaterThan(10);
      expect(result.source.href.startsWith("/")).toBe(true);
      await expect(searchCopilotRecords({ ...admin, workspaceId: randomUUID() }, query)).rejects.toBeDefined();
    }
    for (const entity of ["INVOICE", "SUBSCRIPTION", "EXPENSE", "CATEGORY", "FINANCIAL_ACCOUNT"] as const) {
      await expect(searchCopilotRecords(viewer, { entity })).rejects.toMatchObject({ statusCode: 403 });
    }
  });
});
