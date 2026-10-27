import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { createOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPaymentService } from "@/modules/payments/application/payment-service";
import { createRevenueService } from "@/modules/revenue/application/revenue-service";
import { syncActiveProspectingCommercialStageInTransaction, transitionLeadStageInTransaction } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { ensureActiveProspectingPipeline } from "@/modules/settings/application/production-foundation-service";
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

async function fixture(pipelineId?: string) {
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
  const intake = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now }).intake({ channel: "MANUAL", idempotencyKey: `sale-test:${randomUUID()}`, fullName: "Cliente integrado", phone: `+55119${Math.floor(Math.random() * 90000000 + 10000000)}`, sourceKey: "manual", priorityBandCode: "P1", interestSummary: "Venda integrada de teste", ...(pipelineId ? { pipelineId } : {}), rawPayload: { test: true } }, { workspaceId, actorId: actor.id, actorKey: actor.key, actorType: "SYSTEM" });
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
  return { opportunityId: opportunity.id, expectedRevision: 1, sellerMemberId: admin.memberId, totalCents: "2500000", monthlyCents: "300000", upfrontCents: "700000", receivedCents: "0", paymentMethod: "PIX" as const, paymentCondition: "Entrada e seis parcelas mensais", durationMonths: 6, startsAt: now.toISOString(), templateVersionId: template.id, acceptance: { acceptedByName: "Cliente integrado", acceptedByRole: "Diretor", evidenceText: "Aceite comercial documentado no teste." } };
}

