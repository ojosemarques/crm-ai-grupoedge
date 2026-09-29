import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  CONTACT_IDENTITY_RULE_VERSION,
  ensureContactForLeadInTransaction,
} from "@/modules/contacts/application/contact-identity-service";
import type { ContactBackfillRunView } from "@/modules/contacts/domain/contact-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type AuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: PermissionKey,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

const startSchema = z
  .object({
    mode: z.enum(["DRY_RUN", "EXECUTE"]),
    batchSize: z.number().int().min(1).max(500).default(100),
  })
  .strict();
const runSchema = z.object({ runId: z.string().uuid() }).strict();

function workspaceResource(workspaceId: string, resourceId?: string): ResourceScope {
  return {
    workspaceId,
    resourceType: "ContactBackfillRun",
    ...(resourceId ? { resourceId } : {}),
  };
}

function toView(run: Readonly<{
  id: string;
  runKey: string;
  ruleVersion: string;
  mode: "DRY_RUN" | "EXECUTE";
  status: "PENDING" | "RUNNING" | "PAUSED" | "SUCCEEDED" | "FAILED";
  batchSize: number;
  cursorLeadId: string | null;
  eligibleCount: number;
  processedCount: number;
  contactsCreated: number;
  pointsCreated: number;
  leadsLinked: number;
  reviewsOpened: number;
  ignoredCount: number;
  failedCount: number;
  startedAt: Date | null;
  pausedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
}>): ContactBackfillRunView {
  return {
    ...run,
    startedAt: run.startedAt?.toISOString() ?? null,
    pausedAt: run.pausedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export function createContactBackfillService(options: Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
  ensureContact?: typeof ensureContactForLeadInTransaction;
}>) {
  const ensureContact = options.ensureContact ?? ensureContactForLeadInTransaction;
  async function authorize(context: AuthenticatedContext, runId?: string) {
    await options.authorization.assertAuthorized(
      context,
      PermissionKeys.CONTACTS_BACKFILL,
      workspaceResource(context.workspaceId, runId),
    );
  }

  async function start(context: AuthenticatedContext, payload: unknown): Promise<ContactBackfillRunView> {
    const parsed = startSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApplicationError("Configuração de backfill inválida.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    await authorize(context);
    const runKey = `${parsed.data.mode.toLowerCase()}:${CONTACT_IDENTITY_RULE_VERSION}`;
    const eligibleCount = await options.database.lead.count({
      where: { workspaceId: context.workspaceId, contactId: null, deletedAt: null },
    });
    const run = await options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`contact-backfill-start:${context.workspaceId}:${runKey}`}, 0))
      `;
      const existing = await transaction.contactBackfillRun.findUnique({
        where: { workspaceId_runKey: { workspaceId: context.workspaceId, runKey } },
      });
      if (existing) return existing;
      const created = await transaction.contactBackfillRun.create({
        data: {
          workspaceId: context.workspaceId,
          runKey,
          ruleVersion: CONTACT_IDENTITY_RULE_VERSION,
          mode: parsed.data.mode,
          batchSize: parsed.data.batchSize,
          eligibleCount,
          requestedByActorId: context.actorId,
          updatedByActorId: context.actorId,
        },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "contact.backfill.started",
          entityType: "ContactBackfillRun",
          entityId: created.id,
          changes: { mode: created.mode, ruleVersion: created.ruleVersion, batchSize: created.batchSize, eligibleCount },
        },
      });
      return created;
    });
    return toView(run);
  }

  async function getRun(context: AuthenticatedContext, payload: unknown): Promise<ContactBackfillRunView> {
    const parsed = runSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApplicationError("Execução de backfill inválida.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    await authorize(context, parsed.data.runId);
    const run = await options.database.contactBackfillRun.findFirst({
      where: { id: parsed.data.runId, workspaceId: context.workspaceId },
    });
    if (!run) {
      throw new ApplicationError("Execução de backfill não encontrada.", { code: "NOT_FOUND", statusCode: 404, expose: true });
    }
    return toView(run);
  }

  async function pause(context: AuthenticatedContext, payload: unknown): Promise<ContactBackfillRunView> {
    const parsed = runSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApplicationError("Execução de backfill inválida.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    await authorize(context, parsed.data.runId);
    const now = options.now();
    const run = await options.database.$transaction(async (transaction) => {
      const current = await transaction.contactBackfillRun.findFirst({
        where: { id: parsed.data.runId, workspaceId: context.workspaceId },
      });
      if (!current) {
        throw new ApplicationError("Execução de backfill não encontrada.", { code: "NOT_FOUND", statusCode: 404, expose: true });
      }
      if (current.status === "SUCCEEDED") return current;
      const updated = await transaction.contactBackfillRun.update({
        where: { id: current.id },
        data: { status: "PAUSED", pausedAt: now, updatedByActorId: context.actorId },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "contact.backfill.paused",
          entityType: "ContactBackfillRun",
          entityId: current.id,
          changes: { previousStatus: current.status, status: "PAUSED", cursorLeadId: current.cursorLeadId },
        },
      });
      return updated;
    });
    return toView(run);
  }

  async function resume(context: AuthenticatedContext, payload: unknown): Promise<ContactBackfillRunView> {
    const parsed = runSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApplicationError("Execução de backfill inválida.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    await authorize(context, parsed.data.runId);
    const run = await options.database.contactBackfillRun.findFirst({
      where: { id: parsed.data.runId, workspaceId: context.workspaceId },
    });
    if (!run) {
      throw new ApplicationError("Execução de backfill não encontrada.", { code: "NOT_FOUND", statusCode: 404, expose: true });
    }
    if (run.status === "SUCCEEDED") return toView(run);
    const updated = await options.database.contactBackfillRun.update({
      where: { id: run.id },
      data: { status: "RUNNING", pausedAt: null, lastError: null, updatedByActorId: context.actorId },
    });
    return toView(updated);
  }

  async function processBatch(context: AuthenticatedContext, payload: unknown): Promise<ContactBackfillRunView> {
    const parsed = runSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApplicationError("Execução de backfill inválida.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    await authorize(context, parsed.data.runId);
    const now = options.now();
    try {
      const run = await options.database.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${`contact-backfill-run:${context.workspaceId}:${parsed.data.runId}`}, 0))
        `;
        const current = await transaction.contactBackfillRun.findFirst({
          where: { id: parsed.data.runId, workspaceId: context.workspaceId },
        });
        if (!current) {
          throw new ApplicationError("Execução de backfill não encontrada.", { code: "NOT_FOUND", statusCode: 404, expose: true });
        }
        if (current.status === "PAUSED") {
          throw new ApplicationError("A execução está pausada. Retome-a explicitamente.", { code: "BACKFILL_PAUSED", statusCode: 409, expose: true });
        }
        if (current.status === "SUCCEEDED") return current;

        const leads = await transaction.lead.findMany({
          where: {
            workspaceId: context.workspaceId,
            contactId: null,
            deletedAt: null,
            ...(current.cursorLeadId ? { id: { gt: current.cursorLeadId } } : {}),
          },
          orderBy: { id: "asc" },
          take: current.batchSize,
          select: {
            id: true,
            fullName: true,
            jobTitle: true,
            normalizedPhone: true,
            normalizedEmail: true,
            contactPreference: true,
            identityReviews: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
          },
        });

        let contactsCreated = 0;
        let pointsCreated = 0;
        let leadsLinked = 0;
        let reviewsOpened = 0;
        let ignoredCount = 0;
        for (const lead of leads) {
          const idempotencyKey = `${current.mode.toLowerCase()}:${current.ruleVersion}:${lead.id}`;
          const alreadyProcessed = await transaction.contactBackfillItem.findUnique({
            where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey } },
            select: { id: true },
          });
          if (alreadyProcessed) continue;

          if (!lead.normalizedPhone && !lead.normalizedEmail) {
            ignoredCount += 1;
            await transaction.contactBackfillItem.create({
              data: {
                workspaceId: context.workspaceId,
                runId: current.id,
                leadId: lead.id,
                ruleVersion: current.ruleVersion,
                idempotencyKey,
                outcome: "IGNORED",
                reasonCode: "NO_USABLE_CONTACT_POINT",
              },
            });
            continue;
          }

          if (current.mode === "DRY_RUN") {
            await transaction.contactBackfillItem.create({
              data: {
                workspaceId: context.workspaceId,
                runId: current.id,
                leadId: lead.id,
                ruleVersion: current.ruleVersion,
                idempotencyKey,
                outcome: "DRY_RUN_CANDIDATE",
                reasonCode: "WOULD_CREATE_CONTACT",
              },
            });
            continue;
          }

          const identity = await ensureContact(transaction, {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            facts: {
              leadId: lead.id,
              fullName: lead.fullName,
              jobTitle: lead.jobTitle,
              normalizedPhone: lead.normalizedPhone,
              originalPhone: lead.normalizedPhone,
              normalizedEmail: lead.normalizedEmail,
              originalEmail: lead.normalizedEmail,
              doNotContact: lead.contactPreference === "DO_NOT_CONTACT",
              origin: "LEAD_BACKFILL",
              leadIdentityReviewId: lead.identityReviews[0]?.id ?? null,
            },
          });
          await transaction.leadFormSubmission.updateMany({
            where: { workspaceId: context.workspaceId, leadId: lead.id, contactId: null },
            data: { contactId: identity.contactId },
          });
          contactsCreated += identity.createdContact ? 1 : 0;
          pointsCreated += identity.createdPointCount;
          leadsLinked += 1;
          reviewsOpened += identity.reviewIds.length;
          await transaction.contactBackfillItem.create({
            data: {
              workspaceId: context.workspaceId,
              runId: current.id,
              leadId: lead.id,
              contactId: identity.contactId,
              reviewId: identity.reviewIds[0] ?? null,
              ruleVersion: current.ruleVersion,
              idempotencyKey,
              outcome: identity.reviewIds.length > 0 ? "REVIEW_OPENED" : "CREATED",
            },
          });
        }

        const cursorLeadId = leads.at(-1)?.id ?? current.cursorLeadId;
        const remaining = cursorLeadId
          ? await transaction.lead.count({
              where: {
                workspaceId: context.workspaceId,
                deletedAt: null,
                contactId: null,
                id: { gt: cursorLeadId },
              },
            })
          : 0;
        const completed = leads.length === 0 || remaining === 0;
        const updated = await transaction.contactBackfillRun.update({
          where: { id: current.id },
          data: {
            status: completed ? "SUCCEEDED" : "RUNNING",
            startedAt: current.startedAt ?? now,
            finishedAt: completed ? now : null,
            cursorLeadId,
            processedCount: { increment: leads.length },
            contactsCreated: { increment: contactsCreated },
            pointsCreated: { increment: pointsCreated },
            leadsLinked: { increment: leadsLinked },
            reviewsOpened: { increment: reviewsOpened },
            ignoredCount: { increment: ignoredCount },
            updatedByActorId: context.actorId,
          },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "contact.backfill.batch_processed",
            entityType: "ContactBackfillRun",
            entityId: current.id,
            changes: {
              mode: current.mode,
              batchCount: leads.length,
              contactsCreated,
              pointsCreated,
              leadsLinked,
              reviewsOpened,
              ignoredCount,
              completed,
              cursorLeadId,
            },
          },
        });
        return updated;
      }, { isolationLevel: "ReadCommitted" });
      return toView(run);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      const safeMessage = error instanceof Error ? error.message.slice(0, 500) : "Falha não identificada.";
      await options.database.contactBackfillRun.updateMany({
        where: { id: parsed.data.runId, workspaceId: context.workspaceId, status: { not: "SUCCEEDED" } },
        data: { status: "FAILED", lastError: safeMessage, failedCount: { increment: 1 }, updatedByActorId: context.actorId },
      });
      throw error;
    }
  }

  return Object.freeze({ start, getRun, pause, resume, processBatch });
}

let service: ReturnType<typeof createContactBackfillService> | undefined;

export function getContactBackfillService() {
  service ??= createContactBackfillService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return service;
}
