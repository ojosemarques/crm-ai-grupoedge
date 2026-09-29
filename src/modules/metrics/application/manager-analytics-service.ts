import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  createDashboardMetricsService,
  getDashboardMetricsService,
} from "@/modules/metrics/application/dashboard-metrics-service";
import {
  createMetricsService,
  getMetricsService,
} from "@/modules/metrics/application/metrics-service";
import type {
  DashboardQuery,
  DashboardRecord,
  DashboardScreen,
} from "@/modules/metrics/domain/dashboard-contracts";
import {
  managerQuestionIds,
  managerQuestions,
  type ManagerAnalyticsAnswer,
  type ManagerAnalyticsRecord,
  type ManagerAnalyticsShell,
  type ManagerQuestionId,
} from "@/modules/metrics/domain/manager-analytics-contracts";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import {
  addLocalDays,
  workspaceDateAt,
  workspaceDayRange,
} from "@/shared/core/time/workspace-time";
import { z } from "zod";

type DashboardPort = Pick<ReturnType<typeof createDashboardMetricsService>, "getScreen">;
type MetricsPort = Pick<ReturnType<typeof createMetricsService>, "getOverview">;
type AuthorizationPort = Readonly<{
  authorize: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.AI_MANAGER_QUERY,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.AI_MANAGER_QUERY,
    resource: ResourceScope,
  ) => Promise<void>;
}>;

type ManagerAnalyticsServiceOptions = Readonly<{
  database: PrismaClient;
  dashboard: DashboardPort;
  metrics: MetricsPort;
  authorization: AuthorizationPort;
  now: () => Date;
}>;

const filtersSchema = z.object({
  sdrMemberIds: z.array(z.string().uuid()).max(100),
  closerMemberIds: z.array(z.string().uuid()).max(100),
  teamIds: z.array(z.string().uuid()).max(100),
  sourceIds: z.array(z.string().uuid()).max(100),
  campaignIds: z.array(z.string().uuid()).max(100),
  creativeIds: z.array(z.string().uuid()).max(100),
  priorityCodes: z.array(z.enum(["P1", "P2", "P3"])).max(3),
  productIds: z.array(z.string().uuid()).max(100),
}).strict();

const answerInputSchema = z.object({
  questionId: z.enum(managerQuestionIds),
  query: z.object({
    preset: z.enum(["TODAY", "YESTERDAY", "WEEK", "MONTH", "CUSTOM"]),
    fromDate: z.string(),
    toDate: z.string(),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    filters: filtersSchema,
  }).strict(),
}).strict();

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(error.issues.map((issue) => issue.message).join(" "), {
    code: "INVALID_INPUT",
    statusCode: 400,
    expose: true,
  });
}

function dashboardInput(query: DashboardQuery, overrides: Partial<DashboardQuery["filters"]> = {}) {
  const filters = { ...query.filters, ...overrides };
  return {
    preset: query.preset,
    fromDate: query.fromDate,
    toDate: query.toDate,
    sdr: [...filters.sdrMemberIds],
    closer: [...filters.closerMemberIds],
    team: [...filters.teamIds],
    source: [...filters.sourceIds],
    campaign: [...filters.campaignIds],
    creative: [...filters.creativeIds],
    priority: [...filters.priorityCodes],
    product: [...filters.productIds],
  };
}

function customDashboardInput(query: DashboardQuery, fromDate: string, toDate: string) {
  return {
    ...dashboardInput(query),
    preset: "CUSTOM" as const,
    fromDate,
    toDate,
  };
}

function confidence(value: number, reason: string): ManagerAnalyticsAnswer["confidence"] {
  return Object.freeze({
    value,
    label: value >= 0.8 ? "Alta" : value >= 0.5 ? "Média" : "Baixa",
    reason,
  });
}

function metric(
  label: string,
  value: number | null,
  unit: ManagerAnalyticsAnswer["numbers"][number]["unit"],
  recordGroupId: string,
): ManagerAnalyticsAnswer["numbers"][number] {
  return Object.freeze({ label, value, unit, recordGroupId });
}

function period(screen: DashboardScreen): ManagerAnalyticsAnswer["period"] {
  return Object.freeze({
    from: screen.query.from,
    to: screen.query.to,
    fromDate: screen.query.fromDate,
    toDate: screen.query.toDate,
    timeZone: screen.overview.period.timeZone,
  });
}

function asManagerRecord(record: DashboardRecord): ManagerAnalyticsRecord {
  if (record.entityType === "SLA_CYCLE" || record.entityType === "AUTOMATION_RUN") {
    return {
      key: record.key,
      entityType: "LEAD",
      entityId: record.leadId,
      leadId: record.leadId,
      title: record.title,
      subtitle: record.subtitle,
      responsibleName: record.responsibleName,
      status: record.status,
      occurredAt: record.occurredAt,
      href: record.href,
    };
  }
  return { ...record, entityType: record.entityType };
}

function uniqueRecords(records: readonly ManagerAnalyticsRecord[]): ManagerAnalyticsRecord[] {
  return [...new Map(records.map((record) => [record.key, record])).values()]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key));
}

function keys(records: readonly ManagerAnalyticsRecord[]) {
  return Object.freeze(records.map((record) => record.key));
}

function group(id: string, label: string, records: readonly ManagerAnalyticsRecord[]) {
  return Object.freeze({ id, label, recordKeys: keys(records) });
}

function recordKeys(screen: DashboardScreen, drilldownId: string): readonly string[] {
  return screen.drilldowns.find((item) => item.id === drilldownId)?.recordKeys ?? [];
}

function recordsForKeys(screen: DashboardScreen, keys: readonly string[]) {
  const wanted = new Set(keys);
  return screen.records.filter((record) => wanted.has(record.key)).map(asManagerRecord);
}