describe("venda integrada atômica", () => {
  for (const profile of ["administrator", "closer"] as const) {
    it(`persiste grupos personalizados, recebíveis exatos e MRR médio (${profile})`, async () => {
      await database.$executeRawUnsafe(readFileSync("scripts/sql/configure-politizai-sales.sql", "utf8"));
      const seller = await context("closer1@demo.politizai.local");
      const actor = profile === "administrator" ? admin : seller;
      const previous = await fixture();
      const original = await database.opportunity.update({ where: { id: previous.opportunityId }, data: { deletedAt: now } });
      await database.lead.update({ where: { id: original.leadId }, data: { ownerMemberId: seller.memberId } });
      const installmentGroups = [{ count: 3, amountCents: "120000" }, { count: 3, amountCents: "250000" }, { count: 3, amountCents: "250000" }];
      const command = { leadId: original.leadId, sellerMemberId: seller.memberId, totalCents: "1960000", upfrontCents: "100000",
        installmentCents: "0", installmentCount: 9, installmentGroups, paymentPlan: "CUSTOM_INSTALLMENTS", paymentCondition: "Entrada de mil reais e nove parcelas em três grupos.", confirmed: true, idempotencyKey: randomUUID() };
      await expect(service.completeLeadSale(viewer, command)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      await expect(service.completeLeadSale(actor, { ...command, totalCents: "1960001" })).rejects.toThrow();
      expect(await database.opportunity.count({ where: { leadId: original.leadId, deletedAt: null } })).toBe(0);
      const result = await service.completeLeadSale(actor, command);
      expect(result).toMatchObject({ receivedCents: "0", outstandingCents: "1960000", replayed: false });
      expect(result.invoiceIds).toHaveLength(9);
      const invoices = await database.invoice.findMany({ where: { contractId: result.contractId }, orderBy: { dueAt: "asc" } });
      expect(invoices.map(invoice => invoice.totalCents)).toEqual([220000n, 120000n, 120000n, 250000n, 250000n, 250000n, 250000n, 250000n, 250000n]);
      expect(invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0n)).toBe(1960000n);
      expect(invoices.every(invoice => invoice.status === "OPEN" && invoice.paidCents === 0n)).toBe(true);
      const lines = await database.invoiceLine.findMany({ where: { invoiceId: { in: result.invoiceIds } } });
      for (const invoice of invoices) expect(lines.filter(line => line.invoiceId === invoice.id).reduce((sum, line) => sum + line.totalCents, 0n)).toBe(invoice.totalCents);
      expect(await database.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId } })).toMatchObject({ status: "WON", tcvCents: 1960000n, mrrCents: 206667n });
      expect(await database.subscription.findFirstOrThrow({ where: { contractId: result.contractId } })).toMatchObject({ recurringPriceCents: 206667n, currentMrrCents: 206667n });
      const contract = await database.contractVersion.findFirstOrThrow({ where: { contractId: result.contractId } });
      expect(contract.paymentTerms).toContain("3 parcela(s) de");
      expect(contract.paymentTerms).not.toContain("9 mensalidade(s) de 206667");
      const audit = await database.auditLog.findFirstOrThrow({ where: { action: "lead.sale.completed", entityId: result.opportunityId } });
      expect(audit.metadata).toMatchObject({ salePayload: { installmentGroups } });
      expect(await service.completeLeadSale(actor, command)).toEqual({ ...result, replayed: true });
      await expect(service.completeLeadSale(actor, { ...command, installmentGroups: [...installmentGroups].reverse() })).rejects.toMatchObject({ code: "SALE_IDEMPOTENCY_CONFLICT" });
      expect(await database.payment.count({ where: { invoiceId: { in: result.invoiceIds } } })).toBe(0);
      expect(await database.commercialContract.count({ where: { opportunityId: result.opportunityId } })).toBe(1);
    });
  }
  for (const profile of ["administrator", "closer"] as const) {
    it(`fecha em um envio com parcelas explícitas, sem baixa ou gravação parcial (${profile})`, async () => {
      await database.$executeRawUnsafe(readFileSync("scripts/sql/configure-politizai-sales.sql", "utf8"));
      const seller = await context("closer1@demo.politizai.local");
      const actor = profile === "administrator" ? admin : seller;
      const previous = await fixture();
      const original = await database.opportunity.update({ where: { id: previous.opportunityId }, data: { deletedAt: now } });
      const customerName = `Cliente venda única ${randomUUID()}`;
      await database.lead.update({ where: { id: original.leadId }, data: { ownerMemberId: seller.memberId, accountId: null, fullName: customerName, organizationName: null } });
      const command = { leadId: original.leadId, sellerMemberId: seller.memberId,
        totalCents: "765432", upfrontCents: "65432", installmentCents: "100000", installmentCount: 7, paymentPlan: "CARD_INSTALLMENTS",
        paymentCondition: "Entrada de R$ 654,32 e sete parcelas de R$ 1.000,00 no cartão.", confirmed: true, idempotencyKey: randomUUID() };
      await expect(service.completeLeadSale(viewer, command)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      await expect(service.completeLeadSale(actor, { ...command, receivedCents: command.totalCents })).rejects.toThrow();
      await expect(service.completeLeadSale(actor, { ...command, installmentCount: 6 })).rejects.toThrow("O valor total deve ser igual à entrada mais a quantidade de parcelas");
      expect(await database.opportunity.count({ where: { leadId: original.leadId, deletedAt: null } })).toBe(0);
      const result = await service.completeLeadSale(actor, command);
      expect(result).toMatchObject({ receivedCents: "0", outstandingCents: "765432", invoiceIds: expect.any(Array), replayed: false });
      expect(result.invoiceIds).toHaveLength(7);
      const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: result.opportunityId }, include: { product: true } });
      expect(opportunity).toMatchObject({ status: "WON", ownerMemberId: seller.memberId, tcvCents: 765432n, mrrCents: 100000n, product: { name: "SISTEMA POLITIZAI" } });
      expect(await database.account.findUniqueOrThrow({ where: { id: result.accountId } })).toMatchObject({ name: customerName });
      const invoices = await database.invoice.findMany({ where: { contractId: result.contractId } });
      expect(invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0n)).toBe(765432n);
      expect(invoices.every((invoice) => invoice.paidCents === 0n)).toBe(true);
      expect(await database.payment.count({ where: { invoiceId: { in: result.invoiceIds } } })).toBe(0);
      expect(await service.completeLeadSale(actor, command)).toEqual({ ...result, replayed: true });
      await expect(service.completeLeadSale(actor, { ...command, paymentCondition: "Outra condição" })).rejects.toMatchObject({ code: "SALE_IDEMPOTENCY_CONFLICT" });
      expect(await database.commercialContract.count({ where: { opportunityId: result.opportunityId } })).toBe(1);
      expect(await database.opportunity.count({ where: { leadId: original.leadId, deletedAt: null } })).toBe(1);
    });
  }

  it("fecha negócio já preparado com os novos valores, sem criar outro negócio", async () => {
    await database.$executeRawUnsafe(readFileSync("scripts/sql/configure-politizai-sales.sql", "utf8"));
    const seller = await context("closer1@demo.politizai.local");
    const previous = await fixture();
    const product = await database.product.findFirstOrThrow({ where: { workspaceId, sku: "SISTEMA-POLITIZAI" } });
    const opportunity = await database.opportunity.update({ where: { id: previous.opportunityId }, data: { productId: product.id, ownerMemberId: seller.memberId } });
    await database.offer.updateMany({ where: { opportunityId: opportunity.id }, data: { createdAt: new Date(now.getTime() - 1000) } });
    const result = await service.completeLeadSale(admin, { leadId: opportunity.leadId, opportunityId: opportunity.id, expectedRevision: opportunity.revision,
      sellerMemberId: seller.memberId, totalCents: "1800000", upfrontCents: "300000", installmentCents: "150000", installmentCount: 10, paymentPlan: "UPFRONT_INSTALLMENTS",
      paymentCondition: "Entrada de R$ 3.000 e dez parcelas de R$ 1.500.", confirmed: true, idempotencyKey: randomUUID() });
    expect(result.opportunityId).toBe(opportunity.id);
    expect(result.invoiceIds).toHaveLength(10);
    expect(await database.opportunity.count({ where: { leadId: opportunity.leadId, deletedAt: null } })).toBe(1);
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).toMatchObject({ status: "WON", tcvCents: 1800000n });
  });

  it("à vista não registra recebimento e desfaz a preparação se o fechamento falhar", async () => {
    await database.$executeRawUnsafe(readFileSync("scripts/sql/configure-politizai-sales.sql", "utf8"));
    const seller = await context("closer1@demo.politizai.local");
    const previous = await fixture();
    const original = await database.opportunity.update({ where: { id: previous.opportunityId }, data: { deletedAt: now } });
    const name = `Cliente repetido ${randomUUID()}`;
    await database.account.update({ where: { id: original.accountId! }, data: { name, normalizedName: name.toLowerCase() } });
    await database.lead.update({ where: { id: original.leadId }, data: { fullName: name, ownerMemberId: seller.memberId, accountId: null, organizationName: null } });
    const command = { leadId: original.leadId, sellerMemberId: seller.memberId, totalCents: "10000", upfrontCents: "10000", installmentCents: "0", installmentCount: 1,
      paymentPlan: "CASH", paymentCondition: "Valor total à vista, conforme combinado.", confirmed: true, idempotencyKey: randomUUID() };
    await expect(service.completeLeadSale(seller, command)).rejects.toMatchObject({ code: "SALE_CUSTOMER_EXISTS" });
    expect(await database.opportunity.count({ where: { leadId: original.leadId, deletedAt: null } })).toBe(0);
    expect(await database.auditLog.count({ where: { action: "sale.preparation.created", metadata: { path: ["idempotencyKey"], equals: command.idempotencyKey } } })).toBe(0);
    await database.lead.update({ where: { id: original.leadId }, data: { accountId: original.accountId } });
    const result = await service.completeLeadSale(seller, command);
    expect(result).toMatchObject({ receivedCents: "0", outstandingCents: "10000", accountId: original.accountId });
    expect(result.invoiceIds).toHaveLength(1);
    expect(await database.subscription.findFirstOrThrow({ where: { contractId: result.contractId } })).toMatchObject({ currentMrrCents: 0n });
  });
  it("disponibiliza SISTEMA POLITIZAI sem tabela fixa e fecha com preço e condições do vendedor", async () => {
    const setup = readFileSync("scripts/sql/configure-politizai-sales.sql", "utf8");
    await database.$executeRawUnsafe(setup);
    await database.$executeRawUnsafe(setup);
    const product = await database.product.findFirstOrThrow({ where: { workspaceId, sku: "SISTEMA-POLITIZAI" } });
    expect(product).toMatchObject({ name: "SISTEMA POLITIZAI", listPriceCents: 0n, active: true, availability: "AVAILABLE", salesGateProfile: "STANDARD" });
    expect(await database.product.count({ where: { workspaceId, sku: product.sku } })).toBe(1);
    expect(await database.auditLog.count({ where: { workspaceId, action: "sales.foundation.configured" } })).toBe(1);
    const template = await database.contractTemplate.findFirstOrThrow({ where: { workspaceId, key: "politizai-commercial-record" } });
    const version = await database.contractTemplateVersion.findFirstOrThrow({ where: { workspaceId, templateId: template.id } });
    const seller = await context("closer1@demo.politizai.local");
    const previous = await fixture();
    const previousOpportunity = await database.opportunity.update({ where: { id: previous.opportunityId }, data: { deletedAt: now } });
    const screen = await createOpportunityService({ database, authorization: createAuthorizationService({ database }), now: () => now }).getLeadScreen(admin, { leadId: previousOpportunity.leadId });
    expect(screen.canPrepareSale).toBe(true);
    expect(screen.productOptions).toContainEqual(expect.objectContaining({ id: product.id, name: "SISTEMA POLITIZAI", listPriceCents: "0" }));
    const prepared = await service.prepareLeadSale(admin, {
      leadId: previousOpportunity.leadId, sellerMemberId: seller.memberId, productId: product.id,
      description: "SISTEMA POLITIZAI nas condições negociadas pelo vendedor",
      paymentPlan: "UPFRONT_INSTALLMENTS", paymentMethod: "PIX",
      totalCents: "123450", upfrontCents: "23450", installmentCents: "20000", installmentCount: 5,
      idempotencyKey: randomUUID(),
    });
    const result = await service.execute(admin, {
      ...previous, opportunityId: prepared.opportunityId, sellerMemberId: seller.memberId, templateVersionId: version.id,
      totalCents: "123450", upfrontCents: "23450", monthlyCents: "20000", durationMonths: 5,
      paymentCondition: "Entrada de R$ 234,50 e cinco parcelas de R$ 200,00, negociadas pelo vendedor.",
      confirmed: true, idempotencyKey: randomUUID(),
    });
    expect(result).toMatchObject({ outstandingCents: "123450", receivedCents: "0", invoiceIds: expect.any(Array) });
    expect(await database.opportunity.findUniqueOrThrow({ where: { id: prepared.opportunityId } })).toMatchObject({ status: "WON", productId: product.id, tcvCents: 123450n });
  });

  it("prepara o fechamento direto do lead com vendedor e valores conciliados, sem registrar a venda antes da confirmação", async () => {
    const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
    const intake = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => now }).intake({
      channel: "MANUAL",
      idempotencyKey: `sale-preparation-test:${randomUUID()}`,
      fullName: "Lead para venda direta",
      phone: `+55119${Math.floor(Math.random() * 90000000 + 10000000)}`,
      sourceKey: "manual",
      priorityBandCode: "P1",
      interestSummary: "Venda direta pelo card",
      rawPayload: { test: true },
    }, { workspaceId, actorId: actor.id, actorKey: actor.key, actorType: "SYSTEM" });
    if (intake.outcome === "REJECTED") throw new Error(intake.code);
    const contact = await database.contact.create({ data: { workspaceId, preferredName: "Contato da venda direta", origin: "LEAD_BACKFILL", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const seller = await context("sdr1@demo.politizai.local");
    await database.lead.update({ where: { id: intake.leadId }, data: { contactId: contact.id, ownerMemberId: seller.memberId } });
    const product = await database.product.findFirstOrThrow({ where: { workspaceId, active: true, salesGateProfile: "STANDARD", deletedAt: null } });
    const leadScreen = await createOpportunityService({ database, authorization: createAuthorizationService({ database }), now: () => now }).getLeadScreen(admin, { leadId: intake.leadId });
    expect(leadScreen).toMatchObject({ canPrepareSale: true, suggestedSaleSellerId: seller.memberId });
    expect(leadScreen.saleSellerOptions).toContainEqual({ id: seller.memberId, name: seller.displayName });
    const idempotencyKey = randomUUID();
    const command = {
      leadId: intake.leadId,
      sellerMemberId: seller.memberId,
      productId: product.id,
      description: "Licença anual e implantação comercial",
      paymentPlan: "UPFRONT_INSTALLMENTS" as const,
      paymentMethod: "PIX" as const,
      totalCents: "1800000",
      upfrontCents: "300000",
      installmentCents: "150000",
      installmentCount: 10,
      idempotencyKey,
    };

    const prepared = await service.prepareLeadSale(admin, command);
    expect(prepared).toMatchObject({ opportunityId: expect.any(String), replayed: false });
    expect(await service.prepareLeadSale(admin, command)).toEqual({ opportunityId: prepared.opportunityId, replayed: true });
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: prepared.opportunityId }, include: { offers: true, currentStage: true } });
    expect(opportunity).toMatchObject({ leadId: intake.leadId, ownerMemberId: seller.memberId, status: "OPEN", currentStage: { opportunityStageCode: "NEGOTIATION" } });
    expect(opportunity.tcvCents).toBe(1800000n);
    expect(opportunity.mrrCents).toBe(150000n);
    expect(opportunity.offers).toHaveLength(1);
    expect(opportunity.offers[0]?.totalCents).toBe(1800000n);
    expect(await database.commercialContract.count({ where: { opportunityId: prepared.opportunityId } })).toBe(0);
    expect(await database.commercialMetricFact.count({ where: { opportunityId: prepared.opportunityId, eventType: "SALE_WON" } })).toBe(0);
    await expect(service.prepareLeadSale(admin, { ...command, totalCents: "1900000", upfrontCents: "400000" })).rejects.toMatchObject({ code: "SALE_PREPARATION_IDEMPOTENCY_CONFLICT" });
    await expect(service.prepareLeadSale(viewer, { ...command, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("Closer fecha somente a própria venda e cria o cliente, sem acesso geral a finanças ou recebimentos", async () => {
    const seller = await context("closer1@demo.politizai.local");
    const input = await fixture();
    const setup = readFileSync("scripts/sql/configure-politizai-closer-sales.sql", "utf8");
    await database.$executeRawUnsafe(setup);
    await database.$executeRawUnsafe(setup);
    const opportunity = await database.opportunity.update({ where: { id: input.opportunityId }, data: { ownerMemberId: seller.memberId, accountId: null } });
    await database.lead.update({ where: { id: opportunity.leadId }, data: { ownerMemberId: seller.memberId, accountId: null } });
    const payload = { ...input, sellerMemberId: seller.memberId, customer: { mode: "CREATE", name: `Cliente Closer ${randomUUID()}` } };
    const command = { ...payload, confirmed: true, idempotencyKey: randomUUID() };
    const options = await service.getOptions(seller, opportunity.id);
    expect(options).toMatchObject({ ownSalesOnly: true, canRecordReceipt: false, financialAccounts: [] });
    expect(options.templateVersions.length).toBeGreaterThan(0);
    await expect(service.preview(seller, payload)).resolves.toMatchObject({ customer: { mode: "CREATE" } });
    await expect(service.execute(seller, { ...command, sellerMemberId: admin.memberId })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.execute(seller, { ...command, receivedCents: "100", financialAccountId: randomUUID(), receivedAt: now.toISOString(), paymentReference: "Não permitido" })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.execute(seller, { ...command, onboardingOwnerMemberId: admin.memberId })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const other = await fixture();
    await expect(service.getOptions(seller, other.opportunityId)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.execute(seller, { ...command, opportunityId: other.opportunityId })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.execute({ ...seller, workspaceId: randomUUID() }, command)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await database.commercialContract.count({ where: { opportunityId: opportunity.id } })).toBe(0);
    const completed = await service.execute(seller, command);
    expect(completed).toMatchObject({ customerCreated: true, receivedCents: "0", outstandingCents: input.totalCents });
    expect(await service.execute(seller, command)).toMatchObject({ replayed: true });
    const authorization = createAuthorizationService({ database });
    for (const key of ["payments.manage", "revenue.manage", "accounts.write", "finance.manage"] as const) {
      expect(await authorization.authorize(seller, key, { workspaceId, resourceType: "Opportunity", ownerMemberId: seller.memberId })).toMatchObject({ allowed: false });
    }
    expect(await database.payment.count({ where: { workspaceId, confirmedByActorId: seller.actorId } })).toBe(0);
    if (!("subscriptionId" in completed) || !completed.subscriptionId) throw new Error("Assinatura não criada.");
    await expect(createRevenueService(database, authorization).action(seller, completed.subscriptionId, {
      action: "SCHEDULE_CANCELLATION", effectiveAt: now.toISOString(), reason: "Tentativa fora do fechamento", idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(createPaymentService({ database, now: () => now }).createInvoice(seller, {
      subscriptionId: completed.subscriptionId, billingPeriodStart: now.toISOString(), billingPeriodEnd: new Date("2026-10-30T15:00:00Z").toISOString(),
      dueAt: now.toISOString(), description: "Tentativa fora do fechamento", upfrontCents: "0", idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const grant = await database.rolePermission.findFirstOrThrow({ where: { workspaceId, roleId: seller.roleId, permission: { key: "sales.complete" } } });
    await database.rolePermission.delete({ where: { id: grant.id } });
    try {
      await expect(service.execute(seller, command)).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    } finally {
      await database.rolePermission.create({ data: grant });
    }
  });

  it("move o lead da Prospecção Ativa para Cliente e baixa o valor recebido sem perder o saldo", async () => {
    await ensureActiveProspectingPipeline(database, workspaceId, admin.actorId);
    const pipeline = await database.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Prospecção Ativa", entityType: "LEAD", deletedAt: null } });
    const input = await fixture(pipeline.id);
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: input.opportunityId } });
    await database.$transaction((tx) => syncActiveProspectingCommercialStageInTransaction(tx, admin, {
      leadId: opportunity.leadId,
      targetCode: "PROPOSAL",
      reason: "Proposta confirmada no teste integrado.",
      commercialEvent: "PROPOSAL_REGISTERED",
    }, new Date("2026-09-30T14:00:00Z")));
    expect((await database.lead.findUniqueOrThrow({ where: { id: opportunity.leadId }, include: { currentStage: true } })).currentStage.leadStageCode).toBe("PROPOSAL");
    const clientStage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, pipelineId: pipeline.id, leadStageCode: "CLIENT", deletedAt: null } });
    await expect(database.$transaction((tx) => transitionLeadStageInTransaction(tx, admin, {
      leadId: opportunity.leadId,
      targetStageId: clientStage.id,
      reason: "Tentativa manual sem venda.",
      origin: "PIPELINE_BOARD",
      managerCorrection: false,
      confirmed: true,
    }, new Date("2026-09-30T14:30:00Z")))).rejects.toMatchObject({ code: "INTEGRATED_SALE_REQUIRED" });
    const financialAccount = await database.financialAccount.create({ data: { workspaceId, name: `Conta venda ${randomUUID()}`, type: "BANK", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const result = await service.execute(admin, {
      ...input,
      receivedCents: "1200000",
      financialAccountId: financialAccount.id,
      receivedAt: now.toISOString(),
      paymentReference: `PIX venda ${randomUUID()}`,
      confirmed: true,
      idempotencyKey: randomUUID(),
    });
    if (!("paymentIds" in result) || !("invoiceIds" in result)) throw new Error("Resultado de fechamento incompleto.");
    expect(result).toMatchObject({ paymentReceived: true, receivedCents: "1200000", outstandingCents: "1300000" });
    const lead = await database.lead.findUniqueOrThrow({ where: { id: opportunity.leadId }, include: { currentStage: true } });
    expect(lead).toMatchObject({ status: "CONVERTED", currentStage: { leadStageCode: "CLIENT", name: "Cliente" } });
    const payments = await database.payment.aggregate({ where: { workspaceId, id: { in: result.paymentIds } }, _sum: { amountCents: true } });
    expect(payments._sum.amountCents).toBe(1200000n);
    const invoices = await database.invoice.findMany({ where: { workspaceId, id: { in: result.invoiceIds } } });
    expect(invoices.reduce((sum, invoice) => sum + invoice.totalCents - invoice.paidCents, 0n)).toBe(1300000n);
    const saleFact = await database.commercialMetricFact.findMany({ where: { workspaceId, opportunityId: opportunity.id, eventType: "SALE_WON" } });
    expect(saleFact).toHaveLength(1);
    expect(saleFact[0]?.valueCents).toBe(2500000n);
  });

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
    expect(result).toMatchObject({ accountId: original.accountId, customerCreated: false, invoiceIds: expect.arrayContaining([expect.any(String)]), subscriptionId: expect.any(String) });

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
