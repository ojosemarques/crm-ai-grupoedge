import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { toLeadIntakeInput } from "@/modules/leads/application/lead-entry-mapper";
import type { LeadIntakeResult } from "@/modules/leads/application/lead-intake-service";
import {
  csvImportRequestSchema,
  leadEntryFieldsSchema,
  parseCsvBoolean,
  type CsvImportRequest,
  type LeadEntryFields,
} from "@/modules/leads/domain/lead-entry-contracts";
import { CsvParseError, parseCsv } from "@/modules/leads/domain/csv-parser";
import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
import { getLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const MAX_CSV_ROWS = 2_000;

type IntakePort = Readonly<{
  intake: (
    payload: unknown,
    context: AuthenticatedContext,
  ) => Promise<LeadIntakeResult>;
}>;

type AuthorizationPort = Readonly<{
  assertAuthorized: ReturnType<typeof getAuthorizationService>["assertAuthorized"];
}>;

type CsvImportServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  intake: IntakePort;
  now: () => Date;
}>;

type PreparedRow = Readonly<{
  rowNumber: number;
  status: "VALID" | "DUPLICATE" | "INVALID";
  normalizedPhone: string | null;
  issues: readonly Readonly<{ field: string; message: string }>[];
  intakeInput: unknown | null;
}>;

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function csvEscape(value: unknown): string {
  const original = String(value ?? "");
  const text = /^[\t\r ]*[=+\-@]/.test(original) ? `'${original}` : original;
  return /[",;\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function field(
  row: Readonly<Record<string, string>>,
  mapping: CsvImportRequest["mapping"],
  name: keyof CsvImportRequest["mapping"],
): string | undefined {
  const header = mapping[name];
  return header ? row[header] : undefined;
}

function buildFields(
  row: Readonly<Record<string, string>>,
  request: CsvImportRequest,
): LeadEntryFields {
  const catalogItemId = field(row, request.mapping, "requestedCatalogItemId");
  const catalogVersion = field(row, request.mapping, "requestedCatalogVersion");
  const acquisition = { utmSource: field(row, request.mapping, "utmSource"), utmMedium: field(row, request.mapping, "utmMedium"), utmCampaign: field(row, request.mapping, "utmCampaign"), utmContent: field(row, request.mapping, "utmContent"), utmTerm: field(row, request.mapping, "utmTerm") };
  return leadEntryFieldsSchema.parse({
    fullName: field(row, request.mapping, "fullName"),
    phone: field(row, request.mapping, "phone"),
    email: field(row, request.mapping, "email"),
    jobTitle: field(row, request.mapping, "jobTitle"),
    organizationName: field(row, request.mapping, "organizationName"),
    city: field(row, request.mapping, "city"),
    stateCode: field(row, request.mapping, "stateCode"),
    interestSummary: field(row, request.mapping, "interestSummary"),
    budgetBrl: field(row, request.mapping, "budgetBrl"),
    sourceKey:
      field(row, request.mapping, "sourceKey") || request.defaults.sourceKey,
    campaignExternalRef:
      field(row, request.mapping, "campaignExternalRef") ||
      request.defaults.campaignExternalRef,
    creativeExternalRef:
      field(row, request.mapping, "creativeExternalRef") ||
      request.defaults.creativeExternalRef,
    consent: parseCsvBoolean(field(row, request.mapping, "consent")),
    doNotContact: parseCsvBoolean(field(row, request.mapping, "doNotContact")),
    priorityBandCode:
      field(row, request.mapping, "priorityBandCode") ||
      request.defaults.priorityBandCode,
    ...(catalogItemId && catalogVersion ? { requestedOffer: { catalogItemId, version: Number(catalogVersion) } } : {}),
    ...(Object.values(acquisition).some(Boolean) ? { acquisition } : {}),
  });
}

function validationIssues(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues.map((issue: { path?: PropertyKey[]; message: string }) => ({
      field: issue.path?.join(".") || "linha",
      message: issue.message,
    }));
  }
  return [{ field: "linha", message: error instanceof Error ? error.message : "Linha inválida." }];
}

