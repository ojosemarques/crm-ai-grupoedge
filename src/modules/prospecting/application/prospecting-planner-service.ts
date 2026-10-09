import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { nextBusinessDate } from "@/modules/prospecting/domain/prospecting-cadence";
import { addLocalDays, workspaceDateAt } from "@/shared/core/time/workspace-time";
import { getDatabaseClient } from "@/shared/core/database/client";

type Database = PrismaClient | Prisma.TransactionClient;

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
  const targetDate = input.dates[0];
  if (!targetDate) return null;
  const ranked = input.sellers
    .map((seller) => {
      const dailyLoad = input.loads.get(loadKey(seller.memberId, targetDate)) ?? 0;
      return {
        seller,
        available: dailyLoad < seller.dailyCapacity,
        projectedLoad: dailyLoad,
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
    const requestedEnd = input.horizonEnd ?? addLocalDays(start, 29);
    const holidays = new Set((await database.prospectingCalendarHoliday.findMany({
      where: { workspaceId: input.workspaceId, localDate: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${addLocalDays(requestedEnd, 29)}T00:00:00.000Z`) } },
      select: { localDate: true },
    })).map((item) => localDate(item.localDate)));
    const releaseDate = nextBusinessDate(start, holidays);
    if (releaseDate > requestedEnd) {
      return { planned: 0, deferred: 0, replanned: 0, reason: "NO_BUSINESS_DATE", start, end: requestedEnd, releaseEnabled: settings.releaseEnabled };
    }
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
      return { planned: 0, deferred: 0, replanned: 0, reason: "NO_ELIGIBLE_SELLERS", start, end: releaseDate };
    }

    let replanned = 0;
    if (releaseDate === today) {
      const futurePlans = await database.prospectRelease.findMany({
        where: {
          workspaceId: input.workspaceId,
          status: "PLANNED",
          plannedDate: { gt: new Date(`${releaseDate}T00:00:00.000Z`) },
          candidateId: { in: (await database.prospectCandidate.findMany({
            where: { workspaceId: input.workspaceId, status: "PLANNED", leadId: null },
            select: { id: true },
          })).map((candidate) => candidate.id) },
        },
        select: { id: true, candidateId: true },
      });
      if (futurePlans.length > 0) {
        const candidateIds = futurePlans.map((release) => release.candidateId);
        await database.prospectRelease.updateMany({
          where: { id: { in: futurePlans.map((release) => release.id) }, workspaceId: input.workspaceId, status: "PLANNED" },
          data: { status: "DEFERRED", reasonCode: "DAILY_QUEUE_REPLAN", claimedBy: null, claimedAt: null, leaseExpiresAt: null },
        });
        await database.prospectCandidate.updateMany({
          where: { id: { in: candidateIds }, workspaceId: input.workspaceId, status: "PLANNED", leadId: null },
          data: { status: "READY", plannedReleaseDate: null, revision: { increment: 1 } },
        });
        await database.auditLog.create({
          data: {
            workspaceId: input.workspaceId,
            actorId: input.actorId,
            action: "prospecting.daily_queue.replanned",
            entityType: "ProspectRelease",
            entityId: futurePlans[0]!.id,
            origin: "SYSTEM",
            occurredAt: options.now(),
            reason: "Planos futuros devolvidos ao estoque para preenchimento diário da meta.",
            changes: { releaseDate, releaseIds: futurePlans.map((release) => release.id), count: futurePlans.length },
          },
        });
        replanned = futurePlans.length;
      }

    }

    const dailyNewProspects = await database.prospectingCadenceInstance.groupBy({
      by: ["ownerMemberId"],
      where: {
        workspaceId: input.workspaceId,
        d1Date: new Date(`${releaseDate}T00:00:00.000Z`),
      },
      _count: { _all: true },
    });
    const loads = new Map(dailyNewProspects.map((row) => [
      loadKey(row.ownerMemberId, releaseDate),
      row._count._all,
    ]));
    const existingPlans = await database.prospectRelease.findMany({
      where: { workspaceId: input.workspaceId, status: { in: ["PLANNED", "CLAIMED"] }, plannedDate: new Date(`${releaseDate}T00:00:00.000Z`) },
      select: { plannedMemberId: true, plannedDate: true },
    });
    for (const release of existingPlans) {
      if (!release.plannedMemberId) continue;
      const key = loadKey(release.plannedMemberId, releaseDate);
      loads.set(key, (loads.get(key) ?? 0) + 1);
    }
    const candidates = await database.prospectCandidate.findMany({
      where: {
        workspaceId: input.workspaceId,
        status: "READY",
        leadId: null,
        OR: [
          { normalizedPhone: { not: null } },
          { normalizedPoliticianPhone: { not: null } },
          { normalizedAdvisorPhone: { not: null } },
          { normalizedWhatsapp: { not: null } },
        ],
      },
      orderBy: [{ mandateVerifiedAt: "asc" }, { id: "asc" }],
      take: input.limit ?? 2_000,
      select: { id: true },
    });
    let planned = 0;
    let deferred = 0;
    for (const candidate of candidates) {
      const memberId = chooseProspectingSeller({ sellers: eligibleSellers, dates: [releaseDate], loads });
      const assignment = memberId ? { memberId, date: releaseDate } : null;
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
      const key = loadKey(assignment.memberId, assignment.date);
      loads.set(key, (loads.get(key) ?? 0) + 1);
      planned += 1;
    }
    return { planned, deferred, replanned, reason: null, start, end: releaseDate, releaseEnabled: settings.releaseEnabled };
  }

  async function processNext(workerId: string) {
    const candidate = await options.database.prospectCandidate.findFirst({
      where: {
        status: { in: ["READY", "PLANNED"] },
        leadId: null,
        OR: [
          { normalizedPhone: { not: null } },
          { normalizedPoliticianPhone: { not: null } },
          { normalizedAdvisorPhone: { not: null } },
          { normalizedWhatsapp: { not: null } },
        ],
      },
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
        status: result.planned > 0 ? "PLANNED" as const : result.replanned > 0 ? "REPLANNED" as const : "IDLE" as const,
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
