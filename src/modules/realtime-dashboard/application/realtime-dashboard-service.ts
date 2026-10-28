import { createHash, randomBytes } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { commercialMetricQuality } from "@/modules/metrics/domain/commercial-metric-quality";
import { type RealtimeDashboardFront } from "@/modules/realtime-dashboard/domain/realtime-dashboard-front";
import type {
  RealtimeDashboardScreen,
  RealtimeDashboardSnapshot,
  RealtimeShareState,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-contracts";
import {
  aggregateRealtimeDashboard,
  resolveRealtimeDashboardPeriods,
  weeklySalesGoal,
} from "@/modules/realtime-dashboard/domain/realtime-dashboard-domain";
import { commercialFunctionForRole, commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import {
  createAuthorizationService,
  type ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { readRealtimeDashboardFacts, realtimeActivityFact, type RealtimeFactScope } from "./realtime-dashboard-facts";
import { resolveIntegratedActivityReadScope } from "@/modules/metrics/application/metrics-service";

const realtimeTokenPattern = /^[A-Za-z0-9_-]{43}$/;
// The TV ranking has an explicit roster; account identity avoids display-name collisions.
const rankingAccounts = new Set([
  "carloshenrique@politizai.com",
  "ederafael@politizai.com",
  "jhoncunha@politizai.com",
]);

type AuthorizationPort = Pick<
  ReturnType<typeof createAuthorizationService>,
  "assertAuthorized" | "authorize"
>;

type RealtimeDashboardServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  randomToken?: () => string;
  publicWorkspaceSlug?: string | undefined;
}>;

function resource(workspaceId: string): ResourceScope {
  return { workspaceId, resourceType: "RealtimeDashboard", resourceId: workspaceId };
}

function publicNotFound(): never {
  throw new ApplicationError("Placar indisponível.", {
    code: "REALTIME_SHARE_NOT_FOUND",
    statusCode: 404,
    expose: true,
  });
}

export function realtimeTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readRealtimeBearer(value: string | null): string {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(value ?? "");
  if (!match || !realtimeTokenPattern.test(match[1]!)) publicNotFound();
  return match[1]!;
}

function shareState(row: Readonly<{
  revision: number;
  createdAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}> | null): RealtimeShareState {
  return Object.freeze({
    active: Boolean(row && !row.revokedAt),
    revision: row?.revision ?? null,
    createdAt: row?.createdAt.toISOString() ?? null,
    rotatedAt: row?.rotatedAt?.toISOString() ?? null,
    revokedAt: row?.revokedAt?.toISOString() ?? null,
  });
}

function publicShareUrl(origin: string, token: string): string {
  const url = new URL("/tempo-real-publico", origin);
  url.hash = token;
  return url.toString();
}

export function createRealtimeDashboardService(options: RealtimeDashboardServiceOptions) {
  async function snapshotForWorkspace(workspaceId: string, front: RealtimeDashboardFront, scope?: RealtimeFactScope): Promise<RealtimeDashboardSnapshot> {
    const now = options.now();
    const workspace = await options.database.workspace.findFirst({
      where: { id: workspaceId, status: "ACTIVE", deletedAt: null },
      select: { name: true, timeZone: true },
    });
    if (!workspace) publicNotFound();

    const periods = resolveRealtimeDashboardPeriods(now, workspace.timeZone);
    const [{ factRows, unclassified }, activeMembers, latestBackfill, latestReconciliation, goalPlan, profiles] = await Promise.all([
      readRealtimeDashboardFacts(options.database, workspaceId, periods.queryFrom, periods.queryTo, front, scope),
      options.database.workspaceMember.findMany({
        where: { ...commercialMemberWhere({ workspaceId, functions: ["SDR", "CLOSER"] }), ...(scope?.memberIds ? { id: { in: [...scope.memberIds] } } : {}) },
        orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
        select: { id: true, user: { select: { displayName: true, normalizedEmail: true } }, role: { select: { key: true } }, teamMemberships: { where: { deletedAt: null, team: { deletedAt: null } }, select: { teamId: true, function: true } } },
      }),
      options.database.commercialMetricBackfillRun.findFirst({
        where: { workspaceId, mode: "APPLY" },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      }),
      options.database.commercialMetricReconciliationRun.findFirst({
        where: { workspaceId },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      }),
      options.database.goalPlan.findFirst({
        where: {
          workspaceId,
          status: "PUBLISHED",
          timeZone: workspace.timeZone,
          periodStart: periods.queryFrom,
          periodEnd: { in: [periods.weekGoalEnd, periods.weekPlanEnd] },
        },
        orderBy: [{ publishedAt: "desc" }, { version: "desc" }, { id: "asc" }],
        select: {
          name: true,
          quotas: {
            where: {
              metricKey: { in: ["OPPORTUNITIES_WON", "MEETINGS_HELD", "REVENUE_WON_CENTS"] },
            },
            orderBy: { id: "asc" },
            select: { targetType: true, memberId: true, teamId: true, function: true, metricKey: true, targetValue: true },
          },
        },
      }),
      options.database.dailyGoalProfile.findMany({
        where: { workspaceId },
        select: { memberId: true, callsTarget: true, messagesTarget: true, effectiveContactsTarget: true, meetingsScheduledTarget: true, meetingsCompletedTarget: true, weeklySalesTarget: true, salesValueTargetCents: true },
      }),
    ]);

    const historicalMemberIds = new Set<string>();
    for (const fact of factRows) {
      const memberId = fact.eventType === "MEETING_SCHEDULED"
        ? fact.bookedByMemberId ?? fact.creditedMemberId
        : fact.creditedMemberId;
      if (memberId) historicalMemberIds.add(memberId);
    }
    for (const member of activeMembers) historicalMemberIds.delete(member.id);
    const historicalMembers = historicalMemberIds.size === 0 ? [] : await options.database.workspaceMember.findMany({
      where: { workspaceId, id: { in: [...historicalMemberIds].filter(id => !scope?.memberIds || scope.memberIds.includes(id)) } },
      orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
      select: { id: true, user: { select: { displayName: true, normalizedEmail: true } } },
    });

    const sellers = [
      ...activeMembers.map((member) => ({ id: member.id, name: member.user.displayName, active: true, rankingVisible: rankingAccounts.has(member.user.normalizedEmail), ...(member.user.normalizedEmail === "carloshenrique@politizai.com" ? { advertisingRole: "BOOKER" as const } : rankingAccounts.has(member.user.normalizedEmail) ? { advertisingRole: "CLOSER" as const } : {}), functions: [...new Set([commercialFunctionForRole(member.role.key), ...member.teamMemberships.map((team) => team.function)].filter((value): value is NonNullable<typeof value> => value !== null))], teamIds: member.teamMemberships.map((team) => team.teamId) })),
      ...historicalMembers.map((member) => ({ id: member.id, name: member.user.displayName, active: false, rankingVisible: rankingAccounts.has(member.user.normalizedEmail), ...(member.user.normalizedEmail === "carloshenrique@politizai.com" ? { advertisingRole: "BOOKER" as const } : rankingAccounts.has(member.user.normalizedEmail) ? { advertisingRole: "CLOSER" as const } : {}), functions: [], teamIds: [] })),
    ];
    const facts = factRows.map(realtimeActivityFact);
    const aggregation = aggregateRealtimeDashboard(facts, sellers, periods, { front, profiles, quotas: (goalPlan?.quotas ?? []).filter(quota => !scope?.memberIds || quota.targetType === "MEMBER" && scope.memberIds.includes(quota.memberId ?? "")), eligibleMemberIds: sellers.filter((seller) => seller.rankingVisible).map((seller) => seller.id), ...(goalPlan ? { planName: goalPlan.name } : {}) });
    const quality = commercialMetricQuality(latestBackfill, latestReconciliation);
    const knownMembers = new Set(sellers.map((seller) => seller.id));
    const unattributed = factRows.filter((fact) => !["LEAD_CREATED", "LEAD_SUBMISSION_ATTACHED"].includes(fact.eventType) && !knownMembers.has((fact.eventType === "MEETING_SCHEDULED" ? fact.bookedByMemberId ?? fact.creditedMemberId : fact.creditedMemberId) ?? "")).length;
    const newestRecordedAt = factRows.reduce<Date | null>(
      (latest, fact) => !latest || fact.recordedAt > latest ? fact.recordedAt : latest,
      null,
    );
    const salesGoal = aggregation.week.goals.sales;

    return Object.freeze({
      workspaceName: workspace.name,
      timeZone: workspace.timeZone,
      generatedAt: now.toISOString(),
      freshnessAt: newestRecordedAt?.toISOString() ?? null,
      quality: Object.freeze({
        state: unattributed > 0 || unclassified > 0 ? "PARTIAL" as const : quality.reconciliationState === "AVAILABLE"
          ? "LIVE" as const
          : quality.reconciliationState === "UNAVAILABLE"
            ? "UNAVAILABLE" as const
            : "PARTIAL" as const,
        reason: `${quality.reason}${unattributed > 0 ? ` ${unattributed} fatos sem vendedor atribuído aparecem somente nos totais gerais.` : ""}${unclassified > 0 ? ` ${unclassified} fatos sem frente comercial identificada foram excluídos para preservar a separação.` : ""}`,
      }),
      today: aggregation.today,
      week: Object.freeze({
        ...aggregation.week,
        salesGoal: weeklySalesGoal(
          salesGoal.targetValue === null ? aggregation.week.totals.sales : Number(salesGoal.actualValue),
          salesGoal.targetValue === null ? null : BigInt(salesGoal.targetValue),
          salesGoal.label,
        ),
      }),
    });
  }

  async function advertisingSnapshot(context: AuthenticatedContext): Promise<RealtimeDashboardSnapshot> {
    const workspace = await options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
    const periods = resolveRealtimeDashboardPeriods(options.now(), workspace.timeZone);
    const scope = await resolveIntegratedActivityReadScope(options, context, periods.queryFrom, periods.queryTo);
    return snapshotForWorkspace(context.workspaceId, "ADVERTISING", scope);
  }

  async function screen(context: AuthenticatedContext, front: RealtimeDashboardFront = "PROSPECTING"): Promise<RealtimeDashboardScreen> {
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.REALTIME_READ,
      resource(context.workspaceId),
    );
    const [snapshot, share, manageDecision] = await Promise.all([
      snapshotForWorkspace(context.workspaceId, front),
      options.database.realtimeDashboardShare.findUnique({ where: { workspaceId: context.workspaceId } }),
      options.authorization.authorize(
        context,
        PermissionKeys.REALTIME_SHARE_MANAGE,
        resource(context.workspaceId),
      ),
    ]);
    return Object.freeze({
      snapshot,
      sharing: shareState(share),
      permissions: Object.freeze({ manageShare: manageDecision.allowed }),
    });
  }

  async function publicSnapshot(token: string, front: RealtimeDashboardFront = "PROSPECTING"): Promise<RealtimeDashboardSnapshot> {
    if (!realtimeTokenPattern.test(token)) publicNotFound();
    const share = await options.database.realtimeDashboardShare.findUnique({
      where: { tokenHash: realtimeTokenHash(token) },
      select: { workspaceId: true, revokedAt: true },
    });
    if (!share || share.revokedAt) publicNotFound();
    return snapshotForWorkspace(share.workspaceId, front);
  }

  async function publicTvSnapshot(front: RealtimeDashboardFront = "PROSPECTING"): Promise<RealtimeDashboardSnapshot> {
    if (!options.publicWorkspaceSlug) publicNotFound();
    const workspace = await options.database.workspace.findFirst({
      where: { slug: options.publicWorkspaceSlug, status: "ACTIVE", deletedAt: null },
      select: { id: true },
    });
    if (!workspace) publicNotFound();
    const share = await options.database.realtimeDashboardShare.findUnique({
      where: { workspaceId: workspace.id },
      select: { revokedAt: true },
    });
    if (!share || share.revokedAt) publicNotFound();
    return snapshotForWorkspace(workspace.id, front);
  }

  async function rotate(context: AuthenticatedContext, origin: string) {
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.REALTIME_SHARE_MANAGE,
      resource(context.workspaceId),
    );
    const token = (options.randomToken ?? (() => randomBytes(32).toString("base64url")))();
    if (!realtimeTokenPattern.test(token)) {
      throw new ApplicationError("Falha ao gerar o link público.", {
        code: "REALTIME_TOKEN_GENERATION_FAILED",
        statusCode: 500,
      });
    }
    const tokenHash = realtimeTokenHash(token);
    const now = options.now();
    const share = await options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`realtime-share:${context.workspaceId}`}, 0))`;
      const current = await transaction.realtimeDashboardShare.findUnique({
        where: { workspaceId: context.workspaceId },
      });
      const updated = current
        ? await transaction.realtimeDashboardShare.update({
          where: { workspaceId: context.workspaceId },
          data: {
            tokenHash,
            revision: { increment: 1 },
            updatedByActorId: context.actorId,
            updatedAt: now,
            rotatedAt: now,
            revokedAt: null,
            revokedByActorId: null,
          },
        })
        : await transaction.realtimeDashboardShare.create({
          data: {
            workspaceId: context.workspaceId,
            tokenHash,
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
            createdAt: now,
            updatedAt: now,
            rotatedAt: now,
          },
        });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "realtime.share.rotated",
          origin: "API",
          entityType: "RealtimeDashboardShare",
          entityId: updated.id,
          changes: { revision: updated.revision, state: "ACTIVE" },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const publicWorkspace = options.publicWorkspaceSlug
      ? await options.database.workspace.findFirst({
        where: { id: context.workspaceId, slug: options.publicWorkspaceSlug, status: "ACTIVE", deletedAt: null },
        select: { id: true },
      })
      : null;
    return Object.freeze({
      sharing: shareState(share),
      shareUrl: publicWorkspace ? new URL("/tempo", origin).toString() : publicShareUrl(origin, token),
    });
  }

  async function revoke(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.REALTIME_SHARE_MANAGE,
      resource(context.workspaceId),
    );
    const now = options.now();
    const share = await options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`realtime-share:${context.workspaceId}`}, 0))`;
      const current = await transaction.realtimeDashboardShare.findUnique({
        where: { workspaceId: context.workspaceId },
      });
      if (!current || current.revokedAt) return current;
      const updated = await transaction.realtimeDashboardShare.update({
        where: { workspaceId: context.workspaceId },
        data: {
          revision: { increment: 1 },
          updatedByActorId: context.actorId,
          updatedAt: now,
          revokedByActorId: context.actorId,
          revokedAt: now,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "realtime.share.revoked",
          origin: "API",
          entityType: "RealtimeDashboardShare",
          entityId: updated.id,
          changes: { revision: updated.revision, state: "REVOKED" },
        },
      });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return Object.freeze({ sharing: shareState(share) });
  }

  return Object.freeze({ advertisingSnapshot, publicSnapshot, publicTvSnapshot, revoke, rotate, screen });
}

export const getRealtimeDashboardService = () => {
  const database = getDatabaseClient();
  return createRealtimeDashboardService({
    database,
    authorization: createAuthorizationService({ database }),
    now: () => new Date(),
    publicWorkspaceSlug: process.env.REALTIME_PUBLIC_WORKSPACE_SLUG?.trim() || undefined,
  });
};
