import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import type { OpenDotPrincipal } from "@/modules/prospecting/domain/open-dot-policy";
import { sha256 } from "@/modules/prospecting/domain/open-dot-policy";
import { stopColdCadenceInTransaction } from "@/modules/prospecting/application/prospecting-cadence-service";
import {
  emailClaimInputSchema,
  emailEventInputSchema,
  emailReceiptInputSchema,
} from "@/modules/prospecting/domain/prospecting-contracts";
import { isBusinessDate, nextBusinessDate } from "@/modules/prospecting/domain/prospecting-cadence";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { addLocalDays, parseWorkspaceLocalDateTime, workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

type Database = PrismaClient | Prisma.TransactionClient;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function render(template: string, variables: Readonly<Record<string, string>>): string {
  const rendered = template.replace(/\{([a-z_]+)\}/g, (_match, key: string) => variables[key] ?? `{${key}}`);
  if (/\{[a-z_]+\}/.test(rendered)) fail("O template possui variável obrigatória sem valor.", "PROSPECTING_EMAIL_VARIABLE_MISSING");
  return rendered;
}

function localTime(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function canApplyProviderEvent(current: string, incoming: "DELIVERED" | "REPLIED" | "BOUNCED" | "COMPLAINT" | "UNSUBSCRIBED"): boolean {
  if (current === "COMPLAINT" || current === "UNSUBSCRIBED") return false;
  if (current === "REPLIED") return incoming === "COMPLAINT" || incoming === "UNSUBSCRIBED";
  if (current === "BOUNCED") return incoming === "COMPLAINT" || incoming === "UNSUBSCRIBED";
  if (incoming === "DELIVERED") return current === "SENT" || current === "DELIVERED";
  return ["SENT", "DELIVERED", incoming].includes(current);
}

async function eligibility(database: Database, workspaceId: string, jobId: string, now: Date) {
  const job = await database.prospectingEmailJob.findFirst({
    where: { id: jobId, workspaceId },
  });
  if (!job) fail("Job de e-mail não encontrado.", "PROSPECTING_EMAIL_JOB_NOT_FOUND", 404);
  const [settings, workspace, cadence, lead, template, sender, suppression, meeting] = await Promise.all([
    database.prospectingSettings.findUnique({ where: { workspaceId } }),
    database.workspace.findUnique({ where: { id: workspaceId }, select: { timeZone: true } }),
    database.prospectingCadenceInstance.findUnique({ where: { id: job.cadenceInstanceId } }),
    database.lead.findFirst({ where: { id: job.leadId, workspaceId, deletedAt: null } }),
    job.templateVersionId ? database.prospectingEmailTemplateVersion.findFirst({ where: { id: job.templateVersionId, workspaceId, published: true } }) : null,
    job.senderProfileId ? database.emailConnectionProfile.findFirst({ where: { id: job.senderProfileId, workspaceId } }) : null,
    database.emailSuppression.findFirst({ where: { workspaceId, normalizedEmail: job.recipientEmail, purposeKey: "active-prospecting" }, orderBy: { effectiveAt: "desc" } }),
    database.meeting.findFirst({ where: { workspaceId, leadId: job.leadId, status: { in: ["SCHEDULED", "CONFIRMED"] }, deletedAt: null }, select: { id: true } }),
  ]);
  const todayLocal = workspace ? workspaceDateAt(now, workspace.timeZone) : null;
  const holidays = new Set(todayLocal ? (await database.prospectingCalendarHoliday.findMany({
    where: { workspaceId, localDate: { gte: new Date(`${todayLocal}T00:00:00.000Z`) } },
    select: { localDate: true },
  })).map((item) => item.localDate.toISOString().slice(0, 10)) : []);
  const sellerConfig = cadence && job.senderProfileId ? await database.prospectingSellerConfig.findFirst({
    where: { workspaceId, memberId: cadence.ownerMemberId, senderProfileId: job.senderProfileId, active: true },
    select: { dailyEmailLimit: true },
  }) : null;
  const todayRange = workspace && todayLocal ? workspaceDayRange(todayLocal, workspace.timeZone) : null;
  const sentBySenderToday = job.senderProfileId && todayRange ? await database.prospectingEmailJob.count({
    where: { workspaceId, senderProfileId: job.senderProfileId, sentAt: { gte: todayRange.start, lt: todayRange.end } },
  }) : 0;
  let reason: string | null = null;
  if (job.expiresAt <= now) reason = "JOB_EXPIRED";
  else if (!settings?.emailEgressEnabled || !settings.privacyApprovedAt || !settings.canaryApprovedAt) reason = "EGRESS_NOT_APPROVED";
  else if (!workspace || !todayLocal) reason = "WORKSPACE_TIME_ZONE_UNAVAILABLE";
  else if (!isBusinessDate(todayLocal, holidays)) reason = "NON_BUSINESS_DAY";
  else if (localTime(now, workspace.timeZone) < settings.emailWindowStart || localTime(now, workspace.timeZone) > settings.emailWindowEnd) reason = "OUTSIDE_SENDING_WINDOW";
  else if (!cadence || cadence.status !== "ACTIVE") reason = "CADENCE_NOT_ACTIVE";
  else if (!lead || lead.status !== "OPEN" || lead.contactPreference === "DO_NOT_CONTACT" || lead.awaitingHumanResponse) reason = "LEAD_NOT_ELIGIBLE";
  else if (meeting) reason = "MEETING_EXISTS";
  else if (!template) reason = "TEMPLATE_NOT_PUBLISHED";
  else if (!sender || sender.operatingMode !== "EXTERNAL_READY" || sender.spfStatus !== "VERIFIED_EXTERNAL" || sender.dkimStatus !== "VERIFIED_EXTERNAL" || sender.dmarcStatus !== "VERIFIED_EXTERNAL") reason = "SENDER_NOT_READY";
  else if (suppression?.action === "APPLIED") reason = "EMAIL_SUPPRESSED";
  else if (!sellerConfig?.dailyEmailLimit) reason = "SENDER_LIMIT_NOT_CONFIGURED";
  else if (sentBySenderToday >= sellerConfig.dailyEmailLimit) reason = "SENDER_DAILY_LIMIT";
  let deferUntil: Date | null = null;
  if (workspace && todayLocal && settings && (reason === "NON_BUSINESS_DAY" || reason === "OUTSIDE_SENDING_WINDOW" || reason === "SENDER_DAILY_LIMIT")) {
    const currentLocalTime = localTime(now, workspace.timeZone);
    const targetDate = reason === "OUTSIDE_SENDING_WINDOW" && isBusinessDate(todayLocal, holidays) && currentLocalTime < settings.emailWindowStart
      ? todayLocal
      : nextBusinessDate(addLocalDays(todayLocal, 1), holidays);
    deferUntil = parseWorkspaceLocalDateTime(`${targetDate}T${settings.emailWindowStart}`, workspace.timeZone);
  }
  return { job, settings, cadence, lead, template, sender, reason, deferUntil };
}

export function createProspectingEmailService(options: Readonly<{ database: PrismaClient; now: () => Date }>) {
  async function claim(database: Prisma.TransactionClient, principal: OpenDotPrincipal, raw: unknown) {
    const input = emailClaimInputSchema.parse(raw);
    const now = options.now();
    const candidates = await database.prospectingEmailJob.findMany({
      where: { workspaceId: principal.workspaceId, scheduledAt: { lte: now }, expiresAt: { gt: now }, OR: [{ status: "SCHEDULED" }, { status: "CLAIMED", leaseExpiresAt: { lt: now } }] },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: input.limit * 3,
      select: { id: true },
    });
    const claimed: Record<string, unknown>[] = [];
    for (const candidate of candidates) {
      if (claimed.length >= input.limit) break;
      const state = await eligibility(database, principal.workspaceId, candidate.id, now);
      if (state.reason) {
        if (["OUTSIDE_SENDING_WINDOW", "NON_BUSINESS_DAY", "SENDER_DAILY_LIMIT"].includes(state.reason)) {
          const expired = !state.deferUntil || state.deferUntil >= state.job.expiresAt;
          await database.prospectingEmailJob.update({ where: { id: state.job.id }, data: expired
            ? { status: "EXPIRED", finalizedAt: now, lastErrorCode: "DEFERRED_PAST_EXPIRY", lastAuthorizedAt: null }
            : { status: "SCHEDULED", scheduledAt: state.deferUntil!, finalizedAt: null, lastErrorCode: state.reason, lastAuthorizedAt: null } });
          continue;
        }
        const blocked = ["EGRESS_NOT_APPROVED", "TEMPLATE_NOT_PUBLISHED", "SENDER_NOT_READY", "SENDER_LIMIT_NOT_CONFIGURED", "WORKSPACE_TIME_ZONE_UNAVAILABLE"].includes(state.reason);
        await database.prospectingEmailJob.update({ where: { id: state.job.id }, data: { status: state.reason === "JOB_EXPIRED" ? "EXPIRED" : blocked ? "BLOCKED" : "SUPPRESSED", finalizedAt: blocked ? null : now, lastErrorCode: state.reason, lastAuthorizedAt: null } });
        continue;
      }
      const owner = await database.workspaceMember.findUniqueOrThrow({ where: { id: state.cadence!.ownerMemberId }, select: { user: { select: { displayName: true } } } });
      const candidateRow = await database.prospectCandidate.findUniqueOrThrow({ where: { id: state.cadence!.candidateId } });
      const variables = {
        primeiro_nome: state.lead!.fullName.split(/\s+/)[0] ?? state.lead!.fullName,
        nome: state.lead!.fullName,
        cargo: candidateRow.role === "MAYOR" ? "Prefeito" : "Vereador",
        municipio: candidateRow.municipalityName,
        uf: candidateRow.stateCode,
        nome_vendedor: owner.user.displayName,
        assinatura: state.sender!.displayName,
      };
      const renderedSubject = render(state.template!.subjectTemplate, variables);
      const renderedBody = render(state.template!.bodyTemplate, variables);
      const updated = await database.prospectingEmailJob.updateMany({
        where: { id: state.job.id, workspaceId: principal.workspaceId, OR: [{ status: "SCHEDULED" }, { status: "CLAIMED", leaseExpiresAt: { lt: now } }] },
        data: { status: "CLAIMED", claimedByClientId: principal.clientId, claimedAt: now, leaseExpiresAt: new Date(now.getTime() + input.leaseSeconds * 1_000), lastAuthorizedAt: null, renderedSubject, renderedBody, attemptCount: { increment: 1 } },
      });
      if (updated.count !== 1) continue;
      claimed.push({
        id: state.job.id,
        stepKey: state.job.stepKey,
        recipient: state.job.recipientEmail,
        sender: state.sender!.senderAddressNormalized,
        replyTo: state.sender!.replyTo,
        subject: renderedSubject,
        body: renderedBody,
        idempotencyKey: state.job.idempotencyKey,
        scheduledAt: state.job.scheduledAt.toISOString(),
        expiresAt: state.job.expiresAt.toISOString(),
      });
    }
    return { jobs: claimed, claimed: claimed.length };
  }

  async function revalidate(database: Prisma.TransactionClient, principal: OpenDotPrincipal, jobId: string) {
    const now = options.now();
    const state = await eligibility(database, principal.workspaceId, jobId, now);
    if (state.job.status !== "CLAIMED" || state.job.claimedByClientId !== principal.clientId || !state.job.leaseExpiresAt || state.job.leaseExpiresAt <= now) {
      return { authorized: false, disposition: "CANCELLED", reason: "CLAIM_INVALID" };
    }
    if (state.reason) {
      if (["OUTSIDE_SENDING_WINDOW", "NON_BUSINESS_DAY", "SENDER_DAILY_LIMIT"].includes(state.reason)) {
        const expired = !state.deferUntil || state.deferUntil >= state.job.expiresAt;
        await database.prospectingEmailJob.update({ where: { id: state.job.id }, data: expired
          ? { status: "EXPIRED", finalizedAt: now, leaseExpiresAt: null, lastAuthorizedAt: null, lastErrorCode: "DEFERRED_PAST_EXPIRY" }
          : { status: "SCHEDULED", scheduledAt: state.deferUntil!, leaseExpiresAt: null, lastAuthorizedAt: null, lastErrorCode: state.reason } });
        return { authorized: false, disposition: expired ? "EXPIRED" : "DEFERRED", reason: expired ? "DEFERRED_PAST_EXPIRY" : state.reason };
      }
      const blocked = ["EGRESS_NOT_APPROVED", "TEMPLATE_NOT_PUBLISHED", "SENDER_NOT_READY", "SENDER_LIMIT_NOT_CONFIGURED", "WORKSPACE_TIME_ZONE_UNAVAILABLE"].includes(state.reason);
      await database.prospectingEmailJob.update({ where: { id: state.job.id }, data: { status: state.reason === "JOB_EXPIRED" ? "EXPIRED" : blocked ? "BLOCKED" : "SUPPRESSED", finalizedAt: blocked ? null : now, lastErrorCode: state.reason, leaseExpiresAt: null, lastAuthorizedAt: null } });
      return { authorized: false, disposition: state.reason === "JOB_EXPIRED" ? "EXPIRED" : blocked ? "BLOCKED" : "SUPPRESSED", reason: state.reason };
    }
    const authorized = await database.prospectingEmailJob.updateMany({
      where: { id: state.job.id, workspaceId: principal.workspaceId, status: "CLAIMED", claimedByClientId: principal.clientId, leaseExpiresAt: { gt: now } },
      data: { lastAuthorizedAt: now },
    });
    if (authorized.count !== 1) return { authorized: false, disposition: "CANCELLED", reason: "CLAIM_INVALID" };
    return { authorized: true, disposition: "AUTHORIZED", jobId: state.job.id, idempotencyKey: state.job.idempotencyKey, leaseExpiresAt: state.job.leaseExpiresAt.toISOString(), authorizedAt: now.toISOString() };
  }

  async function receipt(database: Prisma.TransactionClient, principal: OpenDotPrincipal, jobId: string, raw: unknown) {
    const input = emailReceiptInputSchema.parse(raw);
    const now = options.now();
    const job = await database.prospectingEmailJob.findFirst({ where: { id: jobId, workspaceId: principal.workspaceId } });
    if (!job) fail("Job de e-mail não encontrado.", "PROSPECTING_EMAIL_JOB_NOT_FOUND", 404);
    if (job.status === "SENT" && input.outcome === "SENT" && job.providerMessageId === input.providerMessageId) return { job: { id: job.id, status: job.status }, duplicate: true };
    if (job.status !== "CLAIMED" || job.claimedByClientId !== principal.clientId) fail("O cliente não possui claim válido para este job.", "PROSPECTING_EMAIL_CLAIM_INVALID");
    const occurredAt = new Date(input.occurredAt);
    if (
      input.outcome !== "RECONCILIATION_REQUIRED"
      && (!job.lastAuthorizedAt || !job.leaseExpiresAt || occurredAt < job.lastAuthorizedAt || occurredAt > job.leaseExpiresAt)
    ) fail("O envio não possui revalidação válida dentro do lease.", "PROSPECTING_EMAIL_REVALIDATION_REQUIRED");
    const retryAt = new Date(now.getTime() + 5 * 60_000 * 2 ** Math.max(0, job.attemptCount - 1));
    const retryRequested = input.outcome === "FAILED" && input.retryable && job.attemptCount < 3;
    const retryScheduled = retryRequested && retryAt < job.expiresAt;
    const status = retryScheduled ? "SCHEDULED" as const : retryRequested ? "EXPIRED" as const : input.outcome;
    const updated = await database.prospectingEmailJob.update({
      where: { id: job.id },
      data: {
        status,
        providerMessageId: input.providerMessageId ?? null,
        providerThreadId: input.providerThreadId ?? null,
        lastErrorCode: input.errorCode ?? null,
        sentAt: status === "SENT" ? occurredAt : null,
        scheduledAt: retryScheduled ? retryAt : job.scheduledAt,
        finalizedAt: status === "FAILED" || status === "RECONCILIATION_REQUIRED" || status === "EXPIRED" ? occurredAt : null,
        leaseExpiresAt: null,
        lastAuthorizedAt: null,
      },
      select: { id: true, status: true, providerMessageId: true },
    });
    await database.prospectingCadenceStep.updateMany({ where: { workspaceId: principal.workspaceId, emailJobId: job.id }, data: { status: status === "SENT" ? "COMPLETED" : status === "SCHEDULED" ? "SCHEDULED" : status === "EXPIRED" ? "EXPIRED" : "FAILED", resultCode: status, resultReason: input.errorCode ?? null, completedAt: status === "SENT" ? occurredAt : null } });
    return { job: updated, duplicate: false, retryScheduled, recordedAt: now.toISOString() };
  }

  async function event(database: Prisma.TransactionClient, principal: OpenDotPrincipal, raw: unknown) {
    const input = emailEventInputSchema.parse(raw);
    const payloadHash = sha256(JSON.stringify(input));
    const existing = await database.prospectingEmailEvent.findUnique({ where: { workspaceId_externalEventId: { workspaceId: principal.workspaceId, externalEventId: input.externalEventId } }, select: { id: true, payloadHash: true } });
    if (existing) {
      if (existing.payloadHash !== payloadHash) fail("O evento externo já existe com outro payload.", "PROSPECTING_EMAIL_EVENT_CONFLICT");
      return { eventId: existing.id, duplicate: true };
    }
    const job = await database.prospectingEmailJob.findFirst({ where: { workspaceId: principal.workspaceId, providerMessageId: input.providerMessageId } });
    const recorded = await database.prospectingEmailEvent.create({ data: { workspaceId: principal.workspaceId, emailJobId: job?.id ?? null, externalEventId: input.externalEventId, eventType: input.type, providerMessageId: input.providerMessageId, payloadHash, safeMetadata: { automaticReply: input.automaticReply }, occurredAt: new Date(input.occurredAt) }, select: { id: true } });
    if (!job) return { eventId: recorded.id, duplicate: false, matched: false };
    if (!canApplyProviderEvent(job.status, input.type)) return { eventId: recorded.id, duplicate: false, matched: true, applied: false, reason: "NON_MONOTONIC_EVENT" };
    await database.prospectingEmailJob.update({ where: { id: job.id }, data: { status: input.type, finalizedAt: ["BOUNCED", "COMPLAINT", "UNSUBSCRIBED", "REPLIED"].includes(input.type) ? new Date(input.occurredAt) : null } });
    if (input.type === "REPLIED") {
      await stopColdCadenceInTransaction(database, { workspaceId: principal.workspaceId, leadId: job.leadId, actorId: principal.actorId, reason: input.automaticReply ? "AUTO_REPLY" : "HUMAN_REPLY", occurredAt: new Date(input.occurredAt) });
    } else if (input.type === "BOUNCED") {
      await stopColdCadenceInTransaction(database, { workspaceId: principal.workspaceId, leadId: job.leadId, actorId: principal.actorId, reason: "BOUNCE", occurredAt: new Date(input.occurredAt) });
    } else if (input.type === "COMPLAINT" || input.type === "UNSUBSCRIBED") {
      await stopColdCadenceInTransaction(database, { workspaceId: principal.workspaceId, leadId: job.leadId, actorId: principal.actorId, reason: "DO_NOT_CONTACT", occurredAt: new Date(input.occurredAt) });
    }
    return { eventId: recorded.id, duplicate: false, matched: true, applied: true };
  }

  return Object.freeze({ claim, revalidate, receipt, event });
}

let singleton: ReturnType<typeof createProspectingEmailService> | undefined;
export function getProspectingEmailService() {
  singleton ??= createProspectingEmailService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
