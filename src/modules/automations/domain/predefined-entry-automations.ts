import type {
  AutomationActionType,
  AutomationTriggerType,
  Prisma,
} from "@/generated/prisma/client";

export const EntryAutomationKeys = Object.freeze({
  LEAD_RECEIVED: "crm22.lead-received",
  DUPLICATE: "crm22.duplicate",
  P1: "crm22.p1",
  SLA_LATE: "crm22.sla-late",
  LEAD_REPLIED: "crm22.lead-replied",
} as const);

export type EntryAutomationKey =
  (typeof EntryAutomationKeys)[keyof typeof EntryAutomationKeys];

export type PredefinedEntryAutomation = Readonly<{
  key: EntryAutomationKey;
  name: string;
  description: string;
  triggerType: AutomationTriggerType;
  actionType: AutomationActionType;
  conditions: Prisma.InputJsonValue;
  actionConfig: Prisma.InputJsonValue;
}>;

export const predefinedEntryAutomations = Object.freeze([
  {
    key: EntryAutomationKeys.LEAD_RECEIVED,
    name: "1. Lead recebido",
    description:
      "Confirma os artefatos transacionais da entrada e cria notificação e mensagem automática simulada.",
    triggerType: "LEAD_CREATED",
    actionType: "APPLY_ENTRY_AUTOMATION",
    conditions: {
      all: [{ path: "outcome", operator: "EQUALS", value: "CREATED" }],
    },
    actionConfig: {
      automationKey: EntryAutomationKeys.LEAD_RECEIVED,
      category: "ENTRY",
    },
  },
  {
    key: EntryAutomationKeys.DUPLICATE,
    name: "2. Duplicado",
    description:
      "Confirma a submissão anexada, alerta o responsável e expõe a revisão humana sem mesclar dados.",
    triggerType: "LEAD_CREATED",
    actionType: "APPLY_ENTRY_AUTOMATION",
    conditions: {
      all: [{ path: "outcome", operator: "EQUALS", value: "ATTACHED" }],
    },
    actionConfig: {
      automationKey: EntryAutomationKeys.DUPLICATE,
      category: "ENTRY",
    },
  },
  {
    key: EntryAutomationKeys.P1,
    name: "3. P1",
    description:
      "Destaca a prioridade explicável, notifica o SDR e escala ao gestor quando não há tentativa em 60 segundos.",
    triggerType: "LEAD_UPDATED",
    actionType: "APPLY_ENTRY_AUTOMATION",
    conditions: {
      all: [
        { path: "eventType", operator: "EQUALS", value: "PRIORITY_P1" },
        { path: "priorityBandCode", operator: "EQUALS", value: "P1" },
      ],
    },
    actionConfig: {
      automationKey: EntryAutomationKeys.P1,
      category: "ENTRY",
    },
  },
  {
    key: EntryAutomationKeys.SLA_LATE,
    name: "4. SLA atrasado",
    description:
      "Registra atenção em 60 segundos e criticidade em 180 segundos quando não existe tentativa humana.",
    triggerType: "SLA_BREACHED",
    actionType: "APPLY_ENTRY_AUTOMATION",
    conditions: {
      all: [{ path: "eventType", operator: "EQUALS", value: "SLA_CHECK" }],
    },
    actionConfig: {
      automationKey: EntryAutomationKeys.SLA_LATE,
      category: "ENTRY",
    },
  },
  {
    key: EntryAutomationKeys.LEAD_REPLIED,
    name: "5. Lead respondeu",
    description:
      "Mantém a resposta no topo operacional, garante Ligar agora e suspende cadências incompatíveis.",
    triggerType: "LEAD_UPDATED",
    actionType: "APPLY_ENTRY_AUTOMATION",
    conditions: {
      all: [{ path: "eventType", operator: "EQUALS", value: "LEAD_REPLIED" }],
    },
    actionConfig: {
      automationKey: EntryAutomationKeys.LEAD_REPLIED,
      category: "ENTRY",
    },
  },
] satisfies readonly PredefinedEntryAutomation[]);
