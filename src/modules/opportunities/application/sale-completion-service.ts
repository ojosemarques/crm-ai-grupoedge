import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createAccountService, normalizeAccountName } from "@/modules/accounts/application/account-service";
import { createAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { createContractService } from "@/modules/contracts/application/contract-service";
import { createLifecycleService } from "@/modules/lifecycle/application/lifecycle-service";
import { createOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { assertOriginCapability, createOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { assertConsultativeSalesGates, assertRequiredStageActivitiesComplete } from "@/modules/opportunities/application/sales-gate-service";
import { assertPipelineRequiredFields } from "@/modules/pipeline-templates/application/opportunity-required-fields";
import { executeSaleCompletionSchema, saleCompletionSchema, saleMonth, saleSchedule, type SaleCompletionInput } from "@/modules/opportunities/domain/sale-completion-contracts";
import { createPaymentService } from "@/modules/payments/application/payment-service";
import { createRevenueService } from "@/modules/revenue/application/revenue-service";
import { createAuthorizationService } from "@/modules/users/permissions/authorization-service";
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
  async function inspect(database: PrismaClient, context: AuthenticatedContext, input: SaleCompletionInput, allowReplay = false) {
    const authorization = createAuthorizationService({ database });
    const opportunity = await database.opportunity.findFirst({
      where: { workspaceId: context.workspaceId, id: input.opportunityId, deletedAt: null },
      include: { account: true, lead: { include: { account: true, contact: true, routingQueue: true, queue: true } }, offers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!opportunity) fail("Oportunidade não encontrada.", "NOT_FOUND", 404);
    const resource = { workspaceId: context.workspaceId, resourceType: "Opportunity", resourceId: opportunity.id, opportunityId: opportunity.id, ownerMemberId: opportunity.ownerMemberId, sourceId: opportunity.lead.sourceId, teamId: opportunity.lead.routingQueue?.teamId ?? opportunity.lead.queue?.teamId ?? null };
    await authorization.assertAuthorized(context, PermissionKeys.OPPORTUNITIES_WRITE, resource);
    await assertOriginCapability(database, context, await authorization.authorize(context, PermissionKeys.OPPORTUNITIES_WRITE, resource), opportunity.lead.sourceId, "canTransition");
    const required: PermissionKey[] = [PermissionKeys.CONTRACTS_CREATE];
    if (input.sellerMemberId !== opportunity.ownerMemberId) required.push(PermissionKeys.OWNERSHIP_ASSIGN);
    if (input.acceptance) required.push(PermissionKeys.CONTRACTS_DRAFT_WRITE, PermissionKeys.CONTRACTS_ISSUE, PermissionKeys.CONTRACTS_ACCEPT_RECORD, PermissionKeys.REVENUE_MANAGE, PermissionKeys.REVENUE_EVENTS_RECORD, PermissionKeys.PAYMENTS_MANAGE);
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
    if (input.acceptance && new Date(input.startsAt) > options.now()) fail("A ativação imediata exige início de vigência já atingido. Gere o rascunho para contratos futuros.");
    if (input.acceptance && saleMonth(input.startsAt, input.durationMonths) <= options.now()) fail("A vigência já terminou. Registre o histórico pelo módulo de contratos, sem ativar MRR atual.");
    if (input.onboardingOwnerMemberId) {
      if (!await database.workspaceMember.findFirst({ where: { workspaceId: context.workspaceId, id: input.onboardingOwnerMemberId, status: "ACTIVE", deletedAt: null } })) fail("Responsável de onboarding inválido.");
      if (!await database.onboardingTemplateVersion.findFirst({ where: { workspaceId: context.workspaceId, status: "PUBLISHED" } })) fail("Publique um modelo de onboarding antes de iniciar o pós-venda.");
    }
    const pendingSteps = [
      ...(!input.acceptance ? ["Contrato em rascunho: registre o aceite real para ativar assinatura e emitir recebíveis."] : []),
      ...(!input.onboardingOwnerMemberId ? ["Defina o responsável do onboarding para iniciar o handoff."] : []),
      "Pagamentos serão baixados somente após confirmação de recebimento.",
    ];
    return { opportunity, authorization, offer, seller, template, stage, pendingSteps, customer };
  }

  async function authorize(context: AuthenticatedContext, raw: unknown) {
    await inspect(options.database, context, saleCompletionSchema.parse(raw), true);
  }

  async function preview(context: AuthenticatedContext, raw: unknown) {
    const payload = saleCompletionSchema.parse(raw);
    const state = await inspect(options.database, context, payload);
    const reviewedPayload = state.customer!.mode === "LINK" ? { ...payload, customer: { mode: "LINK" as const, accountId: state.customer!.accountId! } } : payload;
    return { payload: reviewedPayload, customer: state.customer!, customerName: state.customer!.name, sellerName: state.seller!.user.displayName, contractTemplateName: state.template!.name, schedule: saleSchedule(payload), pendingSteps: state.pendingSteps!, summary: `${state.opportunity.name}: ${state.customer!.mode === "CREATE" ? "cadastro do cliente, " : state.customer!.mode === "LINK" ? "vínculo ao cliente, " : ""}contrato, venda ganha e comissão prevista${payload.acceptance ? ", assinatura e recebíveis" : ""}${payload.onboardingOwnerMemberId ? ", handoff de onboarding" : ""}. Nenhuma baixa de pagamento.` };
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
      const contract = await contracts.create(context, { opportunityId: input.opportunityId, offerId: state.offer!.id, templateVersionId: input.templateVersionId, billingFrequency: BigInt(input.monthlyCents) > 0n ? "MONTHLY" : "ONE_TIME", durationMonths: input.durationMonths, proposedStartsAt: input.startsAt, proposedEndsAt: endsAt, paymentTerms: `Entrada: ${input.upfrontCents} centavos; ${input.durationMonths} mensalidade(s) de ${input.monthlyCents} centavos.`, idempotencyKey: `sale:${idempotencyKey}:contract` });
      let subscriptionId: string | null = null;
      let handoffId: string | null = null;
      const invoiceIds: string[] = [];
      if (input.acceptance) {
        let revision = 1;
        for (const action of ["REQUEST_REVIEW", "MARK_READY", "ISSUE", "ACCEPT_LOCAL"] as const) {
          await contracts.act(context, contract.contractId, { action, expectedRevision: revision++, idempotencyKey: `sale:${idempotencyKey}:${action}`, confirmed: true, ...(action === "REQUEST_REVIEW" ? { reason: "Condições revisadas na confirmação do fechamento integrado." } : {}), ...(action === "ACCEPT_LOCAL" ? { ...input.acceptance, effectiveStartsAt: input.startsAt, effectiveEndsAt: endsAt } : {}) });
        }
        const revenue = createRevenueService(database, state.authorization);
        const subscription = await revenue.create(context, { contractId: contract.contractId, quantity: 1, recurringPriceCents: input.monthlyCents, billingInterval: "MONTHLY", startsAt: input.startsAt, endsAt });
        subscriptionId = subscription.id;
        await revenue.action(context, subscription.id, { action: "ACTIVATE", effectiveAt: input.startsAt, reason: "Aceite contratual documentado no fechamento.", idempotencyKey: `sale:${idempotencyKey}:activate` });
        const payments = createPaymentService({ database, now: options.now });
        for (const installment of saleSchedule(input)) {
          const invoice = await payments.createInvoice(context, { subscriptionId, billingPeriodStart: installment.dueAt, billingPeriodEnd: installment.periodEnd, dueAt: installment.dueAt, description: `${state.opportunity.name} — parcela ${installment.installment}/${input.durationMonths}`, upfrontCents: installment.installment === 1 ? input.upfrontCents : "0", idempotencyKey: `sale:${idempotencyKey}:invoice:${installment.installment}` });
          await payments.act(context, invoice.id, { action: "ISSUE", expectedRevision: invoice.revision, reason: "Recebível emitido a partir do fechamento confirmado." });
          invoiceIds.push(invoice.id);
        }
        if (input.onboardingOwnerMemberId) {
          const handoff = await createOnboardingService({ database, now: options.now }).createHandoff(context, { opportunityId: input.opportunityId, ownerMemberId: input.onboardingOwnerMemberId, reason: "Handoff iniciado pelo fechamento integrado confirmado.", idempotencyKey: `sale:${idempotencyKey}:handoff` });
          handoffId = handoff.id;
        }
      }
      await tx.commission.updateMany({ where: { workspaceId: context.workspaceId, opportunityId: input.opportunityId, contractId: null }, data: { contractId: contract.contractId } });
      const result = { opportunityId: input.opportunityId, accountId, customerCreated: state.customer!.mode === "CREATE", revision: won.revision, contractId: contract.contractId, subscriptionId, invoiceIds, handoffId, pendingSteps: state.pendingSteps!, paymentReceived: false, replayed: false };
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "sale.completed", entityType: "Opportunity", entityId: input.opportunityId, occurredAt: now, changes: { totalCents: input.totalCents, monthlyCents: input.monthlyCents, upfrontCents: input.upfrontCents, sellerMemberId: input.sellerMemberId }, metadata: { idempotencyKey, fingerprint, result } } });
      return result;
    }, { isolationLevel: "Serializable", timeout: 60_000 });
  }
  return { preview, execute, authorize };
}

export function getSaleCompletionService() {
  return createSaleCompletionService({ database: getDatabaseClient(), now: () => new Date() });
}
