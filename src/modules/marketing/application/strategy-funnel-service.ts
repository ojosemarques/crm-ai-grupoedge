import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  createStrategyFunnelSchema,
  strategyFunnelDefinitionSchema,
  strategyFunnelQuerySchema,
  updateStrategyFunnelSchema,
  type StrategyFunnelDefinition,
} from "@/modules/marketing/domain/strategy-funnel-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;
type Evidence = { volume: number; leadIds: Set<string>; sessionIds: Set<string>; provenance: string; coverage: string };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function fail(message: string, code = "INVALID_INPUT", statusCode = 400): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}
function resource(context: AuthenticatedContext, id?: string) {
  return { workspaceId: context.workspaceId, resourceType: "StrategyFunnel", memberId: context.memberId, ...(id ? { resourceId: id } : {}) };
}
function centsPer(total: bigint, denominator: number) {
  return denominator > 0 ? (total / BigInt(denominator)).toString() : null;
}

export function createStrategyFunnelService(options: Options) {
  async function authorizeRead(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.MARKETING_MEDIA_READ, resource(context));
  }
  async function authorizeManage(context: AuthenticatedContext, id?: string) {
    await options.authorization.assertAuthorized(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE, resource(context, id));
  }

  async function assertReferences(context: AuthenticatedContext, definition: StrategyFunnelDefinition) {
    const ids = (type: StrategyFunnelDefinition["nodes"][number]["type"]) => definition.nodes.filter((node) => node.type === type).flatMap((node) => node.referenceId ? [node.referenceId] : []);
    const [pages, forms, stages] = await Promise.all([
      options.database.landingPage.count({ where: { workspaceId: context.workspaceId, id: { in: ids("LANDING_PAGE") }, deletedAt: null } }),
      options.database.marketingForm.count({ where: { workspaceId: context.workspaceId, id: { in: ids("FORM") }, deletedAt: null } }),
      options.database.pipelineStage.count({ where: { workspaceId: context.workspaceId, id: { in: ids("COMMERCIAL_STAGE") }, deletedAt: null } }),
    ]);
    if (pages !== new Set(ids("LANDING_PAGE")).size || forms !== new Set(ids("FORM")).size || stages !== new Set(ids("COMMERCIAL_STAGE")).size) {
      fail("Uma etapa referencia um registro inexistente neste workspace.", "STRATEGY_REFERENCE_NOT_FOUND", 409);
    }
  }

  async function nodeEvidence(context: AuthenticatedContext, node: StrategyFunnelDefinition["nodes"][number], start: Date, end: Date): Promise<Evidence> {
    if (node.type === "LANDING_PAGE") {
      const where = { workspaceId: context.workspaceId, landingPageId: node.referenceId!, kind: "PAGE_VIEW" as const, privacyDecision: "ALLOW" as const, occurredAt: { gte: start, lt: end } };
      const [volume, rows] = await Promise.all([options.database.marketingTouchpoint.count({ where }), options.database.marketingTouchpoint.findMany({ where, select: { sessionId: true, leadId: true }, take: 50_000 })]);
      return { volume, leadIds: new Set(rows.flatMap((row) => row.leadId ? [row.leadId] : [])), sessionIds: new Set(rows.flatMap((row) => row.sessionId ? [row.sessionId] : [])), provenance: "MarketingTouchpoint/PAGE_VIEW", coverage: volume > rows.length ? "PARTIAL" : "COMPLETE" };
    }
    if (node.type === "FORM") {
      const where = { workspaceId: context.workspaceId, marketingFormId: node.referenceId!, submittedAt: { gte: start, lt: end } };
      const [volume, rows] = await Promise.all([options.database.leadFormSubmission.count({ where }), options.database.leadFormSubmission.findMany({ where, select: { leadId: true, marketingSessionId: true }, take: 50_000 })]);
      return { volume, leadIds: new Set(rows.flatMap((row) => row.leadId ? [row.leadId] : [])), sessionIds: new Set(rows.flatMap((row) => row.marketingSessionId ? [row.marketingSessionId] : [])), provenance: "LeadFormSubmission/submittedAt", coverage: volume > rows.length ? "PARTIAL" : "COMPLETE" };
    }
    if (node.type === "WHATSAPP") {
      const where = { workspaceId: context.workspaceId, channel: "WHATSAPP" as const, openedAt: { gte: start, lt: end }, deletedAt: null };
      const [volume, rows] = await Promise.all([options.database.conversation.count({ where }), options.database.conversation.findMany({ where, select: { leadId: true }, take: 50_000 })]);
      return { volume, leadIds: new Set(rows.flatMap((row) => row.leadId ? [row.leadId] : [])), sessionIds: new Set(), provenance: "Conversation/WHATSAPP/openedAt", coverage: volume > rows.length ? "PARTIAL" : "COMPLETE" };
    }
    const rows = await options.database.stageHistory.findMany({
      where: { workspaceId: context.workspaceId, stageId: node.referenceId!, enteredAt: { gte: start, lt: end } },
      select: { leadId: true, opportunity: { select: { leadId: true } } }, take: 50_001,
    });
    const leadIds = new Set(rows.flatMap((row) => row.leadId ? [row.leadId] : row.opportunity?.leadId ? [row.opportunity.leadId] : []));
    return { volume: leadIds.size, leadIds, sessionIds: new Set(), provenance: "StageHistory/enteredAt/distinctLead", coverage: rows.length > 50_000 ? "PARTIAL" : "COMPLETE" };
  }

  function edgeMetric(source: Evidence, target: Evidence, totalSpend: bigint) {
    const common = source.leadIds.size > 0 && (target.leadIds.size > 0 || target.volume === 0)
      ? { grain: "LEAD" as const, source: source.leadIds, target: target.leadIds }
      : source.sessionIds.size > 0 && (target.sessionIds.size > 0 || target.volume === 0)
        ? { grain: "SESSION" as const, source: source.sessionIds, target: target.sessionIds }
        : null;
    if (!common) return { grain: null, denominator: null, converted: null, conversionBps: null, costPerConversionCents: null, quality: "NOT_COMPARABLE" as const };
    const converted = [...common.source].filter((id) => common.target.has(id)).length;
    return { grain: common.grain, denominator: common.source.size, converted, conversionBps: common.source.size ? Math.round(converted * 10_000 / common.source.size) : null, costPerConversionCents: centsPer(totalSpend, converted), quality: source.coverage === "PARTIAL" || target.coverage === "PARTIAL" ? "PARTIAL" as const : "COMPLETE" as const };
  }

  async function screen(context: AuthenticatedContext, raw: unknown) {
    await authorizeRead(context);
    const query = strategyFunnelQuerySchema.parse(raw);
    const [rows, pages, forms, pipelines, spend, manage] = await Promise.all([
      options.database.strategyFunnel.findMany({ where: { workspaceId: context.workspaceId, archivedAt: null }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 50 }),
      options.database.landingPage.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true, canonicalUrl: true }, orderBy: { name: "asc" } }),
      options.database.marketingForm.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      options.database.pipeline.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true, stages: { where: { deletedAt: null }, select: { id: true, name: true, position: true }, orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
      options.database.marketingPerformanceFact.aggregate({ where: { workspaceId: context.workspaceId, status: "CONFIRMED", periodStart: { gte: query.periodStart, lt: query.periodEnd } }, _sum: { spendCents: true } }),
      options.authorization.authorize(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE, resource(context)),
    ]);
    const totalSpend = spend._sum.spendCents ?? 0n;
    const parsedRows = rows.flatMap((row) => {
      const parsed = strategyFunnelDefinitionSchema.safeParse(row.definition);
      return parsed.success ? [{ row, definition: parsed.data }] : [];
    });
    const uniqueNodes = new Map<string, StrategyFunnelDefinition["nodes"][number]>();
    for (const { definition } of parsedRows) for (const node of definition.nodes) uniqueNodes.set(`${node.type}:${node.referenceId ?? ""}`, node);
    const evidenceEntries = await Promise.all([...uniqueNodes.entries()].map(async ([key, node]) => [key, await nodeEvidence(context, node, query.periodStart, query.periodEnd)] as const));
    const evidenceByNode = new Map(evidenceEntries);
    const strategies = parsedRows.map(({ row, definition }) => {
      const evidences = definition.nodes.map((node) => evidenceByNode.get(`${node.type}:${node.referenceId ?? ""}`)!);
      return {
        id: row.id, name: row.name, description: row.description, revision: row.revision, definition,
        nodes: definition.nodes.map((node, index) => ({ ...node, volume: evidences[index]!.volume, identifiedLeads: evidences[index]!.leadIds.size, identifiedSessions: evidences[index]!.sessionIds.size, costPerResultCents: centsPer(totalSpend, evidences[index]!.volume), provenance: evidences[index]!.provenance, coverage: evidences[index]!.coverage })),
        edges: definition.nodes.slice(0, -1).map((node, index) => ({ fromNodeId: node.id, toNodeId: definition.nodes[index + 1]!.id, ...edgeMetric(evidences[index]!, evidences[index + 1]!, totalSpend) })),
      };
    });
    return { generatedAt: options.now().toISOString(), period: { start: query.periodStart.toISOString(), end: query.periodEnd.toISOString() }, totalSpendCents: totalSpend.toString(), costMethod: "Custo acumulado = investimento confirmado de mídia no período ÷ resultado observado. Conversão usa apenas identidades comuns de lead ou sessão; quando não há vínculo comprovável, permanece sem base.", strategies, catalog: { pages, forms, pipelines }, permissions: { canManage: manage.allowed } };
  }

  async function create(context: AuthenticatedContext, raw: unknown) {
    await authorizeRead(context); await authorizeManage(context);
    const input = createStrategyFunnelSchema.parse(raw); await assertReferences(context, input.definition);
    const replay = await options.database.strategyFunnel.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
    if (replay) return replay;
    return options.database.$transaction(async (tx) => {
      const row = await tx.strategyFunnel.create({ data: { workspaceId: context.workspaceId, name: input.name, description: input.description, definition: json(input.definition), idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId, updatedAt: options.now() } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.strategy_funnel.created", entityType: "StrategyFunnel", entityId: row.id, changes: json({ revision: row.revision, nodeCount: input.definition.nodes.length }) } });
      return row;
    });
  }

  async function update(context: AuthenticatedContext, id: string, raw: unknown) {
    await authorizeRead(context); await authorizeManage(context, id);
    const input = updateStrategyFunnelSchema.parse(raw); await assertReferences(context, input.definition);
    return options.database.$transaction(async (tx) => {
      const changed = await tx.strategyFunnel.updateMany({ where: { id, workspaceId: context.workspaceId, archivedAt: null, revision: input.expectedRevision }, data: { name: input.name, description: input.description, definition: json(input.definition), revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: options.now() } });
      if (changed.count !== 1) fail("A estratégia foi alterada por outra sessão.", "REVISION_CONFLICT", 409);
      const row = await tx.strategyFunnel.findFirstOrThrow({ where: { id, workspaceId: context.workspaceId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.strategy_funnel.updated", entityType: "StrategyFunnel", entityId: id, changes: json({ revision: row.revision, nodeCount: input.definition.nodes.length }) } });
      return row;
    });
  }

  async function archive(context: AuthenticatedContext, id: string, expectedRevision: number) {
    await authorizeRead(context); await authorizeManage(context, id);
    return options.database.$transaction(async (tx) => {
      const changed = await tx.strategyFunnel.updateMany({ where: { id, workspaceId: context.workspaceId, archivedAt: null, revision: expectedRevision }, data: { status: "ARCHIVED", archivedAt: options.now(), revision: { increment: 1 }, updatedByActorId: context.actorId, updatedAt: options.now() } });
      if (changed.count !== 1) fail("A estratégia foi alterada por outra sessão.", "REVISION_CONFLICT", 409);
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.strategy_funnel.archived", entityType: "StrategyFunnel", entityId: id, changes: json({ expectedRevision }) } });
      return { id, archived: true };
    });
  }

  return Object.freeze({ screen, create, update, archive });
}

let service: ReturnType<typeof createStrategyFunnelService> | undefined;
export function getStrategyFunnelService() {
  service ??= createStrategyFunnelService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
