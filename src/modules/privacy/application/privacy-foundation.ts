import type { ContactPreference, Prisma } from "@/generated/prisma/client";
import { LEGACY_NOTICE_VERSION, LEGACY_PURPOSE_CODE, PRIVACY_RULE_VERSION } from "@/modules/privacy/domain/privacy-policy";

type Tx = Prisma.TransactionClient;

export const PRIVACY_DATA_CATEGORIES = [
  ["IDENTITY", "Identidade", "Nome e identificadores canônicos", "STANDARD", ["contacts", "leads"]],
  ["CONTACT", "Contato", "Telefones, e-mails e preferências", "STANDARD", ["contact_points", "leads"]],
  ["COMMERCIAL", "Comercial", "Contexto e histórico comercial", "STANDARD", ["leads", "opportunities"]],
  ["QUALIFICATION", "Qualificação", "PACTO, score e evidências", "SENSITIVE", ["lead_qualifications", "lead_scores"]],
  ["COMMUNICATION", "Comunicação", "Conversas, mensagens e atividades", "SENSITIVE", ["conversations", "messages", "activities"]],
  ["MARKETING_ATTRIBUTION", "Atribuição de marketing", "Origem, campanha e criativo", "STANDARD", ["lead_form_submissions"]],
  ["CONTRACT_REVENUE", "Contrato e receita", "Oportunidades, propostas e valores", "RESTRICTED", ["opportunities", "offers"]],
  ["SUPPORT_SUCCESS", "Sucesso e atendimento", "Handoff e histórico futuro de cliente", "SENSITIVE", ["customer_handoffs"]],
  ["SECURITY_AUDIT", "Segurança e auditoria", "Eventos necessários à segurança e prestação de contas", "RESTRICTED", ["audit_logs", "auth_sessions"]],
  ["RAW_PAYLOAD", "Payload bruto", "Evidência original de entrada sujeita a minimização", "RESTRICTED", ["lead_form_submissions", "webhook_events"]],
] as const;

export async function ensurePrivacyFoundation(tx: Tx, workspaceId: string, actorId: string) {
  const categories = new Map<string, string>();
  for (const [code, name, description, sensitivity, sourceSystems] of PRIVACY_DATA_CATEGORIES) {
    const category = await tx.dataCategory.upsert({
      where: { workspaceId_code_version: { workspaceId, code, version: 1 } },
      create: { workspaceId, code, version: 1, name, description, sensitivity, sourceSystems: [...sourceSystems], createdByActorId: actorId, updatedByActorId: actorId },
      update: {},
      select: { id: true },
    });
    categories.set(code, category.id);
  }
  const basis = await tx.legalBasis.upsert({
    where: { workspaceId_code_version: { workspaceId, code: "legacy-unverified-signal", version: 1 } },
    create: { workspaceId, code: "legacy-unverified-signal", version: 1, basisType: "UNDETERMINED", name: "Sinal legado sem base aprovada", description: "Template técnico para preservar sinais históricos; requer decisão jurídica humana.", status: "PENDING_LEGAL", createdByActorId: actorId },
    update: {},
  });
  const purpose = await tx.processingPurpose.upsert({
    where: { workspaceId_code: { workspaceId, code: LEGACY_PURPOSE_CODE } },
    create: { workspaceId, code: LEGACY_PURPOSE_CODE, name: "Contato comercial legado", description: "Finalidade técnica de migração; não autoriza comunicação real.", createdByActorId: actorId, updatedByActorId: actorId },
    update: {},
  });
  const purposeVersion = await tx.purposeVersion.upsert({
    where: { workspaceId_purposeId_version: { workspaceId, purposeId: purpose.id, version: 1 } },
    create: { workspaceId, purposeId: purpose.id, legalBasisId: basis.id, version: 1, description: purpose.description, audience: "Leads comerciais históricos", allowedChannels: ["PHONE", "EMAIL", "WHATSAPP", "SMS"], noticeText: "Texto original não comprovado; revisão jurídica necessária.", noticeVersion: LEGACY_NOTICE_VERSION, status: "PENDING_LEGAL", materiallyChanged: true, createdByActorId: actorId },
    update: {},
  });
  const categoryIds = [categories.get("IDENTITY"), categories.get("CONTACT"), categories.get("COMMERCIAL")].filter((id): id is string => Boolean(id));
  await tx.purposeDataCategory.createMany({ data: categoryIds.map((dataCategoryId) => ({ workspaceId, purposeVersionId: purposeVersion.id, dataCategoryId })), skipDuplicates: true });
  const retention = await tx.retentionPolicy.upsert({
    where: { workspaceId_code: { workspaceId, code: "legacy-commercial-review" } },
    create: { workspaceId, code: "legacy-commercial-review", name: "Revisão de retenção comercial legada", createdByActorId: actorId, updatedByActorId: actorId },
    update: {},
  });
  const retentionVersion = await tx.retentionPolicyVersion.upsert({
    where: { workspaceId_policyId_version: { workspaceId, policyId: retention.id, version: 1 } },
    create: { workspaceId, policyId: retention.id, purposeVersionId: purposeVersion.id, legalBasisId: basis.id, version: 1, trigger: "REVIEW_FROM_LAST_COMMERCIAL_ACTIVITY", durationDays: null, action: "REVIEW", exceptions: ["SECURITY_AUDIT", "HISTORICAL_FACT"], status: "PENDING_LEGAL", createdByActorId: actorId },
    update: {},
  });
  await tx.retentionPolicyCategory.createMany({ data: categoryIds.map((dataCategoryId) => ({ workspaceId, retentionPolicyVersionId: retentionVersion.id, dataCategoryId })), skipDuplicates: true });
  return { categories, basis, purpose, purposeVersion, retention, retentionVersion };
}

