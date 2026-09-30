import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAccountService } from "@/modules/accounts/application/account-service";
import { getOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { copilotRecordQuerySchema, type CopilotRecordQuery, type CopilotRecordResult } from "@/modules/ai-assistant/domain/copilot-record-contracts";
import { getContractService } from "@/modules/contracts/application/contract-service";
import { getPostSaleOperatingReviewService } from "@/modules/customer-success/application/post-sale-operating-review-service";
import { getLeadListService } from "@/modules/leads/application/lead-list-service";
import { getMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { getOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { getRevenueService } from "@/modules/revenue/application/revenue-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { addLocalDays, workspaceDateAt, workspaceDayRange, workspaceWeekRange } from "@/shared/core/time/workspace-time";

type RecordRow = CopilotRecordResult["records"][number];
const sources = {
  database: getDatabaseClient, authorization: getAuthorizationService,
  accounts: getAccountService, operations: getOperationalHistoryService, leads: getLeadListService,
  contracts: getContractService, media: getMediaPerformanceService,
  meetings: getMeetingService, onboarding: getOnboardingService, opportunities: getOpportunityService,
  payments: getPaymentService, revenue: getRevenueService, customerSuccess: getPostSaleOperatingReviewService,
};
const labels: Record<CopilotRecordQuery["entity"], [string, string, string]> = {
  LEAD: ["leads", "Leads", "/leads"], CUSTOMER: ["clientes", "Clientes", "/contas"], OPPORTUNITY: ["oportunidades", "Negócios", "/oportunidades"],
  TASK: ["tarefas", "Tarefas", "/leads"], INVOICE: ["cobrancas", "Cobranças", "/pagamentos"], SUBSCRIPTION: ["receita", "Assinaturas", "/receita"],
  EXPENSE: ["despesas", "Despesas", "/financeiro"], CONTRACT: ["contratos", "Contratos", "/contratos"], ONBOARDING: ["onboarding", "Onboarding", "/onboarding"],
  MEETING: ["agenda", "Agenda", "/agenda"], AD_PERFORMANCE: ["anuncios", "Anúncios", "/aquisicao/midia"], CATEGORY: ["categorias_financeiras", "Categorias financeiras", "/financeiro"], FINANCIAL_ACCOUNT: ["contas_financeiras", "Contas financeiras", "/financeiro"],
  CUSTOMER_SUCCESS: ["pos_venda", "Customer Success", "/customer-success"],
};
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const json = (value: object): Record<string, unknown> => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item));
function fail(message: string, code = "COPILOT_SEARCH_INVALID", statusCode = 422): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
function row(id: string, label: string, href: string, data: object): RecordRow { return { id, label, href, data: json(data) }; }
function selected(rows: RecordRow[], query: CopilotRecordQuery) {
  return rows.filter((item) => query.id ? item.id === query.id : !query.query || normalize(`${item.label} ${JSON.stringify(item.data)}`).includes(normalize(query.query)));
}

/** Read-only adapters reuse module authorization; only explicit safe fields leave this boundary. */
export function createCopilotRecordSearchService(overrides: Partial<typeof sources> = {}, now = () => new Date()) {
  const service = { ...sources, ...overrides };

  async function dateRange(context: AuthenticatedContext, query: CopilotRecordQuery, fallback: "MONTH" | "WEEK" = "MONTH") {
    const workspace = await service.database().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
    const today = workspaceDateAt(now(), workspace.timeZone);
    const week = workspaceWeekRange(today, workspace.timeZone);
    const from = query.from ?? (fallback === "WEEK" ? week.startDate : `${today.slice(0, 7)}-01`);
    const to = query.to ?? (fallback === "WEEK" ? week.endDate : today);
    const start = workspaceDayRange(from, workspace.timeZone).start;
    const end = workspaceDayRange(to, workspace.timeZone).end;
    if (end.getTime() - start.getTime() > 367 * 86_400_000) fail("Consulte intervalos de até 366 dias.");
    return { from, to, start, end, timeZone: workspace.timeZone };
  }

  async function search(context: AuthenticatedContext, raw: unknown): Promise<CopilotRecordResult> {
    const query = copilotRecordQuerySchema.parse(raw);
    const [key, label, href] = labels[query.entity];
    const source = { key, label, href };
    const filters = { query: query.query, ...(query.id ? { id: query.id } : {}), ...(query.leadId ? { leadId: query.leadId } : {}), ...(query.from && query.to ? { from: query.from, to: query.to } : {}) };
    const offset = (query.page - 1) * query.pageSize;
    const result = (records: RecordRow[], total: number, coverage: string, alreadyPaged = false): CopilotRecordResult => {
      if (query.id && records.length === 0) fail("Registro não encontrado ou não autorizado.", "NOT_FOUND", 404);
      const hasMore = !query.id && offset + query.pageSize < total;
      return { entity: query.entity, source, filters, page: query.id ? 1 : query.page, pageSize: query.id ? 1 : query.pageSize, total, hasMore, nextPage: hasMore && query.page < 1000 ? query.page + 1 : null, records: alreadyPaged || query.id ? records : records.slice(offset, offset + query.pageSize), coverage: `${coverage}${hasMore && query.page === 1000 ? " Limite de navegação atingido; refine a busca por nome ou período." : ""}` };
    };
    const filtered = (records: RecordRow[], coverage: string) => { const matches = selected(records, query); return result(matches, matches.length, coverage); };

    if (query.entity === "LEAD") {
      if (query.id) {
        const data = await service.operations().getLeadOperations(context, { leadId: query.id, pageSize: 1 });
        const item = data.lead;
        return result([row(item.id, item.fullName, `/leads/${item.id}`, { id: item.id, name: item.fullName, fullName: item.fullName, organizationName: item.organizationName, account: item.account, status: item.status, stageName: item.stageName, ownerMemberId: item.ownerMemberId, responsibleName: item.operationalOwner, sourceName: item.sourceName, campaignName: item.campaignName, creativeName: item.creativeName, nextAction: item.nextAction, interestSummary: item.interestSummary, canManageTasks: data.permissions.canManageTasks })], 1, "Detalhe operacional autorizado pelas permissões canônicas de lead e tarefas, sem telefone, e-mail ou payload de formulário.");
      }
      const data = await service.leads().getScreen(context, { q: query.query, page: query.page, pageSize: query.pageSize, sort: "name", direction: "asc", ...(query.from ? { enteredFrom: query.from, enteredTo: query.to } : {}) });
      const items = offset < data.list.total ? data.list.rows : [];
      return result(items.map((item) => row(item.id, item.fullName, `/leads/${item.id}`, { id: item.id, name: item.fullName, fullName: item.fullName, organizationName: item.organizationName, status: item.status, responsibleName: item.responsibleName, sourceName: item.sourceName, stageName: item.stageName, nextActionAt: item.nextActionAt, nextActionDescription: item.nextActionDescription })), data.list.total, "Busca e escopo aplicados no banco antes da página. Período, quando informado, filtra a entrada do lead.", true);
    }
    if (query.entity === "CUSTOMER") {
      if (query.id) {
        const item = await service.accounts().get(context, query.id);
        return result([row(item.id, item.name, `/contas/${item.id}`, { id: item.id, name: item.name, revision: item.revision, legalName: item.legalName, domain: item.originalDomain, segment: item.segment, size: item.size, status: item.status, quality: item.quality, ownership: item.ownership })], 1, "Detalhe cadastral autorizado; contratos, recebimentos e outros módulos exigem suas próprias consultas.");
      }
      // The canonical customer page has a minimum size of ten. Translate the
      // requested window, including a boundary crossing, without losing rows.
      const size = Math.max(10, query.pageSize);
      const page = Math.floor(offset / size) + 1;
      const first = await service.accounts().list(context, { search: query.query, page, pageSize: size });
      const second = offset % size + query.pageSize > size && first.total > page * size ? await service.accounts().list(context, { search: query.query, page: page + 1, pageSize: size }) : null;
      const items = [...first.items, ...(second?.items ?? [])].slice(offset % size, offset % size + query.pageSize);
      return result(items.map((item) => row(item.id, item.name, `/contas/${item.id}`, { id: item.id, name: item.name, legalName: item.legalName, revision: item.revision, segment: item.segment, size: item.size, status: item.status, quality: item.quality })), first.total, "Nome, razão social ou domínio e escopo filtrados no banco antes da paginação. Cadastro atual.", true);
    }
    if (query.entity === "TASK") {
      // getLeadOperations authorizes LEADS_READ and TASKS_READ for this exact
      // lead. Its UI caps tasks at 100, so read this authorized lead's full task
      // relation with filtering and pagination instead of paging that sample.
      await service.operations().getLeadOperations(context, { leadId: query.leadId, pageSize: 1 });
      const dates = query.from ? await dateRange(context, query) : null;
      const where: Prisma.TaskWhereInput = { workspaceId: context.workspaceId, leadId: query.leadId!, deletedAt: null, ...(query.id ? { id: query.id } : {}), ...(dates ? { dueAt: { gte: dates.start, lt: dates.end } } : {}), ...(query.query && !query.id ? { OR: [{ title: { contains: query.query, mode: "insensitive" } }, { description: { contains: query.query, mode: "insensitive" } }] } : {}) };
      const [items, total] = await Promise.all([service.database().task.findMany({ where, orderBy: [{ dueAt: "asc" }, { id: "asc" }], skip: query.id ? 0 : offset, take: query.id ? 1 : query.pageSize, select: { id: true, leadId: true, opportunityId: true, title: true, description: true, kind: true, status: true, priority: true, dueAt: true, completedAt: true, assigneeMemberId: true } }), service.database().task.count({ where })]);
      return result(items.map((item) => row(item.id, item.title, `/leads/${query.leadId}`, item)), total, "Todas as tarefas não excluídas do lead autorizado; nome/descrição filtrados no banco antes da página, incluindo tarefas além do limite da tela. Período filtra o prazo.", true);
    }
    if (query.entity === "OPPORTUNITY") {
      await service.authorization().assertAuthorized(context, PermissionKeys.OPPORTUNITIES_READ, { workspaceId: context.workspaceId, resourceType: "OpportunityPipeline", ownerMemberId: context.memberId });
      const pipelines = await service.database().pipeline.findMany({ where: { workspaceId: context.workspaceId, entityType: "OPPORTUNITY", deletedAt: null }, select: { id: true }, orderBy: { id: "asc" } });
      const screens = await Promise.all(pipelines.map((pipeline) => service.opportunities().getPipelineScreen(context, { pipelineId: pipeline.id, ...(query.from ? { from: query.from, to: query.to } : {}) })));
      const items = screens.flatMap((screen) => screen.stages.flatMap((stage) => stage.opportunities));
      return filtered(items.map((item) => row(item.id, item.name, `/oportunidades?opportunityId=${item.id}`, { id: item.id, name: item.name, revision: item.revision, leadId: item.leadId, leadName: item.leadName, accountId: item.accountId, accountName: item.accountName, ownerMemberId: item.ownerMemberId, status: item.status, stageName: item.stageName, amountCents: item.amountCents, mrrCents: item.mrrCents, tcvCents: item.tcvCents, canWrite: item.canWrite, offers: item.offers.map((offer) => ({ id: offer.id, name: offer.name, totalCents: offer.totalCents })) })), "Todos os pipelines comerciais não excluídos, com escopo e acesso por origem aplicados pelo serviço canônico. Busca antes da paginação; período filtra criação.");
    }
    if (query.entity === "INVOICE") {
      if (query.id) {
        const data = await service.payments().detail(context, query.id);
        const item = data.invoice;
        return result([row(item.id, `${item.invoiceNumber} · ${item.accountNameSnapshot}`, `/pagamentos/${item.id}`, { id: item.id, invoiceNumber: item.invoiceNumber, accountId: item.accountId, accountName: item.accountNameSnapshot, description: item.descriptionSnapshot, revision: item.revision, status: item.status, totalCents: item.totalCents, paidCents: item.paidCents, outstandingCents: item.totalCents - item.paidCents, dueAt: item.dueAt, currency: item.currency, canRecordReceipt: data.permissions.recordReceipt })], 1, "Cobrança reautorizada por ID; valores em centavos. Saldo em aberto não comprova pagamento.");
      }
      const data = await service.payments().screen(context, { query: query.query });
      const dates = query.from ? await dateRange(context, query) : null;
      const visible = data.invoices.filter((item) => !dates || (new Date(item.dueAt) >= dates.start && new Date(item.dueAt) < dates.end));
      const ids = visible.slice(offset, offset + query.pageSize).map((item) => item.id);
      const accounts = ids.length ? await service.database().invoice.findMany({ where: { workspaceId: context.workspaceId, id: { in: ids } }, select: { id: true, accountId: true } }) : [];
      const accountByInvoice = new Map(accounts.map((item) => [item.id, item.accountId]));
      return result(visible.slice(offset, offset + query.pageSize).map((item) => row(item.id, `${item.invoiceNumber} · ${item.accountName}`, `/pagamentos/${item.id}`, { ...item, accountId: accountByInvoice.get(item.id) ?? null })), visible.length, "Todas as cobranças autorizadas, incluindo histórico. Nome/número antes da página; período filtra vencimento. Pagamento real exige confirmação própria.", true);
    }
    if (query.entity === "SUBSCRIPTION") {
      if (query.id) {
        const data = await service.revenue().detail(context, query.id);
        const item = data.subscription;
        return result([row(item.id, `${item.subscriptionNumber} · ${item.accountNameSnapshot}`, `/receita?subscriptionId=${item.id}`, { id: item.id, number: item.subscriptionNumber, accountId: item.accountId, accountName: item.accountNameSnapshot, productName: item.productNameSnapshot, status: item.status, revision: item.revision, currentMrrCents: item.currentMrrCents, startsAt: item.startsAt, endsAt: item.endsAt, billingInterval: item.billingInterval })], 1, "Assinatura autorizada por ID; MRR contratado não equivale a caixa recebido.");
      }
      const data = await service.revenue().list(context);
      return filtered(data.subscriptions.map((item) => row(item.id, `${item.subscriptionNumber} · ${item.accountNameSnapshot}`, `/receita?subscriptionId=${item.id}`, { id: item.id, number: item.subscriptionNumber, accountId: item.accountId, accountName: item.accountNameSnapshot, productName: item.productNameSnapshot, status: item.status, currentMrrCents: item.currentMrrCents, revision: item.revision })), "Todas as assinaturas autorizadas no estado atual, inclusive encerradas; busca antes da paginação. Para movimentos históricos, consulte o módulo de receita.");
    }
    if (["EXPENSE", "CATEGORY", "FINANCIAL_ACCOUNT"].includes(query.entity)) {
      // Finance uses workspace-scoped FINANCE_READ, matching its canonical
      // screen. No payment, commission or mutation grants are inferred here.
      await service.authorization().assertAuthorized(context, PermissionKeys.FINANCE_READ, { workspaceId: context.workspaceId, resourceType: "Finance" });
      if (query.entity === "CATEGORY" || query.entity === "FINANCIAL_ACCOUNT") {
        const data = query.entity === "CATEGORY" ? await service.database().financialCategory.findMany({ where: { workspaceId: context.workspaceId }, select: { id: true, key: true, name: true, kind: true, active: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }) : await service.database().financialAccount.findMany({ where: { workspaceId: context.workspaceId }, select: { id: true, name: true, type: true, active: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
        return filtered(data.map((item) => row(item.id, item.name, "/financeiro", item)), "Todos os cadastros financeiros autorizados, ativos e inativos; a execução posterior exige cadastro ativo e permissão de gestão.");
      }
      const dates = query.from ? await dateRange(context, query) : null;
      const where: Prisma.FinancialEntryWhereInput = { workspaceId: context.workspaceId, direction: "EXPENSE", ...(query.id ? { id: query.id } : {}), AND: [...(query.query && !query.id ? [{ OR: [{ description: { contains: query.query, mode: "insensitive" as const } }, { counterparty: { contains: query.query, mode: "insensitive" as const } }] }] : []), ...(dates ? [{ OR: [{ competenceAt: { gte: dates.start, lt: dates.end } }, { dueAt: { gte: dates.start, lt: dates.end } }, { settledAt: { gte: dates.start, lt: dates.end } }] }] : [])] };
      const [items, total] = await Promise.all([service.database().financialEntry.findMany({ where, orderBy: [{ dueAt: "desc" }, { id: "asc" }], skip: query.id ? 0 : offset, take: query.id ? 1 : query.pageSize, select: { id: true, description: true, counterparty: true, status: true, amountCents: true, categoryId: true, financialAccountId: true, customerAccountId: true, competenceAt: true, dueAt: true, settledAt: true, revision: true } }), service.database().financialEntry.count({ where })]);
      return result(items.map((item) => row(item.id, item.description, "/financeiro", item)), total, "Despesas manuais de toda a base autorizada; busca no banco antes da página. Período, se informado, considera competência, vencimento ou quitação; estornos automáticos não são despesas manuais.", true);
    }
    if (query.entity === "CONTRACT") {
      const data = await service.contracts().getScreen(context, {});
      return filtered(data.items.map((item) => row(item.id, `${item.contractNumber} · ${item.accountName}`, `/contratos?contractId=${item.id}`, { id: item.id, number: item.contractNumber, accountName: item.accountName, opportunityId: item.opportunityId, opportunityName: item.opportunityName, status: item.status, revision: item.revision, acceptedAt: item.acceptedAt, effectiveStartsAt: item.effectiveStartsAt, effectiveEndsAt: item.effectiveEndsAt, currentVersion: item.currentVersion ? { id: item.currentVersion.id, versionNumber: item.currentVersion.versionNumber, state: item.currentVersion.state, totalCents: item.currentVersion.totalCents, mrrCents: item.currentVersion.mrrCents, tcvCents: item.currentVersion.tcvCents } : null })), "Todos os contratos autorizados; busca por número/cliente/negócio antes da página. Sem HTML assinado ou conteúdo privado de outros módulos.");
    }
    if (query.entity === "ONBOARDING") {
      const data = await service.onboarding().screen(context);
      const accountIds = [...new Set(data.cases.map((item) => item.accountId))];
      const accounts = accountIds.length ? await service.database().account.findMany({ where: { workspaceId: context.workspaceId, id: { in: accountIds } }, select: { id: true, name: true } }) : [];
      const names = new Map(accounts.map((item) => [item.id, item.name]));
      return filtered(data.cases.map((item) => row(item.id, names.get(item.accountId) ?? "Onboarding", `/onboarding?caseId=${item.id}`, { id: item.id, accountId: item.accountId, accountName: names.get(item.accountId) ?? null, status: item.status, ownerMemberId: item.ownerMemberId, targetAt: item.targetAt, nextActionAt: item.nextActionAt, nextActionDescription: item.nextActionDescription, milestones: query.id ? item.milestones.map((milestone) => ({ id: milestone.id, title: milestone.nameSnapshot, status: milestone.status, required: milestone.required, dueAt: milestone.dueAt })) : undefined })), "Todos os casos autorizados no estado atual, com nome do cliente vinculado. Busca antes da página; marcos detalhados ao abrir o ID.");
    }
    if (query.entity === "CUSTOMER_SUCCESS") {
      const permission = service.authorization();
      await permission.assertAuthorized(context, PermissionKeys.CUSTOMER_SUCCESS_READ, { workspaceId: context.workspaceId, resourceType: "CustomerSuccess", ownerMemberId: context.memberId });
      if (query.id) {
        const data = await service.customerSuccess().accountReview(context, query.id);
        return result([row(data.account.id, data.account.name, `/customer-success?accountId=${data.account.id}`, { id: data.account.id, accountId: data.account.id, name: data.account.name, assignmentId: data.assignment.id, ownerMemberId: data.assignment.ownerMemberId, state: data.assignment.state, nextActionAt: data.assignment.nextActionAt, nextActionDescription: data.assignment.nextActionDescription, adoption: data.adoption, deliverables: data.deliverables, health: data.health, requests: data.requests, risks: data.risks, renewal: data.renewal })], 1, "Revisão canônica de pós-venda da carteira vigente autorizada; ID corresponde ao cliente.");
      }
      // The CS screen paginates before exposing names and has no name filter.
      // Match account names first, then apply its exact per-assignment scope.
      const accounts = await service.database().account.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, ...(query.query ? { OR: [{ name: { contains: query.query, mode: "insensitive" as const } }, { legalName: { contains: query.query, mode: "insensitive" as const } }] } : {}) }, select: { id: true, name: true } });
      const names = new Map(accounts.map((item) => [item.id, item.name]));
      const candidates = await service.database().customerPortfolioAssignment.findMany({ where: { workspaceId: context.workspaceId, validTo: null, accountId: { in: accounts.map((item) => item.id) } }, orderBy: [{ priority: "asc" }, { nextActionAt: "asc" }, { accountId: "asc" }] });
      const visible = [];
      for (const item of candidates) if ((await permission.authorize(context, PermissionKeys.CUSTOMER_SUCCESS_READ, { workspaceId: context.workspaceId, resourceType: "CustomerSuccess", resourceId: item.accountId, ownerMemberId: item.ownerMemberId, teamId: item.teamId, queueId: item.queueId })).allowed) visible.push(item);
      return result(visible.map((item) => row(item.accountId, names.get(item.accountId)!, `/customer-success?accountId=${item.accountId}`, { id: item.accountId, accountId: item.accountId, name: names.get(item.accountId), assignmentId: item.id, ownerMemberId: item.ownerMemberId, state: item.state, revision: item.revision, nextActionAt: item.nextActionAt, nextActionDescription: item.nextActionDescription })), visible.length, "Todas as carteiras vigentes autorizadas; nome/razão social filtrados na base antes da página, escopo idêntico ao serviço de Customer Success. Abra o ID do cliente para saúde, adoção e entregas.");
    }
    if (query.entity === "MEETING") {
      if (query.id) {
        const data = await service.meetings().getBriefing(context, { meetingId: query.id });
        return result([row(data.meeting.id, data.meeting.title, `/agenda?meetingId=${data.meeting.id}`, data.meeting)], 1, "Reunião autorizada por ID, sem transcrição ou conteúdo de integração externa.");
      }
      const range = await dateRange(context, query, "WEEK");
      if (range.end.getTime() - range.start.getTime() > 32 * 86_400_000) fail("A agenda permite até 31 dias por consulta; divida períodos maiores.");
      const items = new Map<string, Awaited<ReturnType<ReturnType<typeof getMeetingService>["getAgenda"]>>["meetings"][number]>();
      for (let day = range.from; day <= range.to; day = addLocalDays(day, 7)) {
        const data = await service.meetings().getAgenda(context, { date: day, view: "week" });
        for (const item of data.meetings) if (new Date(item.startsAt) >= range.start && new Date(item.startsAt) < range.end && (!query.leadId || item.leadId === query.leadId)) items.set(item.id, item);
      }
      // A range can end in a different calendar week than its seven-day steps.
      const last = await service.meetings().getAgenda(context, { date: range.to, view: "week" });
      for (const item of last.meetings) if (new Date(item.startsAt) >= range.start && new Date(item.startsAt) < range.end && (!query.leadId || item.leadId === query.leadId)) items.set(item.id, item);
      return filtered([...items.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)).map((item) => row(item.id, `${item.title} · ${item.leadName}`, `/agenda?meetingId=${item.id}`, { id: item.id, leadId: item.leadId, opportunityId: item.opportunityId, title: item.title, leadName: item.leadName, closerName: item.closerName, status: item.status, startsAt: item.startsAt, endsAt: item.endsAt, revision: item.revision })), `Agenda autorizada de ${range.from} a ${range.to}, em ${range.timeZone}; semanas consultadas sem duplicação, busca antes da página.`);
    }
    const range = await dateRange(context, query);
    const data = await service.media().getScreen(context, { periodStart: range.start.toISOString(), periodEnd: range.end.toISOString() });
    const records = Object.entries(data.mediaBreakdown).flatMap(([dimension, values]) => values.map((item) => row(`${dimension}:${item.key}`, `${dimension}: ${item.label}`, "/aquisicao/midia", { ...item, dimension, period: data.period })));
    return filtered(records, `Performance importada de ${range.from} a ${range.to}, por canal/campanha/criativo; mesmas métricas canônicas da mídia, sem inferir atribuição causal ou caixa recebido. Busca antes da página. ${data.missingInformation.join("; ")}`);
  }

  return { search };
}

export async function searchCopilotRecords(context: AuthenticatedContext, raw: unknown): Promise<CopilotRecordResult> {
  return createCopilotRecordSearchService().search(context, raw);
}
