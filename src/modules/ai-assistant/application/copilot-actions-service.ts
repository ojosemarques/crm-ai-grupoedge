import { createLeadEntryService } from "@/modules/leads/application/lead-entry-service";
import { createLeadIntakeService } from "@/modules/leads/application/lead-intake-service";
import { createAutomationEngineService } from "@/modules/automations/application/automation-engine-service";
import { createPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { normalizePhone } from "@/modules/leads/domain/phone-normalizer";
import { createAnalyticsBuilderService } from "@/modules/analytics-builder/application/analytics-builder-service";
import { analyticsWidgetInputSchema, validateWidgetCompatibility } from "@/modules/analytics-builder/domain/analytics-builder-contracts";
import { createRevenueMetricsService } from "@/modules/metrics/application/revenue-metrics-service";
import { revenueMetricRegistry } from "@/modules/metrics/domain/revenue-metric-registry";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { createAccountService } from "@/modules/accounts/application/account-service";
import { createOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { copilotActionSchema, type CopilotAction, type CopilotActionOptions, type CopilotActionPreview } from "@/modules/ai-assistant/domain/copilot-action-contracts";
import { dailyProspectingBatchSchema, type DailyProspectingChannel, type DailyProspectingEntry, type DailyProspectingList } from "@/modules/ai-assistant/domain/copilot-daily-prospecting";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { createFinanceService } from "@/modules/finance/application/finance-service";
import { createLeadListService } from "@/modules/leads/application/lead-list-service";
import { createLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { copilotSearchTerms, searchCopilotPages } from "@/modules/ai-assistant/domain/copilot-search";
import { canonicalJson } from "@/modules/integrations/domain/integration-policy";
import { createPaymentService } from "@/modules/payments/application/payment-service";
import { createAuthorizationService, type ResourceScope } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDateAt, workspaceDayRange } from "@/shared/core/time/workspace-time";

type Options = { database: PrismaClient; now: () => Date };
type ActionResult = { answer: string; result: unknown; targetType: string; targetId: string; links: Array<{ label: string; href: string; entityType: string }> };
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)) as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function fail(message: string, code = "COPILOT_ACTION_INVALID", statusCode = 409): never { throw new ApplicationError(message, { code, statusCode, expose: true }); }
const fieldLabels: Record<string, string> = { fullName: "Nome", email: "E-mail", organizationName: "Empresa", jobTitle: "Cargo", city: "Cidade", stateCode: "UF", interestSummary: "Interesse", priorityBandCode: "Prioridade", budgetBrl: "Orçamento", name: "Nome", legalName: "Razão social", domain: "Site/domínio", segment: "Segmento", size: "Porte" };
const fieldDetail = ([key, value]: [string, unknown]) => ({ label: fieldLabels[key] ?? key, after: value === "UNKNOWN" ? "Não informado" : String(value) });
const money = (value: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) / 100);
const prospectingResultLabels: Record<string, string> = {
  CONNECTED: "Atendeu", NO_ANSWER: "Não atendeu", BUSY: "Ocupado", VOICEMAIL: "Caixa postal",
  WRONG_NUMBER: "Número incorreto", CHANNEL_UNAVAILABLE: "Canal indisponível", SENT: "Mensagem enviada",
  FAILED: "Falhou", PROFILE_NOT_FOUND: "Instagram não encontrado", COMPLETED: "Seguiu",
  ALREADY_FOLLOWING: "Já seguia",
};
const linksFor = (kind: CopilotAction["kind"], id?: string) => [{
  label: kind === "COMPLETE_PROSPECTING_TASKS" ? "Meu Dia" : kind === "CREATE_TASK" ? "Tarefas do lead" : kind === "UPDATE_CUSTOMER" ? "Cliente" : kind === "RECORD_PAYMENT" ? "Cobranças" : "Financeiro",
  href: kind === "COMPLETE_PROSPECTING_TASKS" ? "/meu-dia" : kind === "CREATE_TASK" ? `/leads/${id}` : kind === "UPDATE_CUSTOMER" ? `/contas/${id}` : kind === "RECORD_PAYMENT" ? `/pagamentos/${id}` : "/financeiro", entityType: "MODULE",
}];

// Compose existing domain services inside one transaction, including the replay
// receipt. A dropped HTTP response can then be retried without another mutation.
function withinTransaction(tx: Prisma.TransactionClient): PrismaClient {
  return new Proxy(tx, { get(target, property) {
    if (property === "$transaction") return async (operation: unknown) => {
      if (typeof operation !== "function") throw new Error("Callback transaction required.");
      return operation(tx);
    };
    return Reflect.get(target, property);
  } }) as PrismaClient;
}

