import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getProspectingPlannerService } from "@/modules/prospecting/application/prospecting-planner-service";
import { loadOpenDotClients } from "@/modules/prospecting/domain/open-dot-policy";
import {
  PROSPECTING_EMAIL_ALLOWED_VARIABLES,
  PROSPECTING_EMAIL_STEP_KEYS,
  PROSPECTING_EMAIL_TEMPLATE_COUNT,
} from "@/modules/prospecting/domain/prospecting-email-sequence";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE_SETTINGS"), expectedRevision: z.number().int().nonnegative(), releaseEnabled: z.boolean(), emailEgressEnabled: z.boolean(), dailyCapacity: z.number().int().min(1).max(250), reservePercent: z.number().int().min(0).max(50), emailWindowStart: timeSchema, emailWindowEnd: timeSchema, coverageWarningDays: z.number().int().min(1).max(30), coverageCriticalDays: z.number().int().min(1).max(30) }).strict(),
  z.object({ action: z.literal("SAVE_SELLERS"), sellers: z.array(z.object({ memberId: z.string().uuid(), senderProfileId: z.string().uuid().nullable(), active: z.boolean(), dailyCapacity: z.number().int().min(1).max(250), reservePercent: z.number().int().min(0).max(50), dailyEmailLimit: z.number().int().min(1).max(500).nullable(), rotationPosition: z.number().int().min(0).max(20), pausedReason: z.string().trim().min(3).max(240).nullable() }).strict()).min(1).max(20) }).strict(),
  z.object({ action: z.literal("PUBLISH_EMAIL_TEMPLATE"), stepKey: z.enum(PROSPECTING_EMAIL_STEP_KEYS), subject: z.string().trim().min(3).max(200), body: z.string().trim().min(20).max(20_000) }).strict(),
  z.object({ action: z.literal("SAVE_HOLIDAYS"), holidays: z.array(z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(2).max(160) }).strict()).max(100) }).strict(),
  z.object({ action: z.literal("RUN_PLANNER"), limit: z.number().int().min(1).max(2_000).default(2_000) }).strict(),
  z.object({ action: z.literal("START_ACTIVE_INITIAL_EMAILS"), execute: z.boolean(), expectedCount: z.number().int().min(0).max(500).nullable() }).strict(),
  z.object({ action: z.literal("RECORD_PRIVACY_APPROVAL"), evidenceReference: z.string().trim().min(10).max(500), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("RECORD_CANARY_APPROVAL"), evidenceReference: z.string().trim().min(10).max(500), confirmed: z.literal(true) }).strict(),
]);

function fail(message: string, code: string): never {
  throw new ApplicationError(message, { code, statusCode: 409, expose: true });
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]!);
}

