import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createDashboardMetricsService } from "@/modules/metrics/application/dashboard-metrics-service";
import { createMetricsService } from "@/modules/metrics/application/metrics-service";
import type { DashboardPeriodInterval } from "@/modules/metrics/domain/dashboard-contracts";
import { revenueMetricRegistry, REVENUE_METRICS_REGISTRY_VERSION, getRevenueMetricDefinition } from "@/modules/metrics/domain/revenue-metric-registry";
import { buildRevenueBridge, cohortRetention, compareValues, divideBasisPoints, metricState, type LedgerMovement } from "@/modules/metrics/domain/revenue-metric-math";
import type { RevenueCohortRow, RevenueDrilldownPage, RevenueDrilldownRecord, RevenueMetricComparison, RevenueMetricsScreen, RevenueMetricValue, RevenueQualitySignal, RevenueTimeSeries } from "@/modules/metrics/domain/revenue-metrics-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { addLocalDays, workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";
import { z } from "zod";

type AuthorizationPort = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;
type PeriodFacts = Readonly<{ values: Map<string, RevenueMetricValue>; records: Map<string, RevenueDrilldownRecord[]> }>;

const requestSchema = z.object({
  asOf: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
  metric: z.string().min(1).max(100).optional(),
}).passthrough();

const zeroUuid = "00000000-0000-0000-0000-000000000000";
const sum = (rows: readonly bigint[]) => rows.reduce((total, value) => total + value, 0n);
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const currency = "BRL" as const;

function invalid(message: string): never {
  throw new ApplicationError(message, { code: "INVALID_INPUT", statusCode: 400, expose: true });
}

function metric(metricId: string, value: bigint | number | null, options: Readonly<{ numerator?: bigint | number | null; denominator?: bigint | number | null; state?: RevenueMetricValue["state"] | undefined; coverage?: number | null | undefined; reason?: string | undefined; drilldown?: string | null | undefined }> = {}): RevenueMetricValue {
  const definition = getRevenueMetricDefinition(metricId);
  if (!definition) throw new Error(`Métrica não registrada: ${metricId}`);
  const serialize = (item: bigint | number | null) => typeof item === "bigint" ? item.toString() : item;
  const denominator = options.denominator ?? null;
  return Object.freeze({
    metricId,
    definitionVersion: definition.version,
    state: options.state ?? metricState(value, denominator),
    value: serialize(value),
    numerator: serialize(options.numerator ?? value),
    denominator: serialize(denominator),
    currency: definition.unit === "CENTS" ? currency : null,
    coverageBasisPoints: options.coverage ?? 10_000,
    reason: options.reason ?? (value === null ? "Dado indisponível para este recorte." : denominator === 0 || denominator === 0n ? "Não existe denominador elegível." : "Calculado a partir dos fatos persistidos."),
    drilldownId: options.drilldown === undefined ? metricId : options.drilldown,
  });
}

function unavailable(metricId: string, reason: string, state: RevenueMetricValue["state"] = "UNAVAILABLE"): RevenueMetricValue {
  return metric(metricId, null, { state, coverage: null, reason, drilldown: null });
}

function interval(from: string, to: string, timeZone: string): DashboardPeriodInterval {
  return Object.freeze({ fromDate: workspaceDateAt(new Date(from), timeZone), toDate: workspaceDateAt(new Date(new Date(to).getTime() - 1), timeZone), from, to, timeZone });
}

function record(input: Omit<RevenueDrilldownRecord, "unit"> & { unit?: RevenueDrilldownRecord["unit"] }): RevenueDrilldownRecord {
  return Object.freeze({ unit: input.unit ?? "CENTS", ...input });
}

function asBigInt(value: RevenueMetricValue["value"]): bigint | null {
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  return null;
}

function comparison(current: RevenueMetricValue, previous: RevenueMetricValue, currentPeriod: DashboardPeriodInterval, previousPeriod: DashboardPeriodInterval): RevenueMetricComparison {
  const definition = getRevenueMetricDefinition(current.metricId)!;
  const result = compareValues(asBigInt(current.value), asBigInt(previous.value), definition.desiredDirection);
  return Object.freeze({ metricId: current.metricId, current, previous, absoluteDifference: result.absolute?.toString() ?? null, percentageDifferenceBasisPoints: result.percentageBasisPoints, direction: result.direction, interpretation: result.interpretation, currentPeriod, previousPeriod });
}

function civilBuckets(period: DashboardPeriodInterval) {
  const totalDays = Math.max(1, Math.round((Date.parse(`${period.toDate}T00:00:00.000Z`) - Date.parse(`${period.fromDate}T00:00:00.000Z`)) / 86_400_000) + 1);
  const step = totalDays <= 45 ? 1 : totalDays <= 180 ? 7 : 31;
  const granularity = step === 1 ? "DAY" as const : step === 7 ? "WEEK" as const : "MONTH" as const;
  const rows: Array<{ key: string; from: Date; to: Date }> = [];
  let date = period.fromDate;
  while (date <= period.toDate) {
    const start = workspaceDayRange(date, period.timeZone).start;
    let nextDate: string;
    if (step === 31) {
      const [year, month] = date.split("-").map(Number) as [number, number, number];
      const next = new Date(Date.UTC(year, month, 1));
      nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
    } else nextDate = addLocalDays(date, step);
    const rawEnd = workspaceDayRange(nextDate, period.timeZone).start;
    const end = rawEnd > new Date(period.to) ? new Date(period.to) : rawEnd;
    rows.push({ key: date.slice(0, step === 31 ? 7 : 10), from: start, to: end });
    date = nextDate;
  }
  return { granularity, rows };
}