export function legacySignal(preference: ContactPreference) {
  if (preference === "DO_NOT_CONTACT") return { action: "OPTED_OUT" as const, effect: "DENIED" as const, state: "OPTED_OUT" as const, reasonCode: "LEGACY_HARD_OPT_OUT" };
  if (preference === "NOT_CONSENTED") return { action: "DENIED" as const, effect: "DENIED" as const, state: "DENIED" as const, reasonCode: "LEGACY_EXPLICIT_DENIAL" };
  if (preference === "CONSENTED") return { action: "GRANTED" as const, effect: "REVIEW_REQUIRED" as const, state: "REVIEW_REQUIRED" as const, reasonCode: "LEGACY_GRANT_WITHOUT_PROOF" };
  return { action: null, effect: null, state: "UNKNOWN" as const, reasonCode: "LEGACY_ABSENCE_OF_SIGNAL" };
}

export async function projectConsentState(tx: Tx, input: Readonly<{
  workspaceId: string;
  contactId: string;
  contactPointId: string | null;
  purposeId: string;
  channel: "PHONE" | "EMAIL" | "WHATSAPP" | "SMS" | "IN_APP" | "OTHER";
  state: "UNKNOWN" | "GRANTED" | "DENIED" | "REVOKED" | "OPTED_OUT" | "REVIEW_REQUIRED";
  reasonCode: string;
  sourceEventId: string | null;
  effectiveFrom: Date;
}>) {
  const lockKey = `${input.workspaceId}:${input.contactId}:${input.contactPointId ?? "contact"}:${input.purposeId}:${input.channel}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  const current = await tx.consentState.findFirst({ where: { workspaceId: input.workspaceId, contactId: input.contactId, contactPointId: input.contactPointId, purposeId: input.purposeId, channel: input.channel } });
  const protectedRestriction = (current?.state === "OPTED_OUT" || current?.state === "REVOKED") && input.state !== current.state;
  if (protectedRestriction) return current;
  if (current) return tx.consentState.update({ where: { id: current.id }, data: { state: input.state, reasonCode: input.reasonCode, sourceEventId: input.sourceEventId, effectiveFrom: input.effectiveFrom, policyVersion: PRIVACY_RULE_VERSION, revision: { increment: 1 } } });
  return tx.consentState.create({ data: { ...input, policyVersion: PRIVACY_RULE_VERSION } });
}

export async function recordLegacySignalInTransaction(tx: Tx, input: Readonly<{
  workspaceId: string;
  actorId: string;
  contactId: string;
  contactPointId: string | null;
  preference: ContactPreference;
  occurredAt: Date;
  source: "FORM" | "IMPORT" | "SIMULATOR" | "API" | "LEGACY_BACKFILL" | "SYSTEM";
  idempotencyKey: string;
  correlationId?: string | null;
  foundation?: Awaited<ReturnType<typeof ensurePrivacyFoundation>>;
}>) {
  const foundation = input.foundation ?? await ensurePrivacyFoundation(tx, input.workspaceId, input.actorId);
  const mapped = legacySignal(input.preference);
  let event = await tx.consentEvent.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey } } });
  if (!event && mapped.action && mapped.effect) {
    event = await tx.consentEvent.create({ data: {
      workspaceId: input.workspaceId, contactId: input.contactId, contactPointId: input.contactPointId,
      purposeVersionId: foundation.purposeVersion.id, channel: "PHONE", action: mapped.action,
      effect: mapped.effect, occurredAt: input.occurredAt, capturedAt: input.occurredAt, source: input.source,
      noticeVersion: input.preference === "CONSENTED" ? LEGACY_NOTICE_VERSION : null,
      evidenceReference: `legacy:${input.idempotencyKey}`, evidenceQuality: "LEGACY_SIGNAL",
      actorId: input.actorId, correlationId: input.correlationId ?? null, idempotencyKey: input.idempotencyKey,
    } });
  }
  const state = await projectConsentState(tx, { workspaceId: input.workspaceId, contactId: input.contactId, contactPointId: input.contactPointId, purposeId: foundation.purpose.id, channel: "PHONE", state: mapped.state, reasonCode: mapped.reasonCode, sourceEventId: event?.id ?? null, effectiveFrom: input.occurredAt });
  return { event, state, foundation };
}
