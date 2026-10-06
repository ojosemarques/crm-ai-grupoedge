import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAnalyticsDashboardSchema, updateAnalyticsDashboardSchema, analyticsCatalog, validateWidgetCompatibility, recordsCsv } from "@/modules/analytics-builder/domain/analytics-builder-contracts";
import { createMetricsService, getMetricsService } from "@/modules/metrics/application/metrics-service";
import { getRevenueMetricsService } from "@/modules/metrics/application/revenue-metrics-service";
import { integratedMetricRegistry } from "@/modules/metrics/domain/integrated-metric-registry";
import { getAuthorizationService, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type AuthorizationPort = ReturnType<typeof getAuthorizationService>;
type RevenuePort = ReturnType<typeof getRevenueMetricsService>;
type MetricsPort = ReturnType<typeof getMetricsService>;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; revenue: RevenuePort; metrics?: MetricsPort; now: () => Date }>;
const uuid = z.string().uuid();
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
function resource(context: AuthenticatedContext, resourceId?: string): ResourceScope { return { workspaceId: context.workspaceId, resourceType: "AnalyticsDashboard", memberId: context.memberId, ...(resourceId ? { resourceId } : {}) }; }

function widgetQuery(widget: { periodPreset: string; fromDate: string | null; toDate: string | null; asOf: Date | null; filters: unknown }) {
  const filters = widget.filters && typeof widget.filters === "object" && !Array.isArray(widget.filters) ? widget.filters as Record<string, unknown> : {};
  return { preset: widget.periodPreset, ...(widget.fromDate ? { fromDate: widget.fromDate } : {}), ...(widget.toDate ? { toDate: widget.toDate } : {}), ...(widget.asOf ? { asOf: widget.asOf.toISOString() } : {}), ...filters };
}

