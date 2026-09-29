import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type { ServiceActorContext } from "@/modules/auth/application/service-actor-context";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createPrivacyBackfillService } from "@/modules/privacy/application/privacy-backfill-service";
import { createPrivacyService } from "@/modules/privacy/application/privacy-service";
import { DEMO_USERS, DEMO_WORKSPACE_SLUG, seedDemoDatabase } from "@/modules/settings/application/demo-seed-service";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { createPostgresAdapter } from "@/shared/core/database/postgres-adapter";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for privacy integration tests.");
const database = new PrismaClient({ adapter: createPostgresAdapter(connectionString, { max: 12 }) });
const authorization = createAuthorizationService({ database });
const now = new Date("2046-04-20T15:00:00.000Z");
let admin: AuthenticatedContext;
let viewer: AuthenticatedContext;
let system: ServiceActorContext;
let sourceKey: string;

async function contextFor(email: string): Promise<AuthenticatedContext> {
  const member = await database.workspaceMember.findFirstOrThrow({ where: { workspace: { slug: DEMO_WORKSPACE_SLUG }, user: { normalizedEmail: email }, status: "ACTIVE", deletedAt: null }, include: { workspace: true, user: true, role: true } });
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: member.workspaceId, userId: member.userId, type: "HUMAN" } });
  return { sessionId: randomUUID(), workspaceId: member.workspaceId, workspaceSlug: member.workspace.slug, userId: member.userId, memberId: member.id, actorId: actor.id, roleId: member.roleId, roleKey: member.role.key, roleName: member.role.name, displayName: member.user.displayName };
}

async function intake(suffix: string, privacy: { consent?: boolean; doNotContact?: boolean } = {}) {
  const result = await createLeadIntakeService({ database, authorization, now: () => now }).intake({ channel: "MANUAL", idempotencyKey: `crm36-${suffix}-${randomUUID()}`, fullName: `Titular CRM 36 ${suffix}`, phone: `11 97777-${(1_000 + Number(suffix)).toString()}`, email: `crm36-${suffix}-${randomUUID()}@example.test`, sourceKey, rawPayload: { fixture: "crm36" }, ...privacy }, system);
  if (result.outcome === "REJECTED") throw new Error(`Lead rejeitado: ${result.code}`);
  return result;
}

beforeAll(async () => {
  await seedDemoDatabase(database, { NODE_ENV: "test", DATABASE_URL: connectionString });
  admin = await contextFor(DEMO_USERS[0].email);
  viewer = await contextFor(DEMO_USERS.at(-1)!.email);
  const actor = await database.actor.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, key: "system" } });
  system = { workspaceId: admin.workspaceId, actorId: actor.id, actorType: "SYSTEM", actorKey: actor.key };
  sourceKey = (await database.leadSource.findFirstOrThrow({ where: { workspaceId: admin.workspaceId, deletedAt: null } })).key;
});

afterAll(async () => database.$disconnect());

