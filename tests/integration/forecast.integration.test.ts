import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createForecastBackfillService } from "@/modules/forecast/application/forecast-backfill-service";
import { createForecastService } from "@/modules/forecast/application/forecast-service";
import { seedCrm29DemoData } from "@/modules/settings/application/crm29-demo-data-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { seedForecastDemoData } from "@/modules/settings/application/forecast-demo-seed-service";
import { seedGoalDemoData } from "@/modules/settings/application/goal-demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-56 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) {
  throw new Error("CRM-56 requires an ephemeral politizai_test_* schema.");
}

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2026-09-13T16:00:00.000Z");
const service = createForecastService({ database, authorization, now: () => clock });
const backfill = createForecastBackfillService({ database, authorization, now: () => clock });

let workspaceId: string;
let cycleId: string;
let teamId: string;
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let closer: AuthenticatedContext;
let viewer: AuthenticatedContext;

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
  await seedGoalDemoData(database);
  await seedForecastDemoData(database);
  [admin, manager, closer, viewer] = await Promise.all([
    context("admin@demo.politizai.local"),
    context("gestor@demo.politizai.local"),
    context("closer1@demo.politizai.local"),
    context("viewer@demo.politizai.local"),
  ]);
  const cycle = await database.forecastCycle.findFirstOrThrow({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  cycleId = cycle.id;
  teamId = cycle.teamId!;
});

afterAll(async () => database.$disconnect());

describe("CRM-56 forecast e snapshots", () => {
  it("mantém seed idempotente, dois cortes reproduzíveis e movimentos explicáveis", async () => {
    const firstCounts = await seedForecastDemoData(database);
    const secondCounts = await seedForecastDemoData(database);
    expect(secondCounts).toEqual(firstCounts);
    expect(await database.forecastCycle.count({ where: { workspaceId } })).toBe(1);
    expect(await database.forecastSubmission.count({ where: { workspaceId } })).toBe(3);
    expect(await database.forecastSnapshot.count({ where: { workspaceId } })).toBe(2);
    expect(await database.forecastSnapshotItem.count({ where: { workspaceId } })).toBe(5);

    const screen = await service.screen(manager, {});
    expect(screen.snapshots).toHaveLength(2);
    expect(screen.snapshots[0]!.fingerprint).not.toBe(screen.snapshots[1]!.fingerprint);
    expect(screen.comparison?.movements.map((item) => item.type)).toEqual(expect.arrayContaining(["PIPELINE_ENTERED", "CATEGORY_ADVANCED", "VALUE_INCREASED"]));
    expect(screen.current?.managerOverrideCents).not.toBeNull();
    expect(screen.current?.bottomUpCommitCents).not.toBe(screen.current?.managerOverrideCents);
  });

  it("registra revisão individual sob idempotência e preserva o fato append-only", async () => {
    const screen = await service.screen(closer, {});
    const opportunity = screen.candidates.find((item) => item.eligible && item.ownerMemberId === closer.memberId);
    expect(opportunity).toBeDefined();
    const input = {
      cycleId, category: "PIPELINE" as const, declaredValueCents: opportunity!.amountCents,
      opportunityIds: [opportunity!.opportunityId], targetMemberId: closer.memberId,
      type: "INDIVIDUAL" as const, asOf: clock, idempotencyKey: "crm56:test:submission:001",
    };
    const [created, replay] = await Promise.all([service.submit(closer, input), service.submit(closer, input)]);
    expect(replay.id).toBe(created.id);
    expect(await database.forecastSubmission.count({ where: { workspaceId, idempotencyKey: input.idempotencyKey } })).toBe(1);
    const revised = await service.submit(closer, { ...input, correctionReason: "Categoria revisada após conversa.", declaredValueCents: "123450", idempotencyKey: "crm56:test:submission:002" });
    expect(revised).toMatchObject({ version: 2, supersedesSubmissionId: created.id });
    await expect(database.forecastSubmission.update({ where: { id: created.id }, data: { comment: "reescrita proibida" } })).rejects.toThrow(/append-only/);
  });

  it("publica uma vez sob concorrência e congela o snapshot contra mudanças futuras", async () => {
    const input = { cycleId, asOf: clock, idempotencyKey: "crm56:test:snapshot:001" };
    const [created, replay] = await Promise.all([service.consolidate(manager, input), service.consolidate(manager, input)]);
    expect(replay.id).toBe(created.id);
    expect(await database.forecastSnapshot.count({ where: { workspaceId, idempotencyKey: input.idempotencyKey } })).toBe(1);
    const frozenItem = created.items.find((item) => item.eligible)!;
    const before = frozenItem.amountCents;
    await database.opportunity.update({ where: { id: frozenItem.opportunityId }, data: { amountCents: before + 10_000n } });
    expect((await database.forecastSnapshotItem.findUniqueOrThrow({ where: { id: frozenItem.id } })).amountCents).toBe(before);
    await expect(database.forecastSnapshot.update({ where: { id: created.id }, data: { commitCents: created.commitCents + 1n } })).rejects.toThrow(/append-only/);
  });

  it("mantém override separado do bottom-up e aplica RBAC/workspace no servidor", async () => {
    const override = await service.submit(manager, {
      cycleId, category: "COMMIT", declaredValueCents: "999900", opportunityIds: [],
      targetTeamId: teamId, type: "MANAGER_OVERRIDE", correctionReason: "Revisão gerencial baseada no comitê.",
      comment: "Valor gerencial não substitui as submissões individuais.", asOf: clock,
      idempotencyKey: "crm56:test:override:001",
    });
    expect(override.type).toBe("MANAGER_OVERRIDE");
    expect(await database.forecastSubmission.count({ where: { workspaceId, cycleId, type: "INDIVIDUAL" } })).toBeGreaterThan(0);
    await expect(service.submit(viewer, {
      cycleId, category: "PIPELINE", declaredValueCents: "0", opportunityIds: [],
      type: "INDIVIDUAL", asOf: clock, idempotencyKey: "crm56:test:viewer:denied",
    })).rejects.toThrow();
    await expect(service.screen({ ...admin, workspaceId: randomUUID() }, {})).rejects.toThrow();
  });

  it("backfill é conservador, repetível e nunca fabrica forecast histórico", async () => {
    const before = {
      cycles: await database.forecastCycle.count({ where: { workspaceId } }),
      submissions: await database.forecastSubmission.count({ where: { workspaceId } }),
      snapshots: await database.forecastSnapshot.count({ where: { workspaceId } }),
    };
    const dry = await backfill.run(admin, { mode: "DRY_RUN", runKey: "crm56:test:backfill:dry" });
    expect(dry).toMatchObject({ replay: false, reviewCount: 0 });
    const executed = await backfill.run(admin, { mode: "EXECUTE", runKey: "crm56:test:backfill:execute" });
    const replay = await backfill.run(admin, { mode: "EXECUTE", runKey: "crm56:test:backfill:execute" });
    expect(replay).toMatchObject({ replay: true, id: executed.id });
    expect({
      cycles: await database.forecastCycle.count({ where: { workspaceId } }),
      submissions: await database.forecastSubmission.count({ where: { workspaceId } }),
      snapshots: await database.forecastSnapshot.count({ where: { workspaceId } }),
    }).toEqual(before);
  });
});
