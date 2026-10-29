import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createTelegramBindingService, createTelegramLeadAlertWorker } from "@/modules/integrations/application/telegram-lead-alert-service";
import { TELEGRAM_CONFIG_VERSION, TELEGRAM_CONNECTION_KEY, TELEGRAM_LEAD_JOB_KIND } from "@/modules/integrations/domain/telegram-contracts";

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
  const user = await db.user.create({ data: { email: "carloshenrique@politizai.com", normalizedEmail: "carloshenrique@politizai.com", displayName: "Carlos Henrique" } });
  memberId = (await db.workspaceMember.create({ data: { workspaceId, userId: user.id, roleId: role.id, status: "ACTIVE", createdByActorId: actorId, updatedByActorId: actorId } })).id;
  await ensureAdvertisingPipeline(db, workspaceId, actorId);
  const pipeline = await db.pipeline.findFirstOrThrow({ where: { workspaceId, name: "Anúncios" }, include: { stages: true } });
  pipelineId = pipeline.id; stageId = pipeline.stages.find((s) => s.leadStageCode === "NEW")!.id;
  const connection = await db.integrationConnection.create({ data: { workspaceId, key: TELEGRAM_CONNECTION_KEY, providerKey: "TELEGRAM", adapterKey: "telegram-lead-alerts", displayName: "Telegram Carlos", environment: "PRODUCTION", capabilityLevel: "PRODUCTION", createdByActorId: actorId, updatedByActorId: actorId } });
  connectionId = connection.id;
  await db.integrationConnectionConfigVersion.create({ data: { workspaceId, connectionId, version: 1, schemaVersion: TELEGRAM_CONFIG_VERSION, configHash: "fixture", config: { state: "PENDING", recipientMemberId: memberId, activationHash: createHash("sha256").update(activation).digest("hex"), expiresAt: new Date(now.getTime() + 86400000).toISOString() }, createdByActorId: actorId } });
});
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
