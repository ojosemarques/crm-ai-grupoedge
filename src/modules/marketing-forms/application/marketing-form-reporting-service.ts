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
  status: z.enum(["RECEIVED", "PROCESSING", "ACCEPTED", "FAILED", "INCOMPLETO"]).optional(),
  version: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).optional(),
  utmSource: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();
const validPeriod = (value: { from?: Date | undefined; to?: Date | undefined }) => !value.from || !value.to || value.to > value.from;
const querySchema = baseQuerySchema.refine(validPeriod, { message: "Período inválido." });
const exportQuerySchema = baseQuerySchema.omit({ page: true, pageSize: true }).refine(validPeriod, { message: "Período inválido." });
const statisticsQuerySchema = baseQuerySchema.pick({ version: true, from: true, to: true }).refine(validPeriod, { message: "Período inválido." });
type ReportingQuery = z.infer<typeof querySchema>;

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

  function where(context: AuthenticatedContext, formId: string, query: ReportingQuery, versionId?: string): Prisma.MarketingFormReceiptWhereInput {
    return {
      workspaceId: context.workspaceId,
      marketingFormId: formId,
      deletedAt: null,
      ...(query.status && query.status !== "INCOMPLETO" ? { status: query.status } : {}),
      ...(query.utmSource ? { utmSource: { equals: query.utmSource, mode: "insensitive" } } : {}),
      ...((query.from || query.to) ? { submittedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
      ...(versionId ? { marketingFormVersionId: versionId } : {}),
    };
  }

  function searchFilters(context: AuthenticatedContext, formId: string, query: ReportingQuery, versionId?: string): Prisma.Sql {
    const clauses: Prisma.Sql[] = [
      Prisma.sql`r."workspaceId" = ${context.workspaceId}::uuid`,
      Prisma.sql`r."marketingFormId" = ${formId}::uuid`,
      Prisma.sql`r."deletedAt" IS NULL`,
    ];
    if (query.status && query.status !== "INCOMPLETO") clauses.push(Prisma.sql`r.status::text = ${query.status}`);
    if (query.utmSource) clauses.push(Prisma.sql`LOWER(COALESCE(r."utmSource", '')) = LOWER(${query.utmSource})`);
    if (query.from) clauses.push(Prisma.sql`r."submittedAt" >= ${query.from}`);
    if (query.to) clauses.push(Prisma.sql`r."submittedAt" < ${query.to}`);
    if (versionId) clauses.push(Prisma.sql`r."marketingFormVersionId" = ${versionId}::uuid`);

    const search = query.search?.trim();
    if (search) {
      const matches: Prisma.Sql[] = [
        Prisma.sql`POSITION(LOWER(${search}) IN LOWER(COALESCE(s."submittedFullName", ''))) > 0`,
      ];
      const phoneDigits = search.replace(/\D/g, "");
      if (phoneDigits) {
        matches.push(Prisma.sql`POSITION(${phoneDigits} IN regexp_replace(COALESCE(s."normalizedPhone", s."submittedPhone", ''), '[^0-9]', '', 'g')) > 0`);
      }
      clauses.push(Prisma.sql`(${Prisma.join(matches, " OR ")})`);
    }
    return Prisma.sql`${Prisma.join(clauses, " AND ")}`;
  }

  async function searchedReceiptPage(context: AuthenticatedContext, formId: string, query: ReportingQuery, versionId: string | undefined, limit: number, offset: number) {
    const filters = searchFilters(context, formId, query, versionId);
    const [counts, rows] = await Promise.all([
      options.database.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS total
        FROM "marketing_form_receipts" r
        LEFT JOIN "lead_form_submissions" s
          ON s."workspaceId" = r."workspaceId"
          AND s."marketingFormReceiptId" = r.id
        WHERE ${filters}
      `),
      options.database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT r.id
        FROM "marketing_form_receipts" r
        LEFT JOIN "lead_form_submissions" s
          ON s."workspaceId" = r."workspaceId"
          AND s."marketingFormReceiptId" = r.id
        WHERE ${filters}
        ORDER BY r."submittedAt" DESC, r.id DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
    ]);
    return { total: Number(counts[0]?.total ?? 0n), ids: rows.map((row) => row.id) };
  }

  async function list(context: AuthenticatedContext, formId: string, raw: unknown) {
    await assertForm(context, formId);
    const query = querySchema.parse(raw);
    const clauses: Prisma.Sql[] = [];
    if (query.status) clauses.push(Prisma.sql`response.status = ${query.status}`);
    if (query.version) clauses.push(Prisma.sql`response.version = ${query.version}`);
    if (query.utmSource) clauses.push(Prisma.sql`LOWER(COALESCE(response."utmSource", '')) = LOWER(${query.utmSource})`);
    if (query.from) clauses.push(Prisma.sql`response."submittedAt" >= ${query.from}`);
    if (query.to) clauses.push(Prisma.sql`response."submittedAt" < ${query.to}`);
    if (query.search) {
      const matches: Prisma.Sql[] = [Prisma.sql`POSITION(LOWER(${query.search}) IN LOWER(COALESCE(response."submittedFullName", ''))) > 0`];
      const phoneDigits = query.search.replace(/\D/g, "");
      if (phoneDigits) matches.push(Prisma.sql`POSITION(${phoneDigits} IN regexp_replace(COALESCE(response."submittedPhone", ''), '[^0-9]', '', 'g')) > 0`);
      clauses.push(Prisma.sql`(${Prisma.join(matches, " OR ")})`);
    }
    const filters = clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}` : Prisma.empty;
    const responseRows = Prisma.sql`
      SELECT 'RECEIPT'::text AS source, r.id, r."publicId", r."marketingFormVersionId", v.version,
        r.status::text AS status, r."utmSource", r."utmMedium", r."utmCampaign", r."submittedAt", r."acceptedAt",
        s."submittedFullName", s."submittedEmail", s."submittedPhone", s."leadId", s."intakeOutcome"::text AS "intakeOutcome"
      FROM "marketing_form_receipts" r
      JOIN "marketing_form_versions" v ON v."workspaceId" = r."workspaceId" AND v.id = r."marketingFormVersionId"
      LEFT JOIN "lead_form_submissions" s ON s."workspaceId" = r."workspaceId" AND s."marketingFormReceiptId" = r.id
      WHERE r."workspaceId" = ${context.workspaceId}::uuid AND r."marketingFormId" = ${formId}::uuid AND r."deletedAt" IS NULL
      UNION ALL
      SELECT 'PARTIAL'::text AS source, p.id, p."publicId", p."marketingFormVersionId", v.version,
        'INCOMPLETO'::text AS status, p."utmSource", p."utmMedium", p."utmCampaign", p."lastAnsweredAt" AS "submittedAt", NULL::timestamptz AS "acceptedAt",
        p."respondentName" AS "submittedFullName", p."respondentEmail" AS "submittedEmail", p."respondentPhone" AS "submittedPhone", NULL::uuid AS "leadId", NULL::text AS "intakeOutcome"
      FROM "marketing_form_partial_responses" p
      JOIN "marketing_form_versions" v ON v."workspaceId" = p."workspaceId" AND v.id = p."marketingFormVersionId"
      WHERE p."workspaceId" = ${context.workspaceId}::uuid AND p."marketingFormId" = ${formId}::uuid AND p."completedAt" IS NULL AND p."deletedAt" IS NULL
    `;
    type UnifiedRow = { source: "RECEIPT" | "PARTIAL"; id: string; publicId: string; marketingFormVersionId: string; version: number; status: string; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; submittedAt: Date; acceptedAt: Date | null; submittedFullName: string | null; submittedEmail: string | null; submittedPhone: string | null; leadId: string | null; intakeOutcome: string | null };
    const [deleteDecision, versions, counts, rows] = await Promise.all([
      options.authorization.authorize(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE, resource(context, formId)),
      options.database.marketingFormVersion.findMany({ where: { workspaceId: context.workspaceId, marketingFormId: formId }, select: { version: true }, orderBy: { version: "desc" } }),
      options.database.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS total FROM (${responseRows}) response ${filters}`),
      options.database.$queryRaw<UnifiedRow[]>(Prisma.sql`SELECT * FROM (${responseRows}) response ${filters} ORDER BY response."submittedAt" DESC, response.id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`),
    ]);
    return {
      total: Number(counts[0]?.total ?? 0n),
      page: query.page,
      pageSize: query.pageSize,
      versions: versions.map((version) => version.version),
      permissions: { delete: deleteDecision.allowed },
      items: rows.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        marketingFormVersionId: row.marketingFormVersionId,
        status: row.status,
        version: row.version,
        utmSource: row.utmSource,
        utmMedium: row.utmMedium,
        utmCampaign: row.utmCampaign,
        submittedAt: row.submittedAt,
        acceptedAt: row.acceptedAt,
        submission: { submittedFullName: row.submittedFullName, submittedEmail: row.submittedEmail, submittedPhone: row.submittedPhone, leadId: row.leadId, intakeOutcome: row.intakeOutcome },
      })),
    };
  }

  async function detail(context: AuthenticatedContext, formId: string, receiptId: string) {
    await assertForm(context, formId);
    const receipt = await options.database.marketingFormReceipt.findFirst({ where: { workspaceId: context.workspaceId, marketingFormId: formId, publicId: receiptId, deletedAt: null } });
    if (!receipt) {
      const partial = await options.database.marketingFormPartialResponse.findFirst({ where: { workspaceId: context.workspaceId, marketingFormId: formId, publicId: receiptId, completedAt: null, deletedAt: null } });
      if (!partial) fail("Resposta não encontrada.", "MARKETING_FORM_RESPONSE_NOT_FOUND", 404);
      const version = await options.database.marketingFormVersion.findFirst({ where: { id: partial.marketingFormVersionId, workspaceId: context.workspaceId, marketingFormId: formId } });
      if (!version) fail("Versão histórica não encontrada.", "MARKETING_FORM_VERSION_NOT_FOUND", 500);
      const definition = parsedDefinition(version.definition);
      const rawAnswers = storedAnswers(partial.answers);
      const answers = definition.questions.map((question) => {
        const rawAnswer = rawAnswers.find((item) => item.questionKey === question.stableKey);
        return { questionKey: question.stableKey, question: question.title, value: rawAnswer?.value ?? null, displayValue: rawAnswer ? answerLabel(definition, question.stableKey, rawAnswer.value) : "—" };
      });
      return {
        receipt: { publicId: partial.publicId, status: "INCOMPLETO", submittedAt: partial.lastAnsweredAt, acceptedAt: null, utmSource: partial.utmSource, utmMedium: partial.utmMedium, utmCampaign: partial.utmCampaign, utmContent: partial.utmContent, utmTerm: partial.utmTerm, referrerHost: partial.referrerHost, redirectKind: null },
        version: version.version,
        submission: { leadId: null, contactId: null, intakeOutcome: null, submittedFullName: partial.respondentName, submittedEmail: partial.respondentEmail, submittedPhone: partial.respondentPhone },
        answers,
      };
    }
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

  async function remove(context: AuthenticatedContext, formId: string, receiptId: string) {
    z.string().uuid().parse(formId);
    z.string().uuid().parse(receiptId);
    await assertForm(context, formId);
    await options.authorization.assertAuthorized(context, PermissionKeys.MARKETING_DEFINITIONS_MANAGE, resource(context, formId));
    return options.database.$transaction(async (transaction) => {
      const receipt = await transaction.marketingFormReceipt.findFirst({
        where: { workspaceId: context.workspaceId, marketingFormId: formId, publicId: receiptId, deletedAt: null },
        select: { id: true, publicId: true, status: true },
      });
      const deletedAt = options.now();
      if (!receipt) {
        const partial = await transaction.marketingFormPartialResponse.findFirst({ where: { workspaceId: context.workspaceId, marketingFormId: formId, publicId: receiptId, completedAt: null, deletedAt: null }, select: { id: true, publicId: true } });
        if (!partial) fail("Resposta não encontrada.", "MARKETING_FORM_RESPONSE_NOT_FOUND", 404);
        const removed = await transaction.marketingFormPartialResponse.updateMany({ where: { id: partial.id, workspaceId: context.workspaceId, marketingFormId: formId, completedAt: null, deletedAt: null }, data: { deletedAt } });
        if (removed.count !== 1) fail("Resposta não encontrada.", "MARKETING_FORM_RESPONSE_NOT_FOUND", 404);
        await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "marketing.form.response_deleted", entityType: "MarketingFormPartialResponse", entityId: partial.id, changes: { formId, receiptPublicId: partial.publicId, previousStatus: "INCOMPLETO", leadPreserved: false } } });
        return { publicId: partial.publicId, deletedAt, leadPreserved: false };
      }
      const removed = await transaction.marketingFormReceipt.updateMany({
        where: { id: receipt.id, workspaceId: context.workspaceId, marketingFormId: formId, deletedAt: null },
        data: { deletedAt },
      });
      if (removed.count !== 1) fail("Resposta não encontrada.", "MARKETING_FORM_RESPONSE_NOT_FOUND", 404);
      await transaction.auditLog.create({ data: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        action: "marketing.form.response_deleted",
        entityType: "MarketingFormReceipt",
        entityId: receipt.id,
        changes: { formId, receiptPublicId: receipt.publicId, previousStatus: receipt.status, leadPreserved: true },
      } });
      return { publicId: receipt.publicId, deletedAt, leadPreserved: true };
    });
  }

  async function csv(context: AuthenticatedContext, formId: string, raw: unknown) {
    const form = await assertForm(context, formId, true);
    const query = exportQuerySchema.parse(raw);
    const selectedVersion = query.version ? await options.database.marketingFormVersion.findFirst({ where: { workspaceId: context.workspaceId, marketingFormId: formId, version: query.version }, select: { id: true } }) : null;
    const fixedColumns = ["recibo", "status", "versao", "enviado_em", "nome", "email", "telefone", "lead_id", "utm_source", "utm_medium", "utm_campaign"] as const;
    if (query.version && !selectedVersion) return { filename: "formulario-respostas.csv", csv: marketingCsv([], fixedColumns), total: 0 };
    const listQuery = { ...query, page: 1, pageSize: 100 };
    const filter = where(context, formId, listQuery, selectedVersion?.id);
    const searched = query.search ? await searchedReceiptPage(context, formId, listQuery, selectedVersion?.id, 10_000, 0) : null;
    const count = searched?.total ?? await options.database.marketingFormReceipt.count({ where: filter });
    if (count > 10_000) fail("A exportação síncrona está limitada a 10.000 respostas.", "MARKETING_FORM_EXPORT_TOO_LARGE", 422);
    const unorderedReceipts = searched
      ? await options.database.marketingFormReceipt.findMany({ where: { ...filter, id: { in: searched.ids } }, take: 10_000 })
      : await options.database.marketingFormReceipt.findMany({ where: filter, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 10_000 });
    const receipts = searched ? (() => { const byId = new Map(unorderedReceipts.map((receipt) => [receipt.id, receipt])); return searched.ids.flatMap((id) => byId.get(id) ?? []); })() : unorderedReceipts;
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

  return Object.freeze({ list, detail, remove, csv, statistics });
}

let service: ReturnType<typeof createMarketingFormReportingService> | undefined;
export function getMarketingFormReportingService() {
  service ??= createMarketingFormReportingService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return service;
}