function recordsForLeadIds(screen: DashboardScreen, leadIds: ReadonlySet<string>) {
  return screen.records
    .filter((record) => record.entityType === "LEAD" && leadIds.has(record.leadId))
    .map(asManagerRecord);
}

function filtersFor(screen: DashboardScreen, additions: readonly string[] = []): readonly string[] {
  const options = screen.filterOptions;
  const mapNames = (ids: readonly string[], rows: readonly Readonly<{ id: string; name: string }>[], label: string) => {
    const names = new Map(rows.map((row) => [row.id, row.name]));
    return ids.length === 0 ? [] : [`${label}: ${ids.map((id) => names.get(id) ?? "ID autorizado").join(", ")}`];
  };
  const result = [
    ...mapNames(screen.query.filters.sdrMemberIds, options.sdrs, "SDR"),
    ...mapNames(screen.query.filters.closerMemberIds, options.closers, "Closer"),
    ...mapNames(screen.query.filters.teamIds, options.teams, "Equipe"),
    ...mapNames(screen.query.filters.sourceIds, options.sources, "Origem"),
    ...mapNames(screen.query.filters.campaignIds, options.campaigns, "Campanha"),
    ...mapNames(screen.query.filters.creativeIds, options.creatives, "Criativo"),
    ...mapNames(screen.query.filters.priorityCodes, options.priorities, "Prioridade"),
    ...mapNames(screen.query.filters.productIds, options.products, "Produto"),
    ...additions,
  ];
  return Object.freeze(result.length > 0 ? result : ["Nenhum filtro dimensional"]);
}

function questionLabel(questionId: ManagerQuestionId) {
  return managerQuestions.find((question) => question.id === questionId)!.label;
}

function inaccessibleIds(ids: readonly string[]) {
  return ids.length > 0 ? [...ids] : ["00000000-0000-0000-0000-000000000000"];
}

