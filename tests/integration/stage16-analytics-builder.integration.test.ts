import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAnalyticsBuilderService } from "@/modules/analytics-builder/application/analytics-builder-service";
import { createRevenueMetricsService } from "@/modules/metrics/application/revenue-metrics-service";
import { seedCrm29DemoData } from "@/modules/settings/application/crm29-demo-data-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for stage 16 analytics tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage 16 analytics requires an ephemeral test schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2050-09-15T12:00:00.000Z");
const revenue = createRevenueMetricsService({ database, authorization, now: () => clock });
const service = createAnalyticsBuilderService({ database, authorization, revenue, now: () => clock });
let workspaceId: string;
let manager: AuthenticatedContext;
let sdr: AuthenticatedContext;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true, workspace: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  await seedCrm29DemoData(database, { DATABASE_URL: connectionString, NODE_ENV: "test" }, { now: clock });
  [manager, sdr] = await Promise.all([context("gestor@demo.politizai.local"), context("sdr1@demo.politizai.local")]);
  const product = await database.product.create({ data: { workspaceId, sku: "STAGE16-ANALYTICS", name: "Produto Analytics Stage 16", listPriceCents: 100_000n, createdByActorId: manager.actorId, updatedByActorId: manager.actorId } });
  filters.product.push(product.id);
  const opportunities = await database.opportunity.findMany({ where: { workspaceId, deletedAt: null, stageHistory: { some: { outcomeSnapshot: { is: null } } } }, take: 2, orderBy: { id: "asc" } });
  if (opportunities.length < 2) throw new Error("Fixture exige duas oportunidades.");
  const [won, open] = opportunities;
  await database.opportunity.update({ where: { id: won!.id }, data: { name: "=OPORTUNIDADE_PERIGOSA", createdAt: new Date("2050-07-10T12:00:00Z"), amountCents: 70_000n, productId: product.id } });
  await database.opportunity.update({ where: { id: open!.id }, data: { name: "Oportunidade aberta", createdAt: new Date("2050-07-11T12:00:00Z"), amountCents: 30_000n, productId: product.id } });
  const history = await database.stageHistory.findFirstOrThrow({ where: { workspaceId, opportunityId: won!.id, outcomeSnapshot: { is: null } }, orderBy: { enteredAt: "desc" } });
  await database.opportunityOutcomeSnapshot.create({ data: { workspaceId, opportunityId: won!.id, leadId: won!.leadId, stageHistoryId: history.id, ownerMemberId: won!.ownerMemberId, productId: product.id, status: "WON", amountCents: won!.amountCents, mrrCents: won!.mrrCents, tcvCents: won!.tcvCents, currency: "BRL", occurredAt: new Date("2050-08-10T12:00:00Z"), createdByActorId: manager.actorId } });
});

afterAll(async () => database.$disconnect());

const filters = { sdr: [] as string[], closer: [] as string[], team: [] as string[], source: [] as string[], campaign: [] as string[], creative: [] as string[], priority: [] as ("P1" | "P2" | "P3")[], product: [] as string[] };
const position = { x: 0, y: 0, width: 6, height: 4 };
const payload = {
  name: "Dashboard Stage 16", description: "Coortes controladas", idempotencyKey: "stage16:analytics:create:001",
  widgets: [
    { title: "Criadas em julho", metricKey: "sales.opportunity_value", type: "BAR", aggregation: "SUM", dimensionKey: "produto", dateBasis: "CREATED_AT", period: { preset: "CUSTOM", fromDate: "2050-07-01", toDate: "2050-07-31" }, asOf: null, filters, position },
    { title: "Ganhas em agosto", metricKey: "sales.opportunity_value", type: "KPI", aggregation: "SUM", dimensionKey: null, dateBasis: "WON_AT", period: { preset: "CUSTOM", fromDate: "2050-08-01", toDate: "2050-08-31" }, asOf: null, filters, position: { ...position, x: 6 } },
  ],
};

describe("etapa 16 — construtor analítico", () => {
  it("cria uma vez, isola workspace e exige permissão administrativa", async () => {
    const first = await service.create(manager, payload);
    const replay = await service.create(manager, payload);
    expect(first.idempotentReplay).toBe(false);
    expect(replay).toEqual({ result: first.result, idempotentReplay: true });
    expect(await database.analyticsDashboard.count({ where: { workspaceId, creationKey: payload.idempotencyKey } })).toBe(1);
    await expect(service.screen({ ...manager, workspaceId: randomUUID() })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.create(sdr, { ...payload, idempotencyKey: "stage16:analytics:sdr:denied" })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("troca a data-base, agrega sobre os registros e preserva o dataset no CSV", async () => {
    const shell = await service.screen(manager);
    const dashboard = shell.dashboards.find((item) => item.name === payload.name)!;
    const created = dashboard.widgets.find((item) => item.dateBasis === "CREATED_AT")!;
    const won = dashboard.widgets.find((item) => item.dateBasis === "WON_AT")!;
    expect(BigInt(created.value as string)).toBe(100_000n);
    expect(BigInt(won.value as string)).toBe(70_000n);
    expect(created.rows.reduce((total, row) => total + BigInt(row.value), 0n)).toBe(BigInt(created.value as string));

    const drilldown = await service.orderedDataset(manager, created.id);
    const exported = await service.csv(manager, created.id);
    const dataLines = exported.csv.trim().split("\r\n").slice(1);
    expect(exported.total).toBe(drilldown.records.length);
    expect(dataLines).toHaveLength(drilldown.records.length);
    for (let index = 0; index < drilldown.records.length; index += 1) expect(dataLines[index]).toContain(String(drilldown.records[index]!.entityId));
    expect(exported.csv).toContain("'=OPORTUNIDADE_PERIGOSA");
  });
});
