import { Prisma, type ForecastCycle, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { aggregateForecast, compareForecastItems, consolidateForecastSchema, createForecastCycleSchema, createForecastSubmissionSchema, forecastEligibility, forecastFingerprint, forecastQuerySchema, percentageDelta, type ForecastCategoryValue } from "@/modules/forecast/domain/forecast-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Options = { database: PrismaClient; authorization: ReturnType<typeof getAuthorizationService>; now: () => Date };
type OpportunityRow = Prisma.OpportunityGetPayload<{ include: { currentStage: true; product: { select: { availability: true } }; consultativeEvidence: { select: { id: true } }; owner: { include: { user: true; teamMemberships: { include: { team: true } } } } } }>;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const resource = (workspaceId: string, cycle?: Pick<ForecastCycle, "id" | "teamId">, memberId?: string | null) => ({ workspaceId, resourceType: "Forecast", ...(cycle ? { resourceId: cycle.id, teamId: cycle.teamId } : {}), ...(memberId !== undefined ? { memberId } : {}) });
function invalid(message: string, code = "INVALID_FORECAST", statusCode = 400): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
function missing(): never { invalid("Ciclo ou snapshot de forecast não encontrado.", "FORECAST_NOT_FOUND", 404); }

async function serializable<T>(database: PrismaClient, operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try { return await database.$transaction(operation, { isolationLevel: "Serializable" }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") || attempt === 4) throw error;
    }
  }
  throw new Error("Limite de retry serializável atingido.");
}

function opportunityTeam(row: OpportunityRow, preferredTeamId?: string | null) {
  return row.owner.teamMemberships.find((item) => !item.deletedAt && (!preferredTeamId || item.teamId === preferredTeamId)) ?? row.owner.teamMemberships.find((item) => !item.deletedAt) ?? null;
}

function snapshotBase(row: OpportunityRow, preferredTeamId?: string | null) {
  const membership = opportunityTeam(row, preferredTeamId);
  const validProbability = row.probabilityBps >= 0 && row.probabilityBps <= 10_000;
  return {
    opportunityId: row.id, opportunityName: row.name, leadId: row.leadId, accountId: row.accountId,
    ownerMemberId: row.ownerMemberId, ownerLabel: row.owner.user.displayName,
    teamId: membership?.teamId ?? null, teamLabel: membership?.team.name ?? null,
    stageId: row.currentStageId, stageKey: row.currentStage.opportunityStageCode ?? row.currentStage.id, stageLabel: row.currentStage.name,
    status: row.status, amountCents: row.amountCents, currency: row.currency, expectedCloseAt: row.expectedCloseAt,
    probabilityBps: validProbability ? row.probabilityBps : null,
    probabilitySource: validProbability ? "OPPORTUNITY_MANUAL" : null,
    probabilityActorId: validProbability ? row.updatedByActorId : null,
    probabilityRecordedAt: validProbability ? row.updatedAt : null,
    opportunityRevision: row.revision, opportunityUpdatedAt: row.updatedAt,
  };
}

export function createForecastService(options: Options) {
  async function authorize(context: AuthenticatedContext, permission: PermissionKey, cycle?: ForecastCycle, memberId?: string | null) {
    await options.authorization.assertAuthorized(context, permission, resource(context.workspaceId, cycle, memberId));
  }

  async function cycleMemberIds(context: AuthenticatedContext, cycle: ForecastCycle, targetMemberId?: string | null, permission: PermissionKey = PermissionKeys.FORECAST_READ) {
    const decision = await options.authorization.authorize(context, permission, resource(context.workspaceId, cycle, targetMemberId ?? context.memberId));
    if (!decision.allowed) { await authorize(context, permission, cycle, targetMemberId ?? context.memberId); return []; }
    if (targetMemberId) {
      const exists = await options.database.workspaceMember.findFirst({ where: { id: targetMemberId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true } });
      if (!exists) invalid("Pessoa fora do workspace ou inativa.", "FORECAST_TARGET_INVALID");
      if (decision.scope !== "WORKSPACE" && targetMemberId !== context.memberId) await authorize(context, permission, cycle, targetMemberId);
      return [targetMemberId];
    }
    if (decision.scope === "OWN") return [context.memberId];
    if (cycle.scopeType === "TEAM" && cycle.teamId) return (await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, teamId: cycle.teamId, deletedAt: null, member: { status: "ACTIVE", deletedAt: null } }, select: { workspaceMemberId: true } })).map((item) => item.workspaceMemberId);
    if (cycle.scopeType === "FUNCTION" && cycle.function) {
      const [ownership, team] = await Promise.all([
        options.database.ownershipAssignment.findMany({ where: { workspaceId: context.workspaceId, function: cycle.function, status: "ACTIVE", memberId: { not: null } }, select: { memberId: true } }),
        cycle.function === "SDR" || cycle.function === "CLOSER" ? options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, function: cycle.function, deletedAt: null }, select: { workspaceMemberId: true } }) : Promise.resolve([]),
      ]);
      return [...new Set([...ownership.flatMap((item) => item.memberId ? [item.memberId] : []), ...team.map((item) => item.workspaceMemberId)])];
    }
    return (await options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true } })).map((item) => item.id);
  }

  async function loadCycle(context: AuthenticatedContext, cycleId: string, permission: PermissionKey = PermissionKeys.FORECAST_READ) {
    const cycle = await options.database.forecastCycle.findFirst({ where: { id: cycleId, workspaceId: context.workspaceId } });
    if (!cycle) missing();
    await authorize(context, permission, cycle, context.memberId);
    return cycle;
  }

  async function opportunityRows(workspaceId: string, memberIds: readonly string[]) {
    if (memberIds.length === 0) return [];
    return options.database.opportunity.findMany({ where: { workspaceId, ownerMemberId: { in: [...memberIds] }, deletedAt: null }, include: { currentStage: true, product: { select: { availability: true } }, consultativeEvidence: { where: { supersededAt: null }, select: { id: true } }, owner: { include: { user: true, teamMemberships: { where: { deletedAt: null }, include: { team: true } } } } }, orderBy: [{ expectedCloseAt: "asc" }, { id: "asc" }] });
  }

  async function createCycle(context: AuthenticatedContext, raw: unknown) {
    const input = createForecastCycleSchema.parse(raw);
    await authorize(context, PermissionKeys.FORECAST_MANAGE);
    if (input.goalPlanId) {
      const plan = await options.database.goalPlan.findFirst({ where: { id: input.goalPlanId, workspaceId: context.workspaceId, status: "PUBLISHED" } });
      if (!plan) invalid("O ciclo só pode vincular um plano de metas publicado.", "FORECAST_GOAL_PLAN_INVALID");
      if (plan.periodStart.getTime() !== input.periodStart.getTime() || plan.periodEnd.getTime() !== input.periodEnd.getTime() || plan.timeZone !== input.timeZone) invalid("Período e timezone devem coincidir com o plano publicado.", "FORECAST_GOAL_PERIOD_MISMATCH");
    }
    if (input.scopeType === "TEAM") {
      const team = await options.database.team.findFirst({ where: { id: input.teamId!, workspaceId: context.workspaceId, deletedAt: null } });
      if (!team) invalid("Equipe não pertence ao workspace.", "FORECAST_TEAM_INVALID");
    }
    return serializable(options.database, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`crm56:${context.workspaceId}:${input.key}`}))::text`);
      const replay = await tx.forecastCycle.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } } });
      if (replay) return replay;
      const latest = await tx.forecastCycle.findFirst({ where: { workspaceId: context.workspaceId, key: input.key }, orderBy: { version: "desc" } });
      const cycle = await tx.forecastCycle.create({ data: { workspaceId: context.workspaceId, goalPlanId: input.goalPlanId ?? null, key: input.key, version: (latest?.version ?? 0) + 1, name: input.name, periodStart: input.periodStart, periodEnd: input.periodEnd, timeZone: input.timeZone, scopeType: input.scopeType, teamId: input.teamId ?? null, function: input.function ?? null, currency: input.currency, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "forecast.cycle.created", origin: "API", entityType: "ForecastCycle", entityId: cycle.id, changes: { key: cycle.key, version: cycle.version, periodStart: cycle.periodStart.toISOString(), periodEnd: cycle.periodEnd.toISOString(), timeZone: cycle.timeZone, scopeType: cycle.scopeType }, metadata: { idempotencyKey: input.idempotencyKey } } });
      return cycle;
    });
  }

  async function submit(context: AuthenticatedContext, raw: unknown) {
    const input = createForecastSubmissionSchema.parse(raw);
    const cycle = await loadCycle(context, input.cycleId, input.type === "MANAGER_OVERRIDE" ? PermissionKeys.FORECAST_OVERRIDE : PermissionKeys.FORECAST_SUBMIT);
    if (cycle.status !== "OPEN") invalid("O ciclo está fechado para novas submissões.", "FORECAST_CYCLE_CLOSED", 409);
    if (input.asOf < cycle.periodStart || input.asOf >= cycle.periodEnd) invalid("A data de corte deve pertencer ao ciclo.", "FORECAST_ASOF_OUTSIDE_CYCLE");
    const targetMemberId = input.type === "INDIVIDUAL" ? input.targetMemberId ?? context.memberId : null;
    if (input.type === "MANAGER_OVERRIDE" && input.targetTeamId !== cycle.teamId) invalid("Override deve usar a equipe do ciclo.", "FORECAST_OVERRIDE_TEAM_MISMATCH");
    const memberIds = input.type === "INDIVIDUAL" ? await cycleMemberIds(context, cycle, targetMemberId, PermissionKeys.FORECAST_SUBMIT) : await cycleMemberIds(context, cycle, null, PermissionKeys.FORECAST_OVERRIDE);
    const rows = await opportunityRows(context.workspaceId, memberIds);
    const selected = new Set(input.opportunityIds);
    if (selected.size !== input.opportunityIds.length) invalid("A mesma oportunidade não pode ser enviada duas vezes.", "FORECAST_DUPLICATE_OPPORTUNITY");
    const itemFacts = rows.map((row) => {
      const base = snapshotBase(row, cycle.teamId);
      const eligibility = forecastEligibility({ id: row.id, ...base, category: null, productAvailability: row.product?.availability ?? null, evidenceCount: row.consultativeEvidence.length }, { ...cycle, memberIds });
      const included = input.type === "INDIVIDUAL" && selected.has(row.id);
      if (included && !eligibility.eligible) invalid(`Oportunidade ${row.name} não é elegível: ${eligibility.reasonCode}.`, "FORECAST_OPPORTUNITY_INELIGIBLE");
      return { ...base, included, category: included ? input.category : null, exclusionReason: included ? null : eligibility.eligible ? "NOT_DECLARED_FOR_CATEGORY" : eligibility.reasonCode };
    });
    if ([...selected].some((id) => !rows.some((row) => row.id === id))) invalid("Uma oportunidade selecionada está fora do escopo.", "FORECAST_OPPORTUNITY_OUTSIDE_SCOPE", 403);
    const fingerprint = forecastFingerprint({ cycleId: cycle.id, type: input.type, category: input.category, declaredValueCents: input.declaredValueCents, asOf: input.asOf, items: itemFacts.map((item) => ({ id: item.opportunityId, included: item.included, category: item.category, amount: item.amountCents, revision: item.opportunityRevision })).sort((a, b) => a.id.localeCompare(b.id)) });
    return serializable(options.database, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`crm56:${context.workspaceId}:${cycle.id}:${context.memberId}:${input.category}:${input.type}`}))::text`);
      const replay = await tx.forecastSubmission.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } }, include: { items: true } });
      if (replay) return replay;
      const latest = await tx.forecastSubmission.findFirst({ where: { workspaceId: context.workspaceId, cycleId: cycle.id, authorMemberId: context.memberId, scopeType: input.type === "INDIVIDUAL" ? "MEMBER" : "TEAM", category: input.category }, orderBy: { version: "desc" } });
      if (latest && !input.correctionReason) invalid("Uma nova revisão exige motivo da correção.", "FORECAST_CORRECTION_REASON_REQUIRED");
      const submission = await tx.forecastSubmission.create({ data: { workspaceId: context.workspaceId, cycleId: cycle.id, authorMemberId: context.memberId, scopeType: input.type === "INDIVIDUAL" ? "MEMBER" : "TEAM", targetMemberId, targetTeamId: input.type === "MANAGER_OVERRIDE" ? input.targetTeamId ?? null : null, type: input.type, category: input.category, declaredValueCents: input.declaredValueCents, currency: cycle.currency, comment: input.comment ?? null, asOf: input.asOf, version: (latest?.version ?? 0) + 1, supersedesSubmissionId: latest?.id ?? null, correctionReason: latest ? input.correctionReason ?? null : null, fingerprint, idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, items: { create: itemFacts.map((item) => ({ cycleId: cycle.id, ...item })) } }, include: { items: true } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: input.type === "MANAGER_OVERRIDE" ? "forecast.override.submitted" : "forecast.submission.created", origin: "API", entityType: "ForecastSubmission", entityId: submission.id, changes: { cycleId: cycle.id, category: input.category, declaredValueCents: input.declaredValueCents.toString(), version: submission.version, supersedesSubmissionId: submission.supersedesSubmissionId, fingerprint }, metadata: { idempotencyKey: input.idempotencyKey, selectedCount: selected.size } } });
      return submission;
    });
  }

  async function realizedAndGoal(context: AuthenticatedContext, cycle: ForecastCycle, memberIds: readonly string[], asOf: Date) {
    const won = await options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, ownerMemberId: { in: [...memberIds] }, status: "WON", closedAt: { gte: cycle.periodStart, lt: asOf < cycle.periodEnd ? asOf : cycle.periodEnd }, deletedAt: null, currency: cycle.currency }, select: { amountCents: true } });
    let goalTarget: bigint | null = null;
    if (cycle.goalPlanId) {
      const quotas = await options.database.goalQuota.findMany({ where: { workspaceId: context.workspaceId, planId: cycle.goalPlanId, metricKey: "REVENUE_WON_CENTS", currency: cycle.currency } });
      const exact = cycle.scopeType === "TEAM" ? quotas.find((quota) => quota.teamId === cycle.teamId) : cycle.scopeType === "FUNCTION" ? quotas.find((quota) => quota.function === cycle.function) : null;
      goalTarget = exact?.targetValue ?? null;
    }
    return { realizedCents: won.reduce((sum, item) => sum + item.amountCents, 0n), goalTargetCents: goalTarget };
  }

  async function consolidate(context: AuthenticatedContext, raw: unknown) {
    const input = consolidateForecastSchema.parse(raw);
    const cycle = await loadCycle(context, input.cycleId, PermissionKeys.FORECAST_CONSOLIDATE);
    if (input.asOf < cycle.periodStart || input.asOf >= cycle.periodEnd) invalid("A data de corte deve pertencer ao ciclo.", "FORECAST_ASOF_OUTSIDE_CYCLE");
    const memberIds = await cycleMemberIds(context, cycle, null, PermissionKeys.FORECAST_CONSOLIDATE);
    const rows = await opportunityRows(context.workspaceId, memberIds);
    const submissions = await options.database.forecastSubmission.findMany({ where: { workspaceId: context.workspaceId, cycleId: cycle.id, asOf: { lte: input.asOf } }, include: { items: true }, orderBy: [{ createdAt: "desc" }, { version: "desc" }] });
    const latestByStream = new Map<string, typeof submissions[number]>();
    for (const submission of submissions) {
      const key = `${submission.authorMemberId}:${submission.scopeType}:${submission.category}`;
      if (!latestByStream.has(key)) latestByStream.set(key, submission);
    }
    const latest = [...latestByStream.values()];
    const individual = latest.filter((item) => item.type === "INDIVIDUAL");
    const override = latest.find((item) => item.type === "MANAGER_OVERRIDE" && item.category === "COMMIT" && item.targetTeamId === cycle.teamId) ?? null;
    const items = rows.map((row) => {
      const base = snapshotBase(row, cycle.teamId);
      const eligibility = forecastEligibility({ id: row.id, ...base, category: null, productAvailability: row.product?.availability ?? null, evidenceCount: row.consultativeEvidence.length }, { ...cycle, memberIds });
      const source = individual.find((submission) => submission.items.some((item) => item.opportunityId === row.id && item.included));
      const category: ForecastCategoryValue | null = eligibility.eligible ? source?.category ?? "PIPELINE" : null;
      return { ...base, eligible: eligibility.eligible, category, reasonCode: eligibility.reasonCode, sourceSubmissionId: source?.id ?? null };
    });
    const aggregation = aggregateForecast(items.map((item) => ({ id: item.opportunityId, status: item.status, amountCents: item.amountCents, currency: item.currency, expectedCloseAt: item.expectedCloseAt, ownerMemberId: item.ownerMemberId, teamId: item.teamId, category: item.eligible ? item.category : null, probabilityBps: item.probabilityBps, probabilitySource: item.probabilitySource, probabilityActorId: item.probabilityActorId, probabilityRecordedAt: item.probabilityRecordedAt })));
    const bottomUpCommitCents = individual.filter((item) => item.category === "COMMIT" && item.targetMemberId && memberIds.includes(item.targetMemberId)).reduce((sum, item) => sum + item.declaredValueCents, 0n);
    const values = await realizedAndGoal(context, cycle, memberIds, input.asOf);
    const sourceSubmissionIds = latest.map((item) => item.id).sort();
    const scopeKey = cycle.scopeType === "WORKSPACE" ? "WORKSPACE" : cycle.scopeType === "TEAM" ? `TEAM:${cycle.teamId}` : `FUNCTION:${cycle.function}`;
    const fingerprint = forecastFingerprint({ cycleId: cycle.id, asOf: input.asOf, scopeKey, aggregation, values, bottomUpCommitCents, managerOverrideCents: override?.declaredValueCents ?? null, sourceSubmissionIds, items: items.map((item) => ({ id: item.opportunityId, eligible: item.eligible, category: item.category, reason: item.reasonCode, amount: item.amountCents, owner: item.ownerMemberId, team: item.teamId, stage: item.stageId, expected: item.expectedCloseAt, probability: item.probabilityBps, revision: item.opportunityRevision })).sort((a, b) => a.id.localeCompare(b.id)) });
    return serializable(options.database, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`crm56:${context.workspaceId}:${cycle.id}:snapshot`}))::text`);
      const replay = await tx.forecastSnapshot.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } }, include: { items: true } });
      if (replay) return replay;
      const last = await tx.forecastSnapshot.findFirst({ where: { workspaceId: context.workspaceId, cycleId: cycle.id }, orderBy: { sequence: "desc" }, select: { sequence: true } });
      const snapshot = await tx.forecastSnapshot.create({ data: { workspaceId: context.workspaceId, cycleId: cycle.id, sequence: (last?.sequence ?? 0) + 1, asOf: input.asOf, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd, timeZone: cycle.timeZone, scopeType: cycle.scopeType, scopeKey, teamId: cycle.teamId, function: cycle.function, currency: cycle.currency, ...values, ...aggregation, bottomUpCommitCents, managerOverrideCents: override?.declaredValueCents ?? null, managerOverrideId: override?.id ?? null, fingerprint, filters: json({ memberIds: [...memberIds].sort(), scopeKey }), sourceSubmissionIds: json(sourceSubmissionIds), idempotencyKey: input.idempotencyKey, createdByActorId: context.actorId, items: { create: items.map((item) => ({ cycleId: cycle.id, ...item })) } }, include: { items: true } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "forecast.snapshot.published", origin: "API", entityType: "ForecastSnapshot", entityId: snapshot.id, changes: { cycleId: cycle.id, sequence: snapshot.sequence, asOf: input.asOf.toISOString(), pipelineCents: snapshot.pipelineCents.toString(), bestCaseCents: snapshot.bestCaseCents.toString(), commitCents: snapshot.commitCents.toString(), fingerprint }, metadata: { idempotencyKey: input.idempotencyKey, sourceSubmissionIds } } });
      return snapshot;
    });
  }

  async function compare(context: AuthenticatedContext, fromSnapshotId: string, toSnapshotId: string) {
    const snapshots = await options.database.forecastSnapshot.findMany({ where: { workspaceId: context.workspaceId, id: { in: [fromSnapshotId, toSnapshotId] } }, include: { items: true, cycle: true } });
    const from = snapshots.find((item) => item.id === fromSnapshotId); const to = snapshots.find((item) => item.id === toSnapshotId);
    if (!from || !to) missing();
    if (from.cycleId !== to.cycleId || from.scopeKey !== to.scopeKey || from.currency !== to.currency || from.timeZone !== to.timeZone) invalid("Snapshots incompatíveis para comparação.", "FORECAST_COMPARISON_INCOMPATIBLE");
    await authorize(context, PermissionKeys.FORECAST_READ, from.cycle);
    const movements = compareForecastItems(from.items, to.items);
    const movementGroups = new Map<string, typeof movements>();
    for (const movement of movements) movementGroups.set(movement.type, [...(movementGroups.get(movement.type) ?? []), movement]);
    const grouped = [...movementGroups].map(([type, rows]) => ({ type, count: rows.length, deltaCents: rows.reduce((sum, item) => sum + item.deltaCents, 0n).toString(), opportunityIds: rows.map((item) => item.opportunityId), drilldownHref: `/oportunidades?ids=${rows.map((item) => item.opportunityId).join(",")}` }));
    return { from: { id: from.id, asOf: from.asOf.toISOString(), commitCents: from.commitCents.toString() }, to: { id: to.id, asOf: to.asOf.toISOString(), commitCents: to.commitCents.toString() }, commitDeltaCents: (to.commitCents - from.commitCents).toString(), commitDeltaBps: percentageDelta(to.commitCents, from.commitCents), movements: grouped };
  }

  async function screen(context: AuthenticatedContext, raw: unknown = {}) {
    const query = forecastQuerySchema.parse(raw);
    await authorize(context, PermissionKeys.FORECAST_READ, undefined, context.memberId);
    const allCycles = await options.database.forecastCycle.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ periodStart: "desc" }, { version: "desc" }] });
    const cycles: ForecastCycle[] = [];
    for (const cycle of allCycles) if ((await options.authorization.authorize(context, PermissionKeys.FORECAST_READ, resource(context.workspaceId, cycle, context.memberId))).allowed) cycles.push(cycle);
    const cycle = query.cycleId ? cycles.find((item) => item.id === query.cycleId) : cycles[0];
    if (!cycle) return { generatedAt: options.now().toISOString(), asOf: (query.asOf ?? options.now()).toISOString(), cycles: [], current: null, snapshots: [], candidates: [], submissions: [], comparison: null, permissions: { submit: false, consolidate: false, override: false, manage: false }, definitions: { categories: "Buckets exclusivos; best case é cumulativo com commit, sem dupla contagem.", weighted: "Somente probabilidade manual com ator e timestamp.", absence: "Zero, parcial e indisponível permanecem estados distintos." } };
    const asOf = query.asOf ?? options.now();
    const memberIds = await cycleMemberIds(context, cycle, query.memberId);
    const rows = await opportunityRows(context.workspaceId, memberIds);
    const candidates = rows.map((row) => { const base = snapshotBase(row, cycle.teamId); const eligibility = forecastEligibility({ id: row.id, ...base, category: null, productAvailability: row.product?.availability ?? null, evidenceCount: row.consultativeEvidence.length }, { ...cycle, memberIds }); return { ...base, amountCents: base.amountCents.toString(), expectedCloseAt: base.expectedCloseAt?.toISOString() ?? null, opportunityUpdatedAt: base.opportunityUpdatedAt.toISOString(), probabilityRecordedAt: base.probabilityRecordedAt?.toISOString() ?? null, eligible: eligibility.eligible, reasonCode: eligibility.reasonCode, drilldownHref: `/oportunidades?opportunityId=${row.id}` }; });
    const decision = await options.authorization.authorize(context, PermissionKeys.FORECAST_READ, resource(context.workspaceId, cycle, context.memberId));
    const canSeeAggregate = decision.allowed && decision.scope !== "OWN";
    const snapshots = canSeeAggregate
      ? await options.database.forecastSnapshot.findMany({ where: { workspaceId: context.workspaceId, cycleId: cycle.id }, orderBy: { sequence: "desc" }, take: 20 })
      : [];
    const current = snapshots[0] ?? null;
    const submissions = await options.database.forecastSubmission.findMany({ where: { workspaceId: context.workspaceId, cycleId: cycle.id, ...(decision.allowed && decision.scope === "WORKSPACE" ? {} : decision.allowed && decision.scope === "TEAM" ? { OR: [{ targetTeamId: cycle.teamId }, { targetMemberId: { in: memberIds } }] } : { targetMemberId: context.memberId }) }, orderBy: [{ createdAt: "desc" }, { version: "desc" }], take: 30 });
    const can = async (permission: PermissionKey) => (await options.authorization.authorize(context, permission, resource(context.workspaceId, cycle, context.memberId))).allowed;
    const permissions = { submit: await can(PermissionKeys.FORECAST_SUBMIT), consolidate: await can(PermissionKeys.FORECAST_CONSOLIDATE), override: await can(PermissionKeys.FORECAST_OVERRIDE), manage: await can(PermissionKeys.FORECAST_MANAGE) };
    const comparison = query.compareFromId && query.compareToId ? await compare(context, query.compareFromId, query.compareToId) : snapshots.length >= 2 ? await compare(context, snapshots[1]!.id, snapshots[0]!.id) : null;
    const serializeSnapshot = (item: typeof snapshots[number]) => ({ id: item.id, sequence: item.sequence, asOf: item.asOf.toISOString(), periodStart: item.periodStart.toISOString(), periodEnd: item.periodEnd.toISOString(), timeZone: item.timeZone, currency: item.currency, realizedCents: item.realizedCents.toString(), goalTargetCents: item.goalTargetCents?.toString() ?? null, pipelineCents: item.pipelineCents.toString(), bestCaseCents: item.bestCaseCents.toString(), commitCents: item.commitCents.toString(), weightedPipelineCents: item.weightedPipelineCents?.toString() ?? null, opportunityCount: item.opportunityCount, coverageState: item.coverageState, coverageBps: item.coverageBps, bottomUpCommitCents: item.bottomUpCommitCents.toString(), managerOverrideCents: item.managerOverrideCents?.toString() ?? null, fingerprint: item.fingerprint, drilldownHref: `/forecast?cycleId=${cycle.id}&snapshotId=${item.id}` });
    return { generatedAt: options.now().toISOString(), asOf: asOf.toISOString(), cycles: cycles.map((item) => ({ id: item.id, key: item.key, version: item.version, name: item.name, periodStart: item.periodStart.toISOString(), periodEnd: item.periodEnd.toISOString(), timeZone: item.timeZone, scopeType: item.scopeType, teamId: item.teamId, function: item.function, currency: item.currency, status: item.status, revision: item.revision, goalPlanId: item.goalPlanId })), current: current ? serializeSnapshot(current) : null, snapshots: snapshots.map(serializeSnapshot), candidates, submissions: submissions.map((item) => ({ id: item.id, type: item.type, category: item.category, declaredValueCents: item.declaredValueCents.toString(), comment: item.comment, asOf: item.asOf.toISOString(), version: item.version, supersedesSubmissionId: item.supersedesSubmissionId, targetMemberId: item.targetMemberId, targetTeamId: item.targetTeamId, fingerprint: item.fingerprint })), comparison, permissions, selectedMemberId: query.memberId ?? context.memberId, definitions: { categories: "Buckets exclusivos por oportunidade; pipeline inclui todas, best case soma BEST_CASE + COMMIT e commit soma apenas COMMIT.", weighted: "Weighted pipeline só existe com probabilidade manual válida, ator e timestamp em 100% do universo elegível.", absence: "Zero, cobertura parcial, indisponível e fora de regra permanecem estados distintos." } };
  }

  return Object.freeze({ screen, createCycle, submit, consolidate, compare });
}

let singleton: ReturnType<typeof createForecastService> | undefined;
export function getForecastService() { singleton ??= createForecastService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); return singleton; }
