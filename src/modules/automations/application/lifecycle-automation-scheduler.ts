import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  automationConditionsSchema,
  type InternalAutomationEvent,
  type PublicationResult,
} from "@/modules/automations/domain/automation-contracts";
import { matchesAutomationConditions } from "@/modules/automations/domain/automation-policy";
import { addLocalDays, addWorkspaceCalendarDays, parseWorkspaceLocalDateTime, workspaceDateAt } from "@/shared/core/time/workspace-time";

export type TransactionalAutomationPublisher = Readonly<{
  publishInTransaction: (
    transaction: Prisma.TransactionClient,
    event: InternalAutomationEvent,
  ) => Promise<PublicationResult>;
}>;

type LifecycleEventBase = Readonly<{
  workspaceId: string;
  leadId: string;
  occurredAt: Date;
  actorId: string;
}>;

const EXISTING_RUN_LOOKUP_BATCH_SIZE = 1_000;

type LifecycleCandidate = Readonly<{
  idempotencyKey: string;
  event: InternalAutomationEvent;
}>;

async function findExistingRunKeys(
  database: PrismaClient,
  workspaceId: string,
  keys: readonly string[],
): Promise<ReadonlySet<string>> {
  const existing = new Set<string>();
  for (let offset = 0; offset < keys.length; offset += EXISTING_RUN_LOOKUP_BATCH_SIZE) {
    const rows = await database.automationRun.findMany({
      where: {
        workspaceId,
        idempotencyKey: { in: keys.slice(offset, offset + EXISTING_RUN_LOOKUP_BATCH_SIZE) },
      },
      select: { idempotencyKey: true },
    });
    for (const row of rows) existing.add(row.idempotencyKey);
  }
  return existing;
}

async function cancelRuns(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    actorId: string;
    now: Date;
    leadId?: string;
    meetingId?: string;
    category: string;
    reasonCode: string;
    reason: string;
    excludeAutomationRunId?: string;
  }>,
) {
  const runs = await transaction.automationRun.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.leadId ? { leadId: input.leadId } : {}),
      ...(input.meetingId ? { meetingId: input.meetingId } : {}),
      status: { in: ["PENDING", "RUNNING"] },
      ...(input.excludeAutomationRunId ? { id: { not: input.excludeAutomationRunId } } : {}),
      actionConfigSnapshot: { path: ["category"], equals: input.category },
    },
    select: { id: true, job: { select: { id: true, status: true } } },
  });
  for (const run of runs) {
    if (!run.job) continue;
    if (run.job.status === "RUNNING") {
      await transaction.job.update({
        where: { id: run.job.id },
        data: { cancelRequestedAt: input.now, updatedByActorId: input.actorId },
      });
      continue;
    }
    if (run.job.status !== "PENDING") continue;
    await transaction.job.update({
      where: { id: run.job.id },
      data: {
        status: "CANCELLED",
        cancelRequestedAt: input.now,
        cancelledAt: input.now,
        finishedAt: input.now,
        errorCode: input.reasonCode,
        lastError: input.reason,
        updatedByActorId: input.actorId,
      },
    });
    await transaction.automationRun.update({
      where: { id: run.id },
      data: {
        status: "CANCELLED",
        cancelledAt: input.now,
        finishedAt: input.now,
        errorCode: input.reasonCode,
        errorMessage: input.reason,
      },
    });
  }
  return runs.length;
}

export async function cancelOutreachCadencesInTransaction(
  transaction: Prisma.TransactionClient,
  input: LifecycleEventBase & Readonly<{ reasonCode: string; reason: string; excludeAutomationRunId?: string }>,
) {
  return cancelRuns(transaction, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    now: input.occurredAt,
    leadId: input.leadId,
    category: "OUTREACH_CADENCE",
    reasonCode: input.reasonCode,
    reason: input.reason,
    ...(input.excludeAutomationRunId
      ? { excludeAutomationRunId: input.excludeAutomationRunId }
      : {}),
  });
}

