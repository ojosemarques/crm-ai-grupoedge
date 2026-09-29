import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createCalendarBackfillService } from "@/modules/integrations/application/calendar-backfill-service";
import { createCalendarService } from "@/modules/integrations/application/calendar-service";
import { LocalCalendarSandboxAdapter } from "@/modules/integrations/application/calendar-transport";
import { createCalendarWorkerService } from "@/modules/integrations/application/calendar-worker-service";
import { signLocalCalendarCallback } from "@/modules/integrations/domain/calendar-contracts";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createMeetingService } from "@/modules/meetings/application/meeting-service";
import { createPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { createPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("CRM-47 requires an ephemeral politizai_test_* schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 20 }) });
const authorization = createAuthorizationService({ database });
const clock = new Date("2047-03-04T15:00:00.000Z");
let workspaceId: string;
let manager: AuthenticatedContext;
let viewer: AuthenticatedContext;
let sdr1: AuthenticatedContext;
let closerId: string;
let system: ServiceActorContext;
let sequence = 94_700_000;

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

function calendar() {
  return createCalendarService({ database, now: () => clock });
}

function worker() {
  return createCalendarWorkerService({ database, adapter: new LocalCalendarSandboxAdapter(), now: () => clock, backoffBaseSeconds: 1 });
}

function meetings() {
  return createMeetingService({ database, authorization, now: () => clock });
}

async function qualifyLead(label: string) {
  sequence += 1;
  const created = await createLeadIntakeService({ database, authorization, now: () => clock }).intake({
    channel: "MANUAL",
    idempotencyKey: `crm47:${label}:${randomUUID()}`,
    fullName: `${label} ${randomUUID().slice(0, 8)}`,
    phone: `+55119${sequence.toString().slice(-8)}`,
    jobTitle: "Gestor público",
    organizationName: "Organização fictícia",
    city: "São Paulo",
    stateCode: "SP",
    interestSummary: "Preciso organizar o processo comercial permanente.",
    budgetCents: 150_000,
    sourceKey: "manual",
    priorityBandCode: "P1",
    rawPayload: { test: "crm47", label },
  }, system);
  if (created.outcome === "REJECTED") throw new Error(created.code);
  const pipeline = createPreSalesPipelineService({ database, authorization, now: () => clock });
  const stages = await database.pipelineStage.findMany({ where: { workspaceId, pipeline: { entityType: "LEAD", isDefault: true }, deletedAt: null }, select: { id: true, leadStageCode: true } });
  const byCode = new Map(stages.map((stage) => [stage.leadStageCode, stage.id]));
  let state = await pipeline.getLeadState(manager, { leadId: created.leadId });
  await pipeline.transition(manager, { leadId: created.leadId, targetStageId: byCode.get("IN_QUALIFICATION"), expectedUpdatedAt: state.updatedAt, reason: "Preparar cenário controlado de calendário.", origin: "PIPELINE_LIST", managerCorrection: true, confirmed: true });
  await createPactoQualificationService({ database, authorization, now: () => clock }).validate(manager, { leadId: created.leadId, expectedRevision: 0, dimensions: pactoDimensions.map((dimension) => ({ dimension, status: "POSITIVE" as const, evidence: `Evidência ${dimension}`, origin: "SDR" as const })) });
  state = await pipeline.getLeadState(manager, { leadId: created.leadId });
  await pipeline.transition(manager, { leadId: created.leadId, targetStageId: byCode.get("QUALIFIED"), expectedUpdatedAt: state.updatedAt, reason: "PACTO validado para reunião.", origin: "PIPELINE_LIST", managerCorrection: false, confirmed: true });
  return created.leadId;
}

async function schedule(label: string, startsAtLocal: string) {
  const leadId = await qualifyLead(label);
  const result = await meetings().schedule(manager, { leadId, closerId, title: `Diagnóstico ${label}`, startsAtLocal, durationMinutes: 30, observation: "Cenário local CRM-47." });
  return { leadId, meetingId: result.meetingId };
}

function callbackBody(input: Record<string, unknown>) {
  return Buffer.from(JSON.stringify({
    eventId: `crm47:event:${randomUUID()}`,
    nonce: `crm47:nonce:${randomUUID()}`,
    externalEventId: `crm47:external:${randomUUID()}`,
    externalVersion: 1,
    occurredAt: clock.toISOString(),
    timeZone: "America/Sao_Paulo",
    origin: "LOCAL_SANDBOX",
    ...input,
  }));
}

async function ingest(rawBody: Buffer) {
  const timestamp = String(clock.getTime());
  return calendar().ingestSignedLocalCallback(workspaceId, rawBody, timestamp, signLocalCalendarCallback(workspaceId, timestamp, rawBody));
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  [manager, viewer, sdr1] = await Promise.all([context("gestor@demo.politizai.local"), context("viewer@demo.politizai.local"), context("sdr1@demo.politizai.local")]);
  closerId = (await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, teamMemberships: { some: { function: "CLOSER", deletedAt: null } } }, orderBy: { user: { normalizedEmail: "asc" } } })).id;
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM", userId: null }, orderBy: { createdAt: "asc" } });
  system = { workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key };
});

