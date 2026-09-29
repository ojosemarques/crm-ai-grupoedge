import { Prisma, type PrismaClient, type Territory } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  GEOGRAPHY_MINIMUM_GROUP_SIZE,
  GEOGRAPHY_RULE_VERSION,
  geographicEvidenceClasses,
  geographicPrecisions,
  hashTerritoryRule,
  normalizeLocation,
  pointInPolygon,
  territoryInputSchema,
} from "@/modules/geography/domain/geography";
import { getMetricsService } from "@/modules/metrics/application/metrics-service";
import type { MetricsFilters, MetricsOverview } from "@/modules/metrics/domain/metrics-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const geographicMetrics = [
  "LEADS", "ATTEMPTS", "CONTACTS", "QUALIFIED", "MEETINGS", "NO_SHOWS",
  "OPPORTUNITIES", "PROPOSALS", "WINS", "LOSSES", "DISQUALIFIED", "REVENUE",
  "CONVERSION", "SLA",
] as const;

const listParam = z.preprocess((value) => {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.flatMap((item) => typeof item === "string" ? item.split(",").filter(Boolean) : []);
}, z.array(z.string()).max(100));
const uuidList = listParam.pipe(z.array(z.string().uuid()).max(100));

const screenQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  metric: z.enum(geographicMetrics).default("LEADS"),
  stateCode: z.string().trim().max(8).optional(),
  territoryId: z.string().uuid().optional(),
  sourceIds: uuidList.default([]),
  campaignIds: uuidList.default([]),
  creativeIds: uuidList.default([]),
  sdrMemberIds: uuidList.default([]),
  closerMemberIds: uuidList.default([]),
  teamIds: uuidList.default([]),
  stageIds: uuidList.default([]),
  priorityCodes: listParam.pipe(z.array(z.enum(["P1", "P2", "P3"]))).default([]),
  precisions: listParam.pipe(z.array(z.enum(geographicPrecisions))).default([]),
  evidenceClasses: listParam.pipe(z.array(z.enum(geographicEvidenceClasses))).default([]),
  verificationStatuses: listParam.pipe(z.array(z.enum(["UNVERIFIED", "VERIFIED", "NEEDS_REVIEW", "REJECTED"]))).default([]),
  minimumConfidenceBps: z.coerce.number().int().min(0).max(10_000).optional(),
}).strict();

const backfillSchema = z.object({
  mode: z.enum(["DRY_RUN", "EXECUTE"]),
  idempotencyKey: z.string().trim().min(8).max(160),
}).strict();
const observationSchema = z.object({
  targetType: z.enum(["CONTACT", "ACCOUNT", "LEAD", "TOUCHPOINT", "CONVERSION"]),
  targetId: z.string().uuid(),
  location: z.unknown(),
  sourceRecordId: z.string().trim().max(180).optional(),
  observedAt: z.string().datetime({ offset: true }),
  idempotencyKey: z.string().trim().min(8).max(160),
  evidence: z.record(z.string(), z.unknown()).optional(),
  expectedRevision: z.number().int().positive().optional(),
}).strict();
const resolveSchema = z.object({
  targetType: z.enum(["CONTACT", "ACCOUNT", "LEAD", "TOUCHPOINT", "CONVERSION"]),
  targetId: z.string().uuid(),
  at: z.string().datetime({ offset: true }).optional(),
  overrideTerritoryId: z.string().uuid().optional(),
  reason: z.string().trim().min(8).max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(160),
}).strict();
const territoryStatusSchema = z.object({
  territoryId: z.string().uuid(),
  status: z.literal("INACTIVE"),
  reason: z.string().trim().min(8).max(500),
}).strict();

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "assertAuthorized">;
type MetricsPort = Pick<ReturnType<typeof getMetricsService>, "getOverview">;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; metrics: MetricsPort; now: () => Date }>;
type GeographicMetric = (typeof geographicMetrics)[number];
type FunnelTotals = Readonly<{
  leads: number; attempts: number; contacts: number; qualified: number; meetings: number;
  meetingsHeld: number; noShows: number; opportunities: number; proposals: number; wins: number;
  losses: number; disqualified: number; revenueCents: string; conversionBps: number | null;
  medianSlaSeconds: number | null;
}>;
type Comparison = Readonly<{ current: number | null; previous: number | null; difference: number | null; percentageBps: number | null }>;
type RegionRow = Readonly<{
  key: string; label: string; stateCode: string | null; territoryId: string | null;
  sampleSize: number | null; belowMinimum: boolean; totals: FunnelTotals | null;
  previousTotals: FunnelTotals | null; value: number | null; previousValue: number | null;
  comparison: Comparison; drilldownUrl: string;
}>;
type LeadRecord = Readonly<{
  id: string; stateCode: string | null; city: string | null; sourceId: string;
  latestSourceId: string | null; campaignId: string | null; latestCampaignId: string | null;
  creativeId: string | null; latestCreativeId: string | null; currentStageId: string;
  ownerMemberId: string | null;
}>;