export async function scheduleNoAnswerCadenceInTransaction(
  transaction: Prisma.TransactionClient,
  publisher: TransactionalAutomationPublisher,
  input: LifecycleEventBase & Readonly<{ activityId: string }>,
) {
  const alreadyActive = await transaction.automationRun.count({
    where: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      status: { in: ["PENDING", "RUNNING"] },
      actionConfigSnapshot: { path: ["category"], equals: "OUTREACH_CADENCE" },
    },
  });
  if (alreadyActive > 0) return Object.freeze({ scheduled: 0, alreadyActive: true });

  const [settings, lead] = await Promise.all([transaction.commercialSettingsVersion.findFirst({
    where: { workspaceId: input.workspaceId },
    orderBy: [{ revision: "desc" }, { id: "desc" }],
    include: {
      cadence: { orderBy: [{ attemptNumber: "asc" }, { id: "asc" }] },
      workspace: { select: { timeZone: true } },
    },
  }), transaction.lead.findFirst({ where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null }, select: { currentStageId: true } })]);
  if (!settings || !lead) return Object.freeze({ scheduled: 0, alreadyActive: false });

  let scheduled = 0;
  for (const step of settings.cadence) {
    const localDate = addLocalDays(workspaceDateAt(input.occurredAt, settings.workspace.timeZone), step.dayOffset);
    const configuredAt = step.timeOfDay
      ? parseWorkspaceLocalDateTime(`${localDate}T${step.timeOfDay}`, settings.workspace.timeZone)
      : addWorkspaceCalendarDays(input.occurredAt, step.dayOffset, settings.workspace.timeZone);
    const runAt = configuredAt < input.occurredAt ? input.occurredAt : configuredAt;
    const result = await publisher.publishInTransaction(transaction, {
      workspaceId: input.workspaceId,
      triggerType: "CALL_UNANSWERED",
      idempotencyKey: `no-answer:${input.activityId}:d${step.dayOffset}`,
      occurredAt: input.occurredAt,
      runAt,
      triggeredByActorId: input.actorId,
      priority: Math.max(1, 80 - step.dayOffset),
      payload: {
        eventType: "NO_ANSWER_CADENCE",
        leadId: input.leadId,
        activityId: input.activityId,
        attemptNumber: step.attemptNumber,
        dayOffset: step.dayOffset,
        cadenceAction: step.action,
        cadenceMessage: step.message,
        assigneeMemberId: step.assigneeMemberId,
        targetStageId: step.targetStageId,
        initialStageId: lead.currentStageId,
        stopOnReply: settings.cadenceStopOnReply,
        stopOnMeetingScheduled: settings.cadenceStopOnMeetingScheduled,
        stopOnStageChange: settings.cadenceStopOnStageChange,
        cadenceTemplateKey: settings.cadenceTemplateKey,
        cadenceStartedAt: input.occurredAt.toISOString(),
        scheduledFor: runAt.toISOString(),
        settingsRevision: settings.revision,
        timeZone: settings.workspace.timeZone,
      },
    });
    scheduled += result.scheduled.length;
  }
  return Object.freeze({ scheduled, alreadyActive: false });
}

export async function publishLeadQualifiedInTransaction(
  transaction: Prisma.TransactionClient,
  publisher: TransactionalAutomationPublisher,
  input: LifecycleEventBase & Readonly<{ activityId?: string }>,
) {
  return publisher.publishInTransaction(transaction, {
    workspaceId: input.workspaceId,
    triggerType: "LEAD_QUALIFIED",
    idempotencyKey: `lead-qualified:${input.leadId}:${input.occurredAt.toISOString()}`,
    occurredAt: input.occurredAt,
    triggeredByActorId: input.actorId,
    priority: 70,
    payload: {
      eventType: "LEAD_QUALIFIED",
      leadId: input.leadId,
      activityId: input.activityId ?? null,
    },
  });
}

