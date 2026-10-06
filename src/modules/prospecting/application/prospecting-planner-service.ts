import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { manualCapacityDates, nextBusinessDate } from "@/modules/prospecting/domain/prospecting-cadence";
import { addLocalDays, workspaceDateAt } from "@/shared/core/time/workspace-time";
import { getDatabaseClient } from "@/shared/core/database/client";

type Database = PrismaClient | Prisma.TransactionClient;

type LoadRow = Readonly<{ memberId: string; localDate: Date; touched: bigint }>;

function localDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function loadKey(memberId: string, date: string): string {
  return `${memberId}:${date}`;
}

export function chooseProspectingSeller(input: Readonly<{
  sellers: readonly Readonly<{ memberId: string; dailyCapacity: number; reservePercent: number; rotationPosition: number }>[];
  dates: readonly string[];
  loads: ReadonlyMap<string, number>;
}>): string | null {
  const ranked = input.sellers
    .map((seller) => {
      const effectiveCapacity = Math.max(1, Math.floor(seller.dailyCapacity * (100 - seller.reservePercent) / 100));
      const dailyLoads = input.dates.map((date) => input.loads.get(loadKey(seller.memberId, date)) ?? 0);
      return {
        seller,
        available: dailyLoads.every((value) => value < effectiveCapacity),
        projectedLoad: dailyLoads.reduce((sum, value) => sum + value, 0),
      };
    })
    .filter((item) => item.available)
    .sort((left, right) => left.projectedLoad - right.projectedLoad || left.seller.rotationPosition - right.seller.rotationPosition || left.seller.memberId.localeCompare(right.seller.memberId));
  return ranked[0]?.seller.memberId ?? null;
}

