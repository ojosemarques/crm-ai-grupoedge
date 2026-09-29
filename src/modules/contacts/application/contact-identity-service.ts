import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { LeadContactView } from "@/modules/contacts/domain/contact-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

export const CONTACT_IDENTITY_RULE_VERSION = "contact-identity-v1";

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

type LeadIdentityFacts = Readonly<{
  leadId: string;
  fullName: string;
  jobTitle: string | null;
  normalizedPhone: string | null;
  originalPhone: string | null;
  normalizedEmail: string | null;
  originalEmail: string | null;
  doNotContact: boolean;
  origin: "LEAD_INTAKE" | "LEAD_BACKFILL";
  leadIdentityReviewId?: string | null;
  submissionId?: string | null;
}>;

export type ContactIdentityWriteResult = Readonly<{
  contactId: string;
  createdContact: boolean;
  createdPointCount: number;
  reviewIds: readonly string[];
}>;

function normalizedComparable(value: string | null): string | null {
  const normalized = value?.trim().toLocaleLowerCase("pt-BR") ?? "";
  return normalized || null;
}

function fingerprint(parts: readonly (string | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((part) => part ?? "-").join(":"), "utf8").digest("hex");
}

function evidenceForPoint(type: "PHONE" | "EMAIL", normalizedValue: string) {
  const safeHint =
    type === "PHONE"
      ? `final ${normalizedValue.slice(-4)}`
      : `domínio ${normalizedValue.split("@")[1] ?? "não identificado"}`;
  return {
    facts: {
      matchingPointType: type,
      normalizedValueHash: fingerprint([type, normalizedValue]),
      safeHint,
    },
    inference: {
      possibleSharedContactPoint: true,
      automaticMergePerformed: false,
    },
    missingData: [],
  } satisfies Prisma.InputJsonValue;
}