export async function scheduleMeetingRemindersInTransaction(
  transaction: Prisma.TransactionClient,
  publisher: TransactionalAutomationPublisher,
  input: LifecycleEventBase & Readonly<{
    meetingId: string;
    meetingRevision: number;
    startsAt: Date;
  }>,
) {
  const cancelled = await cancelRuns(transaction, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    now: input.occurredAt,
    meetingId: input.meetingId,
    category: "MEETING_REMINDER",
    reasonCode: "MEETING_RESCHEDULED",
    reason: "Lembrete cancelado porque a reunião recebeu uma nova revisão.",
  });
  let scheduled = 0;
  for (const reminderMinutes of [1_440, 120, 15] as const) {
    const target = new Date(input.startsAt.getTime() - reminderMinutes * 60_000);
    const runAt = target > input.occurredAt ? target : input.occurredAt;
    const result = await publisher.publishInTransaction(transaction, {
      workspaceId: input.workspaceId,
      triggerType: "MEETING_SCHEDULED",
      idempotencyKey: `meeting-reminder:${input.meetingId}:r${input.meetingRevision}:m${reminderMinutes}`,
      occurredAt: input.occurredAt,
      runAt,
      triggeredByActorId: input.actorId,
      priority: 60,
      payload: {
        eventType: "MEETING_REMINDER",
        leadId: input.leadId,
        meetingId: input.meetingId,
        meetingRevision: input.meetingRevision,
        reminderMinutes,
        expectedStartsAt: input.startsAt.toISOString(),
      },
    });
    scheduled += result.scheduled.length;
  }
  return Object.freeze({ scheduled, cancelled });
}

export async function cancelMeetingRemindersInTransaction(
  transaction: Prisma.TransactionClient,
  input: LifecycleEventBase & Readonly<{ meetingId: string; reasonCode: string; reason: string }>,
) {
  return cancelRuns(transaction, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    now: input.occurredAt,
    meetingId: input.meetingId,
    category: "MEETING_REMINDER",
    reasonCode: input.reasonCode,
    reason: input.reason,
  });
}

export async function publishMeetingNoShowInTransaction(
  transaction: Prisma.TransactionClient,
  publisher: TransactionalAutomationPublisher,
  input: LifecycleEventBase & Readonly<{ meetingId: string; meetingRevision: number; recoveryTaskId: string | null }>,
) {
  await cancelRuns(transaction, {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    now: input.occurredAt,
    meetingId: input.meetingId,
    category: "MEETING_REMINDER",
    reasonCode: "MEETING_CLOSED",
    reason: "Lembretes cancelados porque a reunião foi encerrada como no-show.",
  });
  return publisher.publishInTransaction(transaction, {
    workspaceId: input.workspaceId,
    triggerType: "MEETING_NO_SHOW",
    idempotencyKey: `meeting-no-show:${input.meetingId}:r${input.meetingRevision}`,
    occurredAt: input.occurredAt,
    triggeredByActorId: input.actorId,
    priority: 85,
    payload: {
      eventType: "MEETING_NO_SHOW",
      leadId: input.leadId,
      meetingId: input.meetingId,
      meetingRevision: input.meetingRevision,
      recoveryTaskId: input.recoveryTaskId,
    },
  });
}

export async function publishOpportunityClosedInTransaction(
  transaction: Prisma.TransactionClient,
  publisher: TransactionalAutomationPublisher,
  input: LifecycleEventBase & Readonly<{ opportunityId: string; status: "WON" | "LOST" }>,
) {
  return publisher.publishInTransaction(transaction, {
    workspaceId: input.workspaceId,
    triggerType: "OPPORTUNITY_CLOSED",
    idempotencyKey: `opportunity-closed:${input.opportunityId}:${input.status}:${input.occurredAt.toISOString()}`,
    occurredAt: input.occurredAt,
    triggeredByActorId: input.actorId,
    priority: 75,
    payload: {
      eventType: "OPPORTUNITY_CLOSED",
      leadId: input.leadId,
      opportunityId: input.opportunityId,
      status: input.status,
    },
  });
}

