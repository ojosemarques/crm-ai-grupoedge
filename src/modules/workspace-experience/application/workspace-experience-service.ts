import type { PermissionScope, Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys, type PermissionKey } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import {
  defaultHomeView,
  globalSearchQuerySchema,
  homeQuerySchema,
  maskContactPoint,
  normalizeGlobalSearchTerm,
  rankOperationalActions,
  type GlobalSearchResponse,
  type GlobalSearchResult,
  type HomeMetric,
  type HomeViewKey,
  type OperationalAction,
  type RoleHomeScreen,
} from "../domain/workspace-experience-contracts";

type Authorization = ReturnType<typeof getAuthorizationService>;
type Options = Readonly<{ database: PrismaClient; authorization: Authorization; now: () => Date }>;
function resource(workspaceId: string, type: string, id?: string, ownerMemberId?: string | null, teamId?: string | null) {
  return { workspaceId, resourceType: type, ...(id ? { resourceId: id } : {}), ...(ownerMemberId !== undefined ? { ownerMemberId } : {}), ...(teamId !== undefined ? { teamId } : {}) };
}
function action(input: OperationalAction): OperationalAction { return Object.freeze(input); }
function metric(label: string, value: number | string | null, href: string | null, partial = false): HomeMetric {
  return Object.freeze({ label, value: value === null ? "Indisponível" : String(value), state: value === null ? "UNAVAILABLE" : partial ? "PARTIAL" : Number(value) === 0 ? "ZERO" : "AVAILABLE", href });
}
function opportunityAction(row: { id: string; name: string; nextActionAt: Date | null; nextActionDescription: string | null; expectedCloseAt: Date | null }, now: Date): OperationalAction {
  const overdue = !row.nextActionAt || row.nextActionAt < now;
  return action({ kind: overdue ? "OPPORTUNITY_RISK" : "OPPORTUNITY_NEXT_ACTION", title: row.nextActionDescription ?? "Definir próxima ação", reason: !row.nextActionAt ? "Oportunidade aberta sem próxima ação persistida." : overdue ? "A próxima ação da oportunidade está vencida." : "Próxima ação registrada para mover a negociação.", urgency: overdue ? "CRITICAL" : "NORMAL", entityType: "Opportunity", entityId: row.id, entityLabel: row.name, dueAt: row.nextActionAt?.toISOString() ?? row.expectedCloseAt?.toISOString() ?? null, href: `/oportunidades?opportunityId=${row.id}`, cta: overdue ? "Corrigir oportunidade" : "Abrir oportunidade" });
}

function memberScope(scope: PermissionScope, memberId: string, teamIds: readonly string[]) {
  if (scope === "WORKSPACE") return {};
  if (scope === "OWN") return { memberId };
  return { OR: [{ memberId }, { member: { teamMemberships: { some: { teamId: { in: [...teamIds] }, deletedAt: null } } } }, { queue: { teamId: { in: [...teamIds] }, deletedAt: null } }] };
}

async function scopedContactResource(database: PrismaClient, context: AuthenticatedContext, contactId: string) {
  const teamIds = (await database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } })).map((item) => item.teamId);
  const [owned, teamRelated] = await Promise.all([
    database.contact.findFirst({ where: { id: contactId, workspaceId: context.workspaceId, deletedAt: null, OR: [{ leads: { some: { ownerMemberId: context.memberId, deletedAt: null } } }, { ownershipAssignments: { some: { status: "ACTIVE", memberId: context.memberId } } }] }, select: { id: true } }),
    teamIds.length ? database.contact.findFirst({ where: { id: contactId, workspaceId: context.workspaceId, deletedAt: null, OR: [{ leads: { some: { deletedAt: null, OR: [{ queue: { teamId: { in: teamIds } } }, { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } }] } } }, { ownershipAssignments: { some: { status: "ACTIVE", OR: [{ queue: { teamId: { in: teamIds }, deletedAt: null } }, { member: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } }] } } }] }, select: { id: true } }) : Promise.resolve(null),
  ]);
  return resource(context.workspaceId, "Contact", contactId, owned ? context.memberId : null, teamRelated ? teamIds[0]! : null);
}

