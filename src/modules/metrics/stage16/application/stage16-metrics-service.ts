import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createForecastService } from "@/modules/forecast/application/forecast-service";
import { buildCadenceMetrics, buildCostAndSampleQuality, buildFinancialMetrics, stage16MetricsQuerySchema, type CadenceFact } from "@/modules/metrics/stage16/domain/stage16-metrics";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;

function invalid(message: string, code = "STAGE16_METRICS_INVALID", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

export function createStage16MetricsService(options: Options) {
  async function visibleMemberIds(context: AuthenticatedContext) {
    const target = { workspaceId: context.workspaceId, resourceType: "Stage16Metrics", ownerMemberId: context.memberId };
    const decision = await options.authorization.authorize(context, PermissionKeys.METRICS_READ, target);
    if (!decision.allowed) {
      await options.authorization.assertAuthorized(context, PermissionKeys.METRICS_READ, target);
      return [];
    }
    if (decision.scope === "WORKSPACE") return undefined;
    if (decision.scope === "OWN") return [context.memberId];
    const teamIds = (await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } })).map((row) => row.teamId);
    if (!teamIds.length) return [context.memberId];
    return [...new Set((await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, teamId: { in: teamIds }, deletedAt: null }, select: { workspaceMemberId: true } })).map((row) => row.workspaceMemberId))];
  }

  async function build(context: AuthenticatedContext, raw: unknown) {
    const parsed = stage16MetricsQuerySchema.safeParse(raw);
    if (!parsed.success) invalid(parsed.error.issues.map((issue) => issue.message).join(" "));
    const asOf = parsed.data.asOf ?? (parsed.data.to < options.now() ? parsed.data.to : options.now());
    if (asOf > options.now()) invalid("O corte não pode estar no futuro.");
    if (asOf < parsed.data.from) invalid("O corte não pode anteceder o início do período.");
    const memberIds = await visibleMemberIds(context);
    const ownerWhere = memberIds ? { ownerMemberId: { in: memberIds } } : {};
    const opportunities = await options.database.opportunity.findMany({
      where: { workspaceId: context.workspaceId, ...ownerWhere, createdAt: { lt: asOf }, deletedAt: null },
      include: {
        currentStage: { select: { id: true, name: true, opportunityStageCode: true } },
        product: { select: { sku: true } },
        account: { select: { segment: true, size: true } },
        consultativeEvidence: { where: { supersededAt: null }, select: { type: true } },
        offers: { where: { deletedAt: null }, orderBy: [{ acceptedAt: "desc" }, { createdAt: "desc" }], take: 1, select: { name: true, productId: true } },
        accountPlan: { include: { stakeholders: { where: { status: "ACTIVE" }, select: { isDecisionMaker: true } }, waits: { where: { status: "PLANNED" }, select: { id: true } }, episodes: { where: { status: { in: ["ACTIVE", "COMPLETED"] } }, select: { type: true, status: true } }, tracks: { where: { status: { in: ["ACTIVE", "COMPLETED"] } }, select: { id: true } } } },
      },
      orderBy: { id: "asc" },
    });
    const cadenceFacts: CadenceFact[] = opportunities.map((row) => {
      const evidence = new Set(row.consultativeEvidence.map((item) => item.type));
      return {
        opportunityId: row.id,
        status: row.status,
        amountCents: row.amountCents,
        offerCohort: row.offers[0]?.name ?? row.product?.sku ?? "SEM_OFERTA",
        icpCohort: row.account ? `${row.account.segment}:${row.account.size}` : "SEM_CONTA",
        decisionMaker: evidence.has("ECONOMIC_BUYER") || Boolean(row.accountPlan?.stakeholders.some((item) => item.isDecisionMaker)),
        sponsor: evidence.has("SPONSOR"),
        diagnosis: evidence.has("DIAGNOSIS"),
        pilot: evidence.has("PILOT_CRITERIA") || Boolean(row.accountPlan?.episodes.some((item) => item.type === "PILOT" && item.status === "COMPLETED")),
        plannedWait: Boolean(row.accountPlan?.waits.length),
        commitment: Boolean(row.accountPlan && (row.accountPlan.episodes.length > 0 || row.accountPlan.tracks.length > 0)),
        stage: Boolean(row.currentStage.id),
      };
    });

    const contracts = await options.database.commercialContract.findMany({ where: { workspaceId: context.workspaceId, ...(memberIds ? { ownerMemberId: { in: memberIds } } : {}), status: "ACCEPTED", acceptedAt: { gte: parsed.data.from, lt: asOf }, currentVersionId: { not: null } }, select: { id: true, currentVersionId: true } });
    const completedOnboarding = await options.database.onboardingCase.findMany({ where: { workspaceId: context.workspaceId, ...(memberIds ? { ownerMemberId: { in: memberIds } } : {}), status: "COMPLETED", completedAt: { gte: parsed.data.from, lt: asOf } }, select: { contractId: true } });
    const deliveryContracts = completedOnboarding.length ? await options.database.commercialContract.findMany({ where: { workspaceId: context.workspaceId, id: { in: completedOnboarding.map((row) => row.contractId) }, currentVersionId: { not: null } }, select: { id: true, currentVersionId: true } }) : [];
    const allContracts = new Map([...contracts, ...deliveryContracts].map((row) => [row.id, row]));
    const versionIds = [...new Set([...allContracts.values()].flatMap((row) => row.currentVersionId ? [row.currentVersionId] : []))];
    const [versions, lines, invoices, marketingRows, outboundRows, aiRows, forecast] = await Promise.all([
      options.database.contractVersion.findMany({ where: { workspaceId: context.workspaceId, id: { in: versionIds } }, select: { id: true, contractId: true, totalCents: true, mrrCents: true } }),
      options.database.contractLineSnapshot.findMany({ where: { workspaceId: context.workspaceId, contractVersionId: { in: versionIds }, revenueCategorySnapshot: { in: ["IMPLEMENTATION", "PROJECT", "RECURRING_SERVICE"] } }, select: { contractVersionId: true, totalCents: true } }),
      options.database.invoice.findMany({ where: { workspaceId: context.workspaceId, ...(memberIds ? { ownerMemberId: { in: memberIds } } : {}), createdAt: { lt: asOf } }, select: { id: true } }),
      options.database.marketingPerformanceFact.findMany({ where: { workspaceId: context.workspaceId, periodStart: { gte: parsed.data.from, lt: asOf } }, orderBy: [{ grainKey: "asc" }, { revision: "desc" }], select: { grainKey: true, status: true, currency: true, spendCents: true, missingMetrics: true } }),
      options.database.outboundCampaignRecipient.findMany({ where: { workspaceId: context.workspaceId, createdAt: { gte: parsed.data.from, lt: asOf }, ...(memberIds ? { leadId: { in: opportunities.map((row) => row.leadId) } } : {}) }, select: { costCents: true } }),
      options.database.aIExecutionTrace.findMany({ where: { workspaceId: context.workspaceId, createdAt: { gte: parsed.data.from, lt: asOf } }, select: { estimatedCostCents: true } }),
      createForecastService(options).screen(context, { asOf: asOf.toISOString() }),
    ]);
    const payments = invoices.length ? await options.database.payment.findMany({ where: { workspaceId: context.workspaceId, invoiceId: { in: invoices.map((row) => row.id) }, OR: [{ occurredAt: { gte: parsed.data.from, lt: asOf } }, { reversedAt: { gte: parsed.data.from, lt: asOf } }] }, select: { amountCents: true, occurredAt: true, reversedAt: true } }) : [];
    const deliveredContractIds = new Set(completedOnboarding.map((row) => row.contractId));
    const versionById = new Map(versions.map((row) => [row.id, row]));
    const deliveredByVersion = new Map<string, bigint>();
    for (const line of lines) deliveredByVersion.set(line.contractVersionId, (deliveredByVersion.get(line.contractVersionId) ?? 0n) + line.totalCents);
    const receivedCents = payments.reduce((sum, payment) => sum + (payment.occurredAt >= parsed.data.from ? payment.amountCents : 0n) - (payment.reversedAt && payment.reversedAt >= parsed.data.from && payment.reversedAt < asOf ? payment.amountCents : 0n), 0n);
    const financialFacts = contracts.map((contract, index) => {
      const version = contract.currentVersionId ? versionById.get(contract.currentVersionId) : null;
      return { contractedCents: version?.totalCents ?? 0n, contractedMrrCents: version?.mrrCents ?? 0n, deliveredServiceCents: deliveredContractIds.has(contract.id) && contract.currentVersionId ? deliveredByVersion.get(contract.currentVersionId) ?? 0n : 0n, receivedCents: index === 0 ? receivedCents : 0n };
    });
    for (const contract of deliveryContracts) {
      if (contracts.some((accepted) => accepted.id === contract.id)) continue;
      financialFacts.push({ contractedCents: 0n, contractedMrrCents: 0n, deliveredServiceCents: contract.currentVersionId ? deliveredByVersion.get(contract.currentVersionId) ?? 0n : 0n, receivedCents: 0n });
    }
    if (!contracts.length && receivedCents !== 0n) financialFacts.push({ contractedCents: 0n, contractedMrrCents: 0n, deliveredServiceCents: 0n, receivedCents });
    const latestMarketing = new Map<string, (typeof marketingRows)[number]>();
    for (const row of marketingRows) if (!latestMarketing.has(row.grainKey)) latestMarketing.set(row.grainKey, row);
    const marketing = [...latestMarketing.values()].filter((row) => row.status === "CONFIRMED" && row.currency === "BRL");
    const cost = { mediaCostCents: marketing.reduce((sum, row) => sum + row.spendCents, 0n), outboundCostCents: outboundRows.reduce((sum, row) => sum + BigInt(row.costCents), 0n), aiCostCents: aiRows.reduce((sum, row) => sum + BigInt(row.estimatedCostCents ?? 0), 0n), mediaSamples: marketing.length, outboundSamples: outboundRows.length, aiSamples: aiRows.length, mediaMissingCostSamples: marketing.filter((row) => row.missingMetrics.includes("spendCents")).length, outboundMissingCostSamples: 0, aiMissingCostSamples: aiRows.filter((row) => row.estimatedCostCents === null).length };
    return {
      generatedAt: options.now().toISOString(),
      period: { from: parsed.data.from.toISOString(), to: parsed.data.to.toISOString(), asOf: asOf.toISOString() },
      cadence: buildCadenceMetrics(cadenceFacts),
      financial: buildFinancialMetrics(financialFacts),
      ...buildCostAndSampleQuality(cost, cadenceFacts),
      goalsAndForecast: forecast.current,
      definitions: { icpCohort: "Segmento e porte persistidos da conta; SEM_CONTA quando ausente.", deliveredService: "Linhas de implementação, projeto ou serviço de contrato aceito cujo onboarding foi concluído no período.", received: "Pagamentos confirmados no período líquidos de reversões no mesmo corte.", sampleQuality: "Cobertura explícita; ausência de denominador permanece null." },
    };
  }

  return Object.freeze({ build });
}

let singleton: ReturnType<typeof createStage16MetricsService> | undefined;
export function getStage16MetricsService() {
  singleton ??= createStage16MetricsService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
