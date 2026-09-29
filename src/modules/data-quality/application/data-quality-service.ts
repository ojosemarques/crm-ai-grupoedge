import { createHash, randomUUID } from "node:crypto";

import { Prisma, type Account, type Contact, type PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  candidateDecisionSchema,
  dataQualityQuerySchema,
  issueActionSchema,
  mergeApplySchema,
  mergePlanSchema,
  mergePreviewSchema,
  mergeRollbackSchema,
  scanInputSchema,
  type MergePreview,
} from "@/modules/data-quality/domain/data-quality-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const timeZone = "America/Sao_Paulo";
const maximumScanRows = 2_000;

type AuthorizationPort = Pick<ReturnType<typeof getAuthorizationService>, "authorize" | "assertAuthorized">;
type Options = Readonly<{ database: PrismaClient; authorization: AuthorizationPort; now: () => Date }>;

const defaultRules = [
  { key: "CONTACT_NO_USABLE_CHANNEL", entityType: "CONTACT", fieldPath: "points", dimension: "COMPLETENESS", severity: "HIGH", conditionKey: "CONTACT_NO_USABLE_CHANNEL", title: "Contato sem canal utilizável", description: "Contato ativo sem telefone ou e-mail permitido e válido.", remediation: "Confirmar um canal válido ou registrar a ausência.", slaSeconds: 86_400 },
  { key: "CONTACT_DUPLICATE_POINT", entityType: "CONTACT", fieldPath: "points.normalizedValue", dimension: "UNIQUENESS", severity: "HIGH", conditionKey: "CONTACT_DUPLICATE_POINT", title: "Canal compartilhado entre contatos", description: "O mesmo telefone ou e-mail normalizado aparece em contatos canônicos distintos.", remediation: "Revisar a evidência e decidir se são pessoas distintas ou se cabe merge.", slaSeconds: 43_200 },
  { key: "ACCOUNT_DUPLICATE_IDENTITY", entityType: "ACCOUNT", fieldPath: "normalizedDocument|normalizedDomain|normalizedName", dimension: "UNIQUENESS", severity: "HIGH", conditionKey: "ACCOUNT_DUPLICATE_IDENTITY", title: "Possível conta duplicada", description: "Documento, domínio ou nome normalizado coincide entre contas ativas.", remediation: "Comparar as contas e preparar merge somente após confirmação humana.", slaSeconds: 86_400 },
  { key: "LEAD_MISSING_LATEST_ATTRIBUTION", entityType: "LEAD", fieldPath: "latestSourceId", dimension: "ATTRIBUTION", severity: "WARNING", conditionKey: "LEAD_MISSING_LATEST_ATTRIBUTION", title: "Lead sem atribuição vigente", description: "O fato de origem inicial existe, mas a origem mais recente não foi reconciliada.", remediation: "Revisar submissões e atribuição sem reescrever a origem inicial.", slaSeconds: 172_800 },
  { key: "OPPORTUNITY_MISSING_NEXT_ACTION", entityType: "OPPORTUNITY", fieldPath: "nextActionAt", dimension: "COMPLETENESS", severity: "CRITICAL", conditionKey: "OPPORTUNITY_MISSING_NEXT_ACTION", title: "Oportunidade sem próxima ação", description: "Oportunidade aberta não possui ação futura explícita.", remediation: "Definir uma próxima ação pelo serviço comercial.", slaSeconds: 14_400 },
  { key: "WON_WITHOUT_CONTRACT", entityType: "OPPORTUNITY", fieldPath: "contract", dimension: "REFERENTIAL_INTEGRITY", severity: "HIGH", conditionKey: "WON_WITHOUT_CONTRACT", title: "Ganho sem contrato", description: "Oportunidade ganha ainda não possui contrato comercial associado.", remediation: "Confirmar se o contrato deve ser criado ou registrar a exceção.", slaSeconds: 86_400 },
  { key: "INVOICE_PAYMENT_MISMATCH", entityType: "INVOICE", fieldPath: "paidCents", dimension: "FINANCIAL_RECONCILIATION", severity: "CRITICAL", conditionKey: "INVOICE_PAYMENT_MISMATCH", title: "Cobrança divergente do ledger", description: "O valor pago projetado diverge dos pagamentos confirmados e não revertidos.", remediation: "Reconciliar pelo fluxo financeiro; nunca ajustar a ocorrência diretamente.", slaSeconds: 14_400 },
] as const;

type RuleDefinition = (typeof defaultRules)[number];
type Detection = Readonly<{ ruleKey: RuleDefinition["key"]; entityType: string; entityId: string; ownerMemberId: string | null; queueId: string | null; impactScore: number; priority: number; summary: string; evidence: Prisma.InputJsonValue; observedFingerprint: string }>;

