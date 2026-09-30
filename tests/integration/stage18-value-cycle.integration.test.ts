import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createPostSaleOperatingReviewService } from "@/modules/customer-success/application/post-sale-operating-review-service";
import { createCustomerSuccessService } from "@/modules/customer-success/application/customer-success-service";
import { createFarmerService } from "@/modules/farmer/application/farmer-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for Stage 18 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) {
  throw new Error("Stage 18 requires an ephemeral politizai_test_* schema.");
}

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2058-06-15T15:00:00.000Z");
const onboarding = createOnboardingService({ database, now: () => clock });
const customerSuccess = createCustomerSuccessService({ database, authorization, now: () => clock });
const operatingReview = createPostSaleOperatingReviewService({ database, authorization, now: () => clock });
const farmer = createFarmerService({ database, authorization, now: () => clock });

let workspaceId: string;
let admin: AuthenticatedContext;
let owner: AuthenticatedContext;
let accountId: string;
let opportunityId: string;
let contractId: string;
let contractVersionId: string;
let subscriptionId: string;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email } },
    include: { role: true, user: true },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: member.userId, type: "HUMAN" },
  });
  return {
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: "politizai",
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, owner] = await Promise.all([
    context("admin@demo.politizai.local"),
    context("closer1@demo.politizai.local"),
  ]);
  const systemActor = await database.actor.findFirstOrThrow({
    where: { workspaceId, type: "SYSTEM" },
    orderBy: { id: "asc" },
  });
  const system = {
    workspaceId,
    actorId: systemActor.id,
    actorKey: systemActor.key,
    actorType: "SYSTEM",
  } satisfies ServiceActorContext;
  const intake = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({
    channel: "MANUAL",
    idempotencyKey: "stage18:fixture:lead",
    fullName: "Responsável pela entrega Stage 18",
    phone: "+5511998765800",
    jobTitle: "Patrocinador do contrato",
    interestSummary: "Venda combinada Politizai OS e serviço operado.",
    sourceKey: "manual",
    priorityBandCode: "P1",
    rawPayload: { test: "stage18", simulated: true },
  }, system);
  if (intake.outcome === "REJECTED") throw new Error(intake.code);

  const account = await database.account.create({
    data: {
      workspaceId,
      name: "Conta ciclo de valor Stage 18",
      normalizedName: "conta ciclo de valor stage 18",
      origin: "SEED",
      quality: "CONFIRMED",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  accountId = account.id;
  const contact = await database.contact.create({
    data: {
      workspaceId,
      preferredName: "Responsável pela entrega Stage 18",
      jobTitle: "Patrocinador do contrato",
      origin: "LEAD_BACKFILL",
      quality: "CONFIRMED",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  await database.lead.update({
    where: { id: intake.leadId },
    data: { accountId, contactId: contact.id, updatedByActorId: systemActor.id },
  });

  const [pipeline, wonStage] = await Promise.all([
    database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true } }),
    database.pipelineStage.findFirstOrThrow({ where: { workspaceId, opportunityStageCode: "WON" } }),
  ]);
  const [license, service] = await Promise.all([
    database.product.create({
      data: {
        workspaceId,
        sku: "STAGE18-OS",
        name: "Politizai OS Stage 18",
        kind: "LICENSE",
        revenueCategory: "SOFTWARE",
        listPriceCents: 240_000n,
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    }),
    database.product.create({
      data: {
        workspaceId,
        sku: "STAGE18-SERVICE",
        name: "Serviço operado Stage 18",
        kind: "RECURRING_SERVICE",
        revenueCategory: "RECURRING_SERVICE",
        listPriceCents: 120_000n,
        createdByActorId: systemActor.id,
        updatedByActorId: systemActor.id,
      },
    }),
  ]);
  const opportunity = await database.opportunity.create({
    data: {
      workspaceId,
      leadId: intake.leadId,
      accountId,
      pipelineId: pipeline.id,
      currentStageId: wonStage.id,
      ownerMemberId: owner.memberId,
      productId: license.id,
      name: "Venda OS + serviço Stage 18",
      interestDescription: "Diagnóstico confirma necessidade de licença e operação assistida.",
      commercialNotes: "Risco: disponibilidade dos usuários para o kickoff.",
      status: "WON",
      amountCents: 360_000n,
      mrrCents: 30_000n,
      tcvCents: 360_000n,
      probabilityBps: 10_000,
      closedAt: clock,
      outcomeReasonCode: "CONTRACT_ACCEPTED",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  opportunityId = opportunity.id;
  const offer = await database.offer.create({
    data: {
      workspaceId,
      opportunityId,
      productId: license.id,
      name: "OS + serviço operado",
      quantity: 1,
      unitPriceCents: 360_000n,
      totalCents: 360_000n,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  await database.offerLine.createMany({
    data: [
      {
        workspaceId, offerId: offer.id, productId: license.id, position: 1,
        productVersionSnapshot: license.version, productSkuSnapshot: license.sku,
        productNameSnapshot: license.name, productKindSnapshot: license.kind,
        revenueCategorySnapshot: license.revenueCategory, approvedConditionsSnapshot: license.approvedConditions,
        quantity: 1, unitPriceCents: 240_000n, totalCents: 240_000n,
      },
      {
        workspaceId, offerId: offer.id, productId: service.id, position: 2,
        productVersionSnapshot: service.version, productSkuSnapshot: service.sku,
        productNameSnapshot: service.name, productKindSnapshot: service.kind,
        revenueCategorySnapshot: service.revenueCategory, approvedConditionsSnapshot: service.approvedConditions,
        quantity: 1, unitPriceCents: 120_000n, totalCents: 120_000n,
      },
    ],
  });
  const contract = await database.commercialContract.create({
    data: {
      workspaceId,
      contractNumber: "CTR-STAGE18-001",
      opportunityId,
      accountId,
      primaryContactId: contact.id,
      ownerMemberId: owner.memberId,
      status: "ACCEPTED",
      acceptedAt: clock,
      effectiveStartsAt: clock,
      effectiveEndsAt: new Date("2059-06-15T15:00:00.000Z"),
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  contractId = contract.id;
  const version = await database.contractVersion.create({
    data: {
      workspaceId,
      contractId,
      versionNumber: 1,
      state: "ISSUED",
      sourceOfferId: offer.id,
      templateNameSnapshot: "Contrato combinado Stage 18",
      templateVersionSnapshot: 1,
      opportunityNameSnapshot: opportunity.name,
      accountNameSnapshot: account.name,
      contactNameSnapshot: contact.preferredName,
      contactRoleSnapshot: contact.jobTitle,
      subtotalCents: 360_000n,
      discountCents: 0n,
      totalCents: 360_000n,
      mrrCents: 30_000n,
      tcvCents: 360_000n,
      billingFrequency: "MONTHLY",
      durationMonths: 12,
      proposedStartsAt: clock,
      proposedEndsAt: new Date("2059-06-15T15:00:00.000Z"),
      renewalExpected: true,
      paymentTerms: "Pagamento mensal conforme contrato aceito.",
      commercialNotes: "Valores conciliados para o aceite Stage 18.",
      renderedHtml: "<article>Contrato combinado Stage 18.</article>",
      contentHash: createHash("sha256").update("stage18:contract-version:001").digest("hex"),
      issuedAt: clock,
      issuedByActorId: admin.actorId,
      createdByActorId: admin.actorId,
    },
  });
  contractVersionId = version.id;
  await database.contractLineSnapshot.createMany({
    data: [
      {
        workspaceId, contractVersionId, position: 1, sourceOfferId: offer.id, productId: license.id,
        productSkuSnapshot: license.sku, productNameSnapshot: license.name, productVersionSnapshot: license.version,
        productKindSnapshot: "LICENSE", revenueCategorySnapshot: "SOFTWARE",
        approvedConditionsSnapshot: license.approvedConditions, offerNameSnapshot: offer.name,
        quantity: 1, unitPriceCents: 240_000n, discountCents: 0n, totalCents: 240_000n,
      },
      {
        workspaceId, contractVersionId, position: 2, sourceOfferId: offer.id, productId: service.id,
        productSkuSnapshot: service.sku, productNameSnapshot: service.name, productVersionSnapshot: service.version,
        productKindSnapshot: "RECURRING_SERVICE", revenueCategorySnapshot: "RECURRING_SERVICE",
        approvedConditionsSnapshot: service.approvedConditions, offerNameSnapshot: offer.name,
        quantity: 1, unitPriceCents: 120_000n, discountCents: 0n, totalCents: 120_000n,
      },
    ],
  });
  await database.commercialContract.update({ where: { id: contractId }, data: { currentVersionId: contractVersionId } });
});

afterAll(async () => database.$disconnect());

describe("Etapa 18 — ciclo de valor pós-venda", () => {
  it("transforma OS + serviço em dois planos conciliados e aceita a transferência explicitamente", async () => {
    const handoff = await onboarding.createHandoff(admin, {
      opportunityId,
      ownerMemberId: owner.memberId,
      reason: "Transferência explícita da venda combinada para a equipe de entrega.",
      idempotencyKey: "stage18:handoff:create:001",
    });
    const transfer = await database.handoffTransferVersion.findFirstOrThrow({
      where: { workspaceId, handoffId: handoff.id },
    });
    expect(transfer).toMatchObject({ version: 1, contractVersionId, contractTotalCents: 360_000n });
    expect(transfer.diagnosis).toMatchObject({ source: "opportunity" });
    expect(transfer.approvals).toMatchObject({ contractStatus: "ACCEPTED" });
    expect(transfer.risks).toEqual(expect.any(Array));

    const draftPlans = await database.deliveryPlan.findMany({
      where: { workspaceId, handoffId: handoff.id },
      include: { checklist: { orderBy: { position: "asc" } } },
      orderBy: { type: "asc" },
    });
    expect(draftPlans.map((plan) => plan.type).sort()).toEqual(["LICENSE", "MANAGED_SERVICE"]);
    expect(draftPlans.reduce((sum, plan) => sum + plan.contractedValueCents, 0n)).toBe(360_000n);
    expect(draftPlans.find((plan) => plan.type === "LICENSE")?.checklist).toHaveLength(3);
    expect(draftPlans.find((plan) => plan.type === "MANAGED_SERVICE")?.checklist).toHaveLength(4);
    expect(draftPlans.every((plan) => plan.status === "DRAFT")).toBe(true);

    await onboarding.actHandoff(admin, handoff.id, {
      action: "MARK_READY", expectedRevision: 1,
      reason: "Escopo e valores revisados antes do envio.", idempotencyKey: "stage18:handoff:ready:001",
    });
    await onboarding.actHandoff(admin, handoff.id, {
      action: "SEND", expectedRevision: 2,
      reason: "Passagem enviada à equipe responsável.", idempotencyKey: "stage18:handoff:send:001",
    });
    const accepted = await onboarding.actHandoff(admin, handoff.id, {
      action: "ACCEPT", expectedRevision: 3,
      reason: "Equipe de entrega aceitou escopo, riscos, usuários e valores.", idempotencyKey: "stage18:handoff:accept:001",
    });
    expect(accepted.onboarding).toMatchObject({ accountId, contractId, status: "PENDING" });
    const acceptedPlans = await database.deliveryPlan.findMany({ where: { workspaceId, handoffId: handoff.id } });
    expect(acceptedPlans.every((plan) => plan.status === "ACCEPTED" && plan.acceptedByActorId === admin.actorId)).toBe(true);
    expect(acceptedPlans.every((plan) => plan.acceptanceReason?.includes("aceitou"))).toBe(true);
  });

  it("agrega a operação, inicia renovação sem comunicação e registra revisão de valor", async () => {
    const assignment = await customerSuccess.assignPortfolio(admin, {
      accountId,
      ownerMemberId: owner.memberId,
      queueId: null,
      teamId: null,
      priority: 1,
      nextActionDescription: "Confirmar adoção e resultado esperado",
      nextActionAt: new Date("2058-06-16T15:00:00.000Z"),
      reason: "Conta transferida para acompanhamento após aceite da entrega.",
      idempotencyKey: "stage18:portfolio:001",
    });
    await customerSuccess.createPlan(admin, {
      accountId,
      title: "Plano de valor OS + serviço",
      objective: "Comprovar adoção da licença e resultado do serviço operado.",
      targetAt: new Date("2058-08-15T15:00:00.000Z"),
      nextActionDescription: "Validar linha de base com o cliente",
      nextActionAt: new Date("2058-06-17T15:00:00.000Z"),
      reason: "Plano criado a partir da promessa comercial aceita.",
      idempotencyKey: "stage18:success-plan:001",
    });
    const subscription = await database.subscription.create({
      data: {
        workspaceId,
        subscriptionNumber: "SUB-STAGE18-001",
        accountId,
        contractId,
        currentContractVersionId: contractVersionId,
        ownerMemberId: owner.memberId,
        accountNameSnapshot: "Conta ciclo de valor Stage 18",
        contractNumberSnapshot: "CTR-STAGE18-001",
        productNameSnapshot: "Politizai OS + serviço operado",
        quantity: 1,
        recurringPriceCents: 30_000n,
        billingInterval: "MONTHLY",
        currentMrrCents: 30_000n,
        status: "ACTIVE",
        startsAt: clock,
        endsAt: new Date("2058-08-15T15:00:00.000Z"),
        createdByActorId: admin.actorId,
        updatedByActorId: admin.actorId,
      },
    });
    subscriptionId = subscription.id;

    const jobsBefore = await database.job.count({ where: { workspaceId } });
    const initialized = await farmer.initializeDueRenewals(admin, {
      windowDays: 90,
      nextActionLeadDays: 1,
      idempotencyKey: "stage18:renewals:initialize:001",
    });
    expect(initialized.created).toHaveLength(1);
    expect(initialized.externalActions).toBe(0);
    expect(() => JSON.stringify(initialized)).not.toThrow();
    expect(await database.job.count({ where: { workspaceId } })).toBe(jobsBefore);
    const renewal = await database.renewal.findFirstOrThrow({ where: { workspaceId, subscriptionId } });
    expect(renewal).toMatchObject({ status: "IN_REVIEW", portfolioAssignmentId: assignment.id });
    expect(await database.renewalEvent.count({ where: { workspaceId, renewalId: renewal.id, type: "CREATED" } })).toBe(1);

    const decision = await farmer.confirmRevenueDecision(admin, {
      subscriptionId,
      renewalId: renewal.id,
      type: "CONTRACTION",
      newMrrCents: "25000",
      effectiveAt: clock,
      reasonCode: "VALUE_REVIEW",
      comment: "Revisão de valor aprovada pelo responsável comercial.",
      evidence: "Escopo recorrente revisado e confirmado pelo cliente.",
      logoChurn: false,
      revenueChurn: true,
      idempotencyKey: "stage18:value-review:001",
    });
    expect(decision).toMatchObject({ previousMrrCents: 30_000n, newMrrCents: 25_000n, deltaMrrCents: -5_000n });
    expect(await database.revenueMovement.count({ where: { workspaceId, subscriptionId, type: "CONTRACTION" } })).toBe(1);

    const review = await operatingReview.accountReview(admin, accountId);
    expect(review).toMatchObject({
      account: { id: accountId },
      renewal: { id: renewal.id, status: "IN_REVIEW" },
      sourceCounts: { subscriptions: 1 },
    });
    expect(review.deliveryPlans.successPlans).toHaveLength(1);
    expect(review.deliveryPlans.onboardingCases).toHaveLength(1);
    expect(review.result.revenueDecisions).toContainEqual(expect.objectContaining({ type: "CONTRACTION", reasonCode: "VALUE_REVIEW" }));
  });
});
