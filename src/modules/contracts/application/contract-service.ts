import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  canonicalContractJson,
  contractActionSchema,
  contractListQuerySchema,
  createContractInputSchema,
  escapeHtml,
  resolveTemplate,
  sha256,
} from "@/modules/contracts/domain/contract-contracts";
import type { ContractScreen, ContractScreenItem } from "@/modules/contracts/domain/contract-shared-contracts";
import type { AuthorizationDecision, ResourceScope } from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";

type AuthorizationPort = Readonly<{
  authorize(context: AuthenticatedContext, permission: PermissionKey, resource: ResourceScope): Promise<AuthorizationDecision>;
  assertAuthorized(context: AuthenticatedContext, permission: PermissionKey, resource: ResourceScope): Promise<void>;
}>;

type Options = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

function fail(message: string, code = "INVALID_CONTRACT_OPERATION", statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function resource(workspaceId: string, id?: string, ownerMemberId?: string | null): ResourceScope {
  return {
    workspaceId,
    resourceType: "CommercialContract",
    ...(id === undefined ? {} : { resourceId: id }),
    ...(ownerMemberId === undefined ? {} : { ownerMemberId }),
  };
}

function brl(cents: bigint): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents) / 100);
}

async function nextContractNumber(transaction: Prisma.TransactionClient, workspaceId: string, now: Date) {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract-number:${workspaceId}`}, 0))`;
  const rows = await transaction.$queryRaw<readonly { allocated: bigint }[]>`
    INSERT INTO contract_number_sequences ("workspaceId", "nextValue", "updatedAt")
    VALUES (${workspaceId}::uuid, 2, NOW())
    ON CONFLICT ("workspaceId") DO UPDATE
    SET "nextValue" = contract_number_sequences."nextValue" + 1, "updatedAt" = NOW()
    RETURNING "nextValue" - 1 AS allocated
  `;
  const allocated = rows[0]?.allocated;
  if (allocated === undefined) fail("Não foi possível reservar a numeração contratual.", "CONTRACT_NUMBER_FAILED", 500);
  return `CTR-${now.getUTCFullYear()}-${allocated.toString().padStart(6, "0")}`;
}

async function permission(
  authorization: AuthorizationPort,
  context: AuthenticatedContext,
  key: PermissionKey,
  contractResource: ResourceScope,
) {
  return (await authorization.authorize(context, key, contractResource)).allowed;
}

function contractHtml(input: Readonly<{
  contractNumber: string;
  title: string;
  introduction: string;
  accountName: string;
  contactName: string;
  clauses: readonly Readonly<{ title: string; body: string }>[];
  lines: readonly Readonly<{ product: string; offer: string; quantity: number; totalCents: bigint }>[];
  totalCents: bigint;
  paymentTerms: string;
}>) {
  const lineRows = input.lines.map((line) => `<tr><td>${escapeHtml(line.product)}</td><td>${escapeHtml(line.offer)}</td><td>${line.quantity}</td><td>${escapeHtml(brl(line.totalCents))}</td></tr>`).join("");
  const clauses = input.clauses.map((clause) => `<section><h2>${escapeHtml(clause.title)}</h2><p>${escapeHtml(clause.body)}</p></section>`).join("");
  return `<p class="meta">${escapeHtml(input.contractNumber)} · versão emitida localmente</p><h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.introduction)}</p><p><strong>Contratante:</strong> ${escapeHtml(input.accountName)}<br><strong>Contato:</strong> ${escapeHtml(input.contactName)}</p><table><thead><tr><th>Produto</th><th>Oferta</th><th>Qtd.</th><th>Total</th></tr></thead><tbody>${lineRows}</tbody></table><p class="total">Total: ${escapeHtml(brl(input.totalCents))}</p><p><strong>Condições de pagamento:</strong> ${escapeHtml(input.paymentTerms)}</p>${clauses}<hr><p class="meta">Documento para demonstração local. Não possui assinatura eletrônica nem substitui revisão jurídica.</p>`;
}

