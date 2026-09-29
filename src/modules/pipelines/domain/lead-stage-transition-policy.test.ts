import { describe, expect, it } from "vitest";

import {
  isRegularStageTransition,
  regularDestinationCodes,
  stageRequiresConfirmation,
  stageRequiresNextAction,
  stageRequiresPacto,
  statusForLeadStage,
} from "@/modules/pipelines/domain/lead-stage-transition-policy";
import { leadStageCodes } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";

describe("política de transição do pipeline de pré-vendas", () => {
  it("mantém um grafo explícito e rejeita permanência na mesma etapa", () => {
    expect(Object.fromEntries(leadStageCodes.map((code) => [code, regularDestinationCodes(code)]))).toEqual({
      NEW: ["TRYING_CONTACT", "CONNECTED", "DISQUALIFIED"],
      TRYING_CONTACT: ["CONNECTED", "NURTURING", "DISQUALIFIED"],
      CONNECTED: ["IN_QUALIFICATION", "NURTURING", "DISQUALIFIED"],
      IN_QUALIFICATION: ["CONNECTED", "QUALIFIED", "NURTURING", "DISQUALIFIED"],
      QUALIFIED: ["MEETING_SCHEDULED", "NURTURING", "DISQUALIFIED"],
      MEETING_SCHEDULED: ["QUALIFIED", "NURTURING", "DISQUALIFIED"],
      NURTURING: ["TRYING_CONTACT", "CONNECTED", "IN_QUALIFICATION", "DISQUALIFIED"],
      DISQUALIFIED: [],
    });
    for (const code of leadStageCodes) {
      expect(regularDestinationCodes(code)).not.toContain(code);
    }
    expect(isRegularStageTransition("NEW", "TRYING_CONTACT")).toBe(true);
    expect(isRegularStageTransition("NEW", "QUALIFIED")).toBe(false);
    expect(isRegularStageTransition("DISQUALIFIED", "NEW")).toBe(false);
  });

  it("preserva requisitos de PACTO, próxima ação e confirmação", () => {
    expect(stageRequiresPacto("QUALIFIED")).toBe(true);
    expect(stageRequiresPacto("MEETING_SCHEDULED")).toBe(true);
    expect(stageRequiresPacto("CONNECTED")).toBe(false);
    expect(stageRequiresNextAction("NURTURING")).toBe(true);
    expect(stageRequiresNextAction("DISQUALIFIED")).toBe(false);
    expect(stageRequiresConfirmation("QUALIFIED")).toBe(true);
    expect(stageRequiresConfirmation("DISQUALIFIED")).toBe(true);
  });

  it("projeta o estado operacional do lead pela etapa", () => {
    expect(statusForLeadStage("NEW")).toBe("OPEN");
    expect(statusForLeadStage("NURTURING")).toBe("OPEN");
    expect(statusForLeadStage("QUALIFIED")).toBe("QUALIFIED");
    expect(statusForLeadStage("MEETING_SCHEDULED")).toBe("QUALIFIED");
    expect(statusForLeadStage("DISQUALIFIED")).toBe("DISQUALIFIED");
  });
});
