import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { CommercialMetricEventType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/shared/core/database/client";
import { COMMERCIAL_METRIC_RECONCILIATION_RULE_VERSION } from "@/modules/metrics/domain/commercial-metric-quality";
import { z } from "zod";

const RULE_VERSION = COMMERCIAL_METRIC_RECONCILIATION_RULE_VERSION;
const inputSchema = z.object({ runKey: z.string().trim().regex(/^[a-z0-9][a-z0-9:._-]{7,160}$/) }).strict();

type ExpectedCheck = Readonly<{
  sourceEntityType: string;
  eventType: CommercialMetricEventType;
  expectedCount: number;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}>;

function check(sourceEntityType: string, eventType: CommercialMetricEventType, expectedCount: number, details?: ExpectedCheck["details"]): ExpectedCheck {
  return Object.freeze({ sourceEntityType, eventType, expectedCount, ...(details ? { details } : {}) });
}

async function expectedChecks(database: PrismaClient, workspaceId: string): Promise<readonly ExpectedCheck[]> {
  const [
    contacts, submissions, leads, stageEntries, stageExits, qualifiedStages, disqualifiedStages, meetingMarkedStages,
    tasks, completedTasks, cancelledTasks, taskCallAttempts,
    taskCallsConnected, taskCallsUnanswered, taskCallsFailed, taskInstagramMessages, instagramFollows,
    meetings, confirmedMeetings, rescheduledMeetings, completedMeetings, cancelledMeetings, noShowMeetings,
    opportunities, offers, wonOpportunities, lostOpportunities, validatedPacto,
    statusCallAttempts, statusCallsConnected, statusCallsUnanswered, statusCallsFailed,
    fallbackCallAttempts, fallbackCallsConnected, fallbackCallsUnanswered, fallbackCallsFailed,
    instagramMessages, inboundMessageRows, prospectingEmailHumanReplies, emailScheduled, emailSent, emailDelivered, emailStatusReplied, emailReplied,
    emailBounced, emailComplaints, emailUnsubscribed, emailCancelled, emailFailed,
    acceptedContracts, revenueMovements, activatedSubscriptions, churnedSubscriptions,
    invoicesIssued, paymentsConfirmed, paymentsReversed,
  ] = await Promise.all([
    database.contact.count({ where: { workspaceId } }),
    database.leadFormSubmission.count({ where: { workspaceId } }),
    database.lead.count({ where: { workspaceId } }),
    database.stageHistory.count({ where: { workspaceId } }),
    database.stageHistory.count({ where: { workspaceId, exitedAt: { not: null } } }),
    database.stageHistory.count({ where: { workspaceId, leadId: { not: null }, stage: { leadStageCode: "QUALIFIED" } } }),
    database.stageHistory.count({ where: { workspaceId, leadId: { not: null }, stage: { leadStageCode: "DISQUALIFIED" } } }),
    database.stageHistory.count({ where: { workspaceId, leadId: { not: null }, transitionOrigin: { not: "MEETING" }, stage: { leadStageCode: "MEETING_SCHEDULED" } } }),
    database.task.count({ where: { workspaceId } }),
    database.task.count({ where: { workspaceId, status: "COMPLETED", completedAt: { not: null } } }),
    database.task.count({ where: { workspaceId, status: "CANCELLED" } }),
    database.task.count({ where: { workspaceId, kind: "CALL", status: "COMPLETED", completedAt: { not: null } } }),
    database.task.count({ where: { workspaceId, kind: "CALL", result: { in: ["CONNECTED", "CALLBACK_REQUESTED", "WHATSAPP_SHARED"] }, status: "COMPLETED", completedAt: { not: null } } }),
    database.task.count({ where: { workspaceId, kind: "CALL", result: { in: ["NO_ANSWER", "BUSY", "VOICEMAIL"] }, status: "COMPLETED", completedAt: { not: null } } }),
    database.task.count({ where: { workspaceId, kind: "CALL", result: { in: ["WRONG_NUMBER", "CHANNEL_UNAVAILABLE"] }, status: "COMPLETED", completedAt: { not: null } } }),
    database.task.count({ where: { workspaceId, kind: "INSTAGRAM_MESSAGE", result: "SENT", status: "COMPLETED", completedAt: { not: null } } }),
    database.task.count({ where: { workspaceId, kind: "INSTAGRAM_FOLLOW", result: "COMPLETED", status: "COMPLETED", completedAt: { not: null } } }),
    database.meetingHistory.count({ where: { workspaceId, action: "SCHEDULED" } }),
    database.meetingHistory.count({ where: { workspaceId, action: "CONFIRMED" } }),
    database.meetingHistory.count({ where: { workspaceId, action: "RESCHEDULED" } }),
    database.meetingHistory.count({ where: { workspaceId, action: "ATTENDED" } }),
    database.meetingHistory.count({ where: { workspaceId, action: "CANCELLED" } }),
    database.meetingHistory.count({ where: { workspaceId, action: "NO_SHOW" } }),
    database.opportunity.count({ where: { workspaceId } }),
    database.offer.count({ where: { workspaceId } }),
    database.opportunityOutcomeSnapshot.count({ where: { workspaceId, status: "WON" } }),
    database.opportunityOutcomeSnapshot.count({ where: { workspaceId, status: "LOST" } }),
    database.pactoRevision.count({ where: { workspaceId, kind: "VALIDATED" } }),
    database.phoneCallStatusEvent.count({ where: { workspaceId, status: "INITIATED", call: { direction: "OUTBOUND" } } }),
    database.phoneCallStatusEvent.count({ where: { workspaceId, status: "ANSWERED", call: { direction: "OUTBOUND" } } }),
    database.phoneCallStatusEvent.count({ where: { workspaceId, status: { in: ["BUSY", "NO_ANSWER", "VOICEMAIL"] }, call: { direction: "OUTBOUND" } } }),
    database.phoneCallStatusEvent.count({ where: { workspaceId, status: { in: ["FAILED", "CANCELLED"] }, call: { direction: "OUTBOUND" } } }),
    database.phoneCall.count({ where: { workspaceId, direction: "OUTBOUND", initiatedAt: { not: null }, statusEvents: { none: { status: "INITIATED" } } } }),
    database.phoneCall.count({ where: { workspaceId, direction: "OUTBOUND", answeredAt: { not: null }, statusEvents: { none: { status: "ANSWERED" } } } }),
    database.phoneCall.count({ where: { workspaceId, direction: "OUTBOUND", answeredAt: null, status: { in: ["BUSY", "NO_ANSWER", "VOICEMAIL"] }, statusEvents: { none: { status: { in: ["BUSY", "NO_ANSWER", "VOICEMAIL"] } } } } }),
    database.phoneCall.count({ where: { workspaceId, direction: "OUTBOUND", answeredAt: null, status: { in: ["FAILED", "CANCELLED"] }, statusEvents: { none: { status: { in: ["FAILED", "CANCELLED"] } } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "SENT", message: { direction: "OUTBOUND", conversation: { channel: { in: ["INSTAGRAM", "INSTAGRAM_MESSAGING"] } } } } }),
    database.message.findMany({ where: { workspaceId, direction: "INBOUND", conversation: { leadId: { not: null } } }, select: { id: true, conversation: { select: { leadId: true } } } }),
    database.prospectingEmailEvent.count({ where: { workspaceId, eventType: "REPLIED", emailJobId: { not: null }, NOT: { safeMetadata: { path: ["automaticReply"], equals: true } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "QUEUED", message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "SENT", message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "DELIVERED", message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "REPLIED", message: { conversation: { channel: "EMAIL" } } } }),
    database.message.count({ where: { workspaceId, direction: "INBOUND", conversation: { channel: "EMAIL", leadId: { not: null } }, NOT: { AND: [{ isSimulated: true }, { replyTo: { is: { statusEvents: { some: { status: "REPLIED" } } } } }] } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: { in: ["SOFT_BOUNCE", "HARD_BOUNCE", "BOUNCED"] }, message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "COMPLAINT", message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "UNSUBSCRIBED", message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "CANCELLED", message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: { in: ["FAILED_TRANSIENT", "FAILED_PERMANENT", "FAILED"] }, message: { conversation: { channel: "EMAIL" } } } }),
    database.contractEvent.count({ where: { workspaceId, eventType: "ACCEPTED_LOCAL_MANUAL" } }),
    database.revenueMovement.count({ where: { workspaceId } }),
    database.revenueMovement.count({ where: { workspaceId, type: "NEW" } }),
    database.revenueMovement.count({ where: { workspaceId, type: "CHURN" } }),
    database.paymentEvent.count({ where: { workspaceId, type: "INVOICE_ISSUED" } }),
    database.paymentEvent.count({ where: { workspaceId, type: "PAYMENT_CONFIRMED" } }),
    database.paymentEvent.count({ where: { workspaceId, type: "PAYMENT_REVERSED" } }),
  ]);

  const inboundMessages = inboundMessageRows.length;
  const firstHumanResponses = new Set(inboundMessageRows.flatMap((message) => message.conversation.leadId ? [message.conversation.leadId] : [])).size;
  const [manualActivities] = await database.$queryRaw<ReadonlyArray<{
    callAttempts: bigint;
    connectedCalls: bigint;
    unansweredCalls: bigint;
    inboundMessages: bigint;
    emailsSent: bigint;
    instagramMessagesSent: bigint;
  }>>`
    SELECT
      COUNT(*) FILTER (WHERE activity."direction"::text = 'OUTBOUND' AND activity."type"::text IN ('CALL', 'CALL_CONNECTED', 'CALL_UNANSWERED') AND activity."effectiveResult" IN ('CONNECTED', 'NOT_CONNECTED')) AS "callAttempts",
      COUNT(*) FILTER (WHERE activity."direction"::text = 'OUTBOUND' AND activity."type"::text IN ('CALL', 'CALL_CONNECTED', 'CALL_UNANSWERED') AND activity."effectiveResult" = 'CONNECTED') AS "connectedCalls",
      COUNT(*) FILTER (WHERE activity."direction"::text = 'OUTBOUND' AND activity."type"::text IN ('CALL', 'CALL_CONNECTED', 'CALL_UNANSWERED') AND activity."effectiveResult" = 'NOT_CONNECTED') AS "unansweredCalls",
      COUNT(*) FILTER (WHERE activity."direction"::text = 'INBOUND' AND activity."type"::text = 'MESSAGE_RECEIVED') AS "inboundMessages",
      COUNT(*) FILTER (WHERE activity."direction"::text = 'OUTBOUND' AND activity."type"::text = 'EMAIL' AND activity."effectiveResult" = 'SENT') AS "emailsSent",
      COUNT(*) FILTER (WHERE activity."direction"::text = 'OUTBOUND' AND activity."type"::text = 'MESSAGE_SENT' AND activity."communicationChannel" = 'INSTAGRAM' AND activity."effectiveResult" = 'SENT') AS "instagramMessagesSent"
    FROM (
      SELECT source."workspaceId", source."id", source."direction", source."type", source."newValues"->>'communicationChannel' AS "communicationChannel",
        COALESCE(latest."correctedResult", source."result"::text,
          CASE source."type"::text WHEN 'CALL_CONNECTED' THEN 'CONNECTED' WHEN 'CALL_UNANSWERED' THEN 'NOT_CONNECTED' WHEN 'EMAIL' THEN 'SENT' WHEN 'MESSAGE_SENT' THEN 'SENT' END
        ) AS "effectiveResult"
      FROM "activities" source
      LEFT JOIN LATERAL (
        SELECT correction."newValues"->>'result' AS "correctedResult"
        FROM "activities" correction
        WHERE correction."workspaceId" = source."workspaceId"
          AND correction."correctsActivityId" = source."id"
          AND correction."newValues"->>'result' IN ('CONNECTED', 'NOT_CONNECTED')
          AND correction."deletedAt" IS NULL
        ORDER BY correction."createdAt" DESC, correction."id" DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE source."workspaceId" = ${workspaceId}::uuid
        AND source."deletedAt" IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM "audit_logs" log
            WHERE log."workspaceId" = source."workspaceId"
              AND log."entityType" = 'Activity'
              AND log."entityId" = source."id"
              AND log."action" = 'activity.recorded'
          )
          OR (
            source."direction"::text = 'OUTBOUND'
            AND source."type"::text IN ('CALL', 'CALL_CONNECTED', 'CALL_UNANSWERED')
            AND source."phoneCallId" IS NULL
            AND source."messageId" IS NULL
            AND source."correctsActivityId" IS NULL
          )
        )
    ) activity
  `;
  return Object.freeze([
    check("Contact", "CONTACT_CREATED", contacts), check("LeadFormSubmission", "LEAD_SUBMISSION_ATTACHED", submissions),
    check("Lead", "LEAD_CREATED", leads),
    check("StageHistory", "STAGE_ENTERED", stageEntries), check("StageHistory", "STAGE_EXITED", stageExits),
    check("StageHistory", "LEAD_QUALIFIED", qualifiedStages), check("StageHistory", "LEAD_DISQUALIFIED", disqualifiedStages),
    check("StageHistory", "MEETING_SCHEDULED", meetingMarkedStages),
    check("Task", "TASK_CREATED", tasks), check("Task", "TASK_COMPLETED", completedTasks), check("Task", "TASK_CANCELLED", cancelledTasks),
    check("Task", "CALL_ATTEMPTED", taskCallAttempts), check("Task", "CALL_CONNECTED", taskCallsConnected), check("Task", "CALL_UNANSWERED", taskCallsUnanswered), check("Task", "CALL_FAILED", taskCallsFailed),
    check("Task", "INSTAGRAM_MESSAGE_SENT", taskInstagramMessages), check("Task", "INSTAGRAM_FOLLOW_COMPLETED", instagramFollows),
    check("MeetingHistory", "MEETING_SCHEDULED", meetings), check("MeetingHistory", "MEETING_CONFIRMED", confirmedMeetings), check("MeetingHistory", "MEETING_RESCHEDULED", rescheduledMeetings), check("MeetingHistory", "MEETING_COMPLETED", completedMeetings), check("MeetingHistory", "MEETING_CANCELLED", cancelledMeetings), check("MeetingHistory", "MEETING_NO_SHOW", noShowMeetings),
    check("Opportunity", "OPPORTUNITY_CREATED", opportunities), check("Offer", "PROPOSAL_REACHED", offers), check("OpportunityOutcomeSnapshot", "OPPORTUNITY_WON", wonOpportunities), check("OpportunityOutcomeSnapshot", "SALE_WON", wonOpportunities), check("OpportunityOutcomeSnapshot", "OPPORTUNITY_LOST", lostOpportunities),
    check("PactoRevision", "PACTO_VALIDATED", validatedPacto),
    check("PhoneCallStatusEvent", "CALL_ATTEMPTED", statusCallAttempts), check("PhoneCallStatusEvent", "CALL_CONNECTED", statusCallsConnected), check("PhoneCallStatusEvent", "CALL_UNANSWERED", statusCallsUnanswered), check("PhoneCallStatusEvent", "CALL_FAILED", statusCallsFailed),
    check("PhoneCall", "CALL_ATTEMPTED", fallbackCallAttempts), check("PhoneCall", "CALL_CONNECTED", fallbackCallsConnected), check("PhoneCall", "CALL_UNANSWERED", fallbackCallsUnanswered), check("PhoneCall", "CALL_FAILED", fallbackCallsFailed),
    check("Activity", "CALL_ATTEMPTED", Number(manualActivities?.callAttempts ?? 0n)), check("Activity", "CALL_CONNECTED", Number(manualActivities?.connectedCalls ?? 0n)), check("Activity", "CALL_UNANSWERED", Number(manualActivities?.unansweredCalls ?? 0n)),
    check("Activity", "INBOUND_MESSAGE_RECEIVED", Number(manualActivities?.inboundMessages ?? 0n)), check("Activity", "HUMAN_RESPONSE_CONFIRMED", Number(manualActivities?.inboundMessages ?? 0n)),
    check("Activity", "EMAIL_SENT", Number(manualActivities?.emailsSent ?? 0n)),
    check("Activity", "INSTAGRAM_MESSAGE_SENT", Number(manualActivities?.instagramMessagesSent ?? 0n)),
    check("MessageStatusEvent", "INSTAGRAM_MESSAGE_SENT", instagramMessages), check("Message", "INBOUND_MESSAGE_RECEIVED", inboundMessages), check("Message", "HUMAN_RESPONSE_CONFIRMED", firstHumanResponses),
    check("ProspectingEmailEvent", "INBOUND_MESSAGE_RECEIVED", prospectingEmailHumanReplies),
    check("MessageStatusEvent", "EMAIL_SCHEDULED", emailScheduled), check("MessageStatusEvent", "EMAIL_SENT", emailSent), check("MessageStatusEvent", "EMAIL_DELIVERED", emailDelivered), check("MessageStatusEvent", "EMAIL_REPLIED", emailStatusReplied), check("Message", "EMAIL_REPLIED", emailReplied), check("MessageStatusEvent", "EMAIL_BOUNCED", emailBounced), check("MessageStatusEvent", "EMAIL_COMPLAINT", emailComplaints), check("MessageStatusEvent", "EMAIL_UNSUBSCRIBED", emailUnsubscribed), check("MessageStatusEvent", "EMAIL_CANCELLED", emailCancelled), check("MessageStatusEvent", "EMAIL_FAILED", emailFailed),
    check("ContractEvent", "CONTRACT_ACCEPTED", acceptedContracts),
    check("RevenueMovement", "REVENUE_MOVEMENT_POSTED", revenueMovements), check("RevenueMovement", "SUBSCRIPTION_ACTIVATED", activatedSubscriptions), check("RevenueMovement", "CHURN_CONFIRMED", churnedSubscriptions),
    check("PaymentEvent", "INVOICE_ISSUED", invoicesIssued), check("PaymentEvent", "PAYMENT_CONFIRMED", paymentsConfirmed), check("PaymentEvent", "PAYMENT_REVERSED", paymentsReversed),
  ]);
}

export function createCommercialMetricReconciliationService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    const prior = await options.database.commercialMetricReconciliationRun.findUnique({ where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } } });
    if (prior?.status === "COMPLETED") return Object.freeze({ ...prior, replay: true });
    const run = prior ?? await options.database.commercialMetricReconciliationRun.create({ data: { workspaceId: context.workspaceId, runKey: input.runKey, ruleVersion: RULE_VERSION, requestedByActorId: context.actorId } });
    try {
      const expected = await expectedChecks(options.database, context.workspaceId);
      const actualGroups = await options.database.commercialMetricFact.groupBy({
        by: ["sourceEntityType", "eventType"],
        where: { workspaceId: context.workspaceId },
        _sum: { quantity: true },
      });
      const actualByKey = new Map(actualGroups.map((group) => [`${group.sourceEntityType}:${group.eventType}`, group._sum.quantity ?? 0]));
      const checks = expected.map((item) => {
        const actualCount = actualByKey.get(`${item.sourceEntityType}:${item.eventType}`) ?? 0;
        const gapCount = actualCount - item.expectedCount;
        return Object.freeze({ ...item, actualCount, gapCount, state: gapCount === 0 ? "MATCHED" as const : "DIVERGENT" as const });
      });
      const expectedCount = checks.reduce((sum, item) => sum + item.expectedCount, 0);
      const actualCount = checks.reduce((sum, item) => sum + item.actualCount, 0);
      const gapCount = actualCount - expectedCount;
      const matchedCheckCount = checks.filter((item) => item.state === "MATCHED").length;
      const divergentCheckCount = checks.length - matchedCheckCount;
      const completed = await options.database.$transaction(async (tx) => {
        // Falhas revertem a transação inteira; uma retomada não tem verificações anteriores a apagar.
        await tx.commercialMetricReconciliationCheck.createMany({ data: checks.map((item) => ({
          workspaceId: context.workspaceId, runId: run.id, sourceEntityType: item.sourceEntityType, eventType: item.eventType,
          state: item.state, expectedCount: item.expectedCount, actualCount: item.actualCount, gapCount: item.gapCount,
          ...(item.details ? { details: item.details as Prisma.InputJsonValue } : {}),
        })) });
        const result = await tx.commercialMetricReconciliationRun.update({ where: { id: run.id }, data: {
          status: "COMPLETED", expectedCount, actualCount, gapCount, matchedCheckCount, divergentCheckCount,
          finishedAt: options.now(), summary: { ruleVersion: RULE_VERSION, checkCount: checks.length },
        } });
        await tx.auditLog.create({ data: {
          workspaceId: context.workspaceId, actorId: context.actorId, action: "commercial_metrics.reconciliation.completed",
          entityType: "CommercialMetricReconciliationRun", entityId: run.id,
          changes: { expectedCount, actualCount, gapCount, matchedCheckCount, divergentCheckCount },
          metadata: { runKey: input.runKey, ruleVersion: RULE_VERSION },
        } });
        return result;
      });
      return Object.freeze({ ...completed, checks: Object.freeze(checks), replay: false });
    } catch (error) {
      await options.database.commercialMetricReconciliationRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: options.now() } });
      throw error;
    }
  }
  return Object.freeze({ run });
}

export const getCommercialMetricReconciliationService = () => createCommercialMetricReconciliationService({ database: getDatabaseClient(), now: () => new Date() });
