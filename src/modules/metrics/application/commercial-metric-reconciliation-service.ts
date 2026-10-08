import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { CommercialMetricEventType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDatabaseClient } from "@/shared/core/database/client";
import { z } from "zod";

const RULE_VERSION = 1;
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
    contacts, submissions, leads, stageEntries, stageExits, tasks, completedTasks, cancelledTasks, taskCallAttempts,
    taskCallsConnected, taskCallsUnanswered, taskCallsFailed, taskInstagramMessages, instagramFollows,
    meetings, confirmedMeetings, rescheduledMeetings, completedMeetings, cancelledMeetings, noShowMeetings,
    opportunities, wonOpportunities, lostOpportunities, validatedPacto,
    outboundCalls, connectedCalls, unansweredCalls, failedCalls,
    instagramMessages, inboundMessageRows, emailScheduled, emailSent, emailDelivered, emailReplied,
    emailBounced, emailComplaints, emailUnsubscribed, emailCancelled, emailFailed,
    acceptedContracts, revenueMovements, activatedSubscriptions, churnedSubscriptions,
    invoicesIssued, paymentsConfirmed, paymentsReversed,
  ] = await Promise.all([
    database.contact.count({ where: { workspaceId } }),
    database.leadFormSubmission.count({ where: { workspaceId } }),
    database.lead.count({ where: { workspaceId } }),
    database.stageHistory.count({ where: { workspaceId } }),
    database.stageHistory.count({ where: { workspaceId, exitedAt: { not: null } } }),
    database.task.count({ where: { workspaceId } }),
    database.task.count({ where: { workspaceId, status: "COMPLETED", completedAt: { not: null } } }),
    database.task.count({ where: { workspaceId, status: "CANCELLED" } }),
    database.task.count({ where: { workspaceId, kind: "CALL", status: "COMPLETED", completedAt: { not: null } } }),
    database.task.count({ where: { workspaceId, kind: "CALL", result: "CONNECTED", status: "COMPLETED", completedAt: { not: null } } }),
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
    database.opportunityOutcomeSnapshot.count({ where: { workspaceId, status: "WON" } }),
    database.opportunityOutcomeSnapshot.count({ where: { workspaceId, status: "LOST" } }),
    database.pactoRevision.count({ where: { workspaceId, kind: "VALIDATED" } }),
    database.phoneCall.count({ where: { workspaceId, direction: "OUTBOUND" } }),
    database.phoneCall.count({ where: { workspaceId, direction: "OUTBOUND", answeredAt: { not: null } } }),
    database.phoneCall.count({ where: { workspaceId, direction: "OUTBOUND", answeredAt: null, status: { in: ["BUSY", "NO_ANSWER", "VOICEMAIL"] } } }),
    database.phoneCall.count({ where: { workspaceId, direction: "OUTBOUND", status: "FAILED" } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "SENT", message: { direction: "OUTBOUND", conversation: { channel: { in: ["INSTAGRAM", "INSTAGRAM_MESSAGING"] } } } } }),
    database.message.findMany({ where: { workspaceId, direction: "INBOUND", conversation: { leadId: { not: null } } }, select: { id: true, conversation: { select: { leadId: true } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "QUEUED", message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: { in: ["PROVIDER_ACCEPTED", "SENT"] }, message: { conversation: { channel: "EMAIL" } } } }),
    database.messageStatusEvent.count({ where: { workspaceId, status: "DELIVERED", message: { conversation: { channel: "EMAIL" } } } }),
    database.message.count({ where: { workspaceId, direction: "INBOUND", conversation: { channel: "EMAIL", leadId: { not: null } } } }),
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
  return Object.freeze([
    check("Contact", "CONTACT_CREATED", contacts), check("LeadFormSubmission", "LEAD_SUBMISSION_ATTACHED", submissions),
    check("Lead", "LEAD_CREATED", leads),
    check("StageHistory", "STAGE_ENTERED", stageEntries), check("StageHistory", "STAGE_EXITED", stageExits),
    check("Task", "TASK_CREATED", tasks), check("Task", "TASK_COMPLETED", completedTasks), check("Task", "TASK_CANCELLED", cancelledTasks),
    check("Task", "CALL_ATTEMPTED", taskCallAttempts), check("Task", "CALL_CONNECTED", taskCallsConnected), check("Task", "CALL_UNANSWERED", taskCallsUnanswered), check("Task", "CALL_FAILED", taskCallsFailed),
    check("Task", "INSTAGRAM_MESSAGE_SENT", taskInstagramMessages), check("Task", "INSTAGRAM_FOLLOW_COMPLETED", instagramFollows),
    check("MeetingHistory", "MEETING_SCHEDULED", meetings), check("MeetingHistory", "MEETING_CONFIRMED", confirmedMeetings), check("MeetingHistory", "MEETING_RESCHEDULED", rescheduledMeetings), check("MeetingHistory", "MEETING_COMPLETED", completedMeetings), check("MeetingHistory", "MEETING_CANCELLED", cancelledMeetings), check("MeetingHistory", "MEETING_NO_SHOW", noShowMeetings),
    check("Opportunity", "OPPORTUNITY_CREATED", opportunities), check("OpportunityOutcomeSnapshot", "OPPORTUNITY_WON", wonOpportunities), check("OpportunityOutcomeSnapshot", "SALE_WON", wonOpportunities), check("OpportunityOutcomeSnapshot", "OPPORTUNITY_LOST", lostOpportunities),
    check("PactoRevision", "PACTO_VALIDATED", validatedPacto),
    check("PhoneCall", "CALL_ATTEMPTED", outboundCalls), check("PhoneCall", "CALL_CONNECTED", connectedCalls), check("PhoneCall", "CALL_UNANSWERED", unansweredCalls), check("PhoneCall", "CALL_FAILED", failedCalls),
    check("MessageStatusEvent", "INSTAGRAM_MESSAGE_SENT", instagramMessages), check("Message", "INBOUND_MESSAGE_RECEIVED", inboundMessages), check("Message", "HUMAN_RESPONSE_CONFIRMED", firstHumanResponses),
    check("MessageStatusEvent", "EMAIL_SCHEDULED", emailScheduled), check("MessageStatusEvent", "EMAIL_SENT", emailSent), check("MessageStatusEvent", "EMAIL_DELIVERED", emailDelivered), check("Message", "EMAIL_REPLIED", emailReplied), check("MessageStatusEvent", "EMAIL_BOUNCED", emailBounced), check("MessageStatusEvent", "EMAIL_COMPLAINT", emailComplaints), check("MessageStatusEvent", "EMAIL_UNSUBSCRIBED", emailUnsubscribed), check("MessageStatusEvent", "EMAIL_CANCELLED", emailCancelled), check("MessageStatusEvent", "EMAIL_FAILED", emailFailed),
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
        where: { workspaceId: context.workspaceId, quantity: { gt: 0 } },
        _count: { _all: true },
      });
      const actualByKey = new Map(actualGroups.map((group) => [`${group.sourceEntityType}:${group.eventType}`, group._count._all]));
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
        await tx.commercialMetricReconciliationCheck.deleteMany({ where: { workspaceId: context.workspaceId, runId: run.id } });
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
