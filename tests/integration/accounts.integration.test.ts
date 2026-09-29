import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for account integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 4 }) });
let workspaceId: string;
let otherWorkspaceId: string;
let actorId: string;

beforeAll(async () => {
  const workspace = await database.workspace.create({ data: { slug: `crm34-${randomUUID().slice(0, 8)}`, name: "CRM 34 Accounts" } });
  const other = await database.workspace.create({ data: { slug: `crm34-other-${randomUUID().slice(0, 8)}`, name: "CRM 34 Other" } });
  workspaceId = workspace.id;
  otherWorkspaceId = other.id;
  actorId = (await database.actor.create({ data: { workspaceId, type: "SYSTEM", key: "system", displayName: "Sistema CRM 34" } })).id;
  await database.actor.create({ data: { workspaceId: otherWorkspaceId, type: "SYSTEM", key: "system", displayName: "Outro sistema" } });
});

afterAll(async () => database.$disconnect());

describe("modelo relacional de contas", () => {
  it("impede documento ativo duplicado e hierarquia cruzada entre workspaces", async () => {
    const first = await database.account.create({ data: { workspaceId, name: "Conta A", normalizedName: "conta a", normalizedDocument: "123", origin: "MANUAL", createdByActorId: actorId, updatedByActorId: actorId } });
    await expect(database.account.create({ data: { workspaceId, name: "Conta B", normalizedName: "conta b", normalizedDocument: "123", origin: "MANUAL", createdByActorId: actorId, updatedByActorId: actorId } })).rejects.toThrow();
    const otherActor = await database.actor.findFirstOrThrow({ where: { workspaceId: otherWorkspaceId, type: "SYSTEM" } });
    await expect(database.account.create({ data: { workspaceId: otherWorkspaceId, name: "Conta C", normalizedName: "conta c", parentAccountId: first.id, origin: "MANUAL", createdByActorId: otherActor.id, updatedByActorId: otherActor.id } })).rejects.toThrow();
  });

  it("impede uma conta como pai de si mesma", async () => {
    const accountId = randomUUID();
    await expect(database.account.create({ data: { id: accountId, workspaceId, name: "Ciclo", normalizedName: "ciclo", parentAccountId: accountId, origin: "MANUAL", createdByActorId: actorId, updatedByActorId: actorId } })).rejects.toThrow();
  });

  it("impede papel ativo duplicado para a mesma pessoa, conta e função", async () => {
    const account = await database.account.create({ data: { workspaceId, name: `Papéis ${randomUUID()}`, normalizedName: randomUUID(), origin: "MANUAL", createdByActorId: actorId, updatedByActorId: actorId } });
    const contact = await database.contact.create({ data: { workspaceId, preferredName: "Contato CRM 34", origin: "MANUAL", createdByActorId: actorId, updatedByActorId: actorId } });
    const data = { workspaceId, accountId: account.id, contactId: contact.id, roleType: "DECISION_MAKER" as const, influence: "HIGH" as const, authority: "FINAL_DECISION" as const, source: "MANUAL" as const, validFrom: new Date(), createdByActorId: actorId };
    const results = await Promise.allSettled([database.accountContactRole.create({ data }), database.accountContactRole.create({ data })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
