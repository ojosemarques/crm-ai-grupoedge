import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { loadAcquisitionFunnel } from "@/modules/marketing/application/acquisition-funnel-service";
import { createMarketingFormAdvertisingSyncService } from "@/modules/marketing-forms/application/marketing-form-advertising-sync-service";
import { createMarketingFormService } from "@/modules/marketing-forms/application/marketing-form-service";
import { createMarketingFormReportingService } from "@/modules/marketing-forms/application/marketing-form-reporting-service";
import { createMarketingFormSubmissionService } from "@/modules/marketing-forms/application/marketing-form-submission-service";
import { createEmptyMarketingFormDefinition } from "@/modules/marketing-forms/domain/marketing-form-contracts";
import { ensureAdvertisingPipeline } from "@/modules/settings/application/production-foundation-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";
import { ApplicationError } from "@/shared/core/errors/application-error";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for marketing form service tests.");

const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2033-03-15T14:30:00.000Z");
const service = createMarketingFormService({ database, authorization, now: () => now });
const submissionService = createMarketingFormSubmissionService({ database, now: () => now, leadIntake: createLeadIntakeService({ database, authorization, now: () => now }) });
const reportingService = createMarketingFormReportingService({ database, authorization, now: () => now });
const advertisingSyncService = createMarketingFormAdvertisingSyncService({ database, authorization, marketingForms: service, now: () => now, ensurePipeline: ensureAdvertisingPipeline });

type Fixture = Readonly<{
  context: AuthenticatedContext;
  viewer: AuthenticatedContext;
  systemActorId: string;
  sourceKey: string;
  pipelineId: string;
  stageId: string;
  queueId: string;
  tagId: string;
}>;

async function createContext(workspaceId: string, workspaceSlug: string, roleId: string, roleKey: string, systemActorId: string, label: string): Promise<AuthenticatedContext> {
  const email = `${label}.${randomUUID()}@forms.test`;
  const user = await database.user.create({ data: { email, normalizedEmail: email, displayName: label } });
  const member = await database.workspaceMember.create({ data: { workspaceId, userId: user.id, roleId, status: "ACTIVE", joinedAt: now, createdByActorId: systemActorId, updatedByActorId: systemActorId } });
  const actor = await database.actor.create({ data: { workspaceId, userId: user.id, type: "HUMAN", key: `user:${user.id}`, displayName: label } });
  return { sessionId: randomUUID(), workspaceId, workspaceSlug, userId: user.id, memberId: member.id, actorId: actor.id, roleId, roleKey, roleName: roleKey, displayName: label };
}

async function createFixture(label: string): Promise<Fixture> {
  const slug = `forms-${label}-${randomUUID().slice(0, 8)}`;
  const workspace = await database.workspace.create({ data: { slug, name: `Forms ${label}` } });
  const system = await database.actor.create({ data: { workspaceId: workspace.id, type: "SYSTEM", key: "system", displayName: "Sistema" } });
  const [managerRole, viewerRole] = await Promise.all([
    database.role.create({ data: { workspaceId: workspace.id, key: "manager", name: "Gestor", createdByActorId: system.id, updatedByActorId: system.id } }),
    database.role.create({ data: { workspaceId: workspace.id, key: "viewer", name: "Viewer", createdByActorId: system.id, updatedByActorId: system.id } }),
  ]);
  for (const key of [
    PermissionKeys.MARKETING_JOURNEY_READ,
    PermissionKeys.MARKETING_DEFINITIONS_MANAGE,
    PermissionKeys.MARKETING_EVIDENCE_EXPORT,
    PermissionKeys.EXPORTS_EXECUTE,
    PermissionKeys.INTEGRATIONS_MANAGE,
    PermissionKeys.INTEGRATIONS_SECRETS_MANAGE,
    PermissionKeys.BULK_ACTIONS_EXECUTE,
    PermissionKeys.LEADS_WRITE,
    PermissionKeys.LEADS_READ,
    PermissionKeys.LEADS_ASSIGN,
  ]) {
    const permission = await database.permission.upsert({ where: { key }, update: {}, create: { key, description: key } });
    await database.rolePermission.create({ data: { workspaceId: workspace.id, roleId: managerRole.id, permissionId: permission.id, scope: "WORKSPACE", createdByActorId: system.id } });
  }
  const [context, viewer] = await Promise.all([
    createContext(workspace.id, workspace.slug, managerRole.id, managerRole.key, system.id, `${label}-manager`),
    createContext(workspace.id, workspace.slug, viewerRole.id, viewerRole.key, system.id, `${label}-viewer`),
  ]);
  const sourceKey = "formulario";
  const source = await database.leadSource.create({ data: { workspaceId: workspace.id, key: sourceKey, name: "Formulário", type: "FORM", createdByActorId: system.id, updatedByActorId: system.id } });
  const pipeline = await database.pipeline.create({ data: { workspaceId: workspace.id, name: "Captação", entityType: "LEAD", isDefault: true, createdByActorId: system.id, updatedByActorId: system.id } });
  const stage = await database.pipelineStage.create({ data: { workspaceId: workspace.id, pipelineId: pipeline.id, name: "Novo", position: 0, type: "OPEN", createdByActorId: system.id, updatedByActorId: system.id } });
  const queue = await database.queue.create({ data: { workspaceId: workspace.id, key: "forms", name: "Formulários", isGeneral: true, createdByActorId: system.id, updatedByActorId: system.id } });
  const sla = await database.slaPolicy.create({ data: { workspaceId: workspace.id, key: "forms-p3", name: "Formulários P3", firstResponseMinutes: 0, warningMinutesBeforeDue: 0, healthyMaxSeconds: 60, attentionMaxSeconds: 180, createdByActorId: system.id, updatedByActorId: system.id } });
  await database.leadPriorityBand.create({ data: { workspaceId: workspace.id, slaPolicyId: sla.id, code: "P3", name: "P3", position: 0, scoreMin: 0, scoreMax: 100, leadPriority: "MEDIUM", createdByActorId: system.id, updatedByActorId: system.id } });
  const tag = await database.tag.create({ data: { workspaceId: workspace.id, name: "Captação", createdByActorId: system.id, updatedByActorId: system.id } });
  expect(source.id).toBeTruthy();
  return { context, viewer, systemActorId: system.id, sourceKey, pipelineId: pipeline.id, stageId: stage.id, queueId: queue.id, tagId: tag.id };
}