export function createWorkspaceExperienceService(options: Options) {
  async function permission(context: AuthenticatedContext, key: PermissionKey) {
    return options.authorization.authorize(context, key, resource(context.workspaceId, "RoleHome", undefined, context.memberId));
  }

  async function availableViews(context: AuthenticatedContext): Promise<HomeViewKey[]> {
    const [leads, opportunities, farmer, cs, metrics, admin, ownedFunctions] = await Promise.all([
      permission(context, PermissionKeys.LEADS_READ), permission(context, PermissionKeys.OPPORTUNITIES_READ), permission(context, PermissionKeys.FARMER_READ), permission(context, PermissionKeys.CUSTOMER_SUCCESS_READ), permission(context, PermissionKeys.METRICS_READ), permission(context, PermissionKeys.WORKSPACE_MANAGE),
      options.database.ownershipAssignment.findMany({ where: { workspaceId: context.workspaceId, memberId: context.memberId, status: "ACTIVE" }, distinct: ["function"], select: { function: true } }),
    ]);
    const owned = new Set(ownedFunctions.map((item) => item.function));
    const views: HomeViewKey[] = [];
    if (leads.allowed && (context.roleKey === "sdr" || owned.has("SDR") || ["administrator", "commercial_manager"].includes(context.roleKey))) views.push("SDR");
    if (opportunities.allowed && (context.roleKey === "closer" || owned.has("CLOSER") || ["administrator", "commercial_manager"].includes(context.roleKey))) views.push("CLOSER");
    if (farmer.allowed && (owned.has("FARMER") || ["administrator", "commercial_manager", "closer"].includes(context.roleKey))) views.push("FARMER");
    if (cs.allowed && (owned.has("CUSTOMER_SUCCESS") || ["administrator", "commercial_manager", "closer"].includes(context.roleKey))) views.push("CUSTOMER_SUCCESS");
    if (metrics.allowed && ["administrator", "commercial_manager"].includes(context.roleKey)) views.push("MANAGER");
    if (admin.allowed) views.push("ADMIN");
    return views.length ? [...new Set(views)] : leads.allowed ? ["SDR"] : opportunities.allowed ? ["CLOSER"] : ["MANAGER"];
  }

  async function getHome(context: AuthenticatedContext, raw: unknown = {}): Promise<RoleHomeScreen> {
    const query = homeQuerySchema.parse(raw);
    const views = await availableViews(context);
    const activeView = query.view ?? defaultHomeView(context.roleKey, views);
    if (!views.includes(activeView)) throw new ApplicationError("A visão solicitada não está disponível para seu papel e escopo.", { code: "ACCESS_DENIED", statusCode: 403, expose: true });
    const workspace = await options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { timeZone: true } });
    const now = options.now();
    let actions: OperationalAction[] = [];
    let metrics: HomeMetric[] = [];
    let scope: RoleHomeScreen["scope"] = "OWN";

    if (activeView === "SDR") {
      const decision = await permission(context, PermissionKeys.LEADS_READ); if (!decision.allowed) throw new Error("Permissão inconsistente."); scope = decision.scope;
      const where: Prisma.LeadWhereInput = { workspaceId: context.workspaceId, status: "OPEN", deletedAt: null, ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) };
      const rows = await options.database.lead.findMany({ where, orderBy: [{ awaitingHumanResponse: "desc" }, { priority: "desc" }, { nextActionAt: "asc" }], take: 12, select: { id: true, fullName: true, priority: true, awaitingHumanResponse: true, nextActionAt: true, nextActionDescription: true, slaDueAt: true } });
      actions = rows.map((row) => action({ kind: row.awaitingHumanResponse ? "RESPOND" : !row.nextActionAt || row.nextActionAt <= now ? "CALL_OR_RETURN" : "NEXT_ACTION", title: row.awaitingHumanResponse ? "Responder agora" : row.nextActionDescription ?? "Criar próxima ação", reason: row.awaitingHumanResponse ? "O lead respondeu e aguarda retorno humano." : !row.nextActionAt ? "Lead aberto sem próxima ação." : row.slaDueAt <= now ? "SLA imediato vencido; executar a tarefa persistida." : "Próxima ação operacional registrada.", urgency: row.awaitingHumanResponse || !row.nextActionAt || row.slaDueAt <= now ? "CRITICAL" : "NORMAL", entityType: "Lead", entityId: row.id, entityLabel: row.fullName, dueAt: row.nextActionAt?.toISOString() ?? row.slaDueAt.toISOString(), href: `/leads/${row.id}/historico`, cta: row.awaitingHumanResponse ? "Responder" : "Trabalhar lead" }));
      const [open, replied, withoutNext] = await Promise.all([options.database.lead.count({ where }), options.database.lead.count({ where: { ...where, awaitingHumanResponse: true } }), options.database.lead.count({ where: { ...where, nextActionAt: null } })]);
      metrics = [metric("Leads abertos", open, "/leads?status=OPEN"), metric("Aguardando resposta", replied, "/leads?operationalBucket=RESPONDED"), metric("Sem próxima ação", withoutNext, "/leads?operationalBucket=MISSING_NEXT_ACTION")];
    } else if (activeView === "CLOSER") {
      const decision = await permission(context, PermissionKeys.OPPORTUNITIES_READ); if (!decision.allowed) throw new Error("Permissão inconsistente."); scope = decision.scope;
      const where: Prisma.OpportunityWhereInput = { workspaceId: context.workspaceId, status: "OPEN", deletedAt: null, ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) };
      const rows = await options.database.opportunity.findMany({ where, orderBy: [{ nextActionAt: "asc" }, { expectedCloseAt: "asc" }], take: 12, select: { id: true, name: true, nextActionAt: true, nextActionDescription: true, expectedCloseAt: true } });
      actions = rows.map((row) => opportunityAction(row, now));
      const [open, proposals, meetings] = await Promise.all([options.database.opportunity.count({ where }), options.database.opportunity.count({ where: { ...where, currentStage: { opportunityStageCode: "PROPOSAL" } } }), options.database.meeting.count({ where: { workspaceId: context.workspaceId, ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}), startsAt: { gte: now }, status: { in: ["SCHEDULED", "CONFIRMED"] }, deletedAt: null } })]);
      metrics = [metric("Oportunidades abertas", open, "/oportunidades"), metric("Propostas", proposals, "/oportunidades?stageCode=PROPOSAL"), metric("Próximas reuniões", meetings, "/agenda")];
    } else if (activeView === "FARMER") {
      const decision = await permission(context, PermissionKeys.FARMER_READ); if (!decision.allowed) throw new Error("Permissão inconsistente."); scope = decision.scope;
      const rows = await options.database.renewal.findMany({ where: { workspaceId: context.workspaceId, status: { in: ["IN_REVIEW", "DEFERRED"] }, ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) }, orderBy: [{ nextActionAt: "asc" }, { targetDate: "asc" }], take: 12 });
      const accounts = await options.database.account.findMany({ where: { workspaceId: context.workspaceId, id: { in: rows.map((item) => item.accountId) } }, select: { id: true, name: true } }); const names = new Map(accounts.map((item) => [item.id, item.name]));
      actions = rows.map((row) => action({ kind: "RENEWAL", title: row.nextActionDescription ?? "Definir próxima ação de renovação", reason: !row.nextActionAt ? "Renovação sem próxima ação." : row.riskLevel === "HIGH" || row.riskLevel === "CRITICAL" ? `Receita em risco ${row.riskLevel.toLowerCase()}.` : "Renovação ordenada pelo prazo persistido.", urgency: !row.nextActionAt || row.nextActionAt < now || ["HIGH", "CRITICAL"].includes(row.riskLevel) ? "CRITICAL" : "NORMAL", entityType: "Account", entityId: row.accountId, entityLabel: names.get(row.accountId) ?? "Conta", dueAt: row.nextActionAt?.toISOString() ?? row.targetDate.toISOString(), href: `/farmer?renewalId=${row.id}`, cta: "Trabalhar renovação" }));
      const [open, atRisk, expansion] = await Promise.all([options.database.renewal.count({ where: { workspaceId: context.workspaceId, status: { in: ["IN_REVIEW", "DEFERRED"] }, ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) } }), options.database.renewal.count({ where: { workspaceId: context.workspaceId, status: { in: ["IN_REVIEW", "DEFERRED"] }, riskLevel: { in: ["HIGH", "CRITICAL"] }, ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) } }), options.database.expansionSignal.count({ where: { workspaceId: context.workspaceId, status: "PENDING_REVIEW", ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) } })]);
      metrics = [metric("Renovações abertas", open, "/farmer"), metric("Receita em risco", atRisk, "/farmer?riskLevel=HIGH"), metric("Expansões a revisar", expansion, "/farmer?action=EXPANSION")];
    } else if (activeView === "CUSTOMER_SUCCESS") {
      const decision = await permission(context, PermissionKeys.CUSTOMER_SUCCESS_READ); if (!decision.allowed) throw new Error("Permissão inconsistente."); scope = decision.scope;
      const where: Prisma.CustomerPortfolioAssignmentWhereInput = { workspaceId: context.workspaceId, state: "ACTIVE", validTo: null, ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) };
      const rows = await options.database.customerPortfolioAssignment.findMany({ where, orderBy: [{ priority: "asc" }, { nextActionAt: "asc" }], take: 12 });
      const accounts = await options.database.account.findMany({ where: { workspaceId: context.workspaceId, id: { in: rows.map((item) => item.accountId) } }, select: { id: true, name: true } }); const names = new Map(accounts.map((item) => [item.id, item.name]));
      actions = rows.map((row) => action({ kind: "CUSTOMER_SUCCESS", title: row.nextActionDescription ?? "Definir próxima ação de sucesso", reason: !row.nextActionAt ? "Carteira ativa sem próxima ação." : row.nextActionAt < now ? "Ação do cliente vencida." : "Ação do plano de sucesso registrada.", urgency: !row.nextActionAt || row.nextActionAt < now || row.priority === 1 ? "CRITICAL" : "NORMAL", entityType: "Account", entityId: row.accountId, entityLabel: names.get(row.accountId) ?? "Conta", dueAt: row.nextActionAt?.toISOString() ?? null, href: `/customer-success?accountId=${row.accountId}`, cta: "Abrir carteira" }));
      const [active, overdue, onboarding] = await Promise.all([options.database.customerPortfolioAssignment.count({ where }), options.database.customerPortfolioAssignment.count({ where: { ...where, nextActionAt: { lt: now } } }), options.database.onboardingCase.count({ where: { workspaceId: context.workspaceId, status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] }, ...(decision.scope === "OWN" ? { ownerMemberId: context.memberId } : {}) } })]);
      metrics = [metric("Contas na carteira", active, "/customer-success"), metric("Ações vencidas", overdue, "/customer-success?overdue=true"), metric("Onboardings ativos", onboarding, "/onboarding")];
    } else if (activeView === "MANAGER") {
      const decision = await permission(context, PermissionKeys.METRICS_READ); if (!decision.allowed) throw new Error("Permissão inconsistente."); scope = decision.scope;
      const [violations, openOpps, failedJobs] = await Promise.all([options.database.processViolation.count({ where: { workspaceId: context.workspaceId, status: "OPEN" } }), options.database.opportunity.count({ where: { workspaceId: context.workspaceId, status: "OPEN", deletedAt: null } }), options.database.job.count({ where: { workspaceId: context.workspaceId, status: "FAILED" } })]);
      metrics = [metric("Exceções abertas", violations, "/auditoria?status=OPEN"), metric("Pipeline aberto", openOpps, "/oportunidades"), metric("Automações com erro", failedJobs, "/automacoes?status=FAILED")];
      actions = violations ? [action({ kind: "PROCESS_HEALTH", title: "Resolver exceções críticas", reason: `${violations} violações determinísticas permanecem abertas.`, urgency: "CRITICAL", entityType: "Workspace", entityId: context.workspaceId, entityLabel: "Saúde do processo", dueAt: null, href: "/auditoria?status=OPEN", cta: "Revisar exceções" })] : [];
    } else {
      const decision = await permission(context, PermissionKeys.WORKSPACE_MANAGE); if (!decision.allowed) throw new Error("Permissão inconsistente."); scope = decision.scope;
      const [members, failedJobs, integrations] = await Promise.all([options.database.workspaceMember.count({ where: { workspaceId: context.workspaceId, status: "ACTIVE", deletedAt: null } }), options.database.job.count({ where: { workspaceId: context.workspaceId, status: "FAILED" } }), options.database.integrationConnection.count({ where: { workspaceId: context.workspaceId } })]);
      metrics = [metric("Membros ativos", members, "/administracao"), metric("Jobs com falha", failedJobs, "/automacoes?status=FAILED"), metric("Conexões locais", integrations, "/integracoes", true)];
      actions = failedJobs ? [action({ kind: "SYSTEM_HEALTH", title: "Inspecionar jobs com falha", reason: `${failedJobs} jobs chegaram ao estado terminal de falha.`, urgency: "CRITICAL", entityType: "Workspace", entityId: context.workspaceId, entityLabel: "Operação local", dueAt: null, href: "/automacoes?status=FAILED", cta: "Abrir automações" })] : [];
    }
    const queue = rankOperationalActions(actions);
    return Object.freeze({ generatedAt: now.toISOString(), timeZone: workspace.timeZone, displayName: context.displayName, activeView, availableViews: Object.freeze(views), scope, primaryAction: queue[0] ?? null, metrics: Object.freeze(metrics), queue: Object.freeze(queue.slice(1, 7)), state: queue.length || metrics.some((item) => item.state !== "ZERO") ? "READY" : "EMPTY" });
  }

  async function search(context: AuthenticatedContext, raw: unknown): Promise<GlobalSearchResponse> {
    const query = globalSearchQuerySchema.parse(raw); const normalized = normalizeGlobalSearchTerm(query.q); const take = Math.min(408, query.page * query.pageSize + 8);
    const [accountPermission, contactPermission, leadPermission, opportunityPermission] = await Promise.all([permission(context, PermissionKeys.ACCOUNTS_READ), permission(context, PermissionKeys.CONTACTS_READ), permission(context, PermissionKeys.LEADS_READ), permission(context, PermissionKeys.OPPORTUNITIES_READ)]);
    const needsTeams = [accountPermission, contactPermission, leadPermission, opportunityPermission].some((decision) => decision.allowed && decision.scope === "TEAM");
    const teamIds = needsTeams ? (await options.database.teamMember.findMany({ where: { workspaceId: context.workspaceId, workspaceMemberId: context.memberId, deletedAt: null }, select: { teamId: true } })).map((item) => item.teamId) : [];
    const accountScope: Prisma.AccountWhereInput = !accountPermission.allowed || accountPermission.scope === "WORKSPACE" ? {} : accountPermission.scope === "OWN" ? { OR: [{ leads: { some: { ownerMemberId: context.memberId, deletedAt: null } } }, { opportunities: { some: { ownerMemberId: context.memberId, deletedAt: null } } }, { ownershipAssignments: { some: { status: "ACTIVE", memberId: context.memberId } } }] } : { OR: [{ leads: { some: { deletedAt: null, OR: [{ queue: { teamId: { in: teamIds } } }, { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } }] } } }, { opportunities: { some: { deletedAt: null, owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } } } }, { ownershipAssignments: { some: { status: "ACTIVE", ...memberScope("TEAM", context.memberId, teamIds) } } }] };
    const contactScope: Prisma.ContactWhereInput = !contactPermission.allowed || contactPermission.scope === "WORKSPACE" ? {} : contactPermission.scope === "OWN" ? { OR: [{ leads: { some: { ownerMemberId: context.memberId, deletedAt: null } } }, { ownershipAssignments: { some: { status: "ACTIVE", memberId: context.memberId } } }] } : { OR: [{ leads: { some: { deletedAt: null, OR: [{ queue: { teamId: { in: teamIds } } }, { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } }] } } }, { ownershipAssignments: { some: { status: "ACTIVE", ...memberScope("TEAM", context.memberId, teamIds) } } }] };
    const leadScope: Prisma.LeadWhereInput = !leadPermission.allowed || leadPermission.scope === "WORKSPACE" ? {} : leadPermission.scope === "OWN" ? { ownerMemberId: context.memberId } : { OR: [{ ownerMemberId: context.memberId }, { queue: { teamId: { in: teamIds } } }, { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } }] };
    const opportunityScope: Prisma.OpportunityWhereInput = !opportunityPermission.allowed || opportunityPermission.scope === "WORKSPACE" ? {} : opportunityPermission.scope === "OWN" ? { ownerMemberId: context.memberId } : { OR: [{ ownerMemberId: context.memberId }, { owner: { teamMemberships: { some: { teamId: { in: teamIds }, deletedAt: null } } } }] };
    const [accounts, contacts, leads, opportunities] = await Promise.all([
      accountPermission.allowed ? options.database.account.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, ...accountScope, AND: [{ OR: [{ normalizedName: { contains: normalized } }, { name: { contains: query.q, mode: "insensitive" } }, { normalizedDomain: { contains: normalized } }] }] }, orderBy: [{ name: "asc" }, { id: "asc" }], take, select: { id: true, name: true, segment: true } }) : [],
      contactPermission.allowed ? options.database.contact.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, status: "ACTIVE", ...contactScope, AND: [{ OR: [{ preferredName: { contains: query.q, mode: "insensitive" } }, { legalName: { contains: query.q, mode: "insensitive" } }, { points: { some: { normalizedValue: { contains: normalized.replace(/\s/g, "") }, deletedAt: null } } }] }] }, orderBy: [{ preferredName: "asc" }, { id: "asc" }], take, select: { id: true, preferredName: true, jobTitle: true, points: { where: { deletedAt: null, isPrimary: true }, take: 1, select: { type: true, normalizedValue: true } } } }) : [],
      leadPermission.allowed ? options.database.lead.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, ...leadScope, AND: [{ OR: [{ fullName: { contains: query.q, mode: "insensitive" } }, { organizationName: { contains: query.q, mode: "insensitive" } }, { normalizedEmail: { contains: normalized.replace(/\s/g, "") } }, { normalizedPhone: { contains: normalized.replace(/\D/g, "") } }] }] }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take, select: { id: true, fullName: true, organizationName: true, jobTitle: true } }) : [],
      opportunityPermission.allowed ? options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, deletedAt: null, ...opportunityScope, AND: [{ OR: [{ name: { contains: query.q, mode: "insensitive" } }, { lead: { fullName: { contains: query.q, mode: "insensitive" } } }, { account: { name: { contains: query.q, mode: "insensitive" } } }] }] }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take, select: { id: true, name: true, status: true, account: { select: { name: true } }, lead: { select: { fullName: true } } } }) : [],
    ]);
    const visible: GlobalSearchResult[] = [];
    for (const row of accounts) visible.push({ id: row.id, type: "ACCOUNT", title: row.name, context: `Conta · ${row.segment}`, hint: null, href: `/contas/${row.id}` });
    for (const row of contacts) { const point = row.points[0]; visible.push({ id: row.id, type: "CONTACT", title: row.preferredName, context: row.jobTitle ?? "Contato canônico", hint: point ? maskContactPoint(point.type, point.normalizedValue) : null, href: `/contatos/${row.id}` }); }
    for (const row of leads) visible.push({ id: row.id, type: "LEAD", title: row.fullName, context: row.organizationName ?? row.jobTitle ?? "Lead", hint: null, href: `/leads/${row.id}` });
    for (const row of opportunities) visible.push({ id: row.id, type: "OPPORTUNITY", title: row.name, context: row.account?.name ?? row.lead.fullName, hint: row.status, href: `/oportunidades?opportunityId=${row.id}` });
    const ordered = visible.sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id)); const start = (query.page - 1) * query.pageSize; const page = ordered.slice(start, start + query.pageSize); const groupLabels = { ACCOUNT: "Contas", CONTACT: "Contatos", LEAD: "Leads", OPPORTUNITY: "Oportunidades" } as const;
    return Object.freeze({ query: query.q, page: query.page, pageSize: query.pageSize, hasMore: ordered.length > start + query.pageSize, groups: Object.freeze((Object.keys(groupLabels) as Array<keyof typeof groupLabels>).map((type) => Object.freeze({ type, label: groupLabels[type], items: Object.freeze(page.filter((item) => item.type === type)) })).filter((group) => group.items.length)) });
  }

  async function getContact360(context: AuthenticatedContext, contactId: string, raw: unknown = {}) {
    const pagination = globalSearchQuerySchema.pick({ page: true, pageSize: true }).parse(raw);
    const contact = await options.database.contact.findFirst({ where: { id: contactId, workspaceId: context.workspaceId, deletedAt: null }, include: {
      points: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { type: "asc" }] },
      leads: { where: { deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 30, include: { queue: { select: { teamId: true } } } },
      accountRoles: { orderBy: { validFrom: "desc" }, take: 30, include: { account: { select: { id: true, name: true } } } },
      ownershipAssignments: { where: { status: "ACTIVE" }, orderBy: { validFrom: "desc" }, take: 20, include: { queue: { select: { teamId: true } } } },
    } });
    if (!contact) throw new ApplicationError("Contato não encontrado.", { code: "NOT_FOUND", statusCode: 404, expose: true });
    await options.authorization.assertAuthorized(context, PermissionKeys.CONTACTS_READ, await scopedContactResource(options.database, context, contact.id));
    const leadIds = contact.leads.map((item) => item.id);
    const [consents, opportunities, conversations, meetings, activities, lifecycle] = await Promise.all([
      options.database.consentState.findMany({ where: { workspaceId: context.workspaceId, contactId }, orderBy: { effectiveFrom: "desc" }, take: 30, select: { id: true, channel: true, state: true, reasonCode: true, effectiveFrom: true } }),
      options.database.opportunity.findMany({ where: { workspaceId: context.workspaceId, leadId: { in: leadIds }, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, name: true, status: true, amountCents: true } }),
      options.database.conversation.findMany({ where: { workspaceId: context.workspaceId, contactId, deletedAt: null }, orderBy: { lastMessageAt: "desc" }, take: 30, select: { id: true, channel: true, status: true, subject: true, lastMessageAt: true } }),
      options.database.meeting.findMany({ where: { workspaceId: context.workspaceId, leadId: { in: leadIds }, deletedAt: null }, orderBy: { startsAt: "desc" }, take: 30, select: { id: true, title: true, status: true, startsAt: true } }),
      options.database.activity.findMany({ where: { workspaceId: context.workspaceId, leadId: { in: leadIds }, deletedAt: null }, orderBy: { occurredAt: "desc" }, take: 100, select: { id: true, type: true, subject: true, occurredAt: true, leadId: true } }),
      options.database.lifecycleHistory.findMany({ where: { workspaceId: context.workspaceId, contactId }, orderBy: { enteredAt: "desc" }, take: 100, select: { id: true, toStage: true, enteredAt: true } }),
    ]);
    const allTimeline = [...activities.map((item) => ({ id: `activity:${item.id}`, type: item.type, title: item.subject, occurredAt: item.occurredAt.toISOString(), provenance: "Activity", href: `/leads/${item.leadId}/historico` })), ...lifecycle.map((item) => ({ id: `lifecycle:${item.id}`, type: "LIFECYCLE", title: `Lifecycle: ${item.toStage}`, occurredAt: item.enteredAt.toISOString(), provenance: "LifecycleHistory", href: null }))].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
    const start = (pagination.page - 1) * pagination.pageSize; const nextLead = contact.leads.find((item) => item.status === "OPEN");
    return Object.freeze({ id: contact.id, preferredName: contact.preferredName, legalName: contact.legalName, jobTitle: contact.jobTitle, status: contact.status, quality: contact.quality, origin: contact.origin, timeZone: contact.timeZone ?? "America/Sao_Paulo", points: Object.freeze(contact.points.map((point) => ({ id: point.id, type: point.type, maskedValue: maskContactPoint(point.type, point.normalizedValue), primary: point.isPrimary, verification: point.verificationStatus, quality: point.quality, doNotContact: point.doNotContact }))), consents: Object.freeze(consents.map((item) => ({ ...item, effectiveFrom: item.effectiveFrom.toISOString() }))), accounts: Object.freeze(contact.accountRoles.map((item) => ({ roleId: item.id, accountId: item.account.id, accountName: item.account.name, roleType: item.roleType, influence: item.influence, authority: item.authority, validFrom: item.validFrom.toISOString(), validTo: item.validTo?.toISOString() ?? null }))), leads: Object.freeze(contact.leads.map((item) => ({ id: item.id, name: item.fullName, status: item.status, organization: item.organizationName, href: `/leads/${item.id}` }))), opportunities: Object.freeze(opportunities.map((item) => ({ ...item, amountCents: item.amountCents.toString(), href: `/oportunidades?opportunityId=${item.id}` }))), conversations: Object.freeze(conversations.map((item) => ({ ...item, lastMessageAt: item.lastMessageAt?.toISOString() ?? null, href: `/inbox?conversationId=${item.id}` }))), meetings: Object.freeze(meetings.map((item) => ({ ...item, startsAt: item.startsAt.toISOString(), href: `/agenda?meetingId=${item.id}` }))), timeline: Object.freeze(allTimeline.slice(start, start + pagination.pageSize)), page: pagination.page, pageSize: pagination.pageSize, hasMoreTimeline: allTimeline.length > start + pagination.pageSize, primaryAction: nextLead ? action({ kind: "OPEN_LEAD", title: nextLead.nextActionDescription ?? "Revisar próxima ação", reason: nextLead.nextActionDescription ? "Ação vigente do lead relacionado." : "Lead aberto relacionado sem descrição de próxima ação.", urgency: nextLead.nextActionAt && nextLead.nextActionAt > options.now() ? "NORMAL" : "CRITICAL", entityType: "Lead", entityId: nextLead.id, entityLabel: nextLead.fullName, dueAt: nextLead.nextActionAt?.toISOString() ?? null, href: `/leads/${nextLead.id}/historico`, cta: "Trabalhar lead" }) : null });
  }

  return Object.freeze({ getHome, search, getContact360 });
}

let singleton: ReturnType<typeof createWorkspaceExperienceService> | undefined;
export function getWorkspaceExperienceService() { singleton ??= createWorkspaceExperienceService({ database: getDatabaseClient(), authorization: getAuthorizationService(), now: () => new Date() }); return singleton; }
