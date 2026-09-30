import type { CopilotContext } from "./copilot-context";

export function localCopilotSources(message: string) {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return [
    /financ|caixa|despes|receita|dre|mrr|comiss|fatura|recebive|pagamento/.test(text) ? "financeiro" : null,
    /anuncio|campanha|criativo|cpl|cpm|roas|midia|ads/.test(text) ? "anuncios" : null,
    /onboarding|churn|nps|pos.venda|customer success|saude.*client|carteira/.test(text) ? "pos_venda" : null,
    /integrac|conexao|conexoes/.test(text) ? "integracoes" : null,
    /utm|atribuicao/.test(text) ? "atribuicao" : null,
  ].filter((key): key is string => key !== null);
}

export function localCopilotAnswer(message: string, context: CopilotContext) {
  const wanted = localCopilotSources(message);
  const sources = context.sources.filter((source) => wanted.includes(source.key));
  const currency = (value: unknown) => value === undefined || value === null ? "sem dado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
  const lines = sources.map((source) => {
    const data = source.data as Record<string, unknown>;
    const summary = (data.summary ?? data.metrics ?? {}) as Record<string, unknown>;
    if (source.key === "financeiro") return `Financeiro: recebido ${currency(summary.receivedCents)}; despesas pagas ${currency(summary.expenseCents)}; saldo de caixa ${currency(summary.cashBalanceCents)}; MRR atual ${currency(summary.mrrCents)}; contas a receber em aberto ${currency(summary.receivableOpenCents)}; comissões pendentes ${currency(summary.commissionPendingCents)}. Receita por competência ${currency(summary.netRevenueCents)}; resultado líquido ${currency(summary.netIncomeCents)}.`;
    if (source.key === "anuncios") {
      const metrics = data.metrics as Array<{ label: string; value: number | null; unit: string }>;
      return `Anúncios: ${metrics.map((metric) => `${metric.label}: ${metric.value === null ? "sem base" : metric.unit === "BRL_CENTS" ? currency(metric.value) : metric.unit === "BPS" ? `${metric.value / 100}%` : metric.value.toLocaleString("pt-BR")}`).join("; ")}.`;
    }
    if (source.key === "pos_venda") return `Pós-venda (estado atual): ${summary.active ?? 0} carteiras ativas; ${summary.healthy ?? 0} saudáveis; ${summary.attention ?? 0} em atenção; ${summary.risk ?? 0} em risco; ${summary.overdue ?? 0} com próxima ação atrasada; ${summary.insufficient ?? 0} sem dados suficientes de saúde. NPS e churn não são equivalentes ao score de saúde.`;
    if (source.key === "atribuicao") return `Atribuição: ${summary.touchpoints ?? 0} touchpoints; ${summary.conversions ?? 0} conversões; ${summary.openReviews ?? 0} revisões abertas; cobertura ${summary.latestCoverageBps == null ? "sem base" : `${Number(summary.latestCoverageBps) / 100}%`}.`;
    return `Integrações: ${Object.entries(summary).map(([status, count]) => `${status}: ${count}`).join("; ") || "nenhuma conexão cadastrada"}.`;
  });
  const period = context.period;
  if (period) lines.push(`Período financeiro e de aquisição: ${period.fromDate} a ${period.toDate} (${period.timeZone})${period.assumed ? "; mês atual por ausência de período explícito" : ""}. Pós-venda e integrações mostram o estado atual.`);
  if (!sources.length) lines.unshift("Você não tem acesso às fontes solicitadas nesta consulta.");
  lines.push("Consulta direta aos dados do sistema. Para conversar livremente e preparar ações, configure OpenAI em Governança de IA.");
  return { answer: lines.join("\n\n"), sources: sources.map(({ key, label, href }) => ({ key, label, href })), links: [...sources.map(({ label, href }) => ({ label, href, entityType: "MODULE" })), { label: "Configurar Copilot", href: "/governanca-ia", entityType: "MODULE" }], proposal: null, mode: "LOCAL" };
}
