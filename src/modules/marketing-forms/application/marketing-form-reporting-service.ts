import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { csvCell } from "@/modules/analytics-builder/domain/analytics-builder-contracts";
import { marketingFormDefinitionSchema, type MarketingFormDefinition } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;
const baseQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["RECEIVED", "PROCESSING", "ACCEPTED", "FAILED"]).optional(),
  version: z.coerce.number().int().positive().optional(),
  utmSource: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();
const validPeriod = (value: { from?: Date | undefined; to?: Date | undefined }) => !value.from || !value.to || value.to > value.from;
const querySchema = baseQuerySchema.refine(validPeriod, { message: "Período inválido." });
const exportQuerySchema = baseQuerySchema.omit({ page: true, pageSize: true }).refine(validPeriod, { message: "Período inválido." });
const statisticsQuerySchema = baseQuerySchema.pick({ version: true, from: true, to: true }).refine(validPeriod, { message: "Período inválido." });

function fail(message: string, code: string, statusCode: number): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(context: AuthenticatedContext, formId: string) {
  return { workspaceId: context.workspaceId, resourceType: "MarketingForm", resourceId: formId, memberId: context.memberId } as const;
}

function parsedDefinition(value: Prisma.JsonValue): MarketingFormDefinition {
  const parsed = marketingFormDefinitionSchema.safeParse(value);
  if (!parsed.success) fail("Snapshot histórico inválido.", "MARKETING_FORM_SNAPSHOT_INVALID", 500);
  return parsed.data;
}

function answerLabel(definition: MarketingFormDefinition, questionKey: string, value: unknown): string {
  const question = definition.questions.find((item) => item.stableKey === questionKey);
  if (!question) return String(value ?? "");
  const options = question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE" || question.type === "DROPDOWN" ? question.config.options : null;
  if (options) {
    const values = Array.isArray(value) ? value : [value];
    return values.map((key) => options.find((option) => option.stableKey === key)?.label ?? String(key)).join(" | ");
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value ?? "");
}

function storedAnswers(value: Prisma.JsonValue): Array<{ questionKey: string; value: Prisma.JsonValue }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.questionKey !== "string" || !("value" in item) || item.value === undefined) return [];
    return [{ questionKey: item.questionKey, value: item.value }];
  });
}

function marketingCsv(records: readonly Record<string, unknown>[], columns: readonly string[]): string {
  return `\uFEFF${[columns.map(csvCell).join(","), ...records.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n")}\r\n`;
}

