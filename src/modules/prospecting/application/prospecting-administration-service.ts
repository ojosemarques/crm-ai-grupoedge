import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getProspectingPlannerService } from "@/modules/prospecting/application/prospecting-planner-service";
import { loadOpenDotClients } from "@/modules/prospecting/domain/open-dot-policy";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const emailStepKeys = ["email-1", "email-2", "email-3", "email-4", "email-5", "email-6", "email-7"] as const;
const allowedVariables = ["primeiro_nome", "nome", "cargo", "municipio", "uf", "nome_vendedor", "assinatura"] as const;
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE_SETTINGS"), expectedRevision: z.number().int().nonnegative(), releaseEnabled: z.boolean(), emailEgressEnabled: z.boolean(), dailyCapacity: z.number().int().min(1).max(250), reservePercent: z.number().int().min(0).max(50), emailWindowStart: timeSchema, emailWindowEnd: timeSchema, coverageWarningDays: z.number().int().min(1).max(30), coverageCriticalDays: z.number().int().min(1).max(30) }).strict(),
  z.object({ action: z.literal("SAVE_SELLERS"), sellers: z.array(z.object({ memberId: z.string().uuid(), senderProfileId: z.string().uuid().nullable(), active: z.boolean(), dailyCapacity: z.number().int().min(1).max(250), reservePercent: z.number().int().min(0).max(50), dailyEmailLimit: z.number().int().min(1).max(500).nullable(), rotationPosition: z.number().int().min(0).max(20), pausedReason: z.string().trim().min(3).max(240).nullable() }).strict()).min(1).max(20) }).strict(),
  z.object({ action: z.literal("PUBLISH_EMAIL_TEMPLATE"), stepKey: z.enum(emailStepKeys), subject: z.string().trim().min(3).max(200), body: z.string().trim().min(20).max(20_000) }).strict(),
  z.object({ action: z.literal("SAVE_HOLIDAYS"), holidays: z.array(z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(2).max(160) }).strict()).max(100) }).strict(),
  z.object({ action: z.literal("RUN_PLANNER"), limit: z.number().int().min(1).max(2_000).default(2_000) }).strict(),
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
          if (templateKeys.length !== 7 || !sellersReady || !clientReady) fail("Egress exige sete templates, remetentes mapeados/verificados e cliente Open-Dot de e-mail.", "PROSPECTING_EMAIL_FOUNDATION_INCOMPLETE");
        }
        const updated = await transaction.prospectingSettings.update({ where: { id: settings.id }, data: { releaseEnabled: input.releaseEnabled, emailEgressEnabled: input.emailEgressEnabled, dailyCapacity: input.dailyCapacity, reservePercent: input.reservePercent, emailWindowStart: input.emailWindowStart, emailWindowEnd: input.emailWindowEnd, coverageWarningDays: input.coverageWarningDays, coverageCriticalDays: input.coverageCriticalDays, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        if (!settings.releaseEnabled && updated.releaseEnabled) {
          await transaction.prospectRelease.updateMany({
            where: { workspaceId: context.workspaceId, status: "DEFERRED", reasonCode: "RELEASE_DISABLED" },
            data: { status: "PLANNED", reasonCode: null, nextAttemptAt: null },
          });
        }
        if (!settings.emailEgressEnabled && updated.emailEgressEnabled) {
          const blockedJobs = await transaction.prospectingEmailJob.findMany({
            where: { workspaceId: context.workspaceId, status: "BLOCKED", expiresAt: { gt: now } },
            orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
            take: 5_000,
          });
          for (const job of blockedJobs) {
            const [cadence, template, sender] = await Promise.all([
              transaction.prospectingCadenceInstance.findFirst({ where: { id: job.cadenceInstanceId, workspaceId: context.workspaceId, status: "ACTIVE", d1GateCompletedAt: { not: null } }, select: { id: true } }),
              transaction.prospectingEmailTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, stepKey: job.stepKey, published: true }, orderBy: { version: "desc" }, select: { id: true } }),
              job.senderProfileId ? transaction.emailConnectionProfile.findFirst({ where: { id: job.senderProfileId, workspaceId: context.workspaceId, operatingMode: "EXTERNAL_READY", spfStatus: "VERIFIED_EXTERNAL", dkimStatus: "VERIFIED_EXTERNAL", dmarcStatus: "VERIFIED_EXTERNAL" }, select: { id: true } }) : null,
            ]);
            if (cadence && template && sender) {
              await transaction.prospectingEmailJob.update({ where: { id: job.id }, data: { templateVersionId: template.id, status: "SCHEDULED", lastErrorCode: null, finalizedAt: null } });
              await transaction.prospectingCadenceStep.updateMany({ where: { workspaceId: context.workspaceId, emailJobId: job.id }, data: { status: "SCHEDULED", resultReason: null } });
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
        const unknown = [...placeholders(input.subject), ...placeholders(input.body)].filter((variable) => !(allowedVariables as readonly string[]).includes(variable));
        if (unknown.length) fail(`Variável de template não permitida: ${[...new Set(unknown)].join(", ")}.`, "PROSPECTING_EMAIL_TEMPLATE_VARIABLE_INVALID");
        const last = await transaction.prospectingEmailTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, stepKey: input.stepKey }, orderBy: { version: "desc" }, select: { version: true } });
        const contentHash = createHash("sha256").update(`${input.subject}\n${input.body}`).digest("hex");
        const duplicate = await transaction.prospectingEmailTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, stepKey: input.stepKey, contentHash }, select: { id: true, version: true } });
        if (duplicate) return { action: input.action, id: duplicate.id, version: duplicate.version, duplicate: true };
        const template = await transaction.prospectingEmailTemplateVersion.create({ data: { workspaceId: context.workspaceId, stepKey: input.stepKey, version: (last?.version ?? 0) + 1, subjectTemplate: input.subject, bodyTemplate: input.body, allowedVariables: [...allowedVariables], contentHash, published: true, publishedAt: now, createdByActorId: context.actorId } });
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
