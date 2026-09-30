import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFarmerBackfillService } from "@/modules/farmer/application/farmer-backfill-service";
import { createFarmerService } from "@/modules/farmer/application/farmer-service";
import { seedAccountDemoData } from "@/modules/settings/application/account-demo-seed-service";
import { seedCrm29DemoData } from "@/modules/settings/application/crm29-demo-data-service";
import { seedCustomerSuccessDemoData } from "@/modules/settings/application/customer-success-demo-seed-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { seedFarmerDemoData } from "@/modules/settings/application/farmer-demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-54 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) {
  throw new Error("CRM-54 requires an ephemeral politizai_test_* schema.");
}

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2054-06-15T15:00:00.000Z");
const service = createFarmerService({ database, authorization, now: () => clock });

let workspaceId: string;
let admin: AuthenticatedContext;
let closer: AuthenticatedContext;
let viewer: AuthenticatedContext;
let subscriptionId: string;
let renewalId: string;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email } },
    include: { role: true, user: true },
  });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return {
    sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId,
    memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key,
    roleName: member.role.name, displayName: member.user.displayName,
  } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  await seedCrm29DemoData(database, { DATABASE_URL: connectionString, NODE_ENV: "test" }, { now: clock });
  await seedAccountDemoData(database);
  await seedCustomerSuccessDemoData(database);
  await seedFarmerDemoData(database);
  [admin, closer, viewer] = await Promise.all([
    context("admin@demo.politizai.local"),
    context("closer1@demo.politizai.local"),
    context("viewer@demo.politizai.local"),
  ]);
  subscriptionId = (await database.subscription.findFirstOrThrow({
    where: { workspaceId, status: "ACTIVE", ownerMemberId: closer.memberId }, orderBy: { id: "asc" },
  })).id;
});

afterAll(async () => database.$disconnect());