function resource(workspaceId: string, resourceId?: string): ResourceScope {
  return { workspaceId, resourceType: "GeographicIntelligence", ...(resourceId ? { resourceId } : {}) };
}
function invalid(message: string): never {
  throw new ApplicationError(message, { code: "INVALID_INPUT", statusCode: 400, expose: true });
}
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}
function previousPeriod(from: Date, to: Date) {
  const duration = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - duration), to: from };
}
function coverage(total: number, located: number): number | null {
  return total === 0 ? null : Math.round((located * 10_000) / total);
}
function compare(current: number | null, previous: number | null): Comparison {
  return {
    current, previous,
    difference: current === null || previous === null ? null : current - previous,
    percentageBps: current === null || previous === null || previous === 0 ? null : Math.round(((current - previous) * 10_000) / Math.abs(previous)),
  };
}
function safeEvidence(input: Record<string, unknown> | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!input) return Prisma.JsonNull;
  const result: Record<string, string | string[]> = {};
  if (typeof input.source === "string") result.source = input.source.slice(0, 80);
  if (typeof input.reasonCode === "string") result.reasonCode = input.reasonCode.slice(0, 80);
  if (Array.isArray(input.fields)) result.fields = input.fields.filter((value): value is string => typeof value === "string").slice(0, 16).map((value) => value.slice(0, 80));
  return Object.keys(result).length ? json(result) : Prisma.JsonNull;
}
function territoryMatches(territory: Territory, location: Readonly<{
  countryCode: string; stateCode: string | null; normalizedCity: string | null; postalPrefix: string | null;
  latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null;
}>): boolean {
  if (territory.countryCode && territory.countryCode !== location.countryCode) return false;
  if (territory.type === "COUNTRY") return territory.countryCode === location.countryCode;
  if (territory.type === "REGION") return territory.countryCode === null || territory.countryCode === location.countryCode;
  if (territory.type === "STATE") return territory.stateCode === location.stateCode;
  if (territory.type === "CITY") return territory.stateCode === location.stateCode && territory.normalizedCity === location.normalizedCity;
  if (territory.type === "POSTAL_PREFIX") return Boolean(territory.postalPrefix && location.postalPrefix?.startsWith(territory.postalPrefix));
  if (territory.type === "POLYGON" && territory.polygon && location.latitude !== null && location.longitude !== null) return pointInPolygon([Number(location.longitude), Number(location.latitude)], territory.polygon);
  return false;
}
function matchType(type: Territory["type"]): "COUNTRY" | "STATE" | "CITY" | "POSTAL_PREFIX" | "POLYGON" {
  return type === "REGION" ? "COUNTRY" : type;
}
function countRows<T extends { leadId: string }>(rows: readonly T[], allowed: ReadonlySet<string>): number {
  return rows.filter((row) => allowed.has(row.leadId)).length;
}
function totals(overview: MetricsOverview, ids: ReadonlySet<string>): FunnelTotals {
  const evidence = overview.evidence;
  const leads = evidence.leadsReceivedLeadIds.filter((id) => ids.has(id)).length;
  const wins = evidence.periodWins.filter((row) => ids.has(row.leadId));
  const wonAtCut = new Set(evidence.wonLeadIdsAtCut.filter((id) => ids.has(id)));
  const wonCohort = evidence.leadsReceivedLeadIds.filter((id) => wonAtCut.has(id) && ids.has(id)).length;
  const sla = evidence.slaCycles.flatMap((row) => ids.has(row.leadId) && row.humanSeconds !== null ? [row.humanSeconds] : []);
  return {
    leads,
    attempts: evidence.attemptedLeadIds.filter((id) => ids.has(id)).length,
    contacts: evidence.contactedLeadIds.filter((id) => ids.has(id)).length,
    qualified: evidence.qualifiedLeadIds.filter((id) => ids.has(id)).length,
    meetings: countRows(evidence.scheduledMeetings, ids), meetingsHeld: countRows(evidence.heldMeetings, ids),
    noShows: countRows(evidence.noShowMeetings, ids), opportunities: countRows(evidence.opportunitiesCreated, ids),
    proposals: countRows(evidence.proposals, ids), wins: wins.length, losses: countRows(evidence.periodLosses, ids),
    disqualified: countRows(evidence.disqualifications, ids),
    revenueCents: wins.reduce((sum, row) => sum + BigInt(row.amountCents), 0n).toString(),
    conversionBps: leads === 0 ? null : Math.round((wonCohort * 10_000) / leads),
    medianSlaSeconds: median(sla),
  };
}
function selectedValue(metric: GeographicMetric, value: FunnelTotals): number | null {
  switch (metric) {
    case "LEADS": return value.leads;
    case "ATTEMPTS": return value.attempts;
    case "CONTACTS": return value.contacts;
    case "QUALIFIED": return value.qualified;
    case "MEETINGS": return value.meetings;
    case "NO_SHOWS": return value.noShows;
    case "OPPORTUNITIES": return value.opportunities;
    case "PROPOSALS": return value.proposals;
    case "WINS": return value.wins;
    case "LOSSES": return value.losses;
    case "DISQUALIFIED": return value.disqualified;
    case "REVENUE": return Number(value.revenueCents);
    case "CONVERSION": return value.conversionBps;
    case "SLA": return value.medianSlaSeconds;
  }
}
function drilldownUrl(stateCode: string | null, from: Date, to: Date): string {
  const params = new URLSearchParams();
  if (stateCode) params.set("state", stateCode);
  params.set("enteredFrom", from.toISOString());
  params.set("enteredTo", to.toISOString());
  return `/leads?${params.toString()}`;
}

