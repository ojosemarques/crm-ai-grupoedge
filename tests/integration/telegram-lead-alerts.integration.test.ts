import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createTelegramBindingService, createTelegramLeadAlertWorker } from "@/modules/integrations/application/telegram-lead-alert-service";
import { TELEGRAM_CONFIG_VERSION, TELEGRAM_CONNECTION_KEY, TELEGRAM_LEAD_JOB_KIND } from "@/modules/integrations/domain/telegram-contracts";
import { createMarketingFormSubmissionService } from "@/modules/marketing-forms/application/marketing-form-submission-service";
import { createMarketingFormPartialLeadWorker, enqueuePartialLeadInTransaction, partialLeadKey, PARTIAL_LEAD_PLACEHOLDER } from "@/modules/marketing-forms/application/marketing-form-partial-lead-service";
import { createEmptyMarketingFormDefinition } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { loadAcquisitionFunnel } from "@/modules/marketing/application/acquisition-funnel-service";
import { METRIC_LEAD_EXCLUSION_ACTION } from "@/modules/metrics/application/metric-lead-exclusions";

if (!/^politizai_test_/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Ephemeral schema required");
const db = new PrismaClient({ adapter: createPostgresAdapter(process.env.DATABASE_URL!, { max: 10 }) });
const now = new Date();
const activation = "c".repeat(43);
const env = { TELEGRAM_ENABLED: "true", TELEGRAM_BOT_TOKEN: `123456789:${"a".repeat(35)}`, TELEGRAM_WEBHOOK_SECRET: "w".repeat(40), APP_CANONICAL_URL: "https://crm.example.test" };
const authorization = createAuthorizationService({ database: db });
let workspaceId: string, actorId: string, memberId: string, connectionId: string, pipelineId: string, stageId: string;
let counter = 0;
const system = () => ({ workspaceId, actorId, actorType: "SYSTEM" as const, actorKey: "system" });
const service = (fail = false) => createLeadIntakeService({ database: db, authorization, now: () => now, ...(fail ? { afterInitialOperationsPersisted: async () => { throw new Error("rollback telegram"); } } : {}) });
const input = (ads = true) => ({ channel: "AD", idempotencyKey: randomUUID(), fullName: `Lead Telegram ${++counter}`, phone: `+5511987654${String(counter).padStart(3, "0")}`, sourceKey: "manual", priorityBandCode: "P3", ...(ads ? { pipelineId, initialStageId: stageId } : {}), rawPayload: { test: "telegram" } });
const update = (text = `/start ${activation}`, type = "private", chatId = 12345, userId = chatId) => ({ update_id: 1, message: { message_id: 1, date: Math.floor(now.getTime() / 1000), chat: { id: chatId, type }, from: { id: userId, is_bot: false }, text } });

beforeAll(async () => {
  await seedDemoDatabase(db, { DATABASE_URL: process.env.DATABASE_URL!, NODE_ENV: "test" });
  workspaceId = (await db.workspace.findUniqueOrThrow({ where: { slug: "politizai" } })).id;
  actorId = (await db.actor.findFirstOrThrow({ where: { workspaceId, key: "system" } })).id;
  const role = await db.role.findFirstOrThrow({ where: { workspaceId, key: "closer" } });
  const user = await db.user.upsert({ where: { normalizedEmail: "carloshenrique@politizai.com" }, update: {}, create: { email: "carloshenrique@politizai.com", normalizedEmail: "carloshenrique@politizai.com", displayName: "Carlos Henrique" } });
  memberId = (await db.workspaceMember.create({ data: { workspaceId, userId: user.id, roleId: role.id, status: "ACTIVE", createdByActorId: actorId, updatedByActorId: actorId } })).id;
  await ensureAdvertisingPipeline(db, workspaceId, actorId);
  const pipeline = await db.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Anúncios" }, include: { stages: true } });
  pipelineId = pipeline.id; stageId = pipeline.stages.find((s) => s.leadStageCode === "NEW")!.id;
  const connection = await db.integrationConnection.create({ data: { workspaceId, key: TELEGRAM_CONNECTION_KEY, providerKey: "TELEGRAM", adapterKey: "telegram-lead-alerts", displayName: "Telegram Carlos", environment: "PRODUCTION", capabilityLevel: "PRODUCTION", createdByActorId: actorId, updatedByActorId: actorId } });
  connectionId = connection.id;
  await db.integrationConnectionConfigVersion.create({ data: { workspaceId, connectionId, version: 1, schemaVersion: TELEGRAM_CONFIG_VERSION, configHash: "fixture", config: { state: "PENDING", recipientMemberId: memberId, activationHash: createHash("sha256").update(activation).digest("hex"), expiresAt: new Date(now.getTime() + 86400000).toISOString() }, createdByActorId: actorId } });
});

async function partialForm() {
  const slug = `telegram-parcial-${randomUUID().slice(0, 8)}`;
  const definition = createEmptyMarketingFormDefinition();
  definition.questions.push({ stableKey: "telefone", type: "PHONE", title: "Telefone", required: true, position: 1, mapping: "phone", config: { defaultCountry: "BR" } });
  definition.destination = { sourceKey: "manual", pipelineId, initialStageId: stageId, queueId: null, tagIds: [], priorityBandCode: "P3" };
  const form = await db.marketingForm.create({ data: { workspaceId, key: slug, name: "Form Telegram", publicSlug: slug, status: "ACTIVE", draftDefinition: definition, createdByActorId: actorId, updatedByActorId: actorId } });
  const version = await db.marketingFormVersion.create({ data: { workspaceId, marketingFormId: form.id, version: 1, schemaVersion: "marketing-form.v1", definition, definitionHash: "fixture", publishedAt: now, publishedByActorId: actorId, createdByActorId: actorId } });
  await db.marketingForm.update({ where: { id: form.id }, data: { publishedVersionId: version.id } });
  const formService = createMarketingFormSubmissionService({ database: db, now: () => now, leadIntake: service() });
  const sessionPublicId = randomUUID();
  const record = (answers: { key: string; answer: string }[]) => formService.recordEvents(slug, { versionPublicId: version.publicId, sessionPublicId, tracking: {}, events: answers.map(({ key, answer }) => ({ eventId: randomUUID(), kind: "QUESTION_ANSWERED", questionKey: key, answer, occurredAt: now.toISOString() })) });
  return { form, version, formService, sessionPublicId, record, slug };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await db.$disconnect(); });