function contentHash(request: CsvImportRequest): string {
  return createHash("sha256")
    .update(request.content)
    .update("\u0000")
    .update(JSON.stringify(request.mapping))
    .update("\u0000")
    .update(JSON.stringify(request.defaults))
    .digest("hex");
}

export function createLeadCsvImportService(options: CsvImportServiceOptions) {
  async function authorize(context: AuthenticatedContext) {
    const queue = await options.database.queue.findFirst({
      where: { workspaceId: context.workspaceId, isGeneral: true, deletedAt: null },
      select: { id: true, teamId: true },
    });
    if (!queue) {
      throw new ApplicationError("A Fila Geral não está configurada.", {
        code: "INTAKE_CONFIGURATION_UNAVAILABLE",
        statusCode: 409,
        expose: true,
      });
    }
    await options.authorization.assertAuthorized(context, PermissionKeys.LEADS_WRITE, {
      workspaceId: context.workspaceId,
      resourceType: "LeadImport",
      queueId: queue.id,
      teamId: queue.teamId,
    });
  }

  async function prepare(payload: unknown, context: AuthenticatedContext) {
    await authorize(context);
    const parsed = csvImportRequestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApplicationError("Arquivo, mapeamento ou padrões inválidos.", {
        code: "INVALID_CSV_IMPORT",
        statusCode: 422,
        expose: true,
      });
    }

    let table;
    try {
      table = parseCsv(parsed.data.content);
    } catch (error) {
      if (error instanceof CsvParseError) {
        throw new ApplicationError(`${error.message} Linha ${error.rowNumber}.`, {
          code: "MALFORMED_CSV",
          statusCode: 422,
          expose: true,
        });
      }
      throw error;
    }
    if (table.rows.length > MAX_CSV_ROWS) {
      throw new ApplicationError(`O CSV excede o limite local de ${MAX_CSV_ROWS} linhas.`, {
        code: "CSV_TOO_LARGE",
        statusCode: 413,
        expose: true,
      });
    }
    if (Buffer.byteLength(parsed.data.content, "utf8") > 2 * 1024 * 1024) {
      throw new ApplicationError("O CSV excede o limite local de 2 MiB.", {
        code: "CSV_TOO_LARGE",
        statusCode: 413,
        expose: true,
      });
    }

    const mappedHeaders = Object.values(parsed.data.mapping).filter(
      (header): header is string => Boolean(header),
    );
    const unknownHeader = mappedHeaders.find((header) => !table.headers.includes(header));
    if (unknownHeader) {
      throw new ApplicationError(`A coluna mapeada “${unknownHeader}” não existe no arquivo.`, {
        code: "INVALID_CSV_MAPPING",
        statusCode: 422,
        expose: true,
      });
    }

    const [sources, campaigns, priorityBands] = await Promise.all([
      options.database.leadSource.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        select: { key: true },
      }),
      options.database.acquisitionCampaign.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
        select: {
          externalRef: true,
          creatives: {
            where: { deletedAt: null },
            select: { externalRef: true },
          },
        },
      }),
      options.database.leadPriorityBand.findMany({
        where: {
          workspaceId: context.workspaceId,
          active: true,
          deletedAt: null,
          slaPolicy: {
            active: true,
            firstResponseMinutes: 0,
            deletedAt: null,
          },
        },
        select: { code: true },
      }),
    ]);
    const sourceKeys = new Set(
      sources.map((source) => source.key.toLocaleLowerCase("pt-BR")),
    );
    const campaignRefs = new Set(
      campaigns.map((campaign) => campaign.externalRef).filter(Boolean),
    );
    const creativeRefs = new Set(
      campaigns.flatMap((campaign) =>
        campaign.creatives
          .filter((creative) => creative.externalRef && campaign.externalRef)
          .map(
            (creative) =>
              `${campaign.externalRef}:${creative.externalRef}`,
          ),
      ),
    );
    const bandCodes = new Set(priorityBands.map((band) => band.code));
    const hash = contentHash(parsed.data);

    const initiallyPrepared = table.rows.map((row): PreparedRow => {
      try {
        const fields = buildFields(row.values, parsed.data);
        const phone = normalizePhone(fields.phone);
        if (!phone.success) {
          return {
            rowNumber: row.rowNumber,
            status: "INVALID",
            normalizedPhone: null,
            issues: [{ field: "phone", message: phone.message }],
            intakeInput: null,
          };
        }
        const issues: Array<{ field: string; message: string }> = [];
        if (!sourceKeys.has(fields.sourceKey.toLocaleLowerCase("pt-BR"))) {
          issues.push({ field: "sourceKey", message: "A origem não existe neste workspace." });
        }
        if (
          fields.campaignExternalRef &&
          !campaignRefs.has(fields.campaignExternalRef)
        ) {
          issues.push({ field: "campaignExternalRef", message: "A campanha não existe neste workspace." });
        }
        if (
          fields.creativeExternalRef &&
          !creativeRefs.has(
            `${fields.campaignExternalRef}:${fields.creativeExternalRef}`,
          )
        ) {
          issues.push({ field: "creativeExternalRef", message: "O criativo não pertence à campanha informada." });
        }
        if (!bandCodes.has(fields.priorityBandCode)) {
          issues.push({ field: "priorityBandCode", message: "A prioridade não possui SLA 0 ativo." });
        }
        if (issues.length > 0) {
          return {
            rowNumber: row.rowNumber,
            status: "INVALID",
            normalizedPhone: phone.normalizedPhone,
            issues,
            intakeInput: null,
          };
        }
        return {
          rowNumber: row.rowNumber,
          status: "VALID",
          normalizedPhone: phone.normalizedPhone,
          issues: [],
          intakeInput: toLeadIntakeInput(fields, {
            channel: "CSV",
            idempotencyKey: `csv:${hash}:${row.rowNumber}`,
            formIdentifier: parsed.data.fileName,
            rawPayload: { fileName: parsed.data.fileName, rowNumber: row.rowNumber, values: row.values },
          }),
        };
      } catch (error) {
        return {
          rowNumber: row.rowNumber,
          status: "INVALID",
          normalizedPhone: null,
          issues: validationIssues(error),
          intakeInput: null,
        };
      }
    });

    const normalizedPhones = initiallyPrepared
      .map((row) => row.normalizedPhone)
      .filter((phone): phone is string => Boolean(phone));
    const existing = await options.database.lead.findMany({
      where: {
        workspaceId: context.workspaceId,
        normalizedPhone: { in: normalizedPhones },
        deletedAt: null,
      },
      select: { normalizedPhone: true },
    });
    const known = new Set(existing.map((lead) => lead.normalizedPhone).filter(Boolean));
    const seen = new Set<string>();
    const rows = initiallyPrepared.map((row): PreparedRow => {
      if (!row.normalizedPhone || row.status === "INVALID") return row;
      const duplicate = known.has(row.normalizedPhone) || seen.has(row.normalizedPhone);
      seen.add(row.normalizedPhone);
      return { ...row, status: duplicate ? "DUPLICATE" : "VALID" };
    });

    return { request: parsed.data, table, rows, hash };
  }

  async function preview(payload: unknown, context: AuthenticatedContext) {
    const prepared = await prepare(payload, context);
    return {
      fileName: prepared.request.fileName,
      delimiter: prepared.table.delimiter,
      headers: prepared.table.headers,
      contentHash: prepared.hash,
      counts: {
        total: prepared.rows.length,
        valid: prepared.rows.filter((row) => row.status === "VALID").length,
        invalid: prepared.rows.filter((row) => row.status === "INVALID").length,
        duplicate: prepared.rows.filter((row) => row.status === "DUPLICATE").length,
      },
      rows: prepared.rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        normalizedPhone: row.normalizedPhone,
        issues: row.issues,
      })),
    };
  }

  async function execute(payload: unknown, context: AuthenticatedContext) {
    const prepared = await prepare(payload, context);
    const startedAt = options.now();
    const job = await options.database.$transaction(async (transaction) => {
      const created = await transaction.importJob.create({
        data: {
          workspaceId: context.workspaceId,
          status: "PROCESSING",
          fileName: prepared.request.fileName,
          sourceType: "CSV",
          totalRows: prepared.rows.length,
          inputMetadata: json({
            contentHash: prepared.hash,
            mapping: prepared.request.mapping,
            defaults: prepared.request.defaults,
          }),
          createdByActorId: context.actorId,
          createdAt: startedAt,
          startedAt,
        },
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          action: "lead.import.started",
          entityType: "ImportJob",
          entityId: created.id,
          requestId: `csv:${prepared.hash}`,
          changes: json({ fileName: prepared.request.fileName, totalRows: prepared.rows.length }),
        },
      });
      return created;
    });

    const report: Array<Record<string, unknown>> = [];
    let succeededRows = 0;
    let failedRows = 0;

    try {
      for (const row of prepared.rows) {
        if (!row.intakeInput) {
          failedRows += 1;
          report.push({ rowNumber: row.rowNumber, previewStatus: row.status, outcome: "REJECTED", issues: row.issues });
        } else {
          const result = await options.intake.intake(row.intakeInput, context);
          if (result.outcome === "REJECTED") failedRows += 1;
          else succeededRows += 1;
          report.push({ rowNumber: row.rowNumber, previewStatus: row.status, outcome: result.outcome, idempotentReplay: result.outcome === "REJECTED" ? false : result.idempotentReplay, issues: result.outcome === "REJECTED" ? result.issues : [] });
        }
        await options.database.importJob.update({
          where: { id: job.id },
          data: { processedRows: { increment: 1 }, succeededRows, failedRows },
        });
      }

      const status = failedRows === 0 ? "SUCCEEDED" : succeededRows === 0 ? "FAILED" : "PARTIALLY_SUCCEEDED";
      const finishedAt = options.now();
      const updated = await options.database.$transaction(async (transaction) => {
        const result = await transaction.importJob.update({
          where: { id: job.id },
          data: { status, succeededRows, failedRows, resultMetadata: json({ rows: report }), finishedAt },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "lead.import.completed",
            entityType: "ImportJob",
            entityId: job.id,
            requestId: `csv:${prepared.hash}`,
            changes: json({ status, succeededRows, failedRows }),
          },
        });
        return result;
      });
      return { job: updated, report };
    } catch (error) {
      const finishedAt = options.now();
      await options.database.$transaction(async (transaction) => {
        await transaction.importJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            succeededRows,
            failedRows,
            resultMetadata: json({ rows: report }),
            errorMessage: "Falha inesperada durante o processamento; a linha pode ser reexecutada com segurança.",
            finishedAt,
          },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            action: "lead.import.failed",
            entityType: "ImportJob",
            entityId: job.id,
            requestId: `csv:${prepared.hash}`,
            changes: json({ processedRows: report.length, succeededRows, failedRows }),
          },
        });
      });
      throw error;
    }
  }

  async function errorReport(jobId: string, context: AuthenticatedContext) {
    await authorize(context);
    const job = await options.database.importJob.findFirst({
      where: { id: jobId, workspaceId: context.workspaceId },
      select: { id: true, fileName: true, resultMetadata: true },
    });
    if (!job) {
      throw new ApplicationError("Importação não encontrada.", {
        code: "IMPORT_NOT_FOUND",
        statusCode: 404,
        expose: true,
      });
    }
    const metadata = job.resultMetadata as { rows?: Array<Record<string, unknown>> } | null;
    const failed = (metadata?.rows ?? []).filter((row) => row.outcome === "REJECTED");
    const lines = ["linha;status;erros"];
    for (const row of failed) {
      const issues = Array.isArray(row.issues)
        ? row.issues.map((issue) => (issue as { message?: string }).message).filter(Boolean).join(" | ")
        : "";
      lines.push([row.rowNumber, row.outcome, issues].map(csvEscape).join(";"));
    }
    return { fileName: `erros-${job.fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}.csv`, content: `${lines.join("\n")}\n` };
  }

  return Object.freeze({ preview, execute, errorReport });
}

let service: ReturnType<typeof createLeadCsvImportService> | undefined;

export function getLeadCsvImportService() {
  service ??= createLeadCsvImportService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    intake: getLeadIntakeService(),
    now: () => new Date(),
  });
  return service;
}