export function createRevenueMetricsService(options: Options) {
  const dashboard = createDashboardMetricsService(options);
  const baseMetrics = createMetricsService(options);

  async function authorize(context: AuthenticatedContext): Promise<"WORKSPACE" | "TEAM" | "OWN"> {
    const resource = { workspaceId: context.workspaceId, resourceType: "RevenueMetrics", memberId: context.memberId };
    const decision = await options.authorization.authorize(context, PermissionKeys.METRICS_READ as PermissionKey, resource);
    if (!decision.allowed) {
      await options.authorization.assertAuthorized(context, PermissionKeys.METRICS_READ, resource);
      throw new Error("Estado de autorização inalcançável.");
    }
    return decision.scope;
  }

  async function build(context: AuthenticatedContext, raw: unknown) {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) invalid(parsed.error.issues.map((issue) => issue.message).join(" "));
    const [scope, dashboardScreen] = await Promise.all([authorize(context), dashboard.getScreen(context, raw)]);
    const asOf = parsed.data.asOf ? new Date(parsed.data.asOf) : options.now();
    if (asOf > options.now()) invalid("O corte asOf não pode estar no futuro.");
    const currentPeriod = interval(dashboardScreen.query.from, dashboardScreen.query.to, dashboardScreen.overview.period.timeZone);
    const previousPeriod = dashboardScreen.comparisonPeriod;
    const previousOverview = await baseMetrics.getOverview(context, { from: previousPeriod.from, to: previousPeriod.to, filters: dashboardScreen.query.filters });
    const visibleLeadIds = unique([...dashboardScreen.overview.evidence.universeLeadIds, ...previousOverview.evidence.universeLeadIds]);
    const opportunityRows = await options.database.opportunity.findMany({
      where: { workspaceId: context.workspaceId, leadId: { in: visibleLeadIds.length > 0 ? visibleLeadIds : [zeroUuid] }, deletedAt: null },
      select: { id: true, leadId: true, accountId: true, ownerMemberId: true, productId: true, name: true },
    });
    const allowedOpportunityIds = opportunityRows.map((item) => item.id);
    const allowedAccountIds = unique(opportunityRows.flatMap((item) => item.accountId ? [item.accountId] : []));
    const contractRows = await options.database.commercialContract.findMany({
      where: { workspaceId: context.workspaceId, opportunityId: { in: allowedOpportunityIds.length ? allowedOpportunityIds : [zeroUuid] }, status: "ACCEPTED", acceptedAt: { not: null, lt: new Date(currentPeriod.to) }, currentVersionId: { not: null } },
      select: { id: true, contractNumber: true, opportunityId: true, accountId: true, acceptedAt: true, currentVersionId: true },
    });
    const versionRows = await options.database.contractVersion.findMany({ where: { workspaceId: context.workspaceId, id: { in: contractRows.flatMap((item) => item.currentVersionId ? [item.currentVersionId] : []) } }, select: { id: true, contractId: true, totalCents: true, tcvCents: true, mrrCents: true, accountNameSnapshot: true } });
    const versionById = new Map(versionRows.map((item) => [item.id, item]));
    const subscriptions = await options.database.subscription.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: allowedAccountIds.length ? allowedAccountIds : [zeroUuid] } }, select: { id: true, accountId: true, subscriptionNumber: true, accountNameSnapshot: true, startsAt: true, ownerMemberId: true } });
    const subscriptionById = new Map(subscriptions.map((item) => [item.id, item]));
    const movements = await options.database.revenueMovement.findMany({ where: { workspaceId: context.workspaceId, subscriptionId: { in: subscriptions.length ? subscriptions.map((item) => item.id) : [zeroUuid] }, effectiveAt: { lt: new Date(currentPeriod.to) }, currency: "BRL" }, orderBy: [{ effectiveAt: "asc" }, { sequence: "asc" }], select: { id: true, subscriptionId: true, accountId: true, type: true, deltaMrrCents: true, effectiveAt: true, reason: true, source: true } });
    const ledger: LedgerMovement[] = movements.map((item) => ({ subscriptionId: item.subscriptionId, accountId: item.accountId, type: item.type, deltaMrrCents: item.deltaMrrCents, effectiveAt: item.effectiveAt }));
    const [renewals, churnEvents, invoices] = await Promise.all([
      options.database.renewal.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: allowedAccountIds.length ? allowedAccountIds : [zeroUuid] }, decidedAt: { not: null, gte: new Date(previousPeriod.from), lt: new Date(currentPeriod.to) } }, select: { id: true, accountId: true, status: true, decidedAt: true, baseMrrCents: true } }),
      options.database.churnEvent.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: allowedAccountIds.length ? allowedAccountIds : [zeroUuid] }, effectiveAt: { gte: new Date(previousPeriod.from), lt: new Date(currentPeriod.to) }, logoChurn: true }, select: { id: true, accountId: true, subscriptionId: true, effectiveAt: true, reasonCode: true } }),
      options.database.invoice.findMany({ where: { workspaceId: context.workspaceId, accountId: { in: allowedAccountIds.length ? allowedAccountIds : [zeroUuid] }, createdAt: { lte: asOf } }, select: { id: true, invoiceNumber: true, accountId: true, accountNameSnapshot: true, totalCents: true, dueAt: true, status: true, createdAt: true } }),
    ]);
    const invoiceIds = invoices.map((item) => item.id);
    const paymentRows = invoiceIds.length === 0 ? [] : await options.database.payment.findMany({ where: { workspaceId: context.workspaceId, invoiceId: { in: invoiceIds }, OR: [{ occurredAt: { gte: new Date(previousPeriod.from), lt: new Date(currentPeriod.to) } }, { reversedAt: { gte: new Date(previousPeriod.from), lt: new Date(currentPeriod.to) } }] }, select: { id: true, invoiceId: true, amountCents: true, status: true, occurredAt: true, reversedAt: true } });
    const marketingCampaignIds = dashboardScreen.query.filters.campaignIds.length === 0 ? [] : (await options.database.marketingCampaign.findMany({ where: { workspaceId: context.workspaceId, legacyAcquisitionCampaignId: { in: [...dashboardScreen.query.filters.campaignIds] } }, select: { id: true } })).map((item) => item.id);
    const marketingCreativeIds = dashboardScreen.query.filters.creativeIds.length === 0 ? [] : (await options.database.marketingCreative.findMany({ where: { workspaceId: context.workspaceId, legacyAcquisitionCreativeId: { in: [...dashboardScreen.query.filters.creativeIds] } }, select: { id: true } })).map((item) => item.id);
    const marketingFacts = scope !== "WORKSPACE" ? [] : await options.database.marketingPerformanceFact.findMany({ where: { workspaceId: context.workspaceId, periodStart: { gte: new Date(previousPeriod.from), lt: new Date(currentPeriod.to) }, ...(dashboardScreen.query.filters.campaignIds.length ? { campaignId: { in: marketingCampaignIds.length ? marketingCampaignIds : [zeroUuid] } } : {}), ...(dashboardScreen.query.filters.creativeIds.length ? { creativeId: { in: marketingCreativeIds.length ? marketingCreativeIds : [zeroUuid] } } : {}) }, orderBy: [{ grainKey: "asc" }, { revision: "desc" }], select: { id: true, grainKey: true, revision: true, status: true, periodStart: true, periodEnd: true, spendCents: true, currency: true, missingMetrics: true, sourceProvider: true } });
    const marketingByGrain = new Map<string, (typeof marketingFacts)[number]>();
    for (const item of marketingFacts) if (!marketingByGrain.has(item.grainKey)) marketingByGrain.set(item.grainKey, item);
    const latestMarketing = [...marketingByGrain.values()].filter((item) => item.status === "CONFIRMED" && item.currency === "BRL");
    const attributionRuns = scope !== "WORKSPACE" ? [] : await options.database.attributionRun.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["COMPLETED", "PARTIAL"] }, finishedAt: { not: null, lte: asOf }, periodStart: { lt: new Date(currentPeriod.to) }, periodEnd: { gt: new Date(previousPeriod.from) } }, orderBy: [{ finishedAt: "desc" }, { id: "desc" }], select: { id: true, status: true, periodStart: true, periodEnd: true, conversionCount: true, attributedCount: true, coverageBps: true, finishedAt: true } });
    const attributionCredits = attributionRuns.length === 0 ? [] : await options.database.attributionCredit.findMany({ where: { workspaceId: context.workspaceId, attributionRunId: { in: attributionRuns.map((item) => item.id) } }, select: { id: true, attributionRunId: true, conversionId: true, touchpointId: true, coverageState: true, creditBps: true, reasonCode: true } });
    const attributionConversions = attributionCredits.length === 0 ? [] : await options.database.attributionConversion.findMany({ where: { workspaceId: context.workspaceId, id: { in: unique(attributionCredits.map((item) => item.conversionId)) }, status: "ACTIVE" }, select: { id: true, kind: true, leadId: true, opportunityId: true, occurredAt: true, valueCents: true } });
    const attributionTouchpoints = attributionCredits.length === 0 ? [] : await options.database.marketingTouchpoint.findMany({ where: { workspaceId: context.workspaceId, id: { in: unique(attributionCredits.flatMap((item) => item.touchpointId ? [item.touchpointId] : [])) } }, select: { id: true, leadId: true, sourceId: true, campaignId: true, creativeId: true, occurredAt: true } });
    const conversionById = new Map(attributionConversions.map((item) => [item.id, item]));
    const touchpointById = new Map(attributionTouchpoints.map((item) => [item.id, item]));

    const forecastScreen = await import("@/modules/forecast/application/forecast-service").then(({ createForecastService }) => createForecastService(options).screen(context, { asOf: asOf.toISOString() }));
    const forecast = forecastScreen.snapshots.find((item) => new Date(item.asOf) <= asOf) ?? null;

    const buildPeriod = (period: DashboardPeriodInterval, overview: typeof dashboardScreen.overview): PeriodFacts => {
      const from = new Date(period.from);
      const to = new Date(period.to);
      const cut = asOf < to ? asOf : to;
      const bridge = buildRevenueBridge(ledger, from, to, cut);
      const retention = cohortRetention(ledger, from, to, cut);
      const contracts = contractRows.filter((item) => item.acceptedAt && item.acceptedAt >= from && item.acceptedAt < cut);
      const contractVersions = contracts.flatMap((item) => item.currentVersionId ? [versionById.get(item.currentVersionId)].filter((value): value is NonNullable<typeof value> => Boolean(value)) : []);
      const won = overview.evidence.periodWins.length;
      const lost = overview.evidence.periodLosses.length;
      const decided = won + lost;
      const renewalRows = renewals.filter((item) => item.decidedAt && item.decidedAt >= from && item.decidedAt < cut && ["RENEWED", "NOT_RENEWED", "CANCELLED"].includes(item.status));
      const renewed = renewalRows.filter((item) => item.status === "RENEWED").length;
      const initialAccountBalances = new Map<string, bigint>();
      for (const movement of ledger) if (movement.effectiveAt < from) initialAccountBalances.set(movement.accountId, (initialAccountBalances.get(movement.accountId) ?? 0n) + movement.deltaMrrCents);
      const initialAccounts = new Set([...initialAccountBalances].filter(([, balance]) => balance > 0n).map(([id]) => id));
      const logoChurnRows = churnEvents.filter((item) => initialAccounts.has(item.accountId) && item.effectiveAt >= from && item.effectiveAt < cut);
      const periodPayments = paymentRows.filter((item) => item.occurredAt < cut && (item.occurredAt >= from || Boolean(item.reversedAt && item.reversedAt >= from && item.reversedAt < cut)));
      const received = periodPayments.reduce((total, item) => total + (item.occurredAt >= from ? item.amountCents : 0n) - (item.reversedAt && item.reversedAt >= from && item.reversedAt < cut ? item.amountCents : 0n), 0n);
      const overdue = invoices.filter((item) => item.createdAt < cut && item.dueAt < cut && !["VOIDED", "CANCELLED"].includes(item.status));
      const overdueTotal = sum(overdue.map((item) => item.totalCents));
      const paidThroughCut = paymentRows.filter((item) => item.occurredAt < cut).reduce((byInvoice, item) => byInvoice.set(item.invoiceId, (byInvoice.get(item.invoiceId) ?? 0n) + item.amountCents - (item.reversedAt && item.reversedAt < cut ? item.amountCents : 0n)), new Map<string, bigint>());
      const overdueBalance = overdue.reduce((total, item) => total + (item.totalCents > (paidThroughCut.get(item.id) ?? 0n) ? item.totalCents - (paidThroughCut.get(item.id) ?? 0n) : 0n), 0n);
      const periodMarketing = latestMarketing.filter((item) => item.periodStart >= from && item.periodStart < cut);
      const spend = sum(periodMarketing.map((item) => item.spendCents));
      const mediaPartial = periodMarketing.some((item) => item.missingMetrics.includes("spendCents"));
      const attributionRun = attributionRuns.find((item) => item.periodStart <= from && item.periodEnd >= to)
        ?? attributionRuns.find((item) => item.periodStart < to && item.periodEnd > from)
        ?? null;
      const attributionRunPartial = attributionRun ? attributionRun.status === "PARTIAL" || attributionRun.periodStart > from || attributionRun.periodEnd < to : false;
      const runCredits = attributionRun ? attributionCredits.filter((item) => item.attributionRunId === attributionRun.id) : [];
      const matchingCreditRows = runCredits.flatMap((credit) => {
        const conversion = conversionById.get(credit.conversionId);
        if (!conversion || conversion.kind !== "WON" || conversion.occurredAt < from || conversion.occurredAt >= cut || !conversion.valueCents) return [];
        if (conversion.leadId && !visibleLeadIds.includes(conversion.leadId)) return [];
        if (conversion.opportunityId && !allowedOpportunityIds.includes(conversion.opportunityId)) return [];
        const touchpoint = credit.touchpointId ? touchpointById.get(credit.touchpointId) : null;
        if (!touchpoint) return [];
        if (dashboardScreen.query.filters.sourceIds.length && (!touchpoint.sourceId || !dashboardScreen.query.filters.sourceIds.includes(touchpoint.sourceId))) return [];
        if (dashboardScreen.query.filters.campaignIds.length && (!touchpoint.campaignId || !dashboardScreen.query.filters.campaignIds.includes(touchpoint.campaignId))) return [];
        if (dashboardScreen.query.filters.creativeIds.length && (!touchpoint.creativeId || !dashboardScreen.query.filters.creativeIds.includes(touchpoint.creativeId))) return [];
        return [{ credit, conversion, touchpoint }];
      });
      const attributedRevenue = matchingCreditRows.reduce((total, item) => total + item.conversion.valueCents! * BigInt(item.credit.creditBps) / 10_000n, 0n);
      const attributedAccountIds = new Set(matchingCreditRows.flatMap((item) => item.conversion.opportunityId ? opportunityRows.find((opportunity) => opportunity.id === item.conversion.opportunityId)?.accountId ?? [] : []));
      const values = new Map<string, RevenueMetricValue>();
      const records = new Map<string, RevenueDrilldownRecord[]>();
      const put = (value: RevenueMetricValue, rows: readonly RevenueDrilldownRecord[] = []) => { values.set(value.metricId, value); records.set(value.metricId, [...rows]); };
      const contractRecords = contracts.map((item) => { const version = item.currentVersionId ? versionById.get(item.currentVersionId) : null; return record({ key: `contract:${item.id}`, entityType: "CONTRACT", entityId: item.id, title: item.contractNumber, subtitle: version?.accountNameSnapshot ?? "Contrato aceito", occurredAt: item.acceptedAt!.toISOString(), contribution: version?.totalCents.toString() ?? null, href: `/contratos?contractId=${item.id}`, provenance: "CommercialContract + ContractVersion" }); });
      const allMovementRecords = movements.filter((item) => item.effectiveAt < cut).map((item) => record({ key: `movement:${item.id}`, entityType: "REVENUE_MOVEMENT", entityId: item.id, title: `${item.type} · ${subscriptionById.get(item.subscriptionId)?.subscriptionNumber ?? item.subscriptionId}`, subtitle: item.reason, occurredAt: item.effectiveAt.toISOString(), contribution: item.deltaMrrCents.toString(), href: `/receita?subscriptionId=${item.subscriptionId}`, provenance: `RevenueMovement/${item.source}` }));
      const movementRecords = allMovementRecords.filter((item) => new Date(item.occurredAt) >= from);
      const leadRecords = overview.evidence.leadReceipts.map((item) => record({ key: `lead:${item.leadId}`, entityType: "LEAD", entityId: item.leadId, title: "Lead recebido", subtitle: item.submissionId, occurredAt: item.occurredAt, contribution: 1, unit: "COUNT", href: `/leads/${item.leadId}`, provenance: "LeadFormSubmission" }));
      put(metric("sales.leads", overview.leadsReceived.value), leadRecords);
      put(metric("sales.win_rate", divideBasisPoints(BigInt(won), BigInt(decided)), { numerator: won, denominator: decided }), [...overview.evidence.periodWins.map((item) => record({ key: `outcome:${item.snapshotId}`, entityType: "OPPORTUNITY", entityId: item.opportunityId, title: "Oportunidade ganha", subtitle: item.leadId, occurredAt: item.occurredAt, contribution: 1, unit: "COUNT", href: `/oportunidades?opportunityId=${item.opportunityId}`, provenance: "OpportunityOutcomeSnapshot" })), ...overview.evidence.periodLosses.map((item) => record({ key: `outcome:${item.snapshotId}`, entityType: "OPPORTUNITY", entityId: item.opportunityId, title: "Oportunidade perdida", subtitle: item.leadId, occurredAt: item.occurredAt, contribution: 1, unit: "COUNT", href: `/oportunidades?opportunityId=${item.opportunityId}`, provenance: "OpportunityOutcomeSnapshot" }))]);
      put(metric("sales.bookings", sum(contractVersions.map((item) => item.totalCents))), contractRecords);
      put(metric("sales.tcv", sum(contractVersions.map((item) => item.tcvCents))), contractRecords.map((item) => ({ ...item, contribution: versionById.get(contractRows.find((row) => row.id === item.entityId)?.currentVersionId ?? "")?.tcvCents.toString() ?? null })));
      put(metric("sales.contracted_mrr", sum(contractVersions.map((item) => item.mrrCents))), contractRecords.map((item) => ({ ...item, contribution: versionById.get(contractRows.find((row) => row.id === item.entityId)?.currentVersionId ?? "")?.mrrCents.toString() ?? null })));
      put(metric("revenue.opening_mrr", BigInt(bridge.openingMrrCents)), allMovementRecords.filter((item) => new Date(item.occurredAt) < from));
      put(metric("revenue.closing_mrr", BigInt(bridge.closingMrrCents)), allMovementRecords);
      put(metric("revenue.arr", BigInt(bridge.closingMrrCents) * 12n), allMovementRecords);
      put(metric("revenue.new_mrr", BigInt(bridge.newMrrCents)), movementRecords.filter((item) => item.title.startsWith("NEW")));
      put(metric("revenue.expansion_mrr", BigInt(bridge.expansionMrrCents)), movementRecords.filter((item) => item.title.startsWith("EXPANSION")));
      put(metric("revenue.reactivation_mrr", BigInt(bridge.reactivationMrrCents)), movementRecords.filter((item) => item.title.startsWith("REACTIVATION")));
      put(metric("revenue.contraction_mrr", BigInt(bridge.contractionMrrCents)), movementRecords.filter((item) => item.title.startsWith("CONTRACTION")));
      put(metric("revenue.churned_mrr", BigInt(bridge.churnMrrCents)), movementRecords.filter((item) => item.title.startsWith("CHURN")));
      put(metric("revenue.net_new_mrr", BigInt(bridge.netNewMrrCents)), movementRecords);
      put(metric("retention.grr", retention.grrBasisPoints, { numerator: retention.grrBasisPoints === null ? 0 : BigInt(retention.grrBasisPoints) * retention.initialMrrCents / 10_000n, denominator: retention.initialMrrCents }), movementRecords);
      put(metric("retention.nrr", retention.nrrBasisPoints, { numerator: retention.finalMrrCents, denominator: retention.initialMrrCents }), movementRecords);
      put(metric("retention.logo_churn", divideBasisPoints(BigInt(logoChurnRows.length), BigInt(initialAccounts.size)), { numerator: logoChurnRows.length, denominator: initialAccounts.size }), logoChurnRows.map((item) => record({ key: `churn:${item.id}`, entityType: "CHURN_EVENT", entityId: item.id, title: "Churn confirmado", subtitle: item.reasonCode, occurredAt: item.effectiveAt.toISOString(), contribution: 1, unit: "COUNT", href: `/farmer?accountId=${item.accountId}`, provenance: "ChurnEvent" })));
      put(metric("retention.renewal_rate", divideBasisPoints(BigInt(renewed), BigInt(renewalRows.length)), { numerator: renewed, denominator: renewalRows.length }), renewalRows.map((item) => record({ key: `renewal:${item.id}`, entityType: "RENEWAL", entityId: item.id, title: `Renovação ${item.status}`, subtitle: item.accountId, occurredAt: item.decidedAt!.toISOString(), contribution: 1, unit: "COUNT", href: `/farmer?renewalId=${item.id}`, provenance: "Renewal" })));
      put(metric("cash.received", received), periodPayments.flatMap((item) => [
        ...(item.occurredAt >= from ? [record({ key: `payment:${item.id}:confirmed`, entityType: "PAYMENT", entityId: item.id, title: "Pagamento confirmado", subtitle: item.invoiceId, occurredAt: item.occurredAt.toISOString(), contribution: item.amountCents.toString(), href: `/pagamentos?invoiceId=${item.invoiceId}`, provenance: "Payment.occurredAt" })] : []),
        ...(item.reversedAt && item.reversedAt >= from && item.reversedAt < cut ? [record({ key: `payment:${item.id}:reversed`, entityType: "PAYMENT", entityId: item.id, title: `Pagamento ${item.status}`, subtitle: item.invoiceId, occurredAt: item.reversedAt.toISOString(), contribution: (-item.amountCents).toString(), href: `/pagamentos?invoiceId=${item.invoiceId}`, provenance: "Payment.reversedAt" })] : []),
      ]));
      put(metric("cash.delinquency", divideBasisPoints(overdueBalance, overdueTotal), { numerator: overdueBalance, denominator: overdueTotal, state: overdueTotal === 0n ? "NO_DENOMINATOR" : period.to < options.now().toISOString() ? "PARTIAL" : undefined, reason: overdueTotal === 0n ? "Não há faturas vencidas elegíveis." : period.to < options.now().toISOString() ? "Corte histórico usa pagamentos append-only, mas o cadastro atual da fatura pode ter sido atualizado depois do corte." : "Saldo vencido reconstruído por pagamentos até asOf." }), overdue.map((item) => record({ key: `invoice:${item.id}`, entityType: "INVOICE", entityId: item.id, title: item.invoiceNumber, subtitle: item.accountNameSnapshot, occurredAt: item.dueAt.toISOString(), contribution: (item.totalCents - (paidThroughCut.get(item.id) ?? 0n)).toString(), href: `/pagamentos?invoiceId=${item.id}`, provenance: "Invoice + Payment" })));
      const incompatibleMediaFilter = dashboardScreen.query.filters.sdrMemberIds.length > 0 || dashboardScreen.query.filters.closerMemberIds.length > 0 || dashboardScreen.query.filters.teamIds.length > 0 || dashboardScreen.query.filters.priorityCodes.length > 0 || dashboardScreen.query.filters.productIds.length > 0;
      if (scope !== "WORKSPACE") {
        put(unavailable("acquisition.spend", "Custo de mídia agregado é suprimido fora do escopo WORKSPACE para evitar inferência de dados de outra equipe.", "SUPPRESSED"));
        put(unavailable("acquisition.cpl", "CPL exige custo de mídia WORKSPACE e denominador compatível.", "SUPPRESSED"));
        for (const id of ["acquisition.cac", "acquisition.attributed_revenue", "acquisition.roas", "acquisition.attribution_coverage"]) put(unavailable(id, "Atribuição agregada é suprimida fora do escopo WORKSPACE.", "SUPPRESSED"));
      } else if (incompatibleMediaFilter) {
        put(unavailable("acquisition.spend", "O recorte combina dimensões comerciais sem correspondência segura no fato de mídia.", "NOT_APPLICABLE"));
        put(unavailable("acquisition.cpl", "CPL não é calculado com numerador e denominador de universos incompatíveis.", "NOT_APPLICABLE"));
        for (const id of ["acquisition.cac", "acquisition.attributed_revenue", "acquisition.roas", "acquisition.attribution_coverage"]) put(unavailable(id, "A dimensão comercial não possui correspondência segura no custo agregado de mídia.", "NOT_APPLICABLE"));
      } else {
        const mediaRows = periodMarketing.map((item) => record({ key: `media:${item.id}`, entityType: "MARKETING_FACT", entityId: item.id, title: `Fato de mídia ${item.grainKey}`, subtitle: `${item.sourceProvider} · revisão ${item.revision}`, occurredAt: item.periodStart.toISOString(), contribution: item.spendCents.toString(), href: "/aquisicao", provenance: "MarketingPerformanceFact" }));
        const attributionRows = matchingCreditRows.map((item) => record({ key: `attribution:${item.credit.id}`, entityType: "ATTRIBUTION_CREDIT", entityId: item.credit.id, title: `Crédito ${item.credit.creditBps / 100}%`, subtitle: item.credit.reasonCode, occurredAt: item.conversion.occurredAt.toISOString(), contribution: (item.conversion.valueCents! * BigInt(item.credit.creditBps) / 10_000n).toString(), href: "/aquisicao", provenance: "AttributionRun + AttributionCredit + AttributionConversion" }));
        put(metric("acquisition.spend", spend, { state: mediaPartial ? "PARTIAL" : undefined, coverage: mediaPartial ? null : 10_000, reason: mediaPartial ? "Existem fatos vigentes com custo ausente." : "Somente a maior revisão CONFIRMED por grainKey." }), mediaRows);
        put(metric("acquisition.cpl", overview.leadsReceived.value === 0 ? null : spend / BigInt(overview.leadsReceived.value), { numerator: spend, denominator: overview.leadsReceived.value, state: overview.leadsReceived.value === 0 ? "NO_DENOMINATOR" : mediaPartial ? "PARTIAL" : undefined }), [...mediaRows, ...leadRecords]);
        if (!attributionRun) {
          for (const id of ["acquisition.cac", "acquisition.attributed_revenue", "acquisition.roas", "acquisition.attribution_coverage"]) put(unavailable(id, "Nenhuma execução de atribuição compatível e concluída no corte."));
        } else {
          const attributionState = attributionRunPartial ? "PARTIAL" as const : undefined;
          put(metric("acquisition.cac", attributedAccountIds.size === 0 ? null : spend / BigInt(attributedAccountIds.size), { numerator: spend, denominator: attributedAccountIds.size, state: attributedAccountIds.size === 0 ? "NO_DENOMINATOR" : attributionState, coverage: attributionRun.coverageBps }), [...mediaRows, ...attributionRows]);
          put(metric("acquisition.attributed_revenue", attributedRevenue, { state: attributionState, coverage: attributionRun.coverageBps, reason: "Crédito persistido; representa atribuição, não causalidade." }), attributionRows);
          put(metric("acquisition.roas", divideBasisPoints(attributedRevenue, spend), { numerator: attributedRevenue, denominator: spend, state: spend === 0n ? "NO_DENOMINATOR" : attributionState, coverage: attributionRun.coverageBps }), [...mediaRows, ...attributionRows]);
          put(metric("acquisition.attribution_coverage", attributionRun.coverageBps, { numerator: attributionRun.attributedCount, denominator: attributionRun.conversionCount, state: attributionRunPartial ? "PARTIAL" : attributionRun.conversionCount === 0 ? "NO_DENOMINATOR" : undefined, coverage: attributionRun.coverageBps }), attributionRows);
        }
      }
      return { values, records };
    };

    const current = buildPeriod(currentPeriod, dashboardScreen.overview);
    const previous = buildPeriod(previousPeriod, previousOverview);
    const currentBridge = buildRevenueBridge(ledger, new Date(currentPeriod.from), new Date(currentPeriod.to), asOf);
    const forecastCycle = forecast ? forecastScreen.cycles[0] ?? null : null;
    const addForecast = (target: Map<string, RevenueMetricValue>, period: DashboardPeriodInterval) => {
      const valid = forecast && forecast.asOf >= period.from && forecast.asOf <= period.to;
      if (!forecast || !valid) {
        for (const id of ["forecast.pipeline", "forecast.best_case", "forecast.commit", "forecast.weighted", "forecast.gap", "goals.attainment", "forecast.pipeline_coverage", "forecast.accuracy"]) target.set(id, unavailable(id, "Nenhum snapshot de forecast compatível com o período e o corte."));
        return;
      }
      target.set("forecast.pipeline", metric("forecast.pipeline", BigInt(forecast.pipelineCents), { coverage: forecast.coverageBps, state: forecast.coverageState === "PARTIAL" ? "PARTIAL" : undefined }));
      target.set("forecast.best_case", metric("forecast.best_case", BigInt(forecast.bestCaseCents), { coverage: forecast.coverageBps, state: forecast.coverageState === "PARTIAL" ? "PARTIAL" : undefined }));
      target.set("forecast.commit", metric("forecast.commit", BigInt(forecast.commitCents), { coverage: forecast.coverageBps, state: forecast.coverageState === "PARTIAL" ? "PARTIAL" : undefined }));
      target.set("forecast.weighted", forecast.weightedPipelineCents === null ? unavailable("forecast.weighted", "Snapshot sem cobertura manual completa de probabilidade.") : metric("forecast.weighted", BigInt(forecast.weightedPipelineCents), { coverage: forecast.coverageBps }));
      target.set("forecast.gap", forecast.goalTargetCents === null ? unavailable("forecast.gap", "O ciclo não possui meta publicada vinculada.") : metric("forecast.gap", BigInt(forecast.goalTargetCents) - BigInt(forecast.commitCents), { coverage: forecast.coverageBps }));
      target.set("goals.attainment", forecast.goalTargetCents === null ? unavailable("goals.attainment", "O snapshot não possui meta publicada vinculada.") : metric("goals.attainment", divideBasisPoints(BigInt(forecast.realizedCents), BigInt(forecast.goalTargetCents)), { numerator: BigInt(forecast.realizedCents), denominator: BigInt(forecast.goalTargetCents), coverage: forecast.coverageBps }));
      const remaining = forecast.goalTargetCents === null ? null : BigInt(forecast.goalTargetCents) > BigInt(forecast.realizedCents) ? BigInt(forecast.goalTargetCents) - BigInt(forecast.realizedCents) : 0n;
      target.set("forecast.pipeline_coverage", remaining === null ? unavailable("forecast.pipeline_coverage", "O snapshot não possui meta publicada vinculada.") : metric("forecast.pipeline_coverage", divideBasisPoints(BigInt(forecast.pipelineCents), remaining), { numerator: BigInt(forecast.pipelineCents), denominator: remaining, coverage: forecast.coverageBps }));
      if (forecastCycle?.status !== "CLOSED") target.set("forecast.accuracy", unavailable("forecast.accuracy", "Acurácia só é calculada após o fechamento do ciclo."));
      else {
        const realized = BigInt(forecast.realizedCents);
        const commit = BigInt(forecast.commitCents);
        const error = commit > realized ? commit - realized : realized - commit;
        const accuracy = realized === 0n ? (commit === 0n ? 10_000 : 0) : Number(((realized > error ? realized - error : 0n) * 10_000n) / realized);
        target.set("forecast.accuracy", metric("forecast.accuracy", accuracy, { numerator: accuracy, denominator: 10_000, coverage: forecast.coverageBps }));
      }
    };
    addForecast(current.values, currentPeriod);
    addForecast(previous.values, previousPeriod);

    const orderedMetrics = revenueMetricRegistry.map((definition) => current.values.get(definition.id) ?? unavailable(definition.id, "A fonte oficial ainda não possui fatos elegíveis para este recorte.", "NOT_APPLICABLE"));
    const comparisons = orderedMetrics.map((value) => comparison(value, previous.values.get(value.metricId) ?? unavailable(value.metricId, "Sem período anterior comparável."), currentPeriod, previousPeriod));
    const buckets = civilBuckets(currentPeriod);
    const series: RevenueTimeSeries[] = ["revenue.closing_mrr", "revenue.net_new_mrr", "sales.bookings", "cash.received", "sales.leads"].map((metricId) => ({
      metricId,
      granularity: buckets.granularity,
      points: Object.freeze(buckets.rows.map((bucket) => {
        if (metricId === "revenue.closing_mrr") return Object.freeze({ bucket: bucket.key, from: bucket.from.toISOString(), to: bucket.to.toISOString(), value: buildRevenueBridge(ledger, new Date(currentPeriod.from), bucket.to, bucket.to).closingMrrCents, state: "AVAILABLE" as const });
        if (metricId === "revenue.net_new_mrr") { const value = buildRevenueBridge(ledger, bucket.from, bucket.to, bucket.to).netNewMrrCents; return Object.freeze({ bucket: bucket.key, from: bucket.from.toISOString(), to: bucket.to.toISOString(), value, state: BigInt(value) === 0n ? "ZERO" as const : "AVAILABLE" as const }); }
        if (metricId === "sales.bookings") { const value = contractRows.filter((item) => item.acceptedAt && item.acceptedAt >= bucket.from && item.acceptedAt < bucket.to).reduce((total, item) => total + (item.currentVersionId ? versionById.get(item.currentVersionId)?.totalCents ?? 0n : 0n), 0n); return Object.freeze({ bucket: bucket.key, from: bucket.from.toISOString(), to: bucket.to.toISOString(), value: value.toString(), state: value === 0n ? "ZERO" as const : "AVAILABLE" as const }); }
        if (metricId === "cash.received") { const value = paymentRows.reduce((total, item) => total + (item.occurredAt >= bucket.from && item.occurredAt < bucket.to ? item.amountCents : 0n) - (item.reversedAt && item.reversedAt >= bucket.from && item.reversedAt < bucket.to ? item.amountCents : 0n), 0n); return Object.freeze({ bucket: bucket.key, from: bucket.from.toISOString(), to: bucket.to.toISOString(), value: value.toString(), state: value === 0n ? "ZERO" as const : "AVAILABLE" as const }); }
        const value = dashboardScreen.overview.evidence.leadReceipts.filter((item) => new Date(item.occurredAt) >= bucket.from && new Date(item.occurredAt) < bucket.to).length;
        return Object.freeze({ bucket: bucket.key, from: bucket.from.toISOString(), to: bucket.to.toISOString(), value, state: value === 0 ? "ZERO" as const : "AVAILABLE" as const });
      })),
    }));

    const cohortMap = new Map<string, typeof subscriptions>();
    for (const subscription of subscriptions) {
      const key = workspaceDateAt(subscription.startsAt, currentPeriod.timeZone).slice(0, 7);
      cohortMap.set(key, [...(cohortMap.get(key) ?? []), subscription]);
    }
    const cohorts: RevenueCohortRow[] = [...cohortMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([cohort, rows]) => {
      const ids = new Set(rows.map((item) => item.id));
      const initial = movements.filter((item) => ids.has(item.subscriptionId) && item.type === "NEW" && item.deltaMrrCents > 0n).reduce((total, item) => total + item.deltaMrrCents, 0n);
      const currentMrr = movements.filter((item) => ids.has(item.subscriptionId) && item.effectiveAt <= asOf).reduce((total, item) => total + item.deltaMrrCents, 0n);
      const censored = cohort === workspaceDateAt(asOf, currentPeriod.timeZone).slice(0, 7);
      return Object.freeze({ cohort, subscriptionCount: rows.length, initialMrrCents: initial.toString(), currentMrrCents: currentMrr.toString(), retentionBasisPoints: divideBasisPoints(currentMrr > 0n ? currentMrr : 0n, initial), state: initial === 0n ? "NO_DENOMINATOR" as const : censored ? "PARTIAL" as const : "AVAILABLE" as const, censored, drilldownId: `cohort:${cohort}` });
    });
    const quality: RevenueQualitySignal[] = [
      Object.freeze({ id: "bridge", label: "Reconciliação da ponte de MRR", state: currentBridge.reconciled ? "AVAILABLE" : "UNAVAILABLE", coverageBasisPoints: currentBridge.reconciled ? 10_000 : 0, detail: currentBridge.reconciled ? "MRR inicial + movimentos = MRR final." : "A ponte não fecha; investigar o ledger.", action: currentBridge.reconciled ? null : "Reconciliar movimentos de receita", drilldownId: "revenue.net_new_mrr" }),
      Object.freeze({ id: "attribution", label: "Cobertura de aquisição", state: scope !== "WORKSPACE" ? "SUPPRESSED" : latestMarketing.length === 0 ? "UNAVAILABLE" : latestMarketing.some((item) => item.missingMetrics.length > 0) ? "PARTIAL" : "AVAILABLE", coverageBasisPoints: scope !== "WORKSPACE" || latestMarketing.length === 0 ? null : latestMarketing.some((item) => item.missingMetrics.length > 0) ? null : 10_000, detail: scope !== "WORKSPACE" ? "Dados agregados suprimidos pelo escopo." : `${latestMarketing.length} fatos de mídia vigentes.`, action: latestMarketing.length === 0 ? "Importar ou reconciliar fatos de mídia" : null, drilldownId: scope === "WORKSPACE" ? "acquisition.spend" : null }),
      Object.freeze({ id: "forecast", label: "Cobertura manual do forecast", state: !forecast ? "UNAVAILABLE" : forecast.coverageState === "COMPLETE" ? "AVAILABLE" : "PARTIAL", coverageBasisPoints: forecast?.coverageBps ?? null, detail: forecast ? `${forecast.coverageBps / 100}% do universo do snapshot possui classificação.` : "Nenhum snapshot no corte.", action: !forecast || forecast.coverageState !== "COMPLETE" ? "Revisar submissões do forecast" : null, drilldownId: forecast ? "forecast.commit" : null }),
      Object.freeze({ id: "delinquency-history", label: "Histórico de inadimplência", state: current.values.get("cash.delinquency")?.state ?? "UNAVAILABLE", coverageBasisPoints: current.values.get("cash.delinquency")?.coverageBasisPoints ?? null, detail: current.values.get("cash.delinquency")?.reason ?? "Sem cálculo.", action: null, drilldownId: "cash.delinquency" }),
    ];
    const records = new Map<string, RevenueDrilldownRecord[]>();
    for (const [key, rows] of current.records) records.set(key, rows);
    if (forecast?.id) {
      const items = await options.database.forecastSnapshotItem.findMany({ where: { workspaceId: context.workspaceId, snapshotId: forecast.id }, orderBy: [{ amountCents: "desc" }, { opportunityId: "asc" }] });
      const rows = items.map((item) => record({ key: `forecast:${item.id}`, entityType: "FORECAST_ITEM", entityId: item.id, title: item.opportunityName, subtitle: `${item.category ?? "fora"} · ${item.reasonCode}`, occurredAt: forecast.asOf, contribution: item.amountCents.toString(), href: `/forecast?cycleId=${item.cycleId}&snapshotId=${forecast.id}`, provenance: "ForecastSnapshotItem" }));
      for (const id of ["forecast.pipeline", "forecast.best_case", "forecast.commit", "forecast.weighted", "forecast.gap", "goals.attainment", "forecast.pipeline_coverage", "forecast.accuracy"]) records.set(id, rows);
    }
    for (const [cohort, rows] of cohortMap) records.set(`cohort:${cohort}`, rows.map((item) => record({ key: `subscription:${item.id}`, entityType: "SUBSCRIPTION", entityId: item.id, title: item.subscriptionNumber, subtitle: item.accountNameSnapshot, occurredAt: item.startsAt.toISOString(), contribution: movements.filter((movement) => movement.subscriptionId === item.id && movement.effectiveAt <= asOf).reduce((total, movement) => total + movement.deltaMrrCents, 0n).toString(), href: `/receita?subscriptionId=${item.id}`, provenance: "Subscription + RevenueMovement" })));

    const screen: RevenueMetricsScreen = Object.freeze({ registryVersion: REVENUE_METRICS_REGISTRY_VERSION, generatedAt: options.now().toISOString(), scope, query: Object.freeze({ preset: dashboardScreen.query.preset, period: currentPeriod, comparisonPeriod: previousPeriod, asOf: asOf.toISOString(), filters: dashboardScreen.query.filters }), metrics: Object.freeze(orderedMetrics), comparisons: Object.freeze(comparisons), bridge: currentBridge, series: Object.freeze(series), cohorts: Object.freeze(cohorts), quality: Object.freeze(quality), forecastSnapshot: forecast ? Object.freeze({ id: forecast.id, asOf: forecast.asOf, coverageState: forecast.coverageState, coverageBasisPoints: forecast.coverageBps }) : null, hasData: orderedMetrics.some((item) => item.state === "AVAILABLE" && item.value !== "0" && item.value !== 0) });
    return { screen, records, page: parsed.data.page, pageSize: parsed.data.pageSize, metricId: parsed.data.metric };
  }

  async function getScreen(context: AuthenticatedContext, raw: unknown = {}): Promise<RevenueMetricsScreen> { return (await build(context, raw)).screen; }
  async function getCatalog(context: AuthenticatedContext) { await authorize(context); return Object.freeze({ registryVersion: REVENUE_METRICS_REGISTRY_VERSION, metrics: revenueMetricRegistry }); }
  async function getDrilldown(context: AuthenticatedContext, raw: unknown): Promise<RevenueDrilldownPage> {
    const built = await build(context, raw);
    if (!built.metricId) invalid("Informe a métrica do drilldown.");
    const definition = getRevenueMetricDefinition(built.metricId);
    if (!definition && !built.metricId.startsWith("cohort:")) invalid("Métrica de drilldown desconhecida.");
    const all = built.records.get(built.metricId) ?? [];
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / built.pageSize));
    const page = Math.min(built.page, totalPages);
    return Object.freeze({ metric: definition ?? Object.freeze({ ...revenueMetricRegistry.find((item) => item.id === "retention.nrr")!, id: built.metricId, name: `Coorte ${built.metricId.slice(7)}` }), query: built.screen.query, records: Object.freeze(all.slice((page - 1) * built.pageSize, page * built.pageSize)), page, pageSize: built.pageSize, total, totalPages });
  }
  return Object.freeze({ getCatalog, getScreen, getDrilldown });
}

let singleton: ReturnType<typeof createRevenueMetricsService> | undefined;
export function getRevenueMetricsService() {
  singleton ??= createRevenueMetricsService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
