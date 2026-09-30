import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService } from "@/modules/finance/application/finance-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for finance integration tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Finance tests require an ephemeral schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 8 }) });
const service = createFinanceService({ database, authorization: createAuthorizationService({ database }), now: () => new Date("2026-09-30T15:00:00.000Z") });
let workspaceId: string;
let admin: AuthenticatedContext;
let sdr: AuthenticatedContext;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, sdr] = await Promise.all([context("admin@demo.politizai.local"), context("sdr1@demo.politizai.local")]);
});
afterAll(async () => database.$disconnect());

describe("financeiro integrado", () => {
  it("cria conta, categoria e despesa, liquida e projeta caixa/DRE", async () => {
    const account = await service.command(admin, { action: "CREATE_ACCOUNT", name: "Banco principal", type: "BANK", openingBalanceCents: "100000" }) as { id: string };
    const category = await service.command(admin, { action: "CREATE_CATEGORY", key: "operacional", name: "Despesa operacional", kind: "EXPENSE", dreGroup: "OPERATING_EXPENSE" }) as { id: string };
    const entry = await service.command(admin, { action: "CREATE_ENTRY", categoryId: category.id, financialAccountId: account.id, customerAccountId: null, direction: "EXPENSE", status: "PLANNED", description: "Licença mensal do CRM", counterparty: "Fornecedor", amountCents: "15000", competenceAt: "2026-09-20T12:00:00.000Z", dueAt: "2026-09-25T12:00:00.000Z", settledAt: null, idempotencyKey: "finance:test:expense:001" }) as { id: string };
    const replay = await service.command(admin, { action: "CREATE_ENTRY", categoryId: category.id, financialAccountId: account.id, customerAccountId: null, direction: "EXPENSE", status: "PLANNED", description: "Licença mensal do CRM", counterparty: "Fornecedor", amountCents: "15000", competenceAt: "2026-09-20T12:00:00.000Z", dueAt: "2026-09-25T12:00:00.000Z", settledAt: null, idempotencyKey: "finance:test:expense:001" }) as { id: string };
    expect(replay.id).toBe(entry.id);

    await service.command(admin, { action: "SETTLE_ENTRY", entryId: entry.id, status: "SETTLED", settledAt: "2026-09-25T12:00:00.000Z", expectedRevision: 1 });
    const screen = await service.screen(admin, { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
    expect(screen.metrics).toMatchObject({ expenseCents: "15000", cashBalanceCents: "85000", netIncomeCents: "-15000" });
    expect(screen.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: entry.id, status: "SETTLED", direction: "EXPENSE" })]));
  });

  it("nega SDR por padrão e isola workspace adulterado", async () => {
    await expect(service.screen(sdr, {})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(service.screen({ ...admin, workspaceId: randomUUID() }, {})).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  });
});
