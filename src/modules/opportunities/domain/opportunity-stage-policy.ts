import type { OpportunityStatus } from "@/generated/prisma/client";

export const opportunityStageCodes = [
  "MEETING_SCHEDULED",
  "MEETING_HELD",
  "OPPORTUNITY_CONFIRMED",
  "PROPOSAL",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;

export type OpportunityStageCode = (typeof opportunityStageCodes)[number];

const regularTransitions: Readonly<Record<OpportunityStageCode, readonly OpportunityStageCode[]>> = {
  MEETING_SCHEDULED: ["MEETING_HELD", "LOST"],
  MEETING_HELD: ["OPPORTUNITY_CONFIRMED", "LOST"],
  OPPORTUNITY_CONFIRMED: ["PROPOSAL", "LOST"],
  PROPOSAL: ["NEGOTIATION", "LOST"],
  NEGOTIATION: ["WON", "LOST"],
  WON: [],
  LOST: [],
};

export function isOpportunityStageCode(value: string | null): value is OpportunityStageCode {
  return value !== null && opportunityStageCodes.includes(value as OpportunityStageCode);
}

export function isRegularOpportunityTransition(
  current: OpportunityStageCode,
  target: OpportunityStageCode,
): boolean {
  return regularTransitions[current].includes(target);
}

export function opportunityStageRequiresNextAction(stage: OpportunityStageCode): boolean {
  return stage !== "WON" && stage !== "LOST";
}

export function opportunityStageRequiresOffer(stage: OpportunityStageCode): boolean {
  return stage === "PROPOSAL" || stage === "NEGOTIATION" || stage === "WON";
}

export function opportunityStageRequiresConfirmation(stage: OpportunityStageCode): boolean {
  return stage === "PROPOSAL" || stage === "WON" || stage === "LOST";
}

export function opportunityStatusForStage(stage: OpportunityStageCode): OpportunityStatus {
  if (stage === "WON") return "WON";
  if (stage === "LOST") return "LOST";
  return "OPEN";
}

export function opportunityStageLabel(stage: OpportunityStageCode): string {
  return ({
    MEETING_SCHEDULED: "Reunião agendada",
    MEETING_HELD: "Reunião realizada",
    OPPORTUNITY_CONFIRMED: "Oportunidade confirmada",
    PROPOSAL: "Proposta",
    NEGOTIATION: "Negociação",
    WON: "Ganho",
    LOST: "Perdido",
  } as const)[stage];
}
