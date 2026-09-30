import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createOutboundCampaignService } from "@/modules/campaigns/application/outbound-campaign-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { seedOmnichannelDemoData } from "@/modules/settings/application/omnichannel-demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
if (!/^politizai_test_[a-z0-9_]+$/.test(process.env.PRISMA_TEST_SCHEMA ?? "")) throw new Error("Stage 10 requires an ephemeral test schema.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const clock = new Date("2046-05-04T15:00:00.000Z");
let workspaceId: string;
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let leadIds: string[];

async function context(email: string) {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspaceId, user: { normalizedEmail: email } }, include: { role: true, user: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug: "politizai", userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName } satisfies AuthenticatedContext;
}

beforeAll(async () => {
  workspaceId = (await seedDemoDatabase(database, { DATABASE_URL: connectionString, NODE_ENV: "test" })).workspaceId;
  await seedOmnichannelDemoData(database, clock);
  [admin, viewer] = await Promise.all([context("admin@demo.politizai.local"), context("viewer@demo.politizai.local")]);
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId, type: "SYSTEM" }, orderBy: { createdAt: "asc" } });
  const system = { workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key } satisfies ServiceActorContext;
  const sourceKey = (await database.leadSource.findFirstOrThrow({ where: { workspaceId, deletedAt: null } })).key;
  const intake = createLeadIntakeService({ database, authorization: createAuthorizationService({ database }), now: () => clock });
  leadIds = [];
  for (const index of [1, 2, 3]) {
    const result = await intake.intake({ channel: "MANUAL", idempotencyKey: `stage10-campaign-lead-${index}`, fullName: `Destinatário Etapa 10 ${index}`, phone: `+55 11 98880-10${index.toString().padStart(2, "0")}`, sourceKey, rawPayload: { fixture: "stage10" } }, system);
    if (result.outcome === "REJECTED") throw new Error(result.code);
    leadIds.push(result.leadId);
  }
  if (leadIds.length < 3) throw new Error("Stage 10 fixture requires three leads with phone contact points.");
});

afterAll(async () => database.$disconnect());

function input(ids: string[], name: string) {
  return { name, channel: "SMS" as const, providerMode: "LOCAL_SIMULATOR" as const, purposeKey: "legacy-commercial-contact", templateBody: "Olá {{nome}}", segment: { leadIds: ids, csvAddresses: [], sourceIds: [], tagIds: [], offerIds: [], fields: {} }, postActions: { tagIds: [], taskTitle: "Retornar contato após campanha" }, windowStartMinute: 0, windowEndMinute: 1440, timeZone: "America/Sao_Paulo", maxRecipients: 10, unitCostCents: 7 };
}

