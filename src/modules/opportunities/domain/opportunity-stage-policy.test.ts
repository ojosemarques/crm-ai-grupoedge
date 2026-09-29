import { describe, expect, it } from "vitest";

import {
  isRegularOpportunityTransition,
  opportunityStageRequiresNextAction,
  opportunityStageRequiresOffer,
  opportunityStatusForStage,
} from "@/modules/opportunities/domain/opportunity-stage-policy";

describe("política do pipeline de oportunidades", () => {
  it("permite o caminho comercial completo e perda em qualquer etapa aberta", () => {
    expect(isRegularOpportunityTransition("MEETING_SCHEDULED", "MEETING_HELD")).toBe(true);
    expect(isRegularOpportunityTransition("MEETING_HELD", "OPPORTUNITY_CONFIRMED")).toBe(true);
    expect(isRegularOpportunityTransition("OPPORTUNITY_CONFIRMED", "PROPOSAL")).toBe(true);
    expect(isRegularOpportunityTransition("PROPOSAL", "NEGOTIATION")).toBe(true);
    expect(isRegularOpportunityTransition("NEGOTIATION", "WON")).toBe(true);
    expect(isRegularOpportunityTransition("MEETING_HELD", "LOST")).toBe(true);
  });

  it("rejeita saltos e mantém ganho e perda terminais", () => {
    expect(isRegularOpportunityTransition("MEETING_SCHEDULED", "PROPOSAL")).toBe(false);
    expect(isRegularOpportunityTransition("WON", "NEGOTIATION")).toBe(false);
    expect(isRegularOpportunityTransition("LOST", "OPPORTUNITY_CONFIRMED")).toBe(false);
  });

  it("define pré-requisitos e status sem probabilidade preditiva", () => {
    expect(opportunityStageRequiresNextAction("NEGOTIATION")).toBe(true);
    expect(opportunityStageRequiresNextAction("WON")).toBe(false);
    expect(opportunityStageRequiresOffer("PROPOSAL")).toBe(true);
    expect(opportunityStageRequiresOffer("MEETING_HELD")).toBe(false);
    expect(opportunityStatusForStage("WON")).toBe("WON");
    expect(opportunityStatusForStage("LOST")).toBe("LOST");
    expect(opportunityStatusForStage("NEGOTIATION")).toBe("OPEN");
  });
});