function publishableDefinition(fixture: Fixture) {
  const definition = createEmptyMarketingFormDefinition();
  return {
    ...definition,
    questions: [
      definition.questions[0],
      { stableKey: "telefone", type: "PHONE" as const, title: "Qual é o seu telefone?", required: true, position: 1, mapping: "phone" as const, config: { defaultCountry: "BR" } },
    ],
    destination: {
      sourceKey: fixture.sourceKey,
      pipelineId: fixture.pipelineId,
      initialStageId: fixture.stageId,
      queueId: fixture.queueId,
      tagIds: [fixture.tagId],
      priorityBandCode: "P3",
    },
  };
}

let tenantA: Fixture;
let tenantB: Fixture;

beforeAll(async () => {
  tenantA = await createFixture("a");
  tenantB = await createFixture("b");
});

afterAll(() => database.$disconnect());

describe("serviço administrativo de formulários", () => {
  it("aplica capability e não enumera formulário de outro workspace", async () => {
    await expect(service.create(tenantA.viewer, { name: "Negado", publicSlug: `negado-${randomUUID().slice(0, 8)}` })).rejects.toBeInstanceOf(AccessDeniedError);
    const form = await service.create(tenantA.context, { name: "Form A", publicSlug: `form-a-${randomUUID().slice(0, 8)}` });
    await expect(service.detail(tenantB.context, form.id)).rejects.toMatchObject({ code: "MARKETING_FORM_NOT_FOUND", statusCode: 404 });
  });

  it("salva rascunho com revisão otimista", async () => {
    const form = await service.create(tenantA.context, { name: "Concorrência", publicSlug: `concorrencia-${randomUUID().slice(0, 8)}` });
    const definition = publishableDefinition(tenantA);
    const updated = await service.updateDraft(tenantA.context, form.id, { name: form.name, expectedRevision: form.revision, definition });
    expect(updated.revision).toBe(form.revision + 1);
    await expect(service.updateDraft(tenantA.context, form.id, { name: form.name, expectedRevision: form.revision, definition })).rejects.toMatchObject({ code: "MARKETING_FORM_REVISION_CONFLICT", statusCode: 409 });
  });

  it("publica snapshot imutável e pausa resolução pública imediatamente", async () => {
    const slug = `publicado-${randomUUID().slice(0, 8)}`;
    const form = await service.create(tenantA.context, { name: "Publicado", publicSlug: slug });
    const saved = await service.updateDraft(tenantA.context, form.id, { name: form.name, expectedRevision: form.revision, definition: publishableDefinition(tenantA) });
    const published = await service.publish(tenantA.context, form.id, saved.revision);
    expect(published.form).toMatchObject({ status: "ACTIVE", currentVersion: 1 });
    await expect(service.resolvePublic(slug)).resolves.toMatchObject({ slug, title: "Publicado", versionPublicId: published.version.publicId });
    const changed = await service.updateDraft(tenantA.context, form.id, { name: "Rascunho novo", expectedRevision: published.form.revision, definition: { ...publishableDefinition(tenantA), thankYou: { stableKey: "obrigado", title: "Nova", message: "Nova mensagem" } } });
    const firstVersion = await database.marketingFormVersion.findUniqueOrThrow({ where: { id: published.version.id } });
    expect(firstVersion.definition).toMatchObject({ thankYou: { title: "Obrigado!" } });
    const paused = await service.transition(tenantA.context, form.id, "PAUSE", changed.revision);
    expect(paused.status).toBe("INACTIVE");
    await expect(service.resolvePublic(slug)).rejects.toBeInstanceOf(ApplicationError);
  });

  it("recusa referências cross-tenant antes da publicação", async () => {
    const form = await service.create(tenantA.context, { name: "Referência", publicSlug: `referencia-${randomUUID().slice(0, 8)}` });
    const definition = { ...publishableDefinition(tenantA), destination: { ...publishableDefinition(tenantA).destination, pipelineId: tenantB.pipelineId, initialStageId: tenantB.stageId } };
    const saved = await service.updateDraft(tenantA.context, form.id, { name: form.name, expectedRevision: form.revision, definition });
    await expect(service.publish(tenantA.context, form.id, saved.revision)).rejects.toMatchObject({ code: "MARKETING_FORM_REFERENCE_NOT_FOUND", statusCode: 422 });
  });

  it("exige secretRef e enfileira Meta uma única vez somente após consentimento formal", async () => {
    const connection = await database.integrationConnection.create({ data: {
      workspaceId: tenantA.context.workspaceId,
      key: `meta-form-${randomUUID().slice(0, 8)}`,
      providerKey: "META_ADS",
      adapterKey: "local-deterministic-v1",
      displayName: "Meta formulário",
      environment: "LOCAL",
      status: "CONNECTED",
      capabilityLevel: "CONNECTED",
      enabled: true,
      createdByActorId: tenantA.systemActorId,
      updatedByActorId: tenantA.systemActorId,
    } });
    await database.integrationConnectionCapability.create({ data: { workspaceId: tenantA.context.workspaceId, connectionId: connection.id, capability: "SYNC_PUSH", enabled: true } });
    const secretReferenceKey = "META_CAPI_ACCESS_TOKEN";
    const base = publishableDefinition(tenantA);
    const definition = {
      ...base,
      questions: [...base.questions, { stableKey: "consentimento", type: "CHECKBOX" as const, title: "Você autoriza a mensuração?", required: true, position: 2, mapping: "contactPreference" as const, config: { label: "Autorizo" } }],
      tracking: { internalEvents: true as const, meta: { enabled: true, pixelId: "123456789", connectionId: connection.id, secretReferenceKey } },
    };
    const slug = `meta-${randomUUID().slice(0, 8)}`;
    const form = await service.create(tenantA.context, { name: "Meta consentida", publicSlug: slug });
    const saved = await service.updateDraft(tenantA.context, form.id, { name: form.name, expectedRevision: form.revision, definition });
    await expect(service.publish(tenantA.context, form.id, saved.revision)).rejects.toMatchObject({ code: "MARKETING_FORM_REFERENCE_NOT_FOUND", statusCode: 422 });
    await database.integrationSecretReference.create({ data: { workspaceId: tenantA.context.workspaceId, connectionId: connection.id, alias: "capi-token", referenceKey: secretReferenceKey, present: true, createdByActorId: tenantA.systemActorId } });
    const published = await service.publish(tenantA.context, form.id, saved.revision);
    const payload = {
      versionPublicId: published.version.publicId,
      sessionPublicId: randomUUID(),
      idempotencyToken: randomUUID(),
      startedAt: new Date(now.getTime() - 2_000).toISOString(),
      honeypot: "",
      tracking: { landingUrl: `https://example.test/f/${slug}` },
      answers: [
        { questionKey: "nome-completo", value: "Pessoa Meta" },
        { questionKey: "telefone", value: `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}` },
        { questionKey: "consentimento", value: true },
      ],
    };
    const first = await submissionService.submit(slug, payload);
    expect(first.providerEventIds?.meta).toMatch(/^[a-f0-9]{64}$/);
    const receipt = await database.marketingFormReceipt.findFirstOrThrow({ where: { publicId: first.receiptPublicId, workspaceId: tenantA.context.workspaceId } });
    const submission = await database.leadFormSubmission.findFirstOrThrow({ where: { workspaceId: tenantA.context.workspaceId, marketingFormReceiptId: receipt.id } });
    expect(submission.contactId).toBeTruthy();
    expect(await database.outboxEvent.count({ where: { workspaceId: tenantA.context.workspaceId, eventType: "marketing.meta_conversion.v1", correlationId: receipt.publicId } })).toBe(0);
    const legalBasis = await database.legalBasis.create({ data: { workspaceId: tenantA.context.workspaceId, code: `meta-form-${randomUUID().slice(0, 8)}`, version: 1, basisType: "CONSENT", name: "Consentimento Meta", description: "Teste isolado", status: "ACTIVE", validFrom: new Date(now.getTime() - 60_000), approvalReference: "TEST-META-FORM", approvedByActorId: tenantA.systemActorId, approvedAt: new Date(now.getTime() - 60_000), createdByActorId: tenantA.systemActorId } });
    const purpose = await database.processingPurpose.create({ data: { workspaceId: tenantA.context.workspaceId, code: "marketing-conversion-feedback", name: "Conversão Meta", description: "Mensuração consentida", createdByActorId: tenantA.systemActorId, updatedByActorId: tenantA.systemActorId } });
    await database.purposeVersion.create({ data: { workspaceId: tenantA.context.workspaceId, purposeId: purpose.id, legalBasisId: legalBasis.id, version: 1, description: purpose.description, audience: "Leads", allowedChannels: ["OTHER"], noticeText: "Autoriza mensuração de conversão.", noticeVersion: "meta-form-v1", status: "ACTIVE", validFrom: new Date(now.getTime() - 60_000), approvedByActorId: tenantA.systemActorId, approvedAt: new Date(now.getTime() - 60_000), createdByActorId: tenantA.systemActorId } });
    await database.consentState.create({ data: { workspaceId: tenantA.context.workspaceId, contactId: submission.contactId!, purposeId: purpose.id, channel: "OTHER", state: "GRANTED", effectiveFrom: new Date(now.getTime() - 1_000), policyVersion: "test-v1", reasonCode: "TEST_EXPLICIT_CONSENT" } });
    const replay = await submissionService.submit(slug, payload);
    expect(replay).toMatchObject({ receiptPublicId: first.receiptPublicId, outcome: "ACCEPTED" });
    expect(replay.providerEventIds?.meta).toBe(first.providerEventIds?.meta);
    const events = await database.outboxEvent.findMany({ where: { workspaceId: tenantA.context.workspaceId, eventType: "marketing.meta_conversion.v1", correlationId: receipt.publicId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ aggregateType: "AttributionConversion", aggregateId: submission.attributionConversionId });
    expect(events[0]?.payload).toMatchObject({ eventId: replay.providerEventIds?.meta, provider: "META", privacy: { consentState: "GRANTED" } });
    expect(JSON.stringify(events[0]?.payload)).not.toContain("Pessoa Meta");
    expect(await database.privacyDecision.count({ where: { workspaceId: tenantA.context.workspaceId, correlationId: receipt.publicId, outcome: "ALLOW" } })).toBe(1);
  });

  it("lista respostas incompletas com os valores já informados sem criar lead", async () => {
    const slug = `incompleto-${randomUUID().slice(0, 8)}`;
    const form = await service.create(tenantA.context, { name: "Formulário incompleto", publicSlug: slug });
    const saved = await service.updateDraft(tenantA.context, form.id, { name: form.name, expectedRevision: form.revision, definition: publishableDefinition(tenantA) });
    const published = await service.publish(tenantA.context, form.id, saved.revision);
    const sessionPublicId = randomUUID();
    const name = `Pessoa incompleta ${randomUUID().slice(0, 8)}`;
    const phone = `(62)9${Math.floor(10_000_000 + Math.random() * 89_999_999).toString().slice(0, 4)}-${Math.floor(1_000 + Math.random() * 8_999)}`;

    await submissionService.recordEvents(slug, { versionPublicId: published.version.publicId, sessionPublicId: randomUUID(), tracking: {}, events: [{ eventId: randomUUID(), kind: "FORM_VIEW", occurredAt: now.toISOString() }] });
    await expect(loadAcquisitionFunnel(database, tenantA.context.workspaceId, new Date("2033-03-15T03:00:00Z"), new Date("2033-03-16T03:00:00Z"), "Captação")).resolves.toMatchObject({ cohortSize: 0 });

    await submissionService.recordEvents(slug, {
      versionPublicId: published.version.publicId,
      sessionPublicId,
      tracking: { utmSource: "abandono-teste" },
      events: [
        { eventId: randomUUID(), kind: "QUESTION_ANSWERED", questionKey: "nome-completo", answer: name, occurredAt: new Date(now.getTime() - 1_500).toISOString() },
        { eventId: randomUUID(), kind: "QUESTION_ANSWERED", questionKey: "telefone", answer: phone, occurredAt: new Date(now.getTime() - 1_000).toISOString() },
      ],
    });

    const partial = await database.marketingFormPartialResponse.findUniqueOrThrow({ where: { workspaceId_marketingFormVersionId_sessionPublicId: { workspaceId: tenantA.context.workspaceId, marketingFormVersionId: published.version.id, sessionPublicId } } });
    expect(partial).toMatchObject({ respondentName: name, respondentPhone: phone, completedAt: null, deletedAt: null });
    expect(await database.marketingFormReceipt.count({ where: { workspaceId: tenantA.context.workspaceId, marketingFormId: form.id } })).toBe(0);
    expect(await database.lead.count({ where: { workspaceId: tenantA.context.workspaceId, fullName: name } })).toBe(0);

    const periodStart = new Date("2033-03-15T03:00:00Z");
    const periodEnd = new Date("2033-03-16T03:00:00Z");
    const incompleteFunnel = await loadAcquisitionFunnel(database, tenantA.context.workspaceId, periodStart, periodEnd, "Captação");
    expect(incompleteFunnel).toMatchObject({
      cohortSize: 1, incompleteCount: 1, registeredLeadCount: 0,
      byDimension: { source: [expect.objectContaining({ label: "Formulário", leads: 1, scheduled: 0, buyers: 0 })] },
    });
    expect(JSON.stringify(incompleteFunnel)).not.toContain(name);
    expect(JSON.stringify(incompleteFunnel)).not.toContain(phone);
    expect(await database.lead.count({ where: { workspaceId: tenantA.context.workspaceId, fullName: name } })).toBe(0);
    await expect(loadAcquisitionFunnel(database, tenantB.context.workspaceId, periodStart, periodEnd, "Captação")).resolves.toMatchObject({ cohortSize: 0 });
    await expect(loadAcquisitionFunnel(database, tenantA.context.workspaceId, periodStart, periodEnd, "Outro pipeline")).resolves.toMatchObject({ cohortSize: 0 });

    await expect(reportingService.list(tenantA.context, form.id, { status: "INCOMPLETO" })).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ publicId: partial.publicId, status: "INCOMPLETO", submission: expect.objectContaining({ submittedFullName: name, submittedPhone: phone, leadId: null }) })],
    });
    await expect(reportingService.list(tenantA.context, form.id, { search: name.toLowerCase() })).resolves.toMatchObject({ total: 1 });
    await expect(reportingService.list(tenantA.context, form.id, { search: phone.replace(/\D/g, "") })).resolves.toMatchObject({ total: 1 });
    const detail = await reportingService.detail(tenantA.context, form.id, partial.publicId);
    expect(detail).toMatchObject({ receipt: { status: "INCOMPLETO" }, submission: { leadId: null } });
    expect(detail.answers).toEqual([
      expect.objectContaining({ questionKey: "nome-completo", displayValue: name }),
      expect.objectContaining({ questionKey: "telefone", displayValue: phone }),
    ]);
    await expect(reportingService.detail(tenantB.context, form.id, partial.publicId)).rejects.toMatchObject({ code: "MARKETING_FORM_NOT_FOUND", statusCode: 404 });

    const accepted = await submissionService.submit(slug, {
      versionPublicId: published.version.publicId,
      sessionPublicId,
      idempotencyToken: randomUUID(),
      startedAt: new Date(now.getTime() - 2_000).toISOString(),
      honeypot: "",
      tracking: { utmSource: "abandono-teste" },
      answers: [{ questionKey: "nome-completo", value: name }, { questionKey: "telefone", value: phone }],
    });
    expect(accepted.outcome).toBe("ACCEPTED");
    await submissionService.recordEvents(slug, {
      versionPublicId: published.version.publicId,
      sessionPublicId,
      tracking: {},
      events: [{ eventId: randomUUID(), kind: "QUESTION_ANSWERED", questionKey: "nome-completo", answer: name, occurredAt: now.toISOString() }],
    });
    await expect(database.marketingFormPartialResponse.findUniqueOrThrow({ where: { id: partial.id }, select: { completedAt: true, receiptId: true, answers: true, respondentName: true, respondentPhone: true } })).resolves.toMatchObject({ completedAt: now, receiptId: expect.any(String), answers: [], respondentName: null, respondentPhone: null });
    await expect(reportingService.list(tenantA.context, form.id, { status: "INCOMPLETO" })).resolves.toMatchObject({ total: 0, items: [] });

    // Completion on the next day keeps the original arrival date and replaces
    // the partial response instead of adding a second entry to the funnel.
    const completedSubmission = await database.leadFormSubmission.findFirstOrThrow({ where: { workspaceId: tenantA.context.workspaceId, marketingFormReceiptId: (await database.marketingFormReceipt.findFirstOrThrow({ where: { workspaceId: tenantA.context.workspaceId, publicId: accepted.receiptPublicId } })).id } });
    const tomorrow = new Date("2033-03-16T14:30:00Z");
    await database.lead.update({ where: { id: completedSubmission.leadId! }, data: { createdAt: tomorrow } });
    await database.marketingFormPartialResponse.update({ where: { id: partial.id }, data: { completedAt: tomorrow } });
    await expect(loadAcquisitionFunnel(database, tenantA.context.workspaceId, periodStart, periodEnd, "Captação")).resolves.toMatchObject({ cohortSize: 1, incompleteCount: 0, registeredLeadCount: 1 });
    await expect(loadAcquisitionFunnel(database, tenantA.context.workspaceId, periodEnd, new Date("2033-03-17T03:00:00Z"), "Captação")).resolves.toMatchObject({ cohortSize: 0, incompleteCount: 0 });

    const deletionSession = randomUUID();
    await submissionService.recordEvents(slug, {
      versionPublicId: published.version.publicId,
      sessionPublicId: deletionSession,
      tracking: {},
      events: [{ eventId: randomUUID(), kind: "QUESTION_ANSWERED", questionKey: "nome-completo", answer: `${name} apagar`, occurredAt: now.toISOString() }],
    });
    const deletable = await database.marketingFormPartialResponse.findUniqueOrThrow({ where: { workspaceId_marketingFormVersionId_sessionPublicId: { workspaceId: tenantA.context.workspaceId, marketingFormVersionId: published.version.id, sessionPublicId: deletionSession } } });
    await expect(reportingService.remove(tenantA.context, form.id, deletable.publicId)).resolves.toMatchObject({ publicId: deletable.publicId, leadPreserved: false });
    await expect(reportingService.detail(tenantA.context, form.id, deletable.publicId)).rejects.toMatchObject({ code: "MARKETING_FORM_RESPONSE_NOT_FOUND", statusCode: 404 });
    await expect(loadAcquisitionFunnel(database, tenantA.context.workspaceId, periodStart, periodEnd, "Captação")).resolves.toMatchObject({ cohortSize: 1, incompleteCount: 0 });
  });

  it("conta uma entrada quando a resposta é concluída durante a leitura do funil", async () => {
    const fixture = await createFixture("snapshot");
    const slug = `snapshot-${randomUUID().slice(0, 8)}`;
    const form = await service.create(fixture.context, { name: "Form snapshot", publicSlug: slug });
    const saved = await service.updateDraft(fixture.context, form.id, { name: form.name, expectedRevision: form.revision, definition: publishableDefinition(fixture) });
    const published = await service.publish(fixture.context, form.id, saved.revision);
    const sessionPublicId = randomUUID();
    const answers = [{ questionKey: "nome-completo", value: "Pessoa snapshot" }, { questionKey: "telefone", value: "+5511999994321" }];
    await submissionService.recordEvents(slug, { versionPublicId: published.version.publicId, sessionPublicId, tracking: {}, events: answers.map((answer) => ({ eventId: randomUUID(), kind: "QUESTION_ANSWERED", questionKey: answer.questionKey, answer: answer.value, occurredAt: now.toISOString() })) });
    let completedDuringRead = false;
    const concurrentDatabase = database.$extends({ query: { marketingFormPartialResponse: { async findMany({ args, query }) {
      const rows = await query(args);
      if (!completedDuringRead && args.where?.firstAnsweredAt) {
        completedDuringRead = true;
        const accepted = await submissionService.submit(slug, { versionPublicId: published.version.publicId, sessionPublicId, idempotencyToken: randomUUID(), startedAt: new Date(now.getTime() - 2_000).toISOString(), honeypot: "", tracking: {}, answers });
        const receipt = await database.marketingFormReceipt.findFirstOrThrow({ where: { workspaceId: fixture.context.workspaceId, publicId: accepted.receiptPublicId } });
        const submission = await database.leadFormSubmission.findFirstOrThrow({ where: { workspaceId: fixture.context.workspaceId, marketingFormReceiptId: receipt.id } });
        await database.lead.update({ where: { id: submission.leadId! }, data: { createdAt: now } });
      }
      return rows;
    } } } });
    const result = await loadAcquisitionFunnel(concurrentDatabase as unknown as PrismaClient, fixture.context.workspaceId, new Date("2033-03-15T03:00:00Z"), new Date("2033-03-16T03:00:00Z"), "Captação");
    expect(completedDuringRead).toBe(true);
    expect(result.cohortSize).toBe(1);
  });

  it("materializa uma resposta uma vez, preserva a etapa e não avança a rotação no replay", async () => {
    const slug = `submit-${randomUUID().slice(0, 8)}`;
    const form = await service.create(tenantA.context, { name: "Captação", publicSlug: slug });
    const definition = {
      ...publishableDefinition(tenantA),
      redirects: {
        automaticKind: "WHATSAPP" as const,
        rotation: { targets: [
          { stableKey: "time-a", phone: "+5511999990001", label: "Time A" },
          { stableKey: "time-b", phone: "+5511999990002", label: "Time B" },
        ] },
      },
    };
    const saved = await service.updateDraft(tenantA.context, form.id, { name: form.name, expectedRevision: form.revision, definition });
    const published = await service.publish(tenantA.context, form.id, saved.revision);
    const idempotencyToken = randomUUID();
    const sessionPublicId = randomUUID();
    const phoneSuffix = Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
    const payload = {
      versionPublicId: published.version.publicId,
      sessionPublicId,
      idempotencyToken,
      startedAt: new Date(now.getTime() - 2_000).toISOString(),
      honeypot: "",
      tracking: { utmSource: "integration-test", landingUrl: `https://example.test/f/${slug}` },
      answers: [
        { questionKey: "nome-completo", value: "Pessoa de Teste" },
        { questionKey: "telefone", value: `(62)9${phoneSuffix.slice(0, 4)}-${phoneSuffix.slice(4)}` },
      ],
    };
    await submissionService.recordEvents(slug, {
      versionPublicId: published.version.publicId,
      sessionPublicId,
      tracking: payload.tracking,
      events: [
        { eventId: randomUUID(), kind: "FORM_VIEW", occurredAt: new Date(now.getTime() - 1_900).toISOString() },
        { eventId: randomUUID(), kind: "FORM_START", occurredAt: new Date(now.getTime() - 1_800).toISOString() },
        { eventId: randomUUID(), kind: "QUESTION_VIEWED", questionKey: "nome-completo", occurredAt: new Date(now.getTime() - 1_700).toISOString() },
      ],
    });
    const first = await submissionService.submit(slug, payload);
    const replay = await submissionService.submit(slug, payload);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ outcome: "ACCEPTED", redirect: { kind: "WHATSAPP" } });
    const receipt = await database.marketingFormReceipt.findFirstOrThrow({ where: { publicId: first.receiptPublicId, workspaceId: tenantA.context.workspaceId } });
    const submission = await database.leadFormSubmission.findFirstOrThrow({ where: { workspaceId: tenantA.context.workspaceId, marketingFormReceiptId: receipt.id }, include: { lead: true } });
    expect(submission.submittedPhone).toBe(payload.answers[1]!.value);
    expect(submission.lead?.normalizedPhone).toBe(`+55629${phoneSuffix}`);
    expect(submission.lead?.currentStageId).toBe(tenantA.stageId);
    expect(await database.leadTag.count({ where: { workspaceId: tenantA.context.workspaceId, leadId: submission.leadId!, tagId: tenantA.tagId, removedAt: null } })).toBe(1);
    const rotation = await database.marketingFormRotationState.findUniqueOrThrow({ where: { workspaceId_marketingFormVersionId: { workspaceId: tenantA.context.workspaceId, marketingFormVersionId: published.version.id } } });
    expect(rotation.totalAssignments).toBe(1n);
    expect(await database.leadFormSubmission.count({ where: { workspaceId: tenantA.context.workspaceId, marketingFormReceiptId: receipt.id } })).toBe(1);
    expect(await database.outboxEvent.count({ where: { workspaceId: tenantA.context.workspaceId, aggregateType: "MarketingFormReceipt", aggregateId: receipt.id } })).toBe(0);

    const listed = await reportingService.list(tenantA.context, form.id, {});
    expect(listed.items.some((item) => item.publicId === first.receiptPublicId)).toBe(true);
    await expect(reportingService.list(tenantA.context, form.id, { search: "pessoa de teste" })).resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ publicId: first.receiptPublicId })] });
    await expect(reportingService.list(tenantA.context, form.id, { search: payload.answers[1]!.value.replace(/\D/g, "") })).resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ publicId: first.receiptPublicId })] });
    await expect(reportingService.list(tenantA.context, form.id, { search: "nome inexistente" })).resolves.toMatchObject({ total: 0, items: [] });
    await expect(reportingService.list(tenantA.context, form.id, { search: "' OR 1=1 --" })).resolves.toMatchObject({ total: 0, items: [] });
    await expect(reportingService.list(tenantA.context, form.id, { search: "x".repeat(121) })).rejects.toMatchObject({ name: "ZodError" });
    const detail = await reportingService.detail(tenantA.context, form.id, first.receiptPublicId);
    expect(detail.answers.map((answer) => answer.questionKey)).toEqual(["nome-completo", "telefone"]);
    const stats = await reportingService.statistics(tenantA.context, form.id, {});
    expect(stats).toMatchObject({ views: 1, starts: 1, completed: 1, completionRate: 100 });
    expect(stats.choices).toEqual([]);
    const forms = await service.list(tenantA.context);
    expect(forms).toContainEqual(expect.objectContaining({ id: form.id, responseCount: 1, completionRate: 100 }));
    const exported = await reportingService.csv(tenantA.context, form.id, {});
    expect(exported.csv).toContain("nome-completo");
    expect(exported.total).toBe(1);
    await expect(reportingService.csv(tenantA.context, form.id, { search: "pessoa de teste" })).resolves.toMatchObject({ total: 1 });
    await expect(reportingService.csv(tenantA.context, form.id, { search: "nome inexistente" })).resolves.toMatchObject({ total: 0 });
    await expect(reportingService.detail(tenantB.context, form.id, first.receiptPublicId)).rejects.toMatchObject({ code: "MARKETING_FORM_NOT_FOUND", statusCode: 404 });

    await expect(submissionService.submit(slug, { ...payload, idempotencyToken: randomUUID(), answers: [{ questionKey: "nome-completo", value: "Sem telefone" }] })).rejects.toMatchObject({ code: "MARKETING_FORM_ANSWER_INVALID", statusCode: 422 });
    await expect(submissionService.submit(slug, {
      ...payload,
      idempotencyToken: randomUUID(),
      answers: [
        { questionKey: "nome-completo", value: "A" },
        { questionKey: "telefone", value: payload.answers[1]!.value },
      ],
    })).rejects.toMatchObject({ code: "MARKETING_FORM_ANSWER_INVALID", statusCode: 422 });
    await expect(submissionService.submit(slug, { ...payload, answers: [{ questionKey: "nome-completo", value: "Payload alterado" }, { questionKey: "telefone", value: payload.answers[1]!.value }] })).rejects.toMatchObject({ code: "MARKETING_FORM_IDEMPOTENCY_CONFLICT", statusCode: 409 });

    await expect(reportingService.remove(tenantA.viewer, form.id, first.receiptPublicId)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(reportingService.remove(tenantB.context, form.id, first.receiptPublicId)).rejects.toMatchObject({ code: "MARKETING_FORM_NOT_FOUND", statusCode: 404 });
    await expect(reportingService.remove(tenantA.context, form.id, first.receiptPublicId)).resolves.toMatchObject({ publicId: first.receiptPublicId, deletedAt: now, leadPreserved: true });

    expect(await database.marketingFormReceipt.findUniqueOrThrow({ where: { id: receipt.id }, select: { deletedAt: true } })).toEqual({ deletedAt: now });
    expect(await database.leadFormSubmission.count({ where: { workspaceId: tenantA.context.workspaceId, marketingFormReceiptId: receipt.id } })).toBe(1);
    expect(await database.lead.count({ where: { workspaceId: tenantA.context.workspaceId, id: submission.leadId!, deletedAt: null } })).toBe(1);
    await expect(reportingService.list(tenantA.context, form.id, {})).resolves.toMatchObject({ total: 0, permissions: { delete: true }, items: [] });
    await expect(reportingService.detail(tenantA.context, form.id, first.receiptPublicId)).rejects.toMatchObject({ code: "MARKETING_FORM_RESPONSE_NOT_FOUND", statusCode: 404 });
    await expect(reportingService.csv(tenantA.context, form.id, {})).resolves.toMatchObject({ total: 0 });
    await expect(reportingService.statistics(tenantA.context, form.id, {})).resolves.toMatchObject({ views: 1, starts: 1, completed: 0, completionRate: 0 });
    await expect(service.list(tenantA.context)).resolves.toContainEqual(expect.objectContaining({ id: form.id, responseCount: 0 }));
    await expect(database.auditLog.findFirstOrThrow({ where: { workspaceId: tenantA.context.workspaceId, action: "marketing.form.response_deleted", entityId: receipt.id } })).resolves.toMatchObject({ actorId: tenantA.context.actorId, changes: expect.objectContaining({ leadPreserved: true }) });
    await expect(reportingService.remove(tenantA.context, form.id, first.receiptPublicId)).rejects.toMatchObject({ code: "MARKETING_FORM_RESPONSE_NOT_FOUND", statusCode: 404 });
  });

  it("publica o destino Anúncios e move respostas existentes sem criar atividades, tarefas ou metas", async () => {
    const slug = `ads-sync-${randomUUID().slice(0, 8)}`;
    const form = await service.create(tenantA.context, { name: "Forms Mandato", publicSlug: slug });
    const saved = await service.updateDraft(tenantA.context, form.id, {
      name: form.name,
      expectedRevision: form.revision,
      definition: publishableDefinition(tenantA),
    });
    const published = await service.publish(tenantA.context, form.id, saved.revision);
    const phoneSuffix = Math.floor(10_000_000 + Math.random() * 89_999_999).toString();
    const accepted = await submissionService.submit(slug, {
      versionPublicId: published.version.publicId,
      sessionPublicId: randomUUID(),
      idempotencyToken: randomUUID(),
      startedAt: new Date(now.getTime() - 2_000).toISOString(),
      honeypot: "",
      tracking: {},
      answers: [
        { questionKey: "nome-completo", value: "Lead do formulário" },
        { questionKey: "telefone", value: `(62)9${phoneSuffix.slice(0, 4)}-${phoneSuffix.slice(4)}` },
      ],
    });
    const receipt = await database.marketingFormReceipt.findFirstOrThrow({ where: { publicId: accepted.receiptPublicId, workspaceId: tenantA.context.workspaceId } });
    const submission = await database.leadFormSubmission.findFirstOrThrow({ where: { workspaceId: tenantA.context.workspaceId, marketingFormReceiptId: receipt.id } });
    const leadId = submission.leadId!;
    const unlinkedAccepted = await submissionService.submit(slug, {
      versionPublicId: published.version.publicId,
      sessionPublicId: randomUUID(),
      idempotencyToken: randomUUID(),
      startedAt: new Date(now.getTime() - 1_000).toISOString(),
      honeypot: "",
      tracking: {},
      answers: [
        { questionKey: "nome-completo", value: "Lead importado sem vínculo" },
        { questionKey: "telefone", value: "(62)99876-5432" },
      ],
    });
    const unlinkedReceipt = await database.marketingFormReceipt.findFirstOrThrow({ where: { publicId: unlinkedAccepted.receiptPublicId, workspaceId: tenantA.context.workspaceId } });
    const unlinkedSubmission = await database.leadFormSubmission.findFirstOrThrow({ where: { workspaceId: tenantA.context.workspaceId, marketingFormReceiptId: unlinkedReceipt.id } });
    await database.leadFormSubmission.update({ where: { id: unlinkedSubmission.id }, data: { leadId: null, status: "RECEIVED", intakeOutcome: null } });
    const initialHistory = await database.stageHistory.findFirstOrThrow({ where: { workspaceId: tenantA.context.workspaceId, leadId, exitedAt: null } });
    const progressedAt = new Date(initialHistory.enteredAt.getTime() + 1);
    await database.stageHistory.update({
      where: { id: initialHistory.id },
      data: { exitedAt: progressedAt, exitedByActorId: tenantA.context.actorId },
    });
    await database.stageHistory.create({
      data: {
        workspaceId: tenantA.context.workspaceId,
        pipelineId: initialHistory.pipelineId,
        stageId: initialHistory.stageId,
        leadId,
        enteredAt: progressedAt,
        enteredByActorId: tenantA.context.actorId,
        transitionOrigin: "SYSTEM",
        transitionReason: "Continuidade operacional antes da sincronização.",
      },
    });
    const before = {
      tasks: await database.task.count({ where: { workspaceId: tenantA.context.workspaceId, leadId } }),
      activities: await database.activity.count({ where: { workspaceId: tenantA.context.workspaceId, leadId } }),
      goals: await database.goalQuota.count({ where: { workspaceId: tenantA.context.workspaceId } }),
    };
    await ensureAdvertisingPipeline(database, tenantA.context.workspaceId, tenantA.context.actorId);

    await expect(advertisingSyncService.run(tenantA.context, form.id, { mode: "PREVIEW" })).resolves.toMatchObject({
      mode: "PREVIEW",
      acceptedResponses: 2,
      linkedResponses: 1,
      unlinkedResponses: 1,
      distinctLeads: 1,
      toMove: 1,
      leadsWithClosedStageHistory: 1,
      futureResponsesConfigured: false,
    });
    const applied = await advertisingSyncService.run(tenantA.context, form.id, { mode: "APPLY", expectedRevision: published.form.revision });
    expect(applied).toMatchObject({ mode: "APPLY", createdLeads: 1, movedLeads: 1, toMove: 0, alreadyRouted: 2, futureResponsesConfigured: true });

    const routed = await database.lead.findUniqueOrThrow({ where: { id: leadId }, include: { pipeline: true, currentStage: true } });
    expect(routed.pipeline.name).toBe("Anúncios");
    expect(routed.currentStage.leadStageCode).toBe("NEW");
    const leadState = createPreSalesPipelineService({ database, authorization, now: () => now });
    const summary = await leadState.getLeadState(tenantA.context, { leadId });
    expect(summary).toMatchObject({ pipelineName: "Anúncios", formResponses: [{ formName: "Forms Mandato", answers: expect.arrayContaining([{ questionKey: "nome-completo", question: "Qual o seu nome completo?", displayValue: "Lead do formulário" }]) }] });
    await expect(leadState.getLeadState(tenantA.viewer, { leadId })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(leadState.getLeadState(tenantB.context, { leadId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await database.stageHistory.count({ where: { workspaceId: tenantA.context.workspaceId, leadId } })).toBe(3);
    expect(await database.stageHistory.count({ where: { workspaceId: tenantA.context.workspaceId, leadId, exitedAt: { not: null }, transitionReason: "Entrada inicial do lead." } })).toBe(1);
    expect(await database.task.count({ where: { workspaceId: tenantA.context.workspaceId, leadId } })).toBe(before.tasks);
    expect(await database.activity.count({ where: { workspaceId: tenantA.context.workspaceId, leadId } })).toBe(before.activities);
    expect(await database.goalQuota.count({ where: { workspaceId: tenantA.context.workspaceId } })).toBe(before.goals);
    const createdLeadId = (await database.leadFormSubmission.findUniqueOrThrow({ where: { id: unlinkedSubmission.id }, select: { leadId: true } })).leadId!;
    await expect(database.lead.findUniqueOrThrow({ where: { id: createdLeadId }, include: { pipeline: true, currentStage: true } })).resolves.toMatchObject({
      fullName: "Lead importado sem vínculo",
      queueId: tenantA.queueId,
      pipeline: { name: "Anúncios" },
      currentStage: { leadStageCode: "NEW" },
    });
    expect(await database.task.count({ where: { workspaceId: tenantA.context.workspaceId, leadId: createdLeadId } })).toBe(0);
    expect(await database.activity.count({ where: { workspaceId: tenantA.context.workspaceId, leadId: createdLeadId } })).toBe(0);

    const current = await database.marketingForm.findUniqueOrThrow({ where: { id: form.id } });
    const replay = await advertisingSyncService.run(tenantA.context, form.id, { mode: "APPLY", expectedRevision: current.revision });
    expect(replay).toMatchObject({ createdLeads: 0, movedLeads: 0, toMove: 0, alreadyRouted: 2, futureResponsesConfigured: true });
    expect((await database.marketingForm.findUniqueOrThrow({ where: { id: form.id } })).currentVersion).toBe(2);
  });
});
