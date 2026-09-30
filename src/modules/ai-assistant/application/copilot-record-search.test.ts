import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { copilotRecordQuerySchema } from "../domain/copilot-record-contracts";
import { createCopilotRecordSearchService } from "./copilot-record-search";

type Sources = Parameters<typeof createCopilotRecordSearchService>[0];
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const context = { workspaceId: id(1), memberId: id(2) } as AuthenticatedContext;

describe("busca estruturada do Copilot", () => {
  it("pagina a base de clientes sem perder linhas na fronteira mínima do serviço canônico", async () => {
    const clients = Array.from({ length: 121 }, (_, index) => ({ id: id(index + 10), name: `Cliente ${index}`, revision: 2, originalDocument: "PRIVATE_DOCUMENT" }));
    const list = vi.fn(async (_context, query) => ({ items: clients.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: clients.length }));
    const service = createCopilotRecordSearchService({ accounts: () => ({ list }) } as unknown as Sources);
    const found = await service.search(context, { entity: "CUSTOMER", query: "Cliente", page: 4, pageSize: 3 });
    expect(found).toMatchObject({ total: 121, hasMore: true, nextPage: 5 });
    expect(found.records.map((item) => item.id)).toEqual(clients.slice(9, 12).map((item) => item.id));
    expect(list.mock.calls.map((call) => call[1])).toEqual([{ search: "Cliente", page: 1, pageSize: 10 }, { search: "Cliente", page: 2, pageSize: 10 }]);
    expect(JSON.stringify(found)).not.toContain("PRIVATE_DOCUMENT");
    expect(found.records[0]?.data.revision).toBe(2);
  });
  it("encaminha busca e página de leads ao serviço autorizado, antes de receber os registros", async () => {
    const getScreen = vi.fn(async () => ({ list: { rows: [{ id: id(100), fullName: "Lead distante" }], total: 151 } }));
    const service = createCopilotRecordSearchService({ leads: () => ({ getScreen }) } as unknown as Sources);
    expect(await service.search(context, { entity: "LEAD", query: "distante", page: 7, pageSize: 20 })).toMatchObject({ total: 151, nextPage: 8, records: [{ data: { name: "Lead distante" } }] });
    expect(getScreen).toHaveBeenCalledWith(context, expect.objectContaining({ q: "distante", page: 7, pageSize: 20 }));
    expect(await service.search(context, { entity: "LEAD", query: "distante", page: 9, pageSize: 20 })).toMatchObject({ records: [], hasMore: false, nextPage: null });
  });
  it("não consulta tarefas ou despesas no banco quando a autorização canônica nega", async () => {
    const database = vi.fn();
    const deny = async () => { throw new ApplicationError("Negado", { code: "ACCESS_DENIED", statusCode: 403 }); };
    const service = createCopilotRecordSearchService({ database, operations: () => ({ getLeadOperations: deny }), authorization: () => ({ assertAuthorized: deny }) } as unknown as Sources);
    await expect(service.search(context, { entity: "TASK", leadId: id(4) })).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.search(context, { entity: "EXPENSE", query: "Licença" })).rejects.toMatchObject({ statusCode: 403 });
    expect(database).not.toHaveBeenCalled();
  });
  it("rejeita SQL/campos livres, filtros silenciosos e detalhe de agrupamento de mídia", () => {
    for (const query of [
      { entity: "LEAD", sql: "SELECT * FROM users" },
      { entity: "CUSTOMER", from: "2026-01-01", to: "2026-01-31" },
      { entity: "TASK" },
      { entity: "AD_PERFORMANCE", id: id(5) },
      { entity: "MEETING", from: "2026-02-30", to: "2026-03-01" },
      { entity: "LEAD", pageSize: 1000 },
      { entity: "MEETING", from: "2026-01-01", to: "2026-02-01" },
      { entity: "EXPENSE", from: "2024-01-01", to: "2025-01-01" },
    ]) expect(copilotRecordQuerySchema.safeParse(query).success).toBe(false);
  });
  it("detalhe do lead mantém identidade e responsável sem e-mail, telefone ou payload bruto", async () => {
    const service = createCopilotRecordSearchService({ operations: () => ({ getLeadOperations: async () => ({ lead: { id: id(5), fullName: "Lead autorizado", ownerMemberId: id(2), normalizedEmail: "privado@example.test", normalizedPhone: "5511999999999", rawPayload: { token: "secret" } }, permissions: { canManageTasks: true } }) }) } as unknown as Sources);
    const found = await service.search(context, { entity: "LEAD", id: id(5) });
    expect(found.records[0]?.data).toMatchObject({ id: id(5), name: "Lead autorizado", ownerMemberId: id(2) });
    expect(JSON.stringify(found)).not.toMatch(/privado|5511999999999|rawPayload|secret/);
  });
});
