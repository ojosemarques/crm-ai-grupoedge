import { createHash } from "node:crypto";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { CommercialMetricEventType, Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  commercialMetricFactFingerprint,
  type CommercialMetricFactInput,
  recordCommercialMetricFactInTransaction,
} from "@/modules/metrics/application/commercial-metric-fact-writer";
import { prospectingTaskMetricEvents } from "@/modules/prospecting/domain/prospecting-task-metric-events";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const RULE_VERSION = 2;
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

function eventTypeForMessage(status: string, channel: string, direction: string): CommercialMetricEventType | null {
  if (channel === "INSTAGRAM" || channel === "INSTAGRAM_MESSAGING") {
    return direction === "OUTBOUND" && status === "SENT" ? "INSTAGRAM_MESSAGE_SENT" : null;
  }
  if (channel !== "EMAIL") return null;
  const mapping: Readonly<Record<string, CommercialMetricEventType>> = {
    QUEUED: "EMAIL_SCHEDULED", PROVIDER_ACCEPTED: "EMAIL_SENT", SENT: "EMAIL_SENT", DELIVERED: "EMAIL_DELIVERED",
    REPLIED: "EMAIL_REPLIED", SOFT_BOUNCE: "EMAIL_BOUNCED", HARD_BOUNCE: "EMAIL_BOUNCED", BOUNCED: "EMAIL_BOUNCED",
    COMPLAINT: "EMAIL_COMPLAINT", UNSUBSCRIBED: "EMAIL_UNSUBSCRIBED", CANCELLED: "EMAIL_CANCELLED",
    FAILED_TRANSIENT: "EMAIL_FAILED", FAILED_PERMANENT: "EMAIL_FAILED", FAILED: "EMAIL_FAILED",
  };
  return mapping[status] ?? null;
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
          }] : [])];
        });
      },
    },
    {
      name: "tasks",
      fetch: async (cursor, take) => page(await database.task.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, leadId: true, opportunityId: true, meetingId: true, assigneeMemberId: true, kind: true, status: true, result: true, createdAt: true, completedAt: true, automationRunId: true },
      }), (task) => [{
        workspaceId, eventKey: `task:${task.id}:created:v1`, eventType: "TASK_CREATED", occurredAt: task.createdAt,
        sourceEntityType: "Task", sourceEntityId: task.id, leadId: task.leadId, opportunityId: task.opportunityId,
        meetingId: task.meetingId, taskId: task.id, creditedMemberId: task.assigneeMemberId, taskKind: task.kind,
        executionMode: task.automationRunId ? "AUTOMATION" : "SYSTEM", safeMetadata: { provenance: "backfill" },
      }, ...(task.status === "COMPLETED" && task.completedAt ? [{
        workspaceId, eventKey: `task:${task.id}:completed:v1`, eventType: "TASK_COMPLETED" as const, occurredAt: task.completedAt,
        sourceEntityType: "Task", sourceEntityId: task.id, leadId: task.leadId, opportunityId: task.opportunityId,
        meetingId: task.meetingId, taskId: task.id, creditedMemberId: task.assigneeMemberId, taskKind: task.kind, result: task.result,
        executionMode: task.automationRunId ? "AUTOMATION" as const : "SYSTEM" as const, safeMetadata: { provenance: "backfill" },
      }, ...prospectingTaskMetricEvents(task.kind, task.result).map((event) => ({
        workspaceId, eventKey: `task:${task.id}:${event.eventKeySuffix}:v1`, eventType: event.eventType, occurredAt: task.completedAt!,
        sourceEntityType: "Task", sourceEntityId: task.id, leadId: task.leadId, opportunityId: task.opportunityId,
        meetingId: task.meetingId, taskId: task.id, creditedMemberId: task.assigneeMemberId, taskKind: task.kind, result: task.result,
        channel: event.channel, direction: "OUTBOUND", executionMode: task.automationRunId ? "AUTOMATION" as const : "MANUAL" as const, safeMetadata: { provenance: "backfill" },
      }))] : []), ...(task.status === "CANCELLED" ? [{
        workspaceId, eventKey: `task:${task.id}:cancelled:v1`, eventType: "TASK_CANCELLED" as const, occurredAt: task.completedAt ?? task.createdAt,
        sourceEntityType: "Task", sourceEntityId: task.id, leadId: task.leadId, opportunityId: task.opportunityId,
        meetingId: task.meetingId, taskId: task.id, creditedMemberId: task.assigneeMemberId, taskKind: task.kind, result: task.result,
        safeMetadata: { provenance: "backfill", occurredAtBasis: task.completedAt ? "completedAt" : "createdAt_fallback" },
      }] : [])]),
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
            workspaceId, eventKey: `meeting-history:${history.id}:${eventType.toLowerCase()}:v1`, eventType, occurredAt: history.occurredAt,
            sourceEntityType: "MeetingHistory", sourceEntityId: history.id, meetingId: history.meetingId, leadId: history.leadId,
            opportunityId: history.meeting.opportunityId, creditedMemberId: history.ownerMemberId, performedByMemberId: performer,
            bookedByMemberId: history.action === "SCHEDULED" ? performer : null, meetingOwnerMemberIdAtEvent: history.ownerMemberId,
            durationSeconds: history.meeting.durationMinutes * 60, result: history.outcome, safeMetadata: { provenance: "backfill" },
          }];
        });
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
      name: "phone_calls",
      fetch: async (cursor, take) => page(await database.phoneCall.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, leadId: true, contactId: true, accountId: true, opportunityId: true, meetingId: true, campaignId: true, ownerMemberId: true, teamId: true, direction: true, status: true, disposition: true, queuedAt: true, initiatedAt: true, answeredAt: true, completedAt: true, durationSeconds: true, talkDurationSeconds: true, messageId: true },
      }), (call) => {
        if (call.direction !== "OUTBOUND") return [];
        const common = { workspaceId, sourceEntityType: "PhoneCall", sourceEntityId: call.id, phoneCallId: call.id, messageId: call.messageId, leadId: call.leadId, contactId: call.contactId, accountId: call.accountId, opportunityId: call.opportunityId, meetingId: call.meetingId, campaignId: call.campaignId, creditedMemberId: call.ownerMemberId, teamId: call.teamId, direction: call.direction, safeMetadata: { provenance: "backfill" } } as const;
        const terminal: CommercialMetricEventType | null = call.answeredAt ? "CALL_CONNECTED" : ["BUSY", "NO_ANSWER", "VOICEMAIL"].includes(call.status) ? "CALL_UNANSWERED" : call.status === "FAILED" ? "CALL_FAILED" : null;
        return [{ ...common, eventKey: `phone-call:${call.id}:attempted:v1`, eventType: "CALL_ATTEMPTED", occurredAt: call.initiatedAt ?? call.queuedAt }, ...(terminal ? [{ ...common, eventKey: `phone-call:${call.id}:${terminal.toLowerCase()}:v1`, eventType: terminal, occurredAt: call.answeredAt ?? call.completedAt ?? call.queuedAt, durationSeconds: call.talkDurationSeconds ?? call.durationSeconds, result: call.disposition }] : [])];
      }),
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
        const jobById = new Map(jobs.map((job) => [job.id, job]));
        const ownerByCadence = new Map(cadences.map((cadence) => [cadence.id, cadence.ownerMemberId]));
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
            cadenceStepKey: job.stepKey, channel: "EMAIL", direction: "INBOUND", result: event.eventType,
            executionMode: "AUTOMATION" as const, safeMetadata: { provenance: "backfill", automaticReply },
          } as const;
          return [
            { ...common, eventKey: `prospecting-email-event:${event.id}:${eventType.toLowerCase()}:v1`, eventType },
            ...(event.eventType === "REPLIED" && automaticReply ? [{ ...common, eventKey: `prospecting-email-event:${event.id}:auto_response_received:v1`, eventType: "AUTO_RESPONSE_RECEIVED" as const }] : []),
          ];
        });
      },
    },
    {
      name: "message_status_events",
      fetch: async (cursor, take) => page(await database.messageStatusEvent.findMany({
        where: { workspaceId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take,
        select: { id: true, status: true, providerOccurredAt: true, ingestedAt: true, message: { select: { id: true, direction: true, automationRunId: true, conversation: { select: { channel: true, leadId: true, contactId: true, accountId: true, opportunityId: true, meetingId: true, assigneeMemberId: true } } } } },
      }), (event) => {
        const eventType = eventTypeForMessage(event.status, event.message.conversation.channel, event.message.direction);
        if (!eventType) return [];
        const conversation = event.message.conversation;
        return [{ workspaceId, eventKey: `message-status:${event.id}:${eventType.toLowerCase()}:v1`, eventType, occurredAt: event.providerOccurredAt ?? event.ingestedAt, sourceEntityType: "MessageStatusEvent", sourceEntityId: event.id, messageId: event.message.id, leadId: conversation.leadId, contactId: conversation.contactId, accountId: conversation.accountId, opportunityId: conversation.opportunityId, meetingId: conversation.meetingId, creditedMemberId: conversation.assigneeMemberId, channel: conversation.channel, direction: event.message.direction, executionMode: event.message.automationRunId ? "AUTOMATION" : "SYSTEM", safeMetadata: { provenance: "backfill" } }];
      }),
    },
    {
      name: "inbound_messages",
      fetch: async (cursor, take) => {
        const messages = await database.message.findMany({
          where: { workspaceId, direction: "INBOUND", conversation: { leadId: { not: null } }, ...(cursor ? { id: { gt: cursor } } : {}) },
          orderBy: { id: "asc" }, take,
          select: { id: true, occurredAt: true, conversation: { select: { channel: true, leadId: true, contactId: true, accountId: true, opportunityId: true, meetingId: true, assigneeMemberId: true, lead: { select: { sourceId: true, campaignId: true, creativeId: true } } } } },
        });
        const leadIds = [...new Set(messages.flatMap((message) => message.conversation.leadId ? [message.conversation.leadId] : []))];
        const firstByLead = new Map<string, string>();
        await Promise.all(leadIds.map(async (leadId) => {
          const first = await database.message.findFirst({
            where: { workspaceId, direction: "INBOUND", conversation: { leadId } },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { id: true },
          });
          if (first) firstByLead.set(leadId, first.id);
        }));
        return page(messages, (message) => {
          const conversation = message.conversation;
          const leadId = conversation.leadId!;
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
            ...(conversation.channel === "EMAIL" ? [{ ...common, eventKey: `message:${message.id}:email-replied:v1`, eventType: "EMAIL_REPLIED" as const }] : []),
          ];
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
