import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { createCopilotService } from "./copilot-service";
import { copilotCommandSchema, copilotSaleSchema } from "../domain/copilot-contracts";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-09-30T12:00:00.000Z");
const context: AuthenticatedContext = { workspaceId: id(1), workspaceSlug: "test", sessionId: id(2), userId: id(3), memberId: id(4), actorId: id(5), roleId: id(6), roleKey: "administrator", roleName: "Admin", displayName: "Admin" };
const sale = { opportunityId: id(10), expectedRevision: 3, sellerMemberId: id(4), totalCents: "1800000", upfrontCents: "0", monthlyCents: "300000", durationMonths: 6, startsAt: now.toISOString(), templateVersionId: id(11) };
type Row = Record<string, unknown>;

function harness() {
  const rows: Row[] = [];
  let tick = now;
  const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, value]) => key === "createdAt" ? (row.createdAt as Date) > (value as { gt: Date }).gt : row[key] === value);
  const proposal = {
    findMany: vi.fn(async () => rows),
    findFirst: vi.fn(async ({ where }: { where: Row }) => rows.find((row) => matches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: id(20 + rows.length), revision: 1, status: "DRAFT", createdAt: tick, ...data }; rows.push(row); return row; }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const row = rows.find((item) => matches(item, where)); if (!row) return { count: 0 }; Object.assign(row, data, { revision: Number(row.revision) + (data.revision ? 1 : 0) }); return { count: 1 }; }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => { const row = rows.find((item) => matches(item, where)); Object.assign(row!, data); return row; }),
  };
  const database = { aIAssistantProposal: proposal, aIUseCaseVersion: { findFirst: vi.fn(async (): Promise<{ id: string } | null> => ({ id: id(40) })) }, teamMember: { findFirst: vi.fn(async () => null) }, auditLog: { create: vi.fn(async () => ({})) }, $executeRaw: vi.fn(), $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(database)) };
  const authorization = { assertAuthorized: vi.fn(async () => undefined) };
  const sources = [{ key: "oportunidades", label: "Vendas", href: "/oportunidades", data: { opportunities: [{ id: sale.opportunityId, revision: sale.expectedRevision, canWrite: true }] } }];
  const loadContext = vi.fn(async () => ({ sources, unavailable: [] }));
  const generate = vi.fn(async (input: unknown): Promise<unknown> => { expect(input).toBeDefined(); return { answer: "Confira a proposta.", sources: ["oportunidades"], sale }; });
  const sales = { preview: vi.fn(async () => ({ customerName: "Cliente", payload: sale, pendingSteps: ["Aceite pendente"] })), execute: vi.fn(async () => ({ paymentReceived: false, contractId: id(30) })) };
  const options = { database: database as unknown as PrismaClient, authorization, loadContext, generate, sales, fallback: vi.fn(async () => ({ answer: null })), now: () => tick };
  const service = createCopilotService(options);
  return { service, options, database, sales, generate, authorization, rows, loadContext, setTime: (value: Date) => { tick = value; } };
}

