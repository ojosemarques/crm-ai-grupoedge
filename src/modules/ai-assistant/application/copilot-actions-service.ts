import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { createAccountService } from "@/modules/accounts/application/account-service";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { copilotActionSchema, type CopilotAction, type CopilotActionOptions, type CopilotActionPreview } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService } from "@/modules/finance/application/finance-service";
import { createLeadListService } from "@/modules/leads/application/lead-list-service";
import { getLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { copilotSearchTerms, searchCopilotPages } from "@/modules/ai-assistant/domain/copilot-search";
import { canonicalJson } from "@/modules/integrations/domain/integration-policy";
import { createPaymentService } from "@/modules/payments/application/payment-service";
import { createAuthorizationService, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Options = { database: PrismaClient; now: () => Date };
type ActionResult = { answer: string; result: unknown; targetType: string; targetId: string; links: Array<{ label: string; href: string; entityType: string }> };
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function fail(message: string, code = "COPILOT_ACTION_INVALID", statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
const money = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
const linksFor = (kind: CopilotAction["kind"], id?: string) => [{
  label: kind === "CREATE_TASK" ? "Tarefas do lead" : kind === "UPDATE_CUSTOMER" ? "Cliente" : kind === "RECORD_PAYMENT" ? "Cobranças" : "Financeiro",
  href: kind === "CREATE_TASK" ? `/leads/${id}` : kind === "UPDATE_CUSTOMER" ? `/contas/${id}` : kind === "RECORD_PAYMENT" ? `/pagamentos/${id}` : "/financeiro", entityType: "MODULE",
}];

// Compose existing domain services inside one transaction, including the replay
// receipt. A dropped HTTP response can then be retried without another mutation.
function withinTransaction(tx: Prisma.TransactionClient): PrismaClient {
  return new Proxy(tx, { get(target, property) {
    if (property === "$transaction") return async (operation: unknown) => {
      if (typeof operation !== "function") throw new Error("Callback transaction required.");
      return operation(tx);
    };
    return Reflect.get(target, property);
  } }) as PrismaClient;
}

export function createCopilotActionsService(options: Options) {
  async function authorized(database: PrismaClient, context: AuthenticatedContext, action: CopilotAction) {
    const authorization = createAuthorizationService({ database });
    const check = (key: PermissionKey, scope: ResourceScope) => authorization.assertAuthorized(context, key, scope);
    if (action.kind === "CREATE_TASK") {
      const lead = await database.lead.findFirst({ where: { id: action.leadId, workspaceId: context.workspaceId, deletedAt: null }, include: { routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } });
      if (!lead) fail("Lead inexistente ou não autorizado.", "NOT_FOUND", 404);
      const scope = { workspaceId: context.workspaceId, resourceType: "Lead", resourceId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null };
      for (const key of [PermissionKeys.LEADS_READ, PermissionKeys.TASKS_READ, PermissionKeys.TASKS_WRITE]) await check(key, scope);
      if (action.opportunityId) {
        const opportunity = await database.opportunity.findFirst({ where: { workspaceId: context.workspaceId, id: action.opportunityId, leadId: lead.id, deletedAt: null } });
        if (!opportunity) fail("A oportunidade não pertence ao lead selecionado.");
        await check(PermissionKeys.OPPORTUNITIES_READ, { ...scope, resourceType: "Opportunity", resourceId: opportunity.id, opportunityId: opportunity.id, ownerMemberId: opportunity.ownerMemberId });
      }
    } else if (action.kind === "UPDATE_CUSTOMER") {
      // Keep the same write scope as the canonical account update service.
      const scope = { workspaceId: context.workspaceId, resourceType: "Account", resourceId: action.accountId };
      await check(PermissionKeys.ACCOUNTS_READ, scope);
      await check(PermissionKeys.ACCOUNTS_WRITE, scope);
      if (!await database.account.findFirst({ where: { workspaceId: context.workspaceId, id: action.accountId, deletedAt: null }, select: { id: true } })) fail("Cliente inexistente ou não autorizado.", "NOT_FOUND", 404);
    } else {
      const scope = { workspaceId: context.workspaceId, resourceType: "Finance" };
      await check(PermissionKeys.FINANCE_READ, scope);
      await check(PermissionKeys.FINANCE_MANAGE, scope);
      if (action.kind === "RECORD_PAYMENT") {
        const invoice = await database.invoice.findFirst({ where: { workspaceId: context.workspaceId, id: action.invoiceId }, select: { ownerMemberId: true } });
        if (!invoice) fail("Cobrança inexistente ou não autorizada.", "NOT_FOUND", 404);
        const paymentScope = { workspaceId: context.workspaceId, resourceType: "Payment", resourceId: action.invoiceId, ownerMemberId: invoice.ownerMemberId };
        await check(PermissionKeys.PAYMENTS_READ, paymentScope);
        await check(PermissionKeys.PAYMENTS_MANAGE, paymentScope);
      } else if (action.customerAccountId) {
        await createAccountService({ database, authorization, now: options.now }).get(context, action.customerAccountId);
      }
    }
  }

  async function inspect(database: PrismaClient, context: AuthenticatedContext, action: CopilotAction): Promise<CopilotActionPreview> {
    await authorized(database, context, action);
    if (action.kind === "CREATE_TASK") {
      const lead = await database.lead.findUniqueOrThrow({ where: { id: action.leadId }, include: { owner: { include: { user: { select: { displayName: true } } } }, queue: true } });
      const opportunity = action.opportunityId ? await database.opportunity.findUniqueOrThrow({ where: { id: action.opportunityId }, select: { name: true } }) : null;
      return { kind: action.kind, title: "Criar tarefa", summary: `${action.title} · ${lead.fullName}`, details: [
        { label: "Lead", after: lead.fullName }, { label: "Tarefa", after: action.title },
        { label: "Oportunidade vinculada", after: opportunity?.name ?? "Nenhuma" },
        { label: "Descrição", after: action.description ?? "Não informada" },
        { label: "Responsável", after: lead.owner?.user.displayName ?? lead.queue?.name ?? "Fila do lead" },
        { label: "Prazo", after: action.dueAt }, { label: "Prioridade", after: action.priority }, { label: "Tipo", after: action.taskKind },
      ], impact: ["Cria uma tarefa aberta vinculada ao lead e ao responsável atual.", "Atualiza a próxima ação e registra o histórico operacional."], bindings: { leadId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, opportunityId: action.opportunityId ?? null }, links: linksFor(action.kind, lead.id) };
    }
    if (action.kind === "UPDATE_CUSTOMER") {
      const account = await database.account.findUniqueOrThrow({ where: { id: action.accountId } });
      if (account.revision !== action.expectedRevision) fail("O cliente mudou desde a seleção. Refaça a prévia.", "COPILOT_STALE_CUSTOMER");
      const labels = { name: "Nome", legalName: "Razão social", domain: "Site/domínio", segment: "Segmento", size: "Porte" };
      const before = { name: account.name, legalName: account.legalName, domain: account.originalDomain, segment: account.segment, size: account.size };
      return { kind: action.kind, title: "Atualizar cliente", summary: account.name, details: Object.entries(action.changes).map(([key, value]) => ({ label: labels[key as keyof typeof labels], before: String(before[key as keyof typeof labels] ?? "Não informado"), after: String(value ?? "Remover informação") })), impact: ["Atualiza o cadastro compartilhado do cliente.", "Documentos emitidos preservam os dados registrados na emissão."], links: linksFor(action.kind, account.id) };
    }
    if (action.kind === "CREATE_EXPENSE") {
      const [category, account, customer] = await Promise.all([
        database.financialCategory.findFirst({ where: { workspaceId: context.workspaceId, id: action.categoryId, active: true, kind: "EXPENSE" } }),
        database.financialAccount.findFirst({ where: { workspaceId: context.workspaceId, id: action.financialAccountId, active: true } }),
        action.customerAccountId ? database.account.findFirst({ where: { workspaceId: context.workspaceId, id: action.customerAccountId, deletedAt: null } }) : null,
      ]);
      if (!category || !account || (action.customerAccountId && !customer)) fail("Confira categoria, conta financeira e cliente da despesa.");
      if (action.settledAt && new Date(action.settledAt) > options.now()) fail("Pagamento realizado não pode ter data futura.");
      return { kind: action.kind, title: "Registrar despesa", summary: `${action.description} · ${money(action.amountCents)}`, details: [
        { label: "Valor", after: money(action.amountCents) }, { label: "Categoria", after: category.name }, { label: "Conta financeira", after: account.name },
        { label: "Fornecedor", after: action.counterparty ?? "Não informado" }, { label: "Cliente associado", after: customer?.name ?? "Nenhum" },
        { label: "Competência", after: action.competenceAt }, { label: "Vencimento", after: action.dueAt },
        { label: "Situação", after: action.status === "SETTLED" ? `Pagamento realizado em ${action.settledAt}` : "A pagar" },
      ], impact: [action.status === "SETTLED" ? "Registra saída de caixa de um pagamento já realizado." : "Registra uma obrigação a pagar, sem reduzir o caixa recebido.", "Inclui a despesa no financeiro e na DRE pela competência. Não executa transferência bancária."], links: linksFor(action.kind) };
    }
    const { kind: _kind, receiptConfirmed: _receipt, ...input } = action;
    void _kind; void _receipt;
    await createPaymentService({ database, now: options.now }).previewReceipt(context, input);
    const [invoice, account] = await Promise.all([database.invoice.findUniqueOrThrow({ where: { id: action.invoiceId } }), database.financialAccount.findUniqueOrThrow({ where: { id: action.financialAccountId } })]);
    return { kind: action.kind, title: "Registrar recebimento", summary: `${invoice.invoiceNumber} · ${invoice.accountNameSnapshot}`, details: [
      { label: "Cliente", after: invoice.accountNameSnapshot }, { label: "Cobrança", after: invoice.invoiceNumber },
      { label: "Valor recebido", after: money(action.amountCents) }, { label: "Conta financeira", after: account.name },
      { label: "Data do recebimento", after: action.receivedAt }, { label: "Forma", after: action.method }, { label: "Referência", after: action.reference },
      { label: "Saldo pendente após baixa", after: money((invoice.totalCents - invoice.paidCents - BigInt(action.amountCents)).toString()) },
    ], impact: ["Registra o recebimento real informado e baixa a cobrança, total ou parcialmente.", "Atualiza caixa e indicadores de recebimento. MRR continua representando a assinatura contratada."], links: linksFor(action.kind, invoice.id) };
  }

  async function authorize(context: AuthenticatedContext, raw: CopilotAction) { await authorized(options.database, context, copilotActionSchema.parse(raw)); }
  async function preview(context: AuthenticatedContext, raw: CopilotAction) { return inspect(options.database, context, copilotActionSchema.parse(raw)); }

  async function execute(context: AuthenticatedContext, raw: CopilotAction, confirmation: { confirmed: true; idempotencyKey: string; expectedPreview?: unknown }): Promise<ActionResult> {
    z.object({ confirmed: z.literal(true), idempotencyKey: z.string().uuid(), expectedPreview: z.unknown().optional() }).strict().parse(confirmation);
    const action = copilotActionSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`copilot-action:${context.workspaceId}:${confirmation.idempotencyKey}`}, 0))`;
      const database = withinTransaction(tx);
      await authorized(database, context, action);
      const fingerprint = digest(action);
      const previous = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.action.executed", metadata: { path: ["idempotencyKey"], equals: confirmation.idempotencyKey } } });
      if (previous) {
        const receipt = previous.metadata as { fingerprint?: string; result?: unknown };
        if (receipt.fingerprint !== fingerprint) fail("Confirmação já usada para outra ação.", "COPILOT_ACTION_REPLAY_CONFLICT");
        return receipt.result as ActionResult;
      }
      const currentPreview = await inspect(database, context, action);
      if (confirmation.expectedPreview !== undefined && digest(json(currentPreview)) !== digest(confirmation.expectedPreview)) fail("Os dados mudaram desde a prévia confirmada. Gere uma nova proposta.", "COPILOT_PREVIEW_CHANGED");
      const authorization = createAuthorizationService({ database });
      let result: ActionResult;
      if (action.kind === "CREATE_TASK") {
        const { kind: _kind, taskKind, ...input } = action; void _kind;
        const task = await createOperationalHistoryService({ database, authorization, now: options.now }).createTask(context, { ...input, kind: taskKind });
        result = { answer: "Tarefa criada e incluída no histórico do lead.", result: task, targetType: "Task", targetId: task.id, links: linksFor(action.kind, action.leadId) };
      } else if (action.kind === "UPDATE_CUSTOMER") {
        const account = await createAccountService({ database, authorization, now: options.now }).update(context, action.accountId, { expectedRevision: action.expectedRevision, ...action.changes });
        result = { answer: "Cadastro do cliente atualizado conforme a prévia.", result: { id: account.id, revision: account.revision }, targetType: "Account", targetId: account.id, links: linksFor(action.kind, account.id) };
      } else if (action.kind === "CREATE_EXPENSE") {
        const { kind: _kind, paymentConfirmed: _confirmed, ...input } = action; void _kind; void _confirmed;
        const entry = await createFinanceService({ database, authorization, now: options.now }).command(context, { ...input, action: "CREATE_ENTRY", direction: "EXPENSE", idempotencyKey: confirmation.idempotencyKey }) as { id: string };
        result = { answer: action.status === "SETTLED" ? "Despesa registrada como paga, conforme sua declaração de pagamento real." : "Despesa registrada como conta a pagar.", result: { id: entry.id }, targetType: "FinancialEntry", targetId: entry.id, links: linksFor(action.kind) };
      } else {
        const { kind: _kind, receiptConfirmed: _receipt, ...input } = action; void _kind; void _receipt;
        const receipt = await createPaymentService({ database, now: options.now }).recordReceipt(context, { ...input, confirmed: true, idempotencyKey: confirmation.idempotencyKey });
        result = { answer: "Recebimento registrado e cobrança atualizada. O financeiro e os indicadores usam esse mesmo pagamento.", result: json(receipt), targetType: "Invoice", targetId: action.invoiceId, links: linksFor(action.kind, action.invoiceId) };
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.action.executed", entityType: result.targetType, entityId: result.targetId, changes: { kind: action.kind, confirmed: true }, metadata: json({ idempotencyKey: confirmation.idempotencyKey, fingerprint, result }) } });
      return result;
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  }

  async function formOptions(context: AuthenticatedContext, query = ""): Promise<CopilotActionOptions> {
    const database = options.database;
    const authorization = createAuthorizationService({ database });
    const result: CopilotActionOptions = { capabilities: [], leads: [], customers: [], categories: [], financialAccounts: [], invoices: [], truncated: false };
    const allowed = async (key: PermissionKey, resource: ResourceScope) => (await authorization.authorize(context, key, resource)).allowed;
    const terms = copilotSearchTerms(query);
    const limit = query.trim() ? 25 : 100;
    const leadList = createLeadListService({ database, authorization, distribution: getLeadDistributionService(), now: options.now });
    const leadMatches = await searchCopilotPages(terms, async (q) => {
      try {
        const page = await leadList.getScreen(context, { q, pageSize: limit, sort: "receivedAt", direction: "desc" });
        return { items: page.list.rows, total: page.list.total };
      } catch (error) {
        if (error instanceof ApplicationError && error.statusCode === 403) return { items: [], total: 0 };
        throw error;
      }
    }, limit);
    const leads = await database.lead.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, id: { in: leadMatches.items.map((item) => item.id) } }, orderBy: { updatedAt: "desc" }, include: { routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } });
    for (const lead of leads.slice(0, 100)) {
      const scope = { workspaceId: context.workspaceId, resourceType: "Lead", resourceId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null };
      if (await allowed(PermissionKeys.LEADS_READ, scope) && await allowed(PermissionKeys.TASKS_READ, scope) && await allowed(PermissionKeys.TASKS_WRITE, scope)) result.leads.push({ id: lead.id, name: lead.fullName });
    }
    result.truncated = leadMatches.truncated;
    if (result.leads.length) result.capabilities.push("CREATE_TASK");
    const accountScope = { workspaceId: context.workspaceId, resourceType: "Account" };
    if (await allowed(PermissionKeys.ACCOUNTS_READ, accountScope) && await allowed(PermissionKeys.ACCOUNTS_WRITE, accountScope)) {
      const accountService = createAccountService({ database, authorization, now: options.now });
      const matches = await searchCopilotPages(terms, (search) => accountService.list(context, { search, pageSize: limit }), limit);
      const accounts = await database.account.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, id: { in: matches.items.map((item) => item.id) } }, orderBy: { updatedAt: "desc" } });
      result.customers = accounts.slice(0, 100).map((row) => ({ id: row.id, name: row.name, revision: row.revision, legalName: row.legalName, domain: row.originalDomain, segment: row.segment, size: row.size }));
      result.truncated ||= matches.truncated;
      result.capabilities.push("UPDATE_CUSTOMER");
    }
    const financeScope = { workspaceId: context.workspaceId, resourceType: "Finance" };
    if (await allowed(PermissionKeys.FINANCE_READ, financeScope) && await allowed(PermissionKeys.FINANCE_MANAGE, financeScope)) {
      const [categories, accounts, invoices] = await Promise.all([
        database.financialCategory.findMany({ where: { workspaceId: context.workspaceId, active: true, kind: "EXPENSE" }, take: limit + 1, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        database.financialAccount.findMany({ where: { workspaceId: context.workspaceId, active: true }, take: limit + 1, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        database.invoice.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "PARTIALLY_PAID"] }, ...(terms.length ? { OR: terms.flatMap((term) => [{ invoiceNumber: { contains: term, mode: "insensitive" as const } }, { accountNameSnapshot: { contains: term, mode: "insensitive" as const } }, { descriptionSnapshot: { contains: term, mode: "insensitive" as const } }]) } : {}) }, take: limit + 1, orderBy: { dueAt: "asc" } }),
      ]);
      result.categories = categories.slice(0, limit); result.financialAccounts = accounts.slice(0, limit);
      result.capabilities.push("CREATE_EXPENSE"); result.truncated ||= categories.length > limit || accounts.length > limit || invoices.length > limit;
      for (const invoice of invoices.slice(0, limit)) {
        const scope = { workspaceId: context.workspaceId, resourceType: "Payment", resourceId: invoice.id, ownerMemberId: invoice.ownerMemberId };
        if (await allowed(PermissionKeys.PAYMENTS_READ, scope) && await allowed(PermissionKeys.PAYMENTS_MANAGE, scope)) result.invoices.push({ id: invoice.id, label: `${invoice.invoiceNumber} · ${invoice.accountNameSnapshot}`, revision: invoice.revision, outstandingCents: (invoice.totalCents - invoice.paidCents).toString() });
      }
      if (result.invoices.length) result.capabilities.push("RECORD_PAYMENT");
    }
    return result;
  }
  return { authorize, preview, execute, options: formOptions };
}

export function getCopilotActionsService() { return createCopilotActionsService({ database: getDatabaseClient(), now: () => new Date() }); }