export function createAnalyticsBuilderService(options: Options) {
  const metrics = options.metrics ?? createMetricsService({ database: options.database, authorization: options.authorization, now: options.now });
  async function authorize(context: AuthenticatedContext, id?: string) { await options.authorization.assertAuthorized(context, PermissionKeys.METRICS_READ, resource(context, id)); }
  async function authorizeManage(context: AuthenticatedContext, id?: string) { await options.authorization.assertAuthorized(context, PermissionKeys.OPERATIONS_MANAGE, resource(context, id)); }

  async function opportunityRecords(context: AuthenticatedContext, widget: { dateField: string; dimension: string | null; periodPreset: string; fromDate: string | null; toDate: string | null; asOf: Date | null; filters: unknown }, resolvedBase?: Awaited<ReturnType<RevenuePort["getScreen"]>>) {
    const base = resolvedBase ?? await options.revenue.getScreen(context, widgetQuery(widget));
    const from = new Date(base.query.period.from); const to = new Date(base.query.period.to); const asOf = new Date(base.query.asOf);
    const decision = await options.authorization.authorize(context, PermissionKeys.METRICS_READ, resource(context));
    if (!decision.allowed) { await options.authorization.assertAuthorized(context, PermissionKeys.METRICS_READ, resource(context)); throw new Error("Estado de autorização inalcançável."); }
    let owners: string[] | undefined;
    if (decision.scope === "OWN") owners = [context.memberId];
    if (decision.scope === "TEAM") {
      const ownTeams = await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } });
      owners = ownTeams.length ? [...new Set((await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, teamId: { in: ownTeams.map((row) => row.teamId) }, deletedAt: null }, select: { workspaceMemberId: true } })).map((row) => row.workspaceMemberId))] : [context.memberId];
    }
    const filters = widget.filters && typeof widget.filters === "object" && !Array.isArray(widget.filters) ? widget.filters as Record<string, unknown> : {};
    const closer = Array.isArray(filters.closer) ? filters.closer.filter((value): value is string => typeof value === "string") : [];
    const products = Array.isArray(filters.product) ? filters.product.filter((value): value is string => typeof value === "string") : [];
    const requestedTeams = Array.isArray(filters.team) ? filters.team.filter((value): value is string => typeof value === "string") : [];
    if (requestedTeams.length) { const members = [...new Set((await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, teamId: { in: requestedTeams }, deletedAt: null }, select: { workspaceMemberId: true } })).map((row) => row.workspaceMemberId))]; owners = owners ? owners.filter((id) => members.includes(id)) : members; }
    if (closer.length) owners = owners ? owners.filter((id) => closer.includes(id)) : closer;
    const occurredAt = new Map<string, Date>();
    if (widget.dateField === "WON_AT") {
      const wins = await options.database.opportunityOutcomeSnapshot.findMany({ where: { workspaceId: context.workspaceId, status: "WON", occurredAt: { gte: from, lt: to, lte: asOf }, ...(owners ? { ownerMemberId: { in: owners } } : {}), ...(products.length ? { productId: { in: products } } : {}) }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { opportunityId: true, occurredAt: true } });
      for (const win of wins) if (!occurredAt.has(win.opportunityId)) occurredAt.set(win.opportunityId, win.occurredAt);
    }
    const rows = await options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, ...(owners ? { ownerMemberId: { in: owners } } : {}), ...(products.length ? { productId: { in: products } } : {}), ...(widget.dateField === "WON_AT" ? { id: { in: [...occurredAt.keys()] } } : { createdAt: { gte: from, lt: to, lte: asOf } }) }, include: { currentStage: { select: { name: true } }, product: { select: { name: true } }, account: { select: { segment: true, size: true } }, owner: { include: { user: { select: { displayName: true } }, teamMemberships: { where: { deletedAt: null }, include: { team: { select: { name: true } } }, orderBy: { teamId: "asc" } } } }, offers: { where: { deletedAt: null }, orderBy: [{ acceptedAt: "desc" }, { createdAt: "desc" }], take: 1, select: { name: true } } }, orderBy: [{ id: "asc" }] });
    const dimensionValue = (row: (typeof rows)[number]) => widget.dimension === "oferta" ? row.offers[0]?.name ?? row.product?.name ?? "Sem oferta" : widget.dimension === "ICP" ? row.account ? `${row.account.segment}:${row.account.size}` : "Sem conta" : widget.dimension === "estágio" ? row.currentStage.name : widget.dimension === "owner" ? row.owner.user.displayName : widget.dimension === "equipe" ? row.owner.teamMemberships[0]?.team.name ?? "Sem equipe" : widget.dimension === "produto" ? row.product?.name ?? "Sem produto" : "Total";
    const records = rows.map((row) => ({ key: `opportunity:${row.id}`, entityType: "OPPORTUNITY", entityId: row.id, title: row.name, subtitle: dimensionValue(row), dimensionValue: dimensionValue(row), occurredAt: (widget.dateField === "WON_AT" ? occurredAt.get(row.id)! : row.createdAt).toISOString(), contribution: row.amountCents.toString(), unit: "CENTS", href: `/oportunidades?opportunityId=${row.id}`, provenance: widget.dateField === "WON_AT" ? "OpportunityOutcomeSnapshot/WON" : "Opportunity.createdAt" })).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.entityId.localeCompare(right.entityId));
    return { base, records };
  }

  function aggregateRows(records: readonly Readonly<{ dimensionValue: string; contribution: string }>[], aggregation: string) {
    const groups = new Map<string, bigint[]>();
    for (const record of records) groups.set(record.dimensionValue, [...(groups.get(record.dimensionValue) ?? []), BigInt(record.contribution)]);
    return [...groups].sort(([left], [right]) => left.localeCompare(right, "pt-BR")).map(([key, values]) => { const sum = values.reduce((total, value) => total + value, 0n); const value = aggregation === "COUNT" ? String(values.length) : aggregation === "AVERAGE" ? String(sum / BigInt(values.length)) : aggregation === "LATEST" ? String(values.at(-1) ?? 0n) : String(sum); return { key, label: key, value, count: values.length }; });
  }

  async function readDashboard(context: AuthenticatedContext, dashboardId: string) {
    await authorize(context, dashboardId);
    const dashboard = await options.database.analyticsDashboard.findFirst({ where: { id: uuid.parse(dashboardId), workspaceId: context.workspaceId, archivedAt: null }, include: { widgets: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
    if (!dashboard) fail("Dashboard não encontrado.", "NOT_FOUND", 404);
    return dashboard;
  }

  async function widgetResult(context: AuthenticatedContext, widget: Awaited<ReturnType<typeof readDashboard>>["widgets"][number], screenCache: Map<string, Awaited<ReturnType<RevenuePort["getScreen"]>>>) {
    const query = widgetQuery(widget); const cacheKey = JSON.stringify(query);
    let screen = screenCache.get(cacheKey);
    if (!screen) { screen = await options.revenue.getScreen(context, query); screenCache.set(cacheKey, screen); }
    if (integratedMetricRegistry.some((definition) => definition.id === widget.metricId)) {
      const filters = widget.filters && typeof widget.filters === "object" && !Array.isArray(widget.filters) ? widget.filters as Record<string, unknown> : {};
      const list = (key: string) => Array.isArray(filters[key]) ? (filters[key] as unknown[]).filter((value): value is string => typeof value === "string") : [];
      const integrated = await metrics.getIntegratedOverview(context, { from: screen.query.period.from, to: screen.query.period.to, filters: { sdrMemberIds: list("sdr"), closerMemberIds: list("closer"), teamIds: list("team"), sourceIds: list("source"), campaignIds: list("campaign"), creativeIds: list("creative"), priorityCodes: list("priority"), productIds: list("product") } });
      const metric = integrated.values.find((candidate) => candidate.metricId === widget.metricId);
      return { id: widget.id, title: widget.title, type: widget.visualization, metricKey: widget.metricId, aggregation: widget.aggregation, dimensionKey: widget.dimension, dateBasis: widget.dateField, period: { preset: widget.periodPreset, fromDate: widget.fromDate, toDate: widget.toDate }, filters: widget.filters, revision: widget.revision, state: metric?.state === "AVAILABLE" ? "AVAILABLE" : metric?.state === "ZERO" ? "ZERO" : metric?.state === "PARTIAL" ? "PARTIAL" : metric?.state === "SUPPRESSED" ? "SUPPRESSED" : "MISSING", freshnessAt: integrated.quality.freshnessAt, reason: metric?.reason ?? "A métrica integrada não retornou dados para o recorte.", drilldownHref: metric ? `/api/analytics/widgets/${widget.id}/drilldown` : null, value: metric?.value ?? null, comparisonValue: null, points: [], rows: [], columns: [] };
    }
    if (widget.metricId === "sales.opportunity_value") {
      const dataset = await opportunityRecords(context, widget, screen); const rows = aggregateRows(dataset.records, widget.aggregation);
      const value = rows.reduce((total, row) => total + BigInt(row.value), 0n).toString();
      return { id: widget.id, title: widget.title, type: widget.visualization, metricKey: widget.metricId, aggregation: widget.aggregation, dimensionKey: widget.dimension, dateBasis: widget.dateField, period: { preset: widget.periodPreset, fromDate: widget.fromDate, toDate: widget.toDate }, filters: widget.filters, revision: widget.revision, state: dataset.records.length ? "AVAILABLE" : "MISSING", freshnessAt: dataset.base.generatedAt, reason: dataset.records.length ? `Coorte por ${widget.dateField}, calculada com ${dataset.records.length} oportunidades distintas.` : `Nenhuma oportunidade na coorte ${widget.dateField}.`, drilldownHref: `/api/analytics/widgets/${widget.id}/drilldown`, value, comparisonValue: null, points: rows.map((row) => ({ key: row.key, label: row.label, value: row.value })), rows, columns: ["label", "value", "count"] };
    }
    const metric = screen.metrics.find((candidate) => candidate.metricId === widget.metricId);
    const series = screen.series.find((candidate) => candidate.metricId === widget.metricId);
    const qualityState = metric?.state === "AVAILABLE" ? "AVAILABLE" : metric?.state === "ZERO" ? "ZERO" : metric?.state === "PARTIAL" ? "PARTIAL" : metric?.state === "SUPPRESSED" ? "SUPPRESSED" : "MISSING";
    return {
      id: widget.id, title: widget.title, type: widget.visualization, metricKey: widget.metricId, aggregation: widget.aggregation,
      dimensionKey: widget.dimension, dateBasis: widget.dateField,
      period: { preset: widget.periodPreset, fromDate: widget.fromDate, toDate: widget.toDate }, filters: widget.filters,
      revision: widget.revision, state: qualityState, freshnessAt: screen.generatedAt,
      reason: metric?.reason ?? "A métrica não retornou dados para o recorte.", drilldownHref: metric?.drilldownId ? `/api/analytics/widgets/${widget.id}/drilldown` : null,
      value: metric?.value ?? null, comparisonValue: screen.comparisons.find((candidate) => candidate.metricId === widget.metricId)?.previous.value ?? null,
      points: series?.points ?? [], rows: [], columns: [],
    };
  }

  async function screen(context: AuthenticatedContext) {
    await authorize(context);
    const dashboards = await options.database.analyticsDashboard.findMany({ where: { workspaceId: context.workspaceId, archivedAt: null }, include: { widgets: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }] });
    const rendered = []; const screenCache = new Map<string, Awaited<ReturnType<RevenuePort["getScreen"]>>>();
    const [manage, exportDecision] = await Promise.all([
      options.authorization.authorize(context, PermissionKeys.OPERATIONS_MANAGE, resource(context)),
      options.authorization.authorize(context, PermissionKeys.EXPORTS_EXECUTE, resource(context)),
    ]);
    for (const dashboard of dashboards) {
      const widgets = [];
      for (const widget of dashboard.widgets) widgets.push(await widgetResult(context, widget, screenCache));
      rendered.push({ id: dashboard.id, name: dashboard.name, description: dashboard.description, revision: dashboard.revision, updatedAt: dashboard.updatedAt.toISOString(), widgets });
    }
    return { generatedAt: options.now().toISOString(), dashboards: rendered, catalog: analyticsCatalog(), permissions: { canRead: true, canManage: manage.allowed, canExport: exportDecision.allowed, canDrilldown: true } };
  }

  function widgetData(context: AuthenticatedContext, dashboardId: string, value: z.infer<typeof createAnalyticsDashboardSchema>["widgets"][number]) {
    let metric;
    try { metric = validateWidgetCompatibility(value); } catch (error) { fail(error instanceof Error ? error.message : "Widget incompatível.", "INVALID_WIDGET", 409); }
    return { ...(value.id ? { id: value.id } : {}), workspaceId: context.workspaceId, dashboardId, title: value.title, metricId: metric.id, metricVersion: metric.version, visualization: value.type, aggregation: value.aggregation, periodPreset: value.period.preset, fromDate: value.period.fromDate, toDate: value.period.toDate, asOf: value.asOf ? new Date(value.asOf) : null, dateField: value.dateBasis, dimension: value.dimensionKey, filters: json(value.filters), position: json(value.position), createdByActorId: context.actorId, updatedByActorId: context.actorId };
  }

  async function idempotent<T>(context: AuthenticatedContext, key: string, operation: string, run: (tx: Prisma.TransactionClient) => Promise<{ entityId: string; result: T }>): Promise<{ result: T; idempotentReplay: boolean }> {
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`analytics:${context.workspaceId}:${key}`}, 0))`;
      const receipt = await tx.analyticsMutationReceipt.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: key } } });
      if (receipt) {
        if (receipt.operation !== operation) fail("A chave de idempotência já foi usada em outra operação.", "IDEMPOTENCY_CONFLICT", 409);
        return { result: receipt.response as T, idempotentReplay: true };
      }
      const executed = await run(tx);
      await tx.analyticsMutationReceipt.create({ data: { workspaceId: context.workspaceId, idempotencyKey: key, operation, entityId: executed.entityId, response: json(executed.result), actorId: context.actorId } });
      return { result: executed.result, idempotentReplay: false };
    });
  }

  async function create(context: AuthenticatedContext, raw: unknown) {
    await authorize(context); await authorizeManage(context);
    const input = createAnalyticsDashboardSchema.parse(raw);
    return idempotent(context, input.idempotencyKey, "CREATE_DASHBOARD", async (tx) => {
      const dashboard = await tx.analyticsDashboard.create({ data: { workspaceId: context.workspaceId, name: input.name, description: input.description, creationKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      for (const widget of input.widgets) await tx.analyticsWidget.create({ data: widgetData(context, dashboard.id, widget) });
      const result = { id: dashboard.id, name: dashboard.name, description: dashboard.description, revision: dashboard.revision };
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "analytics.dashboard_created", entityType: "AnalyticsDashboard", entityId: dashboard.id, changes: json({ widgetCount: input.widgets.length, revision: 1 }) } });
      return { entityId: dashboard.id, result };
    });
  }

  async function update(context: AuthenticatedContext, dashboardId: string, raw: unknown) {
    await authorize(context, dashboardId); await authorizeManage(context, dashboardId);
    const id = uuid.parse(dashboardId); const input = updateAnalyticsDashboardSchema.parse(raw);
    for (const widget of input.widgets) { try { validateWidgetCompatibility(widget); } catch (error) { fail(error instanceof Error ? error.message : "Widget incompatível.", "INVALID_WIDGET", 409); } }
    return idempotent(context, input.idempotencyKey, "UPDATE_DASHBOARD", async (tx) => {
      const changed = await tx.analyticsDashboard.updateMany({ where: { id, workspaceId: context.workspaceId, archivedAt: null, revision: input.expectedRevision }, data: { name: input.name, description: input.description, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      if (changed.count !== 1) fail("O dashboard foi alterado por outra sessão.", "REVISION_CONFLICT", 409);
      const activeIds = input.widgets.flatMap((widget) => widget.id ? [widget.id] : []);
      await tx.analyticsWidget.updateMany({ where: { workspaceId: context.workspaceId, dashboardId: id, deletedAt: null, ...(activeIds.length > 0 ? { id: { notIn: activeIds } } : {}) }, data: { deletedAt: options.now(), updatedByActorId: context.actorId } });
      for (const widget of input.widgets) {
        const data = widgetData(context, id, widget);
        if (!widget.id) { await tx.analyticsWidget.create({ data }); continue; }
        const mutable = { title: data.title, metricId: data.metricId, metricVersion: data.metricVersion, visualization: data.visualization, aggregation: data.aggregation, periodPreset: data.periodPreset, fromDate: data.fromDate, toDate: data.toDate, asOf: data.asOf, dateField: data.dateField, dimension: data.dimension, filters: data.filters, position: data.position, updatedByActorId: data.updatedByActorId, revision: { increment: 1 } };
        const updated = await tx.analyticsWidget.updateMany({ where: { id: widget.id, workspaceId: context.workspaceId, dashboardId: id, deletedAt: null, ...(widget.expectedRevision ? { revision: widget.expectedRevision } : {}) }, data: mutable });
        if (updated.count !== 1) fail("Widget inexistente ou alterado por outra sessão.", "WIDGET_REVISION_CONFLICT", 409);
      }
      const dashboard = await tx.analyticsDashboard.findFirstOrThrow({ where: { id, workspaceId: context.workspaceId }, select: { id: true, name: true, description: true, revision: true } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "analytics.dashboard_updated", entityType: "AnalyticsDashboard", entityId: id, changes: json({ previousRevision: input.expectedRevision, revision: dashboard.revision, widgetCount: input.widgets.length }) } });
      return { entityId: id, result: dashboard };
    });
  }

  async function archive(context: AuthenticatedContext, dashboardId: string, expectedRevision: number) {
    await authorize(context, dashboardId); await authorizeManage(context, dashboardId); const id = uuid.parse(dashboardId);
    const changed = await options.database.analyticsDashboard.updateMany({ where: { id, workspaceId: context.workspaceId, archivedAt: null, revision: expectedRevision }, data: { archivedAt: options.now(), revision: { increment: 1 }, updatedByActorId: context.actorId } });
    if (changed.count !== 1) fail("Dashboard inexistente ou alterado por outra sessão.", "REVISION_CONFLICT", 409);
    return { id, archived: true };
  }

  async function orderedDataset(context: AuthenticatedContext, widgetId: string) {
    await authorize(context, widgetId);
    const widget = await options.database.analyticsWidget.findFirst({ where: { id: uuid.parse(widgetId), workspaceId: context.workspaceId, deletedAt: null, dashboard: { archivedAt: null } } });
    if (!widget) fail("Widget não encontrado.", "NOT_FOUND", 404);
    if (integratedMetricRegistry.some((definition) => definition.id === widget.metricId)) {
      const period = await options.revenue.getScreen(context, widgetQuery(widget));
      const filters = widget.filters && typeof widget.filters === "object" && !Array.isArray(widget.filters) ? widget.filters as Record<string, unknown> : {};
      const list = (key: string) => Array.isArray(filters[key]) ? (filters[key] as unknown[]).filter((value): value is string => typeof value === "string") : [];
      const query = { from: period.query.period.from, to: period.query.period.to, filters: { sdrMemberIds: list("sdr"), closerMemberIds: list("closer"), teamIds: list("team"), sourceIds: list("source"), campaignIds: list("campaign"), creativeIds: list("creative"), priorityCodes: list("priority"), productIds: list("product") } };
      const records = []; let cursor: string | undefined; let truncated = false;
      for (let page = 0; page < 100; page += 1) {
        const result = await metrics.getIntegratedDrilldown(context, { metricId: widget.metricId, query, ...(cursor ? { cursor } : {}), limit: 100 });
        records.push(...result.records.map((record) => ({ key: `commercial-metric-fact:${record.id}`, entityType: record.sourceEntityType, entityId: record.sourceEntityId, title: record.eventType, subtitle: record.result ?? record.channel ?? record.sourceEntityType, occurredAt: record.occurredAt, contribution: record.valueCents ?? String(record.quantity), unit: record.valueCents === null ? "COUNT" : "CENTS", href: null, provenance: `CommercialMetricFact/${record.producerVersion}` })));
        if (!result.nextCursor) { cursor = undefined; break; }
        cursor = result.nextCursor;
        if (page === 99) truncated = true;
      }
      return { widget: { id: widget.id, title: widget.title, metricKey: widget.metricId, dimensionKey: widget.dimension, aggregation: widget.aggregation }, query, records, total: records.length, truncated, quality: truncated ? { state: "PARTIAL", reason: "Resultado limitado aos primeiros 10.000 fatos autorizados." } : { state: records.length > 0 ? "AVAILABLE" : "MISSING", reason: records.length > 0 ? "Dataset canônico autorizado completo." : "Nenhum fato no recorte." } };
    }
    if (widget.metricId === "sales.opportunity_value") { const dataset = await opportunityRecords(context, widget); return { widget: { id: widget.id, title: widget.title, metricKey: widget.metricId, dimensionKey: widget.dimension, aggregation: widget.aggregation }, query: dataset.base.query, records: dataset.records, total: dataset.records.length, truncated: false, quality: { state: dataset.records.length > 0 ? "AVAILABLE" : "MISSING", reason: dataset.records.length > 0 ? `Dataset completo pela data-base ${widget.dateField}.` : "Nenhum registro no recorte." } }; }
    const query = { ...widgetQuery(widget), metric: widget.metricId, page: 1, pageSize: 100 };
    const first = await options.revenue.getDrilldown(context, query); const records = [...first.records];
    const pages = Math.min(first.totalPages, 100);
    for (let page = 2; page <= pages; page += 1) records.push(...(await options.revenue.getDrilldown(context, { ...query, page })).records);
    return { widget: { id: widget.id, title: widget.title, metricKey: widget.metricId, dimensionKey: widget.dimension, aggregation: widget.aggregation }, query: first.query, records, total: first.total, truncated: first.totalPages > 100, quality: first.totalPages > 100 ? { state: "PARTIAL", reason: "Resultado limitado aos primeiros 10.000 registros autorizados." } : { state: records.length > 0 ? "AVAILABLE" : "MISSING", reason: records.length > 0 ? "Dataset autorizado completo." : "Nenhum registro no recorte." } };
  }

  async function csv(context: AuthenticatedContext, widgetId: string) { await options.authorization.assertAuthorized(context, PermissionKeys.EXPORTS_EXECUTE, resource(context, widgetId)); const data = await orderedDataset(context, widgetId); return { filename: `analytics-${data.widget.metricKey.replaceAll(".", "-")}.csv`, csv: recordsCsv(data.records as unknown as Record<string, unknown>[]), total: data.total, truncated: data.truncated }; }
  return Object.freeze({ screen, readDashboard, create, update, archive, orderedDataset, csv });
}

let singleton: ReturnType<typeof createAnalyticsBuilderService> | undefined;
export function getAnalyticsBuilderService() { singleton ??= createAnalyticsBuilderService({ database: getDatabaseClient(), authorization: getAuthorizationService(), revenue: getRevenueMetricsService(), metrics: getMetricsService(), now: () => new Date() }); return singleton; }
