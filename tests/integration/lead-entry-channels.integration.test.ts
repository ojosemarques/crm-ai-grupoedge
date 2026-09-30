import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createLeadCsvImportService } from "@/modules/leads/application/lead-csv-import-service";
import { createLeadEntryService } from "@/modules/leads/application/lead-entry-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createLocalLeadWebhookService } from "@/modules/leads/application/local-lead-webhook-service";
import {
  DEMO_USERS,
  DEMO_WORKSPACE_SLUG,
  seedDemoDatabase,
} from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for CRM-07 integration tests.");
}

const database = new PrismaClient({
  adapter: createPostgresAdapter(connectionString, { max: 15 }),
});
const authorization = createAuthorizationService({ database });
const fixedNow = new Date("2032-02-12T14:30:00.000Z");

let managerContext: AuthenticatedContext;
let viewerContext: AuthenticatedContext;

function uniquePhone(label: string): string {
  const hex = createHash("sha256").update(`${label}:${randomUUID()}`).digest("hex");
  const suffix = (BigInt(`0x${hex.slice(0, 12)}`) % 100_000_000n)
    .toString()
    .padStart(8, "0");
  return `+55119${suffix}`;
}

async function contextFor(email: string): Promise<AuthenticatedContext> {
  const workspace = await database.workspace.findUniqueOrThrow({
    where: { slug: DEMO_WORKSPACE_SLUG },
  });
  const user = await database.user.findUniqueOrThrow({
    where: { normalizedEmail: email },
  });
  const member = await database.workspaceMember.findFirstOrThrow({
    where: { workspaceId: workspace.id, userId: user.id, deletedAt: null },
    include: { role: true },
  });
  const actor = await database.actor.findFirstOrThrow({
    where: { workspaceId: workspace.id, userId: user.id, type: "HUMAN" },
  });
  return Object.freeze({
    sessionId: randomUUID(),
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    userId: user.id,
    memberId: member.id,
    actorId: actor.id,
    roleId: member.roleId,
    roleKey: member.role.key,
    roleName: member.role.name,
    displayName: user.displayName,
  });
}

function manualPayload(phone: string, idempotencyKey = randomUUID()) {
  return {
    idempotencyKey,
    lead: {
      fullName: "Lead fictício CRM-07",
      phone,
      email: `lead-${idempotencyKey}@example.invalid`,
      jobTitle: "Contato de teste",
      organizationName: "Organização fictícia",
      city: "São Paulo",
      stateCode: "SP",
      interestSummary: "Validar o canal de entrada manual.",
      budgetBrl: "6500,00",
      sourceKey: "manual",
      consent: true,
      priorityBandCode: "P2",
    },
  };
}

function csvRequest(content: string, fileName = "leads-crm07.csv") {
  return {
    fileName,
    content,
    mapping: {
      fullName: "nome",
      phone: "telefone",
      email: "email",
      priorityBandCode: "prioridade",
    },
    defaults: { sourceKey: "manual", priorityBandCode: "P3" },
  };
}

beforeAll(async () => {
  await seedDemoDatabase(database, {
    DATABASE_URL: connectionString,
    NODE_ENV: "test",
  });
  managerContext = await contextFor(DEMO_USERS[1].email);
  viewerContext = await contextFor(DEMO_USERS.at(-1)!.email);
});

afterAll(async () => {
  await database.$disconnect();
});

