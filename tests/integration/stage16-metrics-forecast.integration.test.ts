import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createForecastService } from "@/modules/forecast/application/forecast-service";
import { createStage16MetricsService } from "@/modules/metrics/stage16/application/stage16-metrics-service";
import { seedCrm29DemoData } from "@/modules/settings/application/crm29-demo-data-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { seedForecastDemoData } from "@/modules/settings/application/forecast-demo-seed-service";
import { seedGoalDemoData } from "@/modules/settings/application/goal-demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for stage 16 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage 16 requires an ephemeral test schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2026-09-13T16:00:00.000Z");
const forecast = createForecastService({ database, authorization, now: () => clock });
const metrics = createStage16MetricsService({ database, authorization, now: () => clock });

let workspaceId: string;
let manager: AuthenticatedContext;
let opportunityOwner: AuthenticatedContext;
let cycleId: string;
let futureOpportunityId: string;
let missingEvidenceOpportunityId: string;
let eligibleOpportunityId: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true, workspace: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  await seedCrm29DemoData(database, { DATABASE_URL: connectionString, NODE_ENV: "test" }, { now: clock });
  await seedGoalDemoData(database);
  await seedForecastDemoData(database);
  manager = await context("gestor@demo.politizai.local");
  const cycle = await database.forecastCycle.findFirstOrThrow({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  cycleId = cycle.id;
  const initial = await forecast.screen(manager, { cycleId });
  const candidates = initial.candidates.filter((item) => item.status === "OPEN" && BigInt(item.amountCents) > 0n && item.expectedCloseAt && new Date(item.expectedCloseAt) >= cycle.periodStart && new Date(item.expectedCloseAt) < cycle.periodEnd).slice(0, 3);
  if (candidates.length < 3) throw new Error("Fixture Stage 16 exige três oportunidades abertas no ciclo.");
  [futureOpportunityId, missingEvidenceOpportunityId, eligibleOpportunityId] = candidates.map((item) => item.opportunityId) as [string, string, string];
  const owner = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, id: candidates[0]!.ownerMemberId }, include: { role: true, user: true, workspace: true } });
  const ownerActor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: owner.userId, type: "HUMAN" } });
  opportunityOwner = { sessionId: randomUUID(), workspaceId, workspaceSlug: owner.workspace.slug, userId: owner.userId, memberId: owner.id, actorId: ownerActor.id, roleId: owner.roleId, roleKey: owner.role.key, roleName: owner.role.name, displayName: owner.user.displayName };
  const futureProduct = await database.product.create({ data: { workspaceId, sku: "STAGE16-FUTURE", name: "Oferta futura Stage 16", kind: "PRODUCT", revenueCategory: "SOFTWARE", audience: "INSTITUTIONAL", availability: "FUTURE", listPriceCents: 100_000n, currency: "BRL", active: false, createdByActorId: manager.actorId, updatedByActorId: manager.actorId } });
  const availableProduct = await database.product.findFirstOrThrow({ where: { workspaceId, active: true, availability: { in: ["AVAILABLE", "CAPACITY_LIMITED"] }, deletedAt: null } });
  const controlledIds = [futureOpportunityId, missingEvidenceOpportunityId, eligibleOpportunityId];
  await database.opportunity.updateMany({ where: { workspaceId, id: { notIn: controlledIds } }, data: { deletedAt: clock } });
  await database.opportunityEvidence.deleteMany({ where: { workspaceId, opportunityId: { in: controlledIds } } });
  await database.opportunity.update({ where: { id: futureOpportunityId }, data: { productId: futureProduct.id, status: "OPEN", amountCents: 100_000n, expectedCloseAt: new Date("2026-09-20T12:00:00Z"), createdAt: new Date("2026-09-02T12:00:00Z") } });
  await database.opportunity.update({ where: { id: missingEvidenceOpportunityId }, data: { productId: availableProduct.id, status: "OPEN", amountCents: 200_000n, expectedCloseAt: new Date("2026-09-21T12:00:00Z"), createdAt: new Date("2026-09-03T12:00:00Z") } });
  await database.opportunity.update({ where: { id: eligibleOpportunityId }, data: { productId: availableProduct.id, status: "OPEN", amountCents: 300_000n, expectedCloseAt: new Date("2026-09-22T12:00:00Z"), createdAt: new Date("2026-09-04T12:00:00Z") } });
  await database.opportunityEvidence.createMany({ data: [
    { workspaceId, opportunityId: futureOpportunityId, type: "DIAGNOSIS", version: 1, summary: "Diagnóstico confirmado da oferta futura.", idempotencyKey: "stage16:future:diagnosis", confirmedAt: new Date("2026-09-10T12:00:00Z"), recordedByActorId: manager.actorId },
    { workspaceId, opportunityId: eligibleOpportunityId, type: "DIAGNOSIS", version: 1, summary: "Diagnóstico confirmado.", idempotencyKey: "stage16:eligible:diagnosis", confirmedAt: new Date("2026-09-10T12:00:00Z"), recordedByActorId: manager.actorId },
    { workspaceId, opportunityId: eligibleOpportunityId, type: "ECONOMIC_BUYER", version: 1, summary: "Decisor econômico confirmado.", idempotencyKey: "stage16:eligible:buyer", confirmedAt: new Date("2026-09-10T12:00:00Z"), recordedByActorId: manager.actorId },
    { workspaceId, opportunityId: eligibleOpportunityId, type: "SPONSOR", version: 1, summary: "Patrocinador confirmado.", idempotencyKey: "stage16:eligible:sponsor", confirmedAt: new Date("2026-09-10T12:00:00Z"), recordedByActorId: manager.actorId },
    { workspaceId, opportunityId: eligibleOpportunityId, type: "PILOT_CRITERIA", version: 1, summary: "Critério de piloto confirmado.", idempotencyKey: "stage16:eligible:pilot", confirmedAt: new Date("2026-09-10T12:00:00Z"), recordedByActorId: manager.actorId },
  ] });
});

