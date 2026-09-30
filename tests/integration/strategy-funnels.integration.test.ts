import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createStrategyFunnelService } from "@/modules/marketing/application/strategy-funnel-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for strategy funnel tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Strategy funnels require an ephemeral politizai_test_* schema.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 8 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2052-04-15T15:00:00.000Z");
const service = createStrategyFunnelService({ database, authorization, now: () => clock });
let workspaceId: string; let admin: AuthenticatedContext; let viewer: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

const definition = { schema: "strategy.funnel/v1" as const, nodes: [
  { id: "30000000-0000-4000-8000-000000000001", type: "WHATSAPP" as const, label: "Primeiro contato", referenceId: null },
  { id: "30000000-0000-4000-8000-000000000002", type: "WHATSAPP" as const, label: "Conversa qualificada", referenceId: null },
] };

beforeAll(async () => { workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId; [admin, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("viewer@demo.politizai.local")]); });
afterAll(async () => database.$disconnect());

describe("editor persistido de estratégias", () => {
  it("cria com replay idempotente, mede o período e mantém auditoria", async () => {
    const input = { name: "WhatsApp para venda", description: "Estratégia operacional", definition, idempotencyKey: "strategy:integration:001" };
    const created = await service.create(admin, input);
    expect((await service.create(admin, input)).id).toBe(created.id);
    const screen = await service.screen(admin, { periodStart: "2052-04-01T00:00:00.000Z", periodEnd: "2052-05-01T00:00:00.000Z" });
    expect(screen.strategies[0]).toMatchObject({ id: created.id, name: input.name });
    expect(screen.strategies[0]?.nodes).toHaveLength(2);
    expect(await database.auditLog.count({ where: { workspaceId, entityType: "StrategyFunnel", entityId: created.id, action: "marketing.strategy_funnel.created" } })).toBe(1);
  });

  it("controla revisão concorrente, arquivamento e permissão de gestão", async () => {
    const current = await database.strategyFunnel.findFirstOrThrow({ where: { workspaceId, archivedAt: null } });
    const updated = await service.update(admin, current.id, { name: "Jornada revisada", description: "Versão 2", definition, expectedRevision: current.revision });
    expect(updated.revision).toBe(current.revision + 1);
    await expect(service.update(admin, current.id, { name: "Conflito", description: "", definition, expectedRevision: current.revision })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(service.create(viewer, { name: "Sem permissão", description: "", definition, idempotencyKey: "strategy:viewer:001" })).rejects.toThrow();
    await service.archive(admin, current.id, updated.revision);
    expect((await service.screen(admin, { periodStart: "2052-04-01", periodEnd: "2052-05-01" })).strategies).toHaveLength(0);
  });

  it("rejeita referência de outro workspace", async () => {
    const other = await database.workspace.create({ data: { slug: `strategy-${randomUUID().slice(0, 8)}`, name: "Workspace externo" } });
    const actor = await database.actor.create({ data: { workspaceId: other.id, type: "SYSTEM", key: "system", displayName: "Sistema externo" } });
    const page = await database.landingPage.create({ data: { workspaceId: other.id, key: "external", name: "Página externa", canonicalUrl: "https://example.test", createdByActorId: actor.id, updatedByActorId: actor.id } });
    await expect(service.create(admin, { name: "Referência cruzada", description: "", idempotencyKey: "strategy:cross:001", definition: { schema: "strategy.funnel/v1", nodes: [
      { id: "40000000-0000-4000-8000-000000000001", type: "LANDING_PAGE", label: "Página", referenceId: page.id },
      { id: "40000000-0000-4000-8000-000000000002", type: "WHATSAPP", label: "WhatsApp", referenceId: null },
    ] } })).rejects.toMatchObject({ code: "STRATEGY_REFERENCE_NOT_FOUND" });
  });
});
