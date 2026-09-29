import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createRevenueMetricsService } from "@/modules/metrics/application/revenue-metrics-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for revenue metrics tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const now = new Date();
let manager: AuthenticatedContext;
let sdr: AuthenticatedContext;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { user: { normalizedEmail: email }, workspace: { slug: "politizai" }, deletedAt: null }, include: { workspace: true, role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  await seedDemoDatabase(database);
  manager = await context("gestor@demo.politizai.local");
  sdr = await context("sdr1@demo.politizai.local");
});
afterAll(async () => database.$disconnect());

describe("camada canônica de métricas de receita", () => {
  it("reconcilia métricas, comparação, coortes e drilldown no mesmo contrato", async () => {
    const service = createRevenueMetricsService({ database, authorization, now: () => now });
    const screen = await service.getScreen(manager, { preset: "MONTH" });
    expect(screen.registryVersion).toBe("crm57.1");
    expect(screen.bridge.reconciled).toBe(true);
    expect(screen.metrics.map((item) => item.metricId)).toContain("revenue.closing_mrr");
    expect(screen.comparisons).toHaveLength(screen.metrics.length);
    expect(screen.series.find((item) => item.metricId === "revenue.closing_mrr")?.points.length).toBeGreaterThan(0);
    const page = await service.getDrilldown(manager, { preset: "MONTH", metric: "revenue.net_new_mrr" });
    expect(page.total).toBeGreaterThanOrEqual(page.records.length);
    expect(page.metric.version).toBe(1);
  });

  it("suprime custo agregado no escopo próprio sem esconder o motivo", async () => {
    const service = createRevenueMetricsService({ database, authorization, now: () => now });
    const screen = await service.getScreen(sdr, { preset: "MONTH" });
    expect(screen.scope).toBe("OWN");
    expect(screen.metrics.find((item) => item.metricId === "acquisition.spend")).toMatchObject({ state: "SUPPRESSED", value: null, drilldownId: null });
  });

  it("rejeita asOf futuro", async () => {
    const service = createRevenueMetricsService({ database, authorization, now: () => now });
    await expect(service.getScreen(manager, { preset: "MONTH", asOf: new Date(now.getTime() + 60_000).toISOString() })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