export function createContractService(options: Options) {
  async function getScreen(context: AuthenticatedContext, rawQuery: unknown): Promise<ContractScreen> {
    const query = contractListQuerySchema.parse(rawQuery ?? {});
    await options.authorization.assertAuthorized(context, PermissionKeys.CONTRACTS_READ, { ...resource(context.workspaceId), memberId: context.memberId });

    const rows = await options.database.commercialContract.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(query.status === "ALL" ? {} : { status: query.status }),
        ...(query.search ? { contractNumber: { contains: query.search, mode: "insensitive" } } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { contractNumber: "asc" }],
    });
    const visible: typeof rows = [];
    for (const row of rows) {
      if ((await options.authorization.authorize(context, PermissionKeys.CONTRACTS_READ, resource(context.workspaceId, row.id, row.ownerMemberId))).allowed) visible.push(row);
    }

    const ids = visible.map((item) => item.id);
    const opportunityIds = visible.map((item) => item.opportunityId);
    const accountIds = visible.map((item) => item.accountId);
    const contactIds = visible.map((item) => item.primaryContactId);
    const memberIds = visible.map((item) => item.ownerMemberId);
    const allContractOpportunityIds = (await options.database.commercialContract.findMany({ where: { workspaceId: context.workspaceId }, select: { opportunityId: true } })).map((item) => item.opportunityId);
    const [versions, versionCounts, opportunities, accounts, contacts, members, templates, templateVersions, allEligible] = await Promise.all([
      options.database.contractVersion.findMany({ where: { workspaceId: context.workspaceId, id: { in: visible.flatMap((item) => item.currentVersionId ? [item.currentVersionId] : []) } } }),
      options.database.contractVersion.groupBy({ by: ["contractId"], where: { workspaceId: context.workspaceId, contractId: { in: ids } }, _count: { _all: true } }),
      options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, id: { in: opportunityIds } }, select: { id: true, name: true } }),
      options.database.account.findMany({ where: { workspaceId: context.workspaceId, id: { in: accountIds } }, select: { id: true, name: true } }),
      options.database.contact.findMany({ where: { workspaceId: context.workspaceId, id: { in: contactIds } }, select: { id: true, preferredName: true } }),
      options.database.workspaceMember.findMany({ where: { workspaceId: context.workspaceId, id: { in: memberIds } }, select: { id: true, user: { select: { displayName: true } } } }),
      options.database.contractTemplate.findMany({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null } }),
      options.database.contractTemplateVersion.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { version: "desc" } }),
      options.database.opportunity.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null, accountId: { not: null }, lead: { contactId: { not: null }, deletedAt: null }, offers: { some: { deletedAt: null } }, NOT: { id: { in: allContractOpportunityIds } } },
        include: { account: true, lead: { include: { contact: true } }, offers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 }, owner: true },
        orderBy: { updatedAt: "desc" }, take: 100,
      }),
    ]);

    const versionById = new Map(versions.map((item) => [item.id, item]));
    const countByContract = new Map(versionCounts.map((item) => [item.contractId, item._count._all]));
    const opportunityById = new Map(opportunities.map((item) => [item.id, item]));
    const accountById = new Map(accounts.map((item) => [item.id, item]));
    const contactById = new Map(contacts.map((item) => [item.id, item]));
    const memberById = new Map(members.map((item) => [item.id, item]));

    const items: ContractScreenItem[] = [];
    for (const row of visible) {
      const version = row.currentVersionId ? versionById.get(row.currentVersionId) : null;
      const contractResource = resource(context.workspaceId, row.id, row.ownerMemberId);
      const reconciliation: string[] = [];
      if (!version) reconciliation.push("Versão atual ausente");
      if (version && version.contractId !== row.id) reconciliation.push("Versão atual pertence a outro contrato");
      if (version && version.state !== "DRAFT" && (!version.renderedHtml || !version.contentHash)) reconciliation.push("Versão emitida sem evidência reproduzível");
      items.push({
        id: row.id,
        contractNumber: row.contractNumber,
        opportunityId: row.opportunityId,
        opportunityName: opportunityById.get(row.opportunityId)?.name ?? "Oportunidade indisponível",
        accountName: accountById.get(row.accountId)?.name ?? "Conta indisponível",
        contactName: contactById.get(row.primaryContactId)?.preferredName ?? "Contato indisponível",
        ownerName: memberById.get(row.ownerMemberId)?.user.displayName ?? "Responsável indisponível",
        status: row.status,
        revision: row.revision,
        currentVersion: version ? { id: version.id, versionNumber: version.versionNumber, state: version.state, totalCents: version.totalCents.toString(), mrrCents: version.mrrCents.toString(), tcvCents: version.tcvCents.toString(), proposedStartsAt: version.proposedStartsAt?.toISOString() ?? null, proposedEndsAt: version.proposedEndsAt?.toISOString() ?? null, contentHash: version.contentHash, renderedHtml: version.renderedHtml } : null,
        versionCount: countByContract.get(row.id) ?? 0,
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        effectiveStartsAt: row.effectiveStartsAt?.toISOString() ?? null,
        effectiveEndsAt: row.effectiveEndsAt?.toISOString() ?? null,
        reconciliation,
        canIssue: await permission(options.authorization, context, PermissionKeys.CONTRACTS_ISSUE, contractResource),
        canSendSimulate: await permission(options.authorization, context, PermissionKeys.CONTRACTS_SEND_SIMULATE, contractResource),
        canAccept: await permission(options.authorization, context, PermissionKeys.CONTRACTS_ACCEPT_RECORD, contractResource),
        canReject: await permission(options.authorization, context, PermissionKeys.CONTRACTS_REJECT, contractResource),
        canVoid: await permission(options.authorization, context, PermissionKeys.CONTRACTS_VOID, contractResource),
        canVersion: await permission(options.authorization, context, PermissionKeys.CONTRACTS_VERSION_CREATE, contractResource),
      });
    }

    const canCreate = await permission(options.authorization, context, PermissionKeys.CONTRACTS_CREATE, resource(context.workspaceId, undefined, context.memberId));
    const eligibleOpportunities = [];
    if (canCreate) {
      for (const item of allEligible) {
        if (!(await permission(options.authorization, context, PermissionKeys.CONTRACTS_CREATE, resource(context.workspaceId, item.id, item.ownerMemberId)))) continue;
        const offer = item.offers[0];
        if (offer && item.account && item.lead.contact) eligibleOpportunities.push({ id: item.id, name: item.name, accountName: item.account.name, contactName: item.lead.contact.preferredName, offerId: offer.id, offerName: offer.name, totalCents: offer.totalCents.toString() });
      }
    }
    const templateById = new Map(templates.map((item) => [item.id, item]));
    const templateOptions = templateVersions.filter((version) => templateById.has(version.templateId) && templateById.get(version.templateId)?.currentVersion === version.version).map((version) => ({ id: version.id, name: templateById.get(version.templateId)?.name ?? "Template", version: version.version, legalReviewState: templateById.get(version.templateId)?.legalReviewState ?? "PENDING_LEGAL" }));
    const now = options.now();
    const decided = items.filter((item) => ["ACCEPTED", "REJECTED"].includes(item.status)).length;
    return {
      generatedAt: now.toISOString(), timeZone: "America/Sao_Paulo", filters: query,
      metrics: {
        drafts: items.filter((item) => ["DRAFT", "INTERNAL_REVIEW"].includes(item.status)).length,
        awaitingAcceptance: items.filter((item) => ["READY_TO_SEND", "SENT_SIMULATED"].includes(item.status)).length,
        accepted: items.filter((item) => item.status === "ACCEPTED").length,
        expiringSoon: items.filter((item) => item.effectiveEndsAt && new Date(item.effectiveEndsAt) >= now && new Date(item.effectiveEndsAt).getTime() <= now.getTime() + 30 * 86_400_000).length,
        divergences: items.filter((item) => item.reconciliation.length > 0).length,
        acceptanceRate: decided ? items.filter((item) => item.status === "ACCEPTED").length / decided : null,
        averageVersions: items.length ? items.reduce((sum, item) => sum + item.versionCount, 0) / items.length : null,
      },
      canCreate, eligibleOpportunities, templateVersions: templateOptions, items,
    };
  }

  async function create(context: AuthenticatedContext, rawInput: unknown) {
    const input = createContractInputSchema.parse(rawInput);
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract:${context.workspaceId}:${input.opportunityId}`}, 0))`;
      const existingEvent = await transaction.contractEvent.findFirst({ where: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } });
      if (existingEvent) return { contractId: existingEvent.contractId, replayed: true };
      const opportunity = await transaction.opportunity.findFirst({
        where: { id: input.opportunityId, workspaceId: context.workspaceId, deletedAt: null },
        include: { account: true, lead: { include: { contact: { include: { points: { where: { deletedAt: null }, orderBy: { isPrimary: "desc" } } } } } }, offers: { where: { id: input.offerId, deletedAt: null }, include: { product: true, offerTemplate: true, lines: { orderBy: { position: "asc" } } } } },
      });
      if (!opportunity) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
      await options.authorization.assertAuthorized(context, PermissionKeys.CONTRACTS_CREATE, resource(context.workspaceId, opportunity.id, opportunity.ownerMemberId));
      if (!opportunity.account || !opportunity.lead.contact) fail("Contrato exige conta e contato canônicos vinculados à oportunidade.");
      const offer = opportunity.offers[0];
      if (!offer) fail("A oferta selecionada não pertence à oportunidade.");
      const existing = await transaction.commercialContract.findFirst({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id } });
      if (existing) fail("A oportunidade já possui contrato comercial.", "CONTRACT_ALREADY_EXISTS");
      if (offer.totalCents === 0n && !input.zeroValueJustification) fail("Valor total zero exige justificativa explícita.");
      if (input.proposedStartsAt && input.proposedEndsAt && new Date(input.proposedEndsAt) < new Date(input.proposedStartsAt)) fail("A data final deve ser posterior à data inicial.");
      const templateVersion = await transaction.contractTemplateVersion.findFirst({ where: { id: input.templateVersionId, workspaceId: context.workspaceId }, });
      if (!templateVersion) fail("Versão de template não encontrada.", "NOT_FOUND", 404);
      const template = await transaction.contractTemplate.findFirst({ where: { id: templateVersion.templateId, workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null } });
      if (!template) fail("O template não está ativo.");
      const clauses = await transaction.contractTemplateClause.findMany({ where: { workspaceId: context.workspaceId, templateVersionId: templateVersion.id }, orderBy: { position: "asc" } });
      const contactEmail = opportunity.lead.contact.points.find((point) => point.type === "EMAIL")?.normalizedValue ?? null;
      const contactPhone = opportunity.lead.contact.points.find((point) => point.type === "PHONE")?.normalizedValue ?? null;
      const now = options.now();
      const offerLines = offer.lines.length ? offer.lines : [{ position: 1, productId: offer.productId, productVersionSnapshot: offer.product.version, productSkuSnapshot: offer.product.sku, productNameSnapshot: offer.product.name, productKindSnapshot: offer.product.kind, revenueCategorySnapshot: offer.product.revenueCategory, approvedConditionsSnapshot: offer.product.approvedConditions, quantity: offer.quantity, unitPriceCents: offer.unitPriceCents, discountCents: offer.discountCents, totalCents: offer.totalCents, currency: offer.currency }];
      const subtotalCents = offerLines.reduce((sum, line) => sum + line.unitPriceCents * BigInt(line.quantity), 0n);
      const discountCents = offerLines.reduce((sum, line) => sum + line.discountCents, 0n);
      const number = await nextContractNumber(transaction, context.workspaceId, now);
      const contract = await transaction.commercialContract.create({ data: { workspaceId: context.workspaceId, contractNumber: number, opportunityId: opportunity.id, accountId: opportunity.account.id, primaryContactId: opportunity.lead.contact.id, ownerMemberId: opportunity.ownerMemberId, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      const values = { contractNumber: number, accountName: opportunity.account.name, contactName: opportunity.lead.contact.preferredName, opportunityName: opportunity.name, total: brl(offer.totalCents) };
      const version = await transaction.contractVersion.create({ data: {
        workspaceId: context.workspaceId, contractId: contract.id, versionNumber: 1, sourceOfferId: offer.id, templateVersionId: templateVersion.id,
        templateNameSnapshot: template.name, templateVersionSnapshot: templateVersion.version, opportunityNameSnapshot: opportunity.name,
        accountNameSnapshot: opportunity.account.name, accountLegalNameSnapshot: opportunity.account.legalName, accountDocumentSnapshot: opportunity.account.originalDocument,
        contactNameSnapshot: opportunity.lead.contact.preferredName, contactRoleSnapshot: opportunity.lead.contact.jobTitle, contactEmailSnapshot: contactEmail, contactPhoneSnapshot: contactPhone,
        subtotalCents, discountCents, totalCents: offer.totalCents,
        mrrCents: opportunity.mrrCents, tcvCents: opportunity.tcvCents, billingFrequency: input.billingFrequency, durationMonths: input.durationMonths ?? null,
        proposedStartsAt: input.proposedStartsAt ? new Date(input.proposedStartsAt) : null, proposedEndsAt: input.proposedEndsAt ? new Date(input.proposedEndsAt) : null,
        renewalExpected: input.renewalExpected, paymentTerms: input.paymentTerms, commercialNotes: input.commercialNotes ?? null, zeroValueJustification: input.zeroValueJustification ?? null,
        createdByActorId: context.actorId,
      } });
      await transaction.contractLineSnapshot.createMany({ data: offerLines.map((line) => ({ workspaceId: context.workspaceId, contractVersionId: version.id, position: line.position, sourceOfferId: offer.id, sourceOfferTemplateId: offer.offerTemplateId, productId: line.productId, productSkuSnapshot: line.productSkuSnapshot, productNameSnapshot: line.productNameSnapshot, productVersionSnapshot: line.productVersionSnapshot, productKindSnapshot: line.productKindSnapshot, revenueCategorySnapshot: line.revenueCategorySnapshot, approvedConditionsSnapshot: line.approvedConditionsSnapshot, offerNameSnapshot: offer.name, quantity: line.quantity, unitPriceCents: line.unitPriceCents, discountCents: line.discountCents, totalCents: line.totalCents, currency: line.currency })) });
      for (const clause of clauses) await transaction.contractClauseSnapshot.create({ data: { workspaceId: context.workspaceId, contractVersionId: version.id, position: clause.position, key: clause.key, title: resolveTemplate(clause.titleTemplate, values), body: resolveTemplate(clause.bodyTemplate, values) } });
      await transaction.commercialContract.update({ where: { id: contract.id }, data: { currentVersionId: version.id } });
      await transaction.contractEvent.create({ data: { workspaceId: context.workspaceId, contractId: contract.id, contractVersionId: version.id, eventType: "CREATED", toStatus: "DRAFT", idempotencyKey: input.idempotencyKey, actorId: context.actorId, occurredAt: now, safeMetadata: { templateVersion: templateVersion.version, sourceOfferId: offer.id } } });
      await transaction.activity.create({ data: { workspaceId: context.workspaceId, leadId: opportunity.leadId, opportunityId: opportunity.id, type: "PROPOSAL", direction: "INTERNAL", subject: `Contrato ${number} criado em rascunho`, description: "Snapshot comercial criado sem envio externo.", occurredAt: now, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "contract.created", entityType: "CommercialContract", entityId: contract.id, reason: "Criação manual a partir de oportunidade e oferta existentes", changes: { status: "DRAFT", version: 1, totalCents: offer.totalCents.toString() }, metadata: { opportunityId: opportunity.id, offerId: offer.id } } });
      return { contractId: contract.id, versionId: version.id, contractNumber: number, replayed: false };
    }, { isolationLevel: "Serializable" });
  }

  async function act(context: AuthenticatedContext, contractId: string, rawInput: unknown) {
    const input = contractActionSchema.parse(rawInput);
    return options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract:${context.workspaceId}:${contractId}`}, 0))`;
      const replay = await transaction.contractEvent.findFirst({ where: { workspaceId: context.workspaceId, idempotencyKey: input.idempotencyKey } });
      if (replay) return { contractId: replay.contractId, replayed: true };
      const contract = await transaction.commercialContract.findFirst({ where: { id: contractId, workspaceId: context.workspaceId } });
      if (!contract) fail("Contrato não encontrado.", "NOT_FOUND", 404);
      if (contract.revision !== input.expectedRevision) fail("O contrato foi alterado por outra pessoa. Atualize a página.", "STALE_CONTRACT");
      if (!contract.currentVersionId) fail("Contrato sem versão atual.");
      const version = await transaction.contractVersion.findFirst({ where: { id: contract.currentVersionId, workspaceId: context.workspaceId, contractId } });
      if (!version) fail("Versão atual indisponível.");
      const permissionByAction: Record<typeof input.action, PermissionKey> = {
        REQUEST_REVIEW: PermissionKeys.CONTRACTS_DRAFT_WRITE, MARK_READY: PermissionKeys.CONTRACTS_DRAFT_WRITE,
        ISSUE: PermissionKeys.CONTRACTS_ISSUE, SEND_SIMULATED: PermissionKeys.CONTRACTS_SEND_SIMULATE,
        ACCEPT_LOCAL: PermissionKeys.CONTRACTS_ACCEPT_RECORD, REJECT: PermissionKeys.CONTRACTS_REJECT,
        VOID: PermissionKeys.CONTRACTS_VOID, CREATE_VERSION: PermissionKeys.CONTRACTS_VERSION_CREATE, EXPIRE: PermissionKeys.CONTRACTS_VOID,
      };
      await options.authorization.assertAuthorized(context, permissionByAction[input.action], resource(context.workspaceId, contract.id, contract.ownerMemberId));
      const now = options.now();
      let toStatus = contract.status;
      let eventType: Prisma.ContractEventCreateInput["eventType"] = "DRAFT_REVISED";
      let reason: string | null = "reason" in input ? input.reason : null;
      let eventExtra: {
        acceptedByName?: string;
        acceptedByRole?: string;
        acceptanceMethod?: string;
        evidenceText?: string;
        evidenceHash?: string;
        effectiveStartsAt?: Date;
        effectiveEndsAt?: Date | null;
      } = {};
      if (input.action === "REQUEST_REVIEW") { if (contract.status !== "DRAFT") fail("Somente rascunhos podem seguir para revisão interna."); toStatus = "INTERNAL_REVIEW"; eventType = "INTERNAL_REVIEW_REQUESTED"; }
      else if (input.action === "MARK_READY") { if (contract.status !== "INTERNAL_REVIEW") fail("A revisão interna deve ocorrer antes de marcar como pronto."); toStatus = "READY_TO_SEND"; eventType = "READY_TO_SEND"; }
      else if (input.action === "ISSUE") {
        if (contract.status !== "READY_TO_SEND" || version.state !== "DRAFT") fail("Somente uma versão em rascunho pronta para envio pode ser emitida.");
        const [lines, clauses] = await Promise.all([
          transaction.contractLineSnapshot.findMany({ where: { workspaceId: context.workspaceId, contractVersionId: version.id }, orderBy: { position: "asc" } }),
          transaction.contractClauseSnapshot.findMany({ where: { workspaceId: context.workspaceId, contractVersionId: version.id }, orderBy: { position: "asc" } }),
        ]);
        const templateVersion = version.templateVersionId ? await transaction.contractTemplateVersion.findFirst({ where: { id: version.templateVersionId, workspaceId: context.workspaceId } }) : null;
        if (!templateVersion || lines.length === 0 || clauses.length === 0) fail("A versão precisa de template, itens e cláusulas antes da emissão.");
        const html = contractHtml({ contractNumber: contract.contractNumber, title: resolveTemplate(templateVersion.titleTemplate, { contractNumber: contract.contractNumber, accountName: version.accountNameSnapshot, contactName: version.contactNameSnapshot, opportunityName: version.opportunityNameSnapshot, total: brl(version.totalCents) }), introduction: resolveTemplate(templateVersion.introduction, { contractNumber: contract.contractNumber, accountName: version.accountNameSnapshot, contactName: version.contactNameSnapshot, opportunityName: version.opportunityNameSnapshot, total: brl(version.totalCents) }), accountName: version.accountNameSnapshot, contactName: version.contactNameSnapshot, clauses, lines: lines.map((line) => ({ product: line.productNameSnapshot, offer: line.offerNameSnapshot, quantity: line.quantity, totalCents: line.totalCents })), totalCents: version.totalCents, paymentTerms: version.paymentTerms });
        const hash = sha256(canonicalContractJson({ contractId, versionNumber: version.versionNumber, html, lines, clauses }));
        await transaction.contractVersion.update({ where: { id: version.id }, data: { state: "ISSUED", renderedHtml: html, contentHash: hash, issuedAt: now, issuedByActorId: context.actorId } });
        eventType = "VERSION_CREATED"; reason = "Versão emitida e congelada";
      }
      else if (input.action === "SEND_SIMULATED") { if (contract.status !== "READY_TO_SEND" || version.state !== "ISSUED") fail("Emita a versão antes de registrar o envio simulado."); toStatus = "SENT_SIMULATED"; eventType = "SENT_SIMULATED"; reason = "Envio local simulado; nenhum provedor externo foi chamado"; }
      else if (input.action === "ACCEPT_LOCAL") { if (contract.status !== "SENT_SIMULATED" && !(contract.status === "READY_TO_SEND" && version.state === "ISSUED")) fail("O aceite manual exige versão emitida e pronta para envio ou já enviada."); const start = new Date(input.effectiveStartsAt); const end = input.effectiveEndsAt ? new Date(input.effectiveEndsAt) : null; if (end && end < start) fail("A vigência final deve ser posterior à inicial."); toStatus = "ACCEPTED"; eventType = "ACCEPTED_LOCAL_MANUAL"; reason = input.evidenceText; eventExtra = { acceptedByName: input.acceptedByName, acceptedByRole: input.acceptedByRole, acceptanceMethod: "LOCAL_MANUAL", evidenceText: input.evidenceText, evidenceHash: sha256(input.evidenceText), effectiveStartsAt: start, effectiveEndsAt: end }; }
      else if (input.action === "REJECT") { if (contract.status !== "SENT_SIMULATED") fail("Somente contrato enviado pode ser rejeitado."); toStatus = "REJECTED"; eventType = "REJECTED"; }
      else if (input.action === "VOID") { if (contract.status === "VOIDED") fail("Contrato já anulado."); toStatus = "VOIDED"; eventType = "VOIDED"; }
      else if (input.action === "EXPIRE") { if (!contract.effectiveEndsAt || contract.effectiveEndsAt > now) fail("O contrato ainda não atingiu a data final de vigência."); toStatus = "EXPIRED"; eventType = "EXPIRED"; }
      else if (input.action === "CREATE_VERSION") {
        if (version.state === "DRAFT") fail("A versão atual ainda é editável; não crie uma cópia redundante.");
        const [lines, clauses] = await Promise.all([transaction.contractLineSnapshot.findMany({ where: { workspaceId: context.workspaceId, contractVersionId: version.id } }), transaction.contractClauseSnapshot.findMany({ where: { workspaceId: context.workspaceId, contractVersionId: version.id } })]);
        await transaction.contractVersion.update({ where: { id: version.id }, data: { state: "SUPERSEDED" } });
        const replacement = await transaction.contractVersion.create({ data: { workspaceId: context.workspaceId, contractId, versionNumber: version.versionNumber + 1, state: "DRAFT", sourceOfferId: version.sourceOfferId, templateVersionId: version.templateVersionId, templateNameSnapshot: version.templateNameSnapshot, templateVersionSnapshot: version.templateVersionSnapshot, opportunityNameSnapshot: version.opportunityNameSnapshot, accountNameSnapshot: version.accountNameSnapshot, accountLegalNameSnapshot: version.accountLegalNameSnapshot, accountDocumentSnapshot: version.accountDocumentSnapshot, contactNameSnapshot: version.contactNameSnapshot, contactRoleSnapshot: version.contactRoleSnapshot, contactEmailSnapshot: version.contactEmailSnapshot, contactPhoneSnapshot: version.contactPhoneSnapshot, currency: version.currency, subtotalCents: version.subtotalCents, discountCents: version.discountCents, totalCents: version.totalCents, mrrCents: version.mrrCents, tcvCents: version.tcvCents, billingFrequency: version.billingFrequency, durationMonths: version.durationMonths, proposedStartsAt: version.proposedStartsAt, proposedEndsAt: version.proposedEndsAt, renewalExpected: version.renewalExpected, paymentTerms: version.paymentTerms, commercialNotes: version.commercialNotes, zeroValueJustification: version.zeroValueJustification, createdByActorId: context.actorId } });
        for (const line of lines) await transaction.contractLineSnapshot.create({ data: { workspaceId: context.workspaceId, contractVersionId: replacement.id, position: line.position, sourceOfferId: line.sourceOfferId, sourceOfferTemplateId: line.sourceOfferTemplateId, productId: line.productId, productSkuSnapshot: line.productSkuSnapshot, productNameSnapshot: line.productNameSnapshot, productVersionSnapshot: line.productVersionSnapshot, productKindSnapshot: line.productKindSnapshot, revenueCategorySnapshot: line.revenueCategorySnapshot, approvedConditionsSnapshot: line.approvedConditionsSnapshot, offerNameSnapshot: line.offerNameSnapshot, quantity: line.quantity, unitPriceCents: line.unitPriceCents, discountCents: line.discountCents, totalCents: line.totalCents, currency: line.currency } });
        for (const clause of clauses) await transaction.contractClauseSnapshot.create({ data: { workspaceId: context.workspaceId, contractVersionId: replacement.id, position: clause.position, key: clause.key, title: clause.title, body: clause.body } });
        await transaction.commercialContract.update({ where: { id: contract.id }, data: { currentVersionId: replacement.id, status: "DRAFT", revision: { increment: 1 }, updatedByActorId: context.actorId } });
        await transaction.contractEvent.createMany({ data: [
          { workspaceId: context.workspaceId, contractId, contractVersionId: version.id, eventType: "VERSION_SUPERSEDED", fromStatus: contract.status, toStatus: "DRAFT", reason: input.reason, idempotencyKey: `${input.idempotencyKey}:superseded`, actorId: context.actorId, occurredAt: now },
          { workspaceId: context.workspaceId, contractId, contractVersionId: replacement.id, eventType: "VERSION_CREATED", fromStatus: contract.status, toStatus: "DRAFT", reason: input.reason, idempotencyKey: input.idempotencyKey, actorId: context.actorId, occurredAt: now },
        ] });
        await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "contract.version.created", entityType: "CommercialContract", entityId: contract.id, reason: input.reason, changes: { fromVersion: version.versionNumber, toVersion: replacement.versionNumber }, metadata: { immutablePreviousVersionId: version.id } } });
        return { contractId, versionId: replacement.id, status: "DRAFT", replayed: false };
      }

      const update = await transaction.commercialContract.updateMany({ where: { id: contract.id, workspaceId: context.workspaceId, revision: input.expectedRevision }, data: { status: toStatus, revision: { increment: 1 }, updatedByActorId: context.actorId, ...(input.action === "ACCEPT_LOCAL" ? { acceptedAt: now, effectiveStartsAt: new Date(input.effectiveStartsAt), effectiveEndsAt: input.effectiveEndsAt ? new Date(input.effectiveEndsAt) : null } : {}) } });
      if (update.count !== 1) fail("O contrato foi alterado em paralelo. Atualize a página.", "STALE_CONTRACT");
      const contractEvent = await transaction.contractEvent.create({ data: { workspaceId: context.workspaceId, contractId, contractVersionId: version.id, eventType, fromStatus: contract.status, toStatus, reason, idempotencyKey: input.idempotencyKey, actorId: context.actorId, occurredAt: now, ...eventExtra } });
      await transaction.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: `contract.${input.action.toLowerCase()}`, entityType: "CommercialContract", entityId: contract.id, reason, changes: { fromStatus: contract.status, toStatus, revision: input.expectedRevision + 1 }, metadata: { versionId: version.id, localOnly: true } } });
      const opportunity = await transaction.opportunity.findFirst({ where: { id: contract.opportunityId, workspaceId: context.workspaceId }, select: { leadId: true, ownerMemberId: true } });
      if (opportunity) await transaction.activity.create({ data: { workspaceId: context.workspaceId, leadId: opportunity.leadId, opportunityId: contract.opportunityId, type: "PROPOSAL", direction: "INTERNAL", subject: `Contrato ${contract.contractNumber}: ${input.action}`, description: reason, occurredAt: now, previousValues: { status: contract.status }, newValues: { status: toStatus }, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      if (input.action === "ACCEPT_LOCAL") {
        await recordCommercialMetricFactInTransaction(transaction, {
          workspaceId: context.workspaceId,
          eventKey: `contract-event:${contractEvent.id}:accepted:v1`,
          eventType: "CONTRACT_ACCEPTED",
          occurredAt: now,
          sourceEntityType: "ContractEvent",
          sourceEntityId: contractEvent.id,
          leadId: opportunity?.leadId ?? null,
          accountId: contract.accountId,
          opportunityId: contract.opportunityId,
          contractId: contract.id,
          creditedMemberId: contract.ownerMemberId,
          performedByMemberId: context.memberId,
          opportunityOwnerMemberIdAtEvent: opportunity?.ownerMemberId ?? contract.ownerMemberId,
          valueCents: version.totalCents,
          result: "ACCEPTED",
          executionMode: "MANUAL",
          safeMetadata: { mrrCents: version.mrrCents.toString(), tcvCents: version.tcvCents.toString(), contractVersionId: version.id },
        });
      }
      return { contractId, versionId: version.id, status: toStatus, replayed: false };
    }, { isolationLevel: "Serializable" });
  }

  async function getPrintableVersion(context: AuthenticatedContext, contractId: string) {
    const contract = await options.database.commercialContract.findFirst({ where: { id: contractId, workspaceId: context.workspaceId } });
    if (!contract) fail("Contrato não encontrado.", "NOT_FOUND", 404);
    await options.authorization.assertAuthorized(context, PermissionKeys.CONTRACTS_READ, resource(context.workspaceId, contract.id, contract.ownerMemberId));
    if (!contract.currentVersionId) fail("Contrato sem versão atual.");
    const version = await options.database.contractVersion.findFirst({ where: { id: contract.currentVersionId, workspaceId: context.workspaceId, contractId } });
    if (!version?.renderedHtml || !version.contentHash || version.state === "DRAFT") fail("Emita a versão antes de abrir a impressão.");
    const expectedHash = sha256(canonicalContractJson({ contractId, versionNumber: version.versionNumber, html: version.renderedHtml, lines: await options.database.contractLineSnapshot.findMany({ where: { workspaceId: context.workspaceId, contractVersionId: version.id }, orderBy: { position: "asc" } }), clauses: await options.database.contractClauseSnapshot.findMany({ where: { workspaceId: context.workspaceId, contractVersionId: version.id }, orderBy: { position: "asc" } }) }));
    if (expectedHash !== version.contentHash) fail("A versão emitida diverge do snapshot persistido.", "CONTRACT_HASH_MISMATCH", 500);
    return { contractNumber: contract.contractNumber, versionNumber: version.versionNumber, html: version.renderedHtml, contentHash: version.contentHash };
  }

  return Object.freeze({ getScreen, create, act, getPrintableVersion });
}

let singleton: ReturnType<typeof createContractService> | undefined;
export function getContractService() {
  singleton ??= createContractService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() });
  return singleton;
}