export function createCopilotActionsService(options: Options) {
  const indicatorWidget = (action: Extract<CopilotAction, { kind: "CREATE_INDICATOR" }>) => analyticsWidgetInputSchema.parse({ title: action.name, metricKey: action.metricKey, type: "KPI", aggregation: "LATEST", dateBasis: action.dateBasis, period: { preset: action.period } });
  async function indicatorRuntimeAvailable(database: PrismaClient) {
    const [result] = await database.$queryRaw<Array<{ allowed: boolean }>>`SELECT bool_and(has_table_privilege(current_user, format('%I.%I', current_schema(), table_name), 'SELECT') AND has_table_privilege(current_user, format('%I.%I', current_schema(), table_name), 'INSERT')) AS allowed FROM unnest(ARRAY['analytics_dashboards','analytics_widgets','analytics_mutation_receipts']) AS table_name`;
    return result?.allowed === true;
  }
  async function loadAuthorizedProspectingTasks(database: PrismaClient, context: AuthenticatedContext, action: Extract<CopilotAction, { kind: "COMPLETE_PROSPECTING_TASKS" }>) {
    const taskIds = action.items.map((item) => item.taskId);
    if (new Set(taskIds).size !== taskIds.length) fail("A mesma tarefa foi informada mais de uma vez.", "COPILOT_DUPLICATE_TASK");
    const tasks = await database.task.findMany({
      where: { id: { in: taskIds }, workspaceId: context.workspaceId, deletedAt: null },
      include: { lead: { include: { routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } } },
      orderBy: [{ leadId: "asc" }, { dueAt: "asc" }, { id: "asc" }],
    });
    if (tasks.length !== taskIds.length) fail("Uma ou mais tarefas não existem ou não pertencem a esta empresa.", "COPILOT_UNKNOWN_RESOURCE", 403);
    const authorization = createAuthorizationService({ database });
    for (const task of tasks) {
      const item = action.items.find((candidate) => candidate.taskId === task.id)!;
      if (task.leadId !== item.leadId || task.kind !== item.taskKind || task.assigneeMemberId !== context.memberId || !task.sourceKey?.startsWith("active-prospecting:") || !["OPEN", "IN_PROGRESS"].includes(task.status)) {
        fail("A lista diária mudou. Solicite a lista novamente antes de concluir as tarefas.", "COPILOT_DAILY_LIST_STALE");
      }
      const scope = { workspaceId: context.workspaceId, resourceType: "Lead", resourceId: task.lead.id, ownerMemberId: task.lead.ownerMemberId, queueId: task.lead.queueId, teamId: task.lead.routingQueue?.teamId ?? task.lead.queue?.teamId ?? null };
      for (const key of [PermissionKeys.LEADS_READ, PermissionKeys.TASKS_READ, PermissionKeys.TASKS_WRITE]) await authorization.assertAuthorized(context, key, scope);
    }
    return tasks;
  }

  async function dailyList(context: AuthenticatedContext, channel: DailyProspectingChannel): Promise<DailyProspectingList> {
    const database = options.database;
    const authorization = createAuthorizationService({ database });
    const workspace = await database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
    const localDate = workspaceDateAt(options.now(), workspace.timeZone);
    const range = workspaceDayRange(localDate, workspace.timeZone);
    const config = await database.prospectingSellerConfig.findUnique({ where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: context.memberId } }, select: { dailyCapacity: true } });
    const target = Math.min(config?.dailyCapacity ?? 75, 75);
    const taskKinds = channel === "CALL" ? ["CALL" as const] : ["INSTAGRAM_FOLLOW" as const, "INSTAGRAM_MESSAGE" as const];
    const tasks = await database.task.findMany({
      where: {
        workspaceId: context.workspaceId,
        assigneeMemberId: context.memberId,
        sourceKey: { startsWith: "active-prospecting:" },
        kind: { in: taskKinds },
        status: { in: ["OPEN", "IN_PROGRESS"] },
        dueAt: { lt: range.end },
        deletedAt: null,
        lead: { deletedAt: null, status: { in: ["OPEN", "QUALIFIED"] }, contactPreference: { not: "DO_NOT_CONTACT" }, currentStage: { stableKey: { not: "active-prospecting.conversation-started" } } },
      },
      orderBy: [{ dueAt: "asc" }, { leadId: "asc" }, { id: "asc" }],
      select: {
        id: true, leadId: true, kind: true,
        lead: {
          select: {
            id: true, fullName: true, city: true, jobTitle: true, normalizedPhone: true, ownerMemberId: true, queueId: true,
            routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } },
            contact: { select: { points: { where: { deletedAt: null, doNotContact: false, type: { in: ["PHONE", "WHATSAPP", "INSTAGRAM"] } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { type: true, originalValue: true, normalizedValue: true } } } },
          },
        },
      },
    });
    const grouped = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const rows = grouped.get(task.leadId) ?? [];
      if (!rows.some((row) => row.kind === task.kind)) rows.push(task);
      grouped.set(task.leadId, rows);
    }
    const selectedGroups: typeof tasks[] = [];
    for (const rows of grouped.values()) {
      const lead = rows[0]!.lead;
      const hasPhone = Boolean(lead.normalizedPhone?.trim()) || Boolean(lead.contact?.points.some((point) => (point.type === "PHONE" || point.type === "WHATSAPP") && Boolean((point.originalValue || point.normalizedValue)?.trim())));
      if (channel === "CALL" && !hasPhone) continue;
      const scope = { workspaceId: context.workspaceId, resourceType: "Lead", resourceId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null };
      const decisions = await Promise.all([PermissionKeys.LEADS_READ, PermissionKeys.TASKS_READ, PermissionKeys.TASKS_WRITE].map((key) => authorization.authorize(context, key, scope)));
      if (decisions.every((decision) => decision.allowed)) selectedGroups.push(rows);
      if (selectedGroups.length >= target) break;
    }
    const candidateRows = await database.prospectCandidate.findMany({
      where: { workspaceId: context.workspaceId, leadId: { in: selectedGroups.map((rows) => rows[0]!.leadId) }, status: "RELEASED" },
      select: { leadId: true, instagram: true },
    });
    const instagramByLead = new Map(candidateRows.map((candidate) => [candidate.leadId!, candidate.instagram]));
    const entries: DailyProspectingEntry[] = selectedGroups.flatMap((rows, index) => {
      const lead = rows[0]!.lead;
      const phones = [...new Set([
        lead.normalizedPhone,
        ...(lead.contact?.points.filter((point) => point.type === "PHONE" || point.type === "WHATSAPP").map((point) => point.originalValue || point.normalizedValue) ?? []),
      ].filter((value): value is string => Boolean(value?.trim())))];
      const instagramPoint = lead.contact?.points.find((point) => point.type === "INSTAGRAM");
      return [{
        number: index + 1,
        leadId: lead.id,
        name: lead.fullName,
        city: lead.city,
        role: lead.jobTitle,
        phones,
        instagram: instagramPoint?.originalValue || instagramPoint?.normalizedValue || instagramByLead.get(lead.id) || null,
        tasks: rows.map((task) => ({ taskId: task.id, kind: task.kind as "CALL" | "INSTAGRAM_MESSAGE" | "INSTAGRAM_FOLLOW" })),
      }];
    }).map((entry, index) => ({ ...entry, number: index + 1 }));
    const expiresAt = range.end;
    const batch = dailyProspectingBatchSchema.parse({
      batchId: randomUUID(), channel, localDate, expiresAt: expiresAt.toISOString(),
      items: entries.map((entry) => ({ number: entry.number, leadId: entry.leadId, tasks: entry.tasks })),
    });
    return { batch, target, truncated: grouped.size > selectedGroups.length, entries };
  }
  async function authorized(database: PrismaClient, context: AuthenticatedContext, action: CopilotAction) {
    const authorization = createAuthorizationService({ database });
    const check = (key: PermissionKey, scope: ResourceScope) => authorization.assertAuthorized(context, key, scope);
    if (action.kind === "CREATE_LEAD") {
      const queue = await database.queue.findFirst({ where: { workspaceId: context.workspaceId, isGeneral: true, deletedAt: null } });
      if (!queue) fail("Configure uma fila de entrada para cadastrar leads.");
      await check(PermissionKeys.LEADS_WRITE, { workspaceId: context.workspaceId, resourceType: "LeadEntry", queueId: queue.id, teamId: queue.teamId });
    } else if (action.kind === "CREATE_CUSTOMER") {
      for (const key of [PermissionKeys.ACCOUNTS_READ, PermissionKeys.ACCOUNTS_WRITE]) await check(key, { workspaceId: context.workspaceId, resourceType: "Account" });
    } else if (action.kind === "CREATE_INDICATOR") {
      for (const key of [PermissionKeys.METRICS_READ, PermissionKeys.OPERATIONS_MANAGE]) await check(key, { workspaceId: context.workspaceId, resourceType: "AnalyticsDashboard", memberId: context.memberId });
      if (!await indicatorRuntimeAvailable(database)) fail("A criação de indicadores aguarda habilitação das permissões do banco. As outras ações do Copilot continuam disponíveis.", "COPILOT_INDICATOR_UNAVAILABLE", 503);
    } else if (action.kind === "COMPLETE_PROSPECTING_TASKS") {
      await loadAuthorizedProspectingTasks(database, context, action);
    } else if (action.kind === "CREATE_TASK" || action.kind === "MOVE_LEAD") {
      const lead = await database.lead.findFirst({ where: { id: action.leadId, workspaceId: context.workspaceId, deletedAt: null }, include: { routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } });
      if (!lead) fail("Lead inexistente ou não autorizado.", "NOT_FOUND", 404);
      const scope = { workspaceId: context.workspaceId, resourceType: "Lead", resourceId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null };
      for (const key of action.kind === "MOVE_LEAD" ? [PermissionKeys.LEADS_READ, PermissionKeys.LEADS_WRITE] : [PermissionKeys.LEADS_READ, PermissionKeys.TASKS_READ, PermissionKeys.TASKS_WRITE]) await check(key, scope);
      if (action.kind === "CREATE_TASK" && action.opportunityId) {
        const opportunity = await database.opportunity.findFirst({ where: { workspaceId: context.workspaceId, id: action.opportunityId, leadId: lead.id, deletedAt: null } });
        if (!opportunity) fail("A oportunidade não pertence ao lead selecionado.");
        await check(PermissionKeys.OPPORTUNITIES_READ, { ...scope, resourceType: "Opportunity", resourceId: opportunity.id, opportunityId: opportunity.id, ownerMemberId: opportunity.ownerMemberId });
      }
    } else if (action.kind === "UPDATE_CUSTOMER") {
      // Keep the same write scope as the canonical account update service.
      const scope = { workspaceId: context.workspaceId, resourceType: "Account", resourceId: action.accountId };
      await check(PermissionKeys.ACCOUNTS_READ, scope);
      await check(PermissionKeys.ACCOUNTS_WRITE, scope);
      if (!await database.account.findFirst({ where: { workspaceId: context.workspaceId, id: action.accountId, deletedAt: null }, select: { id: true } })) fail("Cliente inexistente ou não autorizado.", "NOT_FOUND", 404);
    } else {
      const scope = { workspaceId: context.workspaceId, resourceType: "Finance" };
      await check(PermissionKeys.FINANCE_READ, scope);
      await check(PermissionKeys.FINANCE_MANAGE, scope);
      if (action.kind === "RECORD_PAYMENT") {
        const invoice = await database.invoice.findFirst({ where: { workspaceId: context.workspaceId, id: action.invoiceId }, select: { ownerMemberId: true } });
        if (!invoice) fail("Cobrança inexistente ou não autorizada.", "NOT_FOUND", 404);
        const paymentScope = { workspaceId: context.workspaceId, resourceType: "Payment", resourceId: action.invoiceId, ownerMemberId: invoice.ownerMemberId };
        await check(PermissionKeys.PAYMENTS_READ, paymentScope);
        await check(PermissionKeys.PAYMENTS_MANAGE, paymentScope);
      } else if (action.customerAccountId) {
        await createAccountService({ database, authorization, now: options.now }).get(context, action.customerAccountId);
      }
    }
  }

  async function inspect(database: PrismaClient, context: AuthenticatedContext, action: CopilotAction): Promise<CopilotActionPreview> {
    await authorized(database, context, action);
    if (action.kind === "CREATE_LEAD") {
      const pipeline = await database.pipeline.findFirst({ where: { id: action.pipelineId, workspaceId: context.workspaceId, entityType: "LEAD", deletedAt: null }, include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" } } } });
      const source = await database.leadSource.findFirst({ where: { workspaceId: context.workspaceId, key: action.sourceKey, deletedAt: null } });
      const phone = normalizePhone(action.phone);
      if (!phone.success) fail("Informe um telefone válido para cadastrar o lead.");
      if (!pipeline || !pipeline.stages.length || !source) fail("Pipeline ou origem indisponível nesta empresa.");
      if (await database.lead.findFirst({ where: { workspaceId: context.workspaceId, normalizedPhone: phone.normalizedPhone, deletedAt: null }, select: { id: true } })) fail("Já existe um lead com este telefone. Localize o cadastro existente antes de continuar.", "COPILOT_DUPLICATE_LEAD");
      return { kind: action.kind, title: "Cadastrar lead", summary: action.fullName, details: [{ label: "Pipeline", after: pipeline.name }, { label: "Etapa inicial", after: pipeline.stages[0]!.name }, { label: "Telefone", after: phone.normalizedPhone }, { label: "Origem", after: source.name }, ...Object.entries(action).filter(([key]) => !["kind","pipelineId","sourceKey","phone"].includes(key)).map(fieldDetail)], impact: ["Cadastra o lead pelo fluxo oficial de entrada, com contato, tarefa inicial, SLA e automações aplicáveis."], bindings: { pipelineId: pipeline.id, sourceId: source.id }, links: [{ label: "Pipeline", href: "/pipeline", entityType: "MODULE" }] };
    }
    if (action.kind === "MOVE_LEAD") {
      const service = createPreSalesPipelineService({ database, authorization: createAuthorizationService({ database }), now: options.now });
      const state = await service.getLeadState(context, { leadId: action.leadId });
      const target = state.transitions.find(item => item.stageId === action.targetStageId);
      if (state.updatedAt !== action.expectedUpdatedAt) fail("O lead mudou. Consulte a etapa atual e prepare outra prévia.", "COPILOT_STALE_LEAD");
      if (!target || !target.allowed || !state.canWrite) fail("A etapa não está disponível para este lead.");
      const lead = await database.lead.findUniqueOrThrow({ where: { id: action.leadId }, select: { fullName: true } });
      return { kind: action.kind, title: "Mover lead", summary: lead.fullName, details: [{ label: "Etapa", before: state.currentStageName, after: target.name }, { label: "Motivo", after: action.reason }], impact: ["Altera a etapa e registra o histórico operacional.", ...(target.code === "DISQUALIFIED" ? ["Desqualificar cancela as tarefas abertas do lead."] : [])], bindings: { leadId: action.leadId, updatedAt: state.updatedAt, targetStageId: target.stageId }, links: [{ label: "Lead", href: `/leads/${action.leadId}`, entityType: "Lead" }] };
    }
    if (action.kind === "CREATE_CUSTOMER") {
      return { kind: action.kind, title: "Cadastrar cliente", summary: action.name, details: Object.entries(action).filter(([key]) => key !== "kind").map(fieldDetail), impact: ["Cria o cadastro do cliente nesta empresa. Não registra venda, contrato, mensalidade nem recebimento."], links: [{ label: "Clientes", href: "/contas", entityType: "MODULE" }] };
    }
    if (action.kind === "CREATE_INDICATOR") {
      const metric = validateWidgetCompatibility(indicatorWidget(action));
      return { kind: action.kind, title: "Criar indicador", summary: action.name, details: [{ label: "Métrica", after: metric.name }, { label: "Fórmula", after: metric.formula }, { label: "Data-base", after: action.dateBasis }, { label: "Período", after: action.period }], impact: ["Cria um painel com indicador calculado a partir dos dados autorizados. Não inventa valores nem altera a fórmula oficial."], links: [{ label: "Indicadores", href: "/analises", entityType: "MODULE" }] };
    }
    if (action.kind === "CREATE_TASK") {
      const lead = await database.lead.findUniqueOrThrow({ where: { id: action.leadId }, include: { owner: { include: { user: { select: { displayName: true } } } }, queue: true } });
      const opportunity = action.opportunityId ? await database.opportunity.findUniqueOrThrow({ where: { id: action.opportunityId }, select: { name: true } }) : null;
      return { kind: action.kind, title: "Criar tarefa", summary: `${action.title} · ${lead.fullName}`, details: [
        { label: "Lead", after: lead.fullName }, { label: "Tarefa", after: action.title },
        { label: "Oportunidade vinculada", after: opportunity?.name ?? "Nenhuma" },
        { label: "Descrição", after: action.description ?? "Não informada" },
        { label: "Responsável", after: lead.owner?.user.displayName ?? lead.queue?.name ?? "Fila do lead" },
        { label: "Prazo", after: action.dueAt }, { label: "Prioridade", after: action.priority }, { label: "Tipo", after: action.taskKind },
      ], impact: ["Cria uma tarefa aberta vinculada ao lead e ao responsável atual.", "Atualiza a próxima ação e registra o histórico operacional."], bindings: { leadId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, opportunityId: action.opportunityId ?? null }, links: linksFor(action.kind, lead.id) };
    }
    if (action.kind === "COMPLETE_PROSPECTING_TASKS") {
      const tasks = await loadAuthorizedProspectingTasks(database, context, action);
      const itemByTask = new Map(action.items.map((item) => [item.taskId, item]));
      return {
        kind: action.kind,
        title: "Concluir tarefas da prospecção",
        summary: `${new Set(action.items.map((item) => item.leadId)).size} político(s) · ${action.items.length} tarefa(s)`,
        details: tasks.map((task) => ({
          label: task.lead.fullName,
          before: task.title,
          after: prospectingResultLabels[itemByTask.get(task.id)!.result] ?? itemByTask.get(task.id)!.result,
        })),
        impact: ["Conclui somente as tarefas listadas, registra atividades, métricas e auditoria no CRM.", "Resultados de contato podem avançar ou interromper a cadência conforme as regras já publicadas."],
        links: linksFor(action.kind),
      };
    }
    if (action.kind === "UPDATE_CUSTOMER") {
      const account = await database.account.findUniqueOrThrow({ where: { id: action.accountId } });
      if (account.revision !== action.expectedRevision) fail("O cliente mudou desde a seleção. Refaça a prévia.", "COPILOT_STALE_CUSTOMER");
      const labels = { name: "Nome", legalName: "Razão social", domain: "Site/domínio", segment: "Segmento", size: "Porte" };
      const before = { name: account.name, legalName: account.legalName, domain: account.originalDomain, segment: account.segment, size: account.size };
      return { kind: action.kind, title: "Atualizar cliente", summary: account.name, details: Object.entries(action.changes).map(([key, value]) => ({ label: labels[key as keyof typeof labels], before: String(before[key as keyof typeof labels] ?? "Não informado"), after: String(value ?? "Remover informação") })), impact: ["Atualiza o cadastro compartilhado do cliente.", "Documentos emitidos preservam os dados registrados na emissão."], links: linksFor(action.kind, account.id) };
    }
    if (action.kind === "CREATE_EXPENSE" || action.kind === "CREATE_INCOME") {
      const [category, account, customer] = await Promise.all([
        database.financialCategory.findFirst({ where: { workspaceId: context.workspaceId, id: action.categoryId, active: true, kind: action.kind === "CREATE_INCOME" ? "INCOME" : "EXPENSE" } }),
        database.financialAccount.findFirst({ where: { workspaceId: context.workspaceId, id: action.financialAccountId, active: true } }),
        action.customerAccountId ? database.account.findFirst({ where: { workspaceId: context.workspaceId, id: action.customerAccountId, deletedAt: null } }) : null,
      ]);
      if (!category || !account || (action.customerAccountId && !customer)) fail("Confira categoria, conta financeira e cliente do lançamento.");
      if (action.settledAt && new Date(action.settledAt) > options.now()) fail("Pagamento realizado não pode ter data futura.");
      return { kind: action.kind, title: action.kind === "CREATE_INCOME" ? "Registrar entrada" : "Registrar despesa", summary: `${action.description} · ${money(action.amountCents)}`, details: [
        { label: "Valor", after: money(action.amountCents) }, { label: "Categoria", after: category.name }, { label: "Conta financeira", after: account.name },
        { label: "Fornecedor", after: action.counterparty ?? "Não informado" }, { label: "Cliente associado", after: customer?.name ?? "Nenhum" },
        { label: "Competência", after: action.competenceAt }, { label: "Vencimento", after: action.dueAt },
        { label: "Situação", after: action.status === "SETTLED" ? `${action.kind === "CREATE_INCOME" ? "Recebimento" : "Pagamento"} realizado em ${action.settledAt}` : action.kind === "CREATE_INCOME" ? "A receber" : "A pagar" },
      ], impact: action.kind === "CREATE_INCOME" ? [action.status === "SETTLED" ? "Registra uma entrada avulsa recebida no caixa." : "Registra uma entrada prevista sem aumentar o caixa recebido.", "Não quita cobrança de cliente nem aumenta MRR. Para quitar cobrança, use Registrar recebimento."] : [action.status === "SETTLED" ? "Registra saída de caixa de um pagamento já realizado." : "Registra uma obrigação a pagar, sem reduzir o caixa recebido.", "Inclui a despesa no financeiro e na DRE pela competência. Não executa transferência bancária."], links: linksFor(action.kind) };
    }
    const { kind: _kind, receiptConfirmed: _receipt, ...input } = action;
    void _kind; void _receipt;
    await createPaymentService({ database, now: options.now }).previewReceipt(context, input);
    const [invoice, account] = await Promise.all([database.invoice.findUniqueOrThrow({ where: { id: action.invoiceId } }), database.financialAccount.findUniqueOrThrow({ where: { id: action.financialAccountId } })]);
    return { kind: action.kind, title: "Registrar recebimento", summary: `${invoice.invoiceNumber} · ${invoice.accountNameSnapshot}`, details: [
      { label: "Cliente", after: invoice.accountNameSnapshot }, { label: "Cobrança", after: invoice.invoiceNumber },
      { label: "Valor recebido", after: money(action.amountCents) }, { label: "Conta financeira", after: account.name },
      { label: "Data do recebimento", after: action.receivedAt }, { label: "Forma", after: action.method }, { label: "Referência", after: action.reference },
      { label: "Saldo pendente após baixa", after: money((invoice.totalCents - invoice.paidCents - BigInt(action.amountCents)).toString()) },
    ], impact: ["Registra o recebimento real informado e baixa a cobrança, total ou parcialmente.", "Atualiza caixa e indicadores de recebimento. MRR continua representando a assinatura contratada."], links: linksFor(action.kind, invoice.id) };
  }

  async function authorize(context: AuthenticatedContext, raw: CopilotAction) { await authorized(options.database, context, copilotActionSchema.parse(raw)); }
  async function preview(context: AuthenticatedContext, raw: CopilotAction) { return inspect(options.database, context, copilotActionSchema.parse(raw)); }

  async function execute(context: AuthenticatedContext, raw: CopilotAction, confirmation: { confirmed: true; idempotencyKey: string; expectedPreview?: unknown }): Promise<ActionResult> {
    z.object({ confirmed: z.literal(true), idempotencyKey: z.string().uuid(), expectedPreview: z.unknown().optional() }).strict().parse(confirmation);
    const action = copilotActionSchema.parse(raw);
    return options.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`copilot-action:${context.workspaceId}:${confirmation.idempotencyKey}`}, 0))`;
      const database = withinTransaction(tx);
      await authorized(database, context, action);
      const fingerprint = digest(action);
      const previous = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.action.executed", metadata: { path: ["idempotencyKey"], equals: confirmation.idempotencyKey } } });
      if (previous) {
        const receipt = previous.metadata as { fingerprint?: string; result?: unknown };
        if (receipt.fingerprint !== fingerprint) fail("Confirmação já usada para outra ação.", "COPILOT_ACTION_REPLAY_CONFLICT");
        return receipt.result as ActionResult;
      }
      const currentPreview = await inspect(database, context, action);
      if (confirmation.expectedPreview !== undefined && digest(json(currentPreview)) !== digest(confirmation.expectedPreview)) fail("Os dados mudaram desde a prévia confirmada. Gere uma nova proposta.", "COPILOT_PREVIEW_CHANGED");
      const authorization = createAuthorizationService({ database });
      let result: ActionResult;
      if (action.kind === "CREATE_LEAD") {
        const { kind: _kind, pipelineId, ...lead } = action; void _kind;
        const intake = createLeadIntakeService({ database, authorization, now: options.now, automationPublisher: createAutomationEngineService({ database, authorization, now: options.now }) });
        const created = await createLeadEntryService({ database, authorization, intake }).createManual({ idempotencyKey: confirmation.idempotencyKey, pipelineId, lead }, context);
        if (created.outcome === "REJECTED") fail(created.issues.map(item => item.message).join(" "), created.code, 400);
        if (created.outcome !== "CREATED") fail("Um lead com este contato foi cadastrado durante a confirmação. Consulte-o antes de continuar.", "COPILOT_DUPLICATE_LEAD");
        result = { answer: "Lead cadastrado no pipeline solicitado, com o fluxo de entrada e histórico.", result: { id: created.leadId }, targetType: "Lead", targetId: created.leadId, links: [{ label: "Abrir lead", href: `/leads/${created.leadId}`, entityType: "Lead" }] };
      } else if (action.kind === "MOVE_LEAD") {
        const { kind: _kind, ...input } = action; void _kind;
        await createPreSalesPipelineService({ database, authorization, now: options.now }).transition(context, { ...input, origin: "LEAD_CARD", confirmed: true });
        result = { answer: "Lead movido para a etapa confirmada. Histórico atualizado.", result: { id: action.leadId }, targetType: "Lead", targetId: action.leadId, links: [{ label: "Abrir lead", href: `/leads/${action.leadId}`, entityType: "Lead" }] };
      } else if (action.kind === "CREATE_CUSTOMER") {
        const { kind: _kind, ...input } = action; void _kind;
        const account = await createAccountService({ database, authorization, now: options.now }).create(context, input);
        result = { answer: "Cliente cadastrado. Nenhuma venda ou pagamento foi presumido.", result: { id: account.id }, targetType: "Account", targetId: account.id, links: [{ label: "Abrir cliente", href: `/contas/${account.id}`, entityType: "Account" }] };
      } else if (action.kind === "CREATE_INDICATOR") {
        const dashboard = await createAnalyticsBuilderService({ database, authorization, now: options.now, revenue: createRevenueMetricsService({ database, authorization, now: options.now }) }).create(context, { name: action.name, widgets: [indicatorWidget(action)], idempotencyKey: confirmation.idempotencyKey });
        result = { answer: "Indicador criado no painel de análises com a métrica e o período confirmados.", result: dashboard.result, targetType: "AnalyticsDashboard", targetId: dashboard.result.id, links: [{ label: "Abrir indicadores", href: "/analises", entityType: "MODULE" }] };
      } else if (action.kind === "CREATE_TASK") {
        const { kind: _kind, taskKind, ...input } = action; void _kind;
        const task = await createOperationalHistoryService({ database, authorization, now: options.now }).createTask(context, { ...input, kind: taskKind });
        result = { answer: "Tarefa criada e incluída no histórico do lead.", result: task, targetType: "Task", targetId: task.id, links: linksFor(action.kind, action.leadId) };
      } else if (action.kind === "COMPLETE_PROSPECTING_TASKS") {
        const history = createOperationalHistoryService({ database, authorization, now: options.now });
        const completedAt = options.now();
        const completed = [];
        for (const item of [...action.items].sort((left, right) => left.leadId.localeCompare(right.leadId) || left.taskId.localeCompare(right.taskId))) {
          completed.push(await history.completeTask(context, { leadId: item.leadId, taskId: item.taskId, result: item.result, completedAt }));
        }
        result = {
          answer: `${completed.length} tarefa(s) da prospecção concluída(s). Meu Dia, métricas, histórico e cards foram atualizados pelo fluxo oficial.`,
          result: { completedTaskIds: completed.map((item) => item.id), leadCount: new Set(action.items.map((item) => item.leadId)).size },
          targetType: "TaskBatch",
          targetId: confirmation.idempotencyKey,
          links: linksFor(action.kind),
        };
      } else if (action.kind === "UPDATE_CUSTOMER") {
        const account = await createAccountService({ database, authorization, now: options.now }).update(context, action.accountId, { expectedRevision: action.expectedRevision, ...action.changes });
        result = { answer: "Cadastro do cliente atualizado conforme a prévia.", result: { id: account.id, revision: account.revision }, targetType: "Account", targetId: account.id, links: linksFor(action.kind, account.id) };
      } else if (action.kind === "CREATE_EXPENSE" || action.kind === "CREATE_INCOME") {
        const { kind: _kind, paymentConfirmed: _confirmed, ...input } = action; void _kind; void _confirmed;
        const existingEntry = await tx.financialEntry.findUnique({ where: { workspaceId_idempotencyKey: { workspaceId: context.workspaceId, idempotencyKey: confirmation.idempotencyKey } }, select: { id: true } });
        if (existingEntry) fail("Esta confirmação já identifica outro lançamento financeiro. Prepare uma nova proposta.", "COPILOT_ACTION_REPLAY_CONFLICT");
        const entry = await createFinanceService({ database, authorization, now: options.now }).command(context, { ...input, action: "CREATE_ENTRY", direction: action.kind === "CREATE_INCOME" ? "INCOME" : "EXPENSE", idempotencyKey: confirmation.idempotencyKey }) as { id: string };
        result = { answer: action.kind === "CREATE_INCOME" ? "Entrada avulsa registrada no financeiro conforme a prévia." : action.status === "SETTLED" ? "Despesa registrada como paga, conforme sua declaração de pagamento real." : "Despesa registrada como conta a pagar.", result: { id: entry.id }, targetType: "FinancialEntry", targetId: entry.id, links: linksFor(action.kind) };
      } else {
        const { kind: _kind, receiptConfirmed: _receipt, ...input } = action; void _kind; void _receipt;
        const receipt = await createPaymentService({ database, now: options.now }).recordReceipt(context, { ...input, confirmed: true, idempotencyKey: confirmation.idempotencyKey });
        result = { answer: "Recebimento registrado e cobrança atualizada. O financeiro e os indicadores usam esse mesmo pagamento.", result: json(receipt), targetType: "Invoice", targetId: action.invoiceId, links: linksFor(action.kind, action.invoiceId) };
      }
      await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: "ai.copilot.action.executed", entityType: result.targetType, entityId: result.targetId, changes: { kind: action.kind, confirmed: true }, metadata: json({ idempotencyKey: confirmation.idempotencyKey, fingerprint, result }) } });
      return result;
    }, { isolationLevel: "Serializable", timeout: action.kind === "COMPLETE_PROSPECTING_TASKS" ? 60_000 : 30_000 });
  }

  async function formOptions(context: AuthenticatedContext, query = ""): Promise<CopilotActionOptions> {
    const database = options.database;
    const authorization = createAuthorizationService({ database });
    const result: CopilotActionOptions = { capabilities: [], leads: [], customers: [], categories: [], financialAccounts: [], invoices: [], truncated: false };
    const allowed = async (key: PermissionKey, resource: ResourceScope) => (await authorization.authorize(context, key, resource)).allowed;
    const entryQueue = await database.queue.findFirst({ where: { workspaceId: context.workspaceId, isGeneral: true, deletedAt: null } });
    if (entryQueue && await allowed(PermissionKeys.LEADS_WRITE, { workspaceId: context.workspaceId, resourceType: "LeadEntry", queueId: entryQueue.id, teamId: entryQueue.teamId })) {
      result.capabilities.push("CREATE_LEAD");
      result.leadSources = await database.leadSource.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null }, select: { key: true, name: true }, take: 100 });
      result.pipelines = await database.pipeline.findMany({ where: { workspaceId: context.workspaceId, entityType: "LEAD", deletedAt: null }, select: { id: true, name: true, stages: { where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { position: "asc" } } }, take: 100 });
    }
    if (await allowed(PermissionKeys.METRICS_READ, { workspaceId: context.workspaceId, resourceType: "AnalyticsDashboard", memberId: context.memberId }) && await allowed(PermissionKeys.OPERATIONS_MANAGE, { workspaceId: context.workspaceId, resourceType: "AnalyticsDashboard", memberId: context.memberId })) {
      if (await indicatorRuntimeAvailable(database)) { result.capabilities.push("CREATE_INDICATOR"); result.metrics = revenueMetricRegistry.map(metric => ({ id: metric.id, name: metric.name, dateBases: metric.supportedDateBases })); }
    }
    result.moveLeads = [];
    const terms = copilotSearchTerms(query);
    const limit = query.trim() ? 25 : 100;
    const leadList = createLeadListService({ database, authorization, distribution: createLeadDistributionService({ database, authorization, now: options.now }), now: options.now });
    const leadMatches = await searchCopilotPages(terms, async (q) => {
      try {
        const page = await leadList.getScreen(context, { q, pageSize: limit, sort: "receivedAt", direction: "desc" });
        return { items: page.list.rows, total: page.list.total };
      } catch (error) {
        if (error instanceof ApplicationError && error.statusCode === 403) return { items: [], total: 0 };
        throw error;
      }
    }, limit);
    const leads = await database.lead.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, id: { in: leadMatches.items.map((item) => item.id) } }, orderBy: { updatedAt: "desc" }, include: { routingQueue: { select: { teamId: true } }, queue: { select: { teamId: true } } } });
    for (const lead of leads.slice(0, 100)) {
      const scope = { workspaceId: context.workspaceId, resourceType: "Lead", resourceId: lead.id, ownerMemberId: lead.ownerMemberId, queueId: lead.queueId, teamId: lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null };
      if (await allowed(PermissionKeys.LEADS_READ, scope) && await allowed(PermissionKeys.TASKS_READ, scope) && await allowed(PermissionKeys.TASKS_WRITE, scope)) result.leads.push({ id: lead.id, name: lead.fullName });
      if (await allowed(PermissionKeys.LEADS_READ, scope) && await allowed(PermissionKeys.LEADS_WRITE, scope)) result.moveLeads.push({ id: lead.id, name: lead.fullName, pipelineId: lead.pipelineId, stageId: lead.currentStageId, updatedAt: lead.updatedAt.toISOString() });
    }
    if (result.moveLeads.length) result.capabilities.push("MOVE_LEAD");
    result.truncated = leadMatches.truncated;
    if (result.leads.length) result.capabilities.push("CREATE_TASK");
    const accountScope = { workspaceId: context.workspaceId, resourceType: "Account" };
    if (await allowed(PermissionKeys.ACCOUNTS_READ, accountScope) && await allowed(PermissionKeys.ACCOUNTS_WRITE, accountScope)) {
      const accountService = createAccountService({ database, authorization, now: options.now });
      const matches = await searchCopilotPages(terms, (search) => accountService.list(context, { search, pageSize: limit }), limit);
      const accounts = await database.account.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, id: { in: matches.items.map((item) => item.id) } }, orderBy: { updatedAt: "desc" } });
      result.customers = accounts.slice(0, 100).map((row) => ({ id: row.id, name: row.name, revision: row.revision, legalName: row.legalName, domain: row.originalDomain, segment: row.segment, size: row.size }));
      result.truncated ||= matches.truncated;
      result.capabilities.push("UPDATE_CUSTOMER", "CREATE_CUSTOMER");
    }
    const financeScope = { workspaceId: context.workspaceId, resourceType: "Finance" };
    if (await allowed(PermissionKeys.FINANCE_READ, financeScope) && await allowed(PermissionKeys.FINANCE_MANAGE, financeScope)) {
      const [categories, accounts, invoices] = await Promise.all([
        database.financialCategory.findMany({ where: { workspaceId: context.workspaceId, active: true, kind: "EXPENSE" }, take: limit + 1, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        database.financialAccount.findMany({ where: { workspaceId: context.workspaceId, active: true }, take: limit + 1, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        database.invoice.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "PARTIALLY_PAID"] }, ...(terms.length ? { OR: terms.flatMap((term) => [{ invoiceNumber: { contains: term, mode: "insensitive" as const } }, { accountNameSnapshot: { contains: term, mode: "insensitive" as const } }, { descriptionSnapshot: { contains: term, mode: "insensitive" as const } }]) } : {}) }, take: limit + 1, orderBy: { dueAt: "asc" } }),
      ]);
      result.incomeCategories = await database.financialCategory.findMany({ where: { workspaceId: context.workspaceId, active: true, kind: "INCOME" }, select: { id: true, name: true }, take: 100 });
      result.capabilities.push("CREATE_INCOME");
      result.categories = categories.slice(0, limit); result.financialAccounts = accounts.slice(0, limit);
      result.capabilities.push("CREATE_EXPENSE"); result.truncated ||= categories.length > limit || accounts.length > limit || invoices.length > limit;
      for (const invoice of invoices.slice(0, limit)) {
        const scope = { workspaceId: context.workspaceId, resourceType: "Payment", resourceId: invoice.id, ownerMemberId: invoice.ownerMemberId };
        if (await allowed(PermissionKeys.PAYMENTS_READ, scope) && await allowed(PermissionKeys.PAYMENTS_MANAGE, scope)) result.invoices.push({ id: invoice.id, label: `${invoice.invoiceNumber} · ${invoice.accountNameSnapshot}`, revision: invoice.revision, outstandingCents: (invoice.totalCents - invoice.paidCents).toString() });
      }
      if (result.invoices.length) result.capabilities.push("RECORD_PAYMENT");
    }
    return result;
  }
  return { authorize, preview, execute, options: formOptions, dailyList };
}

export function getCopilotActionsService() { return createCopilotActionsService({ database: getDatabaseClient(), now: () => new Date() }); }