export function createProspectingPlannerService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  async function ensureFoundation(database: Database, workspaceId: string, actorId: string) {
    return database.prospectingSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, createdByActorId: actorId, updatedByActorId: actorId },
      update: {},
    });
  }

  async function plan(database: Database, input: Readonly<{
    workspaceId: string;
    actorId: string;
    horizonStart?: string;
    horizonEnd?: string;
    limit?: number;
  }>) {
    const workspace = await database.workspace.findUniqueOrThrow({ where: { id: input.workspaceId }, select: { timeZone: true } });
    const settings = await ensureFoundation(database, input.workspaceId, input.actorId);
    const today = workspaceDateAt(options.now(), workspace.timeZone);
    const start = input.horizonStart ?? today;
    const end = input.horizonEnd ?? addLocalDays(start, 29);
    const holidays = new Set((await database.prospectingCalendarHoliday.findMany({
      where: { workspaceId: input.workspaceId, localDate: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${addLocalDays(end, 29)}T00:00:00.000Z`) } },
      select: { localDate: true },
    })).map((item) => localDate(item.localDate)));
    const sellers = await database.prospectingSellerConfig.findMany({
      where: {
        workspaceId: input.workspaceId,
        active: true,
      },
      orderBy: [{ rotationPosition: "asc" }, { memberId: "asc" }],
    });
    const eligibleMemberIds = new Set((await database.workspaceMember.findMany({
      where: {
        ...commercialMemberWhere({ workspaceId: input.workspaceId, functions: ["SDR", "CLOSER"], requireLeadAvailability: true }),
        id: { in: sellers.map((seller) => seller.memberId) },
      },
      select: { id: true },
    })).map((member) => member.id));
    const eligibleSellers = sellers.filter((seller) => eligibleMemberIds.has(seller.memberId));
    if (eligibleSellers.length === 0) {
      return { planned: 0, deferred: 0, reason: "NO_ELIGIBLE_SELLERS", start, end };
    }
    const rows = await database.$queryRaw<LoadRow[]>`
      SELECT task."assigneeMemberId" AS "memberId",
             (task."dueAt" AT TIME ZONE ${workspace.timeZone})::date AS "localDate",
             COUNT(DISTINCT task."leadId")::bigint AS touched
      FROM "tasks" task
      WHERE task."workspaceId" = ${input.workspaceId}::uuid
        AND task."assigneeMemberId" IN (${Prisma.join(eligibleSellers.map((seller) => seller.memberId))})
        AND task."status"::text IN ('OPEN', 'IN_PROGRESS')
        AND task."kind"::text IN ('IMMEDIATE_CALL', 'CALL', 'MESSAGE', 'INSTAGRAM_MESSAGE', 'INSTAGRAM_FOLLOW', 'FOLLOW_UP')
        AND task."deletedAt" IS NULL
        AND (task."dueAt" AT TIME ZONE ${workspace.timeZone})::date BETWEEN ${start}::date AND ${addLocalDays(end, 29)}::date
      GROUP BY 1, 2
    `;
    const loads = new Map(rows.map((row) => [loadKey(row.memberId, localDate(row.localDate)), Number(row.touched)]));
    const existingPlans = await database.prospectRelease.findMany({
      where: { workspaceId: input.workspaceId, status: { in: ["PLANNED", "CLAIMED"] }, plannedDate: { gte: new Date(`${start}T00:00:00.000Z`) } },
      select: { plannedMemberId: true, plannedDate: true },
    });
    for (const release of existingPlans) {
      if (!release.plannedMemberId) continue;
      for (const date of manualCapacityDates({ d1Date: localDate(release.plannedDate), holidays })) {
        const key = loadKey(release.plannedMemberId, date);
        loads.set(key, (loads.get(key) ?? 0) + 1);
      }
    }
    const candidates = await database.prospectCandidate.findMany({
      where: { workspaceId: input.workspaceId, status: "READY", leadId: null },
      orderBy: [{ mandateVerifiedAt: "asc" }, { id: "asc" }],
      take: input.limit ?? 2_000,
      select: { id: true },
    });
    let planned = 0;
    let deferred = 0;
    let releaseDate = nextBusinessDate(start, holidays);
    for (const candidate of candidates) {
      let assignment: { memberId: string; date: string } | null = null;
      let cursor = releaseDate;
      while (cursor <= end && !assignment) {
        if (!holidays.has(cursor)) {
          const dates = manualCapacityDates({ d1Date: cursor, holidays });
          const memberId = chooseProspectingSeller({ sellers: eligibleSellers, dates, loads });
          if (memberId) assignment = { memberId, date: cursor };
        }
        if (!assignment) cursor = nextBusinessDate(addLocalDays(cursor, 1), holidays);
      }
      if (!assignment) {
        deferred += 1;
        continue;
      }
      const existingRelease = await database.prospectRelease.findUnique({
        where: { workspaceId_candidateId: { workspaceId: input.workspaceId, candidateId: candidate.id } },
        select: { status: true },
      });
      if (existingRelease && !["DEFERRED", "FAILED", "PLANNED"].includes(existingRelease.status)) {
        deferred += 1;
        continue;
      }
      const release = await database.prospectRelease.upsert({
        where: { workspaceId_candidateId: { workspaceId: input.workspaceId, candidateId: candidate.id } },
        create: {
          workspaceId: input.workspaceId,
          candidateId: candidate.id,
          plannedDate: new Date(`${assignment.date}T00:00:00.000Z`),
          plannedMemberId: assignment.memberId,
          status: "PLANNED",
          idempotencyKey: `prospect-release:${candidate.id}`,
          createdByActorId: input.actorId,
        },
        update: {
          plannedDate: new Date(`${assignment.date}T00:00:00.000Z`),
          plannedMemberId: assignment.memberId,
          status: "PLANNED",
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          attemptCount: 0,
          nextAttemptAt: null,
          lastErrorAt: null,
          reasonCode: null,
          planRevision: { increment: 1 },
        },
      });
      await database.prospectCandidate.update({
        where: { id: candidate.id },
        data: { status: "PLANNED", plannedReleaseDate: release.plannedDate, revision: { increment: 1 } },
      });
      for (const date of manualCapacityDates({ d1Date: assignment.date, holidays })) {
        const key = loadKey(assignment.memberId, date);
        loads.set(key, (loads.get(key) ?? 0) + 1);
      }
      planned += 1;
      releaseDate = assignment.date;
    }
    return { planned, deferred, reason: null, start, end, releaseEnabled: settings.releaseEnabled };
  }

  async function processNext(workerId: string) {
    const candidate = await options.database.prospectCandidate.findFirst({
      where: { status: "READY", leadId: null },
      orderBy: [{ mandateVerifiedAt: "asc" }, { id: "asc" }],
      select: { workspaceId: true },
    });
    if (!candidate) return { status: "IDLE" as const };
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospecting-plan:${candidate.workspaceId}`}, 0))`;
      const actor = await transaction.actor.findFirst({
        where: { workspaceId: candidate.workspaceId, type: "SYSTEM", key: "system", userId: null },
        select: { id: true },
      });
      if (!actor) return { status: "CONFIGURATION_REQUIRED" as const, reason: "SYSTEM_ACTOR_MISSING" };
      const result = await plan(transaction, {
        workspaceId: candidate.workspaceId,
        actorId: actor.id,
      });
      return {
        status: result.planned > 0 ? "PLANNED" as const : "DEFERRED" as const,
        workerId,
        ...result,
      };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
  }

  return Object.freeze({ ensureFoundation, plan, processNext });
}

let singleton: ReturnType<typeof createProspectingPlannerService> | undefined;
export function getProspectingPlannerService() {
  singleton ??= createProspectingPlannerService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
