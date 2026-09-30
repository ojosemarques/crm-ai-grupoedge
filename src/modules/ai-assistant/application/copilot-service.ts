import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import type { AIAssistantProposal, Prisma, PrismaClient } from "@/generated/prisma/client";
import { copilotCommandSchema, copilotOutputSchema, copilotSaleSchema, copilotSystemPrompt, type CopilotSale } from "@/modules/ai-assistant/domain/copilot-contracts";
import { copilotActionSchema, type CopilotAction } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import { getCopilotActionsService } from "@/modules/ai-assistant/application/copilot-actions-service";
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
  sales: {
    authorize: (context: AuthenticatedContext, payload: CopilotSale) => Promise<unknown>;
    preview: (context: AuthenticatedContext, payload: CopilotSale) => Promise<unknown>;
    execute: (context: AuthenticatedContext, payload: CopilotSale & { confirmed: true; idempotencyKey: string }) => Promise<unknown>;
  };
  actions: Pick<ReturnType<typeof getCopilotActionsService>, "preview" | "execute" | "options" | "authorize">;
  fallback: (context: AuthenticatedContext, message: string) => Promise<unknown>;
  now: () => Date;
};

const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
// Compare previews independent of the key order used by PostgreSQL JSONB.
const hash = (value: unknown) => sha256(canonicalJson(json(value)));
const proposalTypes = ["CLOSE_SALE", "CREATE_TASK", "UPDATE_CUSTOMER", "CREATE_EXPENSE", "RECORD_PAYMENT"];
const lifetimeMs = 30 * 60_000;
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

const actionInputGuide = {
  RECORD_PAYMENT: "{kind:'RECORD_PAYMENT',invoiceId,expectedRevision,financialAccountId,amountCents,receivedAt:ISO,method:'PIX'|'BANK_TRANSFER'|'CARD'|'CASH'|'OTHER',reference,receiptConfirmed:true}; exige comprovante e confirmação real do usuário de que recebeu.",
};

