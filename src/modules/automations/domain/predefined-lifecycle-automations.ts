import type {
  AutomationActionType,
  AutomationTriggerType,
  Prisma,
} from "@/generated/prisma/client";

export const LifecycleAutomationKeys = Object.freeze({
  NO_ANSWER: "crm23.no-answer",
  QUALIFIED: "crm23.qualified",
  MEETING_SCHEDULED: "crm23.meeting-scheduled",
  NO_SHOW: "crm23.no-show",
  STAGNANT: "crm23.stagnant",
  NO_NEXT_ACTION: "crm23.no-next-action",
  OPPORTUNITY_CLOSED: "crm23.opportunity-closed",
} as const);

export type LifecycleAutomationKey =
  (typeof LifecycleAutomationKeys)[keyof typeof LifecycleAutomationKeys];

export type PredefinedLifecycleAutomation = Readonly<{
  key: LifecycleAutomationKey;
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  actionType: AutomationActionType;
  conditions: Prisma.InputJsonValue;
  actionConfig: Prisma.InputJsonValue;
}>;

export const predefinedLifecycleAutomations = Object.freeze([
  {
    key: LifecycleAutomationKeys.NO_ANSWER,
    name: "6. Não atendeu",
    description:
      "Cria, nos dias configurados, tarefas de WhatsApp, ligação, e-mail, reciclagem ou revisão de encerramento para o responsável.",
    triggerType: "CALL_UNANSWERED",
    actionType: "APPLY_LIFECYCLE_AUTOMATION",
    conditions: { all: [{ path: "eventType", operator: "EQUALS", value: "NO_ANSWER_CADENCE" }] },
    actionConfig: {
      automationKey: LifecycleAutomationKeys.NO_ANSWER,
      category: "OUTREACH_CADENCE",
      simulatedOnly: true,
    },
  },
  {
    key: LifecycleAutomationKeys.QUALIFIED,
    name: "7. Qualificado",
    description:
      "Revalida PACTO, responsável e próxima ação; persiste sugestão de agenda e briefing determinístico para o closer.",
    triggerType: "LEAD_QUALIFIED",
    actionType: "APPLY_LIFECYCLE_AUTOMATION",
    conditions: { all: [{ path: "eventType", operator: "EQUALS", value: "LEAD_QUALIFIED" }] },
    actionConfig: { automationKey: LifecycleAutomationKeys.QUALIFIED, category: "QUALIFICATION" },
  },
  {
    key: LifecycleAutomationKeys.MEETING_SCHEDULED,
    name: "8. Reunião agendada",
    description:
      "Agenda lembretes simulados 24 horas, 2 horas e 15 minutos antes e invalida a revisão anterior em remarcações.",
    triggerType: "MEETING_SCHEDULED",
    actionType: "APPLY_LIFECYCLE_AUTOMATION",
    conditions: { all: [{ path: "eventType", operator: "EQUALS", value: "MEETING_REMINDER" }] },
    actionConfig: {
      automationKey: LifecycleAutomationKeys.MEETING_SCHEDULED,
      category: "MEETING_REMINDER",
      simulatedOnly: true,
    },
  },
  {
    key: LifecycleAutomationKeys.NO_SHOW,
    name: "9. No-show",
    description:
      "Confirma a tarefa de recuperação, registra mensagem sugerida simulada e sinaliza a remarcação.",
    triggerType: "MEETING_NO_SHOW",
    actionType: "APPLY_LIFECYCLE_AUTOMATION",
    conditions: { all: [{ path: "eventType", operator: "EQUALS", value: "MEETING_NO_SHOW" }] },
    actionConfig: { automationKey: LifecycleAutomationKeys.NO_SHOW, category: "MEETING_RECOVERY", simulatedOnly: true },
  },
  {
    key: LifecycleAutomationKeys.STAGNANT,
    name: "10. Lead parado",
    description:
      "Detecta deterministicamente permanência além do limite configurado e registra alerta com recomendação.",
    triggerType: "LEAD_STAGNANT",
    actionType: "APPLY_LIFECYCLE_AUTOMATION",
    conditions: { all: [{ path: "eventType", operator: "EQUALS", value: "LEAD_STAGNANT" }] },
    actionConfig: { automationKey: LifecycleAutomationKeys.STAGNANT, category: "PROCESS_HEALTH" },
  },
  {
    key: LifecycleAutomationKeys.NO_NEXT_ACTION,
    name: "11. Sem próxima ação",
    description:
      "Registra erro operacional quando um lead aberto não possui tarefa ativa como próxima ação.",
    triggerType: "LEAD_WITHOUT_NEXT_ACTION",
    actionType: "APPLY_LIFECYCLE_AUTOMATION",
    conditions: { all: [{ path: "eventType", operator: "EQUALS", value: "LEAD_WITHOUT_NEXT_ACTION" }] },
    actionConfig: { automationKey: LifecycleAutomationKeys.NO_NEXT_ACTION, category: "PROCESS_HEALTH" },
  },
  {
    key: LifecycleAutomationKeys.OPPORTUNITY_CLOSED,
    name: "12. Ganho ou perda",
    description:
      "Encerra cadências incompatíveis e prepara handoff simples no ganho ou nutrição futura na perda.",
    triggerType: "OPPORTUNITY_CLOSED",
    actionType: "APPLY_LIFECYCLE_AUTOMATION",
    conditions: { all: [{ path: "eventType", operator: "EQUALS", value: "OPPORTUNITY_CLOSED" }] },
    actionConfig: { automationKey: LifecycleAutomationKeys.OPPORTUNITY_CLOSED, category: "OPPORTUNITY_CLOSURE" },
  },
] satisfies readonly PredefinedLifecycleAutomation[]);
