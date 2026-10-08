import "dotenv/config";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import {
  PROSPECTING_EMAIL_ALLOWED_VARIABLES,
  PROSPECTING_EMAIL_SEQUENCE,
  PROSPECTING_EMAIL_SEQUENCE_VERSION,
} from "@/modules/prospecting/domain/prospecting-email-sequence";
import { getDatabaseClient } from "@/shared/core/database/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para reconciliar a sequência de e-mails.");
const parsedUrl = new URL(databaseUrl);
const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(parsedUrl.hostname);
const allowProduction = process.argv.includes("--allow-production");
const execute = process.argv.includes("--execute");
if (!isLocal && !allowProduction) throw new Error("Banco remoto exige --allow-production explícito.");
const workspaceSlug = process.argv.find((value) => value.startsWith("--workspace="))?.slice("--workspace=".length);
if (!workspaceSlug) throw new Error("Informe --workspace=<slug>.");

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]!);
}

for (const template of PROSPECTING_EMAIL_SEQUENCE) {
  const unknown = [...placeholders(template.subject), ...placeholders(template.body)]
    .filter((variable) => !(PROSPECTING_EMAIL_ALLOWED_VARIABLES as readonly string[]).includes(variable));
  if (unknown.length) throw new Error(`Template ${template.stepKey} possui variável não permitida: ${[...new Set(unknown)].join(", ")}.`);
  if (/\[[A-Z_]+\]/.test(`${template.subject}\n${template.body}`)) throw new Error(`Template ${template.stepKey} ainda possui marcador editorial não convertido.`);
}