export function createCopilotService(options: Options) {
  async function authorize(context: AuthenticatedContext) {
    const membership = await options.database.teamMember.findFirst({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null, team: { deletedAt: null } }, select: { teamId: true }, orderBy: { teamId: "asc" } });
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, { workspaceId: context.workspaceId, resourceType: "Workspace", resourceId: context.workspaceId, ownerMemberId: context.memberId, teamId: membership?.teamId ?? null });
  }

  function present(proposal: AIAssistantProposal) {
    const resuming = ["EXECUTING", "EXECUTION_FAILED"].includes(proposal.status);
    return { id: proposal.id, type: proposal.type, revision: resuming ? proposal.revision - 1 : proposal.revision, preview: proposal.preview, expiresAt: new Date(proposal.createdAt.getTime() + lifetimeMs).toISOString(), resuming };
  }

  async function canSee(context: AuthenticatedContext, proposal: AIAssistantProposal) {
    try {
      if (proposal.type === "CLOSE_SALE") await options.sales.authorize(context, copilotSaleSchema.parse(proposal.payload));
      else await options.actions.authorize(context, copilotActionSchema.parse(proposal.payload));
      return true;
    } catch (error) {
      if (error instanceof ApplicationError && [403, 404].includes(error.statusCode)) return false;
      throw error;
    }
  }

  async function screen(context: AuthenticatedContext) {
    await authorize(context);
    const where = { workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: { in: proposalTypes } };
    const [pendingRows, historyRows, actionOptions] = await Promise.all([
      options.database.aIAssistantProposal.findMany({ where: { ...where, OR: [{ status: "DRAFT", createdAt: { gt: new Date(options.now().getTime() - lifetimeMs) } }, { status: { in: ["EXECUTING", "EXECUTION_FAILED"] } }] }, orderBy: { createdAt: "desc" }, take: 10 }),
      options.database.aIAssistantProposal.findMany({ where, orderBy: { createdAt: "desc" }, take: 30 }),
      options.actions.options(context),
    ]);
    const readable = new Map<string, boolean>();
    for (const row of [...pendingRows, ...historyRows]) {
      if (!readable.has(row.id)) readable.set(row.id, await canSee(context, row));
    }
    return {
      mode: options.generate ? "OPENAI" : "LOCAL",
      options: actionOptions,
      pending: pendingRows.filter((row) => readable.get(row.id)).map(present),
      history: historyRows.filter((row) => readable.get(row.id)).map((row) => ({
        id: row.id, type: row.type, preview: row.preview,
        status: (row.status === "DRAFT" && options.now().getTime() - row.createdAt.getTime() >= lifetimeMs) || (row.status === "CANCELLED" && row.cancellationReason === "Prévia expirada; substituída por uma nova solicitação.") ? "EXPIRED" : row.status,
        createdAt: row.createdAt.toISOString(), approvedAt: row.approvedAt?.toISOString() ?? null, cancelledAt: row.cancelledAt?.toISOString() ?? null,
      })),
    };
  }

  async function propose(context: AuthenticatedContext, request: string, payload: CopilotSale | CopilotAction, isSale: boolean) {
    const type = isSale ? "CLOSE_SALE" : (payload as CopilotAction).kind;
    const preview = isSale ? await options.sales.preview(context, payload as CopilotSale) : await options.actions.preview(context, payload as CopilotAction);
    const fingerprint = hash({ type, payload, preview });
    const row = await options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`copilot:${context.workspaceId}:${context.actorId}:${fingerprint}`}, 0))`;
      const existing = await tx.aIAssistantProposal.findFirst({ where: { workspaceId: context.workspaceId, requestedByActorId: context.actorId, type, status: "DRAFT", requestFingerprint: fingerprint } });
      if (existing && options.now().getTime() - existing.createdAt.getTime() < lifetimeMs) return existing;
      // The partial unique index includes expired drafts. Close the stale row
      // before creating its replacement, preserving both history and revision.
      if (existing) {
        const expired = await tx.aIAssistantProposal.updateMany({ where: { id: existing.id, workspaceId: context.workspaceId, requestedByActorId: context.actorId, status: "DRAFT", revision: existing.revision }, data: { status: "CANCELLED", revision: { increment: 1 }, cancelledAt: options.now(), cancelledByActorId: context.actorId, cancellationReason: "Prévia expirada; substituída por uma nova solicitação." } });
        if (expired.count) await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.expired", entityType: "AIAssistantProposal", entityId: existing.id, changes: { type, domainMutationExecuted: false } } });
      }
      const created = await tx.aIAssistantProposal.create({ data: {
        workspaceId: context.workspaceId, type, request: redact(request), payload: json(payload), preview: json(preview), diff: json({ [isSale ? "sale" : "operation"]: payload }),
        impact: isSale ? ["Fechar venda e gerar contrato conforme prévia", "Não confirmar recebimento nem pagar comissão"] : json((preview as { impact: string[] }).impact),
        requestFingerprint: fingerprint, requestedByActorId: context.actorId,
      } });
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: isSale ? "ai.copilot.sale.proposed" : "ai.copilot.action.proposed", entityType: "AIAssistantProposal", entityId: created.id, changes: { type, domainMutationExecuted: false } } });
      return created;
    });
    return present(row);
  }

  function verifyActionContext(action: CopilotAction, data: CopilotContext, available: Awaited<ReturnType<Options["actions"]["options"]>>) {
    const has = (records: readonly { id: string }[], id: string) => records.some((record) => record.id === id);
    let allowed = available.capabilities.includes(action.kind);
    if (action.kind === "CREATE_TASK") {
      allowed = allowed && has(available.leads, action.leadId);
      if (action.opportunityId) {
        const opportunities = data.sources.find((source) => source.key === "oportunidades")?.data as { opportunities?: { id: string; canWrite: boolean }[] } | undefined;
        allowed = allowed && Boolean(opportunities?.opportunities?.some((row) => row.id === action.opportunityId && row.canWrite));
      }
    }
    if (action.kind === "UPDATE_CUSTOMER") allowed = allowed && available.customers.some((row) => row.id === action.accountId && row.revision === action.expectedRevision);
    if (action.kind === "CREATE_EXPENSE") allowed = allowed && has(available.categories, action.categoryId) && has(available.financialAccounts, action.financialAccountId) && (!action.customerAccountId || has(available.customers, action.customerAccountId));
    if (action.kind === "RECORD_PAYMENT") allowed = allowed && available.invoices.some((row) => row.id === action.invoiceId && row.revision === action.expectedRevision) && has(available.financialAccounts, action.financialAccountId);
    if (!allowed) fail("A ação usa registros que não estão no contexto autorizado. Selecione os registros pelo formulário de ações.", "COPILOT_UNKNOWN_RESOURCE", 403);
  }

  async function command(context: AuthenticatedContext, raw: unknown) {
    const input = copilotCommandSchema.parse(raw);
    await authorize(context);
    if (input.action === "PROPOSE" || input.action === "PROPOSE_SALE") {
      const proposal = await propose(context, input.action === "PROPOSE" ? `Formulário: ${input.payload.kind}` : "Formulário: fechar venda", input.payload, input.action === "PROPOSE_SALE");
      return { answer: "Confira os dados e os efeitos abaixo. A ação só será executada após sua confirmação.", sources: [], links: [], proposal, mode: "LOCAL" };
    }
    if (input.action === "CHAT") {
      if (!options.generate) {
        const normalized = input.message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (/\b(crie|criar|cadastre|cadastrar|registre|registrar|atualize|atualizar|altere|alterar|baixe|baixar|feche|fechar)\b/.test(normalized)) return { answer: "Use Ações neste Copilot para criar uma tarefa, atualizar um cliente, registrar uma despesa ou baixar um recebimento. Preencha os dados, revise a prévia e confirme. Para fechar uma venda, use Preparar fechamento no pipeline. Estas ações funcionam sem configurar um provedor de IA.", sources: [], links: [{ label: "Pipeline de vendas", href: "/oportunidades", entityType: "MODULE" }], proposal: null, mode: "LOCAL" };
        if (localCopilotSources(input.message).length) return localCopilotAnswer(input.message, await options.loadContext(context, input.message, options.now()));
        const fallback = await options.fallback(context, input.message) as { answer?: { directAnswer: string }; links?: unknown[] };
        return { answer: fallback.answer?.directAnswer ?? "Consulte leads, oportunidades, tarefas, clientes, financeiro e marketing. Em Ações, você pode preparar alterações com prévia e confirmação. A interpretação livre de pedidos pode ser habilitada na Governança de IA.", sources: [], links: fallback.links ?? [], proposal: null, mode: "LOCAL" };
      }
      const policy = await options.database.aIUseCaseVersion.findFirst({ where: { workspaceId: context.workspaceId, key: "metric-synthesis", status: "APPROVED" }, orderBy: { version: "desc" }, select: { id: true } });
      if (!policy) fail("A síntese gerencial de IA precisa estar aprovada na governança deste workspace.", "AI_USE_CASE_NOT_APPROVED");
      const [data, actionOptions] = await Promise.all([options.loadContext(context, input.message, options.now()), options.actions.options(context)]);
      const modelInput = { now: options.now().toISOString(), message: redact(input.message), history: input.history.map((item) => ({ ...item, content: redact(item.content) })), context: data, actionOptions, actionInputGuide };
      if (JSON.stringify(json(modelInput)).length > 100_000) fail("O contexto excede o limite desta consulta. Use os filtros dos módulos para uma análise mais específica.", "COPILOT_CONTEXT_LIMIT", 400);
      let generated: unknown;
      try { generated = await options.generate(sanitize(modelInput)); }
      catch (error) {
        if (error instanceof AIProviderError) fail("O provedor de IA não respondeu corretamente. Nenhuma ação foi executada.", error.code, 502);
        throw error;
      }
      const parsed = copilotOutputSchema.safeParse(generated);
      if (!parsed.success) {
        if (parsed.error.issues.some((issue) => issue.path.includes("totalCents"))) return { answer: "Os valores da venda não fecham: total deve ser igual à entrada declarada mais mensalidade × meses. Confirme o total e as condições; nenhuma venda foi alterada.", sources: [], links: [], proposal: null, mode: "OPENAI" };
        fail("A IA retornou uma proposta incompleta ou inválida. Reformule a solicitação; nenhum registro foi alterado.", "COPILOT_INVALID_OUTPUT", 502);
      }
      const output = parsed.data;
      const sources = data.sources.filter((source) => output.sources.includes(source.key)).map(({ key, label, href }) => ({ key, label, href }));
      let proposal: ReturnType<typeof present> | null = null;
      if (output.sale) {
        const sale = output.sale;
        const opportunityData = data.sources.find((source) => source.key === "oportunidades")?.data as { opportunities?: Array<{ id: string; revision: number; canWrite: boolean }> } | undefined;
        if (!opportunityData?.opportunities?.some((item) => item.id === sale.opportunityId && item.revision === sale.expectedRevision && item.canWrite)) fail("A oportunidade proposta não está no contexto autorizado e editável. Selecione o registro correto.", "COPILOT_UNKNOWN_OPPORTUNITY", 403);
        const linkedCustomerId = sale.customer?.mode === "LINK" ? sale.customer.accountId : null;
        if (linkedCustomerId && !actionOptions.customers.some((item) => item.id === linkedCustomerId)) fail("O cliente proposto não está no contexto autorizado. Selecione o cadastro pelo pipeline.", "COPILOT_UNKNOWN_RESOURCE", 403);
        proposal = await propose(context, input.message, sale, true);
      } else if (output.operation) {
        verifyActionContext(output.operation, data, actionOptions);
        proposal = await propose(context, input.message, output.operation, false);
      }
      await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.queried", entityType: "Workspace", entityId: context.workspaceId, changes: { requestFingerprint: hash(input.message), sources: sources.map((source) => source.key), externalProvider: true, governanceVersionId: policy.id, proposalId: proposal?.id ?? null } } });
      const coverage = data.period ? `\n\nPeríodo financeiro e de aquisição: ${data.period.fromDate} a ${data.period.toDate} (${data.period.timeZone})${data.period.assumed ? "; mês atual assumido por ausência de período explícito" : ""}. CRM, contratos, CS e integrações mostram o estado atual.` : "";
      return { answer: output.answer + coverage, sources, links: sources.map((source) => ({ ...source, entityType: "MODULE" })), proposal, mode: "OPENAI" };
    }

    const proposal = await options.database.aIAssistantProposal.findFirst({ where: { id: input.proposalId, workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: { in: proposalTypes } } });
    if (!proposal) fail("Proposta inexistente ou não autorizada.", "COPILOT_PROPOSAL_NOT_FOUND", 404);
    const resuming = input.action === "CONFIRM" && ["EXECUTING", "EXECUTION_FAILED", "PUBLISHED"].includes(proposal.status) && proposal.revision === input.expectedRevision + 1 && proposal.approvedByActorId === context.actorId;
    if (!resuming && (proposal.status !== "DRAFT" || proposal.revision !== input.expectedRevision)) fail("A proposta já foi finalizada ou alterada. Atualize a conversa.", "COPILOT_REVISION_CONFLICT");
    if (input.action === "CANCEL") {
      await options.database.$transaction(async (tx) => {
        const cancelled = await tx.aIAssistantProposal.updateMany({ where: { id: proposal.id, workspaceId: context.workspaceId, requestedByActorId: context.actorId, revision: input.expectedRevision, status: "DRAFT" }, data: { status: "CANCELLED", revision: { increment: 1 }, cancelledAt: options.now(), cancelledByActorId: context.actorId, cancellationReason: "Cancelado no Copilot pelo solicitante." } });
        if (!cancelled.count) fail("A proposta mudou durante o cancelamento.", "COPILOT_REVISION_CONFLICT");
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.cancelled", entityType: "AIAssistantProposal", entityId: proposal.id, changes: { type: proposal.type, domainMutationExecuted: false } } });
      });
      return { answer: "Proposta cancelada. Nenhum registro foi alterado.", proposal: null, links: [], sources: [] };
    }
    if (!resuming && options.now().getTime() - proposal.createdAt.getTime() >= lifetimeMs) fail("A proposta expirou. Solicite uma nova prévia com dados atualizados.", "COPILOT_PROPOSAL_EXPIRED");
    const isSale = proposal.type === "CLOSE_SALE";
    const payload = isSale ? copilotSaleSchema.parse(proposal.payload) : copilotActionSchema.parse(proposal.payload);
    if (!isSale && (payload as CopilotAction).kind !== proposal.type) fail("O tipo da proposta não corresponde à ação registrada.", "COPILOT_INVALID_PROPOSAL");
    if (!resuming) {
      const preview = isSale ? await options.sales.preview(context, payload as CopilotSale) : await options.actions.preview(context, payload as CopilotAction);
      if (hash(json(preview)) !== hash(proposal.preview)) fail("Os dados ou efeitos da ação mudaram desde a prévia. Gere uma nova proposta antes de confirmar.", "COPILOT_PREVIEW_CHANGED");
      await options.database.$transaction(async (tx) => {
        const claimed = await tx.aIAssistantProposal.updateMany({ where: { id: proposal.id, workspaceId: context.workspaceId, requestedByActorId: context.actorId, status: "DRAFT", revision: input.expectedRevision }, data: { status: "EXECUTING", revision: { increment: 1 }, approvedByActorId: context.actorId, approvedAt: options.now(), approvedReason: "Confirmação explícita da prévia no Copilot." } });
        if (!claimed.count) fail("A proposta já está sendo executada. Repita a confirmação para consultar o resultado.", "COPILOT_REVISION_CONFLICT");
        await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.confirmed", entityType: "AIAssistantProposal", entityId: proposal.id, changes: { type: proposal.type, revision: input.expectedRevision } } });
      });
    }
    // Domain services authorize retries and recover committed results by the same
    // idempotency key; a new preview would incorrectly reject an executed action.
    let result: unknown;
    try {
      result = isSale
        ? await options.sales.execute(context, { ...payload as CopilotSale, confirmed: true, idempotencyKey: proposal.id })
        : await options.actions.execute(context, payload as CopilotAction, { confirmed: true, idempotencyKey: proposal.id, expectedPreview: proposal.preview });
    } catch (error) {
      await options.database.aIAssistantProposal.updateMany({ where: { id: proposal.id, workspaceId: context.workspaceId, requestedByActorId: context.actorId, status: { in: ["EXECUTING", "EXECUTION_FAILED"] } }, data: { status: "EXECUTION_FAILED" } });
      throw error;
    }
    const actionResult = result as { answer?: string; links?: { label: string; href: string; entityType: string }[]; targetType?: string; targetId?: string };
    try {
      await options.database.aIAssistantProposal.update({ where: { id: proposal.id, workspaceId: context.workspaceId }, data: { status: "PUBLISHED", publishedTargetType: isSale ? "Opportunity" : actionResult.targetType ?? null, publishedTargetId: isSale ? (payload as CopilotSale).opportunityId : actionResult.targetId ?? null } });
    } catch {
      fail("A ação foi registrada, mas a confirmação do Copilot ficou pendente. Clique em recuperar resultado para consultar a mesma ação sem duplicá-la.", "COPILOT_CONFIRMATION_RECOVERY", 503);
    }
    return { answer: isSale ? "Fechamento registrado conforme sua confirmação. Consulte o contrato e o financeiro para as etapas pendentes. Nenhum recebimento foi confirmado automaticamente." : actionResult.answer ?? "Ação registrada conforme sua confirmação.", result: json(result), proposal: null, sources: [], links: isSale ? [{ label: "Financeiro", href: "/financeiro", entityType: "MODULE" }, { label: "Contratos", href: "/contratos", entityType: "MODULE" }] : actionResult.links ?? [] };
  }
  return { command, screen };
}

export function getCopilotService() {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  const provider = process.env.COPILOT_EXTERNAL_ENABLED === "true" && key && model ? new OpenAICompatibleProvider({ endpoint: "https://api.openai.com/v1/chat/completions", model, authorizationToken: key, timeoutMs: 25_000 }) : null;
  return createCopilotService({
    database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date(), loadContext: loadCopilotContext, sales: getSaleCompletionService(), actions: getCopilotActionsService(),
    generate: provider ? async (input) => (await provider.generateJson({ system: copilotSystemPrompt, input, maxOutputTokens: 4000 })).output : null,
    fallback: async (context, message) => {
      const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
      const period = resolveCopilotPeriod(message, new Date(), workspace.timeZone);
      return getAssistantService().command(context, { action: "QUERY", payload: { question: message.padEnd(4, "?").slice(0, 1000), preset: period.preset, fromDate: period.fromDate, toDate: period.toDate } });
    },
  });
}
