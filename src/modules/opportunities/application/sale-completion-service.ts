import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAccountService, normalizeAccountName } from "@/modules/accounts/application/account-service";
import { createAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { isCatalogItemSellable } from "@/modules/catalog/domain/catalog-sellability-policy";
import { createContractService } from "@/modules/contracts/application/contract-service";
import { createLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import { projectOpportunityOwnership } from "@/modules/lifecycle/application/lifecycle-projection-writer";
import { recordCommercialMetricFactInTransaction } from "@/modules/metrics/application/commercial-metric-fact-writer";
import { createOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { assertOriginCapability, createOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { assertConsultativeSalesGates, assertRequiredStageActivitiesComplete } from "@/modules/opportunities/application/sales-gate-service";
import { assertPipelineRequiredFields } from "@/modules/pipeline-templates/application/opportunity-required-fields";
import { executeSaleCompletionSchema, prepareLeadSaleSchema, saleCompletionSchema, saleMonth, salePaymentMethods, saleSchedule, type SaleCompletionInput } from "@/modules/opportunities/domain/sale-completion-contracts";
import { createPaymentService } from "@/modules/payments/application/payment-service";
import { syncActiveProspectingCommercialStageInTransaction } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { createRevenueService } from "@/modules/revenue/application/revenue-service";
import { commercialMemberWhere } from "@/modules/users/application/commercial-member-eligibility";
import { createAuthorizationService, type AuthorizationDecision, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

function fail(message: string, code = "SALE_NOT_READY", statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

// Existing domain services retain their authorization and invariants, while all
// their transaction callbacks participate in this one atomic sale operation.
function transactionDatabase(tx: Prisma.TransactionClient): PrismaClient {
  return new Proxy(tx, {
    get(target, property) {
      if (property === "$transaction") return async (operation: (client: Prisma.TransactionClient) => Promise<unknown>) => {
        if (typeof operation !== "function") throw new Error("Sale orchestration requires an interactive transaction.");
        return operation(tx);
      };
      return Reflect.get(target, property);
    },
  }) as PrismaClient;
}

export function createSaleCompletionService(options: { database: PrismaClient; now: () => Date }) {
  async function ownSalesOnly(authorization: ReturnType<typeof createAuthorizationService>, context: AuthenticatedContext) {
    const decision = await authorization.authorize(context, PermissionKeys.SALES_COMPLETE, {
      workspaceId: context.workspaceId, resourceType: "Opportunity", ownerMemberId: context.memberId,
    });
    return decision.allowed && decision.scope === "OWN";
  }

  // Capability local ao fechamento já autorizado. Nunca é usada nas APIs gerais
  // de clientes, contratos, receita ou pagamentos e não concede baixa financeira.
  function completionAuthorization(base: ReturnType<typeof createAuthorizationService>, context: AuthenticatedContext) {
    const delegated = new Set<PermissionKey>([
      PermissionKeys.ACCOUNTS_WRITE, PermissionKeys.CONTRACTS_CREATE,
      PermissionKeys.CONTRACTS_DRAFT_WRITE, PermissionKeys.CONTRACTS_ISSUE,
      PermissionKeys.CONTRACTS_ACCEPT_RECORD, PermissionKeys.REVENUE_MANAGE,
      PermissionKeys.REVENUE_EVENTS_RECORD, PermissionKeys.PAYMENTS_MANAGE,
    ]);
    async function authorize(caller: AuthenticatedContext, key: PermissionKey, resource: ResourceScope): Promise<AuthorizationDecision> {
      if (caller === context && resource.workspaceId === context.workspaceId && delegated.has(key)
        && (resource.ownerMemberId === context.memberId
          || (key === PermissionKeys.ACCOUNTS_WRITE && resource.resourceType === "Account" && !resource.resourceId))) {
        return { allowed: true, scope: "OWN" };
      }
      return base.authorize(caller, key, resource);
    }
    return { ...base, authorize, async assertAuthorized(caller: AuthenticatedContext, key: PermissionKey, resource: ResourceScope) {
      if (!(await authorize(caller, key, resource)).allowed) await base.assertAuthorized(caller, key, resource);
    } };
  }

  async function inspect(database: PrismaClient, context: AuthenticatedContext, input: SaleCompletionInput, allowReplay = false) {
    const baseAuthorization = createAuthorizationService({ database });
    const opportunity = await database.opportunity.findFirst({
      where: { workspaceId: context.workspaceId, id: input.opportunityId, deletedAt: null },
      include: { account: true, lead: { include: { account: true, contact: true, routingQueue: true, queue: true } }, offers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!opportunity) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
    const resource = { workspaceId: context.workspaceId, resourceType: "Opportunity", resourceId: opportunity.id, opportunityId: opportunity.id, ownerMemberId: opportunity.ownerMemberId, sourceId: opportunity.lead.sourceId, teamId: opportunity.lead.routingQueue?.teamId ?? opportunity.lead.queue?.teamId ?? null };
    await baseAuthorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_WRITE, resource);
    await assertOriginCapability(database, context, await baseAuthorization.authorize(context, PermissionKeys.OPPORTUNITIES_WRITE, resource), opportunity.lead.sourceId, "canTransition");
    const restricted = await ownSalesOnly(baseAuthorization, context);
    if (restricted && (opportunity.ownerMemberId !== context.memberId || opportunity.lead.ownerMemberId !== context.memberId
      || input.sellerMemberId !== context.memberId || BigInt(input.receivedCents) > 0n || input.onboardingOwnerMemberId)) {
      fail("Seu perfil pode concluir apenas vendas próprias, sem baixa de recebimentos ou atribuição de onboarding.", "ACCESS_DENIED", 403);
    }
    const authorization = restricted ? completionAuthorization(baseAuthorization, context) : baseAuthorization;
    const required: PermissionKey[] = [PermissionKeys.CONTRACTS_CREATE];
    if (input.sellerMemberId !== opportunity.ownerMemberId) required.push(PermissionKeys.OWNERSHIP_ASSIGN);
    required.push(PermissionKeys.CONTRACTS_DRAFT_WRITE, PermissionKeys.CONTRACTS_ISSUE, PermissionKeys.CONTRACTS_ACCEPT_RECORD, PermissionKeys.REVENUE_MANAGE, PermissionKeys.REVENUE_EVENTS_RECORD, PermissionKeys.PAYMENTS_MANAGE);
    if (BigInt(input.receivedCents) > 0n) required.push(PermissionKeys.FINANCE_MANAGE);
    if (input.onboardingOwnerMemberId) required.push(PermissionKeys.ONBOARDING_MANAGE);
    for (const key of required) await authorization.assertAuthorized(context, key, resource);
    if (input.customer || !opportunity.accountId || !opportunity.lead.accountId) {
      await authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_LINK, { workspaceId: context.workspaceId, resourceType: "Account", ownerMemberId: opportunity.ownerMemberId });
      await authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_LINK, { workspaceId: context.workspaceId, resourceType: "Account", ownerMemberId: opportunity.lead.ownerMemberId });
      if (input.customer?.mode === "CREATE") await authorization.assertAuthorized(context, PermissionKeys.ACCOUNTS_WRITE, { workspaceId: context.workspaceId, resourceType: "Account" });
    }
    if (input.customer?.mode === "LINK") await createAccountService({ database, authorization, now: options.now }).get(context, input.customer.accountId);
    if (allowReplay) return { opportunity, authorization };
    if (opportunity.status !== "OPEN" || opportunity.revision !== input.expectedRevision) fail("A oportunidade mudou ou já está encerrada. Refaça a proposta.", "SALE_STALE");
    if (!opportunity.lead.contact || opportunity.lead.contact.deletedAt || opportunity.lead.deletedAt) fail("Vincule um contato ativo ao lead antes de fechar a venda.");
    const linkedAccount = opportunity.account ?? opportunity.lead.account;
    if (opportunity.accountId && opportunity.lead.accountId && opportunity.accountId !== opportunity.lead.accountId) fail("A oportunidade e o lead estão vinculados a clientes diferentes. Revise os vínculos antes de fechar.", "SALE_CUSTOMER_CONFLICT");
    if (linkedAccount && input.customer && (input.customer.mode === "CREATE" || input.customer.accountId !== linkedAccount.id)) fail("Já existe um cliente vinculado. Revise o vínculo antes de trocar o cliente no fechamento.", "SALE_CUSTOMER_CONFLICT");
    const customerAccount = input.customer?.mode === "LINK"
      ? await database.account.findFirst({ where: { workspaceId: context.workspaceId, id: input.customer.accountId, deletedAt: null, status: "ACTIVE" } })
      : linkedAccount;
    if (input.customer?.mode === "LINK" && !customerAccount) fail("Cliente não encontrado ou inativo.", "NOT_FOUND", 404);
    if (customerAccount && (customerAccount.deletedAt || customerAccount.status !== "ACTIVE")) fail("O cliente vinculado está inativo. Revise o cadastro antes de fechar.");
    if (!customerAccount && input.customer?.mode !== "CREATE") fail("Selecione um cliente existente ou confirme o nome do novo cliente no fechamento.", "SALE_CUSTOMER_REQUIRED");
    if (input.customer?.mode === "CREATE" && await database.account.findFirst({ where: { workspaceId: context.workspaceId, normalizedName: normalizeAccountName(input.customer.name), deletedAt: null } })) fail("Já existe um cliente com este nome. Selecione o cadastro existente para evitar duplicidade.", "SALE_CUSTOMER_EXISTS");
    const customer = customerAccount ? { mode: opportunity.accountId ? "EXISTING" as const : "LINK" as const, accountId: customerAccount.id, name: customerAccount.name } : { mode: "CREATE" as const, accountId: null, name: input.customer!.mode === "CREATE" ? input.customer!.name : "" };
    if (!opportunity.productId) fail("Selecione o produto da oportunidade antes de fechar a venda.");
    const offer = opportunity.offers[0];
    if (!offer || offer.totalCents !== BigInt(input.totalCents)) fail("Registre uma proposta comercial com o mesmo valor total antes de concluir a venda.");
    if (await database.commercialContract.findFirst({ where: { workspaceId: context.workspaceId, opportunityId: opportunity.id } })) fail("Esta oportunidade já tem contrato. Continue pelo contrato existente para evitar duplicidade.");
    const seller = await database.workspaceMember.findFirst({ where: { workspaceId: context.workspaceId, id: input.sellerMemberId, status: "ACTIVE", deletedAt: null }, include: { user: { select: { displayName: true } } } });
    if (!seller) fail("Vendedor inexistente ou inativo neste workspace.");
    const templateVersion = await database.contractTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, id: input.templateVersionId } });
    const template = templateVersion && await database.contractTemplate.findFirst({ where: { workspaceId: context.workspaceId, id: templateVersion.templateId, status: "ACTIVE", deletedAt: null } });
    if (!template) fail("Selecione uma versão de modelo contratual ativo.");
    const stage = await database.pipelineStage.findFirst({ where: { workspaceId: context.workspaceId, pipelineId: opportunity.pipelineId, opportunityStageCode: "WON", deletedAt: null } });
    if (!stage) fail("O funil não possui etapa de ganho configurada.");
    if (!await database.pipelineStageTransition.findFirst({ where: { workspaceId: context.workspaceId, pipelineId: opportunity.pipelineId, fromStageId: opportunity.currentStageId, toStageId: stage.id, active: true } })) fail("A etapa atual não permite fechamento. Conclua as etapas obrigatórias do funil.");
    await assertPipelineRequiredFields(database, opportunity.id, stage.id, { accountWillBeLinked: true });
    await assertRequiredStageActivitiesComplete(database, context.workspaceId, opportunity.id);
    await assertConsultativeSalesGates(database, opportunity.id, "WON");
    if (new Date(input.startsAt) > options.now()) fail("A ativação da venda exige início de vigência já atingido.");
    if (saleMonth(input.startsAt, input.durationMonths) <= options.now()) fail("A vigência já terminou. Registre o histórico pelo módulo de contratos.");
    if (input.receivedAt && new Date(input.receivedAt) > options.now()) fail("A data do recebimento não pode estar no futuro.", "PAYMENT_RECEIPT_FUTURE_DATE", 400);
    if (BigInt(input.receivedCents) > 0n) {
      const financialAccount = await database.financialAccount.findFirst({ where: { id: input.financialAccountId!, workspaceId: context.workspaceId, active: true } });
      if (!financialAccount) fail("Conta financeira ativa não encontrada.", "FINANCE_ACCOUNT_NOT_FOUND", 404);
    }
    if (input.onboardingOwnerMemberId) {
      if (!await database.workspaceMember.findFirst({ where: { workspaceId: context.workspaceId, id: input.onboardingOwnerMemberId, status: "ACTIVE", deletedAt: null } })) fail("Responsável de onboarding inválido.");
      if (!await database.onboardingTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, status: "PUBLISHED" } })) fail("Publique um modelo de onboarding antes de iniciar o pós-venda.");
    }
    const pendingSteps = [
      ...(!input.onboardingOwnerMemberId ? ["Defina o responsável do onboarding para iniciar o handoff."] : []),
      ...(BigInt(input.receivedCents) < BigInt(input.totalCents) ? [`Saldo a receber: ${BigInt(input.totalCents) - BigInt(input.receivedCents)} centavos.`] : []),
    ];
    return { opportunity, authorization, offer, seller, template, stage, pendingSteps, customer };
  }

  async function prepareLeadSale(context: AuthenticatedContext, raw: unknown) {
    const input = prepareLeadSaleSchema.parse(raw);
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const lead = await options.database.lead.findFirst({
      where: { id: input.leadId, workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, ownerMemberId: true, queueId: true, sourceId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } },
    });
    if (!lead) fail("Lead não encontrado.", "NOT_FOUND", 404);
    const authorization = createAuthorizationService({ database: options.database });
    const restricted = await ownSalesOnly(authorization, context);
    if (restricted && (lead.ownerMemberId !== context.memberId || input.sellerMemberId !== context.memberId)) {
      fail("Seu perfil pode preparar apenas vendas dos seus próprios leads e em seu nome.", "ACCESS_DENIED", 403);
    }
    await authorization.assertAuthorized(context, PermissionKeys.LEADS_READ, {
      workspaceId: context.workspaceId,
      resourceType: "Lead",
      resourceId: lead.id,
      ownerMemberId: lead.ownerMemberId,
      queueId: lead.queueId,
      sourceId: lead.sourceId,
      teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
    });
    const opportunityResource = { workspaceId: context.workspaceId, resourceType: "Opportunity", ownerMemberId: input.sellerMemberId, sourceId: lead.sourceId, teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null };
    const write = await authorization.authorize(context, PermissionKeys.OPPORTUNITIES_WRITE, opportunityResource);
    if (!write.allowed) await authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_WRITE, opportunityResource);
    await assertOriginCapability(options.database, context, write, lead.sourceId, "canTransition");

    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prepare-sale:${context.workspaceId}:${input.idempotencyKey}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-sale:${context.workspaceId}:${input.leadId}`}, 0))`;
      const replay = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: "sale.preparation.created", metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } } });
      if (replay) {
        const metadata = replay.metadata as { fingerprint?: string; opportunityId?: string };
        if (metadata.fingerprint !== fingerprint || !metadata.opportunityId) fail("A mesma preparação foi reutilizada com dados diferentes.", "SALE_PREPARATION_IDEMPOTENCY_CONFLICT");
        return { opportunityId: metadata.opportunityId, replayed: true };
      }
      const currentLead = await tx.lead.findFirst({ where: { id: input.leadId, workspaceId: context.workspaceId, deletedAt: null }, include: { contact: true } });
      if (restricted && currentLead?.ownerMemberId !== context.memberId) fail("O responsável pelo lead mudou. Recarregue o card.", "ACCESS_DENIED", 403);
      if (!currentLead?.contact || currentLead.contact.deletedAt) fail("Vincule um contato ativo ao lead antes de marcar a venda.");
      if (await tx.opportunity.findFirst({ where: { workspaceId: context.workspaceId, leadId: input.leadId, status: "OPEN", deletedAt: null } })) {
        fail("Este lead já possui um negócio aberto. Recarregue o card para continuar o fechamento.", "OPEN_OPPORTUNITY_EXISTS");
      }
      const [pipeline, seller, product] = await Promise.all([
        tx.pipeline.findFirst({ where: { workspaceId: context.workspaceId, entityType: "OPPORTUNITY", isDefault: true, deletedAt: null }, include: { stages: { where: { deletedAt: null } }, transitions: { where: { active: true } } } }),
        tx.workspaceMember.findFirst({
          where: commercialMemberWhere({
            workspaceId: context.workspaceId,
            functions: ["SDR", "CLOSER"],
            memberId: input.sellerMemberId,
          }),
        }),
        tx.product.findFirst({ where: { id: input.productId, workspaceId: context.workspaceId, active: true, deletedAt: null } }),
      ]);
      if (!pipeline) fail("Pipeline de vendas padrão não encontrado.", "PIPELINE_CONFIGURATION_INVALID");
      const negotiation = pipeline.stages.find((stage) => stage.opportunityStageCode === "NEGOTIATION");
      const won = pipeline.stages.find((stage) => stage.opportunityStageCode === "WON");
      if (!negotiation || !won || !pipeline.transitions.some((transition) => transition.fromStageId === negotiation.id && transition.toStageId === won.id)) {
        fail("O pipeline de vendas não permite preparar o fechamento direto.", "PIPELINE_CONFIGURATION_INVALID");
      }
      if (!seller) fail("Vendedor inexistente ou inativo neste workspace.", "NOT_FOUND", 404);
      if (!product || !isCatalogItemSellable(product, options.now())) fail("Produto inexistente ou indisponível para venda.", "CATALOG_ITEM_NOT_SELLABLE");
      const now = options.now();
      const opportunity = await tx.opportunity.create({ data: {
        workspaceId: context.workspaceId,
        leadId: currentLead.id,
        accountId: currentLead.accountId,
        pipelineId: pipeline.id,
        currentStageId: negotiation.id,
        ownerMemberId: seller.id,
        productId: product.id,
        name: `Venda — ${currentLead.fullName}`,
        interestDescription: input.description,
        status: "OPEN",
        amountCents: BigInt(input.totalCents),
        mrrCents: BigInt(input.installmentCents),
        tcvCents: BigInt(input.totalCents),
        probabilityBps: 10000,
        commercialNotes: input.description,
        createdByActorId: context.actorId,
        updatedByActorId: context.actorId,
        createdAt: now,
        updatedAt: now,
      } });
      await projectOpportunityOwnership(tx, { workspaceId: context.workspaceId, opportunityId: opportunity.id, leadId: currentLead.id, memberId: seller.id, actorId: context.actorId, occurredAt: now });
      const history = await tx.stageHistory.create({ data: { workspaceId: context.workspaceId, pipelineId: pipeline.id, stageId: negotiation.id, opportunityId: opportunity.id, enteredAt: now, enteredByActorId: context.actorId, transitionOrigin: "OPPORTUNITY_CARD", transitionReason: "Negócio preparado pelo atalho Marcar vendido." } });
      const offer = await tx.offer.create({ data: { workspaceId: context.workspaceId, opportunityId: opportunity.id, productId: product.id, name: `Proposta — ${currentLead.fullName}`, quantity: 1, unitPriceCents: BigInt(input.totalCents), discountCents: 0n, totalCents: BigInt(input.totalCents), justification: input.description, createdByActorId: context.actorId, updatedByActorId: context.actorId, createdAt: now, updatedAt: now } });
      await tx.offerLine.create({ data: { workspaceId: context.workspaceId, offerId: offer.id, productId: product.id, position: 1, productVersionSnapshot: product.version, productSkuSnapshot: product.sku, productNameSnapshot: product.name, productKindSnapshot: product.kind, revenueCategorySnapshot: product.revenueCategory, approvedConditionsSnapshot: product.approvedConditions, quantity: 1, unitPriceCents: BigInt(input.totalCents), discountCents: 0n, totalCents: BigInt(input.totalCents) } });
      const activity = await tx.activity.create({ data: { workspaceId: context.workspaceId, leadId: currentLead.id, opportunityId: opportunity.id, type: "STAGE_CHANGE", direction: "INTERNAL", result: "INFORMATION", subject: `Fechamento preparado: ${opportunity.name}`, description: input.description, occurredAt: now, newValues: { stageCode: "NEGOTIATION", productId: product.id, totalCents: input.totalCents, offerId: offer.id }, createdByActorId: context.actorId, updatedByActorId: context.actorId, createdAt: now, updatedAt: now } });
      await recordCommercialMetricFactInTransaction(tx, { workspaceId: context.workspaceId, eventKey: `opportunity:${opportunity.id}:created:v1`, eventType: "OPPORTUNITY_CREATED", occurredAt: now, sourceEntityType: "Opportunity", sourceEntityId: opportunity.id, leadId: currentLead.id, activityId: activity.id, opportunityId: opportunity.id, pipelineId: pipeline.id, stageId: negotiation.id, creditedMemberId: seller.id, performedByMemberId: context.memberId, leadOwnerMemberIdAtEvent: currentLead.ownerMemberId, opportunityOwnerMemberIdAtEvent: seller.id, valueCents: BigInt(input.totalCents), executionMode: "MANUAL" });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "sale.preparation.created", entityType: "Opportunity", entityId: opportunity.id, occurredAt: now, changes: { leadId: currentLead.id, sellerMemberId: seller.id, productId: product.id, totalCents: input.totalCents, paymentPlan: input.paymentPlan }, metadata: { idempotencyKey: input.idempotencyKey, fingerprint, opportunityId: opportunity.id, offerId: offer.id, stageHistoryId: history.id } } });
      return { opportunityId: opportunity.id, replayed: false };
    }, { isolationLevel: "Serializable" });
  }

  async function getOptions(context: AuthenticatedContext, opportunityId: string) {
    const opportunity = await options.database.opportunity.findFirst({
      where: { id: opportunityId, workspaceId: context.workspaceId, deletedAt: null },
      select: {
        id: true,
        ownerMemberId: true,
        lead: { select: { ownerMemberId: true, sourceId: true, routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } },
      },
    });
    if (!opportunity) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
    const resource = { workspaceId: context.workspaceId, resourceType: "Opportunity", resourceId: opportunity.id, opportunityId: opportunity.id, ownerMemberId: opportunity.ownerMemberId, sourceId: opportunity.lead.sourceId, teamId: opportunity.lead.routingQueue?.teamId ?? opportunity.lead.queue?.teamId ?? null };
    const authorization = createAuthorizationService({ database: options.database });
    const write = await authorization.authorize(context, PermissionKeys.OPPORTUNITIES_WRITE, resource);
    if (!write.allowed) await authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_WRITE, resource);
    await assertOriginCapability(options.database, context, write, opportunity.lead.sourceId, "canTransition");
    const [payments, finance] = await Promise.all([
      authorization.authorize(context, PermissionKeys.PAYMENTS_MANAGE, resource),
      authorization.authorize(context, PermissionKeys.FINANCE_MANAGE, { workspaceId: context.workspaceId, resourceType: "Finance", resourceId: context.workspaceId }),
    ]);
    const restricted = await ownSalesOnly(authorization, context);
    if (restricted && (opportunity.ownerMemberId !== context.memberId || opportunity.lead.ownerMemberId !== context.memberId)) {
      fail("Seu perfil pode concluir apenas vendas próprias.", "ACCESS_DENIED", 403);
    }
    const canRecordReceipt = !restricted && payments.allowed && finance.allowed;
    const financialAccounts = canRecordReceipt
      ? await options.database.financialAccount.findMany({ where: { workspaceId: context.workspaceId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [];
    const templates = await options.database.contractTemplate.findMany({
      where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null },
      select: { id: true, name: true, currentVersion: true }, orderBy: { name: "asc" },
    });
    const versions = await options.database.contractTemplateVersion.findMany({
      where: { workspaceId: context.workspaceId, OR: templates.map((template) => ({ templateId: template.id, version: template.currentVersion })) },
      select: { id: true, templateId: true, version: true },
    });
    return { canRecordReceipt, ownSalesOnly: restricted, financialAccounts, paymentMethods: salePaymentMethods,
      templateVersions: versions.map((version) => ({ id: version.id, version: version.version, name: templates.find((template) => template.id === version.templateId)!.name })) };
  }

  async function authorize(context: AuthenticatedContext, raw: unknown) {
    await inspect(options.database, context, saleCompletionSchema.parse(raw), true);
  }

  async function preview(context: AuthenticatedContext, raw: unknown) {
    const payload = saleCompletionSchema.parse(raw);
    const state = await inspect(options.database, context, payload);
    const reviewedPayload = state.customer!.mode === "LINK" ? { ...payload, customer: { mode: "LINK" as const, accountId: state.customer!.accountId! } } : payload;
    return { payload: reviewedPayload, customer: state.customer!, customerName: state.customer!.name, sellerName: state.seller!.user.displayName, contractTemplateName: state.template!.name, schedule: saleSchedule(payload), pendingSteps: state.pendingSteps!, summary: `${state.opportunity.name}: ${state.customer!.mode === "CREATE" ? "cadastro do cliente, " : state.customer!.mode === "LINK" ? "vínculo ao cliente, " : ""}contrato aceito, venda ganha, MRR, recebíveis e comissão${payload.onboardingOwnerMemberId ? ", handoff de onboarding" : ""}${BigInt(payload.receivedCents) > 0n ? ", com baixa do valor recebido" : ""}.` };
  }

  async function execute(context: AuthenticatedContext, raw: unknown) {
    const command = executeSaleCompletionSchema.parse(raw);
    const { confirmed: _confirmed, idempotencyKey, ...input } = command;
    void _confirmed;
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sale:${context.workspaceId}:${idempotencyKey}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`opportunity:${context.workspaceId}:${input.opportunityId}`}, 0))`;
      if (input.customer?.mode === "CREATE") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sale-customer:${context.workspaceId}:${normalizeAccountName(input.customer.name)}`}, 0))`;
      const database = transactionDatabase(tx);
      const replay = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: "sale.completed", metadata: { path: ["idempotencyKey"], equals: idempotencyKey } } });
      if (replay) {
        await inspect(database, context, input, true);
        const metadata = replay.metadata as { fingerprint?: string; result?: Prisma.JsonValue };
        if (metadata.fingerprint !== fingerprint) fail("A mesma confirmação foi reutilizada com dados diferentes.", "SALE_IDEMPOTENCY_CONFLICT");
        return { ...(metadata.result as Record<string, Prisma.JsonValue>), replayed: true };
      }
      const state = await inspect(database, context, input);
      const now = options.now();
      const accounts = createAccountService({ database, authorization: state.authorization, now: options.now });
      const accountId = state.customer!.mode === "CREATE" ? (await accounts.create(context, { name: state.customer!.name })).id : state.customer!.accountId!;
      let expectedRevision = input.expectedRevision;
      if (!state.opportunity.accountId) {
        await accounts.link(context, { opportunityId: input.opportunityId, accountId, reason: "Cliente revisado e confirmado no fechamento integrado." });
        expectedRevision += 1;
      }
      if (!state.opportunity.lead.accountId) await accounts.link(context, { leadId: state.opportunity.leadId, accountId, reason: "Cliente revisado e confirmado no fechamento integrado." });
      if (state.opportunity.ownerMemberId !== input.sellerMemberId) {
        await createLifecycleService({ database, authorization: state.authorization, now: options.now }).assignOwnership(context, { entityType: "OPPORTUNITY", entityId: input.opportunityId, function: "CLOSER", memberId: input.sellerMemberId, reason: "Vendedor confirmado no fechamento integrado.", idempotencyKey: `sale:${idempotencyKey}:owner` });
      }
      await tx.opportunity.update({ where: { id: input.opportunityId }, data: { ownerMemberId: input.sellerMemberId, amountCents: BigInt(input.totalCents), tcvCents: BigInt(input.totalCents), mrrCents: BigInt(input.monthlyCents), updatedByActorId: context.actorId } });
      // Preserve all commercial gates, histories, activities and domain audits.
      const automationPublisher = createAutomationEngineService({ database, authorization: state.authorization, now: options.now });
      const won = await createOpportunityService({ database, authorization: state.authorization, now: options.now, automationPublisher }).transition(context, { action: "TRANSITION", opportunityId: input.opportunityId, expectedRevision, targetStageId: state.stage!.id, reason: "Fechamento integrado confirmado pelo usuário.", origin: "OPPORTUNITY_CARD", confirmed: true });
      const contracts = createContractService({ database, authorization: state.authorization, now: options.now });
      const endsAt = saleMonth(input.startsAt, input.durationMonths).toISOString();
      const contract = await contracts.create(context, { opportunityId: input.opportunityId, offerId: state.offer!.id, templateVersionId: input.templateVersionId, billingFrequency: BigInt(input.monthlyCents) > 0n ? "MONTHLY" : "ONE_TIME", durationMonths: input.durationMonths, proposedStartsAt: input.startsAt, proposedEndsAt: endsAt, paymentTerms: `Forma: ${input.paymentMethod}. Condição: ${input.paymentCondition}. Entrada: ${input.upfrontCents} centavos; ${input.durationMonths} mensalidade(s) de ${input.monthlyCents} centavos. Recebido no fechamento: ${input.receivedCents} centavos.`, idempotencyKey: `sale:${idempotencyKey}:contract` });
      let subscriptionId: string | null = null;
      let handoffId: string | null = null;
      const invoiceIds: string[] = [];
      const paymentIds: string[] = [];
      if (input.acceptance) {
        let revision = 1;
        for (const action of ["REQUEST_REVIEW", "MARK_READY", "ISSUE", "ACCEPT_LOCAL"] as const) {
          await contracts.act(context, contract.contractId, { action, expectedRevision: revision++, idempotencyKey: `sale:${idempotencyKey}:${action}`, confirmed: true, ...(action === "REQUEST_REVIEW" ? { reason: "Condições revisadas na confirmação do fechamento integrado." } : {}), ...(action === "ACCEPT_LOCAL" ? { ...input.acceptance, effectiveStartsAt: input.startsAt, effectiveEndsAt: endsAt } : {}) });
        }
        const revenue = createRevenueService(database, state.authorization);
        const subscription = await revenue.create(context, { contractId: contract.contractId, quantity: 1, recurringPriceCents: input.monthlyCents, billingInterval: "MONTHLY", startsAt: input.startsAt, endsAt });
        subscriptionId = subscription.id;
        await revenue.action(context, subscription.id, { action: "ACTIVATE", effectiveAt: input.startsAt, reason: "Aceite contratual documentado no fechamento.", idempotencyKey: `sale:${idempotencyKey}:activate` });
        const payments = createPaymentService({ database, now: options.now, authorization: state.authorization });
        let remainingReceived = BigInt(input.receivedCents);
        for (const installment of saleSchedule(input)) {
          const invoice = await payments.createInvoice(context, { subscriptionId, billingPeriodStart: installment.dueAt, billingPeriodEnd: installment.periodEnd, dueAt: installment.dueAt, description: `${state.opportunity.name} — parcela ${installment.installment}/${input.durationMonths}`, upfrontCents: installment.installment === 1 ? input.upfrontCents : "0", idempotencyKey: `sale:${idempotencyKey}:invoice:${installment.installment}` });
          const issued = await payments.act(context, invoice.id, { action: "ISSUE", expectedRevision: invoice.revision, reason: "Recebível emitido a partir do fechamento confirmado." });
          invoiceIds.push(invoice.id);
          if (remainingReceived > 0n) {
            const allocation = remainingReceived > invoice.totalCents ? invoice.totalCents : remainingReceived;
            if (allocation > 0n) {
              const receipt = await payments.recordReceipt(context, {
                invoiceId: invoice.id,
                financialAccountId: input.financialAccountId!,
                expectedRevision: "invoice" in issued ? issued.invoice.revision : invoice.revision + 1,
                amountCents: allocation,
                receivedAt: input.receivedAt!,
                method: input.paymentMethod,
                reference: `${input.paymentReference!} · parcela ${installment.installment}`,
                confirmed: true,
                idempotencyKey: randomUUID(),
              });
              paymentIds.push(receipt.payment.id);
              remainingReceived -= allocation;
            }
          }
        }
        if (input.onboardingOwnerMemberId) {
          const handoff = await createOnboardingService({ database, now: options.now }).createHandoff(context, { opportunityId: input.opportunityId, ownerMemberId: input.onboardingOwnerMemberId, reason: "Handoff iniciado pelo fechamento integrado confirmado.", idempotencyKey: `sale:${idempotencyKey}:handoff` });
          handoffId = handoff.id;
        }
      }
      await syncActiveProspectingCommercialStageInTransaction(tx, context, {
        leadId: state.opportunity.leadId,
        targetCode: "CLIENT",
        reason: "Lead convertido em cliente pelo fechamento integrado da venda.",
        commercialEvent: "SALE_WON",
      }, now);
      await tx.commission.updateMany({ where: { workspaceId: context.workspaceId, opportunityId: input.opportunityId, contractId: null }, data: { contractId: contract.contractId } });
      const result = { opportunityId: input.opportunityId, accountId, customerCreated: state.customer!.mode === "CREATE", revision: won.revision, contractId: contract.contractId, subscriptionId, invoiceIds, paymentIds, handoffId, pendingSteps: state.pendingSteps!, paymentReceived: paymentIds.length > 0, receivedCents: input.receivedCents, outstandingCents: (BigInt(input.totalCents) - BigInt(input.receivedCents)).toString(), replayed: false };
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "sale.completed", entityType: "Opportunity", entityId: input.opportunityId, occurredAt: now, changes: { totalCents: input.totalCents, monthlyCents: input.monthlyCents, upfrontCents: input.upfrontCents, sellerMemberId: input.sellerMemberId }, metadata: { idempotencyKey, fingerprint, result } } });
      return result;
    }, { isolationLevel: "Serializable", timeout: 60_000 });
  }
  return { preview, execute, authorize, getOptions, prepareLeadSale };
}

export function getSaleCompletionService() {
  return createSaleCompletionService({ database: getDatabaseClient(), now: () => new Date() });
}
