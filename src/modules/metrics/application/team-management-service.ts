import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getDashboardMetricsService } from "@/modules/metrics/application/dashboard-metrics-service";
import type { DashboardPerformanceRow } from "@/modules/metrics/domain/dashboard-contracts";
import { buildCoachingSuggestions, taskCompletionPercentage, workedQueueCorrectly } from "@/modules/metrics/domain/team-management";
import type { TeamManagementPerson, TeamManagementScreen } from "@/modules/metrics/domain/team-management-contracts";
import { getDatabaseClient } from "@/shared/core/database/client";

const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";
const contactTypes = ["CALL", "CALL_CONNECTED", "CALL_UNANSWERED", "EMAIL", "MESSAGE", "MESSAGE_SENT", "MESSAGE_RECEIVED", "MEETING", "PROPOSAL"] as const;

type MutablePerson = {
  id: string; name: string; roles: Set<"SDR" | "CLOSER">; contacts: number; meetings: number;
  averageFirstResponseSeconds: number | null; sdrConversionPercentage: number | null;
  sellerConversionPercentage: number | null; tasksTotal: number; tasksCompleted: number;
  leadsWithoutNextAction: number; forgottenLeads: number;
};

function addPerformance(target: MutablePerson, row: DashboardPerformanceRow) {
  target.roles.add(row.role);
  if (row.role === "SDR") {
    target.sdrConversionPercentage = row.conversionPercentage;
    target.averageFirstResponseSeconds = row.slaSeconds;
  } else target.sellerConversionPercentage = row.conversionPercentage;
}

