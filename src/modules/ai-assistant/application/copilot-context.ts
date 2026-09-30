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

export type CopilotSource = { key: string; label: string; href: string; data: unknown };
export type CopilotContext = { sources: CopilotSource[]; unavailable: string[]; period?: ReturnType<typeof resolveCopilotPeriod> };

// The module services remain the authoritative boundary for row, team and tenant access.
export async function loadCopilotContext(context: AuthenticatedContext, message = "", now = new Date()): Promise<CopilotContext> {
  const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
  const period = resolveCopilotPeriod(message, now, workspace.timeZone);
  const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const question = normalized(message);
  const loaders = [
    ...(/client|cadastro|conta.*empresa/.test(question) ? [{ key: "clientes", label: "Clientes", href: "/contas", load: async () => {
      const data = await getAccountService().list(context, { pageSize: 50 });
      const matching = data.items.filter((item) => item.name.length > 2 && question.includes(normalized(item.name)));
      const detail = matching.length === 1 ? await getAccountService().get(context, matching[0]!.id) : null;
      return { total: data.total, sampleLimit: 50, clients: data.items, detail: detail ? { id: detail.id, name: detail.name, legalName: detail.legalName, domain: detail.originalDomain, segment: detail.segment, size: detail.size, status: detail.status, ownership: detail.ownership, leads: detail.leads, onboarding: detail.onboarding, customerSuccess: detail.customerSuccess, requests: detail.requests } : null };
    } }] : []),
    ...(/tarefa|atividade|prazo|follow.?up/.test(question) ? [{ key: "tarefas", label: "Tarefas dos leads", href: "/leads", load: async () => {
      const data = await getLeadListService().getScreen(context, { pageSize: 25, sort: "nextAction", direction: "asc" });
      const rows = [...data.list.rows].sort((a, b) => Number(question.includes(normalized(b.fullName))) - Number(question.includes(normalized(a.fullName)))).slice(0, 5);
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
      return { coverage: "Amostra dos primeiros 5 leads autorizados, priorizados por próxima ação; até 10 tarefas abertas por lead. Não representa todas as tarefas da empresa.", leadSampleLimit: 5, taskSampleLimit: 10, leads: snapshots.filter((item) => item !== null) };
    } }] : []),
    { key: "financeiro", label: "Financeiro", href: "/financeiro", load: async () => {
      const data = await getFinanceService().screen(context, { from: period.from, to: period.to });
      return { period: data.period, coverage: "Receitas, despesas e DRE respeitam o período; MRR e contas em aberto representam o estado atual, não uma reconstrução histórica.", summary: data.summary, dre: data.dre, cashFlow: data.cashFlow, commissionRules: data.commissionRules, receivables: data.receivables.slice(0, 30), sampleLimit: 30, receivableCount: data.receivables.length };
    } },
    { key: "oportunidades", label: "Pipeline de vendas", href: "/oportunidades", load: async () => {
      const data = await getOpportunityService().getPipelineScreen(context, {});
      const relevant = (names: readonly (string | null)[]) => names.some((name) => name && name.length > 2 && question.includes(normalized(name)));
      const rows = data.stages.flatMap((stage) => stage.opportunities).sort((a, b) => Number(relevant([b.name, b.leadName, b.accountName])) - Number(relevant([a.name, a.leadName, a.accountName])));
      return { generatedAt: data.generatedAt, sellers: data.closerOptions, stages: data.stages.map((stage) => ({ name: stage.name, count: stage.count })), opportunities: rows.slice(0, 100).map((item) => ({ id: item.id, revision: item.revision, name: item.name, leadName: item.leadName, accountName: item.accountName, ownerMemberId: item.ownerMemberId, ownerName: item.ownerName, status: item.status, stageName: item.stageName, amountCents: item.amountCents, mrrCents: item.mrrCents, tcvCents: item.tcvCents, sourceName: item.sourceName, offers: item.offers.map((offer) => ({ id: offer.id, name: offer.name, totalCents: offer.totalCents })), canWrite: item.canWrite })), sampleLimit: 100, matchingRecordsFirst: true };
    } },
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
      return { source: { key: loader.key, label: loader.label, href: loader.href, data: await loader.load() } };
    } catch (error) {
      if (error instanceof ApplicationError && error.statusCode === 403) return { unavailable: loader.key };
      throw error;
    }
  }));
  return { period, sources: results.flatMap((result) => result.source ? [result.source] : []), unavailable: results.flatMap((result) => result.unavailable ? [result.unavailable] : []) };
}
