import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { resolveServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
import { externalQuizResponseSchema } from "@/modules/acquisition-api/domain/external-quiz-contracts";
import { METRIC_LEAD_EXCLUSION_ACTION } from "@/modules/metrics/application/metric-lead-exclusions";
import { z } from "zod";

const rowSchema = z.object({ id: z.string().uuid(), created_at: z.string(), updated_at: z.string(), nome: z.string().trim().min(2).max(200), whatsapp: z.string(), answers: z.record(z.string(), z.string()), current_step: z.number().int().min(3).max(11), completed: z.boolean(), origem: z.enum(["chatmandato", "quizmandato"]), utm_source: z.string().nullable(), utm_medium: z.string().nullable(), utm_campaign: z.string().nullable(), utm_term: z.string().nullable(), utm_content: z.string().nullable(), referrer: z.string().nullable(), delivery_status: z.string().nullable() });
const apply = process.argv.includes("--apply");
const inputFile = process.env.MANDATO_IMPORT_FILE;
const outputFile = process.env.MANDATO_IMPORT_REPORT;
const start = new Date(process.env.MANDATO_IMPORT_START!);
const end = new Date(process.env.MANDATO_IMPORT_END!);
if (!inputFile || !outputFile || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() !== 7 * 86400000 || !process.env.DATABASE_URL) throw Error("Explicit weekly scope, input and report required");
if (apply && process.env.CONFIRM_MANDATO_IMPORT !== "politizai-pipeline-only") throw Error("Explicit apply confirmation required");
const rows = z.array(rowSchema).parse(JSON.parse(readFileSync(inputFile, "utf8")));
if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error("Repeated source ID");
if (rows.some((row) => new Date(row.created_at) < start || new Date(row.created_at) >= end || !Number.isFinite(new Date(row.created_at).getTime()))) throw Error("Row outside explicit week");
const questions = JSON.parse(readFileSync(new URL("../src/modules/acquisition-api/domain/external-quiz-questions-v1.json", import.meta.url), "utf8")) as Record<string, { key: string; question: string }[]>;
const database = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL, { max: 3 }) });
const output: Record<string, unknown>[] = [];
try {
 const workspace = await database.workspace.findUniqueOrThrow({ where: { slug: "politizai" } });
 const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: workspace.id, type: "SYSTEM", userId: null }, orderBy: { createdAt: "asc" } });
 const context = await resolveServiceActorContext(workspace.id, actor.id, "SYSTEM", database);
 const authorization = createAuthorizationService({ database });
 for (const row of rows) {
  const connection = await database.integrationConnection.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId: workspace.id, key: `site-${row.origem}` } }, include: { configVersions: { orderBy: { version: "desc" }, take: 1 } } });
  const config = connection.configVersions[0]!.config as { sourceKey: string; externalQuiz: { quizId: string; pipelineId: string; initialStageId: string } };
  if (!connection.enabled || config.externalQuiz.quizId !== row.origem) throw Error("Quiz connection mismatch");
  const stage = await database.pipelineStage.findFirstOrThrow({ where: { id: config.externalQuiz.initialStageId, workspaceId: workspace.id, pipelineId: config.externalQuiz.pipelineId, type: "OPEN", deletedAt: null, pipeline: { name: "Anúncios", workspaceId: workspace.id, deletedAt: null } } });
  const idempotencyKey = `acq:${connection.id}:external:${row.id}`;
  const existing = await database.leadFormSubmission.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: workspace.id, idempotencyKey } }, select: { id: true, leadId: true } });
  if (existing) { output.push({ sourceId: row.id, quiz: row.origem, status: "ALREADY_PRESENT", leadId: existing.leadId }); continue; }
  const phone = normalizePhone(row.whatsapp);
  if (!phone.success) throw Error(`Invalid source contact: ${row.id}`);
  const quizResponse = externalQuizResponseSchema.parse({ quiz: { id: row.origem, name: row.origem === "chatmandato" ? "ChatMandato" : "QuizMandato", version: "1", url: `https://site.politizai.com/${row.origem}` }, completionStatus: row.completed ? "COMPLETED" : "PARTIAL", answers: questions[row.origem]!.filter((q) => row.answers[q.key] !== undefined).map((q) => ({ questionKey: q.key, question: q.question.replaceAll("[Nome]", row.nome.split(/\s+/)[0]!), value: row.answers[q.key]!, displayValue: row.answers[q.key]! })) });
  const summary = [`Importação histórica · ${row.completed ? "Diagnóstico concluído" : `Diagnóstico incompleto (${row.current_step}/11)`}`, ...["cargo", "localidade", "desafio", "organizacao", "frequencia", "prioridade", "prazo", "investimento_mensal"].flatMap((key) => row.answers[key] ? [`${key}: ${row.answers[key]}`] : [])].join(" | ").slice(0, 2000);
  const rawPayload = { provider: "FORM", historicalImport: true, externalSubmissionId: row.id, quizResponse, interestSummary: summary };
  const payload = { channel: "FORM", idempotencyKey, formIdentifier: connection.key, pipelineId: config.externalQuiz.pipelineId, initialStageId: stage.id, fullName: row.nome, phone: phone.normalizedPhone, ...(row.answers.cargo ? { jobTitle: row.answers.cargo } : {}), interestSummary: summary, sourceKey: config.sourceKey, submittedAt: new Date(row.created_at), rawPayload, priorityBandCode: "P3", acquisition: { sessionPublicId: row.id, marketingFormKey: `${connection.key}-form`, marketingFormVersion: 1, landingUrl: `https://site.politizai.com/${row.origem}`, ...(row.referrer ? { referrerUrl: row.referrer } : {}), ...Object.fromEntries(([['utmSource','utm_source'],['utmMedium','utm_medium'],['utmCampaign','utm_campaign'],['utmContent','utm_content'],['utmTerm','utm_term']] as const).flatMap(([canonical,key])=>row[key] ? [[canonical,row[key]]] : [])) } };
  if (!apply) { output.push({ sourceId: row.id, quiz: row.origem, status: "WOULD_IMPORT", completed: row.completed, answers: quizResponse.answers.length }); continue; }
  const intake = createLeadIntakeService({ database, authorization, now: () => new Date(row.created_at) });
  const result = await database.$transaction(async (tx) => {
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`acquisition-object:${workspace.id}:${connection.id}:${row.id}`},0))`;
   const accepted = await intake.intake(payload, context, tx);
   if (accepted.outcome === "REJECTED") throw Error(`Intake rejected ${row.id}: ${accepted.code}`);
   if (!accepted.idempotentReplay && accepted.outcome !== "CREATED") throw Error("Historical exclusion cannot affect an existing unrelated lead");
   if (!accepted.idempotentReplay) {
    await tx.auditLog.create({ data: { workspaceId: workspace.id, actorId: actor.id, action: METRIC_LEAD_EXCLUSION_ACTION, entityType: "Lead", entityId: accepted.leadId, origin: "SYSTEM", reason: "Importação histórica solicitada somente para o pipeline; excluir Tempo Real e metas.", changes: { sourceSubmissionId: row.id, quizId: row.origem, weekStart: start.toISOString(), weekEnd: end.toISOString(), historicalImport: true } } });
    await tx.job.updateMany({ where: { workspaceId: workspace.id, status: "PENDING", OR: [{ payload: { path: ["slaCycleId"], equals: accepted.slaCycleId } }, { idempotencyKey: `telegram-ad-lead:${accepted.leadId}:carlos` }] }, data: { status: "CANCELLED", cancelledAt: new Date(), finishedAt: new Date(), errorCode: "HISTORICAL_PIPELINE_ONLY" } });
    await tx.auditLog.create({ data: { workspaceId: workspace.id, actorId: actor.id, action: "lead.historical_quiz_imported", entityType: "Lead", entityId: accepted.leadId, origin: "SYSTEM", changes: { sourceSubmissionId: row.id, submissionId: accepted.submissionId, quizId: row.origem, completed: row.completed, notify: false, metrics: false } } });
   }
   await tx.externalObjectMapping.upsert({ where: { workspaceId_connectionId_externalObjectType_externalId: { workspaceId: workspace.id, connectionId: connection.id, externalObjectType: "lead", externalId: row.id } }, create: { workspaceId: workspace.id, connectionId: connection.id, externalObjectType: "lead", externalId: row.id, internalEntityType: "LEAD", internalEntityId: accepted.leadId, externalVersion: new Date(row.updated_at).toISOString(), externalHash: createHash("sha256").update(JSON.stringify(rawPayload)).digest("hex"), firstRecognizedAt: new Date(), lastRecognizedAt: new Date(), createdByActorId: actor.id, updatedByActorId: actor.id }, update: {} });
   return accepted;
  }, { timeout: 20000 });
  output.push({ sourceId: row.id, quiz: row.origem, status: result.idempotentReplay ? "ALREADY_PRESENT" : "IMPORTED", completed: row.completed, leadId: result.leadId, submissionId: result.submissionId });
  writeFileSync(outputFile, JSON.stringify(output, null, 2), { mode: 0o600 });
 }
 writeFileSync(outputFile, JSON.stringify(output, null, 2), { mode: 0o600 });
 console.log(JSON.stringify({ apply, rows: output.length, imported: output.filter(r=>r.status==="IMPORTED").length, wouldImport: output.filter(r=>r.status==="WOULD_IMPORT").length, alreadyPresent: output.filter(r=>r.status==="ALREADY_PRESENT").length, complete: output.filter(r=>r.completed===true).length, incomplete: output.filter(r=>r.completed===false).length }));
} finally { await database.$disconnect(); }
