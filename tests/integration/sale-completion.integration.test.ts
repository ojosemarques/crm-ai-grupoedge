import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { createOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
const now = new Date("2026-09-30T15:00:00Z");
const service = createSaleCompletionService({ database, now: () => now });
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let workspaceId: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const m = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: m.userId, type: "HUMAN" } });
  return { workspaceId, workspaceSlug: "politizai", sessionId: randomUUID(), userId: m.userId, memberId: m.id, actorId: actor.id, roleId: m.roleId, roleKey: m.role.key, roleName: m.role.name, displayName: m.user.displayName };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" })).workspaceId;
  admin = await context("admin@demo.politizai.local");
  viewer = await context("viewer@demo.politizai.local");
});
afterAll(async () => { await database.$disconnect(); });

async function fixture() {
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
  const intake = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now }).intake({ channel: "MANUAL", idempotencyKey: `sale-test:${randomUUID()}`, fullName: "Cliente integrado", phone: `+55119${Math.floor(Math.random() * 90000000 + 10000000)}`, sourceKey: "manual", priorityBandCode: "P1", interestSummary: "Venda integrada de teste", rawPayload: { test: true } }, { workspaceId, actorId: actor.id, actorKey: actor.key, actorType: "SYSTEM" });
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  const lead = { id: intake.leadId };
  const account = await database.account.create({ data: { workspaceId, name: "Cliente integrado", normalizedName: `cliente ${randomUUID()}`, origin: "SEED", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const contact = await database.contact.create({ data: { workspaceId, preferredName: "Contato integrado", origin: "LEAD_BACKFILL", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  await database.lead.update({ where: { id: lead.id }, data: { accountId: account.id, contactId: contact.id } });
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "NEGOTIATION", deletedAt: null } });
  const product = await database.product.findFirstOrThrow({ where: { workspaceId, active: true, salesGateProfile: "STANDARD", deletedAt: null } });
  const opportunity = await database.opportunity.create({ data: { workspaceId, leadId: lead.id, accountId: account.id, pipelineId: stage.pipelineId, currentStageId: stage.id, ownerMemberId: admin.memberId, productId: product.id, name: "Venda integrada", status: "OPEN", amountCents: 2500000n, mrrCents: 300000n, tcvCents: 2500000n, probabilityBps: 8000, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  await database.stageHistory.create({ data: { workspaceId, pipelineId: stage.pipelineId, stageId: stage.id, opportunityId: opportunity.id, enteredAt: new Date("2026-09-01T12:00:00Z"), enteredByActorId: admin.actorId } });
  await database.offer.create({ data: { workspaceId, opportunityId: opportunity.id, productId: product.id, name: "Plano seis meses", quantity: 1, unitPriceCents: 2500000n, totalCents: 2500000n, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const template = await database.contractTemplateVersion.findFirstOrThrow({ where: { workspaceId } });
  return { opportunityId: opportunity.id, expectedRevision: 1, sellerMemberId: admin.memberId, totalCents: "2500000", monthlyCents: "300000", upfrontCents: "700000", durationMonths: 6, startsAt: now.toISOString(), templateVersionId: template.id };
}

describe("venda integrada atômica", () => {
  it("cria o cliente revisado e vincula lead, venda, contrato e recebíveis sem duplicar no replay", async () => {
    const input = await fixture();
    const original = await database.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } });
    await database.opportunity.update({ where: { id: original.id }, data: { accountId: null } });
    await database.lead.update({ where: { id: original.leadId }, data: { accountId: null } });
    await expect(service.preview(admin, input)).rejects.toMatchObject({ code: "SALE_CUSTOMER_REQUIRED" });
    const name = `Cliente confirmado ${randomUUID()}`;
    const payload = { ...input, customer: { mode: "CREATE", name }, acceptance: { acceptedByName: "Cliente integrado", acceptedByRole: "Diretor", evidenceText: "Aceite real documentado no teste." } };
    expect(await service.preview(admin, payload)).toMatchObject({ customer: { mode: "CREATE", name, accountId: null } });
    expect(await database.account.count({ where: { workspaceId, name } })).toBe(0);
    const command = { ...payload, confirmed: true, idempotencyKey: randomUUID() };
    const result = await service.execute(admin, command);
    expect(result).toMatchObject({ accountId: expect.any(String), customerCreated: true });
    const account = await database.account.findFirstOrThrow({ where: { workspaceId, name } });
    expect((await database.lead.findUniqueOrThrow({ where: { id: original.leadId } })).accountId).toBe(account.id);
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: original.id } })).accountId).toBe(account.id);
    const contract = await database.commercialContract.findFirstOrThrow({ where: { opportunityId: original.id } });
    expect(contract.accountId).toBe(account.id);
    expect(await database.invoice.count({ where: { accountId: account.id, contractId: contract.id } })).toBe(6);
    expect(await service.execute(admin, command)).toMatchObject({ accountId: account.id, replayed: true });
    await expect(service.authorize(admin, payload)).resolves.toBeUndefined();
    await expect(service.authorize(viewer, payload)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(await database.account.count({ where: { workspaceId, name } })).toBe(1);
  });

  it("reutiliza conta do lead, exige confirmação para novo vínculo e rejeita duplicidade por nome", async () => {
    const input = await fixture();
    const original = await database.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } });
    await database.opportunity.update({ where: { id: original.id }, data: { accountId: null } });
    const preview = await service.preview(admin, input);
    expect(preview).toMatchObject({ customer: { mode: "LINK", accountId: original.accountId }, payload: { customer: { mode: "LINK", accountId: original.accountId } } });
    const result = await service.execute(admin, { ...preview.payload, confirmed: true, idempotencyKey: randomUUID() });
    expect(result).toMatchObject({ accountId: original.accountId, customerCreated: false, invoiceIds: [], subscriptionId: null });

    const next = await fixture();
    const nextOpportunity = await database.opportunity.findUniqueOrThrow({ where: { id: next.opportunityId } });
    await database.opportunity.update({ where: { id: nextOpportunity.id }, data: { accountId: null } });
    await database.lead.update({ where: { id: nextOpportunity.leadId }, data: { accountId: null } });
    const name = `Cliente existente ${randomUUID()}`;
    await database.account.update({ where: { id: original.accountId! }, data: { name, normalizedName: name.toLowerCase() } });
    await expect(service.preview(admin, { ...next, customer: { mode: "CREATE", name } })).rejects.toMatchObject({ code: "SALE_CUSTOMER_EXISTS" });
    await expect(service.preview(admin, { ...next, customer: { mode: "LINK", accountId: randomUUID() } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await service.preview(admin, { ...next, customer: { mode: "LINK", accountId: original.accountId } })).toMatchObject({ customerName: name });
    await database.lead.update({ where: { id: nextOpportunity.leadId }, data: { contactId: null } });
    await expect(service.preview(admin, { ...next, customer: { mode: "LINK", accountId: original.accountId } })).rejects.toThrow("contato ativo");
  });

  it("a política da API impede ganho genérico sem efeitos parciais", async () => {
    const input = await fixture();
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } });
    const won = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: opportunity.pipelineId, opportunityStageCode: "WON", deletedAt: null } });
    const opportunities = createOpportunityService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    await expect(opportunities.transition(admin, { action: "TRANSITION", opportunityId: opportunity.id, expectedRevision: opportunity.revision, targetStageId: won.id, reason: "Tentativa de fechamento sem revisão integrada.", origin: "OPPORTUNITY_BOARD", confirmed: true }, { requireIntegratedSale: true })).rejects.toMatchObject({ code: "INTEGRATED_SALE_REQUIRED" });
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("OPEN");
    expect(await database.commission.count({ where: { opportunityId: opportunity.id } })).toBe(0);
  });
  it("prévia não escreve; confirmação gera contrato, recebíveis, MRR e comissão uma vez", async () => {
    const input = await fixture();
    const seller = await context("closer1@demo.politizai.local");
    await database.commissionRule.create({ data: { workspaceId, sellerMemberId: seller.memberId, percentageBps: 500, effectiveFrom: new Date("2026-01-01"), createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const payload = { ...input, sellerMemberId: seller.memberId, onboardingOwnerMemberId: admin.memberId, acceptance: { acceptedByName: "Cliente integrado", acceptedByRole: "Diretor", evidenceText: "Aceite comercial documentado na reunião." } };
    await service.preview(admin, payload);
    expect(await database.commercialContract.count({ where: { opportunityId: input.opportunityId } })).toBe(0);
    const command = { ...payload, confirmed: true, idempotencyKey: randomUUID() };
    const result = await service.execute(admin, command);
    expect(result).toMatchObject({ replayed: false, paymentReceived: false });
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } })).ownerMemberId).toBe(seller.memberId);
    expect(result).toMatchObject({ handoffId: expect.any(String) });
    const contract = await database.commercialContract.findFirstOrThrow({ where: { opportunityId: input.opportunityId } });
    expect(contract.status).toBe("ACCEPTED");
    const invoices = await database.invoice.findMany({ where: { contractId: contract.id }, orderBy: { dueAt: "asc" } });
    expect(invoices).toHaveLength(6);
    expect(invoices.every((row) => row.status === "OPEN" && row.paidCents === 0n)).toBe(true);
    expect(invoices[0]!.totalCents).toBe(1000000n);
    expect(invoices.reduce((sum, row) => sum + row.totalCents, 0n)).toBe(2500000n);
    expect((await database.subscription.findFirstOrThrow({ where: { contractId: contract.id } })).currentMrrCents).toBe(300000n);
    const commissions = await database.commission.findMany({ where: { opportunityId: input.opportunityId } });
    expect(commissions).toHaveLength(1);
    expect(commissions[0]!).toMatchObject({ amountCents: 125000n, sellerMemberId: seller.memberId, status: "PENDING", contractId: contract.id });
    expect(await service.execute(admin, command)).toMatchObject({ replayed: true });
    expect(await database.invoice.count({ where: { contractId: contract.id } })).toBe(6);
    await expect(service.execute(admin, { ...command, upfrontCents: "600000", totalCents: "2400000" })).rejects.toMatchObject({ code: "SALE_IDEMPOTENCY_CONFLICT" });
    const other = await fixture();
    await expect(service.execute(admin, { ...other, confirmed: true, idempotencyKey: command.idempotencyKey })).rejects.toMatchObject({ code: "SALE_IDEMPOTENCY_CONFLICT" });
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: other.opportunityId } })).status).toBe("OPEN");
    expect(await database.commercialContract.count({ where: { opportunityId: other.opportunityId } })).toBe(0);
  });
  it("nega usuário sem permissão e workspace alheio", async () => {
    const input = await fixture();
    await expect(service.preview(viewer, input)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.preview({ ...admin, workspaceId: randomUUID() }, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.preview(admin, { ...input, startsAt: "2025-01-01T12:00:00Z", acceptance: { acceptedByName: "Cliente", acceptedByRole: "Diretor", evidenceText: "Aceite histórico documentado." } })).rejects.toThrow("vigência já terminou");
  });
  it("revalida o acesso por origem também ao consultar o histórico de uma proposta", async () => {
    const input = await fixture();
    const closer = await context("closer1@demo.politizai.local");
    const opportunity = await database.opportunity.update({ where: { id: input.opportunityId }, data: { ownerMemberId: closer.memberId }, include: { lead: true } });
    const memberships = await database.teamMember.findMany({ where: { workspaceId, workspaceMemberId: closer.memberId, deletedAt: null } });
    expect(memberships.length).toBeGreaterThan(0);
    const previous = await database.pipelineOriginAccessRule.findMany({ where: { workspaceId, sourceId: opportunity.lead.sourceId } });
    const changed: string[] = [];
    try {
      for (const membership of memberships) {
        const rule = await database.pipelineOriginAccessRule.upsert({ where: { workspaceId_sourceId_teamId: { workspaceId, sourceId: opportunity.lead.sourceId, teamId: membership.teamId } }, create: { workspaceId, sourceId: opportunity.lead.sourceId, teamId: membership.teamId, canTransition: false, createdByActorId: admin.actorId, updatedByActorId: admin.actorId }, update: { canTransition: false } });
        changed.push(rule.id);
      }
      await expect(service.authorize(closer, { ...input, sellerMemberId: closer.memberId })).rejects.toMatchObject({ code: "ORIGIN_TEAM_DENIED" });
    } finally {
      for (const id of changed) {
        const original = previous.find((rule) => rule.id === id);
        if (original) await database.pipelineOriginAccessRule.update({ where: { id }, data: { canTransition: original.canTransition } });
        else await database.pipelineOriginAccessRule.delete({ where: { id } });
      }
    }
  });
  it("falha de emissão reverte venda, contrato e comissão", async () => {
    const input = await fixture();
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } });
    await database.opportunity.update({ where: { id: opportunity.id }, data: { accountId: null } });
    await database.lead.update({ where: { id: opportunity.leadId }, data: { accountId: null } });
    const customerName = `Cliente rollback ${randomUUID()}`;
    const version = await database.contractTemplateVersion.findUniqueOrThrow({ where: { id: input.templateVersionId } });
    const emptyVersion = await database.contractTemplateVersion.create({ data: { workspaceId, templateId: version.templateId, version: 999, titleTemplate: "Contrato teste", introduction: "Contrato sem cláusulas para testar rollback", contentHash: "0".repeat(64), allowedVariables: [], createdByActorId: admin.actorId } });
    await expect(service.execute(admin, { ...input, customer: { mode: "CREATE", name: customerName }, templateVersionId: emptyVersion.id, acceptance: { acceptedByName: "Cliente", acceptedByRole: "Diretor", evidenceText: "Aceite de teste rollback." }, confirmed: true, idempotencyKey: randomUUID() })).rejects.toThrow("cláusulas");
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } })).status).toBe("OPEN");
    expect(await database.commercialContract.count({ where: { opportunityId: input.opportunityId } })).toBe(0);
    expect(await database.commission.count({ where: { opportunityId: input.opportunityId } })).toBe(0);
    expect(await database.account.count({ where: { workspaceId, name: customerName } })).toBe(0);
    expect((await database.lead.findUniqueOrThrow({ where: { id: opportunity.leadId } })).accountId).toBeNull();
  });
});
