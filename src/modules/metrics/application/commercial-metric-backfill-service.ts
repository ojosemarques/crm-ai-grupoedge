import { createHash } from "node:crypto";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { CommercialMetricEventType, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  commercialMetricFactFingerprint,
  type CommercialMetricFactInput,
  recordCommercialMetricFactInTransaction,
} from "@/modules/metrics/application/commercial-metric-fact-writer";
import { prospectingTaskMetricEvents } from "@/modules/prospecting/domain/prospecting-task-metric-events";
import { manualActivityMetricEvents } from "@/modules/metrics/domain/manual-activity-metric-events";
import { manualActivityCorrectionFacts, type ManualActivityFactBasis } from "@/modules/metrics/application/manual-activity-correction-facts";
import { missingPhoneCallEvents, phoneCallMetricEventType } from "@/modules/metrics/domain/phone-call-metric-events";
import { messageStatusMetricEventType } from "@/modules/metrics/domain/message-status-metric-events";
import { COMMERCIAL_METRIC_BACKFILL_RULE_VERSION } from "@/modules/metrics/domain/commercial-metric-quality";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const RULE_VERSION = COMMERCIAL_METRIC_BACKFILL_RULE_VERSION;
const inputSchema = z.object({
  mode: z.enum(["DRY_RUN", "APPLY"]),
  runKey: z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{7,160}$/),
  batchSize: z.number().int().min(10).max(1_000).default(250),
}).strict();

