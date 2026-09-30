const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const stopWords = new Set(("a o as os um uma uns umas de do da dos das para pelo pela com em no na nos nas e ou que qual quais como quanto quantos quando onde por favor me meu minha meus minhas se ao aos esta este esse essa isto isso tudo todos todas sobre ate entre sem mais mostre mostrar consulte consultar busque buscar encontre encontrar detalhe detalhes veja ver informe listar liste crie criar registre registrar atualize atualizar altere alterar feche fechar marque marcar recebido pago pague pagar tarefa tarefas atividade atividades cliente clientes conta contas empresa empresas lead leads oportunidade oportunidades negocio negocios nome dados cadastro cadastros resumo situacao status segmento porte dominio razao social prioridade prazo titulo descricao hoje ontem amanha semana mes meses ano atual passado proximo proxima neste nesta desse dessa uma preciso quero gostaria fazer faça faca tem tenho sao foi foram está estão estao recebimento recebimentos pagamento pagamentos cobranca cobrancas receita receitas saldo financeiro despesa despesas contrato contratos assinatura assinaturas mrr arr onboarding agenda reuniao reunioes follow up reais real mil centavos janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro").split(/\s+/).map(normalize));

/** Bounded retrieval hints, never entity identity or authorization decisions. */
export function copilotSearchTerms(message: string): string[] {
  const text = message.slice(0, 4000);
  const quoted = [...text.matchAll(/["“]([^"”]{2,80})["”]/g)].map((match) => match[1]!.trim());
  if (quoted.length) return [...new Set(quoted)].slice(0, 4);
  const tokens = text.match(/[\p{L}\p{N}][\p{L}\p{N}@._'-]*/gu) ?? [];
  const chunks: string[][] = [[]];
  for (const token of tokens) {
    if (stopWords.has(normalize(token)) || /^\d+(?:[.,:-]\d+)*$/.test(token)) {
      if (chunks.at(-1)!.length) chunks.push([]);
    } else if (token.length > 1) chunks.at(-1)!.push(token);
  }
  const words = chunks.flat();
  const candidates = [...chunks.filter((chunk) => chunk.length > 1).map((chunk) => chunk.join(" ")), ...words];
  const seen = new Set<string>();
  return candidates.filter((value) => {
    const key = normalize(value);
    if (value.length > 80 || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 4);
}

export async function searchCopilotPages<T extends { id: string }>(
  terms: readonly string[],
  search: (term: string) => Promise<{ items: readonly T[]; total: number }>,
  limit: number,
) {
  const queries = terms.length ? terms : [""];
  const pages = await Promise.all(queries.map((term) => search(term)));
  const rows = [...new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()];
  return { items: rows.slice(0, limit), total: terms.length ? null : pages[0]!.total, matchedCount: rows.length, truncated: rows.length > limit || pages.some((page) => page.total > page.items.length), queries: [...terms] };
}

/** Keep module metrics intact while bounding example rows and free-form text. */
export function compactCopilotData(value: unknown): unknown {
  for (const limit of [20, 10, 5, 2]) {
    let truncated = false;
    const compact = (item: unknown): unknown => {
      if (item instanceof Date) return item.toISOString();
      if (typeof item === "bigint") return item.toString();
      if (typeof item === "string" && item.length > 800) { truncated = true; return `${item.slice(0, 800)}…`; }
      if (Array.isArray(item)) { truncated ||= item.length > limit; return item.slice(0, limit).map(compact); }
      if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, field]) => [key, compact(field)]));
      return item;
    };
    const data = compact(value);
    if (JSON.stringify(data).length <= 16_000 || limit === 2) {
      return data && typeof data === "object" && !Array.isArray(data)
        ? { ...data, contextLimits: { maxArrayItems: limit, maxTextCharacters: 800, truncated, meaning: "Coleções são amostras; não some as linhas para reconstruir totais. Métricas escalares preservadas da fonte canônica." } }
        : data;
    }
  }
}
