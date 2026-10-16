import type { LeadStatus } from "@/generated/prisma/client";
import type { LeadStageCode } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";

const regularTransitions: Readonly<Record<LeadStageCode, readonly LeadStageCode[]>> = {
  NEW: ["TRYING_CONTACT", "CONNECTED", "DISQUALIFIED"],
  TRYING_CONTACT: ["CONNECTED", "NURTURING", "DISQUALIFIED"],
  CONNECTED: ["IN_QUALIFICATION", "NURTURING", "DISQUALIFIED"],
  IN_QUALIFICATION: ["CONNECTED", "QUALIFIED", "NURTURING", "DISQUALIFIED"],
  QUALIFIED: ["MEETING_SCHEDULED", "NURTURING", "DISQUALIFIED"],
  MEETING_SCHEDULED: ["QUALIFIED", "NURTURING", "DISQUALIFIED"],
  MEETING_NO_SHOW: ["MEETING_SCHEDULED", "MEETING_COMPLETED"],
  MEETING_COMPLETED: ["MEETING_SCHEDULED", "MEETING_NO_SHOW"],
  NURTURING: ["TRYING_CONTACT", "CONNECTED", "IN_QUALIFICATION", "DISQUALIFIED"],
  DISQUALIFIED: [],
};

export function regularDestinationCodes(current: LeadStageCode): readonly LeadStageCode[] {
  return regularTransitions[current];
}

export function isRegularStageTransition(
  current: LeadStageCode,
  target: LeadStageCode,
): boolean {
  return regularTransitions[current].includes(target);
}

export function stageRequiresPacto(target: LeadStageCode): boolean {
  return target === "QUALIFIED" || target === "MEETING_SCHEDULED";
}

export function stageRequiresNextAction(target: LeadStageCode): boolean {
  return target !== "DISQUALIFIED";
}

export function stageRequiresConfirmation(target: LeadStageCode): boolean {
  return target === "QUALIFIED" || target === "MEETING_SCHEDULED" || target === "DISQUALIFIED";
}

export function statusForLeadStage(target: LeadStageCode): LeadStatus {
  if (target === "DISQUALIFIED") return "DISQUALIFIED";
  if (["QUALIFIED", "MEETING_SCHEDULED", "MEETING_NO_SHOW", "MEETING_COMPLETED"].includes(target)) return "QUALIFIED";
  return "OPEN";
}
