export const sdrQueueBuckets = [
  "NOW",
  "NEW",
  "P1",
  "WAITING_CALL",
  "RESPONDED",
  "RETURN_TODAY",
  "OVERDUE",
  "MEETINGS_TODAY",
  "STALE_CONTACT",
  "MISSING_NEXT_ACTION",
] as const;

export type SdrQueueBucket = (typeof sdrQueueBuckets)[number];

export type SdrQueueRecommendation = Readonly<{
  code:
    | "RESPOND_NOW"
    | "CALL_NOW"
    | "EXECUTE_RETURN"
    | "CREATE_NEXT_ACTION"
    | "RECORD_MESSAGE"
    | "RECORD_EMAIL"
    | "OPEN_MEETING"
    | "OPEN_LEAD";
  label: string;
  reason: string;
  href: string;
}>;

export type SdrQueueItem = Readonly<{
  id: string;
  fullName: string;
  jobTitle: string | null;
  pain: string | null;
  priorityCode: "P1" | "P2" | "P3" | null;
  score: number | null;
  priorityReason: string | null;
  responsibleName: string;
  responsibleType: "MEMBER" | "QUEUE";
  stageName: string;
  stagePosition: number;
  receivedAt: string;
  firstHumanAttemptAt: string | null;
  slaSeconds: number | null;
  healthyMaxSeconds: number | null;
  attentionMaxSeconds: number | null;
  lastActivityAt: string;
  lastActivitySubject: string | null;
  nextActionTaskId: string | null;
  nextActionAt: string | null;
  nextActionDescription: string | null;
  nextActionKind: string | null;
  awaitingHumanResponse: boolean;
  lastInboundResponseAt: string | null;
  meetingTodayId: string | null;
  meetingTodayStartsAt: string | null;
  recommendation: SdrQueueRecommendation;
}>;

export type SdrQueueSection = Readonly<{
  key: SdrQueueBucket;
  title: string;
  description: string;
  total: number;
  drilldownHref: string;
  items: readonly SdrQueueItem[];
}>;

export type SdrQueueScreen = Readonly<{
  generatedAt: string;
  timeZone: string;
  viewer: Readonly<{
    memberId: string;
    displayName: string;
    scope: "WORKSPACE" | "TEAM" | "OWN";
  }>;
  selectedMemberId: string | null;
  sdrOptions: readonly Readonly<{
    id: string;
    name: string;
    active: boolean;
  }>[];
  dailyProduction: Readonly<{
    calls: number;
    callsPending: number;
    messages: number;
    messagesPending: number;
    emails: number;
    tasksDue: number;
    overdueFollowUps: number;
    meetingsScheduled: number;
    meetingsCompleted: number;
    staleLeads: number;
    dailyGoal: Readonly<{
      completed: number;
      target: number;
      remaining: number;
      progressPercent: number;
    }>;
  }>;
  sections: readonly SdrQueueSection[];
}>;

export type SdrQueueRecommendationInput = Pick<
  SdrQueueItem,
  | "id"
  | "awaitingHumanResponse"
  | "stagePosition"
  | "priorityCode"
  | "firstHumanAttemptAt"
  | "nextActionAt"
  | "nextActionKind"
  | "meetingTodayId"
>;

export function getSlaBand(
  seconds: number,
  healthyMaxSeconds: number,
  attentionMaxSeconds: number,
): "HEALTHY" | "ATTENTION" | "CRITICAL" {
  if (seconds <= healthyMaxSeconds) return "HEALTHY";
  if (seconds <= attentionMaxSeconds) return "ATTENTION";
  return "CRITICAL";
}

export function getOperationalRank(
  item: Pick<
    SdrQueueItem,
    "awaitingHumanResponse" | "stagePosition" | "priorityCode" | "nextActionAt"
  >,
  now: Date,
): number {
  if (item.awaitingHumanResponse) return 0;
  if (item.stagePosition === 0 && item.priorityCode === "P1") return 1;
  if (item.stagePosition === 0 && item.priorityCode === "P2") return 2;
  if (item.stagePosition === 0 && item.priorityCode === "P3") return 3;
  if (item.nextActionAt && new Date(item.nextActionAt) < now) return 4;
  return 5;
}

export function getSdrQueueRecommendation(
  item: SdrQueueRecommendationInput,
  now: Date,
): SdrQueueRecommendation {
  const historyHref = `/leads/${item.id}/historico`;
  if (item.awaitingHumanResponse) {
    return {
      code: "RESPOND_NOW",
      label: "Responder agora",
      reason: "O lead respondeu e está aguardando retorno humano.",
      href: `${historyHref}#registrar-atividade`,
    };
  }
  if (!item.nextActionAt) {
    return {
      code: "CREATE_NEXT_ACTION",
      label: "Criar próxima ação",
      reason: "Lead aberto sem próxima ação é um erro operacional.",
      href: `${historyHref}#criar-tarefa`,
    };
  }
  if (
    item.stagePosition === 0 &&
    !item.firstHumanAttemptAt &&
    item.priorityCode
  ) {
    return {
      code: "CALL_NOW",
      label: "Ligar agora",
      reason: `Lead novo ${item.priorityCode} ainda sem tentativa humana.`,
      href: `${historyHref}#registrar-atividade`,
    };
  }
  if (new Date(item.nextActionAt) < now) {
    return {
      code: "EXECUTE_RETURN",
      label: "Executar retorno",
      reason: "A próxima ação está vencida.",
      href: `${historyHref}#registrar-atividade`,
    };
  }
  if (item.nextActionKind === "IMMEDIATE_CALL" || item.nextActionKind === "CALL") {
    return {
      code: "CALL_NOW",
      label: "Registrar ligação",
      reason: "A próxima tarefa persistida é uma ligação.",
      href: `${historyHref}#registrar-atividade`,
    };
  }
  if (item.nextActionKind === "MESSAGE") {
    return {
      code: "RECORD_MESSAGE",
      label: "Registrar mensagem",
      reason: "A próxima tarefa persistida é uma mensagem.",
      href: `${historyHref}#registrar-atividade`,
    };
  }
  if (item.nextActionKind === "EMAIL") {
    return {
      code: "RECORD_EMAIL",
      label: "Registrar e-mail",
      reason: "A próxima tarefa persistida é um e-mail.",
      href: `${historyHref}#registrar-atividade`,
    };
  }
  if (item.meetingTodayId) {
    return {
      code: "OPEN_MEETING",
      label: "Ver reunião",
      reason: "Há uma reunião persistida para hoje.",
      href: `${historyHref}#tarefas`,
    };
  }
  return {
    code: "OPEN_LEAD",
    label: "Executar próxima ação",
    reason: "A recomendação segue a próxima tarefa persistida do lead.",
    href: historyHref,
  };
}
