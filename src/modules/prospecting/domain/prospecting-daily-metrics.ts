import { PROSPECTING_CADENCE } from "@/modules/prospecting/domain/prospecting-cadence";

type ProspectingTaskResultRow = Readonly<{
  kind: string;
  result: string | null;
  count: number;
}>;

export type ProspectingTaskResultSummary = Readonly<{
  callsCompleted: number;
  callsConnected: number;
  callsCallbackRequested: number;
  callsWhatsappShared: number;
  callsNoAnswer: number;
  callsBusy: number;
  callsVoicemail: number;
  callsWrongNumber: number;
  callsChannelUnavailable: number;
  callsFailed: number;
  instagramMessagesCompleted: number;
  instagramMessagesSent: number;
  instagramMessagesProfileNotFound: number;
  instagramMessagesFailed: number;
  instagramFollowsAttempted: number;
  instagramFollowsCompleted: number;
  instagramFollowsAlreadyFollowing: number;
  instagramFollowsProfileNotFound: number;
  instagramFollowsFailed: number;
}>;

export type ProspectingDailyActionRow = Readonly<{
  stepKey: string;
  action: string;
  completed: number;
  pending: number;
}>;

export type ProspectingDailyAction = Readonly<{
  key: string;
  label: string;
  kind: "CALL" | "INSTAGRAM_MESSAGE" | "INSTAGRAM_FOLLOW" | "FOLLOW_UP";
  dayNumber: number | null;
  planned: number;
  completed: number;
  pending: number;
}>;

const manualCadenceSteps = PROSPECTING_CADENCE.filter((step) => step.executor === "SELLER");
const cadenceStepByKey = new Map(manualCadenceSteps.map((step, index) => [step.stepKey, { ...step, index }]));

function actionLabel(stepKey: string, action: ProspectingDailyAction["kind"]): string {
  if (action === "FOLLOW_UP") return "Retornos";
  const sequence = stepKey.match(/-(\d+)$/)?.[1];
  if (action === "CALL") return sequence ? `Ligação ${sequence}` : "Ligação";
  if (action === "INSTAGRAM_MESSAGE") return sequence ? `Mensagem no Instagram ${sequence}` : "Mensagem no Instagram";
  return "Seguir no Instagram";
}

export function buildProspectingDailyActionPlan(
  rows: readonly ProspectingDailyActionRow[],
): readonly ProspectingDailyAction[] {
  const supportedKinds = new Set<ProspectingDailyAction["kind"]>([
    "CALL",
    "INSTAGRAM_MESSAGE",
    "INSTAGRAM_FOLLOW",
    "FOLLOW_UP",
  ]);

  return rows
    .filter((row) => supportedKinds.has(row.action as ProspectingDailyAction["kind"]))
    .map((row) => {
      const kind = row.action as ProspectingDailyAction["kind"];
      const cadenceStep = cadenceStepByKey.get(row.stepKey);
      return {
        key: row.stepKey,
        label: actionLabel(row.stepKey, kind),
        kind,
        dayNumber: cadenceStep?.dayNumber ?? null,
        planned: row.completed + row.pending,
        completed: row.completed,
        pending: row.pending,
        order: kind === "FOLLOW_UP" ? -1 : cadenceStep?.index ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .filter((item) => item.planned > 0)
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, "pt-BR"))
    .map((item) => Object.freeze({
      key: item.key,
      label: item.label,
      kind: item.kind,
      dayNumber: item.dayNumber,
      planned: item.planned,
      completed: item.completed,
      pending: item.pending,
    }));
}

export function summarizeProspectingTaskResults(
  rows: readonly ProspectingTaskResultRow[],
): ProspectingTaskResultSummary {
  const count = (kind: string, results?: readonly string[]) => rows
    .filter((row) => row.kind === kind && (!results || (row.result !== null && results.includes(row.result))))
    .reduce((total, row) => total + row.count, 0);

  const callsWrongNumber = count("CALL", ["WRONG_NUMBER"]);
  const callsChannelUnavailable = count("CALL", ["CHANNEL_UNAVAILABLE"]);
  const instagramMessagesFailed = count("INSTAGRAM_MESSAGE", ["FAILED", "CHANNEL_UNAVAILABLE"]);
  const instagramFollowsFailed = count("INSTAGRAM_FOLLOW", ["FAILED", "CHANNEL_UNAVAILABLE"]);

  return Object.freeze({
    callsCompleted: count("CALL"),
    callsConnected: count("CALL", ["CONNECTED", "CALLBACK_REQUESTED", "WHATSAPP_SHARED"]),
    callsCallbackRequested: count("CALL", ["CALLBACK_REQUESTED"]),
    callsWhatsappShared: count("CALL", ["WHATSAPP_SHARED"]),
    callsNoAnswer: count("CALL", ["NO_ANSWER"]),
    callsBusy: count("CALL", ["BUSY"]),
    callsVoicemail: count("CALL", ["VOICEMAIL"]),
    callsWrongNumber,
    callsChannelUnavailable,
    callsFailed: callsWrongNumber + callsChannelUnavailable,
    instagramMessagesCompleted: count("INSTAGRAM_MESSAGE"),
    instagramMessagesSent: count("INSTAGRAM_MESSAGE", ["SENT"]),
    instagramMessagesProfileNotFound: count("INSTAGRAM_MESSAGE", ["PROFILE_NOT_FOUND"]),
    instagramMessagesFailed,
    instagramFollowsAttempted: count("INSTAGRAM_FOLLOW"),
    instagramFollowsCompleted: count("INSTAGRAM_FOLLOW", ["COMPLETED"]),
    instagramFollowsAlreadyFollowing: count("INSTAGRAM_FOLLOW", ["ALREADY_FOLLOWING"]),
    instagramFollowsProfileNotFound: count("INSTAGRAM_FOLLOW", ["PROFILE_NOT_FOUND"]),
    instagramFollowsFailed,
  });
}