describe("CRM-36 — privacidade, consentimento e retenção", () => {
  it("mantém políticas técnicas pendentes e projeta sinais legados de modo conservador", async () => {
    const consented = await intake("01", { consent: true });
    const denied = await intake("02", { consent: false });
    const optedOut = await intake("03", { doNotContact: true });
    const service = createPrivacyService({ database, now: () => now });
    await expect(service.getLeadStatus(admin, consented.leadId)).resolves.toMatchObject({ outcome: "REVIEW_REQUIRED", consentState: "REVIEW_REQUIRED", purpose: { status: "PENDING_LEGAL" } });
    await expect(service.getLeadStatus(admin, denied.leadId)).resolves.toMatchObject({ outcome: "DENY", consentState: "DENIED" });
    await expect(service.getLeadStatus(admin, optedOut.leadId)).resolves.toMatchObject({ outcome: "DENY", consentState: "OPTED_OUT" });
  });

  it("registra eventos por finalidade, canal e ponto; replay é idempotente e opt-out é monotônico", async () => {
    const lead = await intake("04");
    const service = createPrivacyService({ database, now: () => now });
    const purpose = await database.purposeVersion.findFirstOrThrow({ where: { workspaceId: admin.workspaceId }, include: { purpose: true } });
    const record = { leadId: lead.leadId, purposeVersionId: purpose.id, channel: "EMAIL", action: "OPTED_OUT", occurredAt: now, idempotencyKey: `manual-optout-${randomUUID()}`, reason: "Solicitação explícita no teste" };
    const first = await service.recordConsent(admin, record);
    const replay = await service.recordConsent(admin, record);
    expect(replay.eventId).toBe(first.eventId);
    expect(replay.state).toBe("OPTED_OUT");
    await service.recordConsent(admin, { ...record, channel: "PHONE", action: "GRANTED", evidenceReference: "formulario-local-123", idempotencyKey: `manual-grant-${randomUUID()}`, reason: "Nova evidência sob revisão" });
    const states = await database.consentState.findMany({ where: { workspaceId: admin.workspaceId, contactId: (await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } })).contactId! } });
    expect(states.map((item) => item.channel).sort()).toEqual(["EMAIL", "PHONE", "PHONE"]);
    expect(states.filter((item) => item.channel === "PHONE").map((item) => item.contactPointId === null).sort()).toEqual([false, true]);
    expect(states.find((item) => item.channel === "EMAIL")?.state).toBe("OPTED_OUT");
  });

  it("exige evidência para concessão e reverte integralmente a mutação inválida", async () => {
    const lead = await intake("05");
    const purpose = await database.purposeVersion.findFirstOrThrow({ where: { workspaceId: admin.workspaceId } });
    const before = await database.consentEvent.count({ where: { workspaceId: admin.workspaceId, contactId: (await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } })).contactId! } });
    await expect(createPrivacyService({ database, now: () => now }).recordConsent(admin, { leadId: lead.leadId, purposeVersionId: purpose.id, channel: "PHONE", action: "GRANTED", occurredAt: now, idempotencyKey: `invalid-grant-${randomUUID()}`, reason: "Sem prova intencional" })).rejects.toMatchObject({ code: "CONSENT_EVIDENCE_REQUIRED" });
    expect(await database.consentEvent.count({ where: { workspaceId: admin.workspaceId, contactId: (await database.lead.findUniqueOrThrow({ where: { id: lead.leadId } })).contactId! } })).toBe(before);
  });

  it("serializa gravações concorrentes com a mesma chave sem duplicar evento ou auditoria", async () => {
    const lead = await intake("07");
    const purpose = await database.purposeVersion.findFirstOrThrow({ where: { workspaceId: admin.workspaceId } });
    const service = createPrivacyService({ database, now: () => now });
    const idempotencyKey = `concurrent-denial-${randomUUID()}`;
    const input = { leadId: lead.leadId, purposeVersionId: purpose.id, channel: "SMS", action: "DENIED", occurredAt: now, idempotencyKey, reason: "Negativa concorrente controlada" };
    const [first, second] = await Promise.all([service.recordConsent(admin, input), service.recordConsent(admin, input)]);
    expect(second.eventId).toBe(first.eventId);
    expect(await database.consentEvent.count({ where: { workspaceId: admin.workspaceId, idempotencyKey } })).toBe(1);
    expect(await database.auditLog.count({ where: { workspaceId: admin.workspaceId, action: "privacy.consent.recorded", entityId: first.eventId } })).toBe(1);
  });

  it("protege eventos append-only e isola workspace", async () => {
    const event = await database.consentEvent.findFirstOrThrow({ where: { workspaceId: admin.workspaceId } });
    await expect(database.consentEvent.update({ where: { id: event.id }, data: { evidenceReference: "não permitido" } })).rejects.toThrow(/append-only/);
    const other = await database.workspace.create({ data: { slug: `crm36-other-${randomUUID().slice(0, 8)}`, name: "Outro workspace" } });
    const crossed = { ...admin, workspaceId: other.id, workspaceSlug: other.slug };
    await expect(createPrivacyService({ database, now: () => now }).getLeadStatus(crossed, (await database.lead.findFirstOrThrow({ where: { workspaceId: admin.workspaceId } })).id)).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
  });

  it("expõe ausência de Contact legado como revisão sem bloquear a leitura do Lead 360", async () => {
    const result = await intake("08");
    await database.lead.update({ where: { id: result.leadId }, data: { contactId: null, updatedByActorId: admin.actorId } });

    await expect(createPrivacyService({ database, now: () => now }).getLeadStatus(admin, result.leadId)).resolves.toMatchObject({
      outcome: "REVIEW_REQUIRED",
      contactId: null,
      consentState: "UNKNOWN",
      reasonCodes: ["CONTACT_IDENTITY_MISSING"],
      missingEvidence: ["canonical_contact"],
    });
  });

  it("aplica RBAC, DSR, verificação de identidade e bloqueio de retenção por legal hold", async () => {
    const lead = await intake("06");
    const service = createPrivacyService({ database, now: () => now });
    const category = await database.dataCategory.findFirstOrThrow({ where: { workspaceId: admin.workspaceId } });
    await expect(service.createDsr(viewer, { leadId: lead.leadId, type: "ACCESS", receivedChannel: "OTHER", categoryIds: [category.id], reason: "Solicitação para teste" })).rejects.toBeInstanceOf(AccessDeniedError);
    const request = await service.createDsr(admin, { leadId: lead.leadId, type: "DELETION", receivedChannel: "OTHER", categoryIds: [category.id], reason: "Solicitação para teste" });
    await expect(service.transitionDsr(admin, { requestId: request.id, toStatus: "IN_REVIEW", reason: "Análise iniciada" })).rejects.toMatchObject({ code: "IDENTITY_VERIFICATION_REQUIRED" });
    await service.transitionDsr(admin, { requestId: request.id, toStatus: "IN_REVIEW", reason: "Identidade confirmada", verificationMethod: "desafio local", verificationReference: "referência-minimizada" });
    await service.createLegalHold(admin, { leadId: lead.leadId, requestId: request.id, dataCategoryId: category.id, reason: "Preservação necessária durante disputa", authorityReference: "processo-interno-36" });
    const action = await service.previewRetention(admin, { leadId: lead.leadId, dataCategoryId: category.id, reason: "Preview não destrutivo", idempotencyKey: `retention-${randomUUID()}` });
    expect(action).toMatchObject({ status: "BLOCKED", blockerCodes: expect.arrayContaining(["POLICY_PENDING_LEGAL", "ACTIVE_LEGAL_HOLD", "HUMAN_APPROVAL_REQUIRED"]) });
    expect(await database.auditLog.count({ where: { workspaceId: admin.workspaceId, action: { startsWith: "privacy." } } })).toBeGreaterThan(2);
  });

  it("faz dry-run, execução e replay do backfill sem recriar efeitos", async () => {
    const backfill = createPrivacyBackfillService({ database, authorization, now: () => new Date() });
    const dry = await backfill.run(admin, { mode: "DRY_RUN", batchSize: 50 });
    const execute = await backfill.run(admin, { mode: "EXECUTE", batchSize: 50 });
    const replay = await backfill.run(admin, { mode: "EXECUTE", batchSize: 50 });
    expect(dry.status).toBe("COMPLETED");
    expect(execute.processedCount).toBeGreaterThan(0);
    expect(replay.createdCount).toBe(0);
    expect(replay.existingCount).toBe(replay.eligibleCount);
  });
});
