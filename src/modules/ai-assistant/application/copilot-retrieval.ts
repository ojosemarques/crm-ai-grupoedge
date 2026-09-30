import { copilotOutputSchema } from "@/modules/ai-assistant/domain/copilot-contracts";
import type { CopilotRecordQuery, CopilotRecordResult } from "@/modules/ai-assistant/domain/copilot-record-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";

export type CopilotSearchEvidence = { query: CopilotRecordQuery; result: CopilotRecordResult | null; unavailable?: string };

/** Read-only rounds: model output never invokes a domain mutation. */
export async function generateCopilotWithSearch(options: {
  input: Record<string, unknown>;
  generate: (input: unknown) => Promise<unknown>;
  search?: ((query: CopilotRecordQuery) => Promise<CopilotRecordResult>) | undefined;
  sanitize: (input: unknown) => unknown;
}) {
  const evidence: CopilotSearchEvidence[] = [];
  const seen = new Set<string>();
  const rounds = options.search ? 2 : 0;
  for (let round = 0; round <= rounds; round++) {
    const input = options.sanitize({ ...options.input, searchResults: [...evidence], searchRoundsRemaining: rounds - round });
    if (JSON.stringify(input).length > 100_000) throw new ApplicationError("O contexto atingiu o limite desta consulta. Refine o nome, período ou módulo; nenhuma alteração foi executada.", { code: "COPILOT_CONTEXT_LIMIT", statusCode: 400, expose: true });
    const generated = await options.generate(input);
    const parsed = copilotOutputSchema.safeParse(generated);
    // The caller keeps the existing validation and business-specific error messages.
    if (!parsed.success || !parsed.data.searches.length) return { generated, evidence };
    if (round === rounds) throw new ApplicationError("A busca precisa de mais detalhes. Informe o nome completo, identificador ou módulo para continuar; nenhuma alteração foi executada.", { code: "COPILOT_SEARCH_LIMIT", statusCode: 400, expose: true });
    const queries = parsed.data.searches.filter((query) => {
      const key = JSON.stringify(query);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (!queries.length) throw new ApplicationError("A busca repetiu os mesmos filtros. Refine o pedido para continuar; nenhuma alteração foi executada.", { code: "COPILOT_SEARCH_REPEATED", statusCode: 400, expose: true });
    const results = await Promise.all(queries.map(async (query): Promise<CopilotSearchEvidence> => {
      try { return { query, result: await options.search!(query) }; }
      catch (error) {
        if (error instanceof ApplicationError && [403, 404].includes(error.statusCode)) return { query, result: null, unavailable: "Registro ou módulo indisponível para suas permissões atuais." };
        throw error;
      }
    }));
    evidence.push(...results);
  }
  throw new Error("Unreachable Copilot retrieval state");
}
