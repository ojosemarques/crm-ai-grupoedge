import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createLifecycleBackfillService } from "@/modules/lifecycle/application/lifecycle-backfill-service";
import { createLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG, seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for lifecycle integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 5 }) });
const now = new Date("2026-09-12T12:00:00.000Z");
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let firstSdrId: string;
let secondSdrId: string;

async function contextFor(email: string): Promise<AuthenticatedContext> {
  const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: DEMO_WORKSPACE_SLUG } });
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId: workspace.id, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId: workspace.id, workspaceSlug: workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  await seedDemoDatabase(database, { NODE_ENV: "test", DATABASE_URL: connectionString });
  admin = await contextFor(DEMO_USERS.find((user) => user.roleKey === "administrator")!.email);
  viewer = await contextFor(DEMO_USERS.find((user) => user.roleKey === "viewer")!.email);
  const sdrs = await database.workspaceMember.findMany({ where: { workspaceId: admin.workspaceId, teamMemberships: { some: { function: "SDR", deletedAt: null } } }, orderBy: { id: "asc" }, take: 2 });
  firstSdrId = sdrs[0]!.id;
  secondSdrId = sdrs[1]!.id;
});

afterAll(async () => database.$disconnect());

describe("CRM-35 lifecycle e responsabilidade funcional", () => {
  it("mantém projeção, histórico, ownership único e transferência explícita", async () => {
    const contact = await database.contact.create({ data: { workspaceId: admin.workspaceId, preferredName: `Lifecycle ${randomUUID()}`, origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const service = createLifecycleService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    await service.transition(admin, { entityType: "CONTACT", entityId: contact.id, toStage: "PROSPECT", reason: "Prospect confirmado manualmente.", source: "HUMAN", idempotencyKey: `prospect:${contact.id}` });
    await service.assignOwnership(admin, { entityType: "CONTACT", entityId: contact.id, function: "SDR", memberId: firstSdrId, reason: "SDR responsável pela qualificação.", source: "HUMAN", idempotencyKey: `owner-1:${contact.id}` });
    await service.transition(admin, { entityType: "CONTACT", entityId: contact.id, toStage: "LEAD", reason: "Interesse comercial confirmado.", source: "HUMAN", idempotencyKey: `lead:${contact.id}`, expectedRevision: 1 });
    const repeated = await service.transition(admin, { entityType: "CONTACT", entityId: contact.id, toStage: "LEAD", reason: "Interesse comercial confirmado.", source: "HUMAN", idempotencyKey: `lead:${contact.id}`, expectedRevision: 1 });
    expect(repeated.toStage).toBe("LEAD");
    const transfer = await service.requestTransfer(admin, { entityType: "CONTACT", entityId: contact.id, fromFunction: "SDR", toFunction: "SDR", targetMemberId: secondSdrId, reason: "Transferência de carteira confirmada.", idempotencyKey: `transfer:${contact.id}` });
    await service.respondTransfer(admin, transfer.id, { action: "ACCEPT", reason: "Novo SDR aceitou o contexto.", idempotencyKey: `accept:${contact.id}` });
    const journey = await service.getJourney(admin, { entityType: "CONTACT", entityId: contact.id });
    expect(journey.lifecycle?.stage).toBe("LEAD");
    expect(journey.ownership.filter((item) => item.function === "SDR")).toHaveLength(1);
    expect(journey.ownership.find((item) => item.function === "SDR")?.destinationId).toBe(secondSdrId);
    expect(journey.pendingTransfers).toHaveLength(0);
    expect(await database.lifecycleHistory.count({ where: { workspaceId: admin.workspaceId, contactId: contact.id } })).toBe(2);
  });

  it("protege histórico contra remoção e nega mutação ao visualizador", async () => {
    const history = await database.lifecycleHistory.findFirstOrThrow({ where: { workspaceId: admin.workspaceId } });
    await expect(database.lifecycleHistory.delete({ where: { id: history.id } })).rejects.toThrow(/append-only/i);
    const service = createLifecycleService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    await expect(service.transition(viewer, { entityType: history.entityType, entityId: history.contactId ?? history.accountId!, toStage: "INACTIVE", reason: "Tentativa sem permissão.", source: "HUMAN", idempotencyKey: `denied:${history.id}` })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("executa backfill conservador, sem inferir ACTIVE, RENEWAL ou CHURN", async () => {
    const account = await database.account.create({ data: { workspaceId: admin.workspaceId, name: `Conta ${randomUUID()}`, normalizedName: randomUUID(), origin: "MANUAL", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    const service = createLifecycleBackfillService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    const dryRun = await service.run(admin, { mode: "DRY_RUN", batchSize: 50 });
    expect(dryRun.status).toBe("COMPLETED");
    expect(await database.revenueLifecycle.findFirst({ where: { workspaceId: admin.workspaceId, accountId: account.id } })).toBeNull();
    const executed = await service.run(admin, { mode: "EXECUTE", batchSize: 50 });
    expect(executed.status).toBe("COMPLETED");
    const stages = await database.revenueLifecycle.findMany({ where: { workspaceId: admin.workspaceId }, select: { stage: true } });
    expect(stages.some((item) => ["ACTIVE", "RENEWAL", "CHURN"].includes(item.stage))).toBe(false);
    expect(await database.revenueLifecycle.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, accountId: account.id } })).toMatchObject({ stage: "UNKNOWN", source: "BACKFILL" });
    const rerun = await service.run(admin, { mode: "EXECUTE", batchSize: 50 });
    expect(rerun.createdCount).toBe(0);
    const lifecycle = createLifecycleService({ database, authorization: createAuthorizationService({ database }), now: () => now });
    const summary = await lifecycle.getOperationalSummary(admin);
    expect(summary.coverage.projected).toBeGreaterThan(0);
    expect(summary.latestBackfill?.status).toBe("COMPLETED");
    await expect(lifecycle.getOperationalSummary(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