function invalid(message: string, statusCode = 400): never {
  throw new ApplicationError(message, { code: statusCode === 409 ? "CONFLICT" : "INVALID_INPUT", statusCode, expose: true });
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

function resource(workspaceId: string, resourceId?: string, ownerMemberId?: string | null, queueId?: string | null) {
  return { workspaceId, resourceType: "DataQuality", ...(resourceId ? { resourceId } : {}), ...(ownerMemberId !== undefined ? { ownerMemberId } : {}), ...(queueId !== undefined ? { queueId } : {}) };
}

function parseJsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toDisplay(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

export function createDataQualityService(options: Options) {
  async function permission(context: AuthenticatedContext, key: PermissionKey, scoped = resource(context.workspaceId)) {
    return options.authorization.authorize(context, key, scoped);
  }

  async function assert(context: AuthenticatedContext, key: PermissionKey, scoped = resource(context.workspaceId)) {
    await options.authorization.assertAuthorized(context, key, scoped);
  }

  async function defaultQueue(workspaceId: string) {
    const queue = await options.database.queue.findFirst({ where: { workspaceId, deletedAt: null }, orderBy: [{ isGeneral: "desc" }, { createdAt: "asc" }], select: { id: true } });
    if (!queue) invalid("O workspace precisa de uma fila operacional antes de ativar regras de qualidade.", 409);
    return queue.id;
  }

  async function ensureDefaultRules(transaction: Prisma.TransactionClient, context: AuthenticatedContext, queueId: string) {
    const existing = await transaction.dataQualityRuleVersion.findMany({ where: { workspaceId: context.workspaceId, key: { in: defaultRules.map((rule) => rule.key) } } });
    const byKey = new Map(existing.map((rule) => [rule.key, rule]));
    for (const definition of defaultRules) {
      if (byKey.has(definition.key)) continue;
      await transaction.dataQualityRuleVersion.create({ data: {
        id: randomUUID(), workspaceId: context.workspaceId, key: definition.key, version: 1,
        entityType: definition.entityType, fieldPath: definition.fieldPath, dimension: definition.dimension,
        severity: definition.severity, status: "ACTIVE", conditionKey: definition.conditionKey,
        title: definition.title, description: definition.description, remediation: definition.remediation,
        queueId, slaSeconds: definition.slaSeconds, scope: json({ workspace: true }),
        evidencePolicy: json({ allow: ["recordId", "missingFields", "reasonCode", "normalizedType", "count", "expectedCents", "observedCents"], deny: ["rawPayload", "secret", "messageBody"] }),
        effectiveAt: options.now(), createdByActorId: context.actorId, approvedByActorId: context.actorId,
      } });
    }
    return transaction.dataQualityRuleVersion.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE" } });
  }

  async function detect(workspaceId: string, queueId: string): Promise<{ detections: Detection[]; duplicates: ReadonlyArray<Readonly<{ entityType: "CONTACT" | "ACCOUNT"; leftEntityId: string; rightEntityId: string; strength: "STRONG" | "POSSIBLE"; confidenceBps: number; evidence: Prisma.InputJsonValue }>>; reconciliations: ReadonlyArray<Readonly<{ entityType: string; entityId: string | null; status: "MATCHED" | "MISMATCH" | "UNAVAILABLE"; discrepancyCode: string | null; summary: string; expectedCents: string; observedCents: string }>>; scanned: number; truncated: boolean }> {
    const [contacts, leads, opportunities, contracts, accounts, invoices, payments] = await Promise.all([
      options.database.contact.findMany({ where: { workspaceId, status: "ACTIVE", deletedAt: null }, include: { points: { where: { deletedAt: null }, select: { type: true, normalizedValue: true, verificationStatus: true, quality: true, doNotContact: true } } }, take: maximumScanRows }),
      options.database.lead.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, ownerMemberId: true, queueId: true, latestSourceId: true }, take: maximumScanRows }),
      options.database.opportunity.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, ownerMemberId: true, status: true, nextActionAt: true }, take: maximumScanRows }),
      options.database.commercialContract.findMany({ where: { workspaceId }, select: { opportunityId: true, accountId: true, primaryContactId: true } }),
      options.database.account.findMany({ where: { workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, normalizedName: true, normalizedDocument: true, normalizedDomain: true }, take: maximumScanRows }),
      options.database.invoice.findMany({ where: { workspaceId }, select: { id: true, ownerMemberId: true, paidCents: true }, take: maximumScanRows }),
      options.database.payment.findMany({ where: { workspaceId, status: "CONFIRMED", reversedAt: null }, select: { invoiceId: true, amountCents: true } }),
    ]);
    const detections: Detection[] = [];
    const duplicates: Array<{ entityType: "CONTACT" | "ACCOUNT"; leftEntityId: string; rightEntityId: string; strength: "STRONG" | "POSSIBLE"; confidenceBps: number; evidence: Prisma.InputJsonValue }> = [];
    const pointGroups = new Map<string, string[]>();
    for (const contact of contacts) {
      const usable = contact.points.some((point) => !point.doNotContact && point.verificationStatus !== "INVALID" && point.quality !== "INVALID");
      if (!usable) detections.push({ ruleKey: "CONTACT_NO_USABLE_CHANNEL", entityType: "CONTACT", entityId: contact.id, ownerMemberId: null, queueId, impactScore: 80, priority: 85, summary: "Nenhum telefone ou e-mail utilizável foi confirmado.", evidence: json({ recordId: contact.id, missingFields: ["usableContactPoint"] }), observedFingerprint: fingerprint(contact.points.map((point) => [point.type, point.verificationStatus, point.quality, point.doNotContact])) });
      for (const point of contact.points) {
        if (point.verificationStatus === "INVALID" || point.quality === "INVALID") continue;
        const key = `${point.type}:${point.normalizedValue}`;
        pointGroups.set(key, [...(pointGroups.get(key) ?? []), contact.id]);
      }
    }
    for (const [key, ids] of pointGroups) {
      const distinct = [...new Set(ids)].sort();
      if (distinct.length < 2) continue;
      for (let left = 0; left < distinct.length - 1; left += 1) for (let right = left + 1; right < distinct.length; right += 1) {
        const [type] = key.split(":");
        duplicates.push({ entityType: "CONTACT", leftEntityId: distinct[left]!, rightEntityId: distinct[right]!, strength: "STRONG", confidenceBps: 9500, evidence: json({ normalizedType: type, count: distinct.length, reasonCode: "EXACT_NORMALIZED_CONTACT_POINT" }) });
      }
    }
    for (const lead of leads) if (!lead.latestSourceId) detections.push({ ruleKey: "LEAD_MISSING_LATEST_ATTRIBUTION", entityType: "LEAD", entityId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.ownerMemberId ? null : (lead.queueId ?? queueId), impactScore: 45, priority: 45, summary: "A origem vigente está ausente; a origem inicial permanece preservada.", evidence: json({ recordId: lead.id, missingFields: ["latestSourceId"] }), observedFingerprint: fingerprint({ latestSourceId: null }) });
    const contracted = new Set(contracts.map((contract) => contract.opportunityId));
    for (const opportunity of opportunities) {
      if (opportunity.status === "OPEN" && !opportunity.nextActionAt) detections.push({ ruleKey: "OPPORTUNITY_MISSING_NEXT_ACTION", entityType: "OPPORTUNITY", entityId: opportunity.id, ownerMemberId: opportunity.ownerMemberId, queueId: null, impactScore: 95, priority: 100, summary: "Oportunidade aberta sem próxima ação datada.", evidence: json({ recordId: opportunity.id, missingFields: ["nextActionAt"] }), observedFingerprint: fingerprint({ status: opportunity.status, nextActionAt: null }) });
      if (opportunity.status === "WON" && !contracted.has(opportunity.id)) detections.push({ ruleKey: "WON_WITHOUT_CONTRACT", entityType: "OPPORTUNITY", entityId: opportunity.id, ownerMemberId: opportunity.ownerMemberId, queueId: null, impactScore: 85, priority: 90, summary: "Ganho persistido sem contrato comercial relacionado.", evidence: json({ recordId: opportunity.id, missingFields: ["commercialContract"] }), observedFingerprint: fingerprint({ status: opportunity.status, contract: null }) });
    }
    const accountKeys = new Map<string, string[]>();
    for (const account of accounts) for (const [kind, value] of [["DOCUMENT", account.normalizedDocument], ["DOMAIN", account.normalizedDomain], ["NAME", account.normalizedName]] as const) {
      if (!value) continue;
      const key = `${kind}:${value}`;
      accountKeys.set(key, [...(accountKeys.get(key) ?? []), account.id]);
    }
    for (const [key, ids] of accountKeys) {
      const distinct = [...new Set(ids)].sort();
      if (distinct.length < 2) continue;
      for (let left = 0; left < distinct.length - 1; left += 1) for (let right = left + 1; right < distinct.length; right += 1) {
        const [kind] = key.split(":");
        duplicates.push({ entityType: "ACCOUNT", leftEntityId: distinct[left]!, rightEntityId: distinct[right]!, strength: kind === "NAME" ? "POSSIBLE" : "STRONG", confidenceBps: kind === "NAME" ? 7200 : 9800, evidence: json({ normalizedType: kind, count: distinct.length, reasonCode: `EXACT_NORMALIZED_${kind}` }) });
      }
    }
    const paid = new Map<string, bigint>();
    for (const payment of payments) paid.set(payment.invoiceId, (paid.get(payment.invoiceId) ?? 0n) + payment.amountCents);
    const reconciliations: Array<{ entityType: string; entityId: string | null; status: "MATCHED" | "MISMATCH" | "UNAVAILABLE"; discrepancyCode: string | null; summary: string; expectedCents: string; observedCents: string }> = invoices.map((invoice) => {
      const observed = paid.get(invoice.id) ?? 0n;
      const matched = observed === invoice.paidCents;
      if (!matched) detections.push({ ruleKey: "INVOICE_PAYMENT_MISMATCH", entityType: "INVOICE", entityId: invoice.id, ownerMemberId: invoice.ownerMemberId, queueId: null, impactScore: 100, priority: 100, summary: "Projeção de cobrança diverge do ledger de pagamentos confirmados.", evidence: json({ recordId: invoice.id, expectedCents: invoice.paidCents.toString(), observedCents: observed.toString() }), observedFingerprint: fingerprint({ expected: invoice.paidCents.toString(), observed: observed.toString() }) });
      return { entityType: "INVOICE", entityId: invoice.id, status: matched ? "MATCHED" as const : "MISMATCH" as const, discrepancyCode: matched ? null : "PAID_CENTS_DIFFERS_FROM_CONFIRMED_LEDGER", summary: matched ? "Cobrança reconciliada com pagamentos confirmados." : "Cobrança divergente do ledger confirmado.", expectedCents: invoice.paidCents.toString(), observedCents: observed.toString() };
    });
    if (reconciliations.length === 0) reconciliations.push({ entityType: "INVOICE", entityId: null, status: "UNAVAILABLE", discrepancyCode: "NO_INVOICES_IN_SCOPE", summary: "Não há cobranças no recorte; reconciliação financeira indisponível, não zero.", expectedCents: "0", observedCents: "0" });
    const scanned = contacts.length + leads.length + opportunities.length + accounts.length + invoices.length;
    return { detections, duplicates, reconciliations, scanned, truncated: [contacts, leads, opportunities, accounts, invoices].some((rows) => rows.length === maximumScanRows) };
  }

  async function runScan(context: AuthenticatedContext, input: unknown) {
    await assert(context, PermissionKeys.DATA_QUALITY_MANAGE);
    const parsed = scanInputSchema.safeParse(input);
    if (!parsed.success) invalid("Parâmetros da varredura inválidos.");
    const existing = await options.database.dataQualityScanRun.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
    if (existing) return existing;
    const queueId = await defaultQueue(context.workspaceId);
    const findings = await detect(context.workspaceId, queueId);
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm61:scan:${context.workspaceId}:${parsed.data.idempotencyKey}`}))`;
      const replay = await transaction.dataQualityScanRun.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
      if (replay) return replay;
      const rules = parsed.data.mode === "EXECUTE" ? await ensureDefaultRules(transaction, context, queueId) : [];
      const ruleByKey = new Map(rules.map((rule) => [rule.key, rule]));
      let detectedCount = 0; let reopenedCount = 0; let unchangedCount = 0;
      if (parsed.data.mode === "EXECUTE") {
        for (const item of findings.detections) {
          const rule = ruleByKey.get(item.ruleKey);
          if (!rule) continue;
          const key = fingerprint({ rule: rule.key, version: rule.version, entityType: item.entityType, entityId: item.entityId });
          const current = await transaction.dataQualityIssue.findUnique({ where: { workspaceId_fingerprint: { workspaceId: context.workspaceId, fingerprint: key } } });
          if (!current) {
            const issue = await transaction.dataQualityIssue.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, ruleVersionId: rule.id, entityType: item.entityType, entityId: item.entityId, fingerprint: key, observedFingerprint: item.observedFingerprint, severity: rule.severity, impactScore: item.impactScore, priority: item.priority, title: rule.title, evidenceSummary: item.summary, evidence: item.evidence, ownerMemberId: item.ownerMemberId, queueId: item.queueId, detectedAt: now, lastDetectedAt: now, dueAt: rule.slaSeconds === null ? null : new Date(now.getTime() + rule.slaSeconds * 1000), correlationId: `quality:${key}` } });
            await transaction.dataQualityIssueEvent.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, issueId: issue.id, type: "DETECTED", actorId: context.actorId, reason: "Regra determinística ativa detectou a ocorrência.", nextStatus: "OPEN", details: json({ ruleKey: rule.key, ruleVersion: rule.version }) } });
            detectedCount += 1;
          } else if (["RESOLVED", "DISMISSED"].includes(current.status) && current.observedFingerprint !== item.observedFingerprint) {
            await transaction.dataQualityIssue.update({ where: { id: current.id }, data: { status: "OPEN", observedFingerprint: item.observedFingerprint, evidenceSummary: item.summary, evidence: item.evidence, ownerMemberId: item.ownerMemberId, queueId: item.queueId, lastDetectedAt: now, resolvedAt: null, resolvedByActorId: null, resolutionReason: null, revision: { increment: 1 } } });
            await transaction.dataQualityIssueEvent.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, issueId: current.id, type: "REOPENED", actorId: context.actorId, reason: "A evidência mudou após o encerramento anterior.", previousStatus: current.status, nextStatus: "OPEN" } });
            reopenedCount += 1;
          } else {
            await transaction.dataQualityIssue.update({ where: { id: current.id }, data: { lastDetectedAt: now } });
            unchangedCount += 1;
          }
        }
        for (const candidate of findings.duplicates) {
          const key = fingerprint({ entityType: candidate.entityType, left: candidate.leftEntityId, right: candidate.rightEntityId });
          await transaction.duplicateCandidate.upsert({ where: { workspaceId_fingerprint: { workspaceId: context.workspaceId, fingerprint: key } }, create: { id: randomUUID(), workspaceId: context.workspaceId, ...candidate, fingerprint: key, detectedAt: now, lastDetectedAt: now }, update: { lastDetectedAt: now, evidence: candidate.evidence, confidenceBps: candidate.confidenceBps } });
        }
        for (const result of findings.reconciliations) await transaction.dataReconciliationResult.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, reconciliationKey: "INVOICE_CONFIRMED_PAYMENTS_V1", entityType: result.entityType, entityId: result.entityId, status: result.status, discrepancyCode: result.discrepancyCode, summary: result.summary, sourceSystem: "payment_ledger", targetSystem: "invoice_projection", canonicalSource: "payment_ledger", precedenceRule: "Pagamentos CONFIRMED e não revertidos são fatos; invoice.paidCents é projeção reconciliável.", evidence: json({ expectedCents: result.expectedCents, observedCents: result.observedCents }), observedAt: now, asOf: now, timeZone, createdByActorId: context.actorId } });
      }
      const run = await transaction.dataQualityScanRun.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, mode: parsed.data.mode, status: "COMPLETED", idempotencyKey: parsed.data.idempotencyKey, requestedByActorId: context.actorId, startedAt: now, finishedAt: now, checkpoint: findings.truncated ? `bounded:${maximumScanRows}` : "complete", scannedCount: findings.scanned, detectedCount: parsed.data.mode === "DRY_RUN" ? findings.detections.length : detectedCount, reopenedCount, unchangedCount, result: json({ duplicateCandidates: findings.duplicates.length, reconciliations: findings.reconciliations.length, truncated: findings.truncated, mutation: parsed.data.mode === "EXECUTE" }) } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "data_quality.scan.completed", entityType: "DataQualityScanRun", entityId: run.id, origin: "DOMAIN", reason: parsed.data.mode === "DRY_RUN" ? "Diagnóstico sem criação de ocorrências." : "Varredura determinística confirmada.", changes: json({ mode: parsed.data.mode, scanned: findings.scanned, detected: run.detectedCount, duplicates: findings.duplicates.length }) } });
      return run;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async function issueAction(context: AuthenticatedContext, input: unknown) {
    const parsed = issueActionSchema.safeParse(input);
    if (!parsed.success) invalid("Ação de ocorrência inválida.");
    const issue = await options.database.dataQualityIssue.findFirst({ where: { id: parsed.data.issueId, workspaceId: context.workspaceId } });
    if (!issue) invalid("Ocorrência não encontrada.", 404);
    await assert(context, PermissionKeys.DATA_QUALITY_RESOLVE, resource(context.workspaceId, issue.id, issue.ownerMemberId, issue.queueId));
    if (issue.revision !== parsed.data.expectedRevision) invalid("A ocorrência foi alterada por outra pessoa. Atualize a página.", 409);
    const nextStatus = parsed.data.action === "RESOLVE" ? "RESOLVED" : parsed.data.action === "DISMISS" ? "DISMISSED" : parsed.data.action === "COMMENT" ? issue.status : "IN_REVIEW";
    return options.database.$transaction(async (transaction) => {
      const updated = await transaction.dataQualityIssue.update({ where: { id: issue.id }, data: { status: nextStatus, ownerMemberId: parsed.data.action === "ASSIGN_TO_ME" ? context.memberId : issue.ownerMemberId, queueId: parsed.data.action === "ASSIGN_TO_ME" ? null : issue.queueId, resolvedAt: ["RESOLVED", "DISMISSED"].includes(nextStatus) ? options.now() : null, resolvedByActorId: ["RESOLVED", "DISMISSED"].includes(nextStatus) ? context.actorId : null, resolutionReason: ["RESOLVED", "DISMISSED"].includes(nextStatus) ? parsed.data.reason : null, revision: { increment: 1 } } });
      const type = parsed.data.action === "ASSIGN_TO_ME" ? "ASSIGNED" : parsed.data.action === "COMMENT" ? "COMMENTED" : parsed.data.action === "RESOLVE" ? "RESOLVED" : "DISMISSED";
      await transaction.dataQualityIssueEvent.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, issueId: issue.id, type, actorId: context.actorId, reason: parsed.data.reason, previousStatus: issue.status, nextStatus } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `data_quality.issue.${parsed.data.action.toLowerCase()}`, entityType: "DataQualityIssue", entityId: issue.id, origin: "DOMAIN", reason: parsed.data.reason, changes: json({ from: issue.status, to: nextStatus, revision: updated.revision }) } });
      return updated;
    });
  }

  async function decideCandidate(context: AuthenticatedContext, input: unknown) {
    await assert(context, PermissionKeys.DATA_QUALITY_MERGE);
    const parsed = candidateDecisionSchema.safeParse(input);
    if (!parsed.success) invalid("Decisão de duplicidade inválida.");
    const candidate = await options.database.duplicateCandidate.findFirst({ where: { id: parsed.data.candidateId, workspaceId: context.workspaceId } });
    if (!candidate) invalid("Candidato não encontrado.", 404);
    if (candidate.revision !== parsed.data.expectedRevision) invalid("O candidato foi alterado por outra pessoa.", 409);
    return options.database.$transaction(async (transaction) => {
      const updated = await transaction.duplicateCandidate.update({ where: { id: candidate.id }, data: { status: "NOT_DUPLICATE", decisionReason: parsed.data.reason, decidedAt: options.now(), decidedByActorId: context.actorId, revision: { increment: 1 } } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "data_quality.duplicate.not_duplicate", entityType: "DuplicateCandidate", entityId: candidate.id, origin: "DOMAIN", reason: parsed.data.reason } });
      return updated;
    });
  }

  async function buildPreview(context: AuthenticatedContext, input: unknown): Promise<MergePreview> {
    await assert(context, PermissionKeys.DATA_QUALITY_MERGE);
    const parsed = mergePreviewSchema.safeParse(input);
    if (!parsed.success) invalid("Parâmetros da prévia de merge inválidos.");
    const candidate = await options.database.duplicateCandidate.findFirst({ where: { id: parsed.data.candidateId, workspaceId: context.workspaceId, status: { in: ["OPEN", "MERGE_PLANNED"] } } });
    if (!candidate) invalid("Candidato aberto não encontrado.", 404);
    if (![candidate.leftEntityId, candidate.rightEntityId].includes(parsed.data.survivorEntityId)) invalid("O sobrevivente deve pertencer ao par revisado.");
    const sourceId = candidate.leftEntityId === parsed.data.survivorEntityId ? candidate.rightEntityId : candidate.leftEntityId;
    const survivorId = parsed.data.survivorEntityId;
    if (candidate.entityType === "CONTACT") {
      const [source, survivor, sourceLeads, sourceSubmissions, sourceContracts] = await Promise.all([
        options.database.contact.findFirst({ where: { id: sourceId, workspaceId: context.workspaceId, deletedAt: null } }),
        options.database.contact.findFirst({ where: { id: survivorId, workspaceId: context.workspaceId, deletedAt: null } }),
        options.database.lead.count({ where: { workspaceId: context.workspaceId, contactId: sourceId } }),
        options.database.leadFormSubmission.count({ where: { workspaceId: context.workspaceId, contactId: sourceId } }),
        options.database.commercialContract.count({ where: { workspaceId: context.workspaceId, primaryContactId: sourceId } }),
      ]);
      if (!source || !survivor) invalid("Contato do par não encontrado.", 404);
      const fields = (["preferredName", "legalName", "jobTitle", "timeZone", "locale"] as const).map((field) => ({ fieldPath: field, label: { preferredName: "Nome preferido", legalName: "Nome legal", jobTitle: "Cargo", timeZone: "Fuso horário", locale: "Localidade" }[field], sourceValue: toDisplay(source[field]), survivorValue: toDisplay(survivor[field]), recommended: !survivor[field] && source[field] ? "SOURCE" as const : "SURVIVOR" as const }));
      const core = { entityType: "CONTACT" as const, source: { id: source.id, label: source.preferredName, revision: source.updatedAt.toISOString() }, survivor: { id: survivor.id, label: survivor.preferredName, revision: survivor.updatedAt.toISOString() }, fields, relationships: { leads: sourceLeads, submissions: sourceSubmissions, immutableCommercialContracts: sourceContracts }, blockers: sourceContracts ? ["O contato de origem participa de contrato comercial; o fato histórico impede merge automático."] : [] };
      return { ...core, previewFingerprint: fingerprint(core) };
    }
    const [source, survivor, leads, opportunities, contracts, subscriptions, invoices] = await Promise.all([
      options.database.account.findFirst({ where: { id: sourceId, workspaceId: context.workspaceId, deletedAt: null } }),
      options.database.account.findFirst({ where: { id: survivorId, workspaceId: context.workspaceId, deletedAt: null } }),
      options.database.lead.count({ where: { workspaceId: context.workspaceId, accountId: sourceId } }),
      options.database.opportunity.count({ where: { workspaceId: context.workspaceId, accountId: sourceId } }),
      options.database.commercialContract.count({ where: { workspaceId: context.workspaceId, accountId: sourceId } }),
      options.database.subscription.count({ where: { workspaceId: context.workspaceId, accountId: sourceId } }),
      options.database.invoice.count({ where: { workspaceId: context.workspaceId, accountId: sourceId } }),
    ]);
    if (!source || !survivor) invalid("Conta do par não encontrada.", 404);
    const fields = (["name", "legalName", "originalDocument", "originalDomain", "segment", "size"] as const).map((field) => ({ fieldPath: field, label: { name: "Nome", legalName: "Razão social", originalDocument: "Documento", originalDomain: "Domínio", segment: "Segmento", size: "Porte" }[field], sourceValue: toDisplay(source[field]), survivorValue: toDisplay(survivor[field]), recommended: !survivor[field] && source[field] ? "SOURCE" as const : "SURVIVOR" as const }));
    const blockers = [...(contracts ? ["A conta de origem possui contrato comercial."] : []), ...(subscriptions ? ["A conta de origem possui assinatura."] : []), ...(invoices ? ["A conta de origem possui cobrança financeira."] : [])];
    const core = { entityType: "ACCOUNT" as const, source: { id: source.id, label: source.name, revision: `${source.revision}:${source.updatedAt.toISOString()}` }, survivor: { id: survivor.id, label: survivor.name, revision: `${survivor.revision}:${survivor.updatedAt.toISOString()}` }, fields, relationships: { leads, opportunities, immutableCommercialContracts: contracts, immutableSubscriptions: subscriptions, immutableInvoices: invoices }, blockers };
    return { ...core, previewFingerprint: fingerprint(core) };
  }

  async function createMergePlan(context: AuthenticatedContext, input: unknown) {
    const parsed = mergePlanSchema.safeParse(input);
    if (!parsed.success) invalid("Plano de merge inválido.");
    const preview = await buildPreview(context, { candidateId: parsed.data.candidateId, survivorEntityId: parsed.data.survivorEntityId });
    if (preview.previewFingerprint !== parsed.data.previewFingerprint) invalid("A prévia ficou desatualizada. Gere-a novamente.", 409);
    const knownFields = new Set(preview.fields.map((field) => field.fieldPath));
    if (parsed.data.decisions.some((decision) => !knownFields.has(decision.fieldPath))) invalid("O plano contém campo não permitido.");
    return options.database.$transaction(async (transaction) => {
      const plan = await transaction.mergePlan.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, candidateId: parsed.data.candidateId, entityType: preview.entityType, sourceEntityId: preview.source.id, survivorEntityId: preview.survivor.id, status: preview.blockers.length ? "BLOCKED" : "READY", reason: parsed.data.reason, previewFingerprint: preview.previewFingerprint, sourceRevision: preview.source.revision, survivorRevision: preview.survivor.revision, blockedReasons: preview.blockers.length ? json(preview.blockers) : Prisma.JsonNull, createdByActorId: context.actorId } });
      for (const field of preview.fields) {
        const selected = parsed.data.decisions.find((item) => item.fieldPath === field.fieldPath)?.strategy ?? field.recommended;
        await transaction.mergeFieldDecision.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, mergePlanId: plan.id, fieldPath: field.fieldPath, sourceValue: field.sourceValue === null ? Prisma.JsonNull : field.sourceValue, survivorValue: field.survivorValue === null ? Prisma.JsonNull : field.survivorValue, selectedValue: (selected === "SOURCE" ? field.sourceValue : field.survivorValue) === null ? Prisma.JsonNull : (selected === "SOURCE" ? field.sourceValue : field.survivorValue)!, strategy: selected } });
      }
      await transaction.duplicateCandidate.update({ where: { id: parsed.data.candidateId }, data: { status: "MERGE_PLANNED", revision: { increment: 1 } } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "data_quality.merge.plan_created", entityType: "MergePlan", entityId: plan.id, origin: "DOMAIN", reason: parsed.data.reason, changes: json({ status: plan.status, sourceEntityId: plan.sourceEntityId, survivorEntityId: plan.survivorEntityId, blockers: preview.blockers }) } });
      return { plan, preview };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async function currentEntity(transaction: Prisma.TransactionClient, workspaceId: string, type: "CONTACT" | "ACCOUNT", id: string): Promise<Contact | Account | null> {
    return type === "CONTACT" ? transaction.contact.findFirst({ where: { id, workspaceId, deletedAt: null } }) : transaction.account.findFirst({ where: { id, workspaceId, deletedAt: null } });
  }

  async function applyMerge(context: AuthenticatedContext, input: unknown) {
    await assert(context, PermissionKeys.DATA_QUALITY_MERGE);
    const parsed = mergeApplySchema.safeParse(input);
    if (!parsed.success) invalid("Confirmação de merge inválida.");
    const duplicateExecution = await options.database.mergeExecution.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
    if (duplicateExecution) return duplicateExecution;
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm61:merge:${context.workspaceId}:${parsed.data.idempotencyKey}`}))`;
      const replay = await transaction.mergeExecution.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
      if (replay) return replay;
      let plan = await transaction.mergePlan.findFirst({ where: { id: parsed.data.mergePlanId, workspaceId: context.workspaceId } });
      if (!plan) invalid("Plano de merge não encontrado.", 404);
      const lockIds = [plan.sourceEntityId, plan.survivorEntityId].sort();
      for (const id of lockIds) await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm61:${context.workspaceId}:${id}`}))`;
      plan = await transaction.mergePlan.findFirst({ where: { id: parsed.data.mergePlanId, workspaceId: context.workspaceId } });
      if (!plan || plan.status !== "READY" || plan.revision !== parsed.data.expectedRevision) invalid("Plano desatualizado ou bloqueado; gere nova prévia.", 409);
      const [source, survivor, decisions] = await Promise.all([currentEntity(transaction, context.workspaceId, plan.entityType, plan.sourceEntityId), currentEntity(transaction, context.workspaceId, plan.entityType, plan.survivorEntityId), transaction.mergeFieldDecision.findMany({ where: { workspaceId: context.workspaceId, mergePlanId: plan.id } })]);
      if (!source || !survivor) invalid("Entidade do merge não encontrada.", 404);
      const currentSourceRevision = plan.entityType === "CONTACT" ? source.updatedAt.toISOString() : `${"revision" in source ? source.revision : 0}:${source.updatedAt.toISOString()}`;
      const currentSurvivorRevision = plan.entityType === "CONTACT" ? survivor.updatedAt.toISOString() : `${"revision" in survivor ? survivor.revision : 0}:${survivor.updatedAt.toISOString()}`;
      if (currentSourceRevision !== plan.sourceRevision || currentSurvivorRevision !== plan.survivorRevision) invalid("Os registros mudaram desde a prévia; o merge foi interrompido.", 409);
      const selected = Object.fromEntries(decisions.map((item) => [item.fieldPath, item.selectedValue === null ? null : item.selectedValue]));
      let ledger: Record<string, string[]>;
      if (plan.entityType === "CONTACT") {
        const contactSurvivor = survivor as Contact;
        const blockingContracts = await transaction.commercialContract.count({ where: { workspaceId: context.workspaceId, primaryContactId: plan.sourceEntityId } });
        if (blockingContracts) invalid("O contato passou a participar de contrato; gere nova prévia.", 409);
        const [leads, submissions] = await Promise.all([transaction.lead.findMany({ where: { workspaceId: context.workspaceId, contactId: plan.sourceEntityId }, select: { id: true } }), transaction.leadFormSubmission.findMany({ where: { workspaceId: context.workspaceId, contactId: plan.sourceEntityId }, select: { id: true } })]);
        const leadIds = leads.map((item) => item.id); const submissionIds = submissions.map((item) => item.id);
        ledger = { leadIds, submissionIds };
        await transaction.contact.update({ where: { id: plan.survivorEntityId }, data: { preferredName: String(selected.preferredName ?? contactSurvivor.preferredName), legalName: selected.legalName === null ? null : String(selected.legalName ?? contactSurvivor.legalName ?? "") || null, jobTitle: selected.jobTitle === null ? null : String(selected.jobTitle ?? contactSurvivor.jobTitle ?? "") || null, timeZone: selected.timeZone === null ? null : String(selected.timeZone ?? contactSurvivor.timeZone ?? "") || null, locale: String(selected.locale ?? contactSurvivor.locale), updatedByActorId: context.actorId } });
        await transaction.lead.updateMany({ where: { workspaceId: context.workspaceId, id: { in: leadIds }, contactId: plan.sourceEntityId }, data: { contactId: plan.survivorEntityId, updatedByActorId: context.actorId } });
        await transaction.leadFormSubmission.updateMany({ where: { workspaceId: context.workspaceId, id: { in: submissionIds }, contactId: plan.sourceEntityId }, data: { contactId: plan.survivorEntityId } });
        await transaction.contact.update({ where: { id: plan.sourceEntityId }, data: { status: "MERGED", mergedIntoContactId: plan.survivorEntityId, updatedByActorId: context.actorId } });
      } else {
        const accountSource = source as Account;
        const accountSurvivor = survivor as Account;
        const [contracts, subscriptions, invoices] = await Promise.all([transaction.commercialContract.count({ where: { workspaceId: context.workspaceId, accountId: plan.sourceEntityId } }), transaction.subscription.count({ where: { workspaceId: context.workspaceId, accountId: plan.sourceEntityId } }), transaction.invoice.count({ where: { workspaceId: context.workspaceId, accountId: plan.sourceEntityId } })]);
        if (contracts || subscriptions || invoices) invalid("A conta passou a ter fatos financeiros; gere nova prévia.", 409);
        const [leads, opportunities] = await Promise.all([transaction.lead.findMany({ where: { workspaceId: context.workspaceId, accountId: plan.sourceEntityId }, select: { id: true } }), transaction.opportunity.findMany({ where: { workspaceId: context.workspaceId, accountId: plan.sourceEntityId }, select: { id: true } })]);
        const leadIds = leads.map((item) => item.id); const opportunityIds = opportunities.map((item) => item.id);
        ledger = { leadIds, opportunityIds };
        const strategies = new Map(decisions.map((item) => [item.fieldPath, item.strategy]));
        await transaction.account.update({ where: { id: plan.survivorEntityId }, data: {
          name: String(selected.name ?? accountSurvivor.name),
          normalizedName: strategies.get("name") === "SOURCE" ? accountSource.normalizedName : accountSurvivor.normalizedName,
          legalName: selected.legalName === null ? null : String(selected.legalName ?? accountSurvivor.legalName ?? "") || null,
          originalDocument: selected.originalDocument === null ? null : String(selected.originalDocument ?? accountSurvivor.originalDocument ?? "") || null,
          normalizedDocument: strategies.get("originalDocument") === "SOURCE" ? accountSource.normalizedDocument : accountSurvivor.normalizedDocument,
          originalDomain: selected.originalDomain === null ? null : String(selected.originalDomain ?? accountSurvivor.originalDomain ?? "") || null,
          normalizedDomain: strategies.get("originalDomain") === "SOURCE" ? accountSource.normalizedDomain : accountSurvivor.normalizedDomain,
          segment: String(selected.segment ?? accountSurvivor.segment) as typeof accountSurvivor.segment,
          size: String(selected.size ?? accountSurvivor.size) as typeof accountSurvivor.size,
          revision: { increment: 1 },
          updatedByActorId: context.actorId,
        } });
        await transaction.lead.updateMany({ where: { workspaceId: context.workspaceId, id: { in: leadIds }, accountId: plan.sourceEntityId }, data: { accountId: plan.survivorEntityId, updatedByActorId: context.actorId } });
        await transaction.opportunity.updateMany({ where: { workspaceId: context.workspaceId, id: { in: opportunityIds }, accountId: plan.sourceEntityId }, data: { accountId: plan.survivorEntityId, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await transaction.account.update({ where: { id: plan.sourceEntityId }, data: { status: "MERGED", mergedIntoAccountId: plan.survivorEntityId, revision: { increment: 1 }, updatedByActorId: context.actorId } });
      }
      const [sourceAfter, survivorAfter] = await Promise.all([currentEntity(transaction, context.workspaceId, plan.entityType, plan.sourceEntityId), currentEntity(transaction, context.workspaceId, plan.entityType, plan.survivorEntityId)]);
      const resultFingerprint = fingerprint({ source: sourceAfter, survivor: survivorAfter });
      const execution = await transaction.mergeExecution.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, mergePlanId: plan.id, type: "APPLY", idempotencyKey: parsed.data.idempotencyKey, sourceSnapshot: json(source), survivorSnapshot: json(survivor), relationLedger: json(ledger), preconditionFingerprint: fingerprint({ sourceRevision: plan.sourceRevision, survivorRevision: plan.survivorRevision, preview: plan.previewFingerprint }), resultFingerprint, actorId: context.actorId, reason: plan.reason } });
      await transaction.mergePlan.update({ where: { id: plan.id }, data: { status: "APPLIED", appliedAt: options.now(), appliedByActorId: context.actorId, revision: { increment: 1 } } });
      if (plan.candidateId) await transaction.duplicateCandidate.update({ where: { id: plan.candidateId }, data: { status: "MERGED", decidedAt: options.now(), decidedByActorId: context.actorId, decisionReason: plan.reason, revision: { increment: 1 } } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "data_quality.merge.applied", entityType: "MergePlan", entityId: plan.id, origin: "DOMAIN", reason: plan.reason, changes: json({ entityType: plan.entityType, sourceEntityId: plan.sourceEntityId, survivorEntityId: plan.survivorEntityId, moved: Object.fromEntries(Object.entries(ledger).map(([key, ids]) => [key, ids.length])) }) } });
      return execution;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async function rollbackMerge(context: AuthenticatedContext, input: unknown) {
    await assert(context, PermissionKeys.DATA_QUALITY_ROLLBACK);
    const parsed = mergeRollbackSchema.safeParse(input);
    if (!parsed.success) invalid("Confirmação de reversão inválida.");
    const duplicateExecution = await options.database.mergeExecution.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
    if (duplicateExecution) return duplicateExecution;
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm61:rollback:${context.workspaceId}:${parsed.data.idempotencyKey}`}))`;
      const replay = await transaction.mergeExecution.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: parsed.data.idempotencyKey } } });
      if (replay) return replay;
      let plan = await transaction.mergePlan.findFirst({ where: { id: parsed.data.mergePlanId, workspaceId: context.workspaceId } });
      if (!plan) invalid("Plano não pode ser revertido neste estado.", 409);
      for (const id of [plan.sourceEntityId, plan.survivorEntityId].sort()) await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crm61:${context.workspaceId}:${id}`}))`;
      plan = await transaction.mergePlan.findFirst({ where: { id: parsed.data.mergePlanId, workspaceId: context.workspaceId } });
      if (!plan || plan.status !== "APPLIED" || plan.revision !== parsed.data.expectedRevision) invalid("Plano não pode ser revertido neste estado.", 409);
      const applied = await transaction.mergeExecution.findFirst({ where: { workspaceId: context.workspaceId, mergePlanId: plan.id, type: "APPLY" }, orderBy: { occurredAt: "desc" } });
      if (!applied) invalid("Ledger de aplicação não encontrado.", 409);
      const [source, survivor] = await Promise.all([currentEntity(transaction, context.workspaceId, plan.entityType, plan.sourceEntityId), currentEntity(transaction, context.workspaceId, plan.entityType, plan.survivorEntityId)]);
      if (!source || !survivor || fingerprint({ source, survivor }) !== applied.resultFingerprint) invalid("Os registros mudaram após o merge; a reversão automática foi bloqueada.", 409);
      const sourceSnapshot = parseJsonObject(applied.sourceSnapshot); const survivorSnapshot = parseJsonObject(applied.survivorSnapshot); const ledger = parseJsonObject(applied.relationLedger);
      const ids = (key: string) => Array.isArray(ledger[key]) ? (ledger[key] as unknown[]).filter((value): value is string => typeof value === "string") : [];
      if (plan.entityType === "CONTACT") {
        await transaction.lead.updateMany({ where: { workspaceId: context.workspaceId, id: { in: ids("leadIds") }, contactId: plan.survivorEntityId }, data: { contactId: plan.sourceEntityId, updatedByActorId: context.actorId } });
        await transaction.leadFormSubmission.updateMany({ where: { workspaceId: context.workspaceId, id: { in: ids("submissionIds") }, contactId: plan.survivorEntityId }, data: { contactId: plan.sourceEntityId } });
        await transaction.contact.update({ where: { id: plan.survivorEntityId }, data: { preferredName: String(survivorSnapshot.preferredName), legalName: toDisplay(survivorSnapshot.legalName), jobTitle: toDisplay(survivorSnapshot.jobTitle), timeZone: toDisplay(survivorSnapshot.timeZone), locale: String(survivorSnapshot.locale), updatedByActorId: context.actorId } });
        await transaction.contact.update({ where: { id: plan.sourceEntityId }, data: { status: String(sourceSnapshot.status) as "ACTIVE" | "INACTIVE" | "MERGED", mergedIntoContactId: toDisplay(sourceSnapshot.mergedIntoContactId), updatedByActorId: context.actorId } });
      } else {
        await transaction.lead.updateMany({ where: { workspaceId: context.workspaceId, id: { in: ids("leadIds") }, accountId: plan.survivorEntityId }, data: { accountId: plan.sourceEntityId, updatedByActorId: context.actorId } });
        await transaction.opportunity.updateMany({ where: { workspaceId: context.workspaceId, id: { in: ids("opportunityIds") }, accountId: plan.survivorEntityId }, data: { accountId: plan.sourceEntityId, revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await transaction.account.update({ where: { id: plan.survivorEntityId }, data: { name: String(survivorSnapshot.name), normalizedName: String(survivorSnapshot.normalizedName), legalName: toDisplay(survivorSnapshot.legalName), originalDocument: toDisplay(survivorSnapshot.originalDocument), normalizedDocument: toDisplay(survivorSnapshot.normalizedDocument), originalDomain: toDisplay(survivorSnapshot.originalDomain), normalizedDomain: toDisplay(survivorSnapshot.normalizedDomain), segment: String(survivorSnapshot.segment) as "PUBLIC_SECTOR" | "POLITICAL" | "PRIVATE_SECTOR" | "NONPROFIT" | "OTHER" | "UNKNOWN", size: String(survivorSnapshot.size) as "SOLO" | "SMALL" | "MEDIUM" | "LARGE" | "ENTERPRISE" | "UNKNOWN", revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await transaction.account.update({ where: { id: plan.sourceEntityId }, data: { status: String(sourceSnapshot.status) as "ACTIVE" | "INACTIVE" | "MERGED", mergedIntoAccountId: toDisplay(sourceSnapshot.mergedIntoAccountId), revision: { increment: 1 }, updatedByActorId: context.actorId } });
      }
      const [sourceAfter, survivorAfter] = await Promise.all([currentEntity(transaction, context.workspaceId, plan.entityType, plan.sourceEntityId), currentEntity(transaction, context.workspaceId, plan.entityType, plan.survivorEntityId)]);
      const execution = await transaction.mergeExecution.create({ data: { id: randomUUID(), workspaceId: context.workspaceId, mergePlanId: plan.id, type: "ROLLBACK", idempotencyKey: parsed.data.idempotencyKey, sourceSnapshot: json(source), survivorSnapshot: json(survivor), relationLedger: json(applied.relationLedger), preconditionFingerprint: applied.resultFingerprint, resultFingerprint: fingerprint({ source: sourceAfter, survivor: survivorAfter }), actorId: context.actorId, reason: parsed.data.reason } });
      await transaction.mergePlan.update({ where: { id: plan.id }, data: { status: "REVERSED", reversedAt: options.now(), reversedByActorId: context.actorId, revision: { increment: 1 } } });
      if (plan.candidateId) await transaction.duplicateCandidate.update({ where: { id: plan.candidateId }, data: { status: "OPEN", decisionReason: "Merge revertido; candidato reaberto para revisão.", decidedAt: null, decidedByActorId: null, revision: { increment: 1 } } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "data_quality.merge.reversed", entityType: "MergePlan", entityId: plan.id, origin: "DOMAIN", reason: parsed.data.reason, changes: json({ restoredRelationIds: Object.fromEntries(Object.entries(ledger).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0])) }) } });
      return execution;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async function getScreen(context: AuthenticatedContext, input: unknown) {
    const parsed = dataQualityQuerySchema.safeParse(input);
    if (!parsed.success) invalid("Filtros de qualidade inválidos.");
    const read = await permission(context, PermissionKeys.DATA_QUALITY_READ, resource(context.workspaceId, undefined, context.memberId));
    if (!read.allowed) await assert(context, PermissionKeys.DATA_QUALITY_READ, resource(context.workspaceId, undefined, context.memberId));
    const where: Prisma.DataQualityIssueWhereInput = { workspaceId: context.workspaceId, ...(parsed.data.status === "ALL" ? {} : { status: parsed.data.status }), ...(parsed.data.severity === "ALL" ? {} : { severity: parsed.data.severity }), ...(parsed.data.entityType === "ALL" ? {} : { entityType: parsed.data.entityType }), ...(read.allowed && read.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) };
    const [issues, total, rules, candidates, reconciliations, plans, latestScan, counts, canManage, canMerge, canRollback] = await Promise.all([
      options.database.dataQualityIssue.findMany({ where, orderBy: [{ priority: "desc" }, { detectedAt: "asc" }], skip: (parsed.data.page - 1) * parsed.data.pageSize, take: parsed.data.pageSize }),
      options.database.dataQualityIssue.count({ where }),
      options.database.dataQualityRuleVersion.findMany({ where: { workspaceId: context.workspaceId }, orderBy: [{ key: "asc" }, { version: "desc" }] }),
      options.database.duplicateCandidate.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "MERGE_PLANNED"] } }, orderBy: [{ strength: "asc" }, { detectedAt: "asc" }], take: 25 }),
      options.database.dataReconciliationResult.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { asOf: "desc" }, take: 25 }),
      options.database.mergePlan.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { createdAt: "desc" }, take: 20 }),
      options.database.dataQualityScanRun.findFirst({ where: { workspaceId: context.workspaceId }, orderBy: { startedAt: "desc" } }),
      options.database.dataQualityIssue.groupBy({ by: ["status"], where: { workspaceId: context.workspaceId }, _count: true }),
      permission(context, PermissionKeys.DATA_QUALITY_MANAGE), permission(context, PermissionKeys.DATA_QUALITY_MERGE), permission(context, PermissionKeys.DATA_QUALITY_ROLLBACK),
    ]);
    const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
    return { generatedAt: options.now().toISOString(), timeZone, filters: parsed.data, total, issues: issues.map((issue) => ({ ...issue, detectedAt: issue.detectedAt.toISOString(), lastDetectedAt: issue.lastDetectedAt.toISOString(), dueAt: issue.dueAt?.toISOString() ?? null, resolvedAt: issue.resolvedAt?.toISOString() ?? null, createdAt: issue.createdAt.toISOString(), updatedAt: issue.updatedAt.toISOString(), rule: ruleMap.get(issue.ruleVersionId) ? { key: ruleMap.get(issue.ruleVersionId)!.key, version: ruleMap.get(issue.ruleVersionId)!.version, dimension: ruleMap.get(issue.ruleVersionId)!.dimension, remediation: ruleMap.get(issue.ruleVersionId)!.remediation } : null })), rules: rules.map((rule) => ({ ...rule, effectiveAt: rule.effectiveAt?.toISOString() ?? null, retiredAt: rule.retiredAt?.toISOString() ?? null, createdAt: rule.createdAt.toISOString() })), candidates: candidates.map((candidate) => ({ ...candidate, detectedAt: candidate.detectedAt.toISOString(), lastDetectedAt: candidate.lastDetectedAt.toISOString(), decidedAt: candidate.decidedAt?.toISOString() ?? null, createdAt: candidate.createdAt.toISOString(), updatedAt: candidate.updatedAt.toISOString() })), reconciliations: reconciliations.map((item) => ({ ...item, observedAt: item.observedAt.toISOString(), asOf: item.asOf.toISOString(), createdAt: item.createdAt.toISOString() })), plans: plans.map((plan) => ({ ...plan, appliedAt: plan.appliedAt?.toISOString() ?? null, reversedAt: plan.reversedAt?.toISOString() ?? null, createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString() })), latestScan: latestScan ? { ...latestScan, startedAt: latestScan.startedAt.toISOString(), finishedAt: latestScan.finishedAt?.toISOString() ?? null, createdAt: latestScan.createdAt.toISOString() } : null, counts: Object.fromEntries(counts.map((row) => [row.status, row._count])), permissions: { manage: canManage.allowed, merge: canMerge.allowed, rollback: canRollback.allowed, resolve: (await permission(context, PermissionKeys.DATA_QUALITY_RESOLVE, resource(context.workspaceId, undefined, context.memberId))).allowed } };
  }

  return Object.freeze({ getScreen, runScan, issueAction, decideCandidate, buildPreview, createMergePlan, applyMerge, rollbackMerge });
}

let singleton: ReturnType<typeof createDataQualityService> | undefined;
export function getDataQualityService() {
  singleton ??= createDataQualityService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