afterAll(async () => database.$disconnect());

describe("etapa 16 — métricas longas e forecast governado", () => {
  it("separa as leituras financeiras/custos e publica qualidade explícita", async () => {
    const result = await metrics.build(manager, { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z", asOf: clock });
    expect(result.cadence.coverage.stage).toEqual({ covered: 3, total: 3, coverageBps: 10_000 });
    expect(result.cadence.coverage.diagnosis).toEqual({ covered: 2, total: 3, coverageBps: 6_666 });
    expect(result.cadence.coverage.sponsor).toEqual({ covered: 1, total: 3, coverageBps: 3_333 });
    expect(Object.values(result.financial).every((value) => typeof value === "bigint")).toBe(true);
    expect([result.costs.mediaCents, result.costs.outboundCents, result.costs.aiCents, result.costs.totalCents].every((value) => typeof value === "bigint")).toBe(true);
    expect(result.sampleQuality.opportunitySamples).toBe(3);
    expect([result.sampleQuality.mediaCostCoverageBps, result.sampleQuality.outboundCostCoverageBps, result.sampleQuality.aiCostCoverageBps].every((value) => value === null || typeof value === "number")).toBe(true);
  });

  it("exclui FUTURE e ausência de evidência, mantendo oportunidade comprovada", async () => {
    const screen = await forecast.screen(manager, { cycleId, asOf: clock });
    expect(screen.candidates.find((item) => item.opportunityId === futureOpportunityId)).toMatchObject({ eligible: false, reasonCode: "PRODUCT_NOT_AVAILABLE" });
    expect(screen.candidates.find((item) => item.opportunityId === missingEvidenceOpportunityId)).toMatchObject({ eligible: false, reasonCode: "MISSING_EVIDENCE" });
    expect(screen.candidates.find((item) => item.opportunityId === eligibleOpportunityId)).toMatchObject({ eligible: true, reasonCode: "ELIGIBLE" });
    await expect(forecast.submit(opportunityOwner, { cycleId, category: "PIPELINE", declaredValueCents: "100000", opportunityIds: [futureOpportunityId], targetMemberId: opportunityOwner.memberId, type: "INDIVIDUAL", asOf: clock, idempotencyKey: "stage16:future:blocked" })).rejects.toMatchObject({ code: "FORECAST_OPPORTUNITY_INELIGIBLE" });
    const snapshot = await forecast.consolidate(manager, { cycleId, asOf: clock, idempotencyKey: "stage16:controlled:snapshot" });
    expect(snapshot.items.find((item) => item.opportunityId === futureOpportunityId)).toMatchObject({ eligible: false, reasonCode: "PRODUCT_NOT_AVAILABLE" });
    expect(snapshot.items.find((item) => item.opportunityId === missingEvidenceOpportunityId)).toMatchObject({ eligible: false, reasonCode: "MISSING_EVIDENCE" });
    expect(snapshot.items.find((item) => item.opportunityId === eligibleOpportunityId)?.eligible).toBe(true);
  });
});
