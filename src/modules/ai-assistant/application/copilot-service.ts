import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { copilotCommandSchema, copilotOutputSchema, copilotSaleSchema, copilotSystemPrompt, type CopilotSale } from "@/modules/ai-assistant/domain/copilot-contracts";
import { getAssistantService } from "@/modules/ai-assistant/application/assistant-service";
import { loadCopilotContext, type CopilotContext } from "@/modules/ai-assistant/application/copilot-context";
import { localCopilotAnswer, localCopilotSources } from "@/modules/ai-assistant/application/copilot-local-answer";
import { resolveCopilotPeriod } from "@/modules/ai-assistant/domain/copilot-period";
import { OpenAICompatibleProvider } from "@/modules/ai/providers/openai-compatible-provider";
import { AIProviderError } from "@/modules/ai/providers/ai-provider";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getSaleCompletionService } from "@/modules/opportunities/application/sale-completion-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

type Options = {
  database: PrismaClient;
  authorization: Pick<ReturnType<typeof getAuthorizationService>, "assertAuthorized">;
  loadContext: (context: AuthenticatedContext, message?: string, now?: Date) => Promise<CopilotContext>;
  generate: ((input: unknown) => Promise<unknown>) | null;
  sales: { preview: (context: AuthenticatedContext, payload: CopilotSale) => Promise<unknown>; execute: (context: AuthenticatedContext, payload: CopilotSale & { confirmed: true; idempotencyKey: string }) => Promise<unknown> };
  fallback: (context: AuthenticatedContext, message: string) => Promise<unknown>;
  now: () => Date;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(message: string, code: string, statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
const redact = (text: string) => text.replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, "[SEGREDO_REMOVIDO]").replace(/\b(?:bearer|token|password|senha|secret)\s*[:= ]\s*[^\s,;]+/gi, "[SEGREDO_REMOVIDO]").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL_REMOVIDO]").replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[DOCUMENTO_REMOVIDO]");

function sanitize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  return value;
}

