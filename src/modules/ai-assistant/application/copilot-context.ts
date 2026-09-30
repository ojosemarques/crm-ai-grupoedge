import { getAccountService } from "@/modules/accounts/application/account-service";
import { getOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { getLeadListService } from "@/modules/leads/application/lead-list-service";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getFinanceService } from "@/modules/finance/application/finance-service";
import { getOpportunityService } from "@/modules/opportunities/application/opportunity-service";
import { getContractService } from "@/modules/contracts/application/contract-service";
import { getCustomerSuccessService } from "@/modules/customer-success/application/customer-success-service";
import { getMarketingAttributionService } from "@/modules/marketing/application/marketing-attribution-service";
import { getMediaPerformanceService } from "@/modules/marketing/application/media-performance-service";
import { getIntegrationPlatformService } from "@/modules/integrations/application/integration-platform-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { getDatabaseClient } from "@/shared/core/database/client";
import { resolveCopilotPeriod } from "@/modules/ai-assistant/domain/copilot-period";
import { compactCopilotData, copilotSearchTerms, searchCopilotPages } from "@/modules/ai-assistant/domain/copilot-search";
import { getPaymentService } from "@/modules/payments/application/payment-service";
import { getRevenueService } from "@/modules/revenue/application/revenue-service";
import { getOnboardingService } from "@/modules/onboarding/application/onboarding-service";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { workspaceDateAt } from "@/shared/core/time/workspace-time";

export type CopilotSource = { key: string; label: string; href: string; data: unknown };
export type CopilotContext = { sources: CopilotSource[]; unavailable: string[]; period?: ReturnType<typeof resolveCopilotPeriod> };