describe("canais locais de entrada da CRM-07", () => {
  it("cadastra manualmente, preserva o payload e rejeita formulário inválido", async () => {
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const service = createLeadEntryService({ database, authorization, intake });
    const phone = uniquePhone("manual");
    const payload = manualPayload(phone);

    const created = await service.createManual(payload, managerContext);
    expect(created).toMatchObject({
      outcome: "CREATED",
      normalizedPhone: phone,
      priorityBandCode: "P1",
      idempotentReplay: false,
    });
    if (created.outcome === "REJECTED") throw new Error("Entrada deveria ser aceita.");

    const submission = await database.leadFormSubmission.findUniqueOrThrow({
      where: { id: created.submissionId },
    });
    expect(submission.channel).toBe("MANUAL");
    expect(submission.rawPayload).toEqual(payload);
    expect(submission.submittedBudgetCents).toBe(650_000n);

    const invalid = await service.createManual(
      { idempotencyKey: randomUUID(), lead: { fullName: "A" } },
      managerContext,
    );
    expect(invalid).toMatchObject({ outcome: "REJECTED", code: "INVALID_PAYLOAD" });
  });

  it("cadastra o lead no pipeline selecionado pelo funil", async () => {
    const pipeline = await database.pipeline.create({
      data: {
        workspaceId: managerContext.workspaceId,
        name: `Pipeline rápido ${randomUUID()}`,
        entityType: "LEAD",
        isDefault: false,
        createdByActorId: managerContext.actorId,
        updatedByActorId: managerContext.actorId,
      },
    });
    const stage = await database.pipelineStage.create({
      data: {
        workspaceId: managerContext.workspaceId,
        pipelineId: pipeline.id,
        name: "Entrada rápida",
        position: 0,
        type: "OPEN",
        leadStageCode: "NEW",
        createdByActorId: managerContext.actorId,
        updatedByActorId: managerContext.actorId,
      },
    });
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const service = createLeadEntryService({ database, authorization, intake });
    const payload = { ...manualPayload(uniquePhone("pipeline-selected")), pipelineId: pipeline.id };

    const created = await service.createManual(payload, managerContext);
    if (created.outcome === "REJECTED") throw new Error("Entrada deveria ser aceita.");
    const lead = await database.lead.findUniqueOrThrow({ where: { id: created.leadId } });

    expect(lead.pipelineId).toBe(pipeline.id);
    expect(lead.currentStageId).toBe(stage.id);

    const invalidPipeline = await service.createManual(
      { ...manualPayload(uniquePhone("pipeline-invalid")), pipelineId: randomUUID() },
      managerContext,
    );
    expect(invalidPipeline).toMatchObject({
      outcome: "REJECTED",
      code: "CONFIGURATION_UNAVAILABLE",
    });
  });

  it("cadastra manualmente quando a fila geral ainda não está configurada", async () => {
    const generalQueues = await database.queue.findMany({
      where: { workspaceId: managerContext.workspaceId, isGeneral: true },
      select: { id: true, key: true, deletedAt: true },
    });
    for (const queue of generalQueues) {
      await database.queue.update({
        where: { id: queue.id },
        data: { isGeneral: false, key: `disabled-${queue.id}` },
      });
    }

    try {
      const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
      const service = createLeadEntryService({ database, authorization, intake });
      const created = await service.createManual(
        manualPayload(uniquePhone("missing-general-queue")),
        managerContext,
      );

      expect(created.outcome).toBe("CREATED");
      if (created.outcome === "REJECTED") throw new Error("Entrada deveria ser aceita.");

      const generalQueue = await database.queue.findFirstOrThrow({
        where: {
          workspaceId: managerContext.workspaceId,
          isGeneral: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      const lead = await database.lead.findUniqueOrThrow({ where: { id: created.leadId } });
      expect(lead.routingQueueId).toBe(generalQueue.id);
      expect(generalQueues.map(({ id }) => id)).not.toContain(generalQueue.id);
    } finally {
      await database.queue.updateMany({
        where: {
          workspaceId: managerContext.workspaceId,
          isGeneral: true,
          id: { notIn: generalQueues.map(({ id }) => id) },
        },
        data: { isGeneral: false, deletedAt: fixedNow },
      });
      for (const queue of generalQueues) {
        await database.queue.update({
          where: { id: queue.id },
          data: { isGeneral: true, key: queue.key, deletedAt: queue.deletedAt },
        });
      }
    }
  });

  it("gera preview e importa arquivo completo usando a fronteira única", async () => {
    const firstPhone = uniquePhone("csv-complete-1");
    const secondPhone = uniquePhone("csv-complete-2");
    const request = csvRequest(
      `nome,telefone,email,prioridade\nLead CSV Um,${firstPhone},um@example.invalid,P1\nLead CSV Dois,${secondPhone},dois@example.invalid,P3`,
    );
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const service = createLeadCsvImportService({ database, authorization, intake, now: () => fixedNow });

    const preview = await service.preview(request, managerContext);
    expect(preview.counts).toEqual({ total: 2, valid: 2, invalid: 0, duplicate: 0 });

    const firstRun = await service.execute(request, managerContext);
    expect(firstRun.job).toMatchObject({
      status: "SUCCEEDED",
      totalRows: 2,
      processedRows: 2,
      succeededRows: 2,
      failedRows: 0,
    });
    expect(firstRun.job.startedAt).toEqual(firstRun.job.createdAt);
    expect(firstRun.report.map((row) => row.outcome)).toEqual(["CREATED", "CREATED"]);

    const secondRun = await service.execute(request, managerContext);
    expect(secondRun.report).toEqual([
      expect.objectContaining({ outcome: "CREATED", idempotentReplay: true }),
      expect.objectContaining({ outcome: "CREATED", idempotentReplay: true }),
    ]);
    expect(
      await database.lead.count({
        where: { workspaceId: managerContext.workspaceId, normalizedPhone: { in: [firstPhone, secondPhone] } },
      }),
    ).toBe(2);
    expect(
      await database.leadFormSubmission.count({
        where: { workspaceId: managerContext.workspaceId, normalizedPhone: { in: [firstPhone, secondPhone] } },
      }),
    ).toBe(2);
  });

  it("expõe linhas válidas, inválidas e duplicadas sem importar erro silenciosamente", async () => {
    const phone = uniquePhone("csv-partial");
    const request = csvRequest(
      `nome,telefone,email,prioridade\nLead Válido,${phone},valido@example.invalid,P1\nLead Duplicado,${phone},duplicado@example.invalid,P2\nLead Inválido,123,invalido@example.invalid,P3`,
      "parcial.csv",
    );
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const service = createLeadCsvImportService({ database, authorization, intake, now: () => fixedNow });

    const preview = await service.preview(request, managerContext);
    expect(preview.counts).toEqual({ total: 3, valid: 1, invalid: 1, duplicate: 1 });
    expect(preview.rows.map((row) => row.status)).toEqual(["VALID", "DUPLICATE", "INVALID"]);

    const execution = await service.execute(request, managerContext);
    expect(execution.job).toMatchObject({
      status: "PARTIALLY_SUCCEEDED",
      processedRows: 3,
      succeededRows: 2,
      failedRows: 1,
    });
    expect(execution.report.map((row) => row.outcome)).toEqual(["CREATED", "CREATED", "REJECTED"]);
    const report = await service.errorReport(execution.job.id, managerContext);
    expect(report.content).toContain("linha;status;erros");
    expect(report.content).toContain("4;REJECTED");
  });

  it("rejeita CSV malformado e mapeamento inexistente", async () => {
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const service = createLeadCsvImportService({ database, authorization, intake, now: () => fixedNow });

    await expect(
      service.preview(csvRequest('nome,telefone,email,prioridade\n"aspas sem fim'), managerContext),
    ).rejects.toMatchObject({ code: "MALFORMED_CSV", statusCode: 422 });
    await expect(
      service.preview(
        { ...csvRequest("nome,telefone\nPessoa,+5511987654321"), mapping: { fullName: "ausente", phone: "telefone" } },
        managerContext,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CSV_MAPPING", statusCode: 422 });

    const invalidReference = await service.preview(
      {
        ...csvRequest("nome,telefone\nPessoa,+5511987654309"),
        mapping: { fullName: "nome", phone: "telefone" },
        defaults: {
          sourceKey: "origem-inexistente",
          priorityBandCode: "P3",
        },
      },
      managerContext,
    );
    expect(invalidReference.rows[0]).toMatchObject({
      status: "INVALID",
      issues: [
        { field: "sourceKey", message: "A origem não existe neste workspace." },
      ],
    });
  });

  it("persiste um único WebhookEvent e um único efeito ao repetir a chave", async () => {
    const phone = uniquePhone("webhook");
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const service = createLocalLeadWebhookService({ database, authorization, intake, now: () => fixedNow });
    const payload = {
      eventId: `event-${randomUUID()}`,
      eventType: "lead.received",
      lead: {
        fullName: "Lead webhook fictício",
        phone,
        sourceKey: "website",
        priorityBandCode: "P1",
      },
    };

    const first = await service.receive(payload, managerContext);
    const repeated = await service.receive(payload, managerContext);
    expect(first).toMatchObject({ eventStatus: "PROCESSED", idempotentReplay: false });
    expect(repeated).toMatchObject({ eventStatus: "PROCESSED", idempotentReplay: true });
    expect(repeated.result).toMatchObject({ outcome: "CREATED", idempotentReplay: true });
    expect(
      await database.webhookEvent.count({
        where: { workspaceId: managerContext.workspaceId, externalEventId: payload.eventId },
      }),
    ).toBe(1);
    expect(
      await database.leadFormSubmission.count({
        where: { workspaceId: managerContext.workspaceId, normalizedPhone: phone },
      }),
    ).toBe(1);
    const event = await database.webhookEvent.findFirstOrThrow({
      where: { workspaceId: managerContext.workspaceId, externalEventId: payload.eventId },
    });
    expect(event.payload).toEqual(payload);

    await expect(
      service.receive(
        {
          ...payload,
          lead: { ...payload.lead, phone: uniquePhone("webhook-conflict") },
        },
        managerContext,
      ),
    ).rejects.toMatchObject({
      code: "WEBHOOK_IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
  });

  it("gera cenários P1/P2/P3 e duplicado explicitamente simulados", async () => {
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const service = createLeadEntryService({ database, authorization, intake });

    for (const scenario of ["P1", "P2", "P3"] as const) {
      const generated = await service.simulate(
        { scenario, count: 1, seed: `crm07-${scenario}-${randomUUID()}`, sourceKey: "manual" },
        managerContext,
      );
      expect(generated).toMatchObject({
        outcome: "SIMULATED",
        simulated: true,
        results: [{ simulated: true, scenario, result: { outcome: "CREATED", priorityBandCode: scenario } }],
      });
      if (generated.outcome === "SIMULATED") {
        expect(generated.results[0]?.result).toMatchObject({
          sla: {
            name: "SLA imediato — 0 minutos",
            firstResponseMinutes: 0,
            healthyMaxSeconds: 60,
            attentionMaxSeconds: 180,
            receivedAt: fixedNow.toISOString(),
            assignedAt: fixedNow.toISOString(),
          },
        });
      }
    }

    const duplicate = await service.simulate(
      { scenario: "DUPLICATE", count: 1, seed: `crm07-duplicate-${randomUUID()}`, sourceKey: "manual" },
      managerContext,
    );
    expect(duplicate).toMatchObject({
      outcome: "SIMULATED",
      results: [{ scenario: "DUPLICATE", result: { outcome: "ATTACHED", conversionCount: 2 } }],
    });
  });

  it("aplica autorização no servidor a preview, manual e webhook", async () => {
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const csv = createLeadCsvImportService({ database, authorization, intake, now: () => fixedNow });
    const entry = createLeadEntryService({ database, authorization, intake });
    const webhook = createLocalLeadWebhookService({ database, authorization, intake, now: () => fixedNow });

    await expect(entry.createManual(manualPayload(uniquePhone("denied")), viewerContext)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(csv.preview(csvRequest(`nome,telefone,email,prioridade\nNegado,${uniquePhone("denied-csv")},,P3`), viewerContext)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(webhook.receive({ eventId: randomUUID(), lead: { fullName: "Negado", phone: uniquePhone("denied-hook"), sourceKey: "manual", priorityBandCode: "P3" } }, viewerContext)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("marca o ImportJob como falho e não deixa submissão parcial quando o intake reverte", async () => {
    const phone = uniquePhone("rollback");
    const failingIntake = createLeadIntakeService({
      database,
      authorization,
      now: () => fixedNow,
      afterSubmissionPersisted: async () => {
        throw new Error("falha injetada CRM-07");
      },
    });
    const service = createLeadCsvImportService({ database, authorization, intake: failingIntake, now: () => fixedNow });
    const request = csvRequest(`nome,telefone,email,prioridade\nRollback,${phone},rollback@example.invalid,P2`, "rollback.csv");

    await expect(service.execute(request, managerContext)).rejects.toThrow("falha injetada CRM-07");
    expect(
      await database.leadFormSubmission.count({
        where: { workspaceId: managerContext.workspaceId, normalizedPhone: phone },
      }),
    ).toBe(0);
    const job = await database.importJob.findFirstOrThrow({
      where: { workspaceId: managerContext.workspaceId, fileName: "rollback.csv" },
      orderBy: { createdAt: "desc" },
    });
    expect(job).toMatchObject({ status: "FAILED", processedRows: 0, succeededRows: 0 });
  });

  it("carrega opções persistidas com timezone e política de SLA 0", async () => {
    const intake = createLeadIntakeService({ database, authorization, now: () => fixedNow });
    const service = createLeadEntryService({ database, authorization, intake });
    const options = await service.getOptions(managerContext);

    expect(options.timeZone).toBe("America/Sao_Paulo");
    expect(options.sources.length).toBeGreaterThan(0);
    expect(options.priorityBands.map((band) => band.code)).toEqual(["P1", "P2", "P3"]);
    expect(options.priorityBands.every((band) => band.slaPolicy.firstResponseMinutes === 0)).toBe(true);
  });
});
