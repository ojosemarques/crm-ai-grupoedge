import { describe, expect, it, vi } from "vitest";
import { generateCopilotWithSearch } from "./copilot-retrieval";
import type { CopilotRecordResult } from "../domain/copilot-record-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";

const query = { entity: "CUSTOMER", query: "Empresa", page: 1, pageSize: 10 } as const;
const result: CopilotRecordResult = { entity: "CUSTOMER", source: { key: "busca_clientes", label: "Clientes", href: "/contas" }, page: 1, pageSize: 10, total: 11, hasMore: true, nextPage: 2, records: [], coverage: "Busca autorizada", filters: { query: "Empresa" } };
const ask = (page = 1) => ({ answer: "Buscando", sources: [], searches: [{ ...query, page }] });
const answer = { answer: "Há mais resultados além desta página.", sources: [result.source.key], searches: [] };
const base = { input: { message: "Encontre Empresa" }, sanitize: (input: unknown) => input };

describe("busca iterativa autorizada do Copilot", () => {
  it("entrega resultados e paginação ao modelo antes da resposta final", async () => {
    const generate = vi.fn().mockResolvedValueOnce(ask()).mockResolvedValueOnce(ask(2)).mockResolvedValueOnce(answer);
    const search = vi.fn().mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, page: 2, hasMore: false, nextPage: null });
    const response = await generateCopilotWithSearch({ ...base, generate, search });
    expect(search.mock.calls.map(([q]) => q.page)).toEqual([1, 2]);
    expect(generate.mock.calls[1]![0]).toMatchObject({ searchRoundsRemaining: 1, searchResults: [{ query, result }] });
    expect(generate.mock.calls[2]![0]).toMatchObject({ searchRoundsRemaining: 0 });
    expect(response.generated).toEqual(answer);
    expect(response.evidence).toHaveLength(2);
  });

  it("não disfarça acesso negado como base vazia e não inclui erro sensível", async () => {
    const generate = vi.fn().mockResolvedValueOnce(ask()).mockResolvedValueOnce(answer);
    const search = vi.fn().mockRejectedValue(new ApplicationError("Informação interna", { code: "DENIED", statusCode: 403 }));
    const response = await generateCopilotWithSearch({ ...base, generate, search });
    expect(response.evidence[0]).toMatchObject({ result: null, unavailable: expect.stringContaining("indisponível") });
    expect(JSON.stringify(generate.mock.calls[1])).not.toContain("Informação interna");
  });

  it("propaga falha de infraestrutura, sem afirmar que não encontrou registros", async () => {
    const generate = vi.fn().mockResolvedValue(ask());
    const search = vi.fn().mockRejectedValue(new Error("db offline"));
    await expect(generateCopilotWithSearch({ ...base, generate, search })).rejects.toThrow("db offline");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("limita rodadas e impede loop de consultas idênticas", async () => {
    const generate = vi.fn().mockResolvedValueOnce(ask()).mockResolvedValueOnce(ask(2)).mockResolvedValueOnce(ask(3));
    const search = vi.fn().mockResolvedValue(result);
    await expect(generateCopilotWithSearch({ ...base, generate, search })).rejects.toMatchObject({ code: "COPILOT_SEARCH_LIMIT" });
    expect(search).toHaveBeenCalledTimes(2);
    generate.mockReset().mockResolvedValue(ask()); search.mockClear();
    await expect(generateCopilotWithSearch({ ...base, generate, search })).rejects.toMatchObject({ code: "COPILOT_SEARCH_REPEATED" });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("rejeita saída mista antes de consultar ou preparar qualquer ação", async () => {
    const invalid = { ...ask(), operation: { kind: "CREATE_TASK", leadId: "10000000-0000-4000-8000-000000000001", title: "Ação", dueAt: "2026-10-01T10:00:00Z" } };
    const search = vi.fn();
    const response = await generateCopilotWithSearch({ ...base, generate: vi.fn().mockResolvedValue(invalid), search });
    expect(response.generated).toEqual(invalid);
    expect(search).not.toHaveBeenCalled();
  });

  it("bloqueia contexto excessivo antes de enviá-lo ao provedor", async () => {
    const generate = vi.fn();
    await expect(generateCopilotWithSearch({ ...base, input: { message: "x".repeat(100_001) }, generate })).rejects.toMatchObject({ code: "COPILOT_CONTEXT_LIMIT" });
    expect(generate).not.toHaveBeenCalled();
  });
});