export function createCopilotService(options: Options) {
  async function authorize(context: AuthenticatedContext) {
    const membership = await options.database.teamMember.findFirst({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null, team: { deletedAt: null } }, select: { teamId: true }, orderBy: { teamId: "asc" } });
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, { workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId, ownerMemberId: context.memberId, teamId: membership?.teamId ?? null });
  }

  async function screen(context: AuthenticatedContext) {
    await authorize(context);
    const pending = await options.database.aIAssistantProposal.findMany({ where: { workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: "CLOSE_SALE", OR: [{ status: "DRAFT", createdAt: { gt: new Date(options.now().getTime() - 30 * 60_000) } }, { status: { in: ["EXECUTING", "EXECUTION_FAILED"] } }] }, orderBy: { createdAt: "desc" }, take: 10 });
    return { mode: options.generate ? "OPENAI" : "LOCAL", pending: pending.map((proposal) => ({ id: proposal.id, revision: proposal.status === "DRAFT" ? proposal.revision : proposal.revision - 1, preview: proposal.preview, expiresAt: new Date(proposal.createdAt.getTime() + 30 * 60_000).toISOString(), resuming: proposal.status !== "DRAFT" })) };
  }

  async function command(context: AuthenticatedContext, raw: unknown) {
    const input = copilotCommandSchema.parse(raw);
    await authorize(context);
    if (input.action === "CHAT") {
      if (!options.generate) {
        if (localCopilotSources(input.message).length) return localCopilotAnswer(input.message, await options.loadContext(context, input.message, options.now()));
        const fallback = await options.fallback(context, input.message) as { answer?: { directAnswer: string }; links?: unknown[] };
        return { answer: fallback.answer?.directAnswer ?? "O chat operacional aguarda a configuração de OpenAI no servidor (OPENAI_API_KEY, OPENAI_MODEL e COPILOT_EXTERNAL_ENABLED=true). As consultas homologadas de leads, funil e oportunidades continuam disponíveis.", sources: [], links: fallback.links ?? [], proposal: null, mode: "LOCAL" };
      }
      const policy = await options.database.aIUseCaseVersion.findFirst({ where: { workspaceId: context.workspaceId, key: "metric-synthesis", status: "APPROVED" }, orderBy: { version: "desc" }, select: { id: true } });
      if (!policy) fail("A síntese gerencial de IA precisa estar aprovada na governança deste workspace.", "AI_USE_CASE_NOT_APPROVED");
      const data = await options.loadContext(context, input.message, options.now());
      const modelInput = { now: options.now().toISOString(), message: redact(input.message), history: input.history.map((item) => ({ ...item, content: redact(item.content) })), context: data };
      const serialized = JSON.stringify(json(modelInput));
      if (serialized.length > 100_000) fail("O contexto excede o limite desta consulta. Use os filtros dos módulos para uma análise mais específica.", "COPILOT_CONTEXT_LIMIT", 400);
      let generated: unknown;
      try { generated = await options.generate(sanitize(modelInput)); }
      catch (error) {
        if (error instanceof AIProviderError) fail("O provedor de IA não respondeu corretamente. Nenhuma ação comercial foi executada.", error.code, 502);
        throw error;
      }
      const parsed = copilotOutputSchema.safeParse(generated);
      if (!parsed.success) {
        const mismatch = parsed.error.issues.find((issue) => issue.path.includes("totalCents"));
        if (mismatch) return { answer: "Os valores da venda não fecham: total deve ser igual à entrada declarada mais mensalidade × meses. Confirme o total e as condições; nenhuma venda foi alterada.", sources: [], links: [], proposal: null, mode: "OPENAI" };
        fail("A IA retornou uma proposta incompleta ou inválida. Reformule a solicitação; nenhuma venda foi alterada.", "COPILOT_INVALID_OUTPUT", 502);
      }
      const output = parsed.data;
      const sources = data.sources.filter((source) => output.sources.includes(source.key)).map(({ key, label, href }) => ({ key, label, href }));
      let proposal: { id: string; revision: number; preview: unknown; expiresAt: string } | null = null;
      if (output.sale) {
        const sale = output.sale;
        const opportunityData = data.sources.find((source) => source.key === "oportunidades")?.data as { opportunities?: Array<{ id: string; revision: number; canWrite: boolean }> } | undefined;
        if (!opportunityData?.opportunities?.some((item) => item.id === sale.opportunityId && item.revision === sale.expectedRevision && item.canWrite)) fail("A oportunidade proposta não está no contexto autorizado e editável. Selecione o registro correto.", "COPILOT_UNKNOWN_OPPORTUNITY", 403);
        const preview = await options.sales.preview(context, sale);
        const fingerprint = hash({ sale, preview });
        const row = await options.database.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`copilot:${context.workspaceId}:${context.actorId}:${fingerprint}`}, 0))`;
          const existing = await tx.aIAssistantProposal.findFirst({ where: { workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: "CLOSE_SALE", status: "DRAFT", requestFingerprint: fingerprint, createdAt: { gt: new Date(options.now().getTime() - 30 * 60_000) } } });
          if (existing) return existing;
          const created = await tx.aIAssistantProposal.create({ data: { workspaceId: context.workspaceId, type: "CLOSE_SALE", request: redact(input.message), payload: json(sale), preview: json(preview), diff: json({ sale }), impact: ["Fechar venda e gerar contrato conforme prévia", "Não confirmar recebimento nem pagar comissão"], requestFingerprint: fingerprint, requestedByActorId: context.actorId } });
          await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.sale.proposed", entityType: "AIAssistantProposal", entityId: created.id, changes: { domainMutationExecuted: false } } });
          return created;
        });
        proposal = { id: row.id, revision: row.revision, preview: row.preview, expiresAt: new Date(row.createdAt.getTime() + 30 * 60_000).toISOString() };
      }
      await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.queried", entityType: "Workspace", entityId: context.workspaceId, changes: { requestFingerprint: hash(input.message), sources: sources.map((source) => source.key), externalProvider: true, governanceVersionId: policy.id, proposalId: proposal?.id ?? null } } });
      const coverage = data.period ? `\n\nPeríodo financeiro e de aquisição: ${data.period.fromDate} a ${data.period.toDate} (${data.period.timeZone})${data.period.assumed ? "; mês atual assumido por ausência de período explícito" : ""}. CRM, contratos, CS e integrações mostram o estado atual.` : "";
      return { answer: output.answer + coverage, sources, links: sources.map((source) => ({ ...source, entityType: "MODULE" })), proposal, mode: "OPENAI" };
    }

    const proposal = await options.database.aIAssistantProposal.findFirst({ where: { id: input.proposalId, workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: "CLOSE_SALE" } });
    if (!proposal) fail("Proposta inexistente ou não autorizada.", "COPILOT_PROPOSAL_NOT_FOUND", 404);
    const resuming = input.action === "CONFIRM" && ["EXECUTING", "EXECUTION_FAILED", "PUBLISHED"].includes(proposal.status) && proposal.revision === input.expectedRevision + 1 && proposal.approvedByActorId === context.actorId;
    if (!resuming && (proposal.status !== "DRAFT" || proposal.revision !== input.expectedRevision)) fail("A proposta já foi finalizada ou alterada. Atualize a conversa.", "COPILOT_REVISION_CONFLICT");
    if (input.action === "CANCEL") {
      const cancelled = await options.database.aIAssistantProposal.updateMany({ where: { id: proposal.id, workspaceId: context.workspaceId, requestedByActorId: context.actorId, revision: input.expectedRevision, status: "DRAFT" }, data: { status: "CANCELLED", revision: { increment: 1 }, cancelledAt: options.now(), cancelledByActorId: context.actorId, cancellationReason: "Cancelado no chat pelo solicitante." } });
      if (!cancelled.count) fail("A proposta mudou durante o cancelamento.", "COPILOT_REVISION_CONFLICT");
      return { answer: "Proposta cancelada. Nenhum dado comercial foi alterado.", proposal: null, links: [], sources: [] };
    }
    if (!resuming && options.now().getTime() - proposal.createdAt.getTime() >= 30 * 60_000) fail("A proposta expirou. Solicite uma nova prévia com dados atualizados.", "COPILOT_PROPOSAL_EXPIRED");
    const sale = copilotSaleSchema.parse(proposal.payload);
    if (!resuming) {
      await options.sales.preview(context, sale);
      const claimed = await options.database.aIAssistantProposal.updateMany({ where: { id: proposal.id, workspaceId: context.workspaceId, requestedByActorId: context.actorId, status: "DRAFT", revision: input.expectedRevision }, data: { status: "EXECUTING", revision: { increment: 1 }, approvedByActorId: context.actorId, approvedAt: options.now(), approvedReason: "Confirmação explícita da prévia no chat." } });
      if (!claimed.count) fail("A proposta já está sendo executada. Repita a confirmação para consultar o resultado.", "COPILOT_REVISION_CONFLICT");
    }
    // A resumed command uses the domain's transactional idempotency ledger. It
    // must not run preview again: the opportunity may already be WON.
    let result: unknown;
    try {
      result = await options.sales.execute(context, { ...sale, confirmed: true, idempotencyKey: proposal.id });
    } catch (error) {
      await options.database.aIAssistantProposal.updateMany({ where: { id: proposal.id, status: "EXECUTING" }, data: { status: "EXECUTION_FAILED" } });
      throw error;
    }
    try {
      await options.database.aIAssistantProposal.update({ where: { id: proposal.id }, data: { status: "PUBLISHED", publishedTargetType: "Opportunity", publishedTargetId: sale.opportunityId } });
    } catch {
      fail("A venda foi registrada, mas a confirmação do chat ficou pendente. Clique novamente em confirmar para recuperar o resultado sem duplicar a venda.", "COPILOT_CONFIRMATION_RECOVERY", 503);
    }
    return { answer: "Fechamento registrado conforme sua confirmação. Consulte o contrato e o financeiro para as etapas pendentes. Nenhum recebimento foi confirmado automaticamente.", result: json(result), proposal: null, sources: [], links: [{ label: "Financeiro", href: "/financeiro", entityType: "MODULE" }, { label: "Contratos", href: "/contratos", entityType: "MODULE" }] };

  }
  return { command, screen };
}

export function getCopilotService() {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  const provider = process.env.COPILOT_EXTERNAL_ENABLED === "true" && key && model ? new OpenAICompatibleProvider({ endpoint: "https://api.openai.com/v1/chat/completions", model, authorizationToken: key, timeoutMs: 25_000 }) : null;
  return createCopilotService({
    database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date(), loadContext: loadCopilotContext, sales: getSaleCompletionService(),
    generate: provider ? async (input) => (await provider.generateJson({ system: copilotSystemPrompt, input, maxOutputTokens: 3000 })).output : null,
    fallback: async (context, message) => {
      const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
      const period = resolveCopilotPeriod(message, new Date(), workspace.timeZone);
      return getAssistantService().command(context, { action: "QUERY", payload: { question: message.padEnd(4, "?").slice(0, 1000), preset: period.preset, fromDate: period.fromDate, toDate: period.toDate } });
    },
  });
}
