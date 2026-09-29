import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createOnboardingBackfillService } from "@/modules/onboarding/application/onboarding-backfill-service";
import { createOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for CRM-51 tests.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) {
  throw new Error("CRM-51 requires an ephemeral politizai_test_* schema.");
}

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 16 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2051-03-10T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let closer: AuthenticatedContext;
let viewer: AuthenticatedContext;
let opportunityId: string;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId, user: { normalizedEmail: email } },
    include: { role: true, user: true },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId, userId: member.userId, type: "HUMAN" },
  });
  return {
    sessionId: randomUUID(),
    workspaceId,
    workspaceSlug: "politizai",
    userId: member.userId,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: member.user.displayName,
  } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  const systemActor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" } });
  const system = {
    workspaceId,
    actorId: systemActor.id,
    actorKey: systemActor.key,
    actorType: "SYSTEM",
  } satisfies ServiceActorContext;
  const intake = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({
    channel: "MANUAL",
    idempotencyKey: "crm51:fixture:lead",
    fullName: "Cliente de onboarding fictício",
    phone: "+5511976543210",
    jobTitle: "Responsável pela implantação",
    interestSummary: "Implantação local com marcos auditáveis.",
    sourceKey: "manual",
    priorityBandCode: "P1",
    rawPayload: { test: "crm51", simulated: true },
  }, system);
  if (intake.outcome === "REJECTED") throw new Error(intake.code);
  const account = await database.account.create({
    data: {
      workspaceId,
      name: "Conta Onboarding Fictícia",
      normalizedName: "conta onboarding ficticia",
      origin: "SEED",
      quality: "CONFIRMED",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  const contact = await database.contact.create({
    data: {
      workspaceId,
      preferredName: "Cliente de onboarding fictício",
      jobTitle: "Responsável pela implantação",
      origin: "LEAD_BACKFILL",
      quality: "CONFIRMED",
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  await database.lead.update({
    where: { id: intake.leadId },
    data: { accountId: account.id, contactId: contact.id, updatedByActorId: systemActor.id },
  });
  [admin, closer, viewer] = await Promise.all([
    context("admin@demo.politizai.local"),
    context("closer1@demo.politizai.local"),
    context("viewer@demo.politizai.local"),
  ]);
  const pipeline = await database.pipeline.findFirstOrThrow({
    where: { workspaceId, entityType: "OPPORTUNITY", isDefault: true },
    include: { stages: { where: { deletedAt: null }, orderBy: { position: "desc" }, take: 1 } },
  });
  const product = await database.product.findFirstOrThrow({ where: { workspaceId, active: true, deletedAt: null } });
  const opportunity = await database.opportunity.create({
    data: {
      workspaceId,
      leadId: intake.leadId,
      accountId: account.id,
      pipelineId: pipeline.id,
      currentStageId: pipeline.stages[0]!.id,
      ownerMemberId: closer.memberId,
      productId: product.id,
      name: "Oportunidade ganha para onboarding",
      status: "WON",
      amountCents: 600000n,
      mrrCents: 50000n,
      tcvCents: 600000n,
      probabilityBps: 10000,
      closedAt: clock,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
  opportunityId = opportunity.id;
  await database.commercialContract.create({
    data: {
      workspaceId,
      contractNumber: "CTR-CRM51-000001",
      opportunityId: opportunity.id,
      accountId: account.id,
      primaryContactId: contact.id,
      ownerMemberId: closer.memberId,
      status: "ACCEPTED",
      acceptedAt: clock,
      createdByActorId: systemActor.id,
      updatedByActorId: systemActor.id,
    },
  });
});

afterAll(async () => database.$disconnect());

describe("CRM-51 handoff e onboarding", () => {
  it("cria um único handoff sob concorrência e preserva replay sem inferir ativação", async () => {
    const service = createOnboardingService({ database, now: () => clock });
    const input = {
      opportunityId,
      ownerMemberId: closer.memberId,
      reason: "Passagem comercial validada para implantação.",
      idempotencyKey: "crm51:handoff:create:001",
    };
    const [created, concurrent] = await Promise.all([
      service.createHandoff(admin, input),
      service.createHandoff(admin, {
        ...input,
        idempotencyKey: "crm51:handoff:create:concurrent",
      }),
    ]);
    const replay = await service.createHandoff(admin, input);
    expect(concurrent.id).toBe(created.id);
    expect(replay.id).toBe(created.id);
    expect(created.status).toBe("DRAFT");
    expect(await database.customerHandoff.count({ where: { workspaceId, opportunityId } })).toBe(1);
    expect(await database.onboardingCase.count({ where: { workspaceId } })).toBe(0);
  });

  it("separa envio, aceite, marcos, ativação e conclusão com histórico", async () => {
    const service = createOnboardingService({ database, now: () => clock });
    let handoff = await database.customerHandoff.findFirstOrThrow({ where: { workspaceId, opportunityId } });
    await expect(service.actHandoff(admin, handoff.id, {
      action: "ACCEPT",
      expectedRevision: handoff.revision,
      reason: "Tentativa inválida sem envio prévio.",
      idempotencyKey: "crm51:handoff:invalid:001",
    })).rejects.toMatchObject({ code: "ONBOARDING_INVALID_HANDOFF_TRANSITION" });
    await service.actHandoff(admin, handoff.id, {
      action: "MARK_READY", expectedRevision: handoff.revision,
      reason: "Briefing comercial revisado e pronto.", idempotencyKey: "crm51:handoff:ready:001",
    });
    handoff = await database.customerHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
    await service.actHandoff(admin, handoff.id, {
      action: "SEND", expectedRevision: handoff.revision,
      reason: "Passagem enviada ao responsável definido.", idempotencyKey: "crm51:handoff:sent:001",
    });
    handoff = await database.customerHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
    const accepted = await service.actHandoff(closer, handoff.id, {
      action: "ACCEPT", expectedRevision: handoff.revision,
      reason: "Responsabilidade aceita com briefing completo.", idempotencyKey: "crm51:handoff:accept:001",
    });
    expect(accepted.onboarding).toMatchObject({ status: "PENDING", ownerMemberId: closer.memberId });
    const onboarding = accepted.onboarding!;
    expect(await database.onboardingMilestone.count({ where: { workspaceId, onboardingCaseId: onboarding.id } })).toBe(4);
    await service.actOnboarding(closer, onboarding.id, {
      action: "START", expectedRevision: onboarding.revision,
      reason: "Onboarding iniciado após aceite responsável.", idempotencyKey: "crm51:onboarding:start:001",
    });
    let active = await database.onboardingCase.findUniqueOrThrow({ where: { id: onboarding.id } });
    await expect(service.actOnboarding(closer, active.id, {
      action: "ACTIVATE", expectedRevision: active.revision,
      reason: "Tentativa sem concluir marcos obrigatórios.", idempotencyKey: "crm51:onboarding:activate:blocked",
    })).rejects.toMatchObject({ code: "ONBOARDING_REQUIRED_MILESTONES" });
    const milestones = await database.onboardingMilestone.findMany({
      where: { workspaceId, onboardingCaseId: active.id },
      orderBy: { position: "asc" },
    });
    for (const milestone of milestones) {
      await service.actOnboarding(closer, active.id, {
        action: "COMPLETE_MILESTONE",
        expectedRevision: milestone.revision,
        milestoneId: milestone.id,
        evidence: `Evidência fictícia do marco ${milestone.key}.`,
        reason: "Marco validado manualmente com evidência.",
        idempotencyKey: `crm51:milestone:${milestone.key}`,
      });
    }
    active = await database.onboardingCase.findUniqueOrThrow({ where: { id: active.id } });
    const subscriptionsBeforeActivation = await database.subscription.count({ where: { workspaceId } });
    await service.actOnboarding(closer, active.id, {
      action: "ACTIVATE", expectedRevision: active.revision,
      reason: "Critérios obrigatórios confirmados com evidência.", idempotencyKey: "crm51:onboarding:activate:001",
    });
    active = await database.onboardingCase.findUniqueOrThrow({ where: { id: active.id } });
    expect(active.status).toBe("ACTIVATED");
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId } })).status).toBe("WON");
    expect(await database.subscription.count({ where: { workspaceId } })).toBe(subscriptionsBeforeActivation);
    await service.actOnboarding(closer, active.id, {
      action: "COMPLETE", expectedRevision: active.revision,
      reason: "Implantação concluída e registrada separadamente.", idempotencyKey: "crm51:onboarding:complete:001",
    });
    expect(await database.onboardingEvent.count({ where: { workspaceId, onboardingCaseId: active.id } })).toBe(8);
    expect((await database.customerHandoff.findFirstOrThrow({ where: { workspaceId, opportunityId } })).status).toBe("COMPLETED");
  });

  it("preserva RBAC, isolamento e imutabilidade do histórico", async () => {
    const service = createOnboardingService({ database, now: () => clock });
    await expect(service.screen(viewer)).resolves.toMatchObject({ permissions: { manage: false, execute: false } });
    await expect(service.createHandoff(viewer, {
      opportunityId,
      ownerMemberId: closer.memberId,
      reason: "Ação não autorizada pelo visualizador.",
      idempotencyKey: "crm51:viewer:denied",
    })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.screen({ ...admin, workspaceId: randomUUID() })).rejects.toBeInstanceOf(AccessDeniedError);
    const event = await database.onboardingEvent.findFirstOrThrow({ where: { workspaceId } });
    await expect(database.onboardingEvent.update({ where: { id: event.id }, data: { reason: "mutação proibida" } })).rejects.toThrow(/append-only/);
  });

  it("executa backfill conservador, replay seguro e revisão de ausências", async () => {
    const backfill = createOnboardingBackfillService(database, () => clock);
    const dry = await backfill.run(admin, { mode: "DRY_RUN", runKey: "crm51:backfill:dry:001" });
    expect(dry.candidateCount).toBeGreaterThan(0);
    const executed = await backfill.run(admin, { mode: "EXECUTE", runKey: "crm51:backfill:execute:001" });
    const replay = await backfill.run(admin, { mode: "EXECUTE", runKey: "crm51:backfill:execute:001" });
    expect(replay).toMatchObject({ id: executed.id, replayed: true });
    expect(await database.onboardingBackfillItem.count({ where: { workspaceId, runId: executed.id } })).toBe(executed.candidateCount);
    expect(executed.createdCount).toBe(0);
    expect(executed.skippedCount).toBeGreaterThan(0);
  });
});
