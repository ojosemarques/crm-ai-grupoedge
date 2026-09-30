import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { loadAcquisitionFunnel } from "@/modules/marketing/application/acquisition-funnel-service";
import { createSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { createPaymentService } from "@/modules/payments/application/payment-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required.");
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 8 }) });
const start = new Date("2055-09-01T00:00:00Z");
const end = new Date("2055-10-01T00:00:00Z");
const closeAt = new Date("2055-09-30T12:00:00Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let financialAccountId: string;

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" })).workspaceId;
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: "admin@demo.politizai.local" } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  admin = { workspaceId, workspaceSlug: "politizai", sessionId: randomUUID(), userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
  financialAccountId = (await database.financialAccount.create({ data: { workspaceId, name: "Conta real de teste aquisição", type: "BANK", createdByActorId: actor.id, updatedByActorId: actor.id } })).id;
});
afterAll(() => database.$disconnect());

async function sale(name: string, createdAt: Date) {
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
  const intake = await createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => createdAt }).intake({ channel: "MANUAL", idempotencyKey: `acquisition:${randomUUID()}`, fullName: name, phone: `+55119${Math.floor(Math.random() * 90000000 + 10000000)}`, sourceKey: "manual", priorityBandCode: "P1", interestSummary: "Teste de atribuição de receita", rawPayload: { test: true } }, { workspaceId, actorId: actor.id, actorKey: actor.key, actorType: "SYSTEM" });
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  const account = await database.account.create({ data: { workspaceId, name, normalizedName: name.toLowerCase(), origin: "SEED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const contact = await database.contact.create({ data: { workspaceId, preferredName: name, origin: "LEAD_BACKFILL", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  await database.lead.update({ where: { id: intake.leadId }, data: { accountId: account.id, contactId: contact.id, createdAt } });
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "NEGOTIATION", deletedAt: null } });
  const product = await database.product.findFirstOrThrow({ where: { workspaceId, active: true, salesGateProfile: "STANDARD", deletedAt: null } });
  const opportunity = await database.opportunity.create({ data: { workspaceId, leadId: intake.leadId, accountId: account.id, pipelineId: stage.pipelineId, currentStageId: stage.id, ownerMemberId: admin.memberId, productId: product.id, name, amountCents: 100000n, mrrCents: 100000n, tcvCents: 100000n, probabilityBps: 8000, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  await database.stageHistory.create({ data: { workspaceId, pipelineId: stage.pipelineId, stageId: stage.id, opportunityId: opportunity.id, enteredAt: createdAt, enteredByActorId: admin.actorId } });
  await database.offer.create({ data: { workspaceId, opportunityId: opportunity.id, productId: product.id, name: "Proposta", quantity: 1, unitPriceCents: 100000n, totalCents: 100000n, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const template = await database.contractTemplateVersion.findFirstOrThrow({ where: { workspaceId } });
  await createSaleCompletionService({ database, now: () => closeAt }).execute(admin, { opportunityId: opportunity.id, expectedRevision: 1, sellerMemberId: admin.memberId, totalCents: "100000", monthlyCents: "100000", upfrontCents: "0", durationMonths: 1, startsAt: start.toISOString(), templateVersionId: template.id, acceptance: { acceptedByName: name, acceptedByRole: "Diretor", evidenceText: "Aceite sintético exclusivamente para integração local." }, confirmed: true, idempotencyKey: randomUUID() });
  const contract = await database.commercialContract.findFirstOrThrow({ where: { opportunityId: opportunity.id } });
  const invoice = await database.invoice.findFirstOrThrow({ where: { contractId: contract.id } });
  return { leadId: intake.leadId, opportunityId: opportunity.id, invoiceId: invoice.id };
}

async function receipt(invoiceId: string, amountCents: string, occurredAt: string, reversedAt?: string) {
  const invoice = await database.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const created = await createPaymentService({ database, now: () => new Date("2055-10-10T12:00:00Z") }).recordReceipt(admin, { invoiceId, financialAccountId, expectedRevision: invoice.revision, amountCents, receivedAt: occurredAt, method: "PIX", reference: `receipt-${randomUUID()}`, confirmed: true, idempotencyKey: randomUUID() });
  if (reversedAt) await database.payment.update({ where: { id: created.payment.id }, data: { status: "REVERSED", reversedAt: new Date(reversedAt), reversalReason: "Reversão sintética para reconstrução temporal." } });
  return created.payment;
}

describe("recebimento real atribuído à aquisição", () => {
  it("conecta cobrança à origem uma vez, desconta estornos por data e preserva o bucket desconhecido", async () => {
    const attributed = await sale("Cliente de campanha", start);
    const unknown = await sale("Cliente sem campanha", start);
    const previousCohort = await sale("Cliente da coorte anterior", new Date("2055-08-01T00:00:00Z"));
    const campaign = await database.acquisitionCampaign.create({ data: { workspaceId, name: "Campanha origem", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const creative = await database.acquisitionCreative.create({ data: { workspaceId, campaignId: campaign.id, name: "Criativo origem", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    await database.lead.update({ where: { id: attributed.leadId }, data: { campaignId: campaign.id, creativeId: creative.id } });
    for (const [index, label] of ["primeira", "posterior"].entries()) await database.marketingTouchpoint.create({ data: { workspaceId, leadId: attributed.leadId, kind: "AD_CLICK", evidenceClass: "DIRECT", occurredAt: new Date(index ? "2055-09-02T00:00:00Z" : "2055-08-31T00:00:00Z"), utmCampaign: label, utmContent: `${label}-criativo`, attributionEligible: true, privacyDecision: "ALLOW", idempotencyKey: randomUUID(), correlationId: randomUUID(), createdByActorId: admin.actorId } });
    await receipt(attributed.invoiceId, "10001", "2055-09-10T12:00:00Z", "2055-09-20T12:00:00Z");
    await receipt(attributed.invoiceId, "3000", "2055-08-31T12:00:00Z", "2055-09-02T12:00:00Z");
    await receipt(attributed.invoiceId, "5000", "2055-09-25T12:00:00Z", end.toISOString());
    await receipt(attributed.invoiceId, "4000", end.toISOString());
    await receipt(unknown.invoiceId, "2000", "2055-09-10T12:00:00Z");
    await receipt(previousCohort.invoiceId, "9000", "2055-09-10T12:00:00Z");
    await database.payment.create({ data: { workspaceId, invoiceId: attributed.invoiceId, amountCents: 7000n, providerKey: "LOCAL_PAYMENT_SANDBOX", idempotencyKey: randomUUID(), correlationId: randomUUID(), occurredAt: new Date("2055-09-15T12:00:00Z"), confirmedByActorId: admin.actorId } });

    const result = await loadAcquisitionFunnel(database, workspaceId, start, end);
    expect(result).toMatchObject({ cohortSize: 2, truncated: false, receiptCurrency: "BRL", excludedReceiptCount: 0 });
    expect(result.byDimension.campaign.find((row) => row.key === campaign.id)).toMatchObject({ revenueCents: 100000, receivedCents: "15001", reversedCents: "13001", netReceivedCents: "2000", receiptCount: 2, reversalCount: 2 });
    expect(result.byDimension.campaign.find((row) => row.key === "unattributed")).toMatchObject({ label: "Não identificado", receivedCents: "2000", netReceivedCents: "2000" });
    expect(result.byDimension.creative.find((row) => row.key === creative.id)?.netReceivedCents).toBe("2000");
    expect(result.byDimension.utmCampaign.find((row) => row.key === "utmCampaign:primeira")?.netReceivedCents).toBe("2000");
    expect(result.byDimension.utmCampaign.find((row) => row.key === "utmCampaign:posterior")).toBeUndefined();
    expect(result.byDimension.utmContent.find((row) => row.key === "utmContent:primeira-criativo")?.netReceivedCents).toBe("2000");
    for (const rows of Object.values(result.byDimension)) expect(rows.reduce((sum, row) => sum + BigInt(row.netReceivedCents), 0n)).toBe(4000n);
    expect((await database.payment.findFirstOrThrow({ where: { invoiceId: unknown.invoiceId } })).currency).toBe("BRL");
    await expect(loadAcquisitionFunnel(database, randomUUID(), start, end)).resolves.toMatchObject({ cohortSize: 0, byDimension: { campaign: [] } });
  });
});
