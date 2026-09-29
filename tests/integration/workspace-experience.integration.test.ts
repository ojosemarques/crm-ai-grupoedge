import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createWorkspaceExperienceService } from "@/modules/workspace-experience/application/workspace-experience-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-58 integration tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-58 requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 8 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2058-05-08T13:00:00.000Z");
const service = createWorkspaceExperienceService({ database, authorization, now: () => now });
let workspaceId: string;
let admin: AuthenticatedContext;
let sdr: AuthenticatedContext;
let ownedContactId: string;
let unownedContactId: string;
let outsideAccountId: string;

async function context(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [admin, sdr] = await Promise.all([context("admin@demo.politizai.local"), context("sdr1@demo.politizai.local")]);

  const owned = await database.contact.create({ data: { workspaceId, preferredName: "Pessoa CRM58 Própria", jobTitle: "Diretora fictícia", origin: "MANUAL", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  const unowned = await database.contact.create({ data: { workspaceId, preferredName: "Pessoa CRM58 Sem Escopo", jobTitle: "Conselheira fictícia", origin: "MANUAL", quality: "CONFIRMED", createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  ownedContactId = owned.id;
  unownedContactId = unowned.id;
  await database.contactPoint.create({ data: { workspaceId, contactId: owned.id, type: "EMAIL", originalValue: "pessoa.crm58@example.test", normalizedValue: "pessoa.crm58@example.test", isPrimary: true, verificationStatus: "VERIFIED", quality: "VALID", source: "MANUAL", verifiedAt: now, createdByActorId: admin.actorId, updatedByActorId: admin.actorId } });
  await database.ownershipAssignment.create({ data: { workspaceId, entityType: "CONTACT", contactId: owned.id, function: "SDR", memberId: sdr.memberId, validFrom: now, reason: "Fixture CRM-58 de ownership próprio.", source: "SEED", idempotencyKey: "crm58:contact:owned", assignedByActorId: admin.actorId } });

  const outside = await database.workspace.create({ data: { slug: `crm58-outside-${randomUUID().slice(0, 8)}`, name: "Workspace externo CRM-58" } });
  const outsideActor = await database.actor.create({ data: { workspaceId: outside.id, type: "SYSTEM", key: "system", displayName: "Sistema externo CRM-58" } });
  outsideAccountId = (await database.account.create({ data: { workspaceId: outside.id, name: "Pessoa CRM58 Externa", normalizedName: "pessoa crm58 externa", origin: "SEED", createdByActorId: outsideActor.id, updatedByActorId: outsideActor.id } })).id;
});

afterAll(async () => database.$disconnect());

describe("CRM-58 home por função, busca global e Contact 360", () => {
  it("seleciona a home pelo papel e expõe somente visões autorizadas", async () => {
    const sdrHome = await service.getHome(sdr);
    expect(sdrHome).toMatchObject({ activeView: "SDR", scope: "OWN", timeZone: "America/Sao_Paulo" });
    expect(sdrHome.availableViews).toContain("SDR");
    expect(sdrHome.availableViews).not.toContain("ADMIN");

    const adminHome = await service.getHome(admin);
    expect(adminHome.activeView).toBe("ADMIN");
    expect(adminHome.availableViews).toEqual(expect.arrayContaining(["SDR", "CLOSER", "FARMER", "CUSTOMER_SUCCESS", "MANAGER", "ADMIN"]));
    for (const view of adminHome.availableViews) {
      const selected = await service.getHome(admin, { view });
      expect(selected.activeView).toBe(view);
      expect(selected.primaryAction === null || selected.primaryAction.cta.length > 0).toBe(true);
    }
  });

  it("aplica OWN antes da serialização, mascara contato e isola o workspace", async () => {
    const ownSearch = await service.search(sdr, { q: "Pessoa CRM58", page: 1, pageSize: 20 });
    const ownItems = ownSearch.groups.flatMap((group) => group.items);
    expect(ownItems.map((item) => item.id)).toContain(ownedContactId);
    expect(ownItems.map((item) => item.id)).not.toContain(unownedContactId);
    expect(ownItems.find((item) => item.id === ownedContactId)?.hint).toBe("p•••@example.test");

    const workspaceSearch = await service.search(admin, { q: "Pessoa CRM58", page: 1, pageSize: 20 });
    const workspaceItems = workspaceSearch.groups.flatMap((group) => group.items);
    expect(workspaceItems.map((item) => item.id)).toEqual(expect.arrayContaining([ownedContactId, unownedContactId]));
    expect(workspaceItems.map((item) => item.id)).not.toContain(outsideAccountId);
  });

  it("entrega Contact 360 paginado sem expor o ponto de contato bruto", async () => {
    const contact = await service.getContact360(sdr, ownedContactId, { page: 1, pageSize: 10 });
    expect(contact.preferredName).toBe("Pessoa CRM58 Própria");
    expect(contact.points).toEqual([expect.objectContaining({ maskedValue: "p•••@example.test", verification: "VERIFIED" })]);
    expect(JSON.stringify(contact)).not.toContain("pessoa.crm58@example.test");

    await expect(service.getContact360(sdr, unownedContactId)).rejects.toThrow();
  });
});