export function createLifecycleAutomationScanner(options: Readonly<{
  database: PrismaClient;
  publish: (event: InternalAutomationEvent) => Promise<PublicationResult>;
  now: () => Date;
}>) {
  async function scanDue() {
    const now = options.now();
    const workspaces = await options.database.workspace.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        commercialSettings: {
          orderBy: [{ revision: "desc" }, { id: "desc" }],
          take: 1,
          select: { revision: true, leadStagnationDays: true },
        },
      },
    });
    let published = 0;
    for (const workspace of workspaces) {
      const settings = workspace.commercialSettings[0];
      if (!settings) continue;
      const stagnationCut = new Date(now.getTime() - settings.leadStagnationDays * 86_400_000);
      const commonLeadFilter: Prisma.LeadWhereInput = {
        workspaceId: workspace.id,
        status: { in: ["OPEN", "QUALIFIED"] },
        deletedAt: null,
      };
      const rules = await options.database.automationRule.findMany({
        where: {
          workspaceId: workspace.id,
          triggerType: { in: ["LEAD_STAGNANT", "LEAD_WITHOUT_NEXT_ACTION"] },
          status: "ACTIVE",
          deletedAt: null,
        },
        select: { id: true, triggerType: true, conditions: true },
      });
      if (rules.length === 0) continue;
      const [stagnantLeads, leadsWithoutNextAction] = await Promise.all([
        options.database.lead.findMany({
          where: {
            ...commonLeadFilter,
            stageHistory: { some: { exitedAt: null, enteredAt: { lte: stagnationCut } } },
          },
          select: {
            id: true,
            stageHistory: {
              where: { exitedAt: null },
              orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { id: true, enteredAt: true },
            },
          },
        }),
        options.database.lead.findMany({
          where: {
            ...commonLeadFilter,
            OR: [
              { nextActionTaskId: null },
              { tasks: { none: { status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null } } },
            ],
          },
          select: { id: true, updatedAt: true },
        }),
      ]);
      const candidates: LifecycleCandidate[] = [];
      for (const lead of stagnantLeads) {
        const history = lead.stageHistory[0];
        if (history && history.enteredAt <= stagnationCut) {
          const idempotencyKey = `lead-stagnant:${lead.id}:${history.id}:settings-${settings.revision}`;
          candidates.push({
            idempotencyKey,
            event: {
              workspaceId: workspace.id,
              triggerType: "LEAD_STAGNANT",
              idempotencyKey,
              occurredAt: now,
              priority: 45,
              payload: {
                eventType: "LEAD_STAGNANT",
                leadId: lead.id,
                stageHistoryId: history.id,
                settingsRevision: settings.revision,
                thresholdDays: settings.leadStagnationDays,
              },
            },
          });
        }
      }
      for (const lead of leadsWithoutNextAction) {
        const idempotencyKey = `lead-without-next-action:${lead.id}:${lead.updatedAt.toISOString()}`;
        candidates.push({
          idempotencyKey,
          event: {
            workspaceId: workspace.id,
            triggerType: "LEAD_WITHOUT_NEXT_ACTION",
            idempotencyKey,
            occurredAt: now,
            priority: 90,
            payload: {
              eventType: "LEAD_WITHOUT_NEXT_ACTION",
              leadId: lead.id,
              detectedUpdatedAt: lead.updatedAt.toISOString(),
            },
          },
        });
      }
      const candidatesWithRunKeys = candidates.map((candidate) => ({
        candidate,
        runKeys: rules.flatMap((rule) => {
          if (rule.triggerType !== candidate.event.triggerType) return [];
          const conditions = automationConditionsSchema.safeParse(rule.conditions);
          if (!conditions.success || !matchesAutomationConditions(candidate.event.payload, conditions.data)) {
            return [];
          }
          return [`${candidate.idempotencyKey}:rule:${rule.id}`];
        }),
      }));
      const existingKeys = await findExistingRunKeys(
        options.database,
        workspace.id,
        candidatesWithRunKeys.flatMap(({ runKeys }) => runKeys),
      );
      for (const { candidate, runKeys } of candidatesWithRunKeys) {
        if (runKeys.length === 0 || runKeys.every((key) => existingKeys.has(key))) continue;
        const result = await options.publish(candidate.event);
        published += result.scheduled.filter((item) => !item.duplicated).length;
      }
    }
    return Object.freeze({ workspaces: workspaces.length, published });
  }
  return Object.freeze({ scanDue });
}