describe("alertas Telegram para Carlos", () => {
  it("recusa código errado, grupo, remetente divergente e comando sem ativação", async () => {
    const fetchImpl = vi.fn();
    const binding = createTelegramBindingService({ database: db, now: () => now, environment: env, fetchImpl });
    for (const payload of [update(`/start ${"x".repeat(43)}`), update(`/start ${activation}`, "group"), update(`/start ${activation}`, "private", 12345, 55555), update("/start")]) {
      await expect(binding.receive(payload)).resolves.toEqual({ status: "IGNORED" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await db.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } })).enabled).toBe(false);
  });

  it("recusa ativação expirada e destinatário Carlos inativo", async () => {
    const fetchImpl = vi.fn();
    await expect(createTelegramBindingService({ database: db, now: () => new Date(now.getTime() + 86400001), environment: env, fetchImpl }).receive(update())).resolves.toEqual({ status: "IGNORED" });
    await db.workspaceMember.update({ where: { id: memberId }, data: { status: "INACTIVE" } });
    await expect(createTelegramBindingService({ database: db, now: () => now, environment: env, fetchImpl }).receive(update())).resolves.toEqual({ status: "IGNORED" });
    await db.workspaceMember.update({ where: { id: memberId }, data: { status: "ACTIVE" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ativa uma única vez sem permitir que outro chat tome o vínculo", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
    const binding = createTelegramBindingService({ database: db, now: () => now, environment: env, fetchImpl });
    await expect(binding.receive(update())).resolves.toEqual({ status: "CONNECTED" });
    await expect(binding.receive(update())).resolves.toEqual({ status: "IGNORED" });
    await expect(binding.receive(update(`/start ${activation}`, "private", 55555))).resolves.toEqual({ status: "IGNORED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const version = await db.integrationConnectionConfigVersion.findFirstOrThrow({ where: { connectionId }, orderBy: { version: "desc" } });
    expect(version.config).toEqual({ state: "CONNECTED", recipientMemberId: memberId, chatId: "12345", telegramUserId: "12345" });
  });

  it("cria um aviso por lead de Anúncios, preserva rollback e ignora duplicados e outros pipelines", async () => {
    const payload = input();
    const created = await service().intake(payload, system());
    if (created.outcome === "REJECTED") throw new Error(created.code);
    const where = { workspaceId, idempotencyKey: `telegram-ad-lead:${created.leadId}:carlos` };
    expect(await db.job.count({ where })).toBe(1);
    await service().intake(payload, system());
    await service().intake({ ...payload, idempotencyKey: randomUUID() }, system());
    expect(await db.job.count({ where })).toBe(1);
    const other = await service().intake(input(false), system());
    if (other.outcome === "REJECTED") throw new Error(other.code);
    expect(await db.job.count({ where: { workspaceId, idempotencyKey: `telegram-ad-lead:${other.leadId}:carlos` } })).toBe(0);
    const jobsBefore = await db.job.count({ where: { workspaceId, payload: { path: ["kind"], equals: TELEGRAM_LEAD_JOB_KIND } } });
    await expect(service(true).intake(input(), system())).rejects.toThrow("rollback telegram");
    expect(await db.job.count({ where: { workspaceId, payload: { path: ["kind"], equals: TELEGRAM_LEAD_JOB_KIND } } })).toBe(jobsBefore);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), { status: 200 }));
    const worker = createTelegramLeadAlertWorker({ database: db, now: () => now, environment: env, fetchImpl });
    await expect(worker.processLead(workspaceId, created.leadId)).resolves.toEqual({ status: "SUCCEEDED" });
    await expect(worker.processLead(workspaceId, created.leadId)).resolves.toEqual({ status: "IDLE" });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toMatchObject({ chat_id: "12345", text: expect.stringContaining(payload.fullName), reply_markup: { inline_keyboard: [[{ text: "Abrir lead no CRM", url: `https://crm.example.test/leads/${created.leadId}/historico` }]] } });
  });

  it("envia logo após o commit e registra sucesso antes do retorno da entrada", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, request: RequestInit) => {
      const text = JSON.parse(String(request.body)).text as string;
      const name = text.split("Nome: ")[1]!.split("\n")[0]!;
      expect(await db.lead.count({ where: { workspaceId, fullName: name } })).toBe(1);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 3 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const result = await service().intake(input(), system());
    if (result.outcome === "REJECTED") throw new Error(result.code);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await db.job.findFirst({ where: { workspaceId, idempotencyKey: `telegram-ad-lead:${result.leadId}:carlos` }, select: { status: true } })).toEqual({ status: "SUCCEEDED" });
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });

  it("recupera limitação temporária, mas não envia ao Carlos inativo", async () => {
    const result = await service().intake(input(), system());
    if (result.outcome === "REJECTED") throw new Error(result.code);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, parameters: { retry_after: 15 } }), { status: 429 }));
    const worker = createTelegramLeadAlertWorker({ database: db, now: () => now, environment: env, fetchImpl });
    await expect(worker.processLead(workspaceId, result.leadId)).resolves.toMatchObject({ status: "RETRY_PENDING" });
    const job = await db.job.findFirstOrThrow({ where: { workspaceId, idempotencyKey: `telegram-ad-lead:${result.leadId}:carlos` } });
    expect(job.runAt.getTime()).toBe(now.getTime() + 15000);
    await db.workspaceMember.update({ where: { id: memberId }, data: { status: "INACTIVE" } });
    await expect(worker.processLead(workspaceId, result.leadId)).resolves.toEqual({ status: "IDLE" });
    await db.workspaceMember.update({ where: { id: memberId }, data: { status: "ACTIVE" } });
  });
});

