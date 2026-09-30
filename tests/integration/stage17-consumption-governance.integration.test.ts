import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createConsumptionGovernanceService } from "@/modules/consumption/application/consumption-governance-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for stage 17 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage 17 requires an ephemeral test schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const clock = new Date("2050-10-15T12:00:00.000Z");
const service = createConsumptionGovernanceService({ database, authorization: createAuthorizationService({ database }), now: () => clock });
let workspaceId: string;
let admin: AuthenticatedContext;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true, workspace: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  admin = await context("admin@demo.politizai.local");
  for (const [resourceType, resourceKey] of [["AI", "ai"], ["VOICE", "outbound:voice"], ["PROVIDER", "outbound:whatsapp"]] as const) {
    await service.configure(admin, {
      resourceType, resourceKey, limitUnits: 1, periodStart: "2050-10-01T00:00:00.000Z", periodEnd: "2050-11-01T00:00:00.000Z",
      warningBasisPoints: 8_000, reason: `Teto controlado para ${resourceKey}.`,
    });
  }
});

afterAll(async () => database.$disconnect());

describe("etapa 17 — consumo isolado por recurso", () => {
  it("pausa IA excedida sem pausar voz ou provedor e mantém replay idempotente", async () => {
    const principal = { workspaceId, actorId: admin.actorId };
    await expect(service.record(principal, { resourceType: "AI", resourceKey: "ai", units: 1, idempotencyKey: "stage17:isolated:ai:first" })).resolves.toMatchObject({ allowed: true, code: "ALLOWED" });
    const blocked = await service.record(principal, { resourceType: "AI", resourceKey: "ai", units: 1, idempotencyKey: "stage17:isolated:ai:blocked" });
    expect(blocked).toMatchObject({ allowed: false, code: "UNIT_LIMIT_EXCEEDED" });
    await expect(service.record(principal, { resourceType: "AI", resourceKey: "ai", units: 1, idempotencyKey: "stage17:isolated:ai:blocked" })).resolves.toMatchObject({ allowed: false, idempotent: true });

    const overview = await service.getOverview(admin);
    expect(overview.find((item) => item.resourceType === "AI")).toMatchObject({ status: "PAUSED", pausedReason: "UNIT_LIMIT_EXCEEDED" });
    expect(overview.find((item) => item.resourceType === "VOICE")).toMatchObject({ status: "ACTIVE" });
    expect(overview.find((item) => item.resourceType === "PROVIDER")).toMatchObject({ status: "ACTIVE" });
    await expect(service.record(principal, { resourceType: "VOICE", resourceKey: "outbound:voice", units: 1, idempotencyKey: "stage17:voice:first" })).resolves.toMatchObject({ allowed: true });
    await expect(service.record(principal, { resourceType: "PROVIDER", resourceKey: "outbound:whatsapp", units: 1, idempotencyKey: "stage17:provider:first" })).resolves.toMatchObject({ allowed: true });
  });

  it("concede crédito, registra revogação auditável e impede mutação do ledger", async () => {
    const voice = await database.consumptionBudget.findFirstOrThrow({ where: { workspaceId, resourceType: "VOICE" } });
    const credit = await service.grantCredit(admin, { budgetId: voice.id, amountCents: 500, idempotencyKey: "stage17:voice:credit", reason: "Crédito aprovado pelo administrador." });
    await expect(service.grantCredit(admin, { budgetId: voice.id, amountCents: 500, idempotencyKey: "stage17:voice:credit", reason: "Crédito aprovado pelo administrador." })).resolves.toMatchObject({ ledgerEntryId: credit.ledgerEntryId, idempotent: true });
    await service.setStatus(admin, voice.id, "REVOKED", "Fornecedor de voz revogado.");
    await expect(service.assertCanConsume({ workspaceId, actorId: admin.actorId }, "VOICE", "outbound:voice", 0n, 1n)).resolves.toMatchObject({ allowed: false, code: "BUDGET_REVOKED" });
    await expect(database.consumptionLedgerEntry.update({ where: { id: credit.ledgerEntryId }, data: { amountCents: 1n } })).rejects.toThrow(/append-only/);
    expect(await database.auditLog.count({ where: { workspaceId, action: { in: ["consumption.budget.auto_paused", "consumption.credit.granted", "consumption.budget.revoked"] } } })).toBe(3);
  });
});