export function createMarketingFormReportingService(options: Options) {
  async function assertForm(context: AuthenticatedContext, formId: string, exportData = false) {
    await options.authorization.assertAuthorized(context, PermissionKeys.MARKETING_JOURNEY_READ, resource(context, formId));
    if (exportData) {
      await options.authorization.assertAuthorized(context, PermissionKeys.MARKETING_EVIDENCE_EXPORT, resource(context, formId));
      await options.authorization.assertAuthorized(context, PermissionKeys.EXPORTS_EXECUTE, resource(context, formId));
    }
    const form = await options.database.marketingForm.findFirst({ where: { id: formId, workspaceId: context.workspaceId, deletedAt: null }, select: { id: true, name: true } });
    if (!form) fail("Formulário não encontrado.", "MARKETING_FORM_NOT_FOUND", 404);
    return form;
  }

  function where(context: AuthenticatedContext, formId: string, query: z.infer<typeof querySchema>, versionId?: string): Prisma.MarketingFormReceiptWhereInput {
    return {
      workspaceId: context.workspaceId,
      marketingFormId: formId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.utmSource ? { utmSource: { equals: query.utmSource, mode: "insensitive" } } : {}),
      ...((query.from || query.to) ? { submittedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
      ...(versionId ? { marketingFormVersionId: versionId } : {}),
    };
  }

  async function list(context: AuthenticatedContext, formId: string, raw: unknown) {
    await assertForm(context, formId);
    const query = querySchema.parse(raw);
    const selectedVersion = query.version ? await options.database.marketingFormVersion.findFirst({ where: { workspaceId: context.workspaceId, marketingFormId: formId, version: query.version }, select: { id: true } }) : null;
    const filter = where(context, formId, query, selectedVersion?.id);
    if (query.version && !selectedVersion) return { total: 0, page: query.page, pageSize: query.pageSize, versions: [], items: [] };
    const [total, receipts, versions] = await Promise.all([
      options.database.marketingFormReceipt.count({ where: filter }),
      options.database.marketingFormReceipt.findMany({ where: filter, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: { id: true, publicId: true, marketingFormVersionId: true, status: true, utmSource: true, utmMedium: true, utmCampaign: true, submittedAt: true, acceptedAt: true } }),
      options.database.marketingFormVersion.findMany({ where: { workspaceId: context.workspaceId, marketingFormId: formId }, select: { id: true, version: true }, orderBy: { version: "desc" } }),
    ]);
    const submissions = await options.database.leadFormSubmission.findMany({ where: { workspaceId: context.workspaceId, marketingFormReceiptId: { in: receipts.map((receipt) => receipt.id) } }, select: { marketingFormReceiptId: true, leadId: true, submittedFullName: true, submittedEmail: true, submittedPhone: true, intakeOutcome: true } });
    const byReceipt = new Map(submissions.map((submission) => [submission.marketingFormReceiptId, submission]));
    const versionById = new Map(versions.map((version) => [version.id, version.version]));
    return { total, page: query.page, pageSize: query.pageSize, versions: versions.map((version) => version.version), items: receipts.map((receipt) => ({ ...receipt, version: versionById.get(receipt.marketingFormVersionId) ?? null, submission: byReceipt.get(receipt.id) ?? null })) };
  }

  async function detail(context: AuthenticatedContext, formId: string, receiptId: string) {
    await assertForm(context, formId);
    const receipt = await options.database.marketingFormReceipt.findFirst({ where: { workspaceId: context.workspaceId, marketingFormId: formId, publicId: receiptId, deletedAt: null } });
    if (!receipt) fail("Resposta não encontrada.", "MARKETING_FORM_RESPONSE_NOT_FOUND", 404);
    const [version, submission] = await Promise.all([
      options.database.marketingFormVersion.findFirst({ where: { id: receipt.marketingFormVersionId, workspaceId: context.workspaceId, marketingFormId: formId } }),
      options.database.leadFormSubmission.findFirst({ where: { workspaceId: context.workspaceId, marketingFormReceiptId: receipt.id }, select: { leadId: true, contactId: true, intakeOutcome: true, submittedFullName: true, submittedEmail: true, submittedPhone: true } }),
    ]);
    if (!version) fail("Versão histórica não encontrada.", "MARKETING_FORM_VERSION_NOT_FOUND", 500);
    const definition = parsedDefinition(version.definition);
    const rawAnswers = storedAnswers(receipt.answers);
    const answers = definition.questions.map((question) => {
      const raw = rawAnswers.find((item) => item.questionKey === question.stableKey);
      return { questionKey: question.stableKey, question: question.title, value: raw?.value ?? null, displayValue: raw ? answerLabel(definition, question.stableKey, raw.value) : "—" };
    });
    return { receipt: { publicId: receipt.publicId, status: receipt.status, submittedAt: receipt.submittedAt, acceptedAt: receipt.acceptedAt, utmSource: receipt.utmSource, utmMedium: receipt.utmMedium, utmCampaign: receipt.utmCampaign, utmContent: receipt.utmContent, utmTerm: receipt.utmTerm, referrerHost: receipt.referrerHost, redirectKind: receipt.redirectKind }, version: version.version, submission, answers };
  }

  async function csv(context: AuthenticatedContext, formId: string, raw: unknown) {
    const form = await assertForm(context, formId, true);
    const query = exportQuerySchema.parse(raw);
    const selectedVersion = query.version ? await options.database.marketingFormVersion.findFirst({ where: { workspaceId: context.workspaceId, marketingFormId: formId, version: query.version }, select: { id: true } }) : null;
    const fixedColumns = ["recibo", "status", "versao", "enviado_em", "nome", "email", "telefone", "lead_id", "utm_source", "utm_medium", "utm_campaign"] as const;
    if (query.version && !selectedVersion) return { filename: "formulario-respostas.csv", csv: marketingCsv([], fixedColumns), total: 0 };
    const filter = where(context, formId, { ...query, page: 1, pageSize: 100 }, selectedVersion?.id);
    const count = await options.database.marketingFormReceipt.count({ where: filter });
    if (count > 10_000) fail("A exportação síncrona está limitada a 10.000 respostas.", "MARKETING_FORM_EXPORT_TOO_LARGE", 422);
    const receipts = await options.database.marketingFormReceipt.findMany({ where: filter, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 10_000 });
    const versions = await options.database.marketingFormVersion.findMany({ where: { workspaceId: context.workspaceId, marketingFormId: formId, id: { in: [...new Set(receipts.map((receipt) => receipt.marketingFormVersionId))] } }, select: { id: true, version: true, definition: true } });
    const submissions = await options.database.leadFormSubmission.findMany({ where: { workspaceId: context.workspaceId, marketingFormReceiptId: { in: receipts.map((receipt) => receipt.id) } }, select: { marketingFormReceiptId: true, leadId: true, submittedFullName: true, submittedEmail: true, submittedPhone: true, intakeOutcome: true } });
    const versionById = new Map(versions.map((version) => [version.id, { version: version.version, definition: parsedDefinition(version.definition) }]));
    const submissionByReceipt = new Map(submissions.map((submission) => [submission.marketingFormReceiptId, submission]));
    const questionColumns = [...new Map(versions.flatMap((version) => parsedDefinition(version.definition).questions.map((question) => [`v${version.version}:${question.stableKey}`, { key: `v${version.version}:${question.stableKey}:${question.title}`, versionId: version.id, questionKey: question.stableKey }]))).values()];
    const records = receipts.map((receipt) => {
      const version = versionById.get(receipt.marketingFormVersionId)!;
      const answers = storedAnswers(receipt.answers);
      const submission = submissionByReceipt.get(receipt.id);
      const row: Record<string, unknown> = { recibo: receipt.publicId, status: receipt.status, versao: version.version, enviado_em: receipt.submittedAt.toISOString(), nome: submission?.submittedFullName ?? "", email: submission?.submittedEmail ?? "", telefone: submission?.submittedPhone ?? "", lead_id: submission?.leadId ?? "", utm_source: receipt.utmSource ?? "", utm_medium: receipt.utmMedium ?? "", utm_campaign: receipt.utmCampaign ?? "" };
      for (const column of questionColumns) {
        const answer = column.versionId === receipt.marketingFormVersionId ? answers.find((item) => item.questionKey === column.questionKey) : undefined;
        row[column.key] = answer ? answerLabel(version.definition, column.questionKey, answer.value) : "";
      }
      return row;
    });
    const output = marketingCsv(records, [...fixedColumns, ...questionColumns.map((column) => column.key)]);
    await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.form.responses_exported", entityType: "MarketingForm", entityId: formId, changes: { count, filtersHash: createHash("sha256").update(JSON.stringify(query)).digest("hex"), contentHash: createHash("sha256").update(output).digest("hex") } } });
    return { filename: `${form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "formulario"}-respostas.csv`, csv: output, total: count };
  }

  async function statistics(context: AuthenticatedContext, formId: string, raw: unknown) {
    await assertForm(context, formId);
    const query = statisticsQuerySchema.parse(raw);
    const versionFilter = query.version ? Prisma.sql`AND v."version" = ${query.version}` : Prisma.empty;
    const fromFilter = query.from ? Prisma.sql`AND e."occurredAt" >= ${query.from}` : Prisma.empty;
    const toFilter = query.to ? Prisma.sql`AND e."occurredAt" < ${query.to}` : Prisma.empty;
    const receiptFrom = query.from ? Prisma.sql`AND r."submittedAt" >= ${query.from}` : Prisma.empty;
    const receiptTo = query.to ? Prisma.sql`AND r."submittedAt" < ${query.to}` : Prisma.empty;
    const [eventTotals, submissions, abandonment, choices] = await Promise.all([
      options.database.$queryRaw<Array<{ kind: string; total: bigint }>>(Prisma.sql`SELECT e."kind"::text AS kind, COUNT(DISTINCT e."sessionId")::bigint AS total FROM "marketing_form_events" e JOIN "marketing_form_versions" v ON v.id=e."marketingFormVersionId" AND v."workspaceId"=e."workspaceId" WHERE e."workspaceId"=${context.workspaceId}::uuid AND e."marketingFormId"=${formId}::uuid ${versionFilter} ${fromFilter} ${toFilter} GROUP BY e."kind"`),
      options.database.$queryRaw<Array<{ total: bigint; medianSeconds: number | null }>>(Prisma.sql`SELECT COUNT(*)::bigint AS total, percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r."submittedAt"-r."startedAt")))::float8 AS "medianSeconds" FROM "marketing_form_receipts" r JOIN "marketing_form_versions" v ON v.id=r."marketingFormVersionId" AND v."workspaceId"=r."workspaceId" WHERE r."workspaceId"=${context.workspaceId}::uuid AND r."marketingFormId"=${formId}::uuid AND r.status='ACCEPTED' AND r."deletedAt" IS NULL ${versionFilter} ${receiptFrom} ${receiptTo}`),
      options.database.$queryRaw<Array<{ questionKey: string; viewed: bigint; abandoned: bigint }>>(Prisma.sql`SELECT e."questionKey" AS "questionKey", COUNT(DISTINCT e."sessionId")::bigint AS viewed, COUNT(DISTINCT e."sessionId") FILTER (WHERE NOT EXISTS (SELECT 1 FROM "marketing_form_events" done WHERE done."workspaceId"=e."workspaceId" AND done."marketingFormVersionId"=e."marketingFormVersionId" AND done."sessionId"=e."sessionId" AND done.kind='FORM_COMPLETED'))::bigint AS abandoned FROM "marketing_form_events" e JOIN "marketing_form_versions" v ON v.id=e."marketingFormVersionId" AND v."workspaceId"=e."workspaceId" WHERE e."workspaceId"=${context.workspaceId}::uuid AND e."marketingFormId"=${formId}::uuid AND e.kind='QUESTION_VIEWED' AND e."questionKey" IS NOT NULL ${versionFilter} ${fromFilter} ${toFilter} GROUP BY e."questionKey" ORDER BY MIN(e."occurredAt")`),
      options.database.$queryRaw<Array<{ version: number; questionKey: string; optionKey: string; total: bigint }>>(Prisma.sql`SELECT v.version, a->>'questionKey' AS "questionKey", option_value AS "optionKey", COUNT(DISTINCT r.id)::bigint AS total FROM "marketing_form_receipts" r JOIN "marketing_form_versions" v ON v.id=r."marketingFormVersionId" AND v."workspaceId"=r."workspaceId" CROSS JOIN LATERAL jsonb_array_elements(r.answers) a CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(a->'value')='array' THEN a->'value' ELSE jsonb_build_array(a->'value') END) option_value WHERE r."workspaceId"=${context.workspaceId}::uuid AND r."marketingFormId"=${formId}::uuid AND r.status='ACCEPTED' AND r."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.definition->'questions') q WHERE q->>'stableKey'=a->>'questionKey' AND q->>'type' IN ('SINGLE_CHOICE','MULTIPLE_CHOICE','DROPDOWN','CHECKBOX')) ${versionFilter} ${receiptFrom} ${receiptTo} GROUP BY v.version, a->>'questionKey', option_value ORDER BY v.version DESC, a->>'questionKey', total DESC`),
    ]);
    const totals = new Map(eventTotals.map((row) => [row.kind, Number(row.total)]));
    const starts = totals.get("FORM_START") ?? 0;
    const completed = Number(submissions[0]?.total ?? 0n);
    return { views: totals.get("FORM_VIEW") ?? 0, starts, completed, completionRate: starts ? Math.round(completed / starts * 10_000) / 100 : null, medianSeconds: submissions[0]?.medianSeconds ?? null, abandonment: abandonment.map((row) => ({ questionKey: row.questionKey, viewed: Number(row.viewed), abandoned: Number(row.abandoned) })), choices: choices.map((row) => ({ ...row, total: Number(row.total) })), grain: "sessões únicas e receipts aceitos", generatedAt: options.now().toISOString() };
  }

  return Object.freeze({ list, detail, csv, statistics });
}

let service: ReturnType<typeof createMarketingFormReportingService> | undefined;
export function getMarketingFormReportingService() {
  service ??= createMarketingFormReportingService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
