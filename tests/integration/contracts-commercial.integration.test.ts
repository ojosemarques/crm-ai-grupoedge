import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createContractBackfillService } from "@/modules/contracts/application/contract-backfill-service";
import { createContractService } from "@/modules/contracts/application/contract-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createRevenueService } from "@/modules/revenue/application/revenue-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-48 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-48 requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2048-06-15T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

function contracts() { return createContractService({ database, authorization, now: () => clock }); }

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  const fixtureActor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" }, orderBy: { id: "asc" } });
  const system = { workspaceId, actorId: fixtureActor.id, actorKey: fixtureActor.key, actorType: "SYSTEM" } satisfies ServiceActorContext;
  const intake = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({
    channel: "MANUAL",
    idempotencyKey: "crm48:fixture:lead",
    fullName: "Contato contratual fictício",
    phone: "+5511998765432",
    jobTitle: "Responsável pela contratação",
    interestSummary: "Contratação local para validar snapshots comerciais.",
    sourceKey: "manual",
    priorityBandCode: "P1",
    rawPayload: { test: "crm48", simulated: true },
  }, system);
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  const fixtureAccount = await database.account.create({ data: { workspaceId, name: "Conta Contratual Fictícia", normalizedName: "conta contratual ficticia", origin: "SEED", quality: "CONFIRMED", createdByActorId: fixtureActor.id, updatedByActorId: fixtureActor.id } });
  const fixtureContact = await database.contact.create({ data: { workspaceId, preferredName: "Contato contratual fictício", jobTitle: "Responsável pela contratação", origin: "LEAD_BACKFILL", quality: "CONFIRMED", createdByActorId: fixtureActor.id, updatedByActorId: fixtureActor.id } });
  await database.lead.update({
    where: { id: intake.leadId },
    data: { accountId: fixtureAccount.id, contactId: fixtureContact.id, updatedByActorId: fixtureActor.id },
  });
  [admin, manager, viewer] = await Promise.all([
    context("admin@demo.politizai.local"),
    context("gestor@demo.politizai.local"),
    context("viewer@demo.politizai.local"),
  ]);
  const [pipeline, owner, product] = await Promise.all([
    database.pipeline.findFirstOrThrow({ where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true }, include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" }, take: 1 } } }),
    database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: "closer1@demo.politizai.local" } } }),
    database.product.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } }),
  ]);
  const opportunity = await database.opportunity.create({ data: { workspaceId, leadId: intake.leadId, accountId: fixtureAccount.id, pipelineId: pipeline.id, currentStageId: pipeline.stages[0]!.id, ownerMemberId: owner.id, productId: product.id, name: "Oportunidade contratual fictícia", status: "OPEN", amountCents: 480000n, mrrCents: 40000n, tcvCents: 480000n, probabilityBps: 5500, createdByActorId: fixtureActor.id, updatedByActorId: fixtureActor.id } });
  const parts = await Promise.all([
    database.product.create({ data: { workspaceId, sku: "CRM48-IMPL", name: "Implantação contratual", kind: "IMPLEMENTATION", revenueCategory: "IMPLEMENTATION", listPriceCents: 80000n, createdByActorId: fixtureActor.id, updatedByActorId: fixtureActor.id } }),
    database.product.create({ data: { workspaceId, sku: "CRM48-SVC", name: "Serviço contratual", kind: "RECURRING_SERVICE", revenueCategory: "RECURRING_SERVICE", listPriceCents: 100000n, createdByActorId: fixtureActor.id, updatedByActorId: fixtureActor.id } }),
    database.product.create({ data: { workspaceId, sku: "CRM48-PROJ", name: "Projeto contratual", kind: "PROJECT", revenueCategory: "PROJECT", listPriceCents: 50000n, createdByActorId: fixtureActor.id, updatedByActorId: fixtureActor.id } }),
  ]);
  const offer = await database.offer.create({ data: { workspaceId, opportunityId: opportunity.id, productId: product.id, name: "Plano contratual fictício", quantity: 1, unitPriceCents: 480000n, totalCents: 480000n, createdByActorId: fixtureActor.id, updatedByActorId: fixtureActor.id } });
  await database.offerLine.createMany({ data: [
    { workspaceId, offerId: offer.id, productId: product.id, position: 1, productVersionSnapshot: product.version, productSkuSnapshot: product.sku, productNameSnapshot: product.name, productKindSnapshot: product.kind, revenueCategorySnapshot: "SOFTWARE", approvedConditionsSnapshot: product.approvedConditions, quantity: 1, unitPriceCents: 250000n, totalCents: 250000n },
    ...parts.map((part, index) => ({ workspaceId, offerId: offer.id, productId: part.id, position: index + 2, productVersionSnapshot: part.version, productSkuSnapshot: part.sku, productNameSnapshot: part.name, productKindSnapshot: part.kind, revenueCategorySnapshot: part.revenueCategory, approvedConditionsSnapshot: part.approvedConditions, quantity: 1, unitPriceCents: part.listPriceCents, totalCents: part.listPriceCents })),
  ] });
});