function resourceForLead(lead: Readonly<{
  id: string;
  workspaceId: string;
  ownerMemberId: string | null;
  queueId: string | null;
  routingQueue: { teamId: string | null } | null;
  queue: { teamId: string | null } | null;
}>): ResourceScope {
  return {
    workspaceId: lead.workspaceId,
    resourceType: "Contact",
    resourceId: lead.id,
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.queueId,
    teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
}

async function openReview(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    leadId: string;
    contactId: string;
    candidateContactId: string | null;
    leadIdentityReviewId?: string | null;
    reason: "SHARED_PHONE" | "SHARED_EMAIL" | "PHONE_DIVERGENCE" | "EMAIL_DIVERGENCE" | "NAME_DIVERGENCE" | "JOB_TITLE_DIVERGENCE" | "MULTIPLE_CANDIDATES";
    divergenceFields: readonly ("FULL_NAME" | "JOB_TITLE")[];
    evidence: Prisma.InputJsonValue;
    actorId: string;
  }>,
): Promise<string> {
  const reviewFingerprint = fingerprint([
    CONTACT_IDENTITY_RULE_VERSION,
    input.leadId,
    input.contactId,
    input.candidateContactId,
    input.reason,
  ]);
  const review = await transaction.contactIdentityReview.upsert({
    where: {
      workspaceId_fingerprint: {
        workspaceId: input.workspaceId,
        fingerprint: reviewFingerprint,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      contactId: input.contactId,
      candidateContactId: input.candidateContactId,
      leadIdentityReviewId: input.leadIdentityReviewId ?? null,
      reason: input.reason,
      divergenceFields: [...input.divergenceFields],
      fingerprint: reviewFingerprint,
      evidence: input.evidence,
      createdByActorId: input.actorId,
    },
    update: {},
    select: { id: true },
  });
  return review.id;
}

export async function ensureContactForLeadInTransaction(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    actorId: string;
    facts: LeadIdentityFacts;
  }>,
): Promise<ContactIdentityWriteResult> {
  const pointLocks = [input.facts.normalizedPhone, input.facts.normalizedEmail]
    .filter((value): value is string => Boolean(value))
    .sort();
  for (const value of [`lead:${input.facts.leadId}`, ...pointLocks.map((point) => `point:${point}`)]) {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`contact-identity:${input.workspaceId}:${value}`}, 0)
      )
    `;
  }

  const lead = await transaction.lead.findFirst({
    where: { id: input.facts.leadId, workspaceId: input.workspaceId },
    select: { id: true, contactId: true },
  });
  if (!lead) {
    throw new ApplicationError("Lead não encontrado para criação do contato.", {
      code: "NOT_FOUND",
      statusCode: 404,
      expose: true,
    });
  }

  let createdContact = false;
  const contact = lead.contactId
    ? await transaction.contact.findFirstOrThrow({
        where: { id: lead.contactId, workspaceId: input.workspaceId, deletedAt: null },
      })
    : await transaction.contact.create({
        data: {
          workspaceId: input.workspaceId,
          preferredName: input.facts.fullName,
          jobTitle: input.facts.jobTitle,
          origin: input.facts.origin,
          quality: "UNKNOWN",
          createdByActorId: input.actorId,
          updatedByActorId: input.actorId,
        },
      });
  createdContact = !lead.contactId;

  if (createdContact) {
    await transaction.lead.update({
      where: { id: lead.id },
      data: { contactId: contact.id, updatedByActorId: input.actorId },
    });
    await transaction.auditLog.create({
      data: {
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: "contact.created_from_lead",
        entityType: "Contact",
        entityId: contact.id,
        changes: { leadId: lead.id, origin: input.facts.origin, legacyIdentityPreserved: true },
      },
    });
  }

  if (input.facts.submissionId) {
    await transaction.leadFormSubmission.updateMany({
      where: {
        id: input.facts.submissionId,
        workspaceId: input.workspaceId,
        leadId: input.facts.leadId,
      },
      data: { contactId: contact.id },
    });
  }

  const points = [
    input.facts.normalizedPhone
      ? {
          type: "PHONE" as const,
          normalizedValue: input.facts.normalizedPhone,
          originalValue: input.facts.originalPhone ?? input.facts.normalizedPhone,
          countryCode: input.facts.normalizedPhone.startsWith("+55") ? "BR" : null,
        }
      : null,
    input.facts.normalizedEmail
      ? {
          type: "EMAIL" as const,
          normalizedValue: input.facts.normalizedEmail.toLowerCase(),
          originalValue: input.facts.originalEmail ?? input.facts.normalizedEmail,
          countryCode: null,
        }
      : null,
  ].filter((point): point is NonNullable<typeof point> => Boolean(point));

  let createdPointCount = 0;
  const reviewIds = new Set<string>();
  for (const point of points) {
    const sameTypePoints = await transaction.contactPoint.findMany({
      where: {
        workspaceId: input.workspaceId,
        contactId: contact.id,
        type: point.type,
        deletedAt: null,
      },
      select: { id: true, normalizedValue: true, doNotContact: true, isPrimary: true },
    });
    const existingForContact = sameTypePoints.find(
      (existingPoint) => existingPoint.normalizedValue === point.normalizedValue,
    );
    const divergentNewPoint = !createdContact && !existingForContact && sameTypePoints.length > 0;
    if (existingForContact) {
      if (input.facts.doNotContact && !existingForContact.doNotContact) {
        await transaction.contactPoint.update({
          where: { id: existingForContact.id },
          data: { doNotContact: true, updatedByActorId: input.actorId },
        });
      }
    } else {
      const createdPoint = await transaction.contactPoint.create({
        data: {
          workspaceId: input.workspaceId,
          contactId: contact.id,
          type: point.type,
          originalValue: point.originalValue,
          normalizedValue: point.normalizedValue,
          countryCode: point.countryCode,
          isPrimary: !sameTypePoints.some((existingPoint) => existingPoint.isPrimary),
          quality: divergentNewPoint ? "SUSPECT" : "UNKNOWN",
          source: input.facts.origin,
          doNotContact: input.facts.doNotContact,
          createdByActorId: input.actorId,
          updatedByActorId: input.actorId,
        },
        select: { id: true },
      });
      createdPointCount += 1;
      await transaction.auditLog.create({
        data: {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: "contact.point.created",
          entityType: "ContactPoint",
          entityId: createdPoint.id,
          changes: {
            contactId: contact.id,
            type: point.type,
            valueHash: fingerprint([point.type, point.normalizedValue]),
            doNotContact: input.facts.doNotContact,
          },
        },
      });
      if (divergentNewPoint) {
        const reviewId = await openReview(transaction, {
          workspaceId: input.workspaceId,
          leadId: input.facts.leadId,
          contactId: contact.id,
          candidateContactId: null,
          ...(input.facts.leadIdentityReviewId !== undefined
            ? { leadIdentityReviewId: input.facts.leadIdentityReviewId }
            : {}),
          reason: point.type === "PHONE" ? "PHONE_DIVERGENCE" : "EMAIL_DIVERGENCE",
          divergenceFields: [],
          evidence: {
            facts: {
              pointType: point.type,
              currentValueHashes: sameTypePoints.map((existingPoint) =>
                fingerprint([point.type, existingPoint.normalizedValue]),
              ),
              submittedValueHash: fingerprint([point.type, point.normalizedValue]),
            },
            inference: { possibleDifferentPerson: true, automaticOverwritePerformed: false },
            missingData: [],
          },
          actorId: input.actorId,
        });
        reviewIds.add(reviewId);
      }
    }

    const candidates = await transaction.contactPoint.findMany({
      where: {
        workspaceId: input.workspaceId,
        type: point.type,
        normalizedValue: point.normalizedValue,
        contactId: { not: contact.id },
        deletedAt: null,
        contact: { status: "ACTIVE", deletedAt: null },
      },
      distinct: ["contactId"],
      orderBy: { contactId: "asc" },
      select: { contactId: true },
    });
    for (const candidate of candidates) {
      const reviewId = await openReview(transaction, {
        workspaceId: input.workspaceId,
        leadId: input.facts.leadId,
        contactId: contact.id,
        candidateContactId: candidate.contactId,
        ...(input.facts.leadIdentityReviewId !== undefined
          ? { leadIdentityReviewId: input.facts.leadIdentityReviewId }
          : {}),
        reason: point.type === "PHONE" ? "SHARED_PHONE" : "SHARED_EMAIL",
        divergenceFields: [],
        evidence: evidenceForPoint(point.type, point.normalizedValue),
        actorId: input.actorId,
      });
      reviewIds.add(reviewId);
    }
  }

  if (!createdContact) {
    const divergences = [
      normalizedComparable(contact.preferredName) !== normalizedComparable(input.facts.fullName)
        ? { reason: "NAME_DIVERGENCE" as const, field: "FULL_NAME" as const }
        : null,
      input.facts.jobTitle && normalizedComparable(contact.jobTitle) !== normalizedComparable(input.facts.jobTitle)
        ? { reason: "JOB_TITLE_DIVERGENCE" as const, field: "JOB_TITLE" as const }
        : null,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value));
    for (const divergence of divergences) {
      const reviewId = await openReview(transaction, {
        workspaceId: input.workspaceId,
        leadId: input.facts.leadId,
        contactId: contact.id,
        candidateContactId: null,
        ...(input.facts.leadIdentityReviewId !== undefined
          ? { leadIdentityReviewId: input.facts.leadIdentityReviewId }
          : {}),
        reason: divergence.reason,
        divergenceFields: [divergence.field],
        evidence: {
          facts: { field: divergence.field },
          inference: { trustedValuePreserved: true, automaticOverwritePerformed: false },
          missingData: [],
        },
        actorId: input.actorId,
      });
      reviewIds.add(reviewId);
    }
  }

  if (reviewIds.size > 0) {
    await transaction.contact.update({
      where: { id: contact.id },
      data: { quality: "NEEDS_REVIEW", updatedByActorId: input.actorId },
    });
  }

  return {
    contactId: contact.id,
    createdContact,
    createdPointCount,
    reviewIds: [...reviewIds],
  };
}

const leadQuerySchema = z.object({ leadId: z.string().uuid() }).strict();
const resolveReviewSchema = z
  .object({
    reviewId: z.string().uuid(),
    decision: z.enum(["KEEP_SEPARATE", "DISMISS"]),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export function createContactIdentityService(options: Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>) {
  async function getLeadContact(context: AuthenticatedContext, payload: unknown): Promise<LeadContactView> {
    const parsed = leadQuerySchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApplicationError("Identificador de lead inválido.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    const lead = await options.database.lead.findFirst({
      where: { id: parsed.data.leadId, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        ownerMemberId: true,
        queueId: true,
        routingQueue: { select: { teamId: true } },
        queue: { select: { teamId: true } },
        contact: {
          select: {
            id: true,
            preferredName: true,
            legalName: true,
            jobTitle: true,
            status: true,
            quality: true,
            origin: true,
            points: {
              where: { deletedAt: null },
              orderBy: [{ type: "asc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
              select: {
                id: true,
                type: true,
                originalValue: true,
                normalizedValue: true,
                isPrimary: true,
                verificationStatus: true,
                quality: true,
                doNotContact: true,
                source: true,
              },
            },
          },
        },
        contactIdentityReviews: {
          where: { status: "OPEN" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            reason: true,
            status: true,
            divergenceFields: true,
            candidateContactId: true,
            evidence: true,
            createdAt: true,
            resolvedAt: true,
            resolution: true,
          },
        },
      },
    });
    if (!lead) {
      throw new ApplicationError("Lead não encontrado.", { code: "NOT_FOUND", statusCode: 404, expose: true });
    }
    await Promise.all([
      options.authorization.assertAuthorized(context, PermissionKeys.LEADS_READ, resourceForLead(lead)),
      options.authorization.assertAuthorized(context, PermissionKeys.CONTACTS_READ, resourceForLead(lead)),
    ]);
    const reviewDecision = await options.authorization.authorize(
      context,
      PermissionKeys.CONTACTS_REVIEW,
      resourceForLead(lead),
    );
    return {
      leadId: lead.id,
      canResolveReviews: reviewDecision.allowed,
      contact: lead.contact
        ? {
            id: lead.contact.id,
            preferredName: lead.contact.preferredName,
            legalName: lead.contact.legalName,
            jobTitle: lead.contact.jobTitle,
            status: lead.contact.status,
            quality: lead.contact.quality,
            origin: lead.contact.origin,
            points: lead.contact.points.map((point) => ({
              id: point.id,
              type: point.type,
              value: point.originalValue,
              normalizedValue: point.normalizedValue,
              isPrimary: point.isPrimary,
              verificationStatus: point.verificationStatus,
              quality: point.quality,
              doNotContact: point.doNotContact,
              source: point.source,
            })),
          }
        : null,
      openReviews: lead.contactIdentityReviews.map((review) => ({
        id: review.id,
        reason: review.reason,
        status: review.status,
        divergenceFields: review.divergenceFields,
        candidateContactId: review.candidateContactId,
        evidence: review.evidence,
        createdAt: review.createdAt.toISOString(),
        resolvedAt: review.resolvedAt?.toISOString() ?? null,
        resolution: review.resolution,
      })),
      legacyIdentityPreserved: true,
    };
  }

  async function resolveReview(context: AuthenticatedContext, payload: unknown) {
    const parsed = resolveReviewSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApplicationError("Dados de resolução inválidos.", { code: "INVALID_INPUT", statusCode: 400, expose: true });
    }
    await options.authorization.assertAuthorized(context, PermissionKeys.CONTACTS_REVIEW, {
      workspaceId: context.workspaceId,
      resourceType: "ContactIdentityReview",
      resourceId: parsed.data.reviewId,
    });
    const occurredAt = options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`contact-review:${context.workspaceId}:${parsed.data.reviewId}`}, 0))
      `;
      const review = await transaction.contactIdentityReview.findFirst({
        where: { id: parsed.data.reviewId, workspaceId: context.workspaceId },
      });
      if (!review) {
        throw new ApplicationError("Revisão de identidade não encontrada.", { code: "NOT_FOUND", statusCode: 404, expose: true });
      }
      if (review.status !== "OPEN") {
        throw new ApplicationError("Esta revisão já foi encerrada.", { code: "IDENTITY_REVIEW_CLOSED", statusCode: 409, expose: true });
      }
      const status = parsed.data.decision === "DISMISS" ? "DISMISSED" : "RESOLVED";
      const updated = await transaction.contactIdentityReview.update({
        where: { id: review.id },
        data: {
          status,
          resolution: `${parsed.data.decision}: ${parsed.data.reason}`,
          resolvedAt: occurredAt,
          resolvedByActorId: context.actorId,
        },
        select: { id: true, status: true, resolvedAt: true },
      });
      const openCount = await transaction.contactIdentityReview.count({
        where: { workspaceId: context.workspaceId, contactId: review.contactId, status: "OPEN" },
      });
      if (openCount === 0) {
        await transaction.contact.update({
          where: { id: review.contactId },
          data: { quality: "CONFIRMED", updatedByActorId: context.actorId },
        });
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "contact.identity_review.resolved",
          entityType: "ContactIdentityReview",
          entityId: review.id,
          reason: parsed.data.reason,
          changes: { previousStatus: "OPEN", status, decision: parsed.data.decision, automaticMergePerformed: false },
        },
      });
      return { id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt?.toISOString() ?? null };
    });
  }

  return Object.freeze({ getLeadContact, resolveReview });
}

let service: ReturnType<typeof createContactIdentityService> | undefined;

export function getContactIdentityService() {
  service ??= createContactIdentityService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return service;
}