afterAll(async () => database.$disconnect());

describe("CRM-47 calendário bidirecional em sandbox local", () => {
  it("semeia perfil sem segredo/egress e aplica RBAC e escopo", async () => {
    const profile = await database.calendarConnectionProfile.findFirstOrThrow({ where: { workspaceId }, include: { connection: { include: { secrets: true } } } });
    expect(profile).toMatchObject({ operatingMode: "LOCAL_SANDBOX", timeZone: "America/Sao_Paulo" });
    expect(profile.connection).toMatchObject({ environment: "LOCAL", status: "ACTIVE_LOCAL", enabled: true });
    expect(profile.connection.secrets).toHaveLength(0);
    await expect(calendar().screen(viewer)).resolves.toMatchObject({ externalEgress: false, permissions: { sync: false, resolveConflict: false, readConflicts: true } });
    await expect(calendar().configureLocal(viewer, { displayName: "Negado", syncPastDays: 30, syncFutureDays: 180, maxItemsPerRun: 200 })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(calendar().screen({ ...manager, workspaceId: randomUUID() })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("enfileira e processa criação uma vez, inclusive sob concorrência", async () => {
    const fixture = await schedule("outbound", "2047-03-10T09:00");
    const input = { meetingId: fixture.meetingId, scenario: "SUCCESS" as const, idempotencyKey: "crm47:push:create:001", correlationId: "crm47:push:create:001" };
    const [first, second] = await Promise.all([calendar().enqueueMeetingSync(manager, input), calendar().enqueueMeetingSync(manager, input)]);
    expect(first.eventId).toBe(second.eventId);
    expect([first.idempotent, second.idempotent].sort()).toEqual([false, true]);
    await expect(worker().processNext("crm47-push-worker")).resolves.toMatchObject({ status: "SUCCEEDED", meetingId: fixture.meetingId, operation: "CREATE", externalEgress: false });
    const link = await database.calendarEventLink.findFirstOrThrow({ where: { workspaceId, meetingId: fixture.meetingId } });
    expect(link).toMatchObject({ syncState: "SYNCED", externalVersion: 1, lastMeetingRevision: 1, lastPushedMeetingRevision: 1 });
    expect(await database.calendarSyncEvent.count({ where: { workspaceId, meetingId: fixture.meetingId, direction: "PUSH" } })).toBe(1);
    expect(await database.job.count({ where: { workspaceId, type: "CALENDAR_SYNC", payload: { path: ["eventId"], equals: first.eventId } } })).toBe(1);
    await expect(database.integrationSyncRun.findFirstOrThrow({ where: { workspaceId, direction: "PUSH", correlationId: input.correlationId } })).resolves.toMatchObject({ status: "SUCCEEDED", createdCount: 1, readCount: 1 });
    await expect(database.integrationSyncCursor.findUniqueOrThrow({ where: { workspaceId_connectionId_direction_objectType: { workspaceId, connectionId: (await database.calendarConnectionProfile.findFirstOrThrow({ where: { workspaceId } })).connectionId, direction: "PUSH", objectType: "calendar_event" } } })).resolves.toMatchObject({ cursor: expect.stringContaining(`push:${fixture.meetingId}`) });
  });

  it("projeta remarcação e cancelamento sem duplicar a identidade externa", async () => {
    const fixture = await schedule("lifecycle", "2047-03-11T09:00");
    await calendar().enqueueMeetingSync(manager, { meetingId: fixture.meetingId, scenario: "SUCCESS", idempotencyKey: "crm47:lifecycle:create", correlationId: "crm47:lifecycle:create" });
    await worker().processNext("crm47-lifecycle-worker");
    await meetings().act(manager, { action: "RESCHEDULE", meetingId: fixture.meetingId, expectedRevision: 1, startsAtLocal: "2047-03-11T10:00", durationMinutes: 40, reason: "Lead solicitou novo horário." });
    const reschedule = await calendar().enqueueMeetingSync(manager, { meetingId: fixture.meetingId, scenario: "SUCCESS", idempotencyKey: "crm47:lifecycle:reschedule", correlationId: "crm47:lifecycle:reschedule" });
    await expect(worker().processNext("crm47-lifecycle-worker")).resolves.toMatchObject({ status: "SUCCEEDED", operation: "RESCHEDULE" });
    await meetings().act(manager, { action: "CANCEL", meetingId: fixture.meetingId, expectedRevision: 2, reason: "Lead cancelou a reunião.", nextAction: { title: "Revisar cancelamento", dueAtLocal: "2047-03-11T11:00" } });
    const cancellation = await calendar().enqueueMeetingSync(manager, { meetingId: fixture.meetingId, scenario: "SUCCESS", idempotencyKey: "crm47:lifecycle:cancel", correlationId: "crm47:lifecycle:cancel" });
    await expect(worker().processNext("crm47-lifecycle-worker")).resolves.toMatchObject({ status: "SUCCEEDED", operation: "CANCEL" });
    expect(reschedule.eventId).not.toBe(cancellation.eventId);
    expect(await database.calendarEventLink.count({ where: { workspaceId, meetingId: fixture.meetingId } })).toBe(1);
    await expect(database.calendarEventLink.findFirstOrThrow({ where: { workspaceId, meetingId: fixture.meetingId } })).resolves.toMatchObject({ syncState: "CANCELLED", lastPushedMeetingRevision: 3 });
  });

  it("aceita callback assinado uma vez e aplica remarcação via MeetingService", async () => {
    const fixture = await schedule("pull", "2047-03-12T09:00");
    await calendar().enqueueMeetingSync(manager, { meetingId: fixture.meetingId, scenario: "SUCCESS", idempotencyKey: "crm47:pull:seed", correlationId: "crm47:pull:seed" });
    await worker().processNext("crm47-pull-worker");
    const link = await database.calendarEventLink.findFirstOrThrow({ where: { workspaceId, meetingId: fixture.meetingId } });
    const raw = callbackBody({ operation: "RESCHEDULE", meetingId: fixture.meetingId, externalEventId: link.externalEventId, externalVersion: 2, baseMeetingRevision: 1, startsAt: "2047-03-12T13:00:00.000Z", endsAt: "2047-03-12T13:40:00.000Z", reason: "Mudança confirmada no sandbox." });
    const accepted = await ingest(raw);
    await expect(ingest(raw)).resolves.toMatchObject({ status: "DUPLICATE", inboxId: accepted.inboxId });
    await expect(calendar().ingestSignedLocalCallback(workspaceId, raw, String(clock.getTime() - 301_000), signLocalCalendarCallback(workspaceId, String(clock.getTime() - 301_000), raw))).rejects.toMatchObject({ code: "CALENDAR_TIMESTAMP_EXPIRED" });
    await expect(worker().processNext("crm47-pull-worker")).resolves.toMatchObject({ status: "SUCCEEDED", meetingId: fixture.meetingId, operation: "RESCHEDULE" });
    const meeting = await database.meeting.findUniqueOrThrow({ where: { id: fixture.meetingId }, include: { history: { orderBy: { meetingRevision: "asc" } } } });
    expect(meeting).toMatchObject({ revision: 2, startsAt: new Date("2047-03-12T13:00:00.000Z"), durationMinutes: 40 });
    expect(meeting.history.at(-1)?.reason).toContain(JSON.parse(raw.toString()).eventId);
    await expect(database.integrationSyncRun.findFirstOrThrow({ where: { workspaceId, direction: "PULL", correlationId: JSON.parse(raw.toString()).eventId } })).resolves.toMatchObject({ status: "SUCCEEDED", updatedCount: 1, readCount: 1 });
  });

  it("materializa conflito concorrente sem sobrescrever o CRM e respeita sigilo por papel", async () => {
    const fixture = await schedule("conflict", "2047-03-13T09:00");
    await calendar().enqueueMeetingSync(manager, { meetingId: fixture.meetingId, scenario: "SUCCESS", idempotencyKey: "crm47:conflict:seed", correlationId: "crm47:conflict:seed" });
    await worker().processNext("crm47-conflict-worker");
    const link = await database.calendarEventLink.findFirstOrThrow({ where: { workspaceId, meetingId: fixture.meetingId } });
    await meetings().act(manager, { action: "CONFIRM", meetingId: fixture.meetingId, expectedRevision: 1 });
    const raw = callbackBody({ operation: "RESCHEDULE", meetingId: fixture.meetingId, externalEventId: link.externalEventId, externalVersion: 2, baseMeetingRevision: 1, startsAt: "2047-03-13T14:00:00.000Z", endsAt: "2047-03-13T14:30:00.000Z", reason: "Alteração concorrente." });
    await ingest(raw);
    const result = await worker().processNext("crm47-conflict-worker");
    expect(result).toMatchObject({ status: "CONFLICT", type: "CONCURRENT_MEETING_CHANGE" });
    if (result.status !== "CONFLICT") throw new Error("Conflito esperado não foi materializado.");
    expect(await database.meeting.findUniqueOrThrow({ where: { id: fixture.meetingId } })).toMatchObject({ revision: 2, startsAt: new Date("2047-03-13T12:00:00.000Z") });
    expect((await calendar().screen(manager)).conflicts.some(({ meetingId }) => meetingId === fixture.meetingId)).toBe(true);
    expect((await calendar().screen(sdr1)).conflicts).toHaveLength(0);
    const resolved = await calendar().resolveConflict(manager, result.conflictId, "KEEP_CRM", "Manter a revisão canônica confirmada pelo gestor.");
    expect(resolved).toMatchObject({ status: "RESOLVED_KEEP_CRM", jobId: expect.any(String) });
    await expect(worker().processNext("crm47-conflict-resolution-worker")).resolves.toMatchObject({ status: "SUCCEEDED", meetingId: fixture.meetingId, operation: "UPDATE" });
    await expect(database.calendarEventLink.findFirstOrThrow({ where: { workspaceId, meetingId: fixture.meetingId } })).resolves.toMatchObject({ syncState: "SYNCED", lastPushedMeetingRevision: 2 });
  });

  it("retoma callback já aplicado no domínio sem duplicar a alteração", async () => {
    const fixture = await schedule("crash-recovery", "2047-03-18T09:00");
    await calendar().enqueueMeetingSync(manager, { meetingId: fixture.meetingId, scenario: "SUCCESS", idempotencyKey: "crm47:recovery:seed", correlationId: "crm47:recovery:seed" });
    await worker().processNext("crm47-recovery-worker");
    const link = await database.calendarEventLink.findFirstOrThrow({ where: { workspaceId, meetingId: fixture.meetingId } });
    const raw = callbackBody({ operation: "RESCHEDULE", meetingId: fixture.meetingId, externalEventId: link.externalEventId, externalVersion: 2, baseMeetingRevision: 1, startsAt: "2047-03-18T14:00:00.000Z", endsAt: "2047-03-18T14:30:00.000Z", reason: "Recuperação após interrupção." });
    const eventId = JSON.parse(raw.toString()).eventId as string;
    await ingest(raw);
    await meetings().act(manager, { action: "RESCHEDULE", meetingId: fixture.meetingId, expectedRevision: 1, startsAtLocal: "2047-03-18T11:00", durationMinutes: 30, reason: `Calendário local · ${eventId}: Recuperação após interrupção.` });
    await expect(worker().processNext("crm47-recovery-worker")).resolves.toMatchObject({ status: "SUCCEEDED", meetingId: fixture.meetingId, operation: "RESCHEDULE" });
    expect(await database.meetingHistory.count({ where: { workspaceId, meetingId: fixture.meetingId, reason: { contains: eventId } } })).toBe(1);
    await expect(database.calendarEventLink.findFirstOrThrow({ where: { workspaceId, meetingId: fixture.meetingId } })).resolves.toMatchObject({ lastPulledExternalVersion: 2, syncState: "SYNCED" });
  });

  it("cria reunião externa apenas com lead e closer conhecidos", async () => {
    const leadId = await qualifyLead("external-create");
    const raw = callbackBody({ operation: "CREATE", leadId, closerId, title: "Diagnóstico criado no calendário local", startsAt: "2047-03-14T12:00:00.000Z", endsAt: "2047-03-14T12:30:00.000Z" });
    const accepted = await ingest(raw);
    if (accepted.status !== "ACCEPTED") throw new Error("Callback de criação deveria ser aceito.");
    await expect(worker().processNext("crm47-create-worker")).resolves.toMatchObject({ status: "SUCCEEDED", operation: "CREATE", externalEgress: false });
    const event = await database.calendarSyncEvent.findUniqueOrThrow({ where: { id: accepted.eventId } });
    expect(event.meetingId).toBeTruthy();
    await expect(database.meetingHistory.findFirstOrThrow({ where: { workspaceId, meetingId: event.meetingId! } })).resolves.toMatchObject({ action: "SCHEDULED" });
    expect(await database.calendarEventLink.count({ where: { workspaceId, meetingId: event.meetingId! } })).toBe(1);
  });

  it("faz backfill conservador e protege fatos históricos", async () => {
    const fixture = await schedule("backfill", "2047-03-15T09:00");
    const backfill = createCalendarBackfillService({ database, now: () => clock });
    const dry = await backfill.run(manager, { mode: "DRY_RUN", runKey: "crm47:backfill:dry:001" });
    expect(dry.reviewCount).toBeGreaterThan(0);
    const run = await backfill.run(manager, { mode: "EXECUTE", runKey: "crm47:backfill:execute:001" });
    await expect(backfill.run(manager, { mode: "EXECUTE", runKey: "crm47:backfill:execute:001" })).resolves.toMatchObject({ id: run.id, idempotent: true });
    const item = await database.calendarBackfillItem.findFirstOrThrow({ where: { workspaceId, meetingId: fixture.meetingId } });
    expect(item).toMatchObject({ outcome: "REVIEW_REQUIRED", reasonCode: "NOT_LINKED_NO_EXTERNAL_EVIDENCE", linkId: null });
    expect(await database.calendarEventLink.count({ where: { workspaceId, meetingId: fixture.meetingId } })).toBe(0);
    await expect(database.calendarBackfillItem.delete({ where: { id: item.id } })).rejects.toThrow(/append-only/);
  });

  it("faz retry/backoff, dead-letter e replay autorizado", async () => {
    const retryFixture = await schedule("retry", "2047-03-16T09:00");
    const queued = await calendar().enqueueMeetingSync(manager, { meetingId: retryFixture.meetingId, scenario: "TRANSIENT_FAILURE", idempotencyKey: "crm47:retry:001", correlationId: "crm47:retry:001" });
    const localWorker = worker();
    await expect(localWorker.processNext("crm47-retry-worker")).resolves.toMatchObject({ status: "RETRY_PENDING", delaySeconds: 1 });
    let job = await database.job.findFirstOrThrow({ where: { workspaceId, payload: { path: ["eventId"], equals: queued.eventId } } });
    await database.job.update({ where: { id: job.id }, data: { runAt: clock } });
    await expect(localWorker.processNext("crm47-retry-worker")).resolves.toMatchObject({ status: "RETRY_PENDING", delaySeconds: 2 });
    await database.job.update({ where: { id: job.id }, data: { runAt: clock } });
    await expect(localWorker.processNext("crm47-retry-worker")).resolves.toMatchObject({ status: "SUCCEEDED" });

    const deadFixture = await schedule("dead", "2047-03-17T09:00");
    const dead = await calendar().enqueueMeetingSync(manager, { meetingId: deadFixture.meetingId, scenario: "PERMANENT_FAILURE", idempotencyKey: "crm47:dead:001", correlationId: "crm47:dead:001" });
    await expect(localWorker.processNext("crm47-dead-worker")).resolves.toMatchObject({ status: "FAILED", code: "CALENDAR_LOCAL_PERMANENT_FAILURE" });
    await expect(calendar().replay(viewer, dead.eventId)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(calendar().replay(manager, dead.eventId)).resolves.toMatchObject({ eventId: dead.eventId, status: "PENDING" });
    job = await database.job.findFirstOrThrow({ where: { workspaceId, payload: { path: ["eventId"], equals: dead.eventId } } });
    expect(job).toMatchObject({ status: "PENDING", attempts: 0 });
  });
});
