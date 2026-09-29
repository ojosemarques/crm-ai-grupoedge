import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

const inputSchema = z.object({
  mode: z.enum(["DRY_RUN", "EXECUTE"]),
  runKey: z.string().trim().min(8).max(160),
});

export function createOnboardingBackfillService(
  database: PrismaClient,
  now: () => Date = () => new Date(),
) {
  const authorization = getAuthorizationService();
  const onboarding = createOnboardingService({ database, now });

  async function run(context: AuthenticatedContext, raw: unknown) {
    const input = inputSchema.parse(raw);
    await authorization.assertAuthorized(context, PermissionKeys.ONBOARDING_CORRECT, {
      workspaceId: context.workspaceId,
      resourceType: "OnboardingBackfill",
      resourceId: context.workspaceId,
      memberId: context.memberId,
    });
    const replay = await database.onboardingBackfillRun.findUnique({
      where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey: input.runKey } },
    });
    if (replay) {
      return {
        ...replay,
        items: await database.onboardingBackfillItem.findMany({
          where: { workspaceId: context.workspaceId, runId: replay.id },
          orderBy: { createdAt: "asc" },
        }),
        replayed: true,
      };
    }

    const candidates = await database.opportunity.findMany({
      where: { workspaceId: context.workspaceId, status: "WON", deletedAt: null },
      select: {
        id: true,
        accountId: true,
        ownerMemberId: true,
        owner: { select: { status: true, deletedAt: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const run = await database.onboardingBackfillRun.create({
      data: {
        workspaceId: context.workspaceId,
        runKey: input.runKey,
        status: "RUNNING",
        mode: input.mode,
        candidateCount: candidates.length,
        actorId: context.actorId,
      },
    });

    let createdCount = 0;
    let reviewCount = 0;
    let skippedCount = 0;
    for (const candidate of candidates) {
      const [existing, contract, template] = await Promise.all([
        database.customerHandoff.findFirst({
          where: { workspaceId: context.workspaceId, opportunityId: candidate.id },
          select: { id: true },
        }),
        database.commercialContract.findFirst({
          where: { workspaceId: context.workspaceId, opportunityId: candidate.id, status: "ACCEPTED" },
          orderBy: { acceptedAt: "desc" },
          select: { id: true },
        }),
        database.onboardingTemplateVersion.findFirst({
          where: { workspaceId: context.workspaceId, status: "PUBLISHED" },
          orderBy: { version: "desc" },
          select: { id: true },
        }),
      ]);
      let status: "CREATED" | "SKIPPED" | "REVIEW_REQUIRED";
      let reasonCode: string;
      let handoffId: string | null = null;
      const evidence = {
        opportunityWon: true,
        hasAccount: Boolean(candidate.accountId),
        acceptedContract: Boolean(contract),
        publishedTemplate: Boolean(template),
        activeOwner: candidate.owner.status === "ACTIVE" && candidate.owner.deletedAt === null,
        existingHandoff: Boolean(existing),
        mode: input.mode,
      };
      if (existing) {
        status = "SKIPPED";
        reasonCode = "HANDOFF_ALREADY_EXISTS";
        handoffId = existing.id;
        skippedCount += 1;
      } else if (!candidate.accountId || !contract || !template || candidate.owner.status !== "ACTIVE" || candidate.owner.deletedAt) {
        status = "REVIEW_REQUIRED";
        reasonCode = "INCOMPLETE_VERIFIABLE_PREREQUISITES";
        reviewCount += 1;
      } else if (input.mode === "DRY_RUN") {
        status = "CREATED";
        reasonCode = "WOULD_CREATE";
        createdCount += 1;
      } else {
        const handoff = await onboarding.createHandoff(context, {
          opportunityId: candidate.id,
          ownerMemberId: candidate.ownerMemberId,
          reason: "Backfill conservador com pré-requisitos persistidos e verificáveis.",
          idempotencyKey: `onboarding-backfill:${run.id}:${candidate.id}`,
        });
        status = "CREATED";
        reasonCode = "CREATED_FROM_VERIFIED_FACTS";
        handoffId = handoff.id;
        createdCount += 1;
      }
      await database.onboardingBackfillItem.create({
        data: {
          workspaceId: context.workspaceId,
          runId: run.id,
          opportunityId: candidate.id,
          status,
          reasonCode,
          handoffId,
          safeEvidence: evidence,
        },
      });
    }

    const completed = await database.onboardingBackfillRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        createdCount,
        reviewCount,
        skippedCount,
        completedAt: now(),
      },
    });
    await database.auditLog.create({
      data: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        action: "onboarding.backfill.completed",
        entityType: "OnboardingBackfillRun",
        entityId: run.id,
        origin: "API",
        changes: {
          mode: input.mode,
          candidateCount: candidates.length,
          createdCount,
          reviewCount,
          skippedCount,
          replaySafe: true,
        },
      },
    });
    return {
      ...completed,
      items: await database.onboardingBackfillItem.findMany({
        where: { workspaceId: context.workspaceId, runId: run.id },
        orderBy: { createdAt: "asc" },
      }),
      replayed: false,
    };
  }

  return { run };
}

let singleton: ReturnType<typeof createOnboardingBackfillService> | undefined;

export function getOnboardingBackfillService() {
  singleton ??= createOnboardingBackfillService(getDatabaseClient());
  return singleton;
}