export function createProspectingAdministrationService(options: Readonly<{ database: PrismaClient; now: () => Date; environment: NodeJS.ProcessEnv }>) {
  const authorization = getAuthorizationService();

  async function execute(context: AuthenticatedContext, raw: unknown) {
    const input = commandSchema.parse(raw);
    const requiredPermission = input.action === "RECORD_PRIVACY_APPROVAL" ? PermissionKeys.PRIVACY_LEGAL_APPROVE : PermissionKeys.OUTBOUND_CAMPAIGNS_MANAGE;
    await authorization.assertAuthorized(context, requiredPermission, { workspaceId: context.workspaceId, resourceType: "AutomationDefinition" });
    if (input.action === "RUN_PLANNER") {
      return options.database.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospecting-plan:${context.workspaceId}`}, 0))`;
        return getProspectingPlannerService().plan(transaction, { workspaceId: context.workspaceId, actorId: context.actorId, limit: input.limit });
      }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 });
    }
    return options.database.$transaction(async (transaction) => {
      const now = options.now();
      const current = await transaction.prospectingSettings.findUnique({ where: { workspaceId: context.workspaceId } });
      const settings = current ?? await transaction.prospectingSettings.create({ data: { workspaceId: context.workspaceId, createdByActorId: context.actorId, updatedByActorId: context.actorId } });

      if (input.action === "START_ACTIVE_INITIAL_EMAILS") {
        if (!settings.emailEgressEnabled || !settings.privacyApprovedAt || !settings.canaryApprovedAt) {
          fail("Ative o egress e registre as aprovações antes de iniciar os primeiros e-mails.", "PROSPECTING_EMAIL_APPROVALS_MISSING");
        }
        const template = await transaction.prospectingEmailTemplateVersion.findFirst({
          where: { workspaceId: context.workspaceId, stepKey: "email-1", published: true },
          orderBy: { version: "desc" },
          select: { id: true },
        });
        if (!template) fail("O template publicado do primeiro e-mail não foi encontrado.", "PROSPECTING_EMAIL_TEMPLATE_MISSING");
        const candidateJobs = await transaction.prospectingEmailJob.findMany({
          where: {
            workspaceId: context.workspaceId,
            stepKey: "email-1",
            status: { in: ["BLOCKED", "EXPIRED"] },
            sentAt: null,
            providerMessageId: null,
          },
          orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
          take: 5_001,
          select: { id: true, cadenceInstanceId: true, leadId: true, recipientEmail: true },
        });
        if (candidateJobs.length > 5_000) fail("A prévia excedeu o limite seguro de leitura.", "PROSPECTING_INITIAL_EMAIL_SCAN_LIMIT_EXCEEDED");

        const cadences = await transaction.prospectingCadenceInstance.findMany({
          where: {
            id: { in: [...new Set(candidateJobs.map((job) => job.cadenceInstanceId))] },
            workspaceId: context.workspaceId,
            status: "ACTIVE",
            d1GateCompletedAt: { not: null },
          },
          select: { id: true, ownerMemberId: true, d1GateCompletedAt: true },
        });
        const cadenceById = new Map(cadences.map((cadence) => [cadence.id, cadence]));
        const cadenceJobs = candidateJobs.filter((job) => cadenceById.has(job.cadenceInstanceId));
        const leads = await transaction.lead.findMany({
          where: {
            id: { in: [...new Set(cadenceJobs.map((job) => job.leadId))] },
            workspaceId: context.workspaceId,
            status: "OPEN",
            deletedAt: null,
            awaitingHumanResponse: false,
            contactPreference: { not: "DO_NOT_CONTACT" },
            normalizedEmail: { not: null },
            currentStage: { stableKey: "active-prospecting.active-cadence", deletedAt: null },
            meetings: { none: { status: { in: ["SCHEDULED", "CONFIRMED"] }, deletedAt: null } },
          },
          select: { id: true, normalizedEmail: true, lastInboundResponseAt: true },
        });
        const leadById = new Map(leads.map((lead) => [lead.id, lead]));
        const sellerConfigs = await transaction.prospectingSellerConfig.findMany({
          where: {
            workspaceId: context.workspaceId,
            memberId: { in: [...new Set(cadences.map((cadence) => cadence.ownerMemberId))] },
            active: true,
            senderProfileId: { not: null },
            dailyEmailLimit: { not: null },
          },
          select: { memberId: true, senderProfileId: true },
        });
        const sellerByMemberId = new Map(sellerConfigs.map((seller) => [seller.memberId, seller]));
        const readySenders = await transaction.emailConnectionProfile.findMany({
          where: {
            id: { in: sellerConfigs.flatMap((seller) => seller.senderProfileId ? [seller.senderProfileId] : []) },
            workspaceId: context.workspaceId,
            operatingMode: "EXTERNAL_READY",
            spfStatus: "VERIFIED_EXTERNAL",
            dkimStatus: "VERIFIED_EXTERNAL",
            dmarcStatus: "VERIFIED_EXTERNAL",
          },
          select: { id: true },
        });
        const readySenderIds = new Set(readySenders.map((sender) => sender.id));
        const suppressions = await transaction.emailSuppression.findMany({
          where: {
            workspaceId: context.workspaceId,
            normalizedEmail: { in: [...new Set(cadenceJobs.map((job) => job.recipientEmail))] },
            purposeKey: "active-prospecting",
          },
          orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
          select: { normalizedEmail: true, action: true },
        });
        const latestSuppressionByEmail = new Map<string, string>();
        for (const suppression of suppressions) {
          if (!latestSuppressionByEmail.has(suppression.normalizedEmail)) latestSuppressionByEmail.set(suppression.normalizedEmail, suppression.action);
        }

        const eligible: Array<{ jobId: string; senderProfileId: string }> = [];
        for (const job of cadenceJobs) {
          const cadence = cadenceById.get(job.cadenceInstanceId)!;
          const lead = leadById.get(job.leadId);
          if (!lead?.normalizedEmail || lead.normalizedEmail !== job.recipientEmail) continue;
          if (lead.lastInboundResponseAt && lead.lastInboundResponseAt >= cadence.d1GateCompletedAt!) continue;
          if (latestSuppressionByEmail.get(job.recipientEmail) === "APPLIED") continue;
          const seller = sellerByMemberId.get(cadence.ownerMemberId);
          if (seller?.senderProfileId && readySenderIds.has(seller.senderProfileId)) {
            eligible.push({ jobId: job.id, senderProfileId: seller.senderProfileId });
          }
        }

        if (eligible.length > 500) fail("A prévia excedeu o limite seguro de 500 e-mails.", "PROSPECTING_INITIAL_EMAIL_LIMIT_EXCEEDED");
        if (!input.execute) return { action: input.action, mode: "DRY_RUN", eligibleCount: eligible.length };
        if (input.expectedCount === null || input.expectedCount !== eligible.length) {
          fail("A quantidade elegível mudou. Gere uma nova prévia antes de executar.", "PROSPECTING_INITIAL_EMAIL_COUNT_CHANGED");
        }
        const expiresAt = new Date(now.getTime() + 24 * 3_600_000);
        const jobIdsBySenderId = new Map<string, string[]>();
        for (const target of eligible) {
          const jobIds = jobIdsBySenderId.get(target.senderProfileId) ?? [];
          jobIds.push(target.jobId);
          jobIdsBySenderId.set(target.senderProfileId, jobIds);
        }
        let scheduledCount = 0;
        for (const [senderProfileId, jobIds] of jobIdsBySenderId) {
          const updatedJobs = await transaction.prospectingEmailJob.updateMany({
            where: {
              id: { in: jobIds },
              workspaceId: context.workspaceId,
              status: { in: ["BLOCKED", "EXPIRED"] },
              sentAt: null,
              providerMessageId: null,
            },
            data: {
              templateVersionId: template.id,
              senderProfileId,
              status: "SCHEDULED",
              scheduledAt: now,
              expiresAt,
              claimedByClientId: null,
              claimedAt: null,
              leaseExpiresAt: null,
              lastAuthorizedAt: null,
              lastErrorCode: null,
              finalizedAt: null,
            },
          });
          scheduledCount += updatedJobs.count;
          await transaction.prospectingCadenceStep.updateMany({
            where: { workspaceId: context.workspaceId, emailJobId: { in: jobIds } },
            data: { status: "SCHEDULED", scheduledAt: now, resultCode: null, resultReason: null, completedAt: null, cancelledAt: null },
          });
        }
        if (scheduledCount !== eligible.length) {
          fail("A lista elegível mudou durante a execução. Gere uma nova prévia.", "PROSPECTING_INITIAL_EMAIL_COUNT_CHANGED");
        }
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "prospecting.initial_email.started",
            entityType: "ProspectingSettings",
            entityId: settings.id,
            occurredAt: now,
            changes: { eligibleCount: eligible.length, stepKey: "email-1", criteria: "ACTIVE_UNSENT_ELIGIBLE" },
          },
        });
        return { action: input.action, mode: "EXECUTE", scheduledCount };
      }

      if (input.action === "SAVE_SETTINGS") {
        if (settings.revision !== input.expectedRevision) fail("A configuração mudou. Recarregue antes de salvar.", "PROSPECTING_SETTINGS_REVISION_CONFLICT");
        if (input.coverageCriticalDays >= input.coverageWarningDays) fail("O limite crítico deve ser menor que o limite de alerta.", "PROSPECTING_COVERAGE_THRESHOLDS_INVALID");
        if (input.emailWindowStart >= input.emailWindowEnd) fail("A janela de envio precisa terminar depois do início.", "PROSPECTING_EMAIL_WINDOW_INVALID");
        if (input.releaseEnabled) {
          const [sellerCount, stageCount] = await Promise.all([
            transaction.prospectingSellerConfig.count({ where: { workspaceId: context.workspaceId, active: true } }),
            transaction.pipelineStage.count({ where: { workspaceId: context.workspaceId, pipeline: { name: "Prospecção Ativa", entityType: "LEAD", deletedAt: null }, stableKey: { startsWith: "active-prospecting." }, deletedAt: null } }),
          ]);
          if (sellerCount === 0 || stageCount !== 7) fail("A liberação exige vendedores ativos e as sete etapas estáveis.", "PROSPECTING_RELEASE_FOUNDATION_INCOMPLETE");
        }
        if (input.emailEgressEnabled) {
          if (!settings.privacyApprovedAt || !settings.canaryApprovedAt) fail("Egress exige aprovação formal de privacidade e do canário.", "PROSPECTING_EMAIL_APPROVALS_MISSING");
          const [templateKeys, activeSellers] = await Promise.all([
            transaction.prospectingEmailTemplateVersion.findMany({ where: { workspaceId: context.workspaceId, published: true }, distinct: ["stepKey"], select: { stepKey: true } }),
            transaction.prospectingSellerConfig.findMany({ where: { workspaceId: context.workspaceId, active: true }, select: { senderProfileId: true, dailyEmailLimit: true } }),
          ]);
          const senderProfileIds = [...new Set(activeSellers.flatMap((seller) => seller.senderProfileId ? [seller.senderProfileId] : []))];
          const readySenderCount = await transaction.emailConnectionProfile.count({ where: { workspaceId: context.workspaceId, id: { in: senderProfileIds }, operatingMode: "EXTERNAL_READY", spfStatus: "VERIFIED_EXTERNAL", dkimStatus: "VERIFIED_EXTERNAL", dmarcStatus: "VERIFIED_EXTERNAL" } });
          const sellersReady = activeSellers.length > 0 && activeSellers.every((seller) => seller.senderProfileId && seller.dailyEmailLimit) && readySenderCount === senderProfileIds.length;
          const clientReady = loadOpenDotClients(options.environment).some((client) => client.workspaceId === context.workspaceId && client.scopes.includes("EMAIL_CLAIM") && client.scopes.includes("EMAIL_RECEIPT"));
          if (templateKeys.length !== PROSPECTING_EMAIL_TEMPLATE_COUNT || !sellersReady || !clientReady) fail(`Egress exige ${PROSPECTING_EMAIL_TEMPLATE_COUNT} templates, remetentes mapeados/verificados e cliente Open-Dot de e-mail.`, "PROSPECTING_EMAIL_FOUNDATION_INCOMPLETE");
        }
        const updated = await transaction.prospectingSettings.update({ where: { id: settings.id }, data: { releaseEnabled: input.releaseEnabled, emailEgressEnabled: input.emailEgressEnabled, dailyCapacity: input.dailyCapacity, reservePercent: input.reservePercent, emailWindowStart: input.emailWindowStart, emailWindowEnd: input.emailWindowEnd, coverageWarningDays: input.coverageWarningDays, coverageCriticalDays: input.coverageCriticalDays, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        if (!settings.releaseEnabled && updated.releaseEnabled) {
          await transaction.prospectRelease.updateMany({
            where: { workspaceId: context.workspaceId, status: "DEFERRED", reasonCode: "RELEASE_DISABLED" },
            data: { status: "PLANNED", reasonCode: null, nextAttemptAt: null },
          });
        }
        if (!settings.emailEgressEnabled && updated.emailEgressEnabled) {
          const [activeCadences, activeSellerConfigs, publishedTemplates] = await Promise.all([
            transaction.prospectingCadenceInstance.findMany({
              where: { workspaceId: context.workspaceId, status: "ACTIVE", d1GateCompletedAt: { not: null } },
              select: { id: true, ownerMemberId: true },
            }),
            transaction.prospectingSellerConfig.findMany({
              where: { workspaceId: context.workspaceId, active: true, senderProfileId: { not: null }, dailyEmailLimit: { not: null } },
              select: { memberId: true, senderProfileId: true },
            }),
            transaction.prospectingEmailTemplateVersion.findMany({
              where: { workspaceId: context.workspaceId, published: true },
              orderBy: { version: "desc" },
              select: { id: true, stepKey: true },
            }),
          ]);
          const senderByMemberId = new Map(activeSellerConfigs.flatMap((seller) => seller.senderProfileId ? [[seller.memberId, seller.senderProfileId] as const] : []));
          const cadenceIdsBySenderId = new Map<string, string[]>();
          for (const cadence of activeCadences) {
            const senderProfileId = senderByMemberId.get(cadence.ownerMemberId);
            if (!senderProfileId) continue;
            const cadenceIds = cadenceIdsBySenderId.get(senderProfileId) ?? [];
            cadenceIds.push(cadence.id);
            cadenceIdsBySenderId.set(senderProfileId, cadenceIds);
          }
          const latestTemplateByStep = new Map<string, string>();
          for (const template of publishedTemplates) {
            if (!latestTemplateByStep.has(template.stepKey)) latestTemplateByStep.set(template.stepKey, template.id);
          }
          for (const [senderProfileId, cadenceInstanceIds] of cadenceIdsBySenderId) {
            for (const [stepKey, templateVersionId] of latestTemplateByStep) {
              const jobs = await transaction.prospectingEmailJob.findMany({
                where: {
                  workspaceId: context.workspaceId,
                  cadenceInstanceId: { in: cadenceInstanceIds },
                  stepKey,
                  status: "BLOCKED",
                  expiresAt: { gt: now },
                },
                select: { id: true },
              });
              const jobIds = jobs.map((job) => job.id);
              if (jobIds.length === 0) continue;
              await transaction.prospectingEmailJob.updateMany({
                where: { id: { in: jobIds }, workspaceId: context.workspaceId, status: "BLOCKED" },
                data: { templateVersionId, senderProfileId, status: "SCHEDULED", lastErrorCode: null, finalizedAt: null },
              });
              await transaction.prospectingCadenceStep.updateMany({
                where: { workspaceId: context.workspaceId, emailJobId: { in: jobIds }, status: "BLOCKED" },
                data: { status: "SCHEDULED", resultReason: null },
              });
            }
          }
        }
        await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "prospecting.settings.updated", entityType: "ProspectingSettings", entityId: settings.id, occurredAt: now, changes: { releaseEnabled: updated.releaseEnabled, emailEgressEnabled: updated.emailEgressEnabled, dailyCapacity: updated.dailyCapacity, reservePercent: updated.reservePercent, revision: updated.revision } } });
        return { action: input.action, revision: updated.revision };
      }

      if (input.action === "SAVE_SELLERS") {
        if (new Set(input.sellers.map((seller) => seller.memberId)).size !== input.sellers.length || new Set(input.sellers.map((seller) => seller.rotationPosition)).size !== input.sellers.length) fail("Membro e posição de rotação precisam ser únicos.", "PROSPECTING_SELLERS_DUPLICATED");
        const eligible = await transaction.workspaceMember.count({ where: {
          ...commercialMemberWhere({ workspaceId: context.workspaceId, functions: ["SDR", "CLOSER"] }),
          id: { in: input.sellers.map((seller) => seller.memberId) },
        } });
        if (eligible !== input.sellers.length) fail("Há vendedor inexistente ou inativo na seleção.", "PROSPECTING_SELLER_INELIGIBLE");
        const senderProfileIds = input.sellers.flatMap((seller) => seller.senderProfileId ? [seller.senderProfileId] : []);
        const senderCount = await transaction.emailConnectionProfile.count({ where: { workspaceId: context.workspaceId, id: { in: senderProfileIds } } });
        if (senderCount !== new Set(senderProfileIds).size) fail("Há remetente que não pertence ao workspace.", "PROSPECTING_SELLER_SENDER_INVALID");
        // Libera temporariamente todas as posições para permitir trocas atômicas sob a chave única.
        await transaction.prospectingSellerConfig.updateMany({
          where: { workspaceId: context.workspaceId },
          data: { rotationPosition: { increment: 1_000 } },
        });
        await transaction.prospectingSellerConfig.updateMany({ where: { workspaceId: context.workspaceId, memberId: { notIn: input.sellers.map((seller) => seller.memberId) } }, data: { active: false, pausedReason: "REMOVED_FROM_ACTIVE_CONFIGURATION", updatedByActorId: context.actorId } });
        for (const seller of input.sellers) {
          await transaction.prospectingSellerConfig.upsert({ where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: seller.memberId } }, create: { workspaceId: context.workspaceId, ...seller, createdByActorId: context.actorId, updatedByActorId: context.actorId }, update: { senderProfileId: seller.senderProfileId, active: seller.active, dailyCapacity: seller.dailyCapacity, reservePercent: seller.reservePercent, dailyEmailLimit: seller.dailyEmailLimit, rotationPosition: seller.rotationPosition, pausedReason: seller.pausedReason, updatedByActorId: context.actorId } });
        }
        await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "prospecting.sellers.updated", entityType: "ProspectingSettings", entityId: settings.id, occurredAt: now, changes: { memberIds: input.sellers.map((seller) => seller.memberId), count: input.sellers.length } } });
        return { action: input.action, count: input.sellers.length };
      }

      if (input.action === "PUBLISH_EMAIL_TEMPLATE") {
        const unknown = [...placeholders(input.subject), ...placeholders(input.body)].filter((variable) => !(PROSPECTING_EMAIL_ALLOWED_VARIABLES as readonly string[]).includes(variable));
        if (unknown.length) fail(`Variável de template não permitida: ${[...new Set(unknown)].join(", ")}.`, "PROSPECTING_EMAIL_TEMPLATE_VARIABLE_INVALID");
        const last = await transaction.prospectingEmailTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, stepKey: input.stepKey }, orderBy: { version: "desc" }, select: { version: true } });
        const contentHash = createHash("sha256").update(`${input.subject}\n${input.body}`).digest("hex");
        const duplicate = await transaction.prospectingEmailTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, stepKey: input.stepKey, contentHash }, select: { id: true, version: true } });
        if (duplicate) return { action: input.action, id: duplicate.id, version: duplicate.version, duplicate: true };
        const template = await transaction.prospectingEmailTemplateVersion.create({ data: { workspaceId: context.workspaceId, stepKey: input.stepKey, version: (last?.version ?? 0) + 1, subjectTemplate: input.subject, bodyTemplate: input.body, allowedVariables: [...PROSPECTING_EMAIL_ALLOWED_VARIABLES], contentHash, published: true, publishedAt: now, createdByActorId: context.actorId } });
        await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "prospecting.email_template.published", entityType: "ProspectingEmailTemplateVersion", entityId: template.id, occurredAt: now, changes: { stepKey: template.stepKey, version: template.version, contentHash } } });
        return { action: input.action, id: template.id, version: template.version, duplicate: false };
      }

      if (input.action === "SAVE_HOLIDAYS") {
        const retainedDates = input.holidays.map((holiday) => new Date(`${holiday.localDate}T00:00:00.000Z`));
        await transaction.prospectingCalendarHoliday.deleteMany({
          where: { workspaceId: context.workspaceId, ...(retainedDates.length ? { localDate: { notIn: retainedDates } } : {}) },
        });
        for (const holiday of input.holidays) await transaction.prospectingCalendarHoliday.upsert({ where: { workspaceId_localDate: { workspaceId: context.workspaceId, localDate: new Date(`${holiday.localDate}T00:00:00.000Z`) } }, create: { workspaceId: context.workspaceId, localDate: new Date(`${holiday.localDate}T00:00:00.000Z`), name: holiday.name, createdByActorId: context.actorId }, update: { name: holiday.name } });
        await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "prospecting.calendar.updated", entityType: "ProspectingSettings", entityId: settings.id, occurredAt: now, changes: { holidayCount: input.holidays.length } } });
        return { action: input.action, count: input.holidays.length };
      }

      const approvalField = input.action === "RECORD_PRIVACY_APPROVAL" ? "privacyApprovedAt" : "canaryApprovedAt";
      await transaction.prospectingSettings.update({ where: { id: settings.id }, data: { [approvalField]: now, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: input.action === "RECORD_PRIVACY_APPROVAL" ? "prospecting.privacy.approved" : "prospecting.canary.approved", entityType: "ProspectingSettings", entityId: settings.id, occurredAt: now, changes: { evidenceReference: input.evidenceReference, confirmed: true } } });
      return { action: input.action, approvedAt: now.toISOString() };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
  }

  return Object.freeze({ execute });
}

let singleton: ReturnType<typeof createProspectingAdministrationService> | undefined;
export function getProspectingAdministrationService() {
  singleton ??= createProspectingAdministrationService({ database: getDatabaseClient(), now: () => new Date(), environment: process.env });
  return singleton;
}
