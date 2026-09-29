import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createContactBackfillService } from "@/modules/contacts/application/contact-backfill-service";
import {
  createContactIdentityService,
  ensureContactForLeadInTransaction,
} from "@/modules/contacts/application/contact-identity-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for contact integration tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2045-03-12T14:00:00.000Z");

let workspaceId: string;
let workspaceSlug: string;
let admin: AuthenticatedContext;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;
let system: ServiceActorContext;

async function createHuman(roleId: string, roleKey: string, label: string): Promise<AuthenticatedContext> {
  const email = `${label}.${randomUUID()}@contact.test`;
  const user = await database.user.create({
    data: { email, normalizedEmail: email, displayName: `Pessoa ${label}` },
  });
  const member = await database.workspaceMember.create({
    data: {
      workspaceId,
      userId: user.id,
      roleId,
      status: "ACTIVE",
      joinedAt: now,
      createdByActorId: system.actorId,
      updatedByActorId: system.actorId,
    },
  });
  const actor = await database.actor.create({
    data: { workspaceId, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: user.displayName },
  });
  return {
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug,
    userId: user.id,
    memberId: member.id,
    actorId: actor.id,
    roleId,
    roleKey,
    roleName: roleKey,
    displayName: user.displayName,
  };
}

function entry(phone: string, email: string, overrides: Record<string, unknown> = {}) {
  return {
    channel: "MANUAL",
    idempotencyKey: randomUUID(),
    fullName: "Contato CRM 33",
    phone,
    email,
    jobTitle: "Gestão pública",
    sourceKey: "crm33-manual",
    rawPayload: { fixture: "crm33" },
    ...overrides,
  };
}

