import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createDailyGoalService } from "@/modules/goals/application/daily-goal-service";
import { createSdrQueueService } from "@/modules/leads/application/sdr-queue-service";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { createMetricsService } from "@/modules/metrics/application/metrics-service";
import { createProspectingWorkspaceService } from "@/modules/prospecting/application/prospecting-workspace-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for daily goal tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString) });
const authorization = createAuthorizationService({ database });
const now = new Date("2033-05-10T15:00:00.000Z");
let manager: AuthenticatedContext;
let sdr: AuthenticatedContext;

async function contextFor(workspaceId: string, email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return Object.freeze({ sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName });
}

beforeAll(async () => {
  const seed = await seedDemoDatabase(database);
  manager = await contextFor(seed.workspaceId, "gestor@demo.politizai.local");
  sdr = await contextFor(seed.workspaceId, "sdr1@demo.politizai.local");
});

afterAll(async () => database.$disconnect());

describe("metas diárias configuráveis", () => {
  it("permite ao gestor configurar uma pessoa e o Meu Dia usa os alvos persistidos", async () => {
    const service = createDailyGoalService({ database, authorization });
    const profile = await service.save(manager, { memberId: sdr.memberId, expectedRevision: null, callsTarget: 50, messagesTarget: 40, effectiveContactsTarget: 10, qualificationsTarget: 5, meetingsScheduledTarget: 3, proposalsTarget: 2, salesValueTargetCents: "2500000" });
    expect(profile).toMatchObject({ memberId: sdr.memberId, callsTarget: 50, salesValueTargetCents: "2500000", revision: 1 });

    const screen = await createSdrQueueService({ database, authorization, now: () => now }).getScreen(sdr, {});
    expect(screen.permissions.manageDailyGoals).toBe(false);
    expect(screen.dailyGoalProfiles).toEqual([]);
    expect(screen.dailyProduction.dailyGoal).toMatchObject({ configured: true, configuredMembers: 1, expectedMembers: 1, target: 7 });
    expect(screen.dailyProduction.dailyGoal.metrics.find((metric) => metric.key === "CALLS")?.targetValue).toBe("50");
    expect(screen.dailyProduction.dailyGoal.metrics.find((metric) => metric.key === "SALES_VALUE_CENTS")?.targetValue).toBe("2500000");

    const managerScreen = await createSdrQueueService({ database, authorization, now: () => now }).getScreen(manager, {});
    expect(managerScreen.dailyGoalMemberOptions.some((member) => member.name === "Closer 1 de demonstração")).toBe(true);
  });

  it("bloqueia vendedor sem permissão de gestão", async () => {
    await expect(createDailyGoalService({ database, authorization }).save(sdr, { memberId: sdr.memberId, expectedRevision: 1, callsTarget: 60, messagesTarget: 40, effectiveContactsTarget: 10, qualificationsTarget: 5, meetingsScheduledTarget: 3, proposalsTarget: 2, salesValueTargetCents: "2500000" })).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("mantém ações e contatos efetivos de Meu Dia e Prospecção iguais ao log de Indicadores", async () => {
    const period = { from: "2033-05-10T03:00:00.000Z", to: "2033-05-11T03:00:00.000Z", filters: { sdrMemberIds: [sdr.memberId] } };
    const metricService = createMetricsService({ database, authorization, now: () => now });
    const queueService = createSdrQueueService({ database, authorization, now: () => now });
    const prospectingService = createProspectingWorkspaceService({ database, authorization, now: () => now });
    const beforeDay = await queueService.getScreen(sdr, {});
    const beforeProspecting = await prospectingService.getScreen(manager, {});
    const beforeMetrics = await metricService.getIntegratedOverview(manager, period);
    const eventId = randomUUID();
    const touchedLead = await database.lead.findFirstOrThrow({ where: { workspaceId: sdr.workspaceId }, select: { id: true } });
    for (const [suffix, eventType, result] of [
      ["call-attempt", "CALL_ATTEMPTED", null],
      ["call-without-outcome", "CALL_ATTEMPTED", null],
      ["call-result", "CALL_UNANSWERED", "NO_ANSWER"],
      ["instagram", "INSTAGRAM_MESSAGE_SENT", null],
      ["follow", "INSTAGRAM_FOLLOW_COMPLETED", null],
      ["email", "EMAIL_SENT", null],
    ] as const) await recordCommercialMetricFactInTransaction(database, {
      workspaceId: sdr.workspaceId,
      eventKey: `daily-goal:${eventId}:${suffix}:v1`,
      eventType,
      occurredAt: now,
      sourceEntityType: "DailyGoalParityFixture",
      sourceEntityId: eventId,
      creditedMemberId: sdr.memberId,
      leadId: touchedLead.id,
      result,
    });
    const qualifiedLeadId = randomUUID();
    for (const suffix of ["first-qualification", "repeat-qualification"]) await recordCommercialMetricFactInTransaction(database, {
      workspaceId: sdr.workspaceId,
      eventKey: `daily-goal:${eventId}:${suffix}:v1`,
      eventType: "LEAD_QUALIFIED",
      occurredAt: now,
      sourceEntityType: "DailyGoalParityFixture",
      sourceEntityId: eventId,
      creditedMemberId: sdr.memberId,
      leadId: qualifiedLeadId,
    });
    for (const [suffix, eventType] of [["connected", "CALL_CONNECTED"], ["response", "INBOUND_MESSAGE_RECEIVED"]] as const) await recordCommercialMetricFactInTransaction(database, {
      workspaceId: sdr.workspaceId,
      eventKey: `daily-goal:${eventId}:${suffix}:v1`,
      eventType,
      occurredAt: now,
      sourceEntityType: "DailyGoalParityFixture",
      sourceEntityId: eventId,
      creditedMemberId: sdr.memberId,
      leadId: qualifiedLeadId,
    });
    await recordCommercialMetricFactInTransaction(database, {
      workspaceId: sdr.workspaceId,
      eventKey: `daily-goal:${eventId}:meeting-scheduled:v1`,
      eventType: "MEETING_SCHEDULED",
      occurredAt: now,
      sourceEntityType: "MeetingHistory",
      sourceEntityId: eventId,
      creditedMemberId: manager.memberId,
      bookedByMemberId: sdr.memberId,
      performedByMemberId: sdr.memberId,
      leadId: qualifiedLeadId,
      executionMode: "MANUAL",
    });
    const afterDay = await queueService.getScreen(sdr, {});
    const afterProspecting = await prospectingService.getScreen(manager, {});
    const afterMetrics = await metricService.getIntegratedOverview(manager, period);
    const value = (overview: typeof afterMetrics, metricId: string) => Number(overview.values.find((metric) => metric.metricId === metricId)?.value ?? 0);
    expect(afterDay.dailyProduction.calls - beforeDay.dailyProduction.calls).toBe(value(afterMetrics, "outreach.calls_attempted") - value(beforeMetrics, "outreach.calls_attempted"));
    expect(afterDay.dailyProduction.callsNoAnswer - beforeDay.dailyProduction.callsNoAnswer).toBe(value(afterMetrics, "outreach.calls_no_answer") - value(beforeMetrics, "outreach.calls_no_answer"));
    expect(afterDay.dailyProduction.callsUnanswered - beforeDay.dailyProduction.callsUnanswered).toBe(value(afterMetrics, "outreach.calls_unanswered") - value(beforeMetrics, "outreach.calls_unanswered"));
    expect(afterDay.dailyProduction.callsWithoutOutcome - beforeDay.dailyProduction.callsWithoutOutcome).toBe(1);
    expect(afterDay.dailyProduction.instagramMessagesSent - beforeDay.dailyProduction.instagramMessagesSent).toBe(value(afterMetrics, "outreach.instagram_messages") - value(beforeMetrics, "outreach.instagram_messages"));
    expect(afterDay.dailyProduction.instagramFollowsCompleted - beforeDay.dailyProduction.instagramFollowsCompleted).toBe(value(afterMetrics, "outreach.instagram_follows") - value(beforeMetrics, "outreach.instagram_follows"));
    expect(afterDay.dailyProduction.emails - beforeDay.dailyProduction.emails).toBe(value(afterMetrics, "email.sent") - value(beforeMetrics, "email.sent"));
    expect(afterDay.dailyProduction.outreachLeadsTouched - beforeDay.dailyProduction.outreachLeadsTouched).toBe(value(afterMetrics, "work.politicians_touched") - value(beforeMetrics, "work.politicians_touched"));
    const effectiveContacts = (screen: typeof afterDay) => Number(screen.dailyProduction.dailyGoal.metrics.find((metric) => metric.key === "EFFECTIVE_CONTACTS")?.actualValue ?? 0);
    const sellerContacts = (screen: typeof afterProspecting) => screen.metrics.dailyBySeller.find((row) => row.memberId === sdr.memberId)?.effectiveContacts ?? 0;
    const contactDelta = value(afterMetrics, "outreach.effective_contacts") - value(beforeMetrics, "outreach.effective_contacts");
    expect(contactDelta).toBe(1);
    expect(effectiveContacts(afterDay) - effectiveContacts(beforeDay)).toBe(contactDelta);
    expect(sellerContacts(afterProspecting) - sellerContacts(beforeProspecting)).toBe(contactDelta);
    const qualifications = (screen: typeof afterDay) => Number(screen.dailyProduction.dailyGoal.metrics.find((metric) => metric.key === "QUALIFICATIONS")?.actualValue ?? 0);
    expect(qualifications(afterDay) - qualifications(beforeDay)).toBe(value(afterMetrics, "qualification.leads") - value(beforeMetrics, "qualification.leads"));
    const meetingDelta = value(afterMetrics, "meetings.scheduled") - value(beforeMetrics, "meetings.scheduled");
    const sellerMeetings = (screen: typeof afterProspecting) => screen.metrics.dailyBySeller.find((row) => row.memberId === sdr.memberId)?.meetingsScheduled ?? 0;
    expect(meetingDelta).toBe(1);
    expect(afterDay.dailyProduction.meetingsScheduled - beforeDay.dailyProduction.meetingsScheduled).toBe(meetingDelta);
    expect(sellerMeetings(afterProspecting) - sellerMeetings(beforeProspecting)).toBe(meetingDelta);
  }, 60_000);
});