describe("Copilot operacional", () => {
  it("rejeita confirmação implícita e payloads extras antes de qualquer efeito", () => {
    expect(copilotCommandSchema.safeParse({ action: "CONFIRM", proposalId: id(20), expectedRevision: 1 }).success).toBe(false);
    expect(copilotCommandSchema.safeParse({ action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true, sale }).success).toBe(false);
    expect(copilotSaleSchema.safeParse({ ...sale, totalCents: "2500000" }).success).toBe(false);
  });

  it("cria somente rascunho, reutiliza replay, e executa apenas depois de confirmar", async () => {
    const h = harness();
    const command = { action: "CHAT", message: "Feche a venda de 18 mil em 6 parcelas de 3 mil" };
    await h.service.command(context, command);
    await h.service.command(context, command);
    expect(h.rows).toHaveLength(1);
    expect(h.sales.execute).not.toHaveBeenCalled();
    const confirm = { action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true };
    await h.service.command(context, confirm);
    expect(h.sales.execute).toHaveBeenCalledWith(context, { ...sale, idempotencyKey: id(20), confirmed: true });
    await expect(h.service.command(context, confirm)).resolves.toMatchObject({ proposal: null });
    expect(h.sales.execute).toHaveBeenCalledTimes(2);
    expect(h.sales.execute.mock.calls[1]).toEqual(h.sales.execute.mock.calls[0]);
  });

  it("não deixa outro ator ou workspace confirmar a proposta", async () => {
    const h = harness();
    await h.service.command(context, { action: "CHAT", message: "Preparar venda" });
    const command = { action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true };
    await expect(h.service.command({ ...context, actorId: id(99) }, command)).rejects.toMatchObject({ code: "COPILOT_PROPOSAL_NOT_FOUND" });
    await expect(h.service.command({ ...context, workspaceId: id(99) }, command)).rejects.toMatchObject({ code: "COPILOT_PROPOSAL_NOT_FOUND" });
    expect(h.sales.execute).not.toHaveBeenCalled();
  });

  it("revalida permissão antes de carregar contexto ou enviar ao provedor", async () => {
    const h = harness();
    h.authorization.assertAuthorized.mockRejectedValueOnce(new ApplicationError("Negado", { code: "DENIED", statusCode: 403 }));
    await expect(h.service.command(context, { action: "CHAT", message: "Saldo" })).rejects.toMatchObject({ code: "DENIED" });
    expect(h.loadContext).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("bloqueia oportunidade inventada pelo modelo e valores divergentes", async () => {
    const h = harness();
    h.generate.mockResolvedValueOnce({ answer: "Pronto", sources: [], sale: { ...sale, opportunityId: id(99) } });
    await expect(h.service.command(context, { action: "CHAT", message: "Feche a venda" })).rejects.toMatchObject({ code: "COPILOT_UNKNOWN_OPPORTUNITY" });
    h.generate.mockResolvedValueOnce({ answer: "Pronto", sources: [], sale: { ...sale, totalCents: "2500000" } });
    await expect(h.service.command(context, { action: "CHAT", message: "25 mil, 3 mil por 6 meses" })).resolves.toMatchObject({ proposal: null, answer: expect.stringContaining("não fecham") });
    expect(h.rows).toHaveLength(0);
    expect(h.sales.execute).not.toHaveBeenCalled();
  });

  it("não envia dados externos sem caso de uso aprovado no workspace", async () => {
    const h = harness();
    h.database.aIUseCaseVersion.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.command(context, { action: "CHAT", message: "Como estão as vendas?" })).rejects.toMatchObject({ code: "AI_USE_CASE_NOT_APPROVED" });
    expect(h.loadContext).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("expira proposta e impede confirmação após cancelamento", async () => {
    const h = harness();
    await h.service.command(context, { action: "CHAT", message: "Preparar venda" });
    h.setTime(new Date(now.getTime() + 31 * 60_000));
    await expect(h.service.command(context, { action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true })).rejects.toMatchObject({ code: "COPILOT_PROPOSAL_EXPIRED" });
    await h.service.command(context, { action: "CANCEL", proposalId: id(20), expectedRevision: 1 });
    await expect(h.service.command(context, { action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true })).rejects.toMatchObject({ code: "COPILOT_REVISION_CONFLICT" });
    expect(h.sales.execute).not.toHaveBeenCalled();
  });

  it("retira segredo e email antes do egress e aceita consulta sem ação", async () => {
    const h = harness();
    h.generate.mockResolvedValueOnce({ answer: "Dados insuficientes", sources: ["fonte_inventada"], sale: null });
    const result = await h.service.command(context, { action: "CHAT", message: "Saldo teste@example.com token=secreto123" });
    const sent = JSON.stringify(h.generate.mock.calls[0]?.[0]);
    expect(sent).not.toContain("teste@example.com");
    expect(sent).not.toContain("secreto123");
    expect(result).toMatchObject({ sources: [], proposal: null });
    expect(h.rows).toHaveLength(0);
  });

  it("revalida domínio antes da confirmação e não trava proposta sem permissão", async () => {
    const h = harness();
    await h.service.command(context, { action: "CHAT", message: "Preparar venda" });
    h.sales.preview.mockRejectedValueOnce(new ApplicationError("Acesso revogado", { code: "DENIED", statusCode: 403 }));
    await expect(h.service.command(context, { action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true })).rejects.toMatchObject({ code: "DENIED" });
    expect(h.sales.execute).not.toHaveBeenCalled();
    expect(h.rows[0]?.status).toBe("DRAFT");
  });

  it("recupera falha após commit sem tratar a venda como falha nem exigir preview de WON", async () => {
    const h = harness();
    await h.service.command(context, { action: "CHAT", message: "Preparar venda" });
    h.database.aIAssistantProposal.update.mockRejectedValueOnce(new Error("database unavailable"));
    const command = { action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true };
    await expect(h.service.command(context, command)).rejects.toMatchObject({ code: "COPILOT_CONFIRMATION_RECOVERY" });
    expect(h.rows[0]?.status).toBe("EXECUTING");
    h.sales.preview.mockRejectedValue(new Error("already won"));
    await expect(h.service.command(context, command)).resolves.toMatchObject({ proposal: null });
    expect(h.rows[0]?.status).toBe("PUBLISHED");
    expect(h.sales.execute.mock.calls[1]).toEqual(h.sales.execute.mock.calls[0]);
    expect(h.sales.preview).toHaveBeenCalledTimes(2);
  });

  it("retoma erro de execução com a mesma chave idempotente e nunca retorna para rascunho", async () => {
    const h = harness();
    await h.service.command(context, { action: "CHAT", message: "Preparar venda" });
    h.sales.execute.mockRejectedValueOnce(new Error("transaction timeout"));
    const command = { action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true };
    await expect(h.service.command(context, command)).rejects.toThrow("transaction timeout");
    expect(h.rows[0]?.status).toBe("EXECUTION_FAILED");
    await expect(h.service.command(context, command)).resolves.toMatchObject({ proposal: null });
    expect(h.rows[0]?.status).toBe("PUBLISHED");
    expect(h.sales.execute.mock.calls[1]).toEqual(h.sales.execute.mock.calls[0]);
  });

  it("restaura confirmação pendente após recarregar sem expor propostas de outros atores", async () => {
    const h = harness();
    await h.service.command(context, { action: "CHAT", message: "Preparar venda" });
    h.database.aIAssistantProposal.update.mockRejectedValueOnce(new Error("connection lost"));
    await expect(h.service.command(context, { action: "CONFIRM", proposalId: id(20), expectedRevision: 1, confirmed: true })).rejects.toMatchObject({ code: "COPILOT_CONFIRMATION_RECOVERY" });
    const screen = await h.service.screen(context);
    expect(h.database.aIAssistantProposal.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: "CLOSE_SALE" }) }));
    expect(screen.pending[0]).toMatchObject({ id: id(20), revision: 1, resuming: true });
  });
});
