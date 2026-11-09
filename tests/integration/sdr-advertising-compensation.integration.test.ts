import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { PrismaClient, type CommercialMetricEventType } from "@/generated/prisma/client";
import { readSdrAdvertisingFacts } from "@/modules/finance/application/sdr-advertising-facts";
import { createCloserCompensationWorker } from "@/modules/finance/application/closer-compensation-worker";
import { applyCommercialCompensationCommand } from "@/modules/finance/application/commercial-compensation-payment";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 4 }) });
afterAll(() => database.$disconnect());

it("usa a atribuição histórica de Anúncios e a ocorrência efetiva no corte da presença", async () => {
  const date = (value: string) => new Date(value);
  const from = date("2026-11-01T03:00:00Z");
  const to = date("2026-12-01T03:00:00Z");
  const through = date("2026-11-29T23:59:59Z");
  const early = date("2026-10-28T14:00:00Z");
  const arrivalAt = date("2026-11-04T14:00:00Z");
  const bookedAt = date("2026-11-06T14:00:00Z");
  const scheduledAt = date("2026-11-12T14:00:00Z");
  const workspace = await database.workspace.create({ data: { slug: `sdr-cohort-${randomUUID()}`, name: "Coortes de teste" } });
  const actor = await database.actor.create({ data: { workspaceId: workspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" } });
  const audit = { workspaceId: workspace.id, createdByActorId: actor.id, updatedByActorId: actor.id };
  const role = await database.role.create({ data: { ...audit, key: "sdr", name: "SDR" } });
  const member = async () => {
    const email = `${randomUUID()}@example.test`;
    const user = await database.user.create({ data: { email, normalizedEmail: email, displayName: "SDR de teste" } });
    return database.workspaceMember.create({ data: { ...audit, roleId: role.id, userId: user.id } });
  };
  const sdr = await member();
  const other = await member();
  const pipeline = await database.pipeline.create({ data: { ...audit, entityType: "LEAD", name: "Anúncios" } });
  const pros = await database.pipeline.create({ data: { ...audit, entityType: "LEAD", name: "Prospecção Ativa" } });
  const stage = await database.pipelineStage.create({ data: { ...audit, pipelineId: pipeline.id, name: "Entrada", position: 1 } });
  const source = await database.leadSource.create({ data: { ...audit, key: "ads", name: "Anúncios", type: "PAID_MEDIA" } });
  const lead = async (createdAt: Date) => database.lead.create({ data: {
    ...audit, pipelineId: pipeline.id, sourceId: source.id, currentStageId: stage.id, ownerMemberId: other.id,
    fullName: "Lead de teste", createdAt, slaStartedAt: createdAt, slaDueAt: createdAt, lastActivityAt: createdAt,
  } });
  const newLead = await lead(arrivalAt);
  const historicalLead = await lead(early);
  const uncertainLead = await lead(arrivalAt);
  const prospectingLead = await lead(arrivalAt);
  const reversedLead = await lead(arrivalAt);
  const fact = (eventType: CommercialMetricEventType, leadId: string, occurredAt: Date, overrides: {
    meetingId?: string; bookedByMemberId?: string; leadOwnerMemberIdAtEvent?: string; pipelineId?: string;
    sourceEntityType?: string; recordedAt?: Date; safeMetadata?: { ownerBasis: string };
  } = {}) => database.commercialMetricFact.create({ data: {
    workspaceId: workspace.id, eventKey: randomUUID(), eventType, sourceEntityType: "Fixture", sourceEntityId: randomUUID(),
    pipelineId: pipeline.id, inputFingerprint: "fixture", leadId, occurredAt, recordedAt: occurredAt, ...overrides,
  } });
  await fact("LEAD_CREATED", newLead.id, arrivalAt, { leadOwnerMemberIdAtEvent: sdr.id });
  await fact("LEAD_SUBMISSION_ATTACHED", newLead.id, bookedAt, { leadOwnerMemberIdAtEvent: other.id });
  await fact("LEAD_CREATED", historicalLead.id, early, { leadOwnerMemberIdAtEvent: sdr.id });
  await fact("LEAD_SUBMISSION_ATTACHED", historicalLead.id, arrivalAt, { leadOwnerMemberIdAtEvent: sdr.id });
  await fact("LEAD_CREATED", prospectingLead.id, arrivalAt, { pipelineId: pros.id, leadOwnerMemberIdAtEvent: sdr.id });
  await fact("LEAD_CREATED", uncertainLead.id, arrivalAt, { leadOwnerMemberIdAtEvent: sdr.id, safeMetadata: { ownerBasis: "current_snapshot" } });
  const reversedArrival = await fact("LEAD_CREATED", reversedLead.id, arrivalAt, { leadOwnerMemberIdAtEvent: sdr.id });
  await database.commercialMetricFact.create({ data: {
    ...reversedArrival, id: randomUUID(), eventKey: randomUUID(), quantity: -1, safeMetadata: {},
    correctionOfFactId: reversedArrival.id, reversedAt: bookedAt, recordedAt: bookedAt, reversalReason: "Estorno sintético",
  } });
  const meeting = async (leadId: string, booking: Date, latest: "RESCHEDULED" | "ATTENDED") => {
    const nextAt = latest === "RESCHEDULED" ? date("2026-12-03T14:00:00Z") : scheduledAt;
    const row = await database.meeting.create({ data: {
      ...audit, leadId, ownerMemberId: other.id, title: "Reunião de teste", startsAt: nextAt, endsAt: new Date(nextAt.getTime() + 30 * 60_000),
      timeZone: "America/Sao_Paulo", durationMinutes: 30, createdAt: booking,
      status: latest === "ATTENDED" ? "COMPLETED" : "SCHEDULED", completedAt: latest === "ATTENDED" ? scheduledAt : null, revision: 2,
    } });
    for (const revision of [1, 2]) {
      const occurredAt = revision === 1 ? booking : latest === "ATTENDED" ? scheduledAt : date("2026-11-09T14:00:00Z");
      const startsAt = revision === 1 ? scheduledAt : nextAt;
      await database.meetingHistory.create({ data: {
        workspaceId: workspace.id, meetingId: row.id, leadId, ownerMemberId: other.id, meetingRevision: revision,
        action: revision === 1 ? "SCHEDULED" : latest, newStatus: revision === 2 && latest === "ATTENDED" ? "COMPLETED" : "SCHEDULED",
        newStartsAt: startsAt, newEndsAt: new Date(startsAt.getTime() + 30 * 60_000), occurredAt, createdAt: occurredAt, recordedByActorId: actor.id,
      } });
    }
    await fact("MEETING_SCHEDULED", leadId, booking, { meetingId: row.id, bookedByMemberId: sdr.id, sourceEntityType: "MeetingHistory" });
    return row;
  };
  await meeting(newLead.id, bookedAt, "RESCHEDULED");
  const held = await meeting(historicalLead.id, early, "ATTENDED");

  const read = () => database.$transaction((tx) => readSdrAdvertisingFacts(tx, { workspaceId: workspace.id, memberId: sdr.id, from, to, through }));
  await expect(read()).resolves.toMatchObject({
    counts: { leads: 1, bookedLeads: 1, eligibleMeetings: 1, heldMeetings: 1, missingEvidence: 1 },
    leadIds: [newLead.id], bookedLeadIds: [newLead.id], missingKeys: [`arrival:${uncertainLead.id}`],
    attainment: { coverage: "REVIEW", band: null },
  });
  await database.leadAssignment.create({ data: {
    workspaceId: workspace.id, leadId: uncertainLead.id, toMemberId: other.id, type: "MANUAL",
    assignedAt: arrivalAt, createdAt: arrivalAt, createdByActorId: actor.id,
  } });
  await expect(read()).resolves.toMatchObject({
    counts: { leads: 1, bookedLeads: 1, eligibleMeetings: 1, heldMeetings: 1, missingEvidence: 0 },
    attainment: { coverage: "READY", band: 100 },
  });

  await database.commercialCompensationPolicy.create({ data: {
    workspaceId: workspace.id, version: "sdr-fixture-v1", effectiveDate: date("2026-11-01"), recordedById: actor.id,
    calendarVerifiedThrough: date("2026-12-31"), calendarEvidence: "Calendário sintético", calendarHolidays: [],
  } });
  await database.otePlan.create({ data: {
    workspaceId: workspace.id, memberId: sdr.id, effectiveMonth: "2026-11", label: "Plano sintético",
    role: "SDR", fixedCents: 900n, quotaCents: 0n, bonusCents: 0n, updatedByActorId: actor.id,
    advertisingBand60Cents: 101n, advertisingBand80Cents: 202n, advertisingBand100Cents: 303n, advertisingBonusCents: 99n,
  } });
  let evaluationAt = date("2026-12-01T15:00:00Z");
  const worker = createCloserCompensationWorker({ database, now: () => evaluationAt });
  await expect(worker.processNext()).resolves.toEqual({ status: "SUCCEEDED" });
  await expect(worker.processNext()).resolves.toEqual({ status: "IDLE" });
  const obligations = () => database.commercialCompensationObligation.findMany({
    where: { workspaceId: workspace.id, sellerMemberId: sdr.id, competenceMonth: "2026-11" }, orderBy: { kind: "asc" },
  });
  expect(await obligations()).toMatchObject([
    { kind: "SDR_COMMISSION", status: "ELIGIBLE", amountCents: 303n, dueOn: date("2026-12-07") },
    { kind: "SDR_BONUS", status: "ELIGIBLE", amountCents: 99n, dueOn: date("2026-12-07") },
  ]);
  const paymentContext = { workspaceId: workspace.id, actorId: actor.id } as AuthenticatedContext;
  const commissionKey = `sdr:SDR_COMMISSION:${sdr.id}:2026-11`;
  await expect(applyCommercialCompensationCommand(database, paymentContext, {
    action: "APPROVE_COMPENSATION", obligationKey: commissionKey, expectedRevision: 1,
  }, evaluationAt)).resolves.toMatchObject({ status: "APPROVED", revision: 2 });
  const lateCorrection = date("2026-12-01T18:00:00Z");
  await database.meetingHistory.create({ data: {
    workspaceId: workspace.id, meetingId: held.id, leadId: historicalLead.id, ownerMemberId: other.id, meetingRevision: 3,
    action: "NO_SHOW", previousStatus: "COMPLETED", newStatus: "NO_SHOW", newStartsAt: scheduledAt,
    newEndsAt: new Date(scheduledAt.getTime() + 30 * 60_000), occurredAt: lateCorrection, createdAt: lateCorrection, recordedByActorId: actor.id,
  } });
  evaluationAt = date("2026-12-02T15:00:00Z");
  await expect(applyCommercialCompensationCommand(database, paymentContext, {
    action: "SETTLE_COMPENSATION", obligationKey: commissionKey, expectedRevision: 2,
    financialAccountId: randomUUID(), amountCents: 303n, settledAt: evaluationAt,
    reference: "Transferência sintética", evidence: "Comprovante sintético", idempotencyKey: randomUUID(),
  }, evaluationAt)).rejects.toMatchObject({ code: "FINANCE_COMPENSATION_REVALIDATION" });
  await expect(worker.processNext()).resolves.toEqual({ status: "SUCCEEDED" });
  expect(await obligations()).toMatchObject([
    { kind: "SDR_COMMISSION", status: "REVIEW", amountCents: 303n },
    { kind: "SDR_BONUS", status: "REVIEW", amountCents: 99n },
  ]);
  const revisions = await database.sdrAdvertisingSnapshot.findMany({
    where: { workspaceId: workspace.id, memberId: sdr.id, periodKind: "MONTH", periodStartOn: date("2026-11-01") },
    orderBy: { revision: "asc" },
  });
  expect(revisions).toMatchObject([
    { revision: 1, facts: { attainment: { band: 100 } } },
    { revision: 2, facts: { attainment: { band: 0 } } },
  ]);

  const transferred = await lead(early);
  await fact("LEAD_CREATED", transferred.id, early, { leadOwnerMemberIdAtEvent: other.id });
  await database.leadAssignment.create({ data: {
    workspaceId: workspace.id, leadId: transferred.id, toMemberId: sdr.id, type: "MANUAL",
    assignedAt: arrivalAt, createdAt: arrivalAt, createdByActorId: actor.id,
  } });
  await fact("MEETING_SCHEDULED", transferred.id, early, { bookedByMemberId: other.id });
  await meeting(transferred.id, bookedAt, "ATTENDED");
  const directlyBooked = await lead(early);
  await fact("LEAD_CREATED", directlyBooked.id, early, { leadOwnerMemberIdAtEvent: other.id });
  await meeting(directlyBooked.id, bookedAt, "ATTENDED");
  const movedAway = await lead(early);
  await fact("LEAD_CREATED", movedAway.id, early, { leadOwnerMemberIdAtEvent: other.id });
  const prospectingStage = await database.pipelineStage.create({ data: { ...audit, pipelineId: pros.id, name: "Entrada", position: 1 } });
  await database.stageHistory.create({ data: {
    workspaceId: workspace.id, pipelineId: pros.id, stageId: prospectingStage.id,
    leadId: movedAway.id, enteredAt: arrivalAt, createdAt: arrivalAt, enteredByActorId: actor.id,
  } });
  await database.leadAssignment.create({ data: {
    workspaceId: workspace.id, leadId: movedAway.id, toMemberId: sdr.id, type: "MANUAL",
    assignedAt: bookedAt, createdAt: bookedAt, createdByActorId: actor.id,
  } });
  const transferredFacts = await read();
  expect(transferredFacts.counts).toMatchObject({ leads: 3, bookedLeads: 3, eligibleMeetings: 3, heldMeetings: 3 });
  expect(transferredFacts.bookedLeadIds).toEqual(expect.arrayContaining([transferred.id, directlyBooked.id]));
});
