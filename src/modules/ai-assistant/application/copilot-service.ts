import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import type { AIAssistantProposal, Prisma, PrismaClient } from "@/generated/prisma/client";
import { copilotCommandSchema, copilotOutputSchema, copilotSaleSchema, copilotSystemPrompt, copilotResponseSchema, copilotActionInputGuide, type CopilotSale } from "@/modules/ai-assistant/domain/copilot-contracts";
import { copilotActionSchema, type CopilotAction } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import { getCopilotActionsService } from "@/modules/ai-assistant/application/copilot-actions-service";
import { getAssistantService } from "@/modules/ai-assistant/application/assistant-service";
import { loadCopilotContext, type CopilotContext } from "@/modules/ai-assistant/application/copilot-context";
import { localCopilotAnswer, localCopilotSources } from "@/modules/ai-assistant/application/copilot-local-answer";
import { resolveCopilotPeriod } from "@/modules/ai-assistant/domain/copilot-period";
import { generateCopilotWithSearch, type CopilotSearchEvidence } from "@/modules/ai-assistant/application/copilot-retrieval";
import { searchCopilotRecords } from "@/modules/ai-assistant/application/copilot-record-search";
import { copilotRecordInputGuide } from "@/modules/ai-assistant/domain/copilot-record-contracts";
import { getCopilotPlanService } from "@/modules/ai-assistant/application/copilot-plan-service";
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
  loadContext: (context: AuthenticatedContext, message?: string, now?: Date, retrievalQuery?: string) => Promise<CopilotContext>;
  generate: ((input: unknown) => Promise<unknown>) | null;
  search?: typeof searchCopilotRecords;
  plans?: Pick<ReturnType<typeof getCopilotPlanService>, "propose" | "confirm" | "cancel" | "screen">;
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
const proposalTypes = ["CLOSE_SALE", "CREATE_TASK", "UPDATE_CUSTOMER", "CREATE_EXPENSE", "RECORD_PAYMENT", "CREATE_LEAD", "MOVE_LEAD", "CREATE_CUSTOMER", "CREATE_INCOME", "CREATE_INDICATOR"];
const lifetimeMs = 30 * 60_000;
function fail(message: string, code: string, statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
const redactSecrets = (text: string) => text.replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/g, "[SEGREDO_REMOVIDO]").replace(/\b(?:bearer|token|password|senha|secret)\s*[:= ]\s*[^\s,;]+/gi, "[SEGREDO_REMOVIDO]");
const redact = (text: string) => redactSecrets(text).replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[EMAIL_REMOVIDO]").replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[DOCUMENTO_REMOVIDO]");

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
    const [pendingRows, historyRows, actionOptions, plans] = await Promise.all([
      options.database.aIAssistantProposal.findMany({ where: { ...where, OR: [{ status: "DRAFT", createdAt: { gt: new Date(options.now().getTime() - lifetimeMs) } }, { status: { in: ["EXECUTING", "EXECUTION_FAILED"] } }] }, orderBy: { createdAt: "desc" }, take: 10 }),
      options.database.aIAssistantProposal.findMany({ where, orderBy: { createdAt: "desc" }, take: 30 }),
      options.actions.options(context),
      options.plans?.screen(context) ?? { pending: [], history: [] },
    ]);
    const readable = new Map<string, boolean>();
    for (const row of [...pendingRows, ...historyRows]) {
      if (!readable.has(row.id)) readable.set(row.id, await canSee(context, row));
    }
    return {
      mode: options.generate ? "OPENAI" : "LOCAL",
      options: actionOptions,
      pending: [...plans.pending, ...pendingRows.filter((row) => readable.get(row.id)).map(present)].sort((a, b) => b.expiresAt.localeCompare(a.expiresAt)).slice(0, 10),
      history: [...plans.history, ...historyRows.filter((row) => readable.get(row.id)).map((row) => ({
        id: row.id, type: row.type, preview: row.preview,
        status: (row.status === "DRAFT" && options.now().getTime() - row.createdAt.getTime() >= lifetimeMs) || (row.status === "CANCELLED" && row.cancellationReason === "Prévia expirada; substituída por uma nova solicitação.") ? "EXPIRED" : row.status,
        createdAt: row.createdAt.toISOString(), approvedAt: row.approvedAt?.toISOString() ?? null, cancelledAt: row.cancelledAt?.toISOString() ?? null,
      }))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
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

  function verifyActionContext(action: CopilotAction, data: CopilotContext, available: Awaited<ReturnType<Options["actions"]["options"]>>, evidence: CopilotSearchEvidence[] = []) {
    const has = (records: readonly { id: string }[], id: string) => records.some((record) => record.id === id);
    const found = (entity: string, id: string, revision?: number) => evidence.some(({ result }) => result?.entity === entity && result.records.some((record) => record.id === id && (revision === undefined || record.data.revision === revision)));
    // Search proves read access only. Canonical preview always reauthorizes the
    // specific write before a proposal can be persisted.
    let allowed = available.capabilities.includes(action.kind)
      || (action.kind === "CREATE_TASK" && found("LEAD", action.leadId))
      || (action.kind === "RECORD_PAYMENT" && found("INVOICE", action.invoiceId, action.expectedRevision));
    if (action.kind === "CREATE_TASK") {
      allowed = allowed && (has(available.leads, action.leadId) || found("LEAD", action.leadId));
      if (action.opportunityId) {
        const opportunities = data.sources.find((source) => source.key === "oportunidades")?.data as { opportunities?: { id: string; canWrite: boolean }[] } | undefined;
        allowed = allowed && (Boolean(opportunities?.opportunities?.some((row) => row.id === action.opportunityId && row.canWrite)) || found("OPPORTUNITY", action.opportunityId));
      }
    }
    if (action.kind === "UPDATE_CUSTOMER") allowed = allowed && (available.customers.some((row) => row.id === action.accountId && row.revision === action.expectedRevision) || found("CUSTOMER", action.accountId, action.expectedRevision));
    if (action.kind === "CREATE_EXPENSE" || action.kind === "CREATE_INCOME") allowed = allowed && (has(action.kind === "CREATE_INCOME" ? available.incomeCategories ?? [] : available.categories, action.categoryId) || found("CATEGORY", action.categoryId)) && (has(available.financialAccounts, action.financialAccountId) || found("FINANCIAL_ACCOUNT", action.financialAccountId)) && (!action.customerAccountId || has(available.customers, action.customerAccountId) || found("CUSTOMER", action.customerAccountId));
    if (action.kind === "RECORD_PAYMENT") allowed = allowed && (available.invoices.some((row) => row.id === action.invoiceId && row.revision === action.expectedRevision) || found("INVOICE", action.invoiceId, action.expectedRevision)) && (has(available.financialAccounts, action.financialAccountId) || found("FINANCIAL_ACCOUNT", action.financialAccountId));
    if (action.kind === "CREATE_LEAD") allowed = allowed && has(available.pipelines ?? [], action.pipelineId) && Boolean(available.leadSources?.some(source => source.key === action.sourceKey));
    if (action.kind === "MOVE_LEAD") allowed = (allowed || found("LEAD", action.leadId)) && (available.moveLeads?.some(lead => lead.id === action.leadId && lead.updatedAt === action.expectedUpdatedAt) || found("LEAD", action.leadId)) === true && Boolean(available.pipelines?.some(pipeline => pipeline.stages.some(stage => stage.id === action.targetStageId)) || evidence.some(({result}) => result?.entity === "LEAD" && result.records.some(record => record.id === action.leadId && Array.isArray(record.data.transitions) && record.data.transitions.some((stage: {stageId: string}) => stage.stageId === action.targetStageId))));
    if (action.kind === "CREATE_INDICATOR") allowed = allowed && Boolean(available.metrics?.some(metric => metric.id === action.metricKey && metric.dateBases.includes(action.dateBasis)));
    if (!allowed) fail("A ação usa registros que não estão no contexto autorizado. Peça para localizar os registros corretos na conversa e preparar outra prévia.", "COPILOT_UNKNOWN_RESOURCE", 403);
  }

  async function command(context: AuthenticatedContext, raw: unknown) {
    const input = copilotCommandSchema.parse(raw);
    await authorize(context);
    if (input.action === "PROPOSE_PLAN") {
      if (!options.plans) fail("Planos de ações indisponíveis neste ambiente.", "COPILOT_PLAN_UNAVAILABLE", 503);
      const proposal = await options.plans.propose(context, "Formulário: plano de ações", input.payload);
      return { answer: "Revise todas as etapas. O plano só será executado após sua confirmação e será desfeito por inteiro se alguma etapa falhar.", sources: [], links: [], proposal, mode: "LOCAL" };
    }
    if (input.action === "PROPOSE" || input.action === "PROPOSE_SALE") {
      const proposal = await propose(context, input.action === "PROPOSE" ? `Formulário: ${input.payload.kind}` : "Formulário: fechar venda", input.payload, input.action === "PROPOSE_SALE");
      return { answer: "Confira os dados e os efeitos abaixo. A ação só será executada após sua confirmação.", sources: [], links: [], proposal, mode: "LOCAL" };
    }
    if (input.action === "CHAT") {
      if (!options.generate) {
        const normalized = input.message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (/\b(crie|criar|cadastre|cadastrar|registre|registrar|atualize|atualizar|altere|alterar|baixe|baixar|feche|fechar)\b/.test(normalized)) return { answer: "A interpretação de ações por conversa precisa da conexão com a OpenAI e da governança habilitadas nesta empresa. Nenhuma ação foi executada. Você pode continuar operando pelos módulos do CRM.", sources: [], links: [{ label: "Pipeline de vendas", href: "/oportunidades", entityType: "MODULE" }], proposal: null, mode: "LOCAL" };
        if (localCopilotSources(input.message).length) return localCopilotAnswer(input.message, await options.loadContext(context, input.message, options.now()));
        const fallback = await options.fallback(context, input.message) as { answer?: { directAnswer: string }; links?: unknown[] };
        return { answer: fallback.answer?.directAnswer ?? "Consulte leads, oportunidades, tarefas, clientes, financeiro e marketing. As alterações por conversa exigem a conexão com a IA habilitada. A interpretação livre de pedidos pode ser habilitada na Governança de IA.", sources: [], links: fallback.links ?? [], proposal: null, mode: "LOCAL" };
      }
      const policy = await options.database.aIUseCaseVersion.findFirst({ where: { workspaceId: context.workspaceId, key: "metric-synthesis", status: "APPROVED" }, orderBy: { version: "desc" }, select: { id: true } });
      if (!policy) fail("A síntese gerencial de IA precisa estar aprovada na governança deste workspace.", "AI_USE_CASE_NOT_APPROVED");
      const retrievalQuery = /["“][^"”]{2,80}["”]/.test(input.message) ? input.message : [input.message, ...input.history.filter((item) => item.role === "user").slice(-2).map((item) => item.content.slice(0, 600))].join("\n");
      const [data, actionOptions] = await Promise.all([options.loadContext(context, input.message, options.now(), retrievalQuery), options.actions.options(context, retrievalQuery)]);
      const contactRequested = /\bleads?\b/i.test([...input.history.filter(item => item.role === "user").map(item => item.content), input.message].join("\n"));
      const userText = contactRequested ? redactSecrets : redact;
      const modelInput = { now: options.now().toISOString(), message: userText(input.message), history: input.history.map((item) => ({ ...item, content: item.role === "user" ? userText(item.content) : redact(item.content) })), context: data, actionOptions, responseSchema: copilotResponseSchema, actionInputGuide: copilotActionInputGuide, searchInputGuide: copilotRecordInputGuide };
      if (JSON.stringify(json(modelInput)).length > 100_000) fail("O contexto excede o limite desta consulta. Use os filtros dos módulos para uma análise mais específica.", "COPILOT_CONTEXT_LIMIT", 400);
      let generated: unknown;
      let evidence: CopilotSearchEvidence[] = [];
      try {
        ({ generated, evidence } = await generateCopilotWithSearch({ input: modelInput, generate: options.generate, search: options.search ? (query) => options.search!(context, query) : undefined, sanitize: (value) => { const safe = sanitize(value) as Record<string, unknown>; return { ...safe, message: modelInput.message, history: modelInput.history }; } }));
      }
      catch (error) {
        if (error instanceof AIProviderError) {
          const messages: Record<string, string> = {
            PROVIDER_AUTHENTICATION: "A chave OpenAI não foi aceita. Revise OPENAI_API_KEY na Vercel.",
            PROVIDER_ACCESS_DENIED: "A conta OpenAI não tem permissão para esta solicitação.",
            PROVIDER_QUOTA_EXCEEDED: "A conta OpenAI está sem cota disponível. Verifique os créditos e o limite de uso da API.",
            PROVIDER_RATE_LIMITED: "O limite temporário da OpenAI foi atingido. Aguarde antes de tentar novamente.",
            PROVIDER_MODEL_UNAVAILABLE: "O modelo configurado não está disponível para esta chave OpenAI.",
            PROVIDER_OUTPUT_TRUNCATED: "A resposta excedeu o limite de geração. Divida o pedido em etapas menores.",
            PROVIDER_TIMEOUT: "A OpenAI excedeu o tempo de resposta. Tente uma consulta mais específica.",
            PROVIDER_REFUSAL: "A OpenAI não conseguiu atender esta solicitação. Reformule o pedido.",
          };
          fail(`${messages[error.code] ?? "O provedor de IA não respondeu corretamente."} Nenhuma ação foi executada.`, error.code, 502);
        }
        throw error;
      }
      const parsed = copilotOutputSchema.safeParse(generated);
      if (!parsed.success) {
        if (parsed.error.issues.some((issue) => issue.path.includes("totalCents"))) return { answer: "Os valores da venda não fecham: total deve ser igual à entrada declarada mais mensalidade × meses. Confirme o total e as condições; nenhuma venda foi alterada.", sources: [], links: [], proposal: null, mode: "OPENAI" };
        fail("A IA retornou uma proposta incompleta ou inválida. Reformule a solicitação; nenhum registro foi alterado.", "COPILOT_INVALID_OUTPUT", 502);
      }
      const output = parsed.data;
      const sourceCatalog = [...data.sources, ...evidence.flatMap(({ result }) => result ? [result.source] : [])];
      const sources = [...new Map(sourceCatalog.filter((source) => output.sources.includes(source.key)).map(({ key, label, href }) => [key, { key, label, href }])).values()];
      let proposal: ReturnType<typeof present> | Awaited<ReturnType<NonNullable<Options["plans"]>["propose"]>> | null = null;
      const verifySaleContext = (sale: CopilotSale) => {
        const opportunityData = data.sources.find((source) => source.key === "oportunidades")?.data as { opportunities?: Array<{ id: string; revision: number; canWrite: boolean }> } | undefined;
        const searched = evidence.some(({ result }) => result?.entity === "OPPORTUNITY" && result.records.some((item) => item.id === sale.opportunityId && item.data.revision === sale.expectedRevision && item.data.canWrite === true));
        if (!searched && !opportunityData?.opportunities?.some((item) => item.id === sale.opportunityId && item.revision === sale.expectedRevision && item.canWrite)) fail("A oportunidade proposta não está no contexto autorizado e editável. Selecione o registro correto.", "COPILOT_UNKNOWN_OPPORTUNITY", 403);
        const linkedCustomerId = sale.customer?.mode === "LINK" ? sale.customer.accountId : null;
        if (linkedCustomerId && !actionOptions.customers.some((item) => item.id === linkedCustomerId) && !evidence.some(({ result }) => result?.entity === "CUSTOMER" && result.records.some((item) => item.id === linkedCustomerId))) fail("O cliente proposto não está no contexto autorizado. Selecione o cadastro pelo pipeline.", "COPILOT_UNKNOWN_RESOURCE", 403);
      };
      if (output.plan) {
        if (!options.plans) fail("Planos de ações indisponíveis neste ambiente.", "COPILOT_PLAN_UNAVAILABLE", 503);
        for (const step of output.plan.steps) {
          if (step.kind === "CLOSE_SALE") verifySaleContext(step.payload);
          else verifyActionContext(step, data, actionOptions, evidence);
        }
        proposal = await options.plans.propose(context, input.message, output.plan);
      } else if (output.sale) {
        verifySaleContext(output.sale);
        proposal = await propose(context, input.message, output.sale, true);
      } else if (output.operation) {
        verifyActionContext(output.operation, data, actionOptions, evidence);
        proposal = await propose(context, input.message, output.operation, false);
      }
      await options.database.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.queried", entityType: "Workspace", entityId: context.workspaceId, changes: { requestFingerprint: hash(input.message), sources: sources.map((source) => source.key), searches: evidence.map(({ query, result }) => ({ entity: query.entity, page: query.page, count: result?.records.length ?? null, hasMore: result?.hasMore ?? null })), externalProvider: true, governanceVersionId: policy.id, proposalId: proposal?.id ?? null } } });
      const coverage = data.period ? `\n\nPeríodo do resumo financeiro e de aquisição: ${data.period.fromDate} a ${data.period.toDate} (${data.period.timeZone})${data.period.assumed ? "; mês atual assumido por ausência de período explícito" : ""}. CRM, contratos, CS e integrações mostram o estado atual.${evidence.length ? " As buscas detalhadas têm filtros e cobertura próprios, informados em cada resultado; não se limitam necessariamente ao período do resumo." : ""}` : "";
      const recordLinks = evidence.flatMap(({ result }) => result && output.sources.includes(result.source.key) ? result.records.map(({ label, href }) => ({ label, href, entityType: result.entity })) : []);
      const links = [...new Map([...recordLinks, ...sources.map((source) => ({ ...source, entityType: "MODULE" }))].map((link) => [link.href, link])).values()].slice(0, 15);
      return { answer: output.answer + coverage, sources, links, proposal, mode: "OPENAI" };
    }

    const proposal = await options.database.aIAssistantProposal.findFirst({ where: { id: input.proposalId, workspaceId: context.workspaceId, requestedByActorId: context.actorId, type: { in: [...proposalTypes, "ACTION_PLAN"] } } });
    if (!proposal) fail("Proposta inexistente ou não autorizada.", "COPILOT_PROPOSAL_NOT_FOUND", 404);
    if (proposal.type === "ACTION_PLAN") {
      if (!options.plans) fail("Planos de ações indisponíveis neste ambiente.", "COPILOT_PLAN_UNAVAILABLE", 503);
      const decision = { proposalId: input.proposalId, expectedRevision: input.expectedRevision };
      return input.action === "CONFIRM" ? options.plans.confirm(context, { ...decision, confirmed: true }) : options.plans.cancel(context, decision);
    }
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
  const provider = process.env.COPILOT_EXTERNAL_ENABLED === "true" && key && model ? new OpenAICompatibleProvider({ endpoint: "https://api.openai.com/v1/chat/completions", model, authorizationToken: key, timeoutMs: 45_000 }) : null;
  return createCopilotService({
    database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date(), loadContext: loadCopilotContext, search: searchCopilotRecords, plans: getCopilotPlanService(), sales: getSaleCompletionService(), actions: getCopilotActionsService(),
    generate: provider ? async (input) => (await provider.generateJson({ system: copilotSystemPrompt, input, maxOutputTokens: 12000 })).output : null,
    fallback: async (context, message) => {
      const workspace = await getDatabaseClient().workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
      const period = resolveCopilotPeriod(message, new Date(), workspace.timeZone);
      return getAssistantService().command(context, { action: "QUERY", payload: { question: message.padEnd(4, "?").slice(0, 1000), preset: period.preset, fromDate: period.fromDate, toDate: period.toDate } });
    },
  });
}
