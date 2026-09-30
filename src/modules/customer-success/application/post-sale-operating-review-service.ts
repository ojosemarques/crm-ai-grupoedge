import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { capacityState, postSaleRisks, progress } from "@/modules/customer-success/domain/post-sale-operating-review";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;

function resource(workspaceId: string, accountId: string, ownerMemberId: string | null, teamId: string | null, queueId: string | null) {
  return { workspaceId, resourceType: "CustomerSuccess", resourceId: accountId, ownerMemberId, teamId, queueId };
}

export function createPostSaleOperatingReviewService(options: Options) {
  async function accountReview(context: AuthenticatedContext, accountId: string) {
    const assignment = await options.database.customerPortfolioAssignment.findFirst({
      where: { workspaceId: context.workspaceId, accountId, validTo: null },
      orderBy: { validFrom: "desc" },
    });
    if (!assignment) throw new ApplicationError("Conta sem carteira ativa de Customer Success.", { code: "PORTFOLIO_REQUIRED", statusCode: 409, expose: true });
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.CUSTOMER_SUCCESS_READ,
      resource(context.workspaceId, accountId, assignment.ownerMemberId, assignment.teamId, assignment.queueId),
    );

    const now = options.now();
    const [account, plans, onboardingCases, requests, health, subscriptions, renewal, expansionSignals, revenueDecisions, surveyResponses] = await Promise.all([
      options.database.account.findFirst({ where: { workspaceId: context.workspaceId, id: accountId, deletedAt: null }, select: { id: true, name: true, status: true } }),
      options.database.successPlan.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { createdAt: "desc" } }),
      options.database.onboardingCase.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { createdAt: "desc" } }),
      options.database.customerRequest.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { createdAt: "desc" } }),
      options.database.customerHealthAssessment.findFirst({ where: { workspaceId: context.workspaceId, accountId }, orderBy: [{ cutoffAt: "desc" }, { createdAt: "desc" }] }),
      options.database.subscription.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { startsAt: "desc" } }),
      options.database.renewal.findFirst({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { targetDate: "desc" } }),
      options.database.expansionSignal.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { capturedAt: "desc" } }),
      options.database.farmerRevenueDecision.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: { effectiveAt: "desc" } }),
      options.database.customerSurveyResponse.findMany({ where: { workspaceId: context.workspaceId, accountId }, orderBy: [{ answeredAt: "desc" }, { id: "desc" }], take: 20 }),
    ]);
    if (!account) throw new ApplicationError("Conta não encontrada.", { code: "NOT_FOUND", statusCode: 404, expose: true });

    const [planMilestones, onboardingMilestones, ownerPortfolioCount, ownerOpenPlanCount, ownerOpenRequestCount, surveyVersions] = await Promise.all([
      options.database.successPlanMilestone.findMany({ where: { workspaceId: context.workspaceId, planId: { in: plans.map((item) => item.id) } }, orderBy: [{ planId: "asc" }, { position: "asc" }] }),
      options.database.onboardingMilestone.findMany({ where: { workspaceId: context.workspaceId, onboardingCaseId: { in: onboardingCases.map((item) => item.id) } }, orderBy: [{ onboardingCaseId: "asc" }, { position: "asc" }] }),
      assignment.ownerMemberId ? options.database.customerPortfolioAssignment.count({ where: { workspaceId: context.workspaceId, ownerMemberId: assignment.ownerMemberId, validTo: null, state: "ACTIVE" } }) : Promise.resolve(0),
      assignment.ownerMemberId ? options.database.successPlan.count({ where: { workspaceId: context.workspaceId, ownerMemberId: assignment.ownerMemberId, status: { in: ["DRAFT", "ACTIVE", "BLOCKED"] } } }) : Promise.resolve(0),
      assignment.ownerMemberId ? options.database.customerRequest.count({ where: { workspaceId: context.workspaceId, ownerMemberId: assignment.ownerMemberId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"] } } }) : Promise.resolve(0),
      options.database.customerSurveyVersion.findMany({ where: { workspaceId: context.workspaceId, id: { in: surveyResponses.map((item) => item.surveyVersionId) } }, select: { id: true, definitionId: true, minValue: true, maxValue: true } }),
    ]);
    const surveyDefinitions = await options.database.customerSurveyDefinition.findMany({ where: { workspaceId: context.workspaceId, id: { in: surveyVersions.map((item) => item.definitionId) } }, select: { id: true, type: true } });
    const versionMap = new Map(surveyVersions.map((item) => [item.id, item]));
    const typeMap = new Map(surveyDefinitions.map((item) => [item.id, item.type]));
    const satisfactionHistory = surveyResponses.flatMap((response) => {
      const version = versionMap.get(response.surveyVersionId); const type = version ? typeMap.get(version.definitionId) : null;
      if (!version || !type || version.maxValue <= version.minValue) return [];
      return [{ type, value: response.value, normalized: Math.round((response.value - version.minValue) * 100 / (version.maxValue - version.minValue)), answeredAt: response.answeredAt }];
    });
    const satisfaction = (["NPS", "CSAT"] as const).flatMap((type) => {
      const values = satisfactionHistory.filter((item) => item.type === type).slice(0, 2);
      if (!values[0]) return [];
      const deltaPoints = values[1] ? values[0].normalized - values[1].normalized : null;
      return [{ type, latestValue: values[0].value, latestNormalized: values[0].normalized, latestAt: values[0].answeredAt, previousValue: values[1]?.value ?? null, previousNormalized: values[1]?.normalized ?? null, previousAt: values[1]?.answeredAt ?? null, deltaPoints, declining: deltaPoints !== null && deltaPoints < 0 }];
    });

    const adoptionMilestones = planMilestones.filter((item) => /adot|ativa|uso/i.test(`${item.key} ${item.name}`));
    const adoptionBase = adoptionMilestones.length > 0 ? adoptionMilestones : planMilestones;
    const completedAdoption = adoptionBase.filter((item) => item.status === "COMPLETED").length;
    const overdueAdoption = adoptionBase.filter((item) => item.status === "PENDING" && item.dueAt < now).length;
    const completedDeliverables = onboardingMilestones.filter((item) => item.status === "COMPLETED").length;
    const overdueDeliverables = onboardingMilestones.filter((item) => item.status === "PENDING" && item.dueAt < now).length;
    const openRequests = requests.filter((item) => ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"].includes(item.status));
    const overdueRequests = openRequests.filter((item) => item.resolutionDueAt < now).length;
    const urgentRequests = openRequests.filter((item) => item.priority === "URGENT").length;
    const evidencedResults = planMilestones.filter((item) => item.status === "COMPLETED" && Boolean(item.evidence));
    const loadUnits = ownerPortfolioCount + ownerOpenPlanCount + ownerOpenRequestCount;
    const risks = postSaleRisks({
      healthStatus: health?.status ?? null,
      blockedPlans: plans.filter((item) => item.status === "BLOCKED").length,
      overdueDeliverables,
      overdueRequests,
      urgentRequests,
      renewalRiskLevel: renewal?.riskLevel ?? null,
    });

    return {
      generatedAt: now.toISOString(),
      account,
      assignment,
      adoption: progress(adoptionBase.length, completedAdoption, overdueAdoption),
      deliverables: progress(onboardingMilestones.length, completedDeliverables, overdueDeliverables),
      capacity: {
        ownerMemberId: assignment.ownerMemberId,
        loadUnits,
        state: capacityState(loadUnits),
        formula: "carteiras ativas + planos abertos + solicitações abertas do responsável; disponível <= 15, atenção <= 25, lotado > 25",
        components: { activePortfolio: ownerPortfolioCount, openPlans: ownerOpenPlanCount, openRequests: ownerOpenRequestCount },
      },
      requests: { total: requests.length, open: openRequests.length, overdue: overdueRequests, urgent: urgentRequests },
      health: health ? { status: health.status, score: health.score, cutoffAt: health.cutoffAt, explanation: health.explanation } : null,
      result: {
        evidencedMilestones: evidencedResults.length,
        activeMrrCents: subscriptions.filter((item) => item.status === "ACTIVE").reduce((sum, item) => sum + item.currentMrrCents, 0n).toString(),
        revenueDecisions: revenueDecisions.map((item) => ({ type: item.type, status: item.status, reasonCode: item.reasonCode, effectiveAt: item.effectiveAt, deltaMrrCents: item.deltaMrrCents.toString() })),
      },
      risks,
      renewal: renewal ? { id: renewal.id, status: renewal.status, targetDate: renewal.targetDate, riskLevel: renewal.riskLevel, nextActionAt: renewal.nextActionAt } : null,
      expansion: { pending: expansionSignals.filter((item) => item.status === "PENDING_REVIEW").length, linked: expansionSignals.filter((item) => item.status === "LINKED").length },
      satisfaction,
      deliveryPlans: { successPlans: plans, onboardingCases },
      sourceCounts: { subscriptions: subscriptions.length, requests: requests.length, healthAssessments: health ? 1 : 0, surveyResponses: surveyResponses.length },
    };
  }

  return Object.freeze({ accountReview });
}

let service: ReturnType<typeof createPostSaleOperatingReviewService> | undefined;
export function getPostSaleOperatingReviewService() {
  service ??= createPostSaleOperatingReviewService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
