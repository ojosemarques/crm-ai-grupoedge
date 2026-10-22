import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for realtime dashboard schema tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 6 }) });

async function createTenant(label: string) {
  const workspace = await database.workspace.create({
    data: { slug: `realtime-${label}-${randomUUID().slice(0, 8)}`, name: `Realtime ${label}` },
  });
  const actor = await database.actor.create({
    data: { workspaceId: workspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" },
  });
  return { workspaceId: workspace.id, actorId: actor.id };
}

let tenantA: Awaited<ReturnType<typeof createTenant>>;
let tenantB: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  [tenantA, tenantB] = await Promise.all([createTenant("a"), createTenant("b")]);
});

afterAll(() => database.$disconnect());

describe("schema do dashboard tempo real", () => {
  it("mantém um share por workspace e hash globalmente único", async () => {
    const firstHash = "a".repeat(64);
    await database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantA.workspaceId,
        tokenHash: firstHash,
        createdByActorId: tenantA.actorId,
        updatedByActorId: tenantA.actorId,
      },
    });
    await expect(database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantA.workspaceId,
        tokenHash: "b".repeat(64),
        createdByActorId: tenantA.actorId,
        updatedByActorId: tenantA.actorId,
      },
    })).rejects.toThrow();
    await expect(database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantB.workspaceId,
        tokenHash: firstHash,
        createdByActorId: tenantB.actorId,
        updatedByActorId: tenantB.actorId,
      },
    })).rejects.toThrow();
  });

  it("rejeita ator de outro tenant e hash fora do contrato", async () => {
    await expect(database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantB.workspaceId,
        tokenHash: "c".repeat(64),
        createdByActorId: tenantA.actorId,
        updatedByActorId: tenantA.actorId,
      },
    })).rejects.toThrow();
    await expect(database.realtimeDashboardShare.create({
      data: {
        workspaceId: tenantB.workspaceId,
        tokenHash: "hash-invalido",
        createdByActorId: tenantB.actorId,
        updatedByActorId: tenantB.actorId,
      },
    })).rejects.toThrow();
  });
});
