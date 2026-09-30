import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
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
  it("falha de emissão reverte venda, contrato e comissão", async () => {
    const input = await fixture();
    const version = await database.contractTemplateVersion.findUniqueOrThrow({ where: { id: input.templateVersionId } });
    const emptyVersion = await database.contractTemplateVersion.create({ data: { workspaceId, templateId: version.templateId, version: 999, titleTemplate: "Contrato teste", introduction: "Contrato sem cláusulas para testar rollback", contentHash: "0".repeat(64), allowedVariables: [], createdByActorId: admin.actorId } });
    await expect(service.execute(admin, { ...input, templateVersionId: emptyVersion.id, acceptance: { acceptedByName: "Cliente", acceptedByRole: "Diretor", evidenceText: "Aceite de teste rollback." }, confirmed: true, idempotencyKey: randomUUID() })).rejects.toThrow("cláusulas");
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } })).status).toBe("OPEN");
    expect(await database.commercialContract.count({ where: { opportunityId: input.opportunityId } })).toBe(0);
    expect(await database.commission.count({ where: { opportunityId: input.opportunityId } })).toBe(0);
  });
});
