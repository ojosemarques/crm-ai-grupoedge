import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createFreeQualificationService } from "@/modules/qualification/application/free-qualification-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for free qualification tests.");

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 12 }),
});
const authorization = createAuthorizationService({ database });
let workspaceId: string;
let managerContext: AuthenticatedContext;
let viewerContext: AuthenticatedContext;
let systemContext: ServiceActorContext;
let clock = new Date("2034-04-10T14:00:00.000Z");

async function humanContext(email: string): Promise<AuthenticatedContext> {
  const user = await database.user.findUniqueOrThrow({
    where: { normalizedEmail: email },
    select: { id: true, displayName: true },
  });
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, userId: user.id, deletedAt: null },
    select: { id: true, roleId: true, role: { select: { key: true, name: true } } },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: user.id, type: "HUMAN" },
    select: { id: true },
  });
  return {
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: "politizai",
    userId: user.id,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: user.displayName,
  };
}

async function createLead() {
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, key: "system", type: "SYSTEM" },
    select: { id: true, key: true },
  });
  systemContext = {
    workspaceId,
    actorId: actor.id,
    actorKey: actor.key,
    actorType: "SYSTEM",
  };
  const result = await createLeadIntakeService({ database, authorization, now: () => clock }).intake(
    {
      channel: "MANUAL",
      idempotencyKey: `free-qualification:${randomUUID()}`,
      fullName: `Lead Qualificação Livre ${randomUUID().slice(0, 8)}`,
      phone: `+55119${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
      sourceKey: "manual",
      priorityBandCode: "P2",
      rawPayload: { test: "free-qualification" },
    },
    systemContext,
  );
  if (result.outcome === "REJECTED") throw new Error("Lead de teste rejeitado.");
  return result.leadId;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, {
    DATABASE_URL: connectionString,
    NODE_ENV: "test",
  })).workspaceId;
  managerContext = await humanContext("gestor@demo.politizai.local");
  viewerContext = await humanContext("viewer@demo.politizai.local");
});

afterAll(async () => database.$disconnect());

describe("qualificação livre do lead", () => {
  it("salva quantos registros forem necessários e os devolve do mais recente para o mais antigo", async () => {
    const leadId = await createLead();
    const service = createFreeQualificationService({ database, authorization, now: () => clock });

    await service.create(managerContext, {
      leadId,
      content: "Primeiro contato realizado. O lead pediu retorno com mais detalhes.",
    });
    clock = new Date(clock.getTime() + 60_000);
    const screen = await service.create(managerContext, {
      leadId,
      content: "Retorno feito. Existe interesse e o decisor participa da próxima conversa.",
    });

    expect(screen.canWrite).toBe(true);
    expect(screen.entries).toHaveLength(2);
    expect(screen.entries.map((entry) => entry.content)).toEqual([
      "Retorno feito. Existe interesse e o decisor participa da próxima conversa.",
      "Primeiro contato realizado. O lead pediu retorno com mais detalhes.",
    ]);
    expect(screen.entries.every((entry) => entry.createdBy === managerContext.displayName)).toBe(true);

    const [noteCount, activityCount, auditCount] = await Promise.all([
      database.note.count({ where: { workspaceId, leadId, deletedAt: null } }),
      database.activity.count({ where: { workspaceId, leadId, subject: "Qualificação registrada" } }),
      database.auditLog.count({ where: { workspaceId, action: "lead.qualification_note.created" } }),
    ]);
    expect(noteCount).toBe(2);
    expect(activityCount).toBe(2);
    expect(auditCount).toBeGreaterThanOrEqual(2);
  });

  it("não salva uma qualificação vazia", async () => {
    const leadId = await createLead();
    const service = createFreeQualificationService({ database, authorization, now: () => clock });

    await expect(service.create(managerContext, { leadId, content: "   " })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("permite leitura e bloqueia gravação para um perfil sem leads.write", async () => {
    const leadId = await createLead();
    const service = createFreeQualificationService({ database, authorization, now: () => clock });
    const screen = await service.getScreen(viewerContext, { leadId });

    expect(screen.canWrite).toBe(false);
    await expect(service.create(viewerContext, {
      leadId,
      content: "Tentativa sem permissão de escrita.",
    })).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await database.note.count({ where: { workspaceId, leadId } })).toBe(0);
  });
});