// The module services remain the authoritative boundary for row, team and tenant access.
export async function loadCopilotContext(context: AuthenticatedContext, message = "", now = new Date(), retrievalQuery = message): Promise<CopilotContext> {
  const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
  const period = resolveCopilotPeriod(message, now, workspace.timeZone, retrievalQuery);
  const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const question = normalized(message);
  const retrieval = normalized(retrievalQuery);
  const terms = copilotSearchTerms(retrievalQuery);
  const general = /\btudo\b|visao geral|resumo geral|sistema completo/.test(question);
  const loaders = [
    ...(general || terms.length || /client|cadastro|conta.*empresa/.test(question) ? [{ key: "clientes", label: "Clientes", href: "/contas", load: async () => {
      const service = getAccountService();
      const [all, data] = await Promise.all([service.list(context, { pageSize: 10 }), searchCopilotPages(terms, (search) => service.list(context, { search, pageSize: 20 }), 30)]);
      const matching = data.items.filter((item) => item.name.length > 2 && retrieval.includes(normalized(item.name)));
      const detail = matching.length === 1 ? await getAccountService().get(context, matching[0]!.id) : null;
      return { total: all.total, sampleLimit: 30, queries: data.queries, truncated: data.truncated, coverage: "Busca por termos antes da paginação; resultados autorizados e deduplicados. Refine nomes ambíguos entre aspas. Total é o cadastro autorizado, não o número de correspondências.", clients: data.items, detail: detail ? { id: detail.id, name: detail.name, legalName: detail.legalName, domain: detail.originalDomain, segment: detail.segment, size: detail.size, status: detail.status, ownership: detail.ownership, leads: detail.leads, onboarding: detail.onboarding, customerSuccess: detail.customerSuccess, requests: detail.requests } : null };
    } }] : []),
    ...(general || terms.length || /tarefa|atividade|prazo|follow.?up|lead/.test(question) ? [{ key: "tarefas", label: "Leads e tarefas", href: "/leads", load: async () => {
      const data = await searchCopilotPages(terms, async (q) => { const screen = await getLeadListService().getScreen(context, { q, pageSize: 20, sort: "nextAction", direction: "asc" }); return { items: screen.list.rows, total: screen.list.total }; }, 30);
      const rows = [...data.items].sort((a, b) => Number(retrieval.includes(normalized(b.fullName))) - Number(retrieval.includes(normalized(a.fullName)))).slice(0, 5);
      const snapshots = await Promise.all(rows.map(async (lead) => {
        try {
          const operations = await getOperationalHistoryService().getLeadOperations(context, { leadId: lead.id, pageSize: 1 });
          return { leadId: lead.id, leadName: lead.fullName, tasks: operations.tasks.filter((task) => task.status === "OPEN" || task.status === "IN_PROGRESS").slice(0, 10).map(({ id, title, kind, status, priority, dueAt, overdue }) => ({ id, title, kind, status, priority, dueAt, overdue })) };
        } catch (error) {
          if (error instanceof ApplicationError && error.statusCode === 403) return null;
          throw error;
        }
      }));
      if (rows.length && snapshots.every((item) => item === null)) throw new ApplicationError("Tarefas não autorizadas.", { code: "FORBIDDEN", statusCode: 403 });
      return { coverage: "Até 5 leads autorizados encontrados por nome antes da paginação, ou priorizados por próxima ação quando não há termo; até 10 tarefas abertas por lead. Não representa todas as tarefas da empresa.", queries: data.queries, truncated: data.truncated || data.items.length > rows.length, leadSampleLimit: 5, taskSampleLimit: 10, leads: snapshots.filter((item) => item !== null) };
    } }] : []),
    { key: "financeiro", label: "Financeiro", href: "/financeiro", load: async () => {
      const data = await getFinanceService().screen(context, { from: period.from, to: period.to });
      return { period: data.period, coverage: "Receitas, despesas e DRE respeitam o período; MRR e contas em aberto representam o estado atual, não uma reconstrução histórica.", summary: data.summary, dre: data.dre, cashFlow: data.cashFlow, commissionRules: data.commissionRules, receivables: data.receivables.slice(0, 30), sampleLimit: 30, receivableCount: data.receivables.length };
    } },
    { key: "oportunidades", label: "Pipeline de vendas", href: "/oportunidades", load: async () => {
      const data = await getOpportunityService().getPipelineScreen(context, {});
      const relevant = (names: readonly (string | null)[]) => names.some((name) => name && name.length > 2 && (retrieval.includes(normalized(name)) || terms.some((term) => normalized(name).includes(normalized(term)))));
      const rows = data.stages.flatMap((stage) => stage.opportunities).sort((a, b) => Number(relevant([b.name, b.leadName, b.accountName])) - Number(relevant([a.name, a.leadName, a.accountName])));
      return { generatedAt: data.generatedAt, sellers: data.closerOptions, stages: data.stages.map((stage) => ({ name: stage.name, count: stage.count })), opportunities: rows.slice(0, 30).map((item) => ({ id: item.id, revision: item.revision, name: item.name, leadId: item.leadId, leadName: item.leadName, accountId: item.accountId, accountName: item.accountName, ownerMemberId: item.ownerMemberId, ownerName: item.ownerName, status: item.status, stageName: item.stageName, amountCents: item.amountCents, mrrCents: item.mrrCents, tcvCents: item.tcvCents, sourceName: item.sourceName, offers: item.offers.slice(0, 5).map((offer) => ({ id: offer.id, name: offer.name, totalCents: offer.totalCents })), canWrite: item.canWrite })), sampleLimit: 30, truncated: rows.length > 30, matchingRecordsFirst: true };
    } },
    ...(general || /cobranc|fatura|pagamento|recebimento|inadimpl|vencid/.test(question) ? [{ key: "cobrancas", label: "Cobranças e recebimentos", href: "/pagamentos", load: async () => {
      const data = await getPaymentService().screen(context);
      const rows = terms.length ? data.invoices.filter((item) => terms.some((term) => normalized(`${item.accountName} ${item.invoiceNumber} ${item.description}`).includes(normalized(term)))) : data.invoices;
      return { generatedAt: data.generatedAt, currency: data.currency, metrics: data.metrics, coverage: "Estado atual das cobranças autorizadas; métricas acumuladas, sem filtro histórico do período. Valores recebidos excluem sandbox. Lista filtrada por termos da conversa.", queries: terms, invoices: rows.slice(0, 25), matchedCount: rows.length, sampleLimit: 25, truncated: rows.length > 25 };
    } }] : []),
    ...(general || /receita|recorrent|assinatura|mrr|arr|churn/.test(question) ? [{ key: "receita", label: "Receita recorrente", href: "/receita", load: async () => {
      const data = await getRevenueService().summary(context, new Date(period.from), new Date(period.to));
      const rows = terms.length ? data.subscriptions.filter((item) => terms.some((term) => normalized(`${item.accountNameSnapshot} ${item.subscriptionNumber} ${item.productNameSnapshot}`).includes(normalized(term)))) : data.subscriptions;
      return { cutoff: data.cutoff, interval: data.interval, currency: data.currency, formula: data.formula, mrrCents: data.mrrCents.toString(), arrCents: data.arrCents.toString(), netNewMrrCents: data.netNewMrrCents.toString(), movements: data.movements, statusCounts: data.statusCounts, coverage: "MRR e ARR são receita recorrente contratada efetiva no corte, não caixa recebido. Estado das assinaturas é atual; movimentos seguem o intervalo informado.", subscriptions: rows.slice(0, 25).map((item) => ({ id: item.id, number: item.subscriptionNumber, accountId: item.accountId, accountName: item.accountNameSnapshot, status: item.status, currentMrrCents: item.currentMrrCents.toString() })), sampleLimit: 25, truncated: rows.length > 25 };
    } }] : []),
    ...(general || /onboarding|implantac|handoff|entrega|ativac/.test(question) ? [{ key: "onboarding", label: "Onboarding e entrega", href: "/onboarding", load: async () => {
      const data = await getOnboardingService().screen(context);
      return { generatedAt: data.generatedAt, metrics: data.metrics, formulas: data.formulas, coverage: "Casos autorizados no estado atual, priorizados pela próxima ação. Até 20 casos e 10 marcos por caso.", members: data.members.slice(0, 30), cases: data.cases.slice(0, 20).map((item) => ({ id: item.id, accountId: item.accountId, ownerMemberId: item.ownerMemberId, status: item.status, targetAt: item.targetAt, nextActionAt: item.nextActionAt, nextActionDescription: item.nextActionDescription, milestones: item.milestones.slice(0, 10).map((milestone) => ({ id: milestone.id, title: milestone.nameSnapshot, status: milestone.status, required: milestone.required })) })), sampleLimit: 20, truncated: data.cases.length > 20 };
    } }] : []),
    ...(general || /agenda|reuniao|reunioes|compromisso/.test(question) ? [{ key: "agenda", label: "Agenda de reuniões", href: "/agenda", load: async () => {
      const date = period.assumed ? workspaceDateAt(now, workspace.timeZone) : period.fromDate;
      const data = await getMeetingService().getAgenda(context, { view: period.fromDate === period.toDate ? "day" : "week", date });
      return { generatedAt: data.generatedAt, timeZone: data.timeZone, rangeLabel: data.rangeLabel, coverage: "A agenda canônica permite uma semana por consulta; esta fonte cobre somente o intervalo indicado em rangeLabel, não todo o período financeiro.", meetings: data.meetings.slice(0, 25).map(({ id, leadId, opportunityId, leadName, closerName, title, status, operationalStatus, startsAt, endsAt }) => ({ id, leadId, opportunityId, leadName, closerName, title, status, operationalStatus, startsAt, endsAt })), sampleLimit: 25, truncated: data.meetings.length > 25 };
    } }] : []),
    { key: "contratos", label: "Contratos", href: "/contratos", load: async () => {
      const data = await getContractService().getScreen(context, {});
      return { metrics: data.metrics, templates: data.templateVersions, generatedAt: data.generatedAt };
    } },
    { key: "pos_venda", label: "Customer Success", href: "/customer-success", load: async () => {
      const data = await getCustomerSuccessService().screen(context);
      return { metrics: data.metrics, generatedAt: data.generatedAt, formulas: data.formulas, total: data.total, sampleLimit: data.pageSize, clients: data.items.map((item) => ({ name: item.account.name, state: item.state, nextActionAt: item.nextActionAt, health: item.health ? { status: item.health.status, score: item.health.score } : null, adoption: item.operatingReview.adoption, deliverables: item.operatingReview.deliverables, requests: item.operatingReview.requests, result: item.operatingReview.result, renewal: item.operatingReview.renewal })) };
    } },
    { key: "atribuicao", label: "Atribuição e UTMs", href: "/aquisicao", load: async () => {
      const data = await getMarketingAttributionService().getScreen(context, { periodStart: period.from, periodEnd: period.to });
      return { summary: data.summary, period: data.period, sourceBreakdown: data.sourceBreakdown, missingInformation: data.missingInformation };
    } },
    { key: "anuncios", label: "Performance de mídia", href: "/aquisicao/midia", load: async () => {
      const data = await getMediaPerformanceService().getScreen(context, { periodStart: period.from, periodEnd: period.to });
      return { period: data.period, metrics: data.metrics, totals: data.totals, funnel: data.funnel, acquisitionFunnel: data.acquisitionFunnel, mediaBreakdown: data.mediaBreakdown, pageAnalytics: data.pageAnalytics, missingInformation: data.missingInformation };
    } },
    { key: "integracoes", label: "Integrações", href: "/integracoes", load: async () => {
      const data = await getIntegrationPlatformService().list(context);
      return { generatedAt: data.generatedAt, summary: data.summary, connections: data.connections.map((item) => ({ name: item.displayName, provider: item.providerKey, status: item.status, enabled: item.enabled, capabilityLevel: item.capabilityLevel })) };
    } },
  ];
  const results = await Promise.all(loaders.map(async (loader) => {
    try {
      return { source: { key: loader.key, label: loader.label, href: loader.href, data: compactCopilotData(await loader.load()) } };
    } catch (error) {
      if (error instanceof ApplicationError && error.statusCode === 403) return { unavailable: loader.key };
      throw error;
    }
  }));
  return { period, sources: results.flatMap((result) => result.source ? [result.source] : []), unavailable: results.flatMap((result) => result.unavailable ? [result.unavailable] : []) };
}