describe("formulários parciais em Anúncios", () => {
  it("ignora só nome, aceita só telefone, completa o nome e conclui a mesma sessão sem duplicar card ou Telegram", async () => {
    const f = await partialForm();
    const name = `Parcial ${randomUUID().slice(0, 8)}`;
    const phone = "+5511981234432";
    await expect(f.record([{ key: "telefone", answer: "123" }])).rejects.toMatchObject({ code: "MARKETING_FORM_EVENT_ANSWER_INVALID" });
    await f.record([{ key: "nome-completo", answer: name }]);
    const first = await db.marketingFormPartialResponse.findFirstOrThrow({ where: { marketingFormId: f.form.id } });
    expect(await db.job.count({ where: { workspaceId, idempotencyKey: partialLeadKey(first.id) } })).toBe(0);
    // Another respondent supplies only a phone; the later name belongs to this session.
    const onlyPhone = await partialForm();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    await onlyPhone.record([{ key: "telefone", answer: phone }]);
    const partial = await db.marketingFormPartialResponse.findFirstOrThrow({ where: { marketingFormId: onlyPhone.form.id } });
    const submission = await db.leadFormSubmission.findUniqueOrThrow({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: partialLeadKey(partial.id) } } });
    const lead = await db.lead.findUniqueOrThrow({ where: { id: submission.leadId! } });
    expect(lead).toMatchObject({ fullName: PARTIAL_LEAD_PLACEHOLDER, normalizedPhone: phone, pipelineId, createdAt: partial.firstAnsweredAt });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await db.marketingFormReceipt.count({ where: { marketingFormId: onlyPhone.form.id } })).toBe(0);
    await onlyPhone.record([{ key: "nome-completo", answer: name }]);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).fullName).toBe(name);
    const funnel = await loadAcquisitionFunnel(db, workspaceId, new Date(now.getTime() - 86400000), new Date(now.getTime() + 86400000), "Anúncios");
    expect(funnel.incompleteCount).toBe(2);
    const accepted = await onlyPhone.formService.submit(onlyPhone.slug, { versionPublicId: onlyPhone.version.publicId, sessionPublicId: onlyPhone.sessionPublicId, idempotencyToken: randomUUID(), startedAt: new Date(now.getTime() - 2000).toISOString(), tracking: {}, answers: [{ questionKey: "nome-completo", value: name }, { questionKey: "telefone", value: phone }] });
    expect(accepted.outcome).toBe("ACCEPTED");
    const completed = await db.leadFormSubmission.findFirstOrThrow({ where: { workspaceId, marketingFormId: onlyPhone.form.id, marketingFormReceiptId: { not: null } } });
    expect(completed.leadId).toBe(lead.id);
    expect(await db.lead.count({ where: { workspaceId, normalizedPhone: phone } })).toBe(1);
    expect(await db.job.count({ where: { workspaceId, idempotencyKey: `telegram-ad-lead:${lead.id}:carlos` } })).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await onlyPhone.record([{ key: "telefone", answer: phone }]);
    expect((await db.marketingFormPartialResponse.findUniqueOrThrow({ where: { id: partial.id } })).completedAt).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const completedFunnel = await loadAcquisitionFunnel(db, workspaceId, new Date(now.getTime() - 86400000), new Date(now.getTime() + 86400000), "Anúncios");
    await db.auditLog.create({ data: { workspaceId, actorId, action: METRIC_LEAD_EXCLUSION_ACTION, entityType: "Lead", entityId: lead.id } });
    expect((await loadAcquisitionFunnel(db, workspaceId, new Date(now.getTime() - 86400000), new Date(now.getTime() + 86400000), "Anúncios")).cohortSize).toBe(completedFunnel.cohortSize - 1);
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  });

  it("recupera retroativo, mantém a data, é idempotente e cancela resposta excluída", async () => {
    const f = await partialForm();
    const original = new Date(now.getTime() - 2 * 86400000);
    const partial = await db.marketingFormPartialResponse.create({ data: { workspaceId, marketingFormId: f.form.id, marketingFormVersionId: f.version.id, sessionPublicId: f.sessionPublicId, answers: [], respondentName: "Retroativo Telegram", respondentPhone: "+5511981234433", firstAnsweredAt: original, lastAnsweredAt: original, createdByActorId: actorId } });
    await db.$transaction((tx) => enqueuePartialLeadInTransaction(tx, partial.id, workspaceId, actorId, now));
    const worker = createMarketingFormPartialLeadWorker({ database: db, now: () => now, leadIntake: service() });
    await expect(worker.processPartial(workspaceId, partial.id)).resolves.toEqual({ status: "SUCCEEDED" });
    await expect(worker.processPartial(workspaceId, partial.id)).resolves.toEqual({ status: "IDLE" });
    const submission = await db.leadFormSubmission.findUniqueOrThrow({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: partialLeadKey(partial.id) } } });
    expect(submission).toMatchObject({ marketingFormId: f.form.id, marketingFormVersionId: f.version.id, submittedAt: original });
    expect((await db.lead.findUniqueOrThrow({ where: { id: submission.leadId! } })).createdAt).toEqual(original);
    await db.lead.update({ where: { id: submission.leadId! }, data: { createdAt: now } });
    await expect(loadAcquisitionFunnel(db, workspaceId, new Date(original.getTime() - 1000), new Date(original.getTime() + 1000), "Anúncios")).resolves.toMatchObject({ cohortSize: 1, incompleteCount: 1, registeredLeadCount: 0 });
    await db.job.update({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: partialLeadKey(partial.id) } }, data: { status: "PENDING", finishedAt: null } });
    await expect(worker.processPartial(workspaceId, partial.id)).resolves.toEqual({ status: "SUCCEEDED" });
    expect(await db.lead.count({ where: { workspaceId, normalizedPhone: "+5511981234433" } })).toBe(1);
    await db.auditLog.create({ data: { workspaceId, actorId, action: METRIC_LEAD_EXCLUSION_ACTION, entityType: "Lead", entityId: submission.leadId! } });
    await expect(loadAcquisitionFunnel(db, workspaceId, new Date(original.getTime() - 1000), new Date(original.getTime() + 1000), "Anúncios")).resolves.toMatchObject({ cohortSize: 0, incompleteCount: 0, registeredLeadCount: 0 });
    await db.marketingFormPartialResponse.update({ where: { id: partial.id }, data: { deletedAt: now } });
    await db.job.update({ where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey: partialLeadKey(partial.id) } }, data: { status: "PENDING", finishedAt: null } });
    await expect(worker.processPartial(workspaceId, partial.id)).resolves.toEqual({ status: "CANCELLED" });
    expect(await db.lead.count({ where: { id: submission.leadId!, deletedAt: null } })).toBe(1);
  });
});