export function createGeographicIntelligenceService(options: Options) {
  async function assertRead(context: AuthenticatedContext) { await options.authorization.assertAuthorized(context, PermissionKeys.GEOGRAPHY_READ, resource(context.workspaceId)); }
  async function assertManage(context: AuthenticatedContext, id?: string) { await options.authorization.assertAuthorized(context, PermissionKeys.GEOGRAPHY_MANAGE, resource(context.workspaceId, id)); }
  async function assertBackfill(context: AuthenticatedContext) { await options.authorization.assertAuthorized(context, PermissionKeys.GEOGRAPHY_BACKFILL, resource(context.workspaceId)); }
  async function getOverview(context: AuthenticatedContext, from: Date, to: Date, filters: MetricsFilters) {
    return options.metrics.getOverview(context, { from: from.toISOString(), to: to.toISOString(), filters });
  }

  async function getScreen(context: AuthenticatedContext, input: unknown) {
    await assertRead(context);
    const parsed = screenQuerySchema.safeParse(input);
    if (!parsed.success) invalid("Filtros geográficos inválidos.");
    const query = parsed.data;
    const now = options.now();
    const to = query.to ? new Date(query.to) : now;
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 86_400_000);
    if (from >= to) invalid("O período geográfico é inválido.");
    const prior = previousPeriod(from, to);
    const filters: MetricsFilters = {
      sdrMemberIds: query.sdrMemberIds, closerMemberIds: query.closerMemberIds,
      teamIds: query.teamIds, sourceIds: query.sourceIds, campaignIds: query.campaignIds,
      creativeIds: query.creativeIds, priorityCodes: query.priorityCodes, productIds: [],
    };
    const [current, previousOverview] = await Promise.all([getOverview(context, from, to, filters), getOverview(context, prior.from, prior.to, filters)]);
    const allIds = [...new Set([...current.evidence.universeLeadIds, ...previousOverview.evidence.universeLeadIds])];
    const [leads, profiles, territories, memberships] = await Promise.all([
      allIds.length ? options.database.lead.findMany({
        where: { workspaceId: context.workspaceId, id: { in: allIds }, deletedAt: null },
        select: { id: true, stateCode: true, city: true, sourceId: true, latestSourceId: true, campaignId: true, latestCampaignId: true, creativeId: true, latestCreativeId: true, currentStageId: true, ownerMemberId: true },
      }) : Promise.resolve([] as LeadRecord[]),
      allIds.length ? options.database.geographicProfile.findMany({ where: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: { in: allIds } }, include: { location: true } }) : Promise.resolve([]),
      options.database.territory.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ code: "asc" }, { version: "desc" }] }),
      allIds.length ? options.database.territoryMembership.findMany({ where: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: { in: allIds }, validFrom: { lt: to } }, orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }] }) : Promise.resolve([]),
    ]);
    const leadById = new Map(leads.map((lead) => [lead.id, lead]));
    const profileById = new Map(profiles.map((profile) => [profile.targetId, profile]));
    const activeTerritories = territories.filter((territory) => territory.status === "ACTIVE");
    const activeTerritoryById = new Map(activeTerritories.map((territory) => [territory.id, territory]));
    function membershipAt(targetId: string, at: Date) {
      return memberships.find((item) => item.targetId === targetId && item.validFrom < at && (item.validTo === null || item.validTo >= at));
    }
    function allowedIds(overview: MetricsOverview, at: Date): Set<string> {
      return new Set(overview.evidence.universeLeadIds.filter((id) => {
        const lead = leadById.get(id);
        if (!lead) return false;
        const profile = profileById.get(id);
        const location = profile?.location;
        if (query.stateCode && location?.stateCode !== query.stateCode.toUpperCase()) return false;
        if (query.territoryId && membershipAt(id, at)?.territoryId !== query.territoryId) return false;
        if (query.stageIds.length && !query.stageIds.includes(lead.currentStageId)) return false;
        if (query.precisions.length && (!profile || !query.precisions.includes(profile.precision))) return false;
        if (query.evidenceClasses.length && (!profile || !query.evidenceClasses.includes(profile.evidenceClass))) return false;
        if (query.verificationStatuses.length && (!profile || !query.verificationStatuses.includes(profile.verificationStatus))) return false;
        if (query.minimumConfidenceBps !== undefined && (!profile || profile.confidenceBps < query.minimumConfidenceBps)) return false;
        return true;
      }));
    }
    const currentIds = allowedIds(current, to);
    const previousIds = allowedIds(previousOverview, prior.to);
    const currentTotals = totals(current, currentIds);
    const previousTotals = totals(previousOverview, previousIds);
    function groupIds(ids: ReadonlySet<string>, mode: "STATE" | "TERRITORY", at: Date) {
      const grouped = new Map<string, { label: string; stateCode: string | null; territoryId: string | null; ids: Set<string> }>();
      for (const id of ids) {
        const profile = profileById.get(id);
        if (mode === "STATE") {
          const stateCode = profile?.location.stateCode ?? null;
          const key = stateCode ?? "SEM_LOCALIZACAO";
          const row = grouped.get(key) ?? { label: stateCode ?? "Sem localização", stateCode, territoryId: null, ids: new Set<string>() };
          row.ids.add(id); grouped.set(key, row); continue;
        }
        const membership = membershipAt(id, at);
        const territory = membership ? activeTerritoryById.get(membership.territoryId) : undefined;
        if (!territory) continue;
        const row = grouped.get(territory.id) ?? { label: territory.name, stateCode: territory.stateCode, territoryId: territory.id, ids: new Set<string>() };
        row.ids.add(id); grouped.set(territory.id, row);
      }
      return grouped;
    }
    function present(mode: "STATE" | "TERRITORY"): RegionRow[] {
      const currentGroups = groupIds(currentIds, mode, to);
      const previousGroups = groupIds(previousIds, mode, prior.to);
      return [...new Set([...currentGroups.keys(), ...previousGroups.keys()])].map((key) => {
        const currentGroup = currentGroups.get(key); const previousGroup = previousGroups.get(key); const descriptor = currentGroup ?? previousGroup!;
        const sample = currentGroup?.ids.size ?? 0; const belowMinimum = sample < GEOGRAPHY_MINIMUM_GROUP_SIZE;
        const currentValue = currentGroup ? totals(current, currentGroup.ids) : totals(current, new Set());
        const previousValue = previousGroup ? totals(previousOverview, previousGroup.ids) : totals(previousOverview, new Set());
        const selected = belowMinimum ? null : selectedValue(query.metric, currentValue);
        const previousSelected = previousGroup && previousGroup.ids.size >= GEOGRAPHY_MINIMUM_GROUP_SIZE ? selectedValue(query.metric, previousValue) : null;
        return { key, label: descriptor.label, stateCode: descriptor.stateCode, territoryId: descriptor.territoryId, sampleSize: belowMinimum ? null : sample, belowMinimum, totals: belowMinimum ? null : currentValue, previousTotals: previousGroup && previousGroup.ids.size >= GEOGRAPHY_MINIMUM_GROUP_SIZE ? previousValue : null, value: selected, previousValue: previousSelected, comparison: compare(selected, previousSelected), drilldownUrl: drilldownUrl(descriptor.stateCode, from, to) };
      }).sort((left, right) => (right.value ?? -1) - (left.value ?? -1) || left.label.localeCompare(right.label, "pt-BR"));
    }
    const regions = present("STATE"); const territoryRows = present("TERRITORY");
    const located = [...currentIds].filter((id) => profileById.has(id)).length;
    const openIssues = currentIds.size ? await options.database.geographicDataIssue.count({ where: { workspaceId: context.workspaceId, status: "OPEN", targetType: "LEAD", targetId: { in: [...currentIds] } } }) : 0;
    const selectedLeads = [...currentIds].flatMap((id) => leadById.get(id) ? [leadById.get(id)!] : []);
    const sourceIds = [...new Set(selectedLeads.map((lead) => lead.latestSourceId ?? lead.sourceId))];
    const campaignIds = [...new Set(selectedLeads.flatMap((lead) => lead.latestCampaignId ?? lead.campaignId ? [lead.latestCampaignId ?? lead.campaignId!] : []))];
    const creativeIds = [...new Set(selectedLeads.flatMap((lead) => lead.latestCreativeId ?? lead.creativeId ? [lead.latestCreativeId ?? lead.creativeId!] : []))];
    const [sources, campaigns, creatives, stages, members, teams] = await Promise.all([
      options.database.leadSource.findMany({ where: { workspaceId: context.workspaceId, id: { in: sourceIds } }, select: { id: true, name: true } }),
      options.database.acquisitionCampaign.findMany({ where: { workspaceId: context.workspaceId, id: { in: campaignIds } }, select: { id: true, name: true } }),
      options.database.acquisitionCreative.findMany({ where: { workspaceId: context.workspaceId, id: { in: creativeIds } }, select: { id: true, name: true } }),
      options.database.pipelineStage.findMany({ where: { workspaceId: context.workspaceId }, select: { id: true, name: true }, orderBy: { position: "asc" } }),
      options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, id: { in: [...new Set(selectedLeads.flatMap((lead) => lead.ownerMemberId ? [lead.ownerMemberId] : []))] } }, select: { id: true, user: { select: { displayName: true } } } }),
      options.database.team.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    const sourceName = new Map(sources.map((row) => [row.id, row.name])); const campaignName = new Map(campaigns.map((row) => [row.id, row.name])); const creativeName = new Map(creatives.map((row) => [row.id, row.name]));
    function acquisition(key: "source" | "campaign" | "creative") {
      const grouped = new Map<string, number>();
      for (const lead of selectedLeads) {
        const id = key === "source" ? lead.latestSourceId ?? lead.sourceId : key === "campaign" ? lead.latestCampaignId ?? lead.campaignId : lead.latestCreativeId ?? lead.creativeId;
        if (id) grouped.set(id, (grouped.get(id) ?? 0) + 1);
      }
      const names = key === "source" ? sourceName : key === "campaign" ? campaignName : creativeName;
      return [...grouped].map(([id, count]) => ({ id, name: names.get(id) ?? "Definição indisponível", count: count < GEOGRAPHY_MINIMUM_GROUP_SIZE ? null : count, belowMinimum: count < GEOGRAPHY_MINIMUM_GROUP_SIZE })).sort((left, right) => (right.count ?? -1) - (left.count ?? -1) || left.name.localeCompare(right.name, "pt-BR")).slice(0, 8);
    }
    const canManage = await options.authorization.assertAuthorized(context, PermissionKeys.GEOGRAPHY_MANAGE, resource(context.workspaceId)).then(() => true).catch(() => false);
    const canBackfill = await options.authorization.assertAuthorized(context, PermissionKeys.GEOGRAPHY_BACKFILL, resource(context.workspaceId)).then(() => true).catch(() => false);
    return {
      period: { from: from.toISOString(), to: to.toISOString(), timeZone: "America/Sao_Paulo" as const }, previousPeriod: { from: prior.from.toISOString(), to: prior.to.toISOString() },
      query, metric: query.metric, minimumGroupSize: GEOGRAPHY_MINIMUM_GROUP_SIZE,
      summary: { ...currentTotals, located, withoutLocation: Math.max(0, currentIds.size - located), coverageBps: coverage(currentIds.size, located), openIssues },
      comparison: { leads: compare(currentTotals.leads, previousTotals.leads), wins: compare(currentTotals.wins, previousTotals.wins), revenueCents: compare(Number(currentTotals.revenueCents), Number(previousTotals.revenueCents)), conversionBps: compare(currentTotals.conversionBps, previousTotals.conversionBps), humanSlaSeconds: compare(currentTotals.medianSlaSeconds, previousTotals.medianSlaSeconds) },
      funnel: currentTotals, previousFunnel: previousTotals, regions, territories: territoryRows,
      territoryDefinitions: territories.map((territory) => ({ id: territory.id, code: territory.code, name: territory.name, type: territory.type, status: territory.status, version: territory.version, priority: territory.priority, countryCode: territory.countryCode, stateCode: territory.stateCode, effectiveFrom: territory.effectiveFrom.toISOString(), effectiveTo: territory.effectiveTo?.toISOString() ?? null })),
      acquisition: { sources: acquisition("source"), campaigns: acquisition("campaign"), creatives: acquisition("creative") },
      filters: { sources, campaigns, creatives, stages, members: members.map((member) => ({ id: member.id, name: member.user.displayName })), teams, territories: activeTerritories.map((territory) => ({ id: territory.id, name: `${territory.name} · v${territory.version}` })) },
      permissions: { canManage, canBackfill }, unavailableMetrics: ["CPL", "CAC", "ROAS"] as const,
      externalGeocoding: "DEFERRED" as const, generatedAt: now.toISOString(),
    };
  }

  async function recordObservation(context: AuthenticatedContext, input: unknown) {
    await assertManage(context); const parsed = observationSchema.safeParse(input); if (!parsed.success) invalid("Observação geográfica inválida.");
    const normalized = normalizeLocation(parsed.data.location); const now = options.now(); const observedAt = new Date(parsed.data.observedAt);
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`geo-observation:${context.workspaceId}:${parsed.data.targetType}:${parsed.data.targetId}`}, 0))`;
      const targetExists = parsed.data.targetType === "CONTACT" ? await transaction.contact.count({ where: { workspaceId: context.workspaceId, id: parsed.data.targetId, deletedAt: null } }) : parsed.data.targetType === "ACCOUNT" ? await transaction.account.count({ where: { workspaceId: context.workspaceId, id: parsed.data.targetId, deletedAt: null } }) : parsed.data.targetType === "LEAD" ? await transaction.lead.count({ where: { workspaceId: context.workspaceId, id: parsed.data.targetId, deletedAt: null } }) : parsed.data.targetType === "TOUCHPOINT" ? await transaction.marketingTouchpoint.count({ where: { workspaceId: context.workspaceId, id: parsed.data.targetId } }) : await transaction.attributionConversion.count({ where: { workspaceId: context.workspaceId, id: parsed.data.targetId, status: "ACTIVE" } });
      if (targetExists !== 1) throw new ApplicationError("Alvo geográfico não encontrado no workspace.", { code: "GEOGRAPHIC_TARGET_NOT_FOUND", statusCode: 404, expose: true });
      const replay = await transaction.geographicObservation.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
      if (replay) return { observationId: replay.id, idempotentReplay: true, reviewRequired: replay.verificationStatus === "NEEDS_REVIEW" };
      const profile = await transaction.geographicProfile.findUnique({ where: { workspaceId_targetType_targetId: { workspaceId: context.workspaceId, targetType: parsed.data.targetType, targetId: parsed.data.targetId } } });
      if (parsed.data.expectedRevision !== undefined && profile?.revision !== parsed.data.expectedRevision) throw new ApplicationError("A localização foi alterada por outra pessoa.", { code: "CONFLICT", statusCode: 409, expose: true });
      let location = await transaction.geographicLocation.findUnique({ where: { workspaceId_canonicalKey_version: { workspaceId: context.workspaceId, canonicalKey: normalized.canonicalKey, version: 1 } } });
      location ??= await transaction.geographicLocation.create({ data: { workspaceId: context.workspaceId, countryCode: normalized.countryCode, stateCode: normalized.stateCode, city: normalized.city, normalizedCity: normalized.normalizedCity, officialCityCode: normalized.officialCityCode, postalPrefix: normalized.postalPrefix, latitude: normalized.latitude, longitude: normalized.longitude, precision: normalized.precision, sourceType: normalized.sourceType, confidenceBps: normalized.confidenceBps, verificationStatus: normalized.verificationStatus, canonicalKey: normalized.canonicalKey } });
      const conflict = Boolean(profile && profile.locationId !== location.id);
      const observation = await transaction.geographicObservation.create({ data: { workspaceId: context.workspaceId, targetType: parsed.data.targetType, targetId: parsed.data.targetId, locationId: location.id, sourceType: normalized.sourceType, sourceRecordId: parsed.data.sourceRecordId ?? null, evidenceClass: normalized.evidenceClass, confidenceBps: normalized.confidenceBps, precision: normalized.precision, verificationStatus: conflict ? "NEEDS_REVIEW" : normalized.verificationStatus, observedAt, ingestedAt: now, validFrom: observedAt, supersedesObservationId: profile?.currentObservationId ?? null, evidence: safeEvidence(parsed.data.evidence), idempotencyKey: parsed.data.idempotencyKey, createdByActorId: context.actorId } });
      if (conflict) await transaction.geographicDataIssue.create({ data: { workspaceId: context.workspaceId, targetType: parsed.data.targetType, targetId: parsed.data.targetId, issueCode: "CONFLICTING_LOCATION", severity: "WARNING", observationIds: [profile!.currentObservationId, observation.id], safeEvidence: { previousLocationId: profile!.locationId, candidateLocationId: location.id } } });
      else await transaction.geographicProfile.upsert({ where: { workspaceId_targetType_targetId: { workspaceId: context.workspaceId, targetType: parsed.data.targetType, targetId: parsed.data.targetId } }, create: { workspaceId: context.workspaceId, targetType: parsed.data.targetType, targetId: parsed.data.targetId, currentObservationId: observation.id, locationId: location.id, evidenceClass: normalized.evidenceClass, precision: normalized.precision, confidenceBps: normalized.confidenceBps, verificationStatus: normalized.verificationStatus, updatedByActorId: context.actorId }, update: { currentObservationId: observation.id, locationId: location.id, evidenceClass: normalized.evidenceClass, precision: normalized.precision, confidenceBps: normalized.confidenceBps, verificationStatus: normalized.verificationStatus, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: conflict ? "geography.observation.review_requested" : "geography.observation.recorded", entityType: "GeographicObservation", entityId: observation.id, requestId: parsed.data.idempotencyKey, changes: { targetType: parsed.data.targetType, targetId: parsed.data.targetId, evidenceClass: normalized.evidenceClass, precision: normalized.precision, verificationStatus: observation.verificationStatus, conflict, coordinatesPresent: normalized.latitude !== null } } });
      return { observationId: observation.id, idempotentReplay: false, reviewRequired: conflict };
    }, { isolationLevel: "Serializable" });
  }

  async function previewTerritory(context: AuthenticatedContext, input: unknown) {
    await assertManage(context); const parsed = territoryInputSchema.safeParse(input); if (!parsed.success) invalid("Regra territorial inválida.");
    const normalizedCity = parsed.data.city ? normalizeLocation({ countryCode: parsed.data.countryCode ?? "BR", stateCode: parsed.data.stateCode, city: parsed.data.city, precision: "CITY", sourceType: "MANUAL_CONFIRMED", evidenceClass: "USER_CONFIRMED", confidenceBps: 10_000, verified: true }).normalizedCity : null;
    const candidate = { ...parsed.data, countryCode: parsed.data.countryCode?.toUpperCase() ?? null, stateCode: parsed.data.stateCode?.toUpperCase() ?? null, normalizedCity, postalPrefix: parsed.data.postalPrefix ?? null, polygon: parsed.data.polygon ?? null } as unknown as Territory;
    const [locations, active] = await Promise.all([options.database.geographicLocation.findMany({ where: { workspaceId: context.workspaceId } }), options.database.territory.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE" }, orderBy: [{ priority: "desc" }, { code: "asc" }] })]);
    const affected = locations.filter((location) => territoryMatches(candidate, location)); const overlapMap = new Map<string, Territory>();
    for (const location of affected) for (const territory of active) if (territory.code !== parsed.data.code && territoryMatches(territory, location)) overlapMap.set(territory.id, territory);
    const overlaps = [...overlapMap.values()].map((territory) => ({ id: territory.id, code: territory.code, name: territory.name, version: territory.version, priority: territory.priority }));
    const affectedProfiles = affected.length ? await options.database.geographicProfile.count({ where: { workspaceId: context.workspaceId, locationId: { in: affected.map((location) => location.id) } } }) : 0;
    return { affectedLocations: affected.length, affectedProfiles, overlaps, ambiguous: overlaps.some((territory) => territory.priority === parsed.data.priority), ruleHash: hashTerritoryRule(parsed.data), automaticOwnershipChange: false };
  }

  async function publishTerritory(context: AuthenticatedContext, input: unknown) {
    await assertManage(context); const parsed = territoryInputSchema.safeParse(input); if (!parsed.success) invalid("Regra territorial inválida.");
    const preview = await previewTerritory(context, parsed.data); if (preview.ambiguous) throw new ApplicationError("A regra possui sobreposição na mesma prioridade e exige ajuste.", { code: "TERRITORY_AMBIGUOUS", statusCode: 409, expose: true });
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`territory:${context.workspaceId}:${parsed.data.code}`}, 0))`;
      const latest = await transaction.territory.findFirst({ where: { workspaceId: context.workspaceId, code: parsed.data.code }, orderBy: { version: "desc" } }); const version = (latest?.version ?? 0) + 1;
      const normalizedCity = parsed.data.city ? normalizeLocation({ countryCode: parsed.data.countryCode ?? "BR", stateCode: parsed.data.stateCode, city: parsed.data.city, precision: "CITY", sourceType: "MANUAL_CONFIRMED", evidenceClass: "USER_CONFIRMED", confidenceBps: 10_000, verified: true }).normalizedCity : null;
      const territory = await transaction.territory.create({ data: { workspaceId: context.workspaceId, code: parsed.data.code, name: parsed.data.name, type: parsed.data.type, status: "ACTIVE", version, priority: parsed.data.priority, countryCode: parsed.data.countryCode?.toUpperCase() ?? null, stateCode: parsed.data.stateCode?.toUpperCase() ?? null, normalizedCity, postalPrefix: parsed.data.postalPrefix ?? null, polygon: parsed.data.polygon ? json(parsed.data.polygon) : Prisma.JsonNull, polygonVertexCount: parsed.data.polygon?.coordinates.reduce((total, ring) => total + ring.length, 0) ?? null, ownerTeamId: parsed.data.ownerTeamId ?? null, timeZone: parsed.data.timeZone ?? null, effectiveFrom: new Date(parsed.data.effectiveFrom), effectiveTo: parsed.data.effectiveTo ? new Date(parsed.data.effectiveTo) : null, ruleHash: preview.ruleHash, reason: parsed.data.reason, createdByActorId: context.actorId } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "geography.territory.published", entityType: "Territory", entityId: territory.id, reason: parsed.data.reason, changes: { code: territory.code, version, priority: territory.priority, affectedProfiles: preview.affectedProfiles, automaticOwnershipChange: false } } });
      return { territory, preview };
    }, { isolationLevel: "Serializable" });
  }

  async function setTerritoryStatus(context: AuthenticatedContext, input: unknown) {
    const parsed = territoryStatusSchema.safeParse(input); if (!parsed.success) invalid("Alteração territorial inválida."); await assertManage(context, parsed.data.territoryId);
    return options.database.$transaction(async (transaction) => {
      const existing = await transaction.territory.findFirst({ where: { id: parsed.data.territoryId, workspaceId: context.workspaceId } });
      if (!existing) throw new ApplicationError("Território não encontrado.", { code: "TERRITORY_NOT_FOUND", statusCode: 404, expose: true });
      if (existing.status === parsed.data.status) return { territory: existing, changed: false };
      const territory = await transaction.territory.update({ where: { id: existing.id }, data: { status: parsed.data.status } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "geography.territory.inactivated", entityType: "Territory", entityId: territory.id, reason: parsed.data.reason, changes: { before: existing.status, after: territory.status, code: territory.code, version: territory.version } } });
      return { territory, changed: true };
    }, { isolationLevel: "Serializable" });
  }

  async function resolveTerritory(context: AuthenticatedContext, input: unknown) {
    await assertManage(context); const parsed = resolveSchema.safeParse(input); if (!parsed.success) invalid("Resolução territorial inválida."); if (parsed.data.overrideTerritoryId && !parsed.data.reason) invalid("Override exige motivo."); const at = parsed.data.at ? new Date(parsed.data.at) : options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`territory-resolve:${context.workspaceId}:${parsed.data.targetType}:${parsed.data.targetId}`}, 0))`;
      const replay = await transaction.territoryMembership.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } }); if (replay) return { membership: replay, idempotentReplay: true, conflict: false };
      const profile = await transaction.geographicProfile.findUnique({ where: { workspaceId_targetType_targetId: { workspaceId: context.workspaceId, targetType: parsed.data.targetType, targetId: parsed.data.targetId } }, include: { location: true } }); if (!profile) throw new ApplicationError("O alvo não possui localização canônica.", { code: "LOCATION_NOT_FOUND", statusCode: 404, expose: true });
      let candidates = await transaction.territory.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: [{ priority: "desc" }, { version: "desc" }, { code: "asc" }] }); candidates = candidates.filter((territory) => territoryMatches(territory, profile.location));
      let selected: Territory | undefined; let override = false;
      if (parsed.data.overrideTerritoryId) { selected = await transaction.territory.findFirst({ where: { id: parsed.data.overrideTerritoryId, workspaceId: context.workspaceId, status: "ACTIVE" } }) ?? undefined; if (!selected) throw new ApplicationError("Território de override não encontrado ou inativo.", { code: "TERRITORY_NOT_FOUND", statusCode: 404, expose: true }); override = true; }
      else { selected = candidates[0]; if (selected && candidates[1]?.priority === selected.priority && candidates[1].code !== selected.code) return { membership: null, idempotentReplay: false, conflict: true, candidates: candidates.slice(0, 5).map((territory) => ({ id: territory.id, name: territory.name, priority: territory.priority })) }; }
      if (!selected) return { membership: null, idempotentReplay: false, conflict: false, candidates: [] };
      const membership = await transaction.territoryMembership.create({ data: { workspaceId: context.workspaceId, targetType: parsed.data.targetType, targetId: parsed.data.targetId, locationId: profile.locationId, territoryId: selected.id, territoryVersion: selected.version, matchType: override ? "MANUAL_OVERRIDE" : matchType(selected.type), confidenceBps: override ? 10_000 : profile.confidenceBps, verificationStatus: override ? "VERIFIED" : profile.verificationStatus, validFrom: at, ruleHash: selected.ruleHash, evidence: { ruleVersion: selected.version, locationPrecision: profile.precision }, overrideReason: parsed.data.reason ?? null, idempotencyKey: parsed.data.idempotencyKey, createdByActorId: context.actorId } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: override ? "geography.territory.overridden" : "geography.territory.resolved", entityType: "TerritoryMembership", entityId: membership.id, reason: parsed.data.reason ?? null, requestId: parsed.data.idempotencyKey, changes: { targetType: parsed.data.targetType, targetId: parsed.data.targetId, territoryId: selected.id, territoryVersion: selected.version, ownerChanged: false } } });
      return { membership, idempotentReplay: false, conflict: false };
    }, { isolationLevel: "Serializable" });
  }

  async function runBackfill(context: AuthenticatedContext, input: unknown) {
    await assertBackfill(context); const parsed = backfillSchema.safeParse(input); if (!parsed.success) invalid("Backfill geográfico inválido."); const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`geo-backfill:${context.workspaceId}`}, 0))`;
      const replay = await transaction.geographicBackfillRun.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } }); if (replay) return { ...replay, membershipsCreated: 0, idempotentReplay: true };
      const leads = await transaction.lead.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, city: true, stateCode: true, createdAt: true } });
      const activeTerritories = await transaction.territory.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] }, orderBy: [{ priority: "desc" }, { version: "desc" }, { code: "asc" }] });
      let valid = 0; let incomplete = 0; let conflicts = 0; let created = 0; let existing = 0; let noLocation = 0; let membershipsCreated = 0;
      const run = await transaction.geographicBackfillRun.create({ data: { workspaceId: context.workspaceId, mode: parsed.data.mode, status: "RUNNING", ruleVersion: GEOGRAPHY_RULE_VERSION, idempotencyKey: parsed.data.idempotencyKey, eligibleCount: leads.length, requestedByActorId: context.actorId, startedAt: now } });
      for (const lead of leads) {
        if (!lead.city && !lead.stateCode) { noLocation += 1; if (parsed.data.mode === "EXECUTE") await transaction.geographicBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, leadId: lead.id, outcome: "SKIPPED", reasonCode: "NO_EXPLICIT_LOCATION" } }); continue; }
        let normalized: ReturnType<typeof normalizeLocation>;
        try { normalized = normalizeLocation({ countryCode: "BR", stateCode: lead.stateCode ?? undefined, city: lead.city ?? undefined, precision: lead.city ? "CITY" : "STATE", sourceType: "LEAD_LEGACY", evidenceClass: "FACT", confidenceBps: lead.city ? 8_500 : 7_500, verified: false }); valid += 1; }
        catch { incomplete += 1; if (parsed.data.mode === "EXECUTE") await transaction.geographicBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, leadId: lead.id, outcome: "REVIEW", reasonCode: "INCOMPLETE_OR_INVALID" } }); continue; }
        const profile = await transaction.geographicProfile.findUnique({ where: { workspaceId_targetType_targetId: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: lead.id } }, include: { location: true } });
        if (profile && profile.location.canonicalKey !== normalized.canonicalKey) {
          conflicts += 1;
          if (parsed.data.mode === "EXECUTE") { const issue = await transaction.geographicDataIssue.findFirst({ where: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: lead.id, issueCode: "BACKFILL_LOCATION_CONFLICT", status: "OPEN" } }); if (!issue) await transaction.geographicDataIssue.create({ data: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: lead.id, issueCode: "BACKFILL_LOCATION_CONFLICT", severity: "WARNING", observationIds: [profile.currentObservationId], safeEvidence: { existingLocationId: profile.locationId, legacyCanonicalHash: hashTerritoryRule(normalized.canonicalKey) } } }); await transaction.geographicBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, leadId: lead.id, outcome: "REVIEW", reasonCode: "CONFLICTING_EXISTING_PROFILE", locationId: profile.locationId } }); }
          continue;
        }
        if (profile) existing += 1;
        if (parsed.data.mode === "DRY_RUN") continue;
        let resolvedProfile = profile;
        if (!resolvedProfile) {
          let location = await transaction.geographicLocation.findUnique({ where: { workspaceId_canonicalKey_version: { workspaceId: context.workspaceId, canonicalKey: normalized.canonicalKey, version: 1 } } });
          location ??= await transaction.geographicLocation.create({ data: { workspaceId: context.workspaceId, countryCode: normalized.countryCode, stateCode: normalized.stateCode, city: normalized.city, normalizedCity: normalized.normalizedCity, officialCityCode: null, postalPrefix: null, latitude: null, longitude: null, precision: normalized.precision, sourceType: "LEAD_LEGACY", confidenceBps: normalized.confidenceBps, verificationStatus: "UNVERIFIED", canonicalKey: normalized.canonicalKey } });
          const observation = await transaction.geographicObservation.create({ data: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: lead.id, locationId: location.id, sourceType: "LEAD_LEGACY", sourceRecordId: lead.id, evidenceClass: "FACT", confidenceBps: normalized.confidenceBps, precision: normalized.precision, verificationStatus: "UNVERIFIED", observedAt: lead.createdAt, ingestedAt: now, validFrom: lead.createdAt, evidence: { fields: ["city", "stateCode"], coordinatesCreated: false }, idempotencyKey: `geo-backfill:${GEOGRAPHY_RULE_VERSION}:${lead.id}`, createdByActorId: context.actorId } });
          resolvedProfile = await transaction.geographicProfile.create({ data: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: lead.id, currentObservationId: observation.id, locationId: location.id, evidenceClass: "FACT", precision: normalized.precision, confidenceBps: normalized.confidenceBps, verificationStatus: "UNVERIFIED", updatedByActorId: context.actorId }, include: { location: true } });
          await transaction.geographicBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, leadId: lead.id, outcome: "CREATED", reasonCode: "EXPLICIT_LEGACY_LOCATION", locationId: location.id } }); created += 1;
        } else await transaction.geographicBackfillItem.create({ data: { workspaceId: context.workspaceId, runId: run.id, leadId: lead.id, outcome: "EXISTING", reasonCode: "CANONICAL_PROFILE_PRESENT", locationId: resolvedProfile.locationId } });
        const candidates = activeTerritories.filter((territory) => territoryMatches(territory, resolvedProfile!.location)); const selected = candidates[0]; const ambiguous = selected && candidates[1]?.priority === selected.priority && candidates[1].code !== selected.code;
        if (selected && !ambiguous) {
          const membershipKey = `geo-backfill-membership:${GEOGRAPHY_RULE_VERSION}:${lead.id}:${selected.id}:${selected.version}`;
          const membership = await transaction.territoryMembership.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: membershipKey } } });
          if (!membership) { await transaction.territoryMembership.create({ data: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: lead.id, locationId: resolvedProfile.locationId, territoryId: selected.id, territoryVersion: selected.version, matchType: matchType(selected.type), confidenceBps: resolvedProfile.confidenceBps, verificationStatus: resolvedProfile.verificationStatus, validFrom: now, ruleHash: selected.ruleHash, evidence: { ruleVersion: selected.version, source: "CRM42_BACKFILL", ownerChanged: false }, idempotencyKey: membershipKey, createdByActorId: context.actorId } }); membershipsCreated += 1; }
        } else if (ambiguous) { conflicts += 1; const issue = await transaction.geographicDataIssue.findFirst({ where: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: lead.id, issueCode: "AMBIGUOUS_TERRITORY", status: "OPEN" } }); if (!issue) await transaction.geographicDataIssue.create({ data: { workspaceId: context.workspaceId, targetType: "LEAD", targetId: lead.id, issueCode: "AMBIGUOUS_TERRITORY", severity: "WARNING", observationIds: [resolvedProfile.currentObservationId], safeEvidence: { candidateTerritoryIds: candidates.slice(0, 5).map((territory) => territory.id) } } }); }
      }
      const finished = await transaction.geographicBackfillRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", validCount: valid, incompleteCount: incomplete, conflictCount: conflicts, createdCount: created, existingCount: existing, noLocationCount: noLocation, finishedAt: now } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: parsed.data.mode === "DRY_RUN" ? "geography.backfill.previewed" : "geography.backfill.executed", entityType: "GeographicBackfillRun", entityId: run.id, requestId: parsed.data.idempotencyKey, changes: { ruleVersion: GEOGRAPHY_RULE_VERSION, eligible: leads.length, valid, incomplete, conflicts, created, existing, noLocation, membershipsCreated, coordinatesCreated: false, ownerChanged: false } } });
      return { ...finished, membershipsCreated, idempotentReplay: false };
    }, { isolationLevel: "Serializable", timeout: 60_000 });
  }

  return Object.freeze({ getScreen, recordObservation, previewTerritory, publishTerritory, setTerritoryStatus, resolveTerritory, runBackfill });
}

let singleton: ReturnType<typeof createGeographicIntelligenceService> | undefined;
export function getGeographicIntelligenceService() {
  singleton ??= createGeographicIntelligenceService({ database: getDatabaseClient(), authorization: getAuthorizationService(), metrics: getMetricsService(), now: () => new Date() });
  return singleton;
}
