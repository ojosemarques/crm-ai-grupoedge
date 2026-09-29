import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import {
  pactoDimensions,
  type PactoStatusKey,
} from "@/modules/qualification/domain/pacto-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for PACTO tests.");

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 20 }),
});
const authorization = createAuthorizationService({ database });
let workspaceId: string;
let managerContext: AuthenticatedContext;
let viewerContext: AuthenticatedContext;
let systemContext: ServiceActorContext;
let aiContext: ServiceActorContext;
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

async function serviceContext(
  key: string,
  actorType: "SYSTEM" | "AI_AGENT",
): Promise<ServiceActorContext> {
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, key, type: actorType },
    select: { id: true },
  });
  return { workspaceId, actorId: actor.id, actorKey: key, actorType };
}

async function createLead() {
  const phoneSuffix = (BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  const intake = createLeadIntakeService({ database, authorization, now: () => clock });
  const result = await intake.intake(
    {
      channel: "MANUAL",
      idempotencyKey: `crm12:${randomUUID()}`,
      fullName: `Lead PACTO ${randomUUID().slice(0, 8)}`,
      phone: `+55119${phoneSuffix}`,
      sourceKey: "manual",
      priorityBandCode: "P2",
      rawPayload: { test: "pacto" },
    },
    systemContext,
  );
  if (result.outcome === "REJECTED") throw new Error("Lead de teste rejeitado.");
  return result;
}

function dimensions(statuses: readonly PactoStatusKey[]) {
  return pactoDimensions.map((dimension, index) => ({
    dimension,
    status: statuses[index] ?? "UNKNOWN",
    ...(statuses[index] && statuses[index] !== "UNKNOWN"
      ? {
          evidence: `Evidência observável ${index + 1}`,
          note: `Nota ${index + 1}`,
          origin: "SDR" as const,
        }
      : {}),
  }));
}

beforeAll(async () => {
  const seed = await seedDemoDatabase(database);
  workspaceId = seed.workspaceId;
  [managerContext, viewerContext, systemContext, aiContext] = await Promise.all([
    humanContext("gestor@demo.politizai.local"),
    humanContext("viewer@demo.politizai.local"),
    serviceContext("system", "SYSTEM"),
    serviceContext("ai:recommendation", "AI_AGENT"),
  ]);
});

afterAll(async () => database.$disconnect());

describe("qualificação PACTO", () => {
  it("mantém ausência como não investigada, salva rascunho e explica o bloqueio da validação", async () => {
    const lead = await createLead();
    const service = createPactoQualificationService({
      database,
      authorization,
      now: () => clock,
    });
    const draft = await service.saveDraft(managerContext, {
      leadId: lead.leadId,
      expectedRevision: 0,
      dimensions: dimensions(["POSITIVE", "PARTIAL", "UNKNOWN", "UNKNOWN", "UNKNOWN"]),
    });
    expect(draft).toMatchObject({
      revision: 1,
      status: "IN_PROGRESS",
      investigatedDimensions: 2,
      isQualificationReady: false,
    });
    await expect(
      service.validate(managerContext, {
        leadId: lead.leadId,
        expectedRevision: 1,
        dimensions: dimensions(["POSITIVE", "PARTIAL", "UNKNOWN", "UNKNOWN", "UNKNOWN"]),
      }),
    ).rejects.toMatchObject({ code: "PACTO_INCOMPLETE" });

    const view = await service.getPacto(managerContext, { leadId: lead.leadId });
    expect(view.aggregateStatus).toBe("IN_PROGRESS");
    expect(view.missingDimensions).toEqual(["CAPACITY", "DECISION", "OPPORTUNITY_NOW"]);
    expect(view.dimensions[2]).toMatchObject({
      status: "UNKNOWN",
      evidence: null,
      origin: null,
      validatedAt: null,
    });
  });

  it("persiste todos os estados, valida com evidência e conserva revisões, timeline e auditoria", async () => {
    const lead = await createLead();
    const service = createPactoQualificationService({ database, authorization, now: () => clock });
    const first = dimensions(["POSITIVE", "PARTIAL", "NEGATIVE", "DISQUALIFYING", "POSITIVE"]);
    await service.saveDraft(managerContext, {
      leadId: lead.leadId,
      expectedRevision: 0,
      dimensions: first,
    });
    clock = new Date(clock.getTime() + 60_000);
    const validated = await service.validate(managerContext, {
      leadId: lead.leadId,
      expectedRevision: 1,
      dimensions: first,
    });
    expect(validated).toMatchObject({
      revision: 2,
      status: "COMPLETED",
      investigatedDimensions: 5,
      hasDisqualifyingDimension: true,
      isQualificationReady: false,
    });

    const [view, activityCount, auditCount] = await Promise.all([
      service.getPacto(managerContext, { leadId: lead.leadId }),
      database.activity.count({
        where: { workspaceId, leadId: lead.leadId, subject: { contains: "PACTO" } },
      }),
      database.auditLog.count({
        where: {
          workspaceId,
          entityType: "LeadQualification",
          action: { in: ["lead.pacto.draft_saved", "lead.pacto.validated"] },
        },
      }),
    ]);
    expect(view.history.map((item) => item.kind)).toEqual(["VALIDATED", "DRAFT_SAVED"]);
    expect(view.validatedBy).toBe(managerContext.displayName);
    expect(view.dimensions.every((item) => item.validatedAt !== null)).toBe(true);
    expect(activityCount).toBe(2);
    expect(auditCount).toBeGreaterThanOrEqual(2);

    await expect(
      database.pactoRevision.update({
        where: { id: view.history[0]!.id },
        data: { investigatedDimensions: 4 },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("usa e fotografa o mínimo configurado no workspace sem reescrever a regra histórica", async () => {
    const lead = await createLead();
    const service = createPactoQualificationService({ database, authorization, now: () => clock });
    await database.workspace.update({
      where: { id: workspaceId },
      data: { pactoMinimumInvestigatedDimensions: 3 },
    });
    try {
      const validated = await service.validate(managerContext, {
        leadId: lead.leadId,
        expectedRevision: 0,
        dimensions: dimensions(["POSITIVE", "PARTIAL", "POSITIVE", "UNKNOWN", "UNKNOWN"]),
      });
      expect(validated).toMatchObject({
        investigatedDimensions: 3,
        isQualificationReady: true,
      });
      const revision = await database.pactoRevision.findFirstOrThrow({
        where: { workspaceId, leadId: lead.leadId },
      });
      expect(revision.minimumRequiredDimensions).toBe(3);
    } finally {
      await database.workspace.update({
        where: { id: workspaceId },
        data: { pactoMinimumInvestigatedDimensions: 5 },
      });
    }
  });

  it("separa formulário e IA da validação humana e nega mutação ao visualizador", async () => {
    const lead = await createLead();
    const service = createPactoQualificationService({ database, authorization, now: () => clock });
    await service.recordSuggestion(systemContext, {
      leadId: lead.leadId,
      submissionId: lead.submissionId,
      origin: "FORM",
      dimensions: [
        { dimension: "AFFLICTION", status: "PARTIAL", evidence: "Dor informada no formulário." },
      ],
    });
    await service.recordSuggestion(aiContext, {
      leadId: lead.leadId,
      origin: "AI",
      dimensions: [
        { dimension: "OPPORTUNITY_NOW", status: "POSITIVE", evidence: "Sugestão baseada em texto, não validada." },
      ],
    });
    const view = await service.getPacto(viewerContext, { leadId: lead.leadId });
    expect(view).toMatchObject({
      revision: 0,
      aggregateStatus: "NOT_STARTED",
      canWrite: false,
    });
    expect(view.formPrequalification).toHaveLength(1);
    expect(view.aiSuggestions).toHaveLength(1);
    expect(view.dimensions.every((item) => item.status === "UNKNOWN")).toBe(true);
    await expect(
      service.saveDraft(viewerContext, {
        leadId: lead.leadId,
        expectedRevision: 0,
        dimensions: dimensions(["UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"]),
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("serializa alterações concorrentes e reverte integralmente uma falha antes do commit", async () => {
    const concurrentLead = await createLead();
    const service = createPactoQualificationService({ database, authorization, now: () => clock });
    const payload = {
      leadId: concurrentLead.leadId,
      expectedRevision: 0,
      dimensions: dimensions(["POSITIVE", "POSITIVE", "POSITIVE", "POSITIVE", "POSITIVE"]),
    };
    const settled = await Promise.allSettled([
      service.saveDraft(managerContext, payload),
      service.saveDraft(managerContext, payload),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(
      await database.pactoRevision.count({
        where: { workspaceId, leadId: concurrentLead.leadId },
      }),
    ).toBe(1);

    const rollbackLead = await createLead();
    const rollbackService = createPactoQualificationService({
      database,
      authorization,
      now: () => clock,
      beforeCommit: async () => {
        throw new Error("falha transacional simulada CRM-12");
      },
    });
    await expect(
      rollbackService.saveDraft(managerContext, {
        leadId: rollbackLead.leadId,
        expectedRevision: 0,
        dimensions: payload.dimensions,
      }),
    ).rejects.toThrow("falha transacional simulada CRM-12");
    const [qualificationCount, revisionCount, eventCount] = await Promise.all([
      database.leadQualification.count({ where: { workspaceId, leadId: rollbackLead.leadId } }),
      database.pactoRevision.count({ where: { workspaceId, leadId: rollbackLead.leadId } }),
      database.activity.count({
        where: { workspaceId, leadId: rollbackLead.leadId, subject: { contains: "PACTO" } },
      }),
    ]);
    expect({ qualificationCount, revisionCount, eventCount }).toEqual({
      qualificationCount: 0,
      revisionCount: 0,
      eventCount: 0,
    });
  });
});
