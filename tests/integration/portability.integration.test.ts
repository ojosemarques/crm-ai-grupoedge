import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createPortabilityService } from "@/modules/portability/application/portability-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for portability integration tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 6 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2048-04-10T12:00:00.000Z");

let context: AuthenticatedContext;
let workspaceId: string;
let contactId: string;
let foreignContactId: string;

const service = () => createPortabilityService({ database, authorization, now: () => now });

beforeAll(async () => {
  const workspace = await database.workspace.create({
    data: { slug: `portability-${randomUUID().slice(0, 8)}`, name: "Portabilidade" },
  });
  workspaceId = workspace.id;
  const system = await database.actor.create({
    data: { workspaceId, type: "SYSTEM", key: "system", displayName: "Sistema" },
  });
  const role = await database.role.create({
    data: { workspaceId, key: "administrator", name: "Administrador", createdByActorId: system.id, updatedByActorId: system.id },
  });
  const email = `portability-${randomUUID()}@test.local`;
  const user = await database.user.create({ data: { email, normalizedEmail: email, displayName: "Admin" } });
  const member = await database.workspaceMember.create({
    data: { workspaceId, userId: user.id, roleId: role.id, status: "ACTIVE", joinedAt: now, createdByActorId: system.id, updatedByActorId: system.id },
  });
  const actor = await database.actor.create({
    data: { workspaceId, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: "Admin" },
  });
  context = {
    sessionId: randomUUID(), workspaceId, workspaceSlug: workspace.slug, userId: user.id,
    memberId: member.id, actorId: actor.id, roleId: role.id, roleKey: role.key,
    roleName: role.name, displayName: "Admin",
  };

  for (const key of [
    PermissionKeys.PORTABILITY_READ,
    PermissionKeys.PORTABILITY_EXPORT,
    PermissionKeys.PORTABILITY_MANAGE,
    PermissionKeys.BULK_ACTIONS_EXECUTE,
    PermissionKeys.EXPORTS_EXECUTE,
  ]) {
    const permission = await database.permission.upsert({ where: { key }, update: {}, create: { key, description: key } });
    await database.rolePermission.create({
      data: { workspaceId, roleId: role.id, permissionId: permission.id, scope: "WORKSPACE", createdByActorId: system.id },
    });
  }

  contactId = (await database.contact.create({
    data: { workspaceId, preferredName: "=Contato seguro", origin: "MANUAL", createdByActorId: actor.id, updatedByActorId: actor.id },
  })).id;

  const foreign = await database.workspace.create({
    data: { slug: `portability-other-${randomUUID().slice(0, 8)}`, name: "Outro workspace" },
  });
  const foreignActor = await database.actor.create({
    data: { workspaceId: foreign.id, type: "SYSTEM", key: "system", displayName: "Outro sistema" },
  });
  foreignContactId = (await database.contact.create({
    data: { workspaceId: foreign.id, preferredName: "Contato externo", origin: "MANUAL", createdByActorId: foreignActor.id, updatedByActorId: foreignActor.id },
  })).id;
});

afterAll(async () => database.$disconnect());

describe("portabilidade comercial governada", () => {
  it("exporta somente o workspace autorizado, neutraliza fórmula e audita", async () => {
    const result = await service().exportCsv(context, { kind: "CONTACTS", reason: "Roundtrip autorizado" });
    expect(result.count).toBe(1);
    expect(result.content).toContain("'=Contato seguro");
    expect(result.content).not.toContain("Contato externo");
    await expect(database.auditLog.count({ where: { workspaceId, action: "portability.export.generated" } })).resolves.toBe(1);
  });

  it("faz dry-run sem alterar alvo, executa com fingerprint e rejeita outro workspace", async () => {
    const field = await service().createField(context, {
      entityType: "CONTACT", key: "perfil_eleitoral", name: "Perfil eleitoral", dataType: "TEXT", required: false,
    });
    const preview = await service().previewBulk(context, {
      entityType: "CONTACT", action: "SET_CUSTOM_FIELD", entityIds: [contactId],
      payload: { definitionId: field.id, value: "institucional" }, reason: "Classificação revisada",
    });
    expect(await database.customFieldValue.count({ where: { workspaceId, entityId: contactId } })).toBe(0);
    expect(await database.auditLog.count({ where: { workspaceId, action: "portability.bulk.previewed" } })).toBe(1);

    await expect(service().previewBulk(context, {
      entityType: "CONTACT", action: "SET_CUSTOM_FIELD", entityIds: [foreignContactId],
      payload: { definitionId: field.id, value: "indevido" }, reason: "Teste de isolamento",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    await service().executeBulk(context, { operationId: preview.operationId, fingerprint: preview.fingerprint, confirmed: true });
    await expect(database.customFieldValue.findFirstOrThrow({ where: { workspaceId, entityId: contactId } })).resolves.toMatchObject({ value: "institucional" });
    await expect(service().executeBulk(context, { operationId: preview.operationId, fingerprint: preview.fingerprint, confirmed: true })).rejects.toMatchObject({ code: "BULK_PREVIEW_STALE" });
    await expect(database.portabilityBulkOperationItem.findFirstOrThrow({ where: { workspaceId, entityId: contactId } })).resolves.toMatchObject({ status: "CHANGED" });
  });
});