export async function getTeamManagementScreen(
  context: AuthenticatedContext,
  input: unknown,
): Promise<TeamManagementScreen> {
  const dashboard = await getDashboardMetricsService().getScreen(context, input);
  const database = getDatabaseClient();
  const leadIds = dashboard.overview.evidence.universeLeadIds;
  const scopedLeadIds = leadIds.length ? leadIds : [EMPTY_UUID];
  const from = new Date(dashboard.query.from);
  const to = new Date(dashboard.query.to);
  const alertIds = [...new Set([
    ...dashboard.overview.evidence.leadsWithoutNextActionIds,
    ...dashboard.overview.evidence.stalledLeadIds,
  ])];

  const [activities, tasks, meetings, alertLeads] = await Promise.all([
    database.activity.findMany({
      where: { workspaceId: context.workspaceId, leadId: { in: [...scopedLeadIds] }, occurredAt: { gte: from, lt: to }, type: { in: [...contactTypes] }, deletedAt: null },
      select: { createdByActorId: true },
    }),
    database.task.findMany({
      where: { workspaceId: context.workspaceId, leadId: { in: [...scopedLeadIds] }, dueAt: { gte: from, lt: to }, deletedAt: null, status: { not: "CANCELLED" } },
      select: { assigneeMemberId: true, status: true },
    }),
    database.meeting.findMany({
      where: { workspaceId: context.workspaceId, leadId: { in: [...scopedLeadIds] }, startsAt: { gte: from, lt: to }, deletedAt: null, status: { not: "CANCELLED" } },
      select: { ownerMemberId: true },
    }),
    database.lead.findMany({
      where: { workspaceId: context.workspaceId, id: { in: alertIds.length ? alertIds : [EMPTY_UUID] }, deletedAt: null },
      select: { id: true, fullName: true, ownerMemberId: true, owner: { select: { user: { select: { displayName: true } } } } },
    }),
  ]);

  const actorIds = [...new Set(activities.map((activity) => activity.createdByActorId))];
  const actors = await database.actor.findMany({
    where: { workspaceId: context.workspaceId, id: { in: actorIds } },
    select: { id: true, userId: true },
  });
  const actorUserById = new Map(actors.map((actor) => [actor.id, actor.userId]));
  const actorUserIds = [...new Set(actors.flatMap((actor) => actor.userId ? [actor.userId] : []))];
  const extraMemberIds = [...new Set([
    ...tasks.flatMap((task) => task.assigneeMemberId ? [task.assigneeMemberId] : []),
    ...meetings.map((meeting) => meeting.ownerMemberId),
  ])];
  const members = await database.workspaceMember.findMany({
    where: {
      workspaceId: context.workspaceId,
      deletedAt: null,
      OR: [
        { id: { in: [...new Set([...dashboard.performance.map((row) => row.id), ...extraMemberIds])] } },
        { userId: { in: actorUserIds } },
      ],
    },
    select: { id: true, userId: true, user: { select: { displayName: true } } },
  });
  const membersById = new Map(members.map((member) => [member.id, member]));
  const membersByUserId = new Map(members.map((member) => [member.userId, member]));
  const people = new Map<string, MutablePerson>();
  const ensure = (id: string, name: string) => {
    const current = people.get(id) ?? { id, name, roles: new Set<"SDR" | "CLOSER">(), contacts: 0, meetings: 0, averageFirstResponseSeconds: null, sdrConversionPercentage: null, sellerConversionPercentage: null, tasksTotal: 0, tasksCompleted: 0, leadsWithoutNextAction: 0, forgottenLeads: 0 };
    people.set(id, current);
    return current;
  };

  for (const row of dashboard.performance) addPerformance(ensure(row.id, row.name), row);
  for (const activity of activities) {
    const userId = actorUserById.get(activity.createdByActorId);
    const member = userId ? membersByUserId.get(userId) : undefined;
    if (member) ensure(member.id, member.user.displayName).contacts += 1;
  }
  for (const task of tasks) {
    if (!task.assigneeMemberId) continue;
    const member = membersById.get(task.assigneeMemberId);
    if (!member) continue;
    const person = ensure(member.id, member.user.displayName);
    person.tasksTotal += 1;
    if (task.status === "COMPLETED") person.tasksCompleted += 1;
  }
  for (const meeting of meetings) {
    const member = membersById.get(meeting.ownerMemberId);
    if (member) ensure(member.id, member.user.displayName).meetings += 1;
  }
  const withoutNextAction = new Set(dashboard.overview.evidence.leadsWithoutNextActionIds);
  const forgotten = new Set(dashboard.overview.evidence.stalledLeadIds);
  for (const lead of alertLeads) {
    if (!lead.ownerMemberId) continue;
    const person = ensure(lead.ownerMemberId, lead.owner?.user.displayName ?? "Responsável");
    if (withoutNextAction.has(lead.id)) person.leadsWithoutNextAction += 1;
    if (forgotten.has(lead.id)) person.forgottenLeads += 1;
  }

  const rows: TeamManagementPerson[] = [...people.values()].map((person) => {
    const completion = taskCompletionPercentage(person.tasksCompleted, person.tasksTotal);
    const base = { ...person, roles: [...person.roles].sort(), taskCompletionPercentage: completion } as Omit<TeamManagementPerson, "workedQueueCorrectly">;
    return Object.freeze({ ...base, workedQueueCorrectly: workedQueueCorrectly(base) });
  }).sort((left, right) => Number(right.workedQueueCorrectly) - Number(left.workedQueueCorrectly) || right.contacts - left.contacts || left.name.localeCompare(right.name, "pt-BR"));

  const leadAlerts = alertLeads.flatMap((lead) => {
    const kinds = [
      ...(withoutNextAction.has(lead.id) ? ["WITHOUT_NEXT_ACTION" as const] : []),
      ...(forgotten.has(lead.id) ? ["FORGOTTEN" as const] : []),
    ];
    return kinds.map((kind) => Object.freeze({ id: `${lead.id}:${kind}`, name: lead.fullName, ownerName: lead.owner?.user.displayName ?? "Sem responsável", kind, href: `/leads/${lead.id}/historico` }));
  }).sort((left, right) => left.ownerName.localeCompare(right.ownerName, "pt-BR") || left.name.localeCompare(right.name, "pt-BR"));

  return Object.freeze({
    generatedAt: dashboard.overview.generatedAt,
    timeZone: dashboard.overview.period.timeZone,
    query: dashboard.query,
    people: Object.freeze(rows),
    coaching: Object.freeze(buildCoachingSuggestions(rows)),
    leadAlerts: Object.freeze(leadAlerts),
    lossReasons: dashboard.lossReasons,
    summary: Object.freeze({
      people: rows.length,
      workingQueueCorrectly: rows.filter((person) => person.workedQueueCorrectly).length,
      leadsWithoutNextAction: dashboard.overview.leadsWithoutNextAction.value,
      forgottenLeads: dashboard.overview.stalledLeads.value,
      contacts: rows.reduce((sum, person) => sum + person.contacts, 0),
      meetings: rows.reduce((sum, person) => sum + person.meetings, 0),
    }),
    definitions: Object.freeze([
      { label: "Fila correta", formula: "80% ou mais das tarefas do período concluídas, nenhum lead aberto sem próxima ação e nenhum lead acima do limite de estagnação." },
      { label: "Primeira resposta", formula: "Média do tempo entre recebimento e primeira tentativa humana nos ciclos de SLA atribuídos ao SDR." },
      { label: "Conversão SDR", formula: "Leads qualificados ÷ leads recebidos atribuídos ao SDR no período." },
      { label: "Conversão vendedor", formula: "Oportunidades ganhas ÷ oportunidades criadas para o vendedor no período." },
      { label: "Contatos", formula: "Ligações, e-mails, mensagens, reuniões e propostas registrados pelo usuário no período." },
    ]),
  });
}