describe("CRM-54 Farmer, renovação, expansão, contração e churn", () => {
  it("cria renovação uma vez sob concorrência, com snapshot, evento e auditoria", async () => {
    const input = {
      subscriptionId,
      targetDate: new Date("2054-08-15T15:00:00.000Z"),
      nextActionDescription: "Revisar renovação com o cliente",
      nextActionAt: new Date("2054-06-16T15:00:00.000Z"),
      idempotencyKey: "crm54:test:renewal:001",
    };
    const [first, replay] = await Promise.all([service.createRenewal(closer, input), service.createRenewal(closer, input)]);
    expect(replay.id).toBe(first.id);
    renewalId = first.id;
    expect(await database.renewalEvent.count({ where: { workspaceId, renewalId, type: "CREATED" } })).toBe(1);
    expect(await database.auditLog.count({ where: { workspaceId, entityType: "Renewal", entityId: renewalId } })).toBe(1);
    expect(first.snapshot).toMatchObject({ status: "ACTIVE" });
  });

  it("registra risco e decisão humana com revisão, idempotência e relógio controlado", async () => {
    const initial = await database.renewal.findUniqueOrThrow({ where: { id: renewalId } });
    const risk = await service.actRenewal(closer, renewalId, {
      action: "SET_RISK", expectedRevision: initial.revision, riskLevel: "HIGH", riskReasonCode: "ADOPTION_RISK",
      evidence: "Cliente informou uso abaixo do esperado.", reason: "Risco confirmado pelo responsável da carteira.",
      idempotencyKey: "crm54:test:risk:001",
    });
    expect(risk.riskLevel).toBe("HIGH");
    const renewed = await service.actRenewal(closer, renewalId, {
      action: "RENEW", expectedRevision: risk.revision, reasonCode: "RENEWED_CONFIRMED",
      comment: "Cliente confirmou a continuidade do contrato.", idempotencyKey: "crm54:test:renew:001",
    });
    const replay = await service.actRenewal(closer, renewalId, {
      action: "RENEW", expectedRevision: risk.revision, reasonCode: "RENEWED_CONFIRMED",
      comment: "Cliente confirmou a continuidade do contrato.", idempotencyKey: "crm54:test:renew:001",
    });
    expect(renewed.status).toBe("RENEWED");
    expect(replay.id).toBe(renewed.id);
    const event = await database.renewalEvent.findFirstOrThrow({ where: { workspaceId, renewalId, type: "RENEWED" } });
    expect(event.occurredAt.toISOString()).toBe(clock.toISOString());
    expect(await database.revenueMovement.count({ where: { workspaceId, subscriptionId, type: "RENEWAL" } })).toBe(1);
    await expect(service.actRenewal(closer, renewalId, {
      action: "RENEW", expectedRevision: renewed.revision, reasonCode: "RENEWED_CONFIRMED",
      comment: "Transição repetida deve ser rejeitada.", idempotencyKey: "crm54:test:renew:invalid",
    })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("confirma sinal de expansão somente com ação humana e cria Opportunity rastreável atomicamente", async () => {
    const signal = await database.expansionSignal.findFirstOrThrow({ where: { workspaceId, status: "PENDING_REVIEW" } });
    const opportunitiesBefore = await database.opportunity.count({ where: { workspaceId } });
    await expect(service.reviewSignal(closer, {
      signalId: signal.id, action: "CONFIRM_AND_LINK", expectedRevision: signal.revision,
      reasonCode: "EXPANSION_CONFIRMED", comment: "Cliente confirmou interesse na ampliação.",
      idempotencyKey: "crm54:test:expansion:invalid",
    })).rejects.toThrow("Oportunidade exige próxima ação");
    expect(await database.opportunity.count({ where: { workspaceId } })).toBe(opportunitiesBefore);
    const linked = await service.reviewSignal(closer, {
      signalId: signal.id, action: "CONFIRM_AND_LINK", expectedRevision: signal.revision,
      reasonCode: "EXPANSION_CONFIRMED", comment: "Cliente confirmou interesse na ampliação.",
      nextActionDescription: "Preparar proposta de expansão", nextActionAt: new Date("2054-06-17T15:00:00.000Z"),
      idempotencyKey: "crm54:test:expansion:001",
    });
    expect(linked.status).toBe("LINKED");
    const opportunity = await database.opportunity.findFirstOrThrow({ where: { workspaceId, farmerExpansionSignalId: signal.id } });
    expect(opportunity.nextActionTaskId).not.toBeNull();
    expect(await database.stageHistory.count({ where: { workspaceId, opportunityId: opportunity.id } })).toBe(1);
    const replay = await service.reviewSignal(closer, {
      signalId: signal.id, action: "CONFIRM_AND_LINK", expectedRevision: signal.revision,
      reasonCode: "EXPANSION_CONFIRMED", comment: "Cliente confirmou interesse na ampliação.",
      nextActionDescription: "Preparar proposta de expansão", nextActionAt: new Date("2054-06-17T15:00:00.000Z"),
      idempotencyKey: "crm54:test:expansion:001",
    });
    expect(replay.opportunityId).toBe(opportunity.id);
    expect(await database.opportunity.count({ where: { workspaceId, farmerExpansionSignalId: signal.id } })).toBe(1);
  });

  it("registra contração no ledger e corrige por movimento reversor sem apagar o fato", async () => {
    const subscription = await database.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const newMrr = subscription.currentMrrCents - 10_000n;
    const decision = await service.confirmRevenueDecision(closer, {
      subscriptionId, type: "CONTRACTION", newMrrCents: newMrr.toString(), effectiveAt: clock,
      reasonCode: "SCOPE_REDUCTION", comment: "Cliente confirmou redução de escopo.",
      evidence: "Confirmação registrada pelo responsável humano.", logoChurn: false, revenueChurn: true,
      idempotencyKey: "crm54:test:contraction:001",
    });
    const replay = await service.confirmRevenueDecision(closer, {
      subscriptionId, type: "CONTRACTION", newMrrCents: newMrr.toString(), effectiveAt: clock,
      reasonCode: "SCOPE_REDUCTION", comment: "Cliente confirmou redução de escopo.",
      evidence: "Confirmação registrada pelo responsável humano.", logoChurn: false, revenueChurn: true,
      idempotencyKey: "crm54:test:contraction:001",
    });
    expect(replay.id).toBe(decision.id);
    expect(decision.deltaMrrCents).toBe(-10_000n);
    const corrected = await service.correctDecision(admin, {
      decisionId: decision.id, reason: "Correção administrativa confirmada com evidência documental.",
      idempotencyKey: "crm54:test:contraction:reversal:001",
    });
    expect(corrected.status).toBe("REVERSED");
    expect(await database.revenueMovement.count({ where: { workspaceId, subscriptionId, type: "REVERSAL" } })).toBe(1);
    expect(await database.revenueMovement.count({ where: { workspaceId, subscriptionId, type: "CONTRACTION" } })).toBeGreaterThanOrEqual(1);
  });

  it("distingue logo churn e revenue churn, exige evidência e preserva evento append-only", async () => {
    await expect(service.confirmRevenueDecision(closer, {
      subscriptionId, type: "CHURN", newMrrCents: 0, effectiveAt: clock,
      reasonCode: "CUSTOMER_CANCELLED", comment: "Cliente confirmou cancelamento.",
      evidence: "Fato confirmado pelo responsável.", logoChurn: false, revenueChurn: false,
      learning: "Revisar a adoção trinta dias antes da próxima renovação.",
      idempotencyKey: "crm54:test:churn:invalid",
    })).rejects.toThrow("Churn exige MRR zero");
    const decision = await service.confirmRevenueDecision(closer, {
      subscriptionId, type: "CHURN", newMrrCents: 0, effectiveAt: clock,
      reasonCode: "CUSTOMER_CANCELLED", comment: "Cliente confirmou cancelamento.",
      evidence: "Fato confirmado pelo responsável.", logoChurn: true, revenueChurn: true,
      learning: "Antecipar a revisão de valor quando a adoção ficar abaixo do acordado.",
      idempotencyKey: "crm54:test:churn:001",
    });
    const churn = await database.churnEvent.findFirstOrThrow({ where: { workspaceId, decisionId: decision.id } });
    expect(churn).toMatchObject({ logoChurn: true, revenueChurn: true });
    expect(churn.evidence).toContain("Aprendizado: Antecipar a revisão de valor");
    expect((await database.auditLog.findFirstOrThrow({ where: { workspaceId, entityType: "FarmerRevenueDecision", entityId: decision.id } })).changes).toMatchObject({ reasonCode: "CUSTOMER_CANCELLED", learning: "Antecipar a revisão de valor quando a adoção ficar abaixo do acordado." });
    await expect(database.churnEvent.update({ where: { id: churn.id }, data: { evidence: "mutação proibida" } })).rejects.toThrow();
  });

  it("reconcilia fila, filtros e métricas, e respeita RBAC e isolamento por workspace", async () => {
    const screen = await service.screen(viewer, {});
    expect(screen.total).toBeGreaterThan(0);
    expect(screen.metrics.due90).toBeGreaterThanOrEqual(screen.metrics.due30);
    expect(screen.formulas.renewalRate).toContain("renovadas / decisões terminais");
    expect((await service.screen(viewer, { action: "EXPANSION" })).items.every(item => item.pendingExpansion > 0)).toBe(true);
    await expect(service.createRenewal(viewer, {
      subscriptionId, targetDate: new Date("2054-09-01T15:00:00.000Z"),
      nextActionDescription: "Tentativa sem permissão", nextActionAt: new Date("2054-06-18T15:00:00.000Z"),
      idempotencyKey: "crm54:test:viewer:denied",
    })).rejects.toThrow();
    await expect(service.detail({ ...admin, workspaceId: randomUUID() }, renewalId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("executa backfill conservador, faz replay e não fabrica churn ou decisão financeira", async () => {
    const backfill = createFarmerBackfillService({ database, authorization, now: () => clock });
    const decisionsBefore = await database.farmerRevenueDecision.count({ where: { workspaceId } });
    const churnBefore = await database.churnEvent.count({ where: { workspaceId } });
    const dry = await backfill.run(admin, { mode: "DRY_RUN", runKey: "crm54:test:backfill:dry:001" });
    const replay = await backfill.run(admin, { mode: "DRY_RUN", runKey: "crm54:test:backfill:dry:001" });
    expect(dry.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(await database.farmerRevenueDecision.count({ where: { workspaceId } })).toBe(decisionsBefore);
    expect(await database.churnEvent.count({ where: { workspaceId } })).toBe(churnBefore);
  });
});