const database = getDatabaseClient();
try {
  const workspace = await database.workspace.findFirstOrThrow({
    where: { slug: workspaceSlug, status: "ACTIVE", deletedAt: null },
    select: { id: true, slug: true },
  });
  const administrator = await database.workspaceMember.findFirst({
    where: { workspaceId: workspace.id, status: "ACTIVE", deletedAt: null, role: { key: "administrator" }, user: { status: "ACTIVE", deletedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { user: { select: { actors: { where: { workspaceId: workspace.id, type: "HUMAN" }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } } } },
  });
  const actorId = administrator?.user.actors[0]?.id;
  if (!actorId) throw new Error("Ator administrador ativo não encontrado para auditoria.");

  const preview = await database.$transaction(async (transaction) => {
    const [settings, existingTemplates, existingJobs, legacyJobs, inFlightJobs] = await Promise.all([
      transaction.prospectingSettings.findUnique({ where: { workspaceId: workspace.id }, select: { emailEgressEnabled: true, privacyApprovedAt: true, canaryApprovedAt: true } }),
      transaction.prospectingEmailTemplateVersion.count({ where: { workspaceId: workspace.id } }),
      transaction.prospectingEmailJob.count({ where: { workspaceId: workspace.id, stepKey: { in: PROSPECTING_EMAIL_SEQUENCE.map((template) => template.stepKey) } } }),
      transaction.prospectingEmailJob.count({ where: { workspaceId: workspace.id, stepKey: "email-7" } }),
      transaction.prospectingEmailJob.count({ where: { workspaceId: workspace.id, status: { in: ["SCHEDULED", "CLAIMED"] } } }),
    ]);
    return { settings, existingTemplates, existingJobs, legacyJobs, inFlightJobs };
  });
  if (!preview.settings) throw new Error("Configuração de prospecção não encontrada.");
  if (preview.settings.emailEgressEnabled) throw new Error("Reconciliação bloqueada: o egress de e-mail precisa estar desligado.");
  if (preview.inFlightJobs > 0) throw new Error("Reconciliação bloqueada: existem jobs agendados ou em processamento.");

  if (!execute) {
    process.stdout.write(`${JSON.stringify({ mode: "DRY_RUN", workspace: workspace.slug, sequenceVersion: PROSPECTING_EMAIL_SEQUENCE_VERSION, templateCount: PROSPECTING_EMAIL_SEQUENCE.length, ...preview })}\n`);
  } else {
    const result = await database.$transaction(async (transaction) => {
      const now = new Date();
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospecting-email-sequence:${workspace.id}`}, 0))`;
      const currentSettings = await transaction.prospectingSettings.findUniqueOrThrow({ where: { workspaceId: workspace.id }, select: { emailEgressEnabled: true } });
      if (currentSettings.emailEgressEnabled) throw new Error("O egress foi ativado durante a reconciliação.");
      const currentInFlight = await transaction.prospectingEmailJob.count({ where: { workspaceId: workspace.id, status: { in: ["SCHEDULED", "CLAIMED"] } } });
      if (currentInFlight > 0) throw new Error("Surgiram jobs em processamento durante a reconciliação.");

      const templateIds = new Map<string, string>();
      let createdTemplates = 0;
      for (const template of PROSPECTING_EMAIL_SEQUENCE) {
        const contentHash = createHash("sha256").update(`${template.subject}\n${template.body}`).digest("hex");
        const duplicate = await transaction.prospectingEmailTemplateVersion.findFirst({
          where: { workspaceId: workspace.id, stepKey: template.stepKey, contentHash },
          orderBy: { version: "desc" },
        });
        if (duplicate) {
          if (!duplicate.published) {
            await transaction.prospectingEmailTemplateVersion.update({ where: { id: duplicate.id }, data: { published: true, publishedAt: now } });
          }
          templateIds.set(template.stepKey, duplicate.id);
          continue;
        }
        const last = await transaction.prospectingEmailTemplateVersion.findFirst({ where: { workspaceId: workspace.id, stepKey: template.stepKey }, orderBy: { version: "desc" }, select: { version: true } });
        const created = await transaction.prospectingEmailTemplateVersion.create({
          data: {
            workspaceId: workspace.id,
            stepKey: template.stepKey,
            version: (last?.version ?? 0) + 1,
            subjectTemplate: template.subject,
            bodyTemplate: template.body,
            allowedVariables: [...PROSPECTING_EMAIL_ALLOWED_VARIABLES],
            contentHash,
            published: true,
            publishedAt: now,
            createdByActorId: actorId,
          },
          select: { id: true },
        });
        templateIds.set(template.stepKey, created.id);
        createdTemplates += 1;
      }
      await transaction.prospectingEmailTemplateVersion.updateMany({ where: { workspaceId: workspace.id, stepKey: "email-7", published: true }, data: { published: false, publishedAt: null } });

      const desiredRows = Prisma.join(PROSPECTING_EMAIL_SEQUENCE.map((template) => Prisma.sql`(${template.stepKey}, ${template.dayOffset})`));
      const templateRows = Prisma.join([...templateIds.entries()].map(([stepKey, id]) => Prisma.sql`(${stepKey}, ${id}::uuid)`));
      const replannedJobs = await transaction.$executeRaw(Prisma.sql`
        WITH desired("stepKey", "dayOffset") AS (VALUES ${desiredRows}),
        selected_templates("stepKey", "templateVersionId") AS (VALUES ${templateRows}),
        targets AS (
          SELECT cadence."id" AS "cadenceInstanceId",
                 desired."stepKey",
                 desired."dayOffset",
                 ((resolved."localDate" + time '10:00') AT TIME ZONE workspace."timeZone") AS "scheduledAt"
          FROM "prospecting_cadence_instances" cadence
          JOIN "workspaces" workspace ON workspace."id" = cadence."workspaceId"
          CROSS JOIN desired
          JOIN LATERAL (
            SELECT candidate_day::date AS "localDate"
            FROM generate_series(
              cadence."d1Date" + desired."dayOffset",
              cadence."d1Date" + desired."dayOffset" + 14,
              interval '1 day'
            ) candidate_day
            WHERE extract(isodow FROM candidate_day) BETWEEN 1 AND 5
              AND NOT EXISTS (
                SELECT 1
                FROM "prospecting_calendar_holidays" holiday
                WHERE holiday."workspaceId" = cadence."workspaceId"
                  AND holiday."localDate" = candidate_day::date
              )
            ORDER BY candidate_day ASC
            LIMIT 1
          ) resolved ON TRUE
          WHERE cadence."workspaceId" = ${workspace.id}::uuid
        )
        UPDATE "prospecting_email_jobs" job
        SET "templateVersionId" = selected_templates."templateVersionId",
            "scheduledAt" = targets."scheduledAt",
            "expiresAt" = targets."scheduledAt" + interval '24 hours',
            "status" = CASE WHEN targets."scheduledAt" + interval '24 hours' <= ${now}
              THEN 'EXPIRED'::"ProspectingEmailJobStatus"
              ELSE 'BLOCKED'::"ProspectingEmailJobStatus" END,
            "finalizedAt" = CASE WHEN targets."scheduledAt" + interval '24 hours' <= ${now} THEN ${now} ELSE NULL END,
            "lastErrorCode" = CASE WHEN targets."scheduledAt" + interval '24 hours' <= ${now} THEN 'CADENCE_V2_PAST_EXPIRY' ELSE NULL END,
            "claimedByClientId" = NULL,
            "claimedAt" = NULL,
            "leaseExpiresAt" = NULL,
            "lastAuthorizedAt" = NULL,
            "renderedSubject" = NULL,
            "renderedBody" = NULL,
            "updatedAt" = ${now}
        FROM targets
        JOIN selected_templates ON selected_templates."stepKey" = targets."stepKey"
        WHERE job."workspaceId" = ${workspace.id}::uuid
          AND job."cadenceInstanceId" = targets."cadenceInstanceId"
          AND job."stepKey" = targets."stepKey"
          AND job."status" IN (
            'BLOCKED'::"ProspectingEmailJobStatus",
            'FAILED'::"ProspectingEmailJobStatus",
            'EXPIRED'::"ProspectingEmailJobStatus",
            'RECONCILIATION_REQUIRED'::"ProspectingEmailJobStatus"
          )
      `);
      const replannedSteps = await transaction.$executeRaw(Prisma.sql`
        WITH desired("stepKey", "dayOffset") AS (VALUES ${desiredRows}),
        targets AS (
          SELECT cadence."id" AS "cadenceInstanceId",
                 desired."stepKey",
                 desired."dayOffset",
                 ((resolved."localDate" + time '10:00') AT TIME ZONE workspace."timeZone") AS "scheduledAt"
          FROM "prospecting_cadence_instances" cadence
          JOIN "workspaces" workspace ON workspace."id" = cadence."workspaceId"
          CROSS JOIN desired
          JOIN LATERAL (
            SELECT candidate_day::date AS "localDate"
            FROM generate_series(
              cadence."d1Date" + desired."dayOffset",
              cadence."d1Date" + desired."dayOffset" + 14,
              interval '1 day'
            ) candidate_day
            WHERE extract(isodow FROM candidate_day) BETWEEN 1 AND 5
              AND NOT EXISTS (
                SELECT 1
                FROM "prospecting_calendar_holidays" holiday
                WHERE holiday."workspaceId" = cadence."workspaceId"
                  AND holiday."localDate" = candidate_day::date
              )
            ORDER BY candidate_day ASC
            LIMIT 1
          ) resolved ON TRUE
          WHERE cadence."workspaceId" = ${workspace.id}::uuid
        )
        UPDATE "prospecting_cadence_steps" step
        SET "dayOffset" = targets."dayOffset",
            "scheduledAt" = targets."scheduledAt",
            "status" = CASE WHEN targets."scheduledAt" + interval '24 hours' <= ${now}
              THEN 'EXPIRED'::"ProspectingStepStatus"
              ELSE 'BLOCKED'::"ProspectingStepStatus" END,
            "resultReason" = CASE WHEN targets."scheduledAt" + interval '24 hours' <= ${now} THEN 'CADENCE_V2_PAST_EXPIRY' ELSE NULL END,
            "updatedAt" = ${now}
        FROM targets
        WHERE step."workspaceId" = ${workspace.id}::uuid
          AND step."cadenceInstanceId" = targets."cadenceInstanceId"
          AND step."stepKey" = targets."stepKey"
          AND step."status" IN (
            'BLOCKED'::"ProspectingStepStatus",
            'FAILED'::"ProspectingStepStatus",
            'EXPIRED'::"ProspectingStepStatus"
          )
      `);
      const cancelledLegacyJobs = await transaction.prospectingEmailJob.updateMany({
        where: { workspaceId: workspace.id, stepKey: "email-7", status: { in: ["BLOCKED", "FAILED", "EXPIRED", "RECONCILIATION_REQUIRED"] } },
        data: { status: "CANCELLED", finalizedAt: now, lastErrorCode: "CADENCE_V2_REMOVED", claimedByClientId: null, claimedAt: null, leaseExpiresAt: null, lastAuthorizedAt: null },
      });
      const cancelledLegacySteps = await transaction.prospectingCadenceStep.updateMany({
        where: { workspaceId: workspace.id, stepKey: "email-7", status: { in: ["BLOCKED", "FAILED", "EXPIRED"] } },
        data: { status: "CANCELLED", cancelledAt: now, resultReason: "CADENCE_V2_REMOVED" },
      });
      const updatedCadences = await transaction.prospectingCadenceInstance.updateMany({
        where: { workspaceId: workspace.id, steps: { some: { stepKey: { in: PROSPECTING_EMAIL_SEQUENCE.map((template) => template.stepKey) } } } },
        data: { templateVersion: PROSPECTING_EMAIL_SEQUENCE_VERSION },
      });
      const audit = await transaction.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorId,
          action: "prospecting.email_sequence.reconciled",
          entityType: "ProspectingSettings",
          entityId: (await transaction.prospectingSettings.findUniqueOrThrow({ where: { workspaceId: workspace.id }, select: { id: true } })).id,
          origin: "SYSTEM",
          occurredAt: now,
          changes: {
            sequenceVersion: PROSPECTING_EMAIL_SEQUENCE_VERSION,
            egressEnabled: false,
            offsets: Object.fromEntries(PROSPECTING_EMAIL_SEQUENCE.map((template) => [template.stepKey, template.dayOffset])),
            createdTemplates,
            replannedJobs,
            replannedSteps,
            cancelledLegacyJobs: cancelledLegacyJobs.count,
            cancelledLegacySteps: cancelledLegacySteps.count,
            updatedCadences: updatedCadences.count,
            alternateSubjects: Object.fromEntries(PROSPECTING_EMAIL_SEQUENCE.filter((template) => template.alternateSubjects.length > 0).map((template) => [template.stepKey, [...template.alternateSubjects]])),
          },
        },
        select: { id: true },
      });
      return { createdTemplates, replannedJobs, replannedSteps, cancelledLegacyJobs: cancelledLegacyJobs.count, cancelledLegacySteps: cancelledLegacySteps.count, updatedCadences: updatedCadences.count, auditId: audit.id };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 });
    process.stdout.write(`${JSON.stringify({ mode: "EXECUTE", workspace: workspace.slug, sequenceVersion: PROSPECTING_EMAIL_SEQUENCE_VERSION, ...result })}\n`);
  }
} finally {
  await database.$disconnect();
}
