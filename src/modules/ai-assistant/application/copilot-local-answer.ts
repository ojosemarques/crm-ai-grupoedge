import type { CopilotContext } from "./copilot-context";

export function localCopilotSources(message: string) {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return [
    /client|cadastro|conta.*empresa/.test(text) ? "clientes" : null,
    /tarefa|atividade|prazo|follow.?up/.test(text) ? "tarefas" : null,
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
    if (source.key === "clientes") {
      const clients = data.clients as Array<{ name: string; status: string; peopleCount: number; openOpportunities: number }>;
      const detail = data.detail as { name: string; legalName: string | null; domain: string | null; leads: unknown[]; onboarding: unknown[]; requests: unknown[] } | null;
      return `Clientes: ${data.total} cadastros autorizados. Amostra de até ${data.sampleLimit}: ${clients.slice(0, 8).map((item) => `${item.name} (${item.status === "ACTIVE" ? "ativo" : item.status === "INACTIVE" ? "inativo" : item.status}; ${item.peopleCount} contatos, ${item.openOpportunities} oportunidades abertas)`).join("; ") || "nenhum cadastro"}.${detail ? ` Detalhes de ${detail.name}: razão social ${detail.legalName ?? "não informada"}; site ${detail.domain ?? "não informado"}; ${detail.leads.length} leads vinculados, ${detail.onboarding.length} onboardings, ${detail.requests.length} atendimentos.` : ""}`;
    }
    if (source.key === "tarefas") {
      const leads = data.leads as Array<{ leadName: string; tasks: Array<{ title: string; dueAt: string; overdue: boolean }> }>;
      return `Tarefas: ${data.coverage} ${leads.flatMap((lead) => lead.tasks.map((task) => `${lead.leadName}: ${task.title}, prazo ${new Date(task.dueAt).toLocaleString("pt-BR", { timeZone: context.period?.timeZone ?? "America/Sao_Paulo" })}${task.overdue ? " (atrasada)" : ""}`)).slice(0, 8).join("; ") || "Nenhuma tarefa aberta nesta amostra."}`;
    }
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
  lines.push("Consulta direta aos dados do sistema. Abra Ações para preparar tarefas, alterações de clientes, despesas e recebimentos com prévia e confirmação.");
  return { answer: lines.join("\n\n"), sources: sources.map(({ key, label, href }) => ({ key, label, href })), links: [...sources.map(({ label, href }) => ({ label, href, entityType: "MODULE" }))], proposal: null, mode: "LOCAL" };
}