type SourceRow = Readonly<{ id: string; candidates: readonly CommercialMetricFactInput[] }>;
type Source = Readonly<{
  name: string;
  fetch: (cursor: string | null, take: number) => Promise<readonly SourceRow[]>;
}>;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sources(database: PrismaClient, workspaceId: string): readonly Source[] {
  const page = <T extends { id: string }>(values: readonly T[], build: (value: T) => readonly CommercialMetricFactInput[]): readonly SourceRow[] =>
    values.map((value) => ({ id: value.id, candidates: build(value) }));

  return [
    {
      name: "contacts",
      fetch: async (cursor, take) => page(await database.contact.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, createdAt: true, jobTitle: true },
      }), (contact) => [{
        workspaceId, eventKey: `contact:${contact.id}:created:v1`, eventType: "CONTACT_CREATED", occurredAt: contact.createdAt,
        sourceEntityType: "Contact", sourceEntityId: contact.id, contactId: contact.id, politicalRole: contact.jobTitle,
        safeMetadata: { provenance: "backfill" },
      }]),
    },
    {
      name: "lead_submissions",
      fetch: async (cursor, take) => page(await database.leadFormSubmission.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, leadId: true, contactId: true, sourceId: true, campaignId: true, creativeId: true, submittedAt: true, channel: true },
      }), (submission) => [{
        workspaceId, eventKey: `submission:${submission.id}:attached:v1`, eventType: "LEAD_SUBMISSION_ATTACHED", occurredAt: submission.submittedAt,
        sourceEntityType: "LeadFormSubmission", sourceEntityId: submission.id, leadId: submission.leadId, contactId: submission.contactId,
        sourceId: submission.sourceId, campaignId: submission.campaignId, creativeId: submission.creativeId, channel: submission.channel,
        safeMetadata: { provenance: "backfill" },
      }]),
    },
    {
      name: "leads",
      fetch: async (cursor, take) => page(await database.lead.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, contactId: true, accountId: true, pipelineId: true, currentStageId: true, ownerMemberId: true, sourceId: true, campaignId: true, creativeId: true, jobTitle: true, city: true, stateCode: true, createdAt: true },
      }), (lead) => [{
        workspaceId, eventKey: `lead:${lead.id}:created:v1`, eventType: "LEAD_CREATED", occurredAt: lead.createdAt,
        sourceEntityType: "Lead", sourceEntityId: lead.id, leadId: lead.id, contactId: lead.contactId, accountId: lead.accountId,
        pipelineId: lead.pipelineId, stageId: lead.currentStageId, creditedMemberId: lead.ownerMemberId, leadOwnerMemberIdAtEvent: lead.ownerMemberId,
        sourceId: lead.sourceId, campaignId: lead.campaignId, creativeId: lead.creativeId, politicalRole: lead.jobTitle,
        municipality: lead.city, stateCode: lead.stateCode, safeMetadata: { provenance: "backfill", ownerBasis: "current_snapshot" },
      }]),
    },
    {
      name: "stage_history",
      fetch: async (cursor, take) => {
        const histories = await database.stageHistory.findMany({
          where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: {
            id: true, leadId: true, opportunityId: true, pipelineId: true, stageId: true,
            enteredAt: true, exitedAt: true, transitionOrigin: true,
            enteredBy: { select: { userId: true } },
            stage: { select: { leadStageCode: true } },
            lead: { select: { ownerMemberId: true } },
          },
        });
        const userIds = histories.flatMap((history) => history.enteredBy.userId ? [history.enteredBy.userId] : []);
        const members = await database.workspaceMember.findMany({
          where: { workspaceId, userId: { in: userIds }, deletedAt: null },
          select: { id: true, userId: true },
        });
        const memberByUserId = new Map(members.map((member) => [member.userId, member.id]));
        return page(histories, (history) => {
          const performedByMemberId = history.enteredBy.userId
            ? memberByUserId.get(history.enteredBy.userId) ?? null
            : null;
          const executionMode = history.transitionOrigin === "AUTOMATION"
            ? "AUTOMATION" as const
            : history.transitionOrigin === "SYSTEM" || history.transitionOrigin === "INTAKE"
              ? "SYSTEM" as const
              : "MANUAL" as const;
          const bookingMemberId = performedByMemberId ?? history.lead?.ownerMemberId ?? null;
          return [{
            workspaceId, eventKey: `stage-history:${history.id}:entered:v1`, eventType: "STAGE_ENTERED", occurredAt: history.enteredAt,
            sourceEntityType: "StageHistory", sourceEntityId: history.id, leadId: history.leadId, opportunityId: history.opportunityId,
            pipelineId: history.pipelineId, stageId: history.stageId, toStageId: history.stageId,
            creditedMemberId: history.lead?.ownerMemberId ?? null, performedByMemberId,
            leadOwnerMemberIdAtEvent: history.lead?.ownerMemberId ?? null, executionMode,
            safeMetadata: { provenance: "backfill" },
          }, ...(history.exitedAt ? [{
            workspaceId, eventKey: `stage-history:${history.id}:exited:v1`, eventType: "STAGE_EXITED" as const, occurredAt: history.exitedAt,
            sourceEntityType: "StageHistory", sourceEntityId: history.id, leadId: history.leadId, opportunityId: history.opportunityId,
            pipelineId: history.pipelineId, stageId: history.stageId, fromStageId: history.stageId,
            creditedMemberId: history.lead?.ownerMemberId ?? null, leadOwnerMemberIdAtEvent: history.lead?.ownerMemberId ?? null,
            safeMetadata: { provenance: "backfill" },
          }] : []), ...(history.stage.leadStageCode === "MEETING_SCHEDULED" && history.transitionOrigin !== "MEETING" ? [{
            workspaceId, eventKey: `stage-history:${history.id}:meeting-scheduled:v1`, eventType: "MEETING_SCHEDULED" as const, occurredAt: history.enteredAt,
            sourceEntityType: "StageHistory", sourceEntityId: history.id, leadId: history.leadId,
            pipelineId: history.pipelineId, stageId: history.stageId, toStageId: history.stageId,
            creditedMemberId: bookingMemberId, performedByMemberId, bookedByMemberId: bookingMemberId,
            leadOwnerMemberIdAtEvent: history.lead?.ownerMemberId ?? null, executionMode,
            result: "STAGE_TRANSITION", safeMetadata: { provenance: "backfill", bookingBasis: "meeting_scheduled_stage_entry" },
          }] : []), ...(["QUALIFIED", "DISQUALIFIED"].includes(history.stage.leadStageCode ?? "") ? [{
            workspaceId, eventKey: `stage-history:${history.id}:${history.stage.leadStageCode!.toLowerCase()}:v1`,
            eventType: history.stage.leadStageCode === "QUALIFIED" ? "LEAD_QUALIFIED" as const : "LEAD_DISQUALIFIED" as const,
            occurredAt: history.enteredAt, sourceEntityType: "StageHistory", sourceEntityId: history.id,
            leadId: history.leadId, opportunityId: history.opportunityId,
            pipelineId: history.pipelineId, stageId: history.stageId,
            creditedMemberId: history.lead?.ownerMemberId ?? null, performedByMemberId,
            leadOwnerMemberIdAtEvent: history.lead?.ownerMemberId ?? null, executionMode,
            safeMetadata: { provenance: "backfill", ownerBasis: "current_snapshot" },
          }] : [])];
        });
      },
    },
    {
      name: "tasks",
      fetch: async (cursor, take) => {
        const tasks = await database.task.findMany({
          where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: { id: true, leadId: true, opportunityId: true, meetingId: true, assigneeMemberId: true, kind: true, status: true, result: true, createdAt: true, completedAt: true, automationRunId: true },
        });
        const logs = await database.auditLog.findMany({
          where: { workspaceId, entityType: "Task", entityId: { in: tasks.map((task) => task.id) }, action: { in: ["task.completed", "task.bulk_completed"] } },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: { entityId: true, actor: { select: { userId: true, type: true } } },
        });
        const members = await database.workspaceMember.findMany({
          where: { workspaceId, userId: { in: logs.flatMap((log) => log.actor.type === "HUMAN" && log.actor.userId ? [log.actor.userId] : []) } },
          select: { id: true, userId: true },
        });
        const memberByUserId = new Map(members.map((member) => [member.userId, member.id]));
        const completionByTaskId = new Map<string, (typeof logs)[number]>();
        for (const log of logs) if (!completionByTaskId.has(log.entityId)) completionByTaskId.set(log.entityId, log);
        return page(tasks, (task) => {
          const completionActor = completionByTaskId.get(task.id)?.actor;
          const performer = completionActor?.type === "HUMAN" && completionActor.userId ? memberByUserId.get(completionActor.userId) ?? null : null;
          const credited = performer ?? task.assigneeMemberId;
          const executionMode = completionActor?.type === "HUMAN" ? "MANUAL" as const
            : task.automationRunId || completionActor?.type === "AUTOMATION" ? "AUTOMATION" as const : "SYSTEM" as const;
          return [{
            workspaceId, eventKey: `task:${task.id}:created:v1`, eventType: "TASK_CREATED", occurredAt: task.createdAt,
            sourceEntityType: "Task", sourceEntityId: task.id, leadId: task.leadId, opportunityId: task.opportunityId,
            meetingId: task.meetingId, taskId: task.id, creditedMemberId: task.assigneeMemberId, taskKind: task.kind,
            executionMode: task.automationRunId ? "AUTOMATION" : "SYSTEM", safeMetadata: { provenance: "backfill" },
          }, ...(task.status === "COMPLETED" && task.completedAt ? [{
            workspaceId, eventKey: `task:${task.id}:completed:v1`, eventType: "TASK_COMPLETED" as const, occurredAt: task.completedAt,
            sourceEntityType: "Task", sourceEntityId: task.id, leadId: task.leadId, opportunityId: task.opportunityId,
            meetingId: task.meetingId, taskId: task.id, creditedMemberId: credited, performedByMemberId: performer, taskKind: task.kind, result: task.result,
            executionMode, safeMetadata: { provenance: "backfill", attributionBasis: performer ? "completion_actor" : "task_assignee" },
          }, ...prospectingTaskMetricEvents(task.kind, task.result).map((event) => ({
            workspaceId, eventKey: `task:${task.id}:${event.eventKeySuffix}:v1`, eventType: event.eventType, occurredAt: task.completedAt!,
            sourceEntityType: "Task", sourceEntityId: task.id, leadId: task.leadId, opportunityId: task.opportunityId,
            meetingId: task.meetingId, taskId: task.id, creditedMemberId: credited, performedByMemberId: performer, taskKind: task.kind, result: task.result,
            channel: event.channel, direction: "OUTBOUND", executionMode, safeMetadata: { provenance: "backfill", attributionBasis: performer ? "completion_actor" : "task_assignee" },
          }))] : []), ...(task.status === "CANCELLED" ? [{
            workspaceId, eventKey: `task:${task.id}:cancelled:v1`, eventType: "TASK_CANCELLED" as const, occurredAt: task.completedAt ?? task.createdAt,
            sourceEntityType: "Task", sourceEntityId: task.id, leadId: task.leadId, opportunityId: task.opportunityId,
            meetingId: task.meetingId, taskId: task.id, creditedMemberId: task.assigneeMemberId, taskKind: task.kind, result: task.result,
            safeMetadata: { provenance: "backfill", occurredAtBasis: task.completedAt ? "completedAt" : "createdAt_fallback" },
          }] : [])];
        });
      },
    },
    {
      name: "task_attribution_corrections",
      fetch: async (cursor, take) => {
        const facts = await database.commercialMetricFact.findMany({
          where: {
            workspaceId, sourceEntityType: "Task", quantity: 1, correctionOfFactId: null,
            eventType: { in: ["TASK_COMPLETED", "CALL_ATTEMPTED", "CALL_CONNECTED", "CALL_UNANSWERED", "CALL_FAILED", "INSTAGRAM_MESSAGE_SENT", "INSTAGRAM_FOLLOW_COMPLETED"] },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" }, take,
        });
        const taskIds = [...new Set(facts.filter((fact) => !fact.performedByMemberId).map((fact) => fact.sourceEntityId))];
        const logs = await database.auditLog.findMany({
          where: { workspaceId, entityType: "Task", entityId: { in: taskIds }, action: { in: ["task.completed", "task.bulk_completed"] } },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: { entityId: true, actor: { select: { userId: true, type: true } } },
        });
        const members = await database.workspaceMember.findMany({
          where: { workspaceId, userId: { in: logs.flatMap((log) => log.actor.type === "HUMAN" && log.actor.userId ? [log.actor.userId] : []) } },
          select: { id: true, userId: true },
        });
        const memberByUserId = new Map(members.map((member) => [member.userId, member.id]));
        const completionByTaskId = new Map<string, (typeof logs)[number]>();
        for (const log of logs) if (!completionByTaskId.has(log.entityId)) completionByTaskId.set(log.entityId, log);
        return page(facts, (fact) => {
          const completionActor = completionByTaskId.get(fact.sourceEntityId)?.actor;
          const performer = fact.performedByMemberId ?? (completionActor?.type === "HUMAN" && completionActor.userId
            ? memberByUserId.get(completionActor.userId) ?? null : null);
          if (!performer || fact.creditedMemberId === performer) return [];
          const common = {
            workspaceId, eventType: fact.eventType, occurredAt: fact.occurredAt,
            sourceEntityType: "Task", sourceEntityId: fact.sourceEntityId, sourceRevision: fact.sourceRevision,
            leadId: fact.leadId, opportunityId: fact.opportunityId, meetingId: fact.meetingId,
            taskId: fact.taskId, activityId: fact.activityId, leadOwnerMemberIdAtEvent: fact.leadOwnerMemberIdAtEvent,
            teamId: fact.teamId, sourceId: fact.sourceId, campaignId: fact.campaignId, creativeId: fact.creativeId,
            channel: fact.channel, direction: fact.direction, taskKind: fact.taskKind, result: fact.result,
          } as const;
          return [{
            ...common, eventKey: `${fact.eventKey}:attribution-reversal:v1`, quantity: -1,
            correctionOfFactId: fact.id,
            creditedMemberId: fact.creditedMemberId, performedByMemberId: fact.performedByMemberId,
            executionMode: fact.executionMode, valueCents: fact.valueCents === null ? null : -fact.valueCents,
            reversalReason: "Atribuição corrigida para o executor da tarefa.",
            safeMetadata: { provenance: "backfill", originalFactId: fact.id },
          }, {
            ...common, eventKey: `${fact.eventKey}:attribution-replacement:v1`, quantity: 1,
            creditedMemberId: performer, performedByMemberId: performer,
            executionMode: "MANUAL" as const, valueCents: fact.valueCents,
            safeMetadata: { provenance: "backfill", originalFactId: fact.id },
          }];
        });
      },
    },
    {
      name: "pacto_revisions",
      fetch: async (cursor, take) => page(await database.pactoRevision.findMany({
        where: { workspaceId, kind: "VALIDATED", ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, leadId: true, createdByActorId: true, createdAt: true, isQualificationReady: true, investigatedDimensions: true },
      }), (revision) => [{
        workspaceId, eventKey: `pacto-revision:${revision.id}:validated:v1`, eventType: "PACTO_VALIDATED", occurredAt: revision.createdAt,
        sourceEntityType: "PactoRevision", sourceEntityId: revision.id, leadId: revision.leadId,
        performedByMemberId: null, result: revision.isQualificationReady ? "READY" : "VALIDATED_WITH_GAPS",
        safeMetadata: { provenance: "backfill", actorId: revision.createdByActorId, investigatedDimensions: revision.investigatedDimensions, performerBasis: "unavailable" },
      }]),
    },
    {
      name: "meeting_history",
      fetch: async (cursor, take) => {
        const histories = await database.meetingHistory.findMany({
          where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: { id: true, meetingId: true, leadId: true, ownerMemberId: true, action: true, occurredAt: true, recordedByActorId: true, outcome: true, meeting: { select: { opportunityId: true, durationMinutes: true } } },
        });
        const actors = await database.actor.findMany({ where: { workspaceId, id: { in: histories.map((history) => history.recordedByActorId) } }, select: { id: true, userId: true } });
        const members = await database.workspaceMember.findMany({ where: { workspaceId, userId: { in: actors.flatMap((actor) => actor.userId ? [actor.userId] : []) }, deletedAt: null }, select: { id: true, userId: true } });
        const memberByActorId = new Map(actors.flatMap((actor) => actor.userId ? [[actor.id, members.find((member) => member.userId === actor.userId)?.id ?? null] as const] : []));
        const typeByAction = {
          SCHEDULED: "MEETING_SCHEDULED", CONFIRMED: "MEETING_CONFIRMED", RESCHEDULED: "MEETING_RESCHEDULED",
          CANCELLED: "MEETING_CANCELLED", ATTENDED: "MEETING_COMPLETED", NO_SHOW: "MEETING_NO_SHOW",
        } as const;
        return page(histories, (history) => {
          const eventType = typeByAction[history.action];
          const performer = memberByActorId.get(history.recordedByActorId) ?? null;
          return [{
            workspaceId, eventKey: `meeting-history:${history.id}:${history.action === "SCHEDULED" ? "scheduled" : eventType.toLowerCase()}:v1`, eventType, occurredAt: history.occurredAt,
            sourceEntityType: "MeetingHistory", sourceEntityId: history.id, meetingId: history.meetingId, leadId: history.leadId,
            opportunityId: history.meeting.opportunityId, creditedMemberId: history.ownerMemberId, performedByMemberId: performer,
            bookedByMemberId: history.action === "SCHEDULED" ? performer : null, meetingOwnerMemberIdAtEvent: history.ownerMemberId,
            durationSeconds: history.meeting.durationMinutes * 60, result: history.outcome, safeMetadata: { provenance: "backfill" },
          }];
        });
      },
    },
    {
      name: "meeting_attribution_corrections",
      fetch: async (cursor, take) => {
        const facts = await database.commercialMetricFact.findMany({
          where: {
            workspaceId, sourceEntityType: "MeetingHistory", eventType: "MEETING_SCHEDULED",
            quantity: 1, correctionOfFactId: null,
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" }, take,
        });
        return page(facts, (fact) => {
          if (!fact.bookedByMemberId || fact.creditedMemberId === fact.bookedByMemberId) return [];
          const common = {
            workspaceId, eventType: fact.eventType, occurredAt: fact.occurredAt,
            sourceEntityType: "MeetingHistory", sourceEntityId: fact.sourceEntityId,
            sourceRevision: fact.sourceRevision, leadId: fact.leadId,
            opportunityId: fact.opportunityId, meetingId: fact.meetingId,
            activityId: fact.activityId, leadOwnerMemberIdAtEvent: fact.leadOwnerMemberIdAtEvent,
            meetingOwnerMemberIdAtEvent: fact.meetingOwnerMemberIdAtEvent,
            teamId: fact.teamId, sourceId: fact.sourceId, campaignId: fact.campaignId,
            creativeId: fact.creativeId, channel: fact.channel, direction: fact.direction,
            bookedByMemberId: fact.bookedByMemberId, result: fact.result,
            executionMode: fact.executionMode,
          } as const;
          return [{
            ...common, eventKey: `${fact.eventKey}:booker-reversal:v1`, quantity: -1,
            correctionOfFactId: fact.id,
            creditedMemberId: fact.creditedMemberId, performedByMemberId: fact.performedByMemberId,
            reversalReason: "Agendamento creditado a quem marcou a reunião.",
            safeMetadata: { provenance: "backfill", originalFactId: fact.id },
          }, {
            ...common, eventKey: `${fact.eventKey}:booker-replacement:v1`, quantity: 1,
            creditedMemberId: fact.bookedByMemberId, performedByMemberId: fact.performedByMemberId,
            safeMetadata: { provenance: "backfill", originalFactId: fact.id },
          }];
        });
      },
    },
    {
      name: "meeting_legacy_schedule_corrections",
      fetch: async (cursor, take) => {
        const originals = await database.commercialMetricFact.findMany({
          where: {
            workspaceId, sourceEntityType: "MeetingHistory", eventType: "MEETING_SCHEDULED",
            eventKey: { endsWith: ":meeting_scheduled:v1" }, quantity: { gt: 0 }, correctionOfFactId: null,
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" }, take,
        });
        const correctionKeys = originals.flatMap((original) => [
          `${original.eventKey}:booker-reversal:v1`, `${original.eventKey}:booker-replacement:v1`,
        ]);
        const priorCorrections = await database.commercialMetricFact.findMany({
          where: { workspaceId, eventKey: { in: correctionKeys } },
        });
        const priorByKey = new Map(priorCorrections.map((correction) => [correction.eventKey, correction]));
        return page(originals, (original) => [
          original,
          ...[`${original.eventKey}:booker-reversal:v1`, `${original.eventKey}:booker-replacement:v1`]
            .flatMap((key) => priorByKey.get(key) ? [priorByKey.get(key)!] : []),
        ].map((fact) => ({
          workspaceId, eventKey: `${fact.eventKey}:legacy-schedule-dedup:v1`,
          eventType: "MEETING_SCHEDULED", occurredAt: fact.occurredAt,
          sourceEntityType: "MeetingHistory", sourceEntityId: fact.sourceEntityId,
          meetingId: fact.meetingId, leadId: fact.leadId, opportunityId: fact.opportunityId,
          activityId: fact.activityId, creditedMemberId: fact.creditedMemberId,
          performedByMemberId: fact.performedByMemberId, bookedByMemberId: fact.bookedByMemberId,
          meetingOwnerMemberIdAtEvent: fact.meetingOwnerMemberIdAtEvent,
          quantity: -fact.quantity, correctionOfFactId: fact.id,
          reversalReason: "Agendamento histórico duplicado pela chave anterior do backfill.",
          safeMetadata: { provenance: "backfill", originalFactId: fact.id, correction: "legacy_schedule_dedup" },
        })));
      },
    },
    {
      name: "opportunities",
      fetch: async (cursor, take) => page(await database.opportunity.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, leadId: true, accountId: true, pipelineId: true, currentStageId: true, ownerMemberId: true, status: true, amountCents: true, createdAt: true, closedAt: true },
      }), (opportunity) => [{
        workspaceId, eventKey: `opportunity:${opportunity.id}:created:v1`, eventType: "OPPORTUNITY_CREATED", occurredAt: opportunity.createdAt,
        sourceEntityType: "Opportunity", sourceEntityId: opportunity.id, opportunityId: opportunity.id, leadId: opportunity.leadId,
        accountId: opportunity.accountId, pipelineId: opportunity.pipelineId, stageId: opportunity.currentStageId,
        creditedMemberId: opportunity.ownerMemberId, opportunityOwnerMemberIdAtEvent: opportunity.ownerMemberId, valueCents: opportunity.amountCents,
        safeMetadata: { provenance: "backfill", ownerBasis: "current_snapshot" },
      }]),
    },
    {
      name: "offers",
      fetch: async (cursor, take) => {
        const offers = await database.offer.findMany({
          where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: {
            id: true, opportunityId: true, totalCents: true, createdAt: true,
            createdBy: { select: { userId: true, type: true } },
            opportunity: { select: { leadId: true, pipelineId: true, ownerMemberId: true } },
          },
        });
        const [members, proposalStages] = await Promise.all([
          database.workspaceMember.findMany({
            where: { workspaceId, userId: { in: offers.flatMap((offer) => offer.createdBy.userId ? [offer.createdBy.userId] : []) } },
            select: { id: true, userId: true },
          }),
          database.pipelineStage.findMany({
            where: { workspaceId, pipelineId: { in: [...new Set(offers.map((offer) => offer.opportunity.pipelineId))] }, opportunityStageCode: "PROPOSAL" },
            select: { id: true, pipelineId: true },
          }),
        ]);
        const memberByUserId = new Map(members.map((member) => [member.userId, member.id]));
        const proposalStageByPipeline = new Map(proposalStages.map((stage) => [stage.pipelineId, stage.id]));
        return page(offers, (offer) => [{
          workspaceId, eventKey: `offer:${offer.id}:proposal-reached:v1`, eventType: "PROPOSAL_REACHED",
          occurredAt: offer.createdAt, sourceEntityType: "Offer", sourceEntityId: offer.id,
          opportunityId: offer.opportunityId, leadId: offer.opportunity.leadId,
          pipelineId: offer.opportunity.pipelineId,
          stageId: proposalStageByPipeline.get(offer.opportunity.pipelineId) ?? null,
          creditedMemberId: offer.opportunity.ownerMemberId,
          performedByMemberId: offer.createdBy.userId ? memberByUserId.get(offer.createdBy.userId) ?? null : null,
          opportunityOwnerMemberIdAtEvent: offer.opportunity.ownerMemberId,
          valueCents: offer.totalCents, result: "SENT",
          executionMode: offer.createdBy.type === "HUMAN" ? "MANUAL" as const : "SYSTEM" as const,
          safeMetadata: { provenance: "backfill", ownerBasis: "current_snapshot" },
        }]);
      },
    },
    {
      name: "opportunity_outcomes",
      fetch: async (cursor, take) => page(await database.opportunityOutcomeSnapshot.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, opportunityId: true, leadId: true, ownerMemberId: true, status: true, amountCents: true, occurredAt: true, opportunity: { select: { accountId: true, pipelineId: true } }, stageHistory: { select: { stageId: true } } },
      }), (outcome) => {
        const eventType = outcome.status === "WON" ? "OPPORTUNITY_WON" as const : "OPPORTUNITY_LOST" as const;
        const common = {
          workspaceId, occurredAt: outcome.occurredAt, sourceEntityType: "OpportunityOutcomeSnapshot", sourceEntityId: outcome.id,
          opportunityId: outcome.opportunityId, leadId: outcome.leadId, accountId: outcome.opportunity.accountId, pipelineId: outcome.opportunity.pipelineId,
          stageId: outcome.stageHistory.stageId, creditedMemberId: outcome.ownerMemberId, opportunityOwnerMemberIdAtEvent: outcome.ownerMemberId,
          valueCents: outcome.amountCents, result: outcome.status, safeMetadata: { provenance: "backfill" },
        } as const;
        return [
          { ...common, eventKey: `opportunity-outcome:${outcome.id}:${eventType.toLowerCase()}:v1`, eventType },
          ...(outcome.status === "WON" ? [{ ...common, eventKey: `opportunity-outcome:${outcome.id}:sale-won:v1`, eventType: "SALE_WON" as const }] : []),
        ];
      }),
    },
    {
      name: "phone_call_status_events",
      fetch: async (cursor, take) => page(await database.phoneCallStatusEvent.findMany({
        where: { workspaceId, call: { direction: "OUTBOUND" }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, callId: true, status: true, source: true, occurredAt: true, call: { select: { leadId: true, contactId: true, accountId: true, messageId: true, meetingId: true, opportunityId: true, ownerMemberId: true, teamId: true, direction: true } } },
      }), (event) => {
        const eventType = phoneCallMetricEventType(event.status);
        if (!eventType) return [];
        return [{
          workspaceId, eventKey: `phone-call-status:${event.id}:${eventType.toLowerCase()}:v1`, eventType,
          occurredAt: event.occurredAt, sourceEntityType: "PhoneCallStatusEvent", sourceEntityId: event.id,
          phoneCallId: event.callId, messageId: event.call.messageId, leadId: event.call.leadId,
          contactId: event.call.contactId, accountId: event.call.accountId, meetingId: event.call.meetingId,
          opportunityId: event.call.opportunityId, creditedMemberId: event.call.ownerMemberId,
          teamId: event.call.teamId, direction: event.call.direction, channel: "PHONE", result: event.status,
          executionMode: event.source === "INTERNAL" ? "MANUAL" : "AUTOMATION",
          safeMetadata: { provenance: "backfill" },
        }];
      }),
    },
    {
      name: "phone_calls",
      fetch: async (cursor, take) => {
        const calls = await database.phoneCall.findMany({
          where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: { id: true, leadId: true, contactId: true, accountId: true, opportunityId: true, meetingId: true, campaignId: true, ownerMemberId: true, teamId: true, direction: true, status: true, disposition: true, initiatedAt: true, answeredAt: true, completedAt: true, createdAt: true, durationSeconds: true, talkDurationSeconds: true, messageId: true, statusEvents: { select: { status: true } } },
        });
        const existing = await database.commercialMetricFact.findMany({
          where: { workspaceId, sourceEntityType: "PhoneCall", phoneCallId: { in: calls.map((call) => call.id) }, quantity: { gt: 0 }, eventType: { in: ["CALL_ATTEMPTED", "CALL_CONNECTED", "CALL_UNANSWERED", "CALL_FAILED"] } },
          select: { id: true, eventKey: true, phoneCallId: true, eventType: true, occurredAt: true, leadId: true, contactId: true, accountId: true, messageId: true, meetingId: true, opportunityId: true, creditedMemberId: true, teamId: true, direction: true, result: true, quantity: true },
        });
        const existingByCall = new Map<string, typeof existing>();
        for (const fact of existing) {
          if (fact.phoneCallId) existingByCall.set(fact.phoneCallId, [...existingByCall.get(fact.phoneCallId) ?? [], fact]);
        }
        return page(calls, (call) => {
          if (call.direction !== "OUTBOUND") return [];
          const common = { workspaceId, sourceEntityType: "PhoneCall", sourceEntityId: call.id, phoneCallId: call.id, messageId: call.messageId, leadId: call.leadId, contactId: call.contactId, accountId: call.accountId, opportunityId: call.opportunityId, meetingId: call.meetingId, campaignId: call.campaignId, creditedMemberId: call.ownerMemberId, teamId: call.teamId, direction: call.direction, safeMetadata: { provenance: "backfill" } } as const;
          const fallbackTypes = missingPhoneCallEvents(call);
          const fallbackTypeSet = new Set<CommercialMetricEventType>(fallbackTypes);
          const fallback = fallbackTypes.map((eventType) => ({
            ...common, eventKey: `phone-call:${call.id}:${eventType === "CALL_ATTEMPTED" ? "attempted" : eventType.toLowerCase()}:v1`, eventType,
            occurredAt: eventType === "CALL_ATTEMPTED" ? call.initiatedAt! : call.answeredAt ?? call.completedAt ?? call.initiatedAt ?? call.createdAt,
            durationSeconds: eventType === "CALL_ATTEMPTED" ? null : call.talkDurationSeconds ?? call.durationSeconds,
            result: eventType === "CALL_ATTEMPTED" ? null : call.disposition,
          }));
          const corrections = (existingByCall.get(call.id) ?? []).filter((fact) =>
            fact.eventKey === `phone-call:${call.id}:${fact.eventType === "CALL_ATTEMPTED" ? "attempted" : fact.eventType.toLowerCase()}:v1`
            && !fallbackTypeSet.has(fact.eventType)).map((fact) => ({
            workspaceId, eventKey: `phone-call:${call.id}:${fact.eventType.toLowerCase()}:fallback-correction:${fact.id}:v1`,
            eventType: fact.eventType, occurredAt: fact.occurredAt, sourceEntityType: "PhoneCall", sourceEntityId: call.id,
            phoneCallId: call.id, messageId: fact.messageId, leadId: fact.leadId, contactId: fact.contactId,
            accountId: fact.accountId, meetingId: fact.meetingId, opportunityId: fact.opportunityId,
            creditedMemberId: fact.creditedMemberId, teamId: fact.teamId, direction: fact.direction,
            result: fact.result, quantity: -fact.quantity, correctionOfFactId: fact.id,
            reversalReason: "Fato de chamada inferido substituído pelo evento de status ou por ausência de tentativa.",
            safeMetadata: { provenance: "backfill", originalFactId: fact.id, correction: "fallback_not_applicable" },
          }));
          return [...fallback, ...corrections];
        });
      },
    },
    {
      name: "prospecting_email_jobs",
      fetch: async (cursor, take) => {
        const jobs = await database.prospectingEmailJob.findMany({
          where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: { id: true, leadId: true, cadenceInstanceId: true, stepKey: true, status: true, attemptCount: true, createdAt: true, claimedAt: true, sentAt: true, finalizedAt: true },
        });
        const cadences = await database.prospectingCadenceInstance.findMany({ where: { workspaceId, id: { in: jobs.map((job) => job.cadenceInstanceId) } }, select: { id: true, ownerMemberId: true } });
        const ownerByCadence = new Map(cadences.map((cadence) => [cadence.id, cadence.ownerMemberId]));
        return page(jobs, (job) => {
          const common = {
            workspaceId, sourceEntityType: "ProspectingEmailJob", sourceEntityId: job.id, leadId: job.leadId,
            creditedMemberId: ownerByCadence.get(job.cadenceInstanceId) ?? null, cadenceInstanceId: job.cadenceInstanceId,
            cadenceStepKey: job.stepKey, channel: "EMAIL", direction: "OUTBOUND", executionMode: "AUTOMATION" as const,
            safeMetadata: { provenance: "backfill" },
          } as const;
          const terminal = job.status === "SENT" ? ["EMAIL_SENT", job.sentAt ?? job.finalizedAt ?? job.createdAt] as const
            : job.status === "EXPIRED" ? ["EMAIL_EXPIRED", job.finalizedAt ?? job.createdAt] as const
              : job.status === "FAILED" ? ["EMAIL_FAILED", job.finalizedAt ?? job.createdAt] as const : null;
          return [
            { ...common, eventKey: `prospecting-email-job:${job.id}:scheduled:v1`, eventType: "EMAIL_SCHEDULED" as const, occurredAt: job.createdAt, result: "SCHEDULED" },
            ...(job.claimedAt && job.attemptCount > 0 ? [{ ...common, eventKey: `prospecting-email-job:${job.id}:attempt:${job.attemptCount}:claimed:v1`, eventType: "EMAIL_CLAIMED" as const, occurredAt: job.claimedAt, result: "CLAIMED" }] : []),
            ...(terminal ? [{ ...common, eventKey: `prospecting-email-job:${job.id}:attempt:${Math.max(1, job.attemptCount)}:${job.status.toLowerCase()}:v1`, eventType: terminal[0], occurredAt: terminal[1], result: job.status }] : []),
          ];
        });
      },
    },
    {
      name: "prospecting_email_events",
      fetch: async (cursor, take) => {
        const events = await database.prospectingEmailEvent.findMany({
          where: { workspaceId, emailJobId: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: { id: true, emailJobId: true, eventType: true, safeMetadata: true, occurredAt: true },
        });
        const jobs = await database.prospectingEmailJob.findMany({ where: { workspaceId, id: { in: events.flatMap((event) => event.emailJobId ? [event.emailJobId] : []) } }, select: { id: true, leadId: true, cadenceInstanceId: true, stepKey: true } });
        const cadences = await database.prospectingCadenceInstance.findMany({ where: { workspaceId, id: { in: jobs.map((job) => job.cadenceInstanceId) } }, select: { id: true, ownerMemberId: true } });
        const priorInboundStatusFacts = await database.commercialMetricFact.findMany({
          where: { workspaceId, sourceEntityType: "ProspectingEmailEvent", sourceEntityId: { in: events.map((event) => event.id) }, eventType: { in: ["EMAIL_DELIVERED", "EMAIL_BOUNCED", "EMAIL_COMPLAINT", "EMAIL_UNSUBSCRIBED"] }, direction: "INBOUND", quantity: { gt: 0 } },
          select: { id: true, eventKey: true, sourceEntityId: true, occurredAt: true, eventType: true, leadId: true, creditedMemberId: true, cadenceInstanceId: true, cadenceStepKey: true, channel: true, result: true, executionMode: true, quantity: true },
        });
        const jobById = new Map(jobs.map((job) => [job.id, job]));
        const ownerByCadence = new Map(cadences.map((cadence) => [cadence.id, cadence.ownerMemberId]));
        const priorInboundStatusByEventId = new Map(priorInboundStatusFacts.map((fact) => [fact.sourceEntityId, fact]));
        return page(events, (event) => {
          const job = event.emailJobId ? jobById.get(event.emailJobId) : null;
          if (!job) return [];
          const eventType = ({ DELIVERED: "EMAIL_DELIVERED", REPLIED: "EMAIL_REPLIED", BOUNCED: "EMAIL_BOUNCED", COMPLAINT: "EMAIL_COMPLAINT", UNSUBSCRIBED: "EMAIL_UNSUBSCRIBED" } as const)[event.eventType as "DELIVERED" | "REPLIED" | "BOUNCED" | "COMPLAINT" | "UNSUBSCRIBED"];
          if (!eventType) return [];
          const metadata = event.safeMetadata && typeof event.safeMetadata === "object" && !Array.isArray(event.safeMetadata) ? event.safeMetadata as Record<string, unknown> : {};
          const automaticReply = metadata.automaticReply === true;
          const common = {
            workspaceId, occurredAt: event.occurredAt, sourceEntityType: "ProspectingEmailEvent", sourceEntityId: event.id,
            leadId: job.leadId, creditedMemberId: ownerByCadence.get(job.cadenceInstanceId) ?? null, cadenceInstanceId: job.cadenceInstanceId,
            cadenceStepKey: job.stepKey, channel: "EMAIL", direction: event.eventType === "REPLIED" ? "INBOUND" as const : "OUTBOUND" as const, result: event.eventType,
            executionMode: "AUTOMATION" as const, safeMetadata: { provenance: "backfill", automaticReply },
          } as const;
          const prior = event.eventType === "REPLIED" ? null : priorInboundStatusByEventId.get(event.id);
          const wrongDirection = prior?.eventKey === `prospecting-email-event:${event.id}:${eventType.toLowerCase()}:v1` ? prior : null;
          return [
            ...(wrongDirection ? [] : [{ ...common, eventKey: `prospecting-email-event:${event.id}:${eventType.toLowerCase()}:v1`, eventType }]),
            ...(event.eventType === "REPLIED" && !automaticReply ? [{ ...common, eventKey: `prospecting-email-event:${event.id}:inbound_message_received:v1`, eventType: "INBOUND_MESSAGE_RECEIVED" as const }] : []),
            ...(event.eventType === "REPLIED" && automaticReply ? [{ ...common, eventKey: `prospecting-email-event:${event.id}:auto_response_received:v1`, eventType: "AUTO_RESPONSE_RECEIVED" as const }] : []),
            ...(wrongDirection ? [{
              workspaceId, eventKey: `${wrongDirection.eventKey}:direction-reversal:v1`, eventType: wrongDirection.eventType,
              occurredAt: wrongDirection.occurredAt, sourceEntityType: "ProspectingEmailEvent", sourceEntityId: event.id,
              leadId: wrongDirection.leadId, creditedMemberId: wrongDirection.creditedMemberId,
              cadenceInstanceId: wrongDirection.cadenceInstanceId, cadenceStepKey: wrongDirection.cadenceStepKey,
              channel: wrongDirection.channel, result: wrongDirection.result, executionMode: wrongDirection.executionMode,
              direction: "INBOUND" as const, quantity: -wrongDirection.quantity,
              correctionOfFactId: wrongDirection.id, reversalReason: "Status de envio registrado com direção de entrada.",
              safeMetadata: { provenance: "backfill", correction: "email_status_direction" },
            }, {
              workspaceId, eventKey: `${wrongDirection.eventKey}:direction-outbound:v1`, eventType: wrongDirection.eventType,
              occurredAt: wrongDirection.occurredAt, sourceEntityType: "ProspectingEmailEvent", sourceEntityId: event.id,
              leadId: wrongDirection.leadId, creditedMemberId: wrongDirection.creditedMemberId,
              cadenceInstanceId: wrongDirection.cadenceInstanceId, cadenceStepKey: wrongDirection.cadenceStepKey,
              channel: wrongDirection.channel, result: wrongDirection.result, executionMode: wrongDirection.executionMode,
              direction: "OUTBOUND" as const, quantity: wrongDirection.quantity,
              safeMetadata: { provenance: "backfill", correction: "email_status_direction" },
            }] : []),
          ];
        });
      },
    },
    {
      name: "message_status_events",
      fetch: async (cursor, take) => {
        const events = await database.messageStatusEvent.findMany({
          where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: { id: true, status: true, providerOccurredAt: true, ingestedAt: true, message: { select: { id: true, direction: true, automationRunId: true, conversation: { select: { channel: true, leadId: true, contactId: true, accountId: true, opportunityId: true, meetingId: true, assigneeMemberId: true } } } } },
        });
        const acceptedIds = events.filter((event) => event.status === "PROVIDER_ACCEPTED" && event.message.conversation.channel === "EMAIL").map((event) => event.id);
        const oldAcceptedFacts = await database.commercialMetricFact.findMany({
          where: { workspaceId, sourceEntityType: "MessageStatusEvent", sourceEntityId: { in: acceptedIds }, eventType: "EMAIL_SENT", quantity: { gt: 0 } },
          select: { id: true, eventKey: true, sourceEntityId: true, occurredAt: true, messageId: true, leadId: true, contactId: true, accountId: true, opportunityId: true, meetingId: true, creditedMemberId: true, channel: true, direction: true, quantity: true },
        });
        const oldAcceptedByEventId = new Map(oldAcceptedFacts.map((fact) => [fact.sourceEntityId, fact]));
        return page(events, (event) => {
          const eventType = messageStatusMetricEventType(event.status, event.message.conversation.channel, event.message.direction);
          if (eventType) {
            const conversation = event.message.conversation;
            return [{ workspaceId, eventKey: `message-status:${event.id}:${eventType.toLowerCase()}:v1`, eventType, occurredAt: event.providerOccurredAt ?? event.ingestedAt, sourceEntityType: "MessageStatusEvent", sourceEntityId: event.id, messageId: event.message.id, leadId: conversation.leadId, contactId: conversation.contactId, accountId: conversation.accountId, opportunityId: conversation.opportunityId, meetingId: conversation.meetingId, creditedMemberId: conversation.assigneeMemberId, channel: conversation.channel, direction: event.message.direction, executionMode: event.message.automationRunId ? "AUTOMATION" : "SYSTEM", safeMetadata: { provenance: "backfill" } }];
          }
          const prior = oldAcceptedByEventId.get(event.id);
          if (!prior || prior.eventKey !== `message-status:${event.id}:email_sent:v1`) return [];
          return [{
            workspaceId, eventKey: `${prior.eventKey}:provider-accepted-correction:v1`, eventType: "EMAIL_SENT",
            occurredAt: prior.occurredAt, sourceEntityType: "MessageStatusEvent", sourceEntityId: event.id,
            messageId: prior.messageId, leadId: prior.leadId, contactId: prior.contactId, accountId: prior.accountId,
            opportunityId: prior.opportunityId, meetingId: prior.meetingId, creditedMemberId: prior.creditedMemberId,
            channel: prior.channel, direction: prior.direction, quantity: -prior.quantity, correctionOfFactId: prior.id,
            reversalReason: "Aceite do provedor não confirma envio do e-mail.",
            safeMetadata: { provenance: "backfill", originalFactId: prior.id, correction: "provider_accepted_not_sent" },
          }];
        });
      },
    },
    {
      name: "inbound_messages",
      fetch: async (cursor, take) => {
        const messages = await database.message.findMany({
          where: { workspaceId, direction: "INBOUND", conversation: { leadId: { not: null } }, ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: { id: "asc" }, take,
          select: { id: true, occurredAt: true, isSimulated: true, replyTo: { select: { statusEvents: { where: { status: "REPLIED" }, select: { id: true }, take: 1 } } }, conversation: { select: { channel: true, leadId: true, contactId: true, accountId: true, opportunityId: true, meetingId: true, assigneeMemberId: true, lead: { select: { sourceId: true, campaignId: true, creativeId: true } } } } },
        });
        const leadIds = [...new Set(messages.flatMap((message) => message.conversation.leadId ? [message.conversation.leadId] : []))];
        const firstByLead = new Map<string, string>();
        await Promise.all(leadIds.map(async (leadId) => {
          const first = await database.message.findFirst({
            where: { workspaceId, direction: "INBOUND", conversation: { leadId } },
            orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true },
          });
          if (first) firstByLead.set(leadId, first.id);
        }));
        const duplicateReplyIds = messages.filter((message) => message.isSimulated && message.replyTo?.statusEvents.length && message.conversation.channel === "EMAIL").map((message) => message.id);
        const oldReplyFacts = await database.commercialMetricFact.findMany({
          where: { workspaceId, sourceEntityType: "Message", sourceEntityId: { in: duplicateReplyIds }, eventType: "EMAIL_REPLIED", quantity: { gt: 0 } },
          select: { id: true, eventKey: true, sourceEntityId: true, occurredAt: true, messageId: true, leadId: true, contactId: true, accountId: true, opportunityId: true, meetingId: true, creditedMemberId: true, channel: true, direction: true, quantity: true },
        });
        const oldReplyByMessageId = new Map(oldReplyFacts.map((fact) => [fact.sourceEntityId, fact]));
        return page(messages, (message) => {
          const conversation = message.conversation;
          const leadId = conversation.leadId!;
          const duplicateEmailReply = message.isSimulated && Boolean(message.replyTo?.statusEvents.length) && conversation.channel === "EMAIL";
          const oldReply = duplicateEmailReply ? oldReplyByMessageId.get(message.id) : null;
          const common = {
            workspaceId, occurredAt: message.occurredAt, sourceEntityType: "Message", sourceEntityId: message.id,
            messageId: message.id, leadId, contactId: conversation.contactId, accountId: conversation.accountId,
            opportunityId: conversation.opportunityId, meetingId: conversation.meetingId, creditedMemberId: conversation.assigneeMemberId,
            leadOwnerMemberIdAtEvent: conversation.assigneeMemberId, sourceId: conversation.lead?.sourceId ?? null,
            campaignId: conversation.lead?.campaignId ?? null, creativeId: conversation.lead?.creativeId ?? null,
            channel: conversation.channel, direction: "INBOUND", executionMode: "SYSTEM" as const,
            safeMetadata: { provenance: "backfill", ownerBasis: "conversation_current_snapshot" },
          } as const;
          return [
            { ...common, eventKey: `message:${message.id}:inbound-received:v1`, eventType: "INBOUND_MESSAGE_RECEIVED" as const },
            ...(firstByLead.get(leadId) === message.id ? [{ ...common, eventKey: `lead:${leadId}:first-human-response:${message.id}:v1`, eventType: "HUMAN_RESPONSE_CONFIRMED" as const }] : []),
            ...(conversation.channel === "EMAIL" && !duplicateEmailReply ? [{ ...common, eventKey: `message:${message.id}:email-replied:v1`, eventType: "EMAIL_REPLIED" as const }] : []),
            ...(oldReply?.eventKey === `message:${message.id}:email-replied:v1` ? [{
              workspaceId, eventKey: `${oldReply.eventKey}:simulated-status-dedup:v1`, eventType: "EMAIL_REPLIED" as const,
              occurredAt: oldReply.occurredAt, sourceEntityType: "Message", sourceEntityId: message.id,
              messageId: oldReply.messageId, leadId: oldReply.leadId, contactId: oldReply.contactId,
              accountId: oldReply.accountId, opportunityId: oldReply.opportunityId, meetingId: oldReply.meetingId,
              creditedMemberId: oldReply.creditedMemberId, channel: oldReply.channel, direction: oldReply.direction,
              quantity: -oldReply.quantity, correctionOfFactId: oldReply.id,
              reversalReason: "Resposta simulada já registrada pelo status da mensagem enviada.",
              safeMetadata: { provenance: "backfill", originalFactId: oldReply.id, correction: "simulated_reply_status_dedup" },
            }] : []),
          ];
        });
      },
    },
    {
      name: "first_response_corrections",
      fetch: async (cursor, take) => {
        const facts = await database.commercialMetricFact.findMany({
          where: {
            workspaceId, sourceEntityType: "Message", eventType: "HUMAN_RESPONSE_CONFIRMED",
            quantity: 1, leadId: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" }, take,
        });
        const leadIds = [...new Set(facts.flatMap((fact) => fact.leadId ? [fact.leadId] : []))];
        const firstByLead = new Map<string, string>();
        await Promise.all(leadIds.map(async (leadId) => {
          const first = await database.message.findFirst({
            where: { workspaceId, direction: "INBOUND", conversation: { leadId } },
            orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true },
          });
          if (first) firstByLead.set(leadId, first.id);
        }));
        return page(facts, (fact) => {
          const firstId = fact.leadId ? firstByLead.get(fact.leadId) : null;
          if (!firstId || fact.eventKey === `lead:${fact.leadId}:first-human-response:${firstId}:v1`) return [];
          return [{
            workspaceId, eventKey: `${fact.eventKey}:historical-first-response-reversal:v1`,
            eventType: "HUMAN_RESPONSE_CONFIRMED", occurredAt: fact.occurredAt,
            sourceEntityType: "Message", sourceEntityId: fact.sourceEntityId,
            messageId: fact.messageId, leadId: fact.leadId, contactId: fact.contactId,
            accountId: fact.accountId, opportunityId: fact.opportunityId, meetingId: fact.meetingId,
            creditedMemberId: fact.creditedMemberId, leadOwnerMemberIdAtEvent: fact.leadOwnerMemberIdAtEvent,
            sourceId: fact.sourceId, campaignId: fact.campaignId, creativeId: fact.creativeId,
            channel: fact.channel, direction: fact.direction, executionMode: fact.executionMode,
            quantity: -1, correctionOfFactId: fact.id,
            reversalReason: "Primeira resposta histórica do lead registrada em outra mensagem.",
            safeMetadata: { provenance: "backfill", originalFactId: fact.id, correction: "historical_first_response" },
          }];
        });
      },
    },
    {
      name: "accepted_contracts",
      fetch: async (cursor, take) => {
        const events = await database.contractEvent.findMany({
          where: { workspaceId, eventType: "ACCEPTED_LOCAL_MANUAL", ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: { id: true, contractId: true, contractVersionId: true, actorId: true, occurredAt: true },
        });
        const [contracts, versions, actors] = await Promise.all([
          database.commercialContract.findMany({ where: { workspaceId, id: { in: events.map((event) => event.contractId) } }, select: { id: true, opportunityId: true, accountId: true, ownerMemberId: true } }),
          database.contractVersion.findMany({ where: { workspaceId, id: { in: events.flatMap((event) => event.contractVersionId ? [event.contractVersionId] : []) } }, select: { id: true, totalCents: true, mrrCents: true, tcvCents: true } }),
          database.actor.findMany({ where: { workspaceId, id: { in: events.map((event) => event.actorId) } }, select: { id: true, userId: true } }),
        ]);
        const members = await database.workspaceMember.findMany({ where: { workspaceId, userId: { in: actors.flatMap((actor) => actor.userId ? [actor.userId] : []) }, deletedAt: null }, select: { id: true, userId: true } });
        const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
        const versionById = new Map(versions.map((version) => [version.id, version]));
        const memberByActorId = new Map(actors.flatMap((actor) => actor.userId ? [[actor.id, members.find((member) => member.userId === actor.userId)?.id ?? null] as const] : []));
        return page(events, (event) => {
          const contract = contractById.get(event.contractId);
          const version = event.contractVersionId ? versionById.get(event.contractVersionId) : null;
          if (!contract || !version) return [];
          return [{
            workspaceId, eventKey: `contract-event:${event.id}:accepted:v1`, eventType: "CONTRACT_ACCEPTED", occurredAt: event.occurredAt,
            sourceEntityType: "ContractEvent", sourceEntityId: event.id, accountId: contract.accountId, opportunityId: contract.opportunityId,
            contractId: contract.id, creditedMemberId: contract.ownerMemberId, performedByMemberId: memberByActorId.get(event.actorId) ?? null,
            opportunityOwnerMemberIdAtEvent: contract.ownerMemberId, valueCents: version.totalCents, result: "ACCEPTED",
            safeMetadata: { provenance: "backfill", contractVersionId: version.id, mrrCents: version.mrrCents.toString(), tcvCents: version.tcvCents.toString() },
          }];
        });
      },
    },
    {
      name: "revenue_movements",
      fetch: async (cursor, take) => page(await database.revenueMovement.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, subscriptionId: true, accountId: true, type: true, deltaMrrCents: true, effectiveAt: true },
      }), (movement) => [{ workspaceId, eventKey: `revenue-movement:${movement.id}:posted:v1`, eventType: "REVENUE_MOVEMENT_POSTED", occurredAt: movement.effectiveAt, sourceEntityType: "RevenueMovement", sourceEntityId: movement.id, accountId: movement.accountId, valueCents: movement.deltaMrrCents, result: movement.type, safeMetadata: { provenance: "backfill", subscriptionId: movement.subscriptionId } },
        ...(movement.type === "NEW" || movement.type === "CHURN" ? [{
          workspaceId, eventKey: `revenue-movement:${movement.id}:${movement.type === "NEW" ? "subscription-activated" : "churn-confirmed"}:v1`,
          eventType: movement.type === "NEW" ? "SUBSCRIPTION_ACTIVATED" as const : "CHURN_CONFIRMED" as const,
          occurredAt: movement.effectiveAt, sourceEntityType: "RevenueMovement", sourceEntityId: movement.id, accountId: movement.accountId,
          valueCents: movement.deltaMrrCents, result: movement.type, safeMetadata: { provenance: "backfill", subscriptionId: movement.subscriptionId },
        }] : [])]),
    },
    {
      name: "payment_events",
      fetch: async (cursor, take) => {
        const events = await database.paymentEvent.findMany({
          where: { workspaceId, type: { in: ["INVOICE_ISSUED", "PAYMENT_CONFIRMED", "PAYMENT_REVERSED"] }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
          select: { id: true, type: true, invoiceId: true, paymentId: true, actorId: true, occurredAt: true, safeMetadata: true },
        });
        const [invoices, payments, actors] = await Promise.all([
          database.invoice.findMany({ where: { workspaceId, id: { in: events.flatMap((event) => event.invoiceId ? [event.invoiceId] : []) } }, select: { id: true, accountId: true, contractId: true, ownerMemberId: true, totalCents: true } }),
          database.payment.findMany({ where: { workspaceId, id: { in: events.flatMap((event) => event.paymentId ? [event.paymentId] : []) } }, select: { id: true, amountCents: true } }),
          database.actor.findMany({ where: { workspaceId, id: { in: events.map((event) => event.actorId) } }, select: { id: true, userId: true } }),
        ]);
        const members = await database.workspaceMember.findMany({ where: { workspaceId, userId: { in: actors.flatMap((actor) => actor.userId ? [actor.userId] : []) }, deletedAt: null }, select: { id: true, userId: true } });
        const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
        const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
        const memberByActorId = new Map(actors.flatMap((actor) => actor.userId ? [[actor.id, members.find((member) => member.userId === actor.userId)?.id ?? null] as const] : []));
        return page(events, (event) => {
          const invoice = event.invoiceId ? invoiceById.get(event.invoiceId) : null;
          const payment = event.paymentId ? paymentById.get(event.paymentId) : null;
          const rawValue = event.type === "INVOICE_ISSUED" ? invoice?.totalCents ?? null : payment?.amountCents ?? null;
          return [{
            workspaceId, eventKey: `payment-event:${event.id}:${event.type.toLowerCase()}:v1`,
            eventType: event.type as Extract<CommercialMetricEventType, "INVOICE_ISSUED" | "PAYMENT_CONFIRMED" | "PAYMENT_REVERSED">,
            occurredAt: event.occurredAt, sourceEntityType: "PaymentEvent", sourceEntityId: event.id,
            accountId: invoice?.accountId ?? null, contractId: invoice?.contractId ?? null, paymentId: event.paymentId,
            creditedMemberId: invoice?.ownerMemberId ?? null, performedByMemberId: memberByActorId.get(event.actorId) ?? null,
            valueCents: event.type === "PAYMENT_REVERSED" && rawValue !== null ? -rawValue : rawValue, result: event.type,
            safeMetadata: { provenance: "backfill", invoiceId: event.invoiceId, sourceMetadataPresent: event.safeMetadata !== null },
          }];
        });
      },
    },
    {
      name: "manual_activities",
      fetch: async (cursor, take) => {
        const logs = await database.auditLog.findMany({
          where: { workspaceId, action: "activity.recorded", entityType: "Activity", ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: { id: "asc" }, take,
          select: { id: true, entityId: true, actorId: true },
        });
        const [activities, actors] = await Promise.all([
          database.activity.findMany({
            where: { workspaceId, id: { in: logs.map((log) => log.entityId) }, deletedAt: null },
            select: { id: true, leadId: true, opportunityId: true, meetingId: true, type: true, result: true, direction: true, occurredAt: true, newValues: true, lead: { select: { ownerMemberId: true, sourceId: true, campaignId: true, creativeId: true, pipelineId: true, currentStageId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } } },
          }),
          database.actor.findMany({ where: { workspaceId, id: { in: logs.map((log) => log.actorId) } }, select: { id: true, userId: true, type: true } }),
        ]);
        const members = await database.workspaceMember.findMany({
          where: { workspaceId, userId: { in: actors.flatMap((actor) => actor.userId ? [actor.userId] : []) } },
          select: { id: true, userId: true },
        });
        const activityById = new Map(activities.map((activity) => [activity.id, activity]));
        const memberByUserId = new Map(members.map((member) => [member.userId, member.id]));
        const memberByActorId = new Map(actors.map((actor) => [actor.id, actor.userId ? memberByUserId.get(actor.userId) ?? null : null]));
        const actorById = new Map(actors.map((actor) => [actor.id, actor]));
        return page(logs, (log) => {
          const activity = activityById.get(log.entityId);
          if (!activity) return [];
          const performer = memberByActorId.get(log.actorId) ?? null;
          const actorType = actorById.get(log.actorId)?.type;
          const values = activity.newValues;
          const communicationChannel = values && typeof values === "object" && !Array.isArray(values) ? values.communicationChannel : null;
          return manualActivityMetricEvents(activity.type, activity.result, activity.direction, communicationChannel === "INSTAGRAM" ? communicationChannel : null).map((event) => ({
            workspaceId, eventKey: `activity:${activity.id}:${event.eventKeySuffix}:v1`, eventType: event.eventType,
            occurredAt: activity.occurredAt, sourceEntityType: "Activity", sourceEntityId: activity.id,
            leadId: activity.leadId, opportunityId: activity.opportunityId, meetingId: activity.meetingId, activityId: activity.id,
            creditedMemberId: event.eventType === "HUMAN_RESPONSE_CONFIRMED" || event.eventType === "INBOUND_MESSAGE_RECEIVED"
              ? activity.lead.ownerMemberId ?? performer : performer,
            performedByMemberId: performer, leadOwnerMemberIdAtEvent: activity.lead.ownerMemberId,
            sourceId: activity.lead.sourceId, campaignId: activity.lead.campaignId, creativeId: activity.lead.creativeId,
            pipelineId: activity.lead.pipelineId, stageId: activity.lead.currentStageId,
            teamId: activity.lead.routingQueue?.teamId ?? activity.lead.queue?.teamId ?? null,
            direction: activity.direction, channel: event.channel, activityType: activity.type, result: event.metricResult ?? activity.result,
            executionMode: actorType === "HUMAN" ? "MANUAL" as const : actorType === "AUTOMATION" ? "AUTOMATION" as const : "SYSTEM" as const,
            safeMetadata: { provenance: "backfill", ownerBasis: "current_snapshot" },
          }));
        });
      },
    },
    {
      name: "legacy_call_activities",
      fetch: async (cursor, take) => {
        const activities = await database.activity.findMany({
          where: {
            workspaceId, deletedAt: null, direction: "OUTBOUND",
            type: { in: ["CALL", "CALL_CONNECTED", "CALL_UNANSWERED"] },
            phoneCallId: null, messageId: null, correctsActivityId: null,
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" }, take,
          select: {
            id: true, leadId: true, opportunityId: true, meetingId: true, type: true, result: true,
            direction: true, occurredAt: true, durationSeconds: true, createdByActorId: true,
            lead: { select: { ownerMemberId: true, sourceId: true, campaignId: true, creativeId: true, pipelineId: true, currentStageId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } },
          },
        });
        const [logs, actors] = await Promise.all([
          database.auditLog.findMany({
            where: { workspaceId, action: "activity.recorded", entityType: "Activity", entityId: { in: activities.map((activity) => activity.id) } },
            select: { entityId: true },
          }),
          database.actor.findMany({ where: { workspaceId, id: { in: activities.map((activity) => activity.createdByActorId) } }, select: { id: true, userId: true, type: true } }),
        ]);
        const members = await database.workspaceMember.findMany({
          where: { workspaceId, userId: { in: actors.flatMap((actor) => actor.userId ? [actor.userId] : []) } },
          select: { id: true, userId: true },
        });
        const recordedIds = new Set(logs.map((log) => log.entityId));
        const actorById = new Map(actors.map((actor) => [actor.id, actor]));
        const memberByUserId = new Map(members.map((member) => [member.userId, member.id]));
        return page(activities, (activity) => {
          if (recordedIds.has(activity.id)) return [];
          const actor = actorById.get(activity.createdByActorId);
          const performer = actor?.userId ? memberByUserId.get(actor.userId) ?? null : null;
          return manualActivityMetricEvents(activity.type, activity.result, activity.direction).map((event) => ({
            workspaceId, eventKey: `activity:${activity.id}:${event.eventKeySuffix}:v1`, eventType: event.eventType,
            occurredAt: activity.occurredAt, sourceEntityType: "Activity", sourceEntityId: activity.id,
            leadId: activity.leadId, opportunityId: activity.opportunityId, meetingId: activity.meetingId, activityId: activity.id,
            creditedMemberId: performer, performedByMemberId: performer, leadOwnerMemberIdAtEvent: activity.lead.ownerMemberId,
            sourceId: activity.lead.sourceId, campaignId: activity.lead.campaignId, creativeId: activity.lead.creativeId,
            pipelineId: activity.lead.pipelineId, stageId: activity.lead.currentStageId,
            teamId: activity.lead.routingQueue?.teamId ?? activity.lead.queue?.teamId ?? null,
            direction: activity.direction, channel: event.channel, activityType: activity.type,
            result: event.metricResult ?? activity.result,
            durationSeconds: event.eventType === "CALL_ATTEMPTED" ? null : activity.durationSeconds,
            executionMode: actor?.type === "HUMAN" ? "MANUAL" as const : actor?.type === "AUTOMATION" ? "AUTOMATION" as const : "SYSTEM" as const,
            safeMetadata: { provenance: "backfill", auditBasis: "standalone_call_activity", ownerBasis: "activity_actor" },
          }));
        });
      },
    },
    {
      name: "manual_activity_corrections",
      fetch: async (cursor, take) => {
        const logs = await database.auditLog.findMany({
          where: { workspaceId, action: "activity.corrected", entityType: "Activity", ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: { id: "asc" }, take,
          select: { id: true, entityId: true },
        });
        const corrections = await database.activity.findMany({
          where: { workspaceId, id: { in: logs.map((log) => log.entityId) }, correctsActivityId: { not: null }, deletedAt: null },
          select: { id: true, correctsActivityId: true, occurredAt: true, createdAt: true, description: true, newValues: true },
        });
        const originalIds = corrections.flatMap((correction) => correction.correctsActivityId ? [correction.correctsActivityId] : []);
        const [originals, allCorrections, originalFacts] = await Promise.all([
          database.activity.findMany({
            where: { workspaceId, id: { in: originalIds }, deletedAt: null },
            select: { id: true, type: true, direction: true, result: true, occurredAt: true, opportunityId: true, meetingId: true, createdByActorId: true, phoneCallId: true, messageId: true,
              lead: { select: { id: true, ownerMemberId: true, sourceId: true, campaignId: true, creativeId: true, pipelineId: true, currentStageId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } } },
          }),
          database.activity.findMany({
            where: { workspaceId, correctsActivityId: { in: originalIds }, deletedAt: null },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true, correctsActivityId: true, createdAt: true, newValues: true },
          }),
          database.commercialMetricFact.findMany({
            where: { workspaceId, sourceEntityType: "Activity", sourceEntityId: { in: originalIds } },
          }),
        ]);
        const [actors, recordedLogs] = await Promise.all([
          database.actor.findMany({ where: { workspaceId, id: { in: originals.map((original) => original.createdByActorId) } }, select: { id: true, userId: true, type: true } }),
          database.auditLog.findMany({ where: { workspaceId, action: "activity.recorded", entityType: "Activity", entityId: { in: originalIds } }, select: { entityId: true } }),
        ]);
        const members = await database.workspaceMember.findMany({
          where: { workspaceId, userId: { in: actors.flatMap((actor) => actor.userId ? [actor.userId] : []) } },
          select: { id: true, userId: true },
        });
        const actorById = new Map(actors.map((actor) => [actor.id, actor]));
        const memberByUserId = new Map(members.map((member) => [member.userId, member.id]));
        const recordedIds = new Set(recordedLogs.map((log) => log.entityId));
        const correctionById = new Map(corrections.map((correction) => [correction.id, correction]));
        const originalById = new Map(originals.map((original) => [original.id, original]));
        const correctedResult = (value: Prisma.JsonValue | null) => {
          const result = value && typeof value === "object" && !Array.isArray(value) ? value.result : null;
          return result === "CONNECTED" || result === "NOT_CONNECTED" ? result : null;
        };
        return page(logs, (log) => {
          const correction = correctionById.get(log.entityId);
          const original = correction?.correctsActivityId ? originalById.get(correction.correctsActivityId) : null;
          if (!correction || !original || !["CALL", "CALL_CONNECTED", "CALL_UNANSWERED"].includes(original.type)) return [];
          const nextResult = correctedResult(correction.newValues);
          const standaloneCall = original.direction === "OUTBOUND" && original.phoneCallId === null && original.messageId === null;
          if (!nextResult || (!recordedIds.has(original.id) && !standaloneCall)) return [];
          let previousResult = original.result;
          for (const prior of allCorrections.filter((item) => item.correctsActivityId === original.id)) {
            if (prior.id === correction.id) break;
            const priorResult = correctedResult(prior.newValues);
            if (priorResult) previousResult = priorResult;
          }
          const storedFacts = originalFacts.filter((fact) => fact.sourceEntityId === original.id);
          const actor = actorById.get(original.createdByActorId);
          const performer = actor?.userId ? memberByUserId.get(actor.userId) ?? null : null;
          const basisFacts: readonly ManualActivityFactBasis[] = storedFacts.length > 0 ? storedFacts
            : manualActivityMetricEvents(original.type, original.result, original.direction).map((event) => ({
              eventKey: `activity:${original.id}:${event.eventKeySuffix}:v1`,
              leadId: original.lead.id, opportunityId: original.opportunityId, meetingId: original.meetingId,
              creditedMemberId: event.eventType === "HUMAN_RESPONSE_CONFIRMED" || event.eventType === "INBOUND_MESSAGE_RECEIVED"
                ? original.lead.ownerMemberId ?? performer : performer,
              performedByMemberId: performer, leadOwnerMemberIdAtEvent: original.lead.ownerMemberId,
              sourceId: original.lead.sourceId, campaignId: original.lead.campaignId, creativeId: original.lead.creativeId,
              pipelineId: original.lead.pipelineId, stageId: original.lead.currentStageId,
              teamId: original.lead.routingQueue?.teamId ?? original.lead.queue?.teamId ?? null,
              direction: original.direction, activityType: original.type,
              executionMode: actor?.type === "HUMAN" ? "MANUAL" as const : actor?.type === "AUTOMATION" ? "AUTOMATION" as const : "SYSTEM" as const,
            }));
          if (basisFacts.length === 0) return [];
          return manualActivityCorrectionFacts({
            workspaceId, originalId: original.id, correctionId: correction.id,
            originalOccurredAt: original.occurredAt, correctionOccurredAt: correction.occurredAt,
            reason: correction.description ?? "Correção de resultado", type: original.type,
            direction: original.direction, previousResult, correctedResult: nextResult,
            originalFacts: basisFacts,
          });
        });
      },
    },
  ];
}

export function createCommercialMetricBackfillService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    const inputFingerprint = fingerprint({ workspaceId: context.workspaceId, mode: input.mode, runKey: input.runKey, ruleVersion: RULE_VERSION });
    let run = await options.database.commercialMetricBackfillRun.findUnique({ where: { workspaceId_mode_inputFingerprint: { workspaceId: context.workspaceId, mode: input.mode, inputFingerprint } } });
    if (run?.status === "COMPLETED") return Object.freeze({ ...run, replay: true });
    if (!run) run = await options.database.commercialMetricBackfillRun.create({ data: { workspaceId: context.workspaceId, mode: input.mode, inputFingerprint, ruleVersion: RULE_VERSION, requestedByActorId: context.actorId } });
    const allSources = sources(options.database, context.workspaceId);
    const resume = run.cursor?.split(":", 2) ?? [];
    const startIndex = resume[0] ? Number(resume[0]) : 0;
    let cursor = resume[1] || null;
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > allSources.length) throw new ApplicationError("Cursor de backfill inválido.", { code: "COMMERCIAL_METRIC_BACKFILL_CURSOR_INVALID", statusCode: 409, expose: true });

    try {
      for (let sourceIndex = startIndex; sourceIndex < allSources.length; sourceIndex += 1) {
        const source = allSources[sourceIndex]!;
        if (sourceIndex !== startIndex) cursor = null;
        while (true) {
          const rows = await source.fetch(cursor, input.batchSize);
          if (rows.length === 0) break;
          await options.database.$transaction(async (tx) => {
            for (const row of rows) {
              for (const candidate of row.candidates) {
                const candidateFingerprint = commercialMetricFactFingerprint(candidate);
                const priorItem = await tx.commercialMetricBackfillItem.findUnique({ where: { workspaceId_runId_eventKey: { workspaceId: context.workspaceId, runId: run!.id, eventKey: candidate.eventKey } } });
                if (priorItem) continue;
                const existing = await tx.commercialMetricFact.findUnique({ where: { workspaceId_eventKey: { workspaceId: context.workspaceId, eventKey: candidate.eventKey } }, select: { id: true } });
                if (existing) {
                  await tx.commercialMetricBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run!.id, sourceEntityType: candidate.sourceEntityType, sourceEntityId: candidate.sourceEntityId, eventKey: candidate.eventKey, outcome: "ALREADY_PRESENT", factId: existing.id, inputFingerprint: candidateFingerprint } });
                } else if (input.mode === "DRY_RUN") {
                  await tx.commercialMetricBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run!.id, sourceEntityType: candidate.sourceEntityType, sourceEntityId: candidate.sourceEntityId, eventKey: candidate.eventKey, outcome: "SKIPPED", reasonCode: "DRY_RUN_ELIGIBLE", inputFingerprint: candidateFingerprint } });
                } else {
                  const recorded = await recordCommercialMetricFactInTransaction(tx, candidate);
                  await tx.commercialMetricBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run!.id, sourceEntityType: candidate.sourceEntityType, sourceEntityId: candidate.sourceEntityId, eventKey: candidate.eventKey, outcome: recorded.idempotent ? "ALREADY_PRESENT" : "CREATED", factId: recorded.fact.id, inputFingerprint: candidateFingerprint } });
                }
              }
            }
            const lastId = rows.at(-1)!.id;
            await tx.commercialMetricBackfillRun.update({ where: { id: run!.id }, data: { cursor: `${sourceIndex}:${lastId}` } });
          }, { isolationLevel: "ReadCommitted", timeout: 60_000 });
          cursor = rows.at(-1)!.id;
          if (rows.length < input.batchSize) break;
        }
        await options.database.commercialMetricBackfillRun.update({ where: { id: run.id }, data: { cursor: `${sourceIndex + 1}:` } });
      }
      const grouped = await options.database.commercialMetricBackfillItem.groupBy({ by: ["outcome"], where: { workspaceId: context.workspaceId, runId: run.id }, _count: { _all: true } });
      const counts = new Map(grouped.map((group) => [group.outcome, group._count._all]));
      const eligibleCount = grouped.reduce((total, group) => total + group._count._all, 0);
      const summary = { runKey: input.runKey, sources: allSources.map((source) => source.name), ruleVersion: RULE_VERSION, dryRun: input.mode === "DRY_RUN" } satisfies Prisma.InputJsonValue;
      const completed = await options.database.$transaction(async (tx) => {
        const result = await tx.commercialMetricBackfillRun.update({ where: { id: run!.id }, data: { status: "COMPLETED", cursor: `${allSources.length}:`, eligibleCount, createdCount: counts.get("CREATED") ?? 0, existingCount: counts.get("ALREADY_PRESENT") ?? 0, reviewCount: counts.get("REVIEW_REQUIRED") ?? 0, skippedCount: counts.get("SKIPPED") ?? 0, failedCount: counts.get("FAILED") ?? 0, finishedAt: options.now(), summary } });
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "commercial_metrics.backfill.completed", entityType: "CommercialMetricBackfillRun", entityId: run!.id, changes: { mode: input.mode, eligibleCount, createdCount: counts.get("CREATED") ?? 0, existingCount: counts.get("ALREADY_PRESENT") ?? 0, skippedCount: counts.get("SKIPPED") ?? 0 }, metadata: summary } });
        return result;
      });
      return Object.freeze({ ...completed, replay: false });
    } catch (error) {
      await options.database.commercialMetricBackfillRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: options.now(), summary: { runKey: input.runKey, errorCode: error instanceof ApplicationError ? error.code : "UNEXPECTED_ERROR" } } });
      throw error;
    }
  }
  return Object.freeze({ run });
}

export const getCommercialMetricBackfillService = () => createCommercialMetricBackfillService({ database: getDatabaseClient(), now: () => new Date() });