describe("Etapa 10 — campanhas de comunicação em escala", () => {
  it("mantém aquisição de mídia separada, aplica RBAC e bloqueia fornecedor externo", async () => {
    const service = createOutboundCampaignService({ database, now: () => clock });
    await expect(service.screen(viewer)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.screen(admin)).resolves.toMatchObject({ mediaAcquisitionSeparate: true, externalProvidersAuthorized: false, externalEgress: false, providerGate: "EXTERNAL_BLOCKED" });
    await expect(service.create(admin, { ...input([leadIds[0]!], "Fornecedor externo"), providerMode: "EXTERNAL_AUTHORIZED" })).rejects.toMatchObject({ code: "EXTERNAL_PROVIDER_NOT_AUTHORIZED" });
  });

  it("congela preview, executa exatamente o público elegível e concilia recibos/custo", async () => {
    const service = createOutboundCampaignService({ database, now: () => clock });
    const campaign = await service.create(admin, input(leadIds.slice(0, 2), "Amostra pequena"));
    const preview = await service.preview(admin, campaign.id);
    expect(preview.total).toBe(2);
    expect(preview.snapshotHash).toHaveLength(64);
    expect(preview.sample.every((row) => !row.address.includes(leadIds[0]!))).toBe(true);
    await expect(service.approve(admin, campaign.id, "0".repeat(64), "Aprovação humana inválida" )).rejects.toMatchObject({ code: "SNAPSHOT_MISMATCH" });
    await service.approve(admin, campaign.id, preview.snapshotHash, "Amostra, volume, custo e ações conferidos.");
    await service.start(admin, campaign.id);
    await expect(service.processNext(admin, campaign.id, "ACCEPT")).resolves.toMatchObject({ status: "ACCEPTED", externalEgress: false, attemptNumber: 1 });
    await expect(service.processNext(admin, campaign.id, "ACCEPT")).resolves.toMatchObject({ status: "ACCEPTED", externalEgress: false, attemptNumber: 1 });
    await expect(service.processNext(admin, campaign.id, "ACCEPT")).resolves.toMatchObject({ status: "COMPLETED", externalEgress: false });
    const result = await service.screen(admin, campaign.id);
    expect(result.campaigns[0]?.metrics).toMatchObject({ accepted: 2, costCents: 14 });
    const rawAddress = (await database.contactPoint.findFirstOrThrow({ where: { workspaceId, contact: { leads: { some: { id: leadIds[0]! } } }, type: "PHONE" } })).normalizedValue;
    expect(JSON.stringify(result)).not.toContain(rawAddress);
    expect(await database.outboundCampaignAttempt.count({ where: { workspaceId, recipient: { campaignId: campaign.id } } })).toBe(2);
    expect(await database.task.count({ where: { workspaceId, description: { contains: `[campaign:${campaign.id}` } } })).toBe(2);
  });

  it("revalida opt-out antes do envio e cancela fila sem aceitar novos destinatários", async () => {
    const service = createOutboundCampaignService({ database, now: () => clock });
    const suppressed = await service.create(admin, input([leadIds[2]!], "Opt-out tardio"));
    const preview = await service.preview(admin, suppressed.id);
    await service.approve(admin, suppressed.id, preview.snapshotHash, "Público pequeno aprovado antes de nova preferência.");
    await service.start(admin, suppressed.id);
    const lead = await database.lead.findUniqueOrThrow({ where: { id: leadIds[2]! } });
    const point = await database.contactPoint.findFirstOrThrow({ where: { workspaceId, contactId: lead.contactId!, type: "PHONE", deletedAt: null } });
    await database.contactPoint.update({ where: { id: point.id }, data: { doNotContact: true } });
    await expect(service.processNext(admin, suppressed.id, "ACCEPT")).resolves.toMatchObject({ status: "SUPPRESSED", reason: "DO_NOT_CONTACT" });
    expect(await database.outboundCampaignAttempt.count({ where: { workspaceId, recipient: { campaignId: suppressed.id } } })).toBe(0);

    const cancellable = await service.create(admin, input([leadIds[0]!], "Cancelamento governado"));
    const cancellablePreview = await service.preview(admin, cancellable.id);
    await service.approve(admin, cancellable.id, cancellablePreview.snapshotHash, "Cancelamento será exercitado antes de processar.");
    await service.start(admin, cancellable.id);
    await expect(service.cancel(admin, cancellable.id, "Operação cancelada pelo responsável antes do envio.")).resolves.toMatchObject({ status: "CANCELLED" });
    expect(await database.outboundCampaignRecipient.findFirstOrThrow({ where: { campaignId: cancellable.id } })).toMatchObject({ status: "CANCELLED", attemptCount: 0 });
  });

  it("retry é idempotente por destinatário e termina sem envio duplicado", async () => {
    const service = createOutboundCampaignService({ database, now: () => clock });
    const campaign = await service.create(admin, input([leadIds[0]!], "Retry controlado"));
    const preview = await service.preview(admin, campaign.id);
    await service.approve(admin, campaign.id, preview.snapshotHash, "Teste local de retry aprovado pelo administrador.");
    await service.start(admin, campaign.id);
    await expect(service.processNext(admin, campaign.id, "TRANSIENT_FAILURE")).resolves.toMatchObject({ status: "RETRY_PENDING", attemptNumber: 1 });
    await database.outboundCampaignRecipient.updateMany({ where: { campaignId: campaign.id }, data: { nextAttemptAt: clock } });
    await database.job.updateMany({ where: { workspaceId, type: "OUTBOUND_CAMPAIGN", payload: { path: ["campaignId"], equals: campaign.id } }, data: { runAt: clock } });
    await expect(service.processNext(admin, campaign.id, "ACCEPT")).resolves.toMatchObject({ status: "ACCEPTED", attemptNumber: 2 });
    expect(await database.outboundCampaignRecipient.count({ where: { campaignId: campaign.id } })).toBe(1);
    expect(await database.outboundCampaignAttempt.count({ where: { workspaceId, recipient: { campaignId: campaign.id } } })).toBe(2);
  });

  it("agenda persiste jobs futuros sem exigir retorno manual para enfileirar", async () => {
    const service = createOutboundCampaignService({ database, now: () => clock });
    const scheduledAt = new Date(clock.getTime() + 3_600_000).toISOString();
    const campaign = await service.create(admin, { ...input([leadIds[1]!], "Envio agendado"), scheduledAt });
    const preview = await service.preview(admin, campaign.id);
    await service.approve(admin, campaign.id, preview.snapshotHash, "Agenda, público e limites aprovados para execução futura.");
    await service.start(admin, campaign.id);
    await expect(service.processNext(admin, campaign.id, "ACCEPT")).resolves.toMatchObject({ status: "IDLE", externalEgress: false });
    await expect(database.job.findFirstOrThrow({ where: { workspaceId, type: "OUTBOUND_CAMPAIGN", payload: { path: ["campaignId"], equals: campaign.id } } })).resolves.toMatchObject({ status: "PENDING", runAt: new Date(scheduledAt) });
  });
});