beforeAll(async () => {
  const workspace = await database.workspace.create({
    data: { slug: `crm33-${randomUUID().slice(0, 8)}`, name: "CRM 33 Contacts" },
  });
  workspaceId = workspace.id;
  workspaceSlug = workspace.slug;
  const systemActor = await database.actor.create({
    data: { workspaceId, type: "SYSTEM", key: "system", displayName: "Sistema CRM 33" },
  });
  system = { workspaceId, actorId: systemActor.id, actorType: "SYSTEM", actorKey: "system" };

  const permissionKeys = [
    PermissionKeys.LEADS_READ,
    PermissionKeys.LEADS_WRITE,
    PermissionKeys.CONTACTS_READ,
    PermissionKeys.CONTACTS_REVIEW,
    PermissionKeys.CONTACTS_BACKFILL,
  ] as const;
  const permissions = new Map<string, string>();
  for (const key of permissionKeys) {
    const permission = await database.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: key },
    });
    permissions.set(key, permission.id);
  }
  const roles = await Promise.all(
    ["administrator", "commercial_manager", "viewer"].map((key) =>
      database.role.create({
        data: {
          workspaceId,
          key,
          name: key,
          createdByActorId: systemActor.id,
          updatedByActorId: systemActor.id,
        },
      }),
    ),
  );
  const adminRole = roles[0]!;
  const managerRole = roles[1]!;
  const viewerRole = roles[2]!;
  admin = await createHuman(adminRole.id, adminRole.key, "admin");
  manager = await createHuman(managerRole.id, managerRole.key, "manager");
  viewer = await createHuman(viewerRole.id, viewerRole.key, "viewer");

  const grants = [
    ...permissionKeys.map((key) => ({ roleId: adminRole.id, key, scope: "WORKSPACE" as const })),
    { roleId: managerRole.id, key: PermissionKeys.LEADS_READ, scope: "TEAM" as const },
    { roleId: managerRole.id, key: PermissionKeys.LEADS_WRITE, scope: "TEAM" as const },
    { roleId: managerRole.id, key: PermissionKeys.CONTACTS_READ, scope: "TEAM" as const },
    { roleId: managerRole.id, key: PermissionKeys.CONTACTS_REVIEW, scope: "WORKSPACE" as const },
  ];
  await database.rolePermission.createMany({
    data: grants.map((grant) => ({
      workspaceId,
      roleId: grant.roleId,
      permissionId: permissions.get(grant.key)!,
      scope: grant.scope,
      createdByActorId: systemActor.id,
    })),
  });

  const team = await database.team.create({
    data: { workspaceId, name: "Pré-vendas CRM 33", createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
  });
  await database.teamMember.create({
    data: {
      workspaceId,
      teamId: team.id,
      workspaceMemberId: manager.memberId,
      function: "MANAGER",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  await database.queue.create({
    data: { workspaceId, teamId: team.id, key: "general", name: "Fila Geral", isGeneral: true, createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
  });
  await database.leadSource.create({
    data: { workspaceId, key: "crm33-manual", name: "CRM 33 manual", type: "MANUAL", createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
  });
  const pipeline = await database.pipeline.create({
    data: { workspaceId, name: "Pré-vendas CRM 33", entityType: "LEAD", isDefault: true, createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
  });
  await database.pipelineStage.create({
    data: { workspaceId, pipelineId: pipeline.id, name: "Novo", position: 0, type: "OPEN", createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
  });
  const sla = await database.slaPolicy.create({
    data: { workspaceId, key: "p3", name: "SLA imediato — 0 minutos", firstResponseMinutes: 0, warningMinutesBeforeDue: 0, healthyMaxSeconds: 60, attentionMaxSeconds: 180, createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
  });
  await database.leadPriorityBand.create({
    data: { workspaceId, slaPolicyId: sla.id, code: "P3", name: "P3", position: 3, scoreMin: 0, scoreMax: 100, leadPriority: "MEDIUM", createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
  });
});

afterAll(async () => database.$disconnect());

function intakeService() {
  return createLeadIntakeService({ database, authorization, now: () => now });
}

describe("Contact e ContactPoint canônicos", () => {
  it("faz dual write atômico, mantém dois contatos e abre review para e-mail compartilhado", async () => {
    const first = await intakeService().intake(entry("11 98880-1001", "shared@crm33.test", { doNotContact: true }), system);
    const second = await intakeService().intake(entry("11 98880-1002", "shared@crm33.test", { fullName: "Outro contato CRM 33" }), system);
    if (first.outcome === "REJECTED" || second.outcome === "REJECTED") throw new Error("entrada rejeitada");

    const leads = await database.lead.findMany({
      where: { id: { in: [first.leadId, second.leadId] } },
      include: { contact: { include: { points: true } } },
      orderBy: { id: "asc" },
    });
    expect(leads).toHaveLength(2);
    expect(new Set(leads.map((lead) => lead.contactId)).size).toBe(2);
    expect(leads.every((lead) => lead.contact?.points.length === 2)).toBe(true);
    expect(
      await database.contactIdentityReview.findFirst({
        where: { workspaceId, reason: "SHARED_EMAIL", status: "OPEN" },
      }),
    ).toMatchObject({ candidateContactId: expect.any(String) });
    expect(
      await database.contactPoint.findFirstOrThrow({
        where: { contactId: leads.find((lead) => lead.id === first.leadId)!.contactId!, type: "PHONE" },
      }),
    ).toMatchObject({ doNotContact: true });
    expect(await database.auditLog.count({ where: { workspaceId, action: "contact.created_from_lead" } })).toBeGreaterThanOrEqual(2);
  });

  it("executa dry-run, rollback, pausa, retomada concorrente e replay idempotente", async () => {
    const first = await intakeService().intake(entry("11 98880-2001", "backfill-a@crm33.test"), system);
    const second = await intakeService().intake(entry("11 98880-2002", "backfill-b@crm33.test"), system);
    if (first.outcome === "REJECTED" || second.outcome === "REJECTED") throw new Error("entrada rejeitada");
    const leads = await database.lead.findMany({
      where: { id: { in: [first.leadId, second.leadId] } },
      select: { id: true, contactId: true },
    });
    const leadIds = leads.map((lead) => lead.id);
    const oldContactIds = leads.map((lead) => lead.contactId!);
    await database.$transaction([
      database.leadFormSubmission.updateMany({ where: { leadId: { in: leadIds } }, data: { contactId: null } }),
      database.lead.updateMany({ where: { id: { in: leadIds } }, data: { contactId: null, updatedByActorId: system.actorId } }),
      database.contactPoint.updateMany({ where: { contactId: { in: oldContactIds } }, data: { deletedAt: now, updatedByActorId: system.actorId } }),
      database.contact.updateMany({ where: { id: { in: oldContactIds } }, data: { status: "INACTIVE", deletedAt: now, updatedByActorId: system.actorId } }),
    ]);

    const backfill = createContactBackfillService({ database, authorization, now: () => now });
    const contactsBefore = await database.contact.count({ where: { workspaceId } });
    const dryRun = await backfill.start(admin, { mode: "DRY_RUN", batchSize: 10 });
    const dryResult = await backfill.processBatch(admin, { runId: dryRun.id });
    expect(dryResult).toMatchObject({ status: "SUCCEEDED", contactsCreated: 0, leadsLinked: 0 });
    expect(await database.lead.count({ where: { id: { in: leadIds }, contactId: null } })).toBe(2);
    expect(await database.contact.count({ where: { workspaceId } })).toBe(contactsBefore);

    const execution = await backfill.start(admin, { mode: "EXECUTE", batchSize: 1 });
    await expect(backfill.pause(admin, { runId: execution.id })).resolves.toMatchObject({ status: "PAUSED" });
    await expect(backfill.processBatch(admin, { runId: execution.id })).rejects.toMatchObject({ code: "BACKFILL_PAUSED" });

    const failingBackfill = createContactBackfillService({
      database,
      authorization,
      now: () => now,
      ensureContact: async (transaction, input) => {
        await ensureContactForLeadInTransaction(transaction, input);
        throw new Error("CRM33_ROLLBACK_TEST");
      },
    });
    await failingBackfill.resume(admin, { runId: execution.id });
    await expect(failingBackfill.processBatch(admin, { runId: execution.id })).rejects.toThrow("CRM33_ROLLBACK_TEST");
    await expect(backfill.getRun(admin, { runId: execution.id })).resolves.toMatchObject({
      status: "FAILED",
      failedCount: 1,
      processedCount: 0,
      contactsCreated: 0,
    });
    expect(await database.lead.count({ where: { id: { in: leadIds }, contactId: null } })).toBe(2);
    expect(await database.contact.count({ where: { workspaceId } })).toBe(contactsBefore);

    await expect(backfill.resume(admin, { runId: execution.id })).resolves.toMatchObject({ status: "RUNNING" });
    await Promise.all([
      backfill.processBatch(admin, { runId: execution.id }),
      backfill.processBatch(admin, { runId: execution.id }),
    ]);
    const finished = await backfill.getRun(admin, { runId: execution.id });
    expect(finished).toMatchObject({ status: "SUCCEEDED", processedCount: 2, contactsCreated: 2, leadsLinked: 2 });
    const replay = await backfill.processBatch(admin, { runId: execution.id });
    expect(replay).toEqual(finished);
    expect(await database.lead.count({ where: { id: { in: leadIds }, contactId: { not: null } } })).toBe(2);
    await expect(backfill.start(manager, { mode: "EXECUTE", batchSize: 10 })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("permite decisão humana auditada e impede perfil sem permissão", async () => {
    await intakeService().intake(entry("11 98880-3001", "review@crm33.test"), system);
    const second = await intakeService().intake(entry("11 98880-3002", "review@crm33.test"), system);
    if (second.outcome === "REJECTED") throw new Error("entrada rejeitada");
    const review = await database.contactIdentityReview.findFirstOrThrow({
      where: { workspaceId, leadId: second.leadId, reason: "SHARED_EMAIL", status: "OPEN" },
    });
    const identity = createContactIdentityService({ database, authorization, now: () => now });
    await expect(
      identity.resolveReview(viewer, { reviewId: review.id, decision: "KEEP_SEPARATE", reason: "Contatos distintos." }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(
      identity.resolveReview(manager, { reviewId: review.id, decision: "KEEP_SEPARATE", reason: "Telefones e pessoas distintos." }),
    ).resolves.toMatchObject({ status: "RESOLVED" });
    expect(
      await database.auditLog.findFirst({ where: { workspaceId, entityId: review.id, action: "contact.identity_review.resolved" } }),
    ).not.toBeNull();
  });

  it("impõe unicidade no mesmo contato e permite ponto compartilhado entre contatos", async () => {
    const first = await intakeService().intake(entry("11 98880-4001", "constraint-a@crm33.test"), system);
    const second = await intakeService().intake(entry("11 98880-4002", "constraint-b@crm33.test"), system);
    if (first.outcome === "REJECTED" || second.outcome === "REJECTED") throw new Error("entrada rejeitada");
    const [contactA, contactB] = await Promise.all([
      database.lead.findUniqueOrThrow({ where: { id: first.leadId }, select: { contactId: true } }),
      database.lead.findUniqueOrThrow({ where: { id: second.leadId }, select: { contactId: true } }),
    ]);
    await expect(
      database.contactPoint.create({
        data: {
          workspaceId,
          contactId: contactA.contactId!,
          type: "EMAIL",
          originalValue: "constraint-a@crm33.test",
          normalizedValue: "constraint-a@crm33.test",
          source: "MANUAL",
          createdByActorId: admin.actorId,
          updatedByActorId: admin.actorId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.contactPoint.create({
        data: {
          workspaceId,
          contactId: contactA.contactId!,
          type: "EMAIL",
          originalValue: "outro-primary@crm33.test",
          normalizedValue: "outro-primary@crm33.test",
          source: "MANUAL",
          isPrimary: true,
          createdByActorId: admin.actorId,
          updatedByActorId: admin.actorId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.contactPoint.create({
        data: {
          workspaceId,
          contactId: contactB.contactId!,
          type: "EMAIL",
          originalValue: "constraint-a@crm33.test",
          normalizedValue: "constraint-a@crm33.test",
          source: "MANUAL",
          createdByActorId: admin.actorId,
          updatedByActorId: admin.actorId,
        },
      }),
    ).resolves.toMatchObject({ contactId: contactB.contactId });
  });
});
