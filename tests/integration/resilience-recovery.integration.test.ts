import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOperationsService } from "@/modules/operations/application/operations-service";
import { createDeterministicFaultInjector } from "@/modules/resilience/domain/fault-injection";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL ausente.");
if (!/^politizai_test_resilience_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-63 exige schema efêmero de resiliência.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const now = new Date("2026-09-13T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: "admin@demo.politizai.local" } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  admin = { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
});
afterAll(async () => database.$disconnect());

describe("CRM-63 recuperação e invariantes", () => {
  it("faz rollback integral quando a falha ocorre antes do commit", async () => {
    const before = await database.telemetryRecord.count({ where: { workspaceId } });
    const injector = createDeterministicFaultInjector({ enabledPoints: ["before-commit"] });
    await expect(database.$transaction(async (tx) => {
      await tx.telemetryRecord.create({ data: { workspaceId, actorId: admin.actorId, kind: "TRACE", operation: "resilience.fault.before_commit", outcome: "SUCCESS", correlationId: "crm63:rollback:001", labels: {}, occurredAt: now } });
      injector.hit("before-commit");
    })).rejects.toThrow("RESILIENCE_FAULT:before-commit");
    expect(await database.telemetryRecord.count({ where: { workspaceId } })).toBe(before);
  });

  it("retoma resultado ambíguo após commit sem duplicar efeito", async () => {
    const key = `crm63:ambiguous:${randomUUID()}`;
    const execute = () => database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${key}`}, 0))`;
      return tx.job.upsert({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: key } }, update: {}, create: { workspaceId, type: "NOTIFICATION", status: "SUCCEEDED", idempotencyKey: key, runAt: now, payload: { local: true }, createdByActorId: admin.actorId, updatedByActorId: admin.actorId, finishedAt: now } });
    });
    const committed = await execute();
    const injector = createDeterministicFaultInjector({ enabledPoints: ["after-commit"] });
    expect(() => injector.hit("after-commit")).toThrow("RESILIENCE_FAULT:after-commit");
    const replay = await execute();
    expect(replay.id).toBe(committed.id);
    expect(await database.job.count({ where: { workspaceId, idempotencyKey: key } })).toBe(1);
  });

  it("mantém ownership explícito e unicidades críticas sob concorrência", async () => {
    const orphanLeads = await database.lead.count({ where: { workspaceId, ownerMemberId: null, queueId: null } });
    expect(orphanLeads).toBe(0);
    const key = `crm63:concurrent:${randomUUID()}`;
    const create = () => database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${key}`}, 0))`;
      return tx.job.upsert({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: key } }, update: {}, create: { workspaceId, type: "NOTIFICATION", idempotencyKey: key, runAt: now, payload: { probe: true }, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
    });
    const [a, b] = await Promise.all([create(), create()]);
    expect(a.id).toBe(b.id);
  });

  it("expõe evidência resumida no console com RBAC existente", async () => {
    await database.telemetryRecord.createMany({ data: [
      { workspaceId, actorId: admin.actorId, kind: "TRACE", operation: "resilience.restore.completed", outcome: "SUCCESS", correlationId: "crm63:restore:001", labels: { mode: "local" }, metadata: { reconciled: true, publicTouched: false }, occurredAt: now },
      { workspaceId, actorId: admin.actorId, kind: "METRIC", operation: "resilience.load.completed", outcome: "SUCCESS", correlationId: "crm63:load:001", labels: { mode: "local" }, metadata: { profile: "baseline", budgetPassed: true }, occurredAt: now },
      { workspaceId, actorId: admin.actorId, kind: "TRACE", operation: "resilience.invariants.completed", outcome: "SUCCESS", correlationId: "crm63:invariants:001", labels: { mode: "local" }, metadata: { violations: 0 }, occurredAt: now },
    ] });
    const screen = await createOperationsService({ database, authorization: createAuthorizationService({ database }), now: () => now }).getScreen(admin, { page: 1, pageSize: 10, tab: "resilience" });
    expect(screen.resilience).toMatchObject({ contractVersion: "resilience.v1", destructivePublicTests: false, externalEgress: false });
    expect(screen.resilience.latestRestore?.outcome).toBe("SUCCESS");
    expect(screen.resilience.catalog.length).toBeGreaterThanOrEqual(7);
  });
});