afterAll(async () => database.$disconnect());

describe("CRM-48 contratos e versões comerciais", () => {
  it("cria snapshot a partir de oportunidade/oferta e respeita idempotência", async () => {
    const screen = await contracts().getScreen(admin, {});
    expect(screen.templateVersions.length).toBeGreaterThan(0);
    expect(screen.eligibleOpportunities.length).toBeGreaterThan(0);
    const opportunity = screen.eligibleOpportunities[0]!;
    const input = { opportunityId: opportunity.id, offerId: opportunity.offerId, templateVersionId: screen.templateVersions[0]!.id, billingFrequency: "MONTHLY", durationMonths: 12, paymentTerms: "Pagamento mensal conforme oferta aprovada.", renewalExpected: true, idempotencyKey: "crm48:create:integration:001" };
    const first = await contracts().create(admin, input);
    await expect(contracts().create(admin, input)).resolves.toMatchObject({ contractId: first.contractId, replayed: true });
    const stored = await database.commercialContract.findUniqueOrThrow({ where: { id: first.contractId } });
    const version = await database.contractVersion.findFirstOrThrow({ where: { workspaceId, contractId: first.contractId } });
    expect(stored).toMatchObject({ status: "DRAFT", currentVersionId: version.id, revision: 1 });
    expect(version).toMatchObject({ state: "DRAFT", versionNumber: 1, totalCents: BigInt(opportunity.totalCents) });
    const lines = await database.contractLineSnapshot.findMany({ where: { workspaceId, contractVersionId: version.id }, orderBy: { position: "asc" } });
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.revenueCategorySnapshot)).toEqual(["SOFTWARE", "IMPLEMENTATION", "RECURRING_SERVICE", "PROJECT"]);
    expect(await database.contractClauseSnapshot.count({ where: { workspaceId, contractVersionId: version.id } })).toBeGreaterThan(0);
    expect(await database.auditLog.count({ where: { workspaceId, entityId: first.contractId, action: "contract.created" } })).toBe(1);
  });

  it("executa revisão, emissão, envio simulado e aceite manual com hash verificável", async () => {
    const contract = await database.commercialContract.findFirstOrThrow({ where: { workspaceId, status: "DRAFT" } });
    await contracts().act(admin, contract.id, { action: "REQUEST_REVIEW", expectedRevision: 1, idempotencyKey: "crm48:review:001", reason: "Revisão interna controlada.", confirmed: true });
    await contracts().act(admin, contract.id, { action: "MARK_READY", expectedRevision: 2, idempotencyKey: "crm48:ready:001", confirmed: true });
    await contracts().act(admin, contract.id, { action: "ISSUE", expectedRevision: 3, idempotencyKey: "crm48:issue:001", confirmed: true });
    const issued = await database.contractVersion.findUniqueOrThrow({ where: { id: contract.currentVersionId! } });
    expect(issued).toMatchObject({ state: "ISSUED", contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), renderedHtml: expect.stringContaining("Documento para demonstração local") });
    await expect(database.contractLineSnapshot.update({ where: { id: (await database.contractLineSnapshot.findFirstOrThrow({ where: { workspaceId, contractVersionId: issued.id } })).id }, data: { quantity: 2 } })).rejects.toThrow(/append-only/);
    await contracts().act(admin, contract.id, { action: "SEND_SIMULATED", expectedRevision: 4, idempotencyKey: "crm48:send:001", confirmed: true });
    await contracts().act(admin, contract.id, { action: "ACCEPT_LOCAL", expectedRevision: 5, idempotencyKey: "crm48:accept:001", acceptedByName: "Contato fictício", acceptedByRole: "Responsável", evidenceText: "Aceite manual confirmado em ambiente local.", effectiveStartsAt: clock.toISOString(), effectiveEndsAt: "2049-06-15T15:00:00.000Z", confirmed: true });
    await expect(database.commercialContract.findUniqueOrThrow({ where: { id: contract.id } })).resolves.toMatchObject({ status: "ACCEPTED", revision: 6, effectiveStartsAt: clock });
    await expect(contracts().getPrintableVersion(admin, contract.id)).resolves.toMatchObject({ contractNumber: contract.contractNumber, versionNumber: 1, contentHash: issued.contentHash });
    expect(await database.contractEvent.count({ where: { workspaceId, contractId: contract.id } })).toBe(6);
  });

  it("cria versão sequencial sem reescrever o snapshot emitido", async () => {
    const contract = await database.commercialContract.findFirstOrThrow({ where: { workspaceId, status: "ACCEPTED" } });
    const prior = await database.contractVersion.findUniqueOrThrow({ where: { id: contract.currentVersionId! } });
    const result = await contracts().act(admin, contract.id, { action: "CREATE_VERSION", expectedRevision: contract.revision, idempotencyKey: "crm48:version:002", reason: "Renegociação exige snapshot separado.", confirmed: true });
    expect(result).toMatchObject({ status: "DRAFT" });
    await expect(database.contractVersion.findUniqueOrThrow({ where: { id: prior.id } })).resolves.toMatchObject({ state: "SUPERSEDED", contentHash: prior.contentHash, renderedHtml: prior.renderedHtml });
    const current = await database.contractVersion.findUniqueOrThrow({ where: { id: result.versionId! } });
    expect(current).toMatchObject({ versionNumber: 2, state: "DRAFT", renderedHtml: null, contentHash: null });
  });

  it("aplica RBAC e isolamento e registra backfill apenas como revisão", async () => {
    await expect(contracts().getScreen(manager, {})).resolves.toMatchObject({ canCreate: true });
    const adminScreen = await contracts().getScreen(admin, {});
    const existingContract = await database.commercialContract.findFirstOrThrow({ where: { workspaceId } });
    const contractCountBeforeBackfill = await database.commercialContract.count({ where: { workspaceId } });
    const sourceVersion = await database.contractVersion.findFirstOrThrow({ where: { workspaceId, contractId: existingContract.id }, orderBy: { versionNumber: "asc" } });
    await expect(contracts().create(viewer, { opportunityId: existingContract.opportunityId, offerId: sourceVersion.sourceOfferId!, templateVersionId: adminScreen.templateVersions[0]!.id, billingFrequency: "ONE_TIME", paymentTerms: "Pagamento conforme proposta.", idempotencyKey: "crm48:viewer:denied" })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(contracts().getScreen({ ...admin, workspaceId: randomUUID() }, {})).rejects.toBeInstanceOf(AccessDeniedError);
    const sourceOpportunity = await database.opportunity.findUniqueOrThrow({ where: { id: existingContract.opportunityId } });
    await database.opportunity.create({ data: { workspaceId, leadId: sourceOpportunity.leadId, accountId: sourceOpportunity.accountId, pipelineId: sourceOpportunity.pipelineId, currentStageId: sourceOpportunity.currentStageId, ownerMemberId: sourceOpportunity.ownerMemberId, productId: sourceOpportunity.productId, name: "Oportunidade legada para revisão contratual", status: "OPEN", amountCents: 120000n, mrrCents: 10000n, tcvCents: 120000n, probabilityBps: 3500, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const backfill = createContractBackfillService({ database, now: () => clock });
    const dry = await backfill.run(admin, { mode: "DRY_RUN", runKey: "crm48:backfill:dry:001" });
    expect(dry.candidateCount).toBeGreaterThan(0);
    const execute = await backfill.run(admin, { mode: "EXECUTE", runKey: "crm48:backfill:execute:001" });
    await expect(backfill.run(admin, { mode: "EXECUTE", runKey: "crm48:backfill:execute:001" })).resolves.toMatchObject({ id: execute.id, idempotent: true });
    expect(await database.contractBackfillItem.count({ where: { workspaceId, runId: execute.id } })).toBe(execute.candidateCount);
    expect(await database.commercialContract.count({ where: { workspaceId } })).toBe(contractCountBeforeBackfill);
  });
});

describe("CRM-49 assinaturas e ledger", () => {
  it("separa criação, ativação, idempotência e imutabilidade do ledger", async () => {
    const contract = await database.commercialContract.findFirstOrThrow({ where: { workspaceId } });
    await database.commercialContract.update({ where: { id: contract.id }, data: { status: "ACCEPTED", acceptedAt: clock } });
    const revenue = createRevenueService(database, authorization);
    await expect(revenue.create(viewer, { contractId: contract.id, quantity: 1, recurringPriceCents: 40000n, billingInterval: "MONTHLY", startsAt: clock })).rejects.toBeInstanceOf(AccessDeniedError);
    const subscription = await revenue.create(admin, { contractId: contract.id, quantity: 1, recurringPriceCents: 40000n, billingInterval: "MONTHLY", startsAt: clock });
    expect(subscription).toMatchObject({ status: "DRAFT", currentMrrCents: 0n });
    await revenue.action(admin, subscription.id, { action: "ACTIVATE", effectiveAt: clock, reason: "Ativação local confirmada", idempotencyKey: "crm49:activate:001" });
    await revenue.action(admin, subscription.id, { action: "ACTIVATE", effectiveAt: clock, reason: "Ativação local confirmada", idempotencyKey: "crm49:activate:001" }).catch(() => undefined);
    const movement = await database.revenueMovement.findFirstOrThrow({ where: { workspaceId, subscriptionId: subscription.id, type: "NEW" } });
    expect(movement.deltaMrrCents).toBe(40000n);
    expect(await database.revenueMovement.count({ where: { workspaceId, subscriptionId: subscription.id, type: "NEW" } })).toBe(1);
    await expect(database.revenueMovement.update({ where: { id: movement.id }, data: { reason: "tentativa de mutação" } })).rejects.toThrow(/append-only/);
    await expect(revenue.list({ ...admin, workspaceId: randomUUID() })).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