export function createManagerAnalyticsService(options: ManagerAnalyticsServiceOptions) {
  async function access(context: AuthenticatedContext): Promise<"WORKSPACE" | "TEAM"> {
    const teams = await options.database.teamMember.findMany({
      where: {
        workspaceId: context.workspaceId,
        workspaceMemberId: context.memberId,
        deletedAt: null,
        team: { deletedAt: null },
      },
      orderBy: [{ teamId: "asc" }],
      select: { teamId: true },
    });
    const resource: ResourceScope = {
      workspaceId: context.workspaceId,
      resourceType: "ManagerCopilot",
      resourceId: context.workspaceId,
      teamId: teams[0]?.teamId ?? null,
    };
    const decision = await options.authorization.authorize(
      context,
      PermissionKeys.AI_MANAGER_QUERY,
      resource,
    );
    if (!decision.allowed) {
      await options.authorization.assertAuthorized(context, PermissionKeys.AI_MANAGER_QUERY, resource);
      throw new Error("Unreachable authorization state.");
    }
    if (decision.scope === "OWN") {
      await options.authorization.assertAuthorized(context, PermissionKeys.AI_MANAGER_QUERY, {
        ...resource,
        teamId: null,
      });
      throw new Error("Unreachable manager scope.");
    }
    return decision.scope;
  }

  async function getShell(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<ManagerAnalyticsShell> {
    await access(context);
    const screen = await options.dashboard.getScreen(context, input);
    return Object.freeze({
      query: screen.query,
      timeZone: screen.overview.period.timeZone,
      filterOptions: screen.filterOptions,
      questions: managerQuestions,
    });
  }

  async function answerP1WithoutAttempt(
    context: AuthenticatedContext,
    query: DashboardQuery,
    scope: "WORKSPACE" | "TEAM",
  ): Promise<ManagerAnalyticsAnswer> {
    const screen = await options.dashboard.getScreen(context, dashboardInput(query, { priorityCodes: ["P1"] }));
    const attempted = new Set(screen.overview.evidence.attemptedLeadIds);
    const p1 = new Set(screen.overview.evidence.leadsReceivedLeadIds);
    const ids = new Set([...p1].filter((id) => !attempted.has(id)));
    const value = ids.size;
    const pendingRecords = uniqueRecords(recordsForLeadIds(screen, ids));
    const allRecords = uniqueRecords(recordsForLeadIds(screen, p1));
    const attemptedRecords = uniqueRecords(recordsForLeadIds(screen, attempted));
    return Object.freeze({
      questionId: "P1_WITHOUT_ATTEMPT",
      question: questionLabel("P1_WITHOUT_ATTEMPT"),
      directAnswer: value === 0
        ? "Nenhum lead P1 recebido no período está sem primeira tentativa humana."
        : `${value} lead(s) P1 recebido(s) no período ainda não possuem primeira tentativa humana.`,
      period: period(screen), filters: filtersFor(screen, ["Prioridade fixada pela pergunta: P1"]), scope,
      formula: "leads P1 recebidos no período − leads P1 com primeira tentativa até o corte",
      numerator: { label: "Leads P1 sem tentativa", value, recordGroupId: "p1-pending" },
      denominator: { label: "Leads P1 recebidos", value: p1.size, recordGroupId: "p1-all" },
      numbers: [
        metric("Sem tentativa", value, "COUNT", "p1-pending"),
        metric("Com tentativa", attempted.size, "COUNT", "p1-attempted"),
      ],
      comparison: null,
      possibleCauses: ["A consulta identifica a pendência, mas não atribui causa sem evento persistido."],
      evidence: ["Coorte de LeadFormSubmission com resultado CREATED.", "Primeira tentativa obtida de LeadSlaCycle.firstHumanAttemptAt."],
      relatedRecords: uniqueRecords([...pendingRecords, ...allRecords, ...attemptedRecords]),
      recordGroups: [
        group("p1-pending", "Leads P1 sem tentativa", pendingRecords),
        group("p1-all", "Todos os leads P1 recebidos", allRecords),
        group("p1-attempted", "Leads P1 com tentativa", attemptedRecords),
      ],
      recommendedAction: { title: "Abrir os leads sem tentativa", reason: "Priorizar contato humano sem alterar responsável automaticamente.", requiresConfirmation: true as const },
      limitations: p1.size === 0 ? ["Não há leads P1 recebidos no período para formar denominador."] : [],
      confidence: confidence(p1.size > 0 ? 1 : 0.4, p1.size > 0 ? "Cálculo determinístico com coorte e timestamps persistidos." : "Sem amostra no período."),
    });
  }

  async function answerSdrsBelowAverage(
    context: AuthenticatedContext,
    query: DashboardQuery,
    scope: "WORKSPACE" | "TEAM",
  ): Promise<ManagerAnalyticsAnswer> {
    const screen = await options.dashboard.getScreen(context, dashboardInput(query));
    const average = screen.overview.attemptRate.percentage;
    const comparable = screen.sdrPerformance.filter((item) => item.percentage !== null);
    const below = average === null ? [] : comparable.filter((item) => item.percentage! < average);
    const records = below.flatMap((item) => recordsForKeys(screen, recordKeys(screen, item.drilldownId)));
    const comparableRecords = comparable.flatMap((item) => recordsForKeys(screen, recordKeys(screen, item.drilldownId)));
    const names = below.map((item) => `${item.label} (${item.percentage!.toLocaleString("pt-BR")}% )`);
    return Object.freeze({
      questionId: "SDRS_BELOW_AVERAGE", question: questionLabel("SDRS_BELOW_AVERAGE"),
      directAnswer: average === null
        ? "Não há denominador suficiente para calcular a média de tentativa dos SDRs."
        : below.length === 0
          ? `Nenhum SDR ficou abaixo da taxa geral de ${average.toLocaleString("pt-BR")}% no período.`
          : `${names.join(", ")} ficaram abaixo da taxa geral de ${average.toLocaleString("pt-BR")}%.`,
      period: period(screen), filters: filtersFor(screen), scope,
      formula: "SDR abaixo da média quando sua taxa (leads tentados / leads recebidos atribuídos) é menor que a taxa geral ponderada",
      numerator: { label: "SDRs abaixo da média", value: below.length, recordGroupId: "sdr-below" },
      denominator: { label: "SDRs com leads recebidos", value: comparable.length, recordGroupId: "sdr-all" },
      numbers: [
        metric("Taxa geral", average, "PERCENTAGE", "sdr-all"),
        metric("SDRs comparáveis", comparable.length, "COUNT", "sdr-all"),
      ], comparison: null,
      possibleCauses: ["Diferenças de volume, prioridade e momento da entrada podem coincidir com a taxa; a consulta não prova desempenho causal."],
      evidence: below.map((item) => `${item.label}: ${item.secondaryValue ?? 0} tentativa(s) em ${item.denominator ?? 0} lead(s).`),
      relatedRecords: uniqueRecords([...records, ...comparableRecords]),
      recordGroups: [
        group("sdr-below", "Registros dos SDRs abaixo da média", uniqueRecords(records)),
        group("sdr-all", "Registros de todos os SDRs comparáveis", uniqueRecords(comparableRecords)),
      ],
      recommendedAction: { title: "Revisar as filas abaixo da média", reason: "Inspecionar registros e contexto antes de redistribuir ou orientar a equipe.", requiresConfirmation: true as const },
      limitations: comparable.length < 2 ? ["São necessários ao menos dois SDRs com entradas para uma comparação útil."] : [],
      confidence: confidence(comparable.length >= 2 ? 0.9 : 0.35, comparable.length >= 2 ? "Taxas reconciliadas com a camada de métricas." : "Amostra insuficiente para comparação entre SDRs."),
    });
  }

  async function answerBiggestFunnelLoss(
    context: AuthenticatedContext,
    query: DashboardQuery,
    scope: "WORKSPACE" | "TEAM",
  ): Promise<ManagerAnalyticsAnswer> {
    const screen = await options.dashboard.getScreen(context, dashboardInput(query));
    const transitions = screen.funnel.slice(1).map((current, index) => {
      const previous = screen.funnel[index]!;
      const loss = Math.max(0, previous.value - current.value);
      return { previous, current, loss, conversion: current.percentage };
    });
    const worst = [...transitions].sort((left, right) => right.loss - left.loss || (left.conversion ?? 101) - (right.conversion ?? 101))[0];
    const previousLeadIds = worst
      ? new Set(recordsForKeys(screen, recordKeys(screen, worst.previous.drilldownId)).map((record) => record.leadId))
      : new Set<string>();
    const currentLeadIds = worst
      ? new Set(recordsForKeys(screen, recordKeys(screen, worst.current.drilldownId)).map((record) => record.leadId))
      : new Set<string>();
    const lostIds = new Set([...previousLeadIds].filter((id) => !currentLeadIds.has(id)));
    const lostRecords = uniqueRecords(recordsForLeadIds(screen, lostIds));
    const previousRecords = worst ? uniqueRecords(recordsForKeys(screen, recordKeys(screen, worst.previous.drilldownId))) : [];
    const currentRecords = worst ? uniqueRecords(recordsForKeys(screen, recordKeys(screen, worst.current.drilldownId))) : [];
    return Object.freeze({
      questionId: "BIGGEST_FUNNEL_LOSS", question: questionLabel("BIGGEST_FUNNEL_LOSS"),
      directAnswer: !worst || worst.previous.value === 0
        ? "O período não possui volume suficiente para localizar uma perda de conversão."
        : `A maior perda absoluta está entre ${worst.previous.label} e ${worst.current.label}: ${worst.loss} registro(s), conversão de ${worst.conversion?.toLocaleString("pt-BR") ?? "—"}%.`,
      period: period(screen), filters: filtersFor(screen), scope,
      formula: "para cada transição: próxima etapa / etapa anterior; perda absoluta = etapa anterior − próxima etapa",
      numerator: { label: worst ? `Chegaram a ${worst.current.label}` : "Próxima etapa", value: worst?.current.value ?? 0, recordGroupId: "funnel-current" },
      denominator: { label: worst ? `Estavam em ${worst.previous.label}` : "Etapa anterior", value: worst?.previous.value ?? 0, recordGroupId: "funnel-previous" },
      numbers: [
        metric("Perda absoluta", worst?.loss ?? 0, "COUNT", "funnel-lost"),
        metric("Conversão", worst?.conversion ?? null, "PERCENTAGE", "funnel-current"),
      ], comparison: null,
      possibleCauses: ["O ponto de queda é um fato de conversão; o motivo causal exige eventos, motivos e contexto dos registros relacionados."],
      evidence: worst ? [`Funil de coorte: ${worst.previous.value} em ${worst.previous.label} e ${worst.current.value} em ${worst.current.label}.`] : [],
      relatedRecords: uniqueRecords([...lostRecords, ...previousRecords, ...currentRecords]),
      recordGroups: [
        group("funnel-lost", "Registros que não avançaram", lostRecords),
        group("funnel-previous", "Registros na etapa anterior", previousRecords),
        group("funnel-current", "Registros que chegaram à etapa seguinte", currentRecords),
      ],
      recommendedAction: { title: "Inspecionar os registros que não avançaram", reason: "Comparar atividades, motivos e tempo de etapa antes de mudar o processo.", requiresConfirmation: true as const },
      limitations: !worst || worst.previous.value === 0 ? ["Sem denominador para comparar transições no período."] : ["A maior perda absoluta pode diferir da menor taxa percentual."],
      confidence: confidence(worst && worst.previous.value > 0 ? 0.9 : 0.3, worst && worst.previous.value > 0 ? "Conversões calculadas do histórico de eventos." : "Sem amostra de funil suficiente."),
    });
  }

  async function answerTomorrowMeetings(
    context: AuthenticatedContext,
    query: DashboardQuery,
    scope: "WORKSPACE" | "TEAM",
  ): Promise<ManagerAnalyticsAnswer> {
    const base = await options.dashboard.getScreen(context, dashboardInput(query));
    const tomorrow = addLocalDays(workspaceDateAt(options.now(), base.overview.period.timeZone), 1);
    const screen = await options.dashboard.getScreen(context, customDashboardInput(query, tomorrow, tomorrow));
    const range = workspaceDayRange(tomorrow, screen.overview.period.timeZone);
    const meetings = await options.database.meeting.findMany({
      where: {
        workspaceId: context.workspaceId,
        leadId: { in: inaccessibleIds(screen.overview.evidence.universeLeadIds) },
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        startsAt: { gte: range.start, lt: range.end },
        deletedAt: null,
        ...(screen.query.filters.closerMemberIds.length > 0 ? { ownerMemberId: { in: [...screen.query.filters.closerMemberIds] } } : {}),
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: {
        id: true, leadId: true, title: true, startsAt: true, status: true,
        owner: { select: { user: { select: { displayName: true } } } },
        lead: {
          select: {
            fullName: true,
            qualification: {
              select: {
                status: true,
                minimumRequiredDimensions: true,
                assessments: { select: { status: true, validatedAt: true } },
              },
            },
          },
        },
      },
    });
    const complete = (meeting: (typeof meetings)[number]) => {
      const qualification = meeting.lead.qualification;
      const validated = qualification?.assessments.filter((item) => item.validatedAt && item.status !== "UNKNOWN").length ?? 0;
      return qualification?.status === "COMPLETED" && validated >= qualification.minimumRequiredDimensions;
    };
    const missing = meetings.filter((meeting) => !complete(meeting));
    const toRecord = (meeting: (typeof meetings)[number], pactoStatus: string): ManagerAnalyticsRecord => ({
      key: `meeting:${meeting.id}`, entityType: "MEETING", entityId: meeting.id, leadId: meeting.leadId,
      title: meeting.lead.fullName, subtitle: meeting.title, responsibleName: meeting.owner.user.displayName,
      status: pactoStatus, occurredAt: meeting.startsAt.toISOString(), href: `/agenda/reunioes/${meeting.id}`,
    });
    const records = missing.map((meeting) => toRecord(meeting, "PACTO incompleto"));
    const completeRecords = meetings.filter(complete).map((meeting) => toRecord(meeting, "PACTO completo"));
    const allRecords = [...records, ...completeRecords];
    return Object.freeze({
      questionId: "TOMORROW_MEETINGS_WITHOUT_PACTO", question: questionLabel("TOMORROW_MEETINGS_WITHOUT_PACTO"),
      directAnswer: missing.length === 0 ? "Nenhuma reunião de amanhã está com PACTO incompleto." : `${missing.length} de ${meetings.length} reunião(ões) de amanhã estão sem PACTO humano completo.`,
      period: period(screen), filters: filtersFor(screen, ["Data fixada pela pergunta: amanhã"]), scope,
      formula: "reuniões futuras ativas de amanhã cujo PACTO não está COMPLETED com o mínimo de dimensões humanas validadas",
      numerator: { label: "Reuniões sem PACTO completo", value: missing.length, recordGroupId: "meeting-missing-pacto" },
      denominator: { label: "Reuniões ativas de amanhã", value: meetings.length, recordGroupId: "meeting-all" },
      numbers: [metric("Com PACTO completo", meetings.length - missing.length, "COUNT", "meeting-complete-pacto")],
      comparison: null,
      possibleCauses: ["Campos PACTO ausentes ou ainda em rascunho explicam a classificação; nenhuma causa além desses estados foi inferida."],
      evidence: ["Meeting.startsAt/status e LeadQualification/PactoAssessment persistidos."],
      relatedRecords: Object.freeze(allRecords),
      recordGroups: [
        group("meeting-missing-pacto", "Reuniões sem PACTO completo", records),
        group("meeting-all", "Todas as reuniões ativas de amanhã", allRecords),
        group("meeting-complete-pacto", "Reuniões com PACTO completo", completeRecords),
      ],
      recommendedAction: { title: "Completar o briefing antes das reuniões", reason: "Abrir cada reunião e validar somente evidências confirmadas pelo time.", requiresConfirmation: true as const },
      limitations: meetings.length === 0 ? ["Não há reuniões ativas amanhã no recorte autorizado."] : [],
      confidence: confidence(meetings.length > 0 ? 1 : 0.5, "Estado atual de reunião e PACTO consultado diretamente na camada de métricas."),
    });
  }

  async function answerStalledOpportunities(
    context: AuthenticatedContext,
    query: DashboardQuery,
    scope: "WORKSPACE" | "TEAM",
  ): Promise<ManagerAnalyticsAnswer> {
    const screen = await options.dashboard.getScreen(context, dashboardInput(query));
    const workspace = await options.database.workspace.findUniqueOrThrow({ where: { id: context.workspaceId }, select: { leadStagnationDays: true } });
    const to = new Date(Math.min(new Date(screen.query.to).getTime(), options.now().getTime()));
    const cutoff = new Date(to.getTime() - workspace.leadStagnationDays * 86_400_000);
    const opportunities = await options.database.opportunity.findMany({
      where: {
        workspaceId: context.workspaceId, leadId: { in: inaccessibleIds(screen.overview.evidence.universeLeadIds) },
        status: "OPEN", deletedAt: null,
        ...(screen.query.filters.closerMemberIds.length > 0 ? { ownerMemberId: { in: [...screen.query.filters.closerMemberIds] } } : {}),
        ...(screen.query.filters.productIds.length > 0 ? { productId: { in: [...screen.query.filters.productIds] } } : {}),
      },
      select: {
        id: true, leadId: true, name: true, nextActionAt: true,
        owner: { select: { user: { select: { displayName: true } } } },
        lead: { select: { fullName: true } },
        currentStage: { select: { name: true } },
        stageHistory: { where: { exitedAt: null }, orderBy: [{ enteredAt: "desc" }], take: 1, select: { enteredAt: true } },
      },
    });
    const stalled = opportunities.filter((item) => item.stageHistory[0]?.enteredAt && item.stageHistory[0].enteredAt <= cutoff);
    const records = stalled.map((item): ManagerAnalyticsRecord => {
      const enteredAt = item.stageHistory[0]!.enteredAt;
      const days = Math.max(0, Math.floor((to.getTime() - enteredAt.getTime()) / 86_400_000));
      return {
        key: `opportunity:${item.id}`, entityType: "OPPORTUNITY", entityId: item.id, leadId: item.leadId,
        title: item.name, subtitle: `${item.lead.fullName} · ${item.currentStage.name}`,
        responsibleName: item.owner.user.displayName, status: `Parada há ${days} dia(s)`,
        occurredAt: enteredAt.toISOString(), href: `/leads/${item.leadId}/historico#oportunidade`,
      };
    });
    const allRecords = opportunities.map((item): ManagerAnalyticsRecord => ({
      key: `opportunity:${item.id}`, entityType: "OPPORTUNITY", entityId: item.id, leadId: item.leadId,
      title: item.name, subtitle: `${item.lead.fullName} · ${item.currentStage.name}`,
      responsibleName: item.owner.user.displayName, status: "Aberta",
      occurredAt: item.stageHistory[0]?.enteredAt.toISOString() ?? screen.query.from,
      href: `/leads/${item.leadId}/historico#oportunidade`,
    }));
    return Object.freeze({
      questionId: "STALLED_OPPORTUNITIES", question: questionLabel("STALLED_OPPORTUNITIES"),
      directAnswer: stalled.length === 0 ? "Nenhuma oportunidade aberta atingiu o limite de estagnação." : `${stalled.length} oportunidade(s) aberta(s) estão há pelo menos ${workspace.leadStagnationDays} dia(s) na etapa atual.`,
      period: period(screen), filters: filtersFor(screen, [`Corte operacional: ${to.toISOString()}`]), scope,
      formula: `oportunidade OPEN com StageHistory aberto há pelo menos ${workspace.leadStagnationDays} dias`,
      numerator: { label: "Oportunidades paradas", value: stalled.length, recordGroupId: "opportunity-stalled" },
      denominator: { label: "Oportunidades abertas", value: opportunities.length, recordGroupId: "opportunity-open" },
      numbers: [metric("Limite configurado", workspace.leadStagnationDays, "DAYS", "opportunity-stalled")], comparison: null,
      possibleCauses: ["A permanência na etapa é comprovada; falta de atividade, objeção ou decisão não é inferida sem evento específico."],
      evidence: ["Opportunity.status e intervalo aberto de StageHistory."], relatedRecords: Object.freeze(uniqueRecords([...records, ...allRecords])),
      recordGroups: [
        group("opportunity-stalled", "Oportunidades paradas", records),
        group("opportunity-open", "Todas as oportunidades abertas", allRecords),
      ],
      recommendedAction: { title: "Revisar próxima ação das oportunidades paradas", reason: "Confirmar contexto antes de cobrar, avançar, perder ou redistribuir.", requiresConfirmation: true as const },
      limitations: ["O MVP reutiliza o limite persistido de lead parado; não existe ainda um limite separado por pipeline de vendas."],
      confidence: confidence(0.9, "Aging calculado do intervalo aberto de etapa."),
    });
  }

  async function answerTopSource(
    context: AuthenticatedContext,
    query: DashboardQuery,
    scope: "WORKSPACE" | "TEAM",
  ): Promise<ManagerAnalyticsAnswer> {
    const screen = await options.dashboard.getScreen(context, dashboardInput(query));
    const qualified = new Set(screen.overview.evidence.qualifiedLeadIds);
    const qualifiedAndScheduled = new Set(screen.overview.evidence.scheduledLeadIds.filter((id) => qualified.has(id)));
    const leads = await options.database.lead.findMany({
      where: { workspaceId: context.workspaceId, id: { in: inaccessibleIds([...qualifiedAndScheduled]) } },
      select: { id: true, fullName: true, source: { select: { id: true, name: true } }, currentStage: { select: { name: true } }, owner: { select: { user: { select: { displayName: true } } } } },
    });
    const groups = new Map<string, { name: string; leads: typeof leads }>();
    for (const lead of leads) {
      const group = groups.get(lead.source.id) ?? { name: lead.source.name, leads: [] };
      group.leads.push(lead); groups.set(lead.source.id, group);
    }
    const top = [...groups.values()].sort((left, right) => right.leads.length - left.leads.length || left.name.localeCompare(right.name, "pt-BR"))[0];
    const records = (top?.leads ?? []).map((lead): ManagerAnalyticsRecord => ({
      key: `lead:${lead.id}`, entityType: "LEAD", entityId: lead.id, leadId: lead.id,
      title: lead.fullName, subtitle: `${top!.name} · ${lead.currentStage.name}`,
      responsibleName: lead.owner?.user.displayName ?? "Fila operacional", status: "Qualificado com agendamento",
      occurredAt: screen.query.to, href: `/leads/${lead.id}/historico`,
    }));
    const allRecords = leads.map((lead): ManagerAnalyticsRecord => ({
      key: `lead:${lead.id}`, entityType: "LEAD", entityId: lead.id, leadId: lead.id,
      title: lead.fullName, subtitle: `${lead.source.name} · ${lead.currentStage.name}`,
      responsibleName: lead.owner?.user.displayName ?? "Fila operacional", status: "Qualificado com agendamento",
      occurredAt: screen.query.to, href: `/leads/${lead.id}/historico`,
    }));
    return Object.freeze({
      questionId: "TOP_SOURCE_QUALIFIED_MEETINGS", question: questionLabel("TOP_SOURCE_QUALIFIED_MEETINGS"),
      directAnswer: top ? `${top.name} gerou mais reuniões qualificadas no período: ${top.leads.length} lead(s).` : "Não há reunião qualificada na coorte do período para comparar origens.",
      period: period(screen), filters: filtersFor(screen), scope,
      formula: "leads recebidos no período que entraram em Qualificado e tiveram agendamento até o corte, agrupados pela origem inicial",
      numerator: { label: "Reuniões qualificadas da origem líder", value: top?.leads.length ?? 0, recordGroupId: "source-top" },
      denominator: { label: "Reuniões qualificadas no recorte", value: qualifiedAndScheduled.size, recordGroupId: "source-all" },
      numbers: [metric("Origens com resultado", groups.size, "COUNT", "source-all")], comparison: null,
      possibleCauses: ["A origem está associada ao resultado, mas esta distribuição não demonstra causalidade nem qualidade incremental."],
      evidence: [...groups.values()].map((group) => `${group.name}: ${group.leads.length} lead(s) qualificado(s) com agendamento.`),
      relatedRecords: Object.freeze(uniqueRecords([...records, ...allRecords])),
      recordGroups: [
        group("source-top", "Registros da origem líder", records),
        group("source-all", "Todas as reuniões qualificadas", allRecords),
      ],
      recommendedAction: { title: "Comparar a origem líder com as demais", reason: "Revisar volume, PACTO e conversão antes de realocar investimento.", requiresConfirmation: true as const },
      limitations: qualifiedAndScheduled.size === 0 ? ["Sem denominador no período."] : ["Atribuição usa a origem inicial do lead e não um modelo de atribuição multitoque."],
      confidence: confidence(qualifiedAndScheduled.size > 0 ? 0.85 : 0.3, qualifiedAndScheduled.size > 0 ? "Interseção de qualificação e agendamento persistidos." : "Sem reuniões qualificadas no recorte."),
    });
  }

  async function answerActionsToday(
    context: AuthenticatedContext,
    query: DashboardQuery,
    scope: "WORKSPACE" | "TEAM",
  ): Promise<ManagerAnalyticsAnswer> {
    const base = await options.dashboard.getScreen(context, dashboardInput(query));
    const today = workspaceDateAt(options.now(), base.overview.period.timeZone);
    const screen = await options.dashboard.getScreen(context, customDashboardInput(query, today, today));
    const range = workspaceDayRange(today, screen.overview.period.timeZone);
    const tasks = await options.database.task.findMany({
      where: {
        workspaceId: context.workspaceId,
        leadId: { in: inaccessibleIds(screen.overview.evidence.universeLeadIds) },
        status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null,
        createdAt: { lt: range.end }, dueAt: { lt: range.end },
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      select: {
        id: true, leadId: true, title: true, dueAt: true, status: true,
        assignee: { select: { user: { select: { displayName: true } } } },
        queue: { select: { name: true } },
        lead: { select: { fullName: true } },
      },
    });
    const firstTaskByLead = new Map<string, (typeof tasks)[number]>();
    for (const task of tasks) if (!firstTaskByLead.has(task.leadId)) firstTaskByLead.set(task.leadId, task);
    const noNextActionIds = new Set(screen.overview.evidence.leadsWithoutNextActionIds);
    const missingLeads = await options.database.lead.findMany({
      where: { workspaceId: context.workspaceId, id: { in: inaccessibleIds([...noNextActionIds]) } },
      select: { id: true, fullName: true, currentStage: { select: { name: true } }, owner: { select: { user: { select: { displayName: true } } } } },
    });
    const records: ManagerAnalyticsRecord[] = [...firstTaskByLead.values()].map((task) => ({
      key: `lead:${task.leadId}`, entityType: "LEAD", entityId: task.leadId, leadId: task.leadId,
      title: task.lead.fullName, subtitle: task.title,
      responsibleName: task.assignee?.user.displayName ?? task.queue?.name ?? "Fila operacional",
      status: task.dueAt < range.start ? "Atrasada" : "Para hoje", occurredAt: task.dueAt.toISOString(), href: `/leads/${task.leadId}/historico#timeline`,
    }));
    for (const lead of missingLeads) if (!firstTaskByLead.has(lead.id)) records.push({
      key: `lead:${lead.id}`, entityType: "LEAD", entityId: lead.id, leadId: lead.id,
      title: lead.fullName, subtitle: lead.currentStage.name,
      responsibleName: lead.owner?.user.displayName ?? "Fila operacional", status: "Sem próxima ação",
      occurredAt: range.start.toISOString(), href: `/leads/${lead.id}/historico`,
    });
    const actionableRecords = uniqueRecords(records);
    const taskRecords = actionableRecords.filter((record) => record.status !== "Sem próxima ação");
    const missingRecords = actionableRecords.filter((record) => record.status === "Sem próxima ação");
    const backlogRecords = uniqueRecords(recordsForLeadIds(screen, new Set(screen.overview.evidence.openLeadIds)));
    return Object.freeze({
      questionId: "LEADS_REQUIRING_ACTION_TODAY", question: questionLabel("LEADS_REQUIRING_ACTION_TODAY"),
      directAnswer: records.length === 0 ? "Nenhum lead do recorte possui ação vencida, para hoje ou ausência de próxima ação." : `${records.length} lead(s) exigem ação hoje: ${firstTaskByLead.size} com tarefa vencida/para hoje e ${records.length - firstTaskByLead.size} sem próxima ação.`,
      period: period(screen), filters: filtersFor(screen, ["Data fixada pela pergunta: hoje"]), scope,
      formula: "leads abertos com tarefa ativa vencida ou de hoje, unidos aos leads abertos sem tarefa ativa",
      numerator: { label: "Leads que exigem ação", value: records.length, recordGroupId: "action-all" },
      denominator: { label: "Backlog aberto", value: screen.overview.backlog.value, recordGroupId: "action-backlog" },
      numbers: [
        metric("Com tarefa vencida/hoje", firstTaskByLead.size, "COUNT", "action-task"),
        metric("Sem próxima ação", records.length - firstTaskByLead.size, "COUNT", "action-missing"),
      ], comparison: null,
      possibleCauses: ["A consulta aponta a obrigação operacional; o motivo do atraso não é inferido."],
      evidence: ["Task.status/dueAt e backlog/ausência de tarefa ativa calculados no corte de hoje."],
      relatedRecords: Object.freeze(uniqueRecords([...actionableRecords, ...backlogRecords])),
      recordGroups: [
        group("action-all", "Leads que exigem ação hoje", actionableRecords),
        group("action-backlog", "Backlog aberto", backlogRecords),
        group("action-task", "Leads com tarefa vencida ou para hoje", taskRecords),
        group("action-missing", "Leads sem próxima ação", missingRecords),
      ],
      recommendedAction: { title: "Executar a primeira ação de cada registro", reason: "Começar por atrasados e erros de próxima ação, mantendo a priorização operacional.", requiresConfirmation: true as const },
      limitations: screen.overview.backlog.value === 0 ? ["Não há backlog aberto no corte de hoje."] : [],
      confidence: confidence(0.95, "Tarefas e ausência de próxima ação vêm de dados persistidos no corte civil do workspace."),
    });
  }

  async function answerShowRateDrop(
    context: AuthenticatedContext,
    query: DashboardQuery,
    scope: "WORKSPACE" | "TEAM",
  ): Promise<ManagerAnalyticsAnswer> {
    const screen = await options.dashboard.getScreen(context, dashboardInput(query));
    const previous = await options.metrics.getOverview(context, {
      from: screen.comparisonPeriod.from,
      to: screen.comparisonPeriod.to,
      filters: screen.query.filters,
    });
    const currentRate = screen.overview.showRate.percentage;
    const previousRate = previous.showRate.percentage;
    const delta = currentRate === null || previousRate === null ? null : Math.round((currentRate - previousRate) * 100) / 100;
    const fell = delta !== null && delta < 0;
    const topReason = screen.noShowReasons[0];
    const lowCloser = [...screen.closerPerformance]
      .filter((item) => item.percentage !== null)
      .sort((left, right) => left.percentage! - right.percentage!)[0];
    const causes = [
      `No-shows: ${screen.overview.noShowRate.numerator}/${screen.overview.noShowRate.denominator} no período atual, contra ${previous.noShowRate.numerator}/${previous.noShowRate.denominator} no período anterior.`,
      ...(topReason ? [`Motivo de no-show mais frequente registrado: ${topReason.label} (${topReason.value}).`] : []),
      ...(lowCloser ? [`Menor show rate observado por closer: ${lowCloser.label}, ${lowCloser.percentage!.toLocaleString("pt-BR")}% em ${lowCloser.denominator ?? 0} reunião(ões) decidida(s).`] : []),
    ];
    const currentShowIds = screen.overview.evidence.heldMeetings.map((item) => item.meetingId);
    const currentNoShowIds = screen.overview.evidence.noShowMeetings.map((item) => item.meetingId);
    const previousShowIds = previous.evidence.heldMeetings.map((item) => item.meetingId);
    const previousNoShowIds = previous.evidence.noShowMeetings.map((item) => item.meetingId);
    const meetingIds = [...new Set([...currentShowIds, ...currentNoShowIds, ...previousShowIds, ...previousNoShowIds])];
    const meetings = await options.database.meeting.findMany({
      where: { workspaceId: context.workspaceId, id: { in: inaccessibleIds(meetingIds) } },
      select: {
        id: true, leadId: true, title: true, startsAt: true, status: true,
        lead: { select: { fullName: true } },
        owner: { select: { user: { select: { displayName: true } } } },
      },
    });
    const meetingRecords = new Map(meetings.map((meeting) => [meeting.id, {
      key: `meeting:${meeting.id}`, entityType: "MEETING" as const, entityId: meeting.id, leadId: meeting.leadId,
      title: meeting.lead.fullName, subtitle: meeting.title, responsibleName: meeting.owner.user.displayName,
      status: meeting.status, occurredAt: meeting.startsAt.toISOString(), href: `/agenda/reunioes/${meeting.id}`,
    }]));
    const recordsForMeetingIds = (ids: readonly string[]) => ids.flatMap((id) => {
      const record = meetingRecords.get(id);
      return record ? [record] : [];
    });
    const currentShowRecords = recordsForMeetingIds(currentShowIds);
    const currentNoShowRecords = recordsForMeetingIds(currentNoShowIds);
    const currentDecidedRecords = uniqueRecords([...currentShowRecords, ...currentNoShowRecords]);
    const previousShowRecords = recordsForMeetingIds(previousShowIds);
    const previousDecidedRecords = uniqueRecords([...previousShowRecords, ...recordsForMeetingIds(previousNoShowIds)]);
    return Object.freeze({
      questionId: "SHOW_RATE_DROP", question: questionLabel("SHOW_RATE_DROP"),
      directAnswer: currentRate === null || previousRate === null
        ? "Não há reuniões decididas suficientes nos dois períodos para afirmar que o show rate caiu."
        : fell
          ? `O show rate caiu ${Math.abs(delta!).toLocaleString("pt-BR")} ponto(s) percentual(is), de ${previousRate.toLocaleString("pt-BR")}% para ${currentRate.toLocaleString("pt-BR")}%. As evidências abaixo são correlações, não causas comprovadas.`
          : `O show rate não caiu neste recorte: variou de ${previousRate.toLocaleString("pt-BR")}% para ${currentRate.toLocaleString("pt-BR")}%.`,
      period: period(screen), filters: filtersFor(screen), scope,
      formula: "show rate = reuniões COMPLETED / (COMPLETED + NO_SHOW); comparação com o período civil anterior equivalente",
      numerator: { label: "Shows no período atual", value: screen.overview.showRate.numerator, recordGroupId: "show-current" },
      denominator: { label: "Reuniões decididas no período atual", value: screen.overview.showRate.denominator, recordGroupId: "show-current-decided" },
      numbers: [
        metric("Show rate atual", currentRate, "PERCENTAGE", "show-current-decided"),
        metric("Show rate anterior", previousRate, "PERCENTAGE", "show-previous-decided"),
      ],
      comparison: { label: "Variação do show rate", current: currentRate, previous: previousRate, delta, unit: "PERCENTAGE" as const },
      possibleCauses: Object.freeze(causes),
      evidence: ["MeetingHistory no último estado anterior a cada corte.", "Cancelamentos não entram no numerador nem no denominador."],
      relatedRecords: uniqueRecords([...currentDecidedRecords, ...previousDecidedRecords]),
      recordGroups: [
        group("show-current", "Shows no período atual", currentShowRecords),
        group("show-current-decided", "Reuniões decididas no período atual", currentDecidedRecords),
        group("show-previous-decided", "Reuniões decididas no período anterior", previousDecidedRecords),
        group("show-current-no-show", "No-shows no período atual", currentNoShowRecords),
      ],
      recommendedAction: { title: "Revisar os no-shows do período", reason: "Validar motivos e composição da agenda antes de mudar cadência ou equipe.", requiresConfirmation: true as const },
      limitations: ["Variação temporal e segmentos associados não demonstram causa.", "Amostras pequenas podem produzir oscilações grandes."],
      confidence: confidence(screen.overview.showRate.denominator >= 10 && previous.showRate.denominator >= 10 ? 0.85 : 0.45, "A fórmula é exata; a confiança na interpretação depende do tamanho das duas amostras."),
    });
  }

  async function answer(
    context: AuthenticatedContext,
    input: unknown,
  ): Promise<ManagerAnalyticsAnswer> {
    const parsed = answerInputSchema.safeParse(input);
    if (!parsed.success) invalidInput(parsed.error);
    const scope = await access(context);
    const query = parsed.data.query;
    switch (parsed.data.questionId) {
      case "P1_WITHOUT_ATTEMPT": return answerP1WithoutAttempt(context, query, scope);
      case "SDRS_BELOW_AVERAGE": return answerSdrsBelowAverage(context, query, scope);
      case "BIGGEST_FUNNEL_LOSS": return answerBiggestFunnelLoss(context, query, scope);
      case "TOMORROW_MEETINGS_WITHOUT_PACTO": return answerTomorrowMeetings(context, query, scope);
      case "STALLED_OPPORTUNITIES": return answerStalledOpportunities(context, query, scope);
      case "TOP_SOURCE_QUALIFIED_MEETINGS": return answerTopSource(context, query, scope);
      case "LEADS_REQUIRING_ACTION_TODAY": return answerActionsToday(context, query, scope);
      case "SHOW_RATE_DROP": return answerShowRateDrop(context, query, scope);
    }
  }

  return Object.freeze({ getShell, answer });
}

let service: ReturnType<typeof createManagerAnalyticsService> | undefined;

export function getManagerAnalyticsService() {
  service ??= createManagerAnalyticsService({
    database: getDatabaseClient(),
    dashboard: getDashboardMetricsService(),
    metrics: getMetricsService(),
    authorization: getAuthorizationService(),
    now: () => new Date(),
  });
  return service;
}
