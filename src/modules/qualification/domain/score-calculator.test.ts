import { describe, expect, it } from "vitest";

import { calculateFormScore, calculatePactoScore, priorityForScore } from "@/modules/qualification/domain/score-calculator";
import type { ScoringRule } from "@/modules/qualification/domain/scoring-contracts";
import { pactoDimensions } from "@/modules/qualification/domain/pacto-contracts";

const rule: ScoringRule = Object.freeze({
  id: "00000000-0000-4000-8000-000000000001",
  key: "pacto-default",
  version: 1,
  algorithmKey: "pacto-weighted-v1",
  painMaxPoints: 25,
  capacityMaxPoints: 30,
  decisionMaxPoints: 15,
  intentMaxPoints: 20,
  contextMaxPoints: 10,
  partialFactorBasisPoints: 5_000,
  noCapacityPenalty: 30,
  noPainPenalty: 25,
  curiosityPenalty: 10,
  invalidContactPenalty: 100,
  noDecisionAccessPenalty: 15,
  capacityFullThresholdCents: 500_000n,
  p1Minimum: 70,
  p2Minimum: 40,
});

describe("score explicável", () => {
  it("respeita exatamente os limites de P1, P2 e P3", () => {
    expect(priorityForScore(100, rule)).toBe("P1");
    expect(priorityForScore(70, rule)).toBe("P1");
    expect(priorityForScore(69, rule)).toBe("P2");
    expect(priorityForScore(40, rule)).toBe("P2");
    expect(priorityForScore(39, rule)).toBe("P3");
    expect(priorityForScore(0, rule)).toBe("P3");
  });

  it("calcula o formulário de forma determinística e mostra dados ausentes", () => {
    const input = {
      interestSummary: "Dor explícita em comunicação pública",
      budgetCents: 1_200_000n,
      jobTitle: "Diretora de comunicação",
      organizationName: "Organização fictícia",
      city: "São Paulo",
      stateCode: "SP",
    };
    const first = calculateFormScore(input, rule);
    const second = calculateFormScore(input, rule);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ score: 80, priorityBandCode: "P1" });
    expect(first.components.find((item) => item.factor === "INTENT")).toMatchObject({
      points: 0,
      missingData: true,
    });
  });

  it("não transforma ausência em negativo e limita sinais negativos entre 0 e 100", () => {
    const absent = calculateFormScore({
      interestSummary: null,
      budgetCents: null,
      jobTitle: null,
      organizationName: null,
      city: null,
      stateCode: null,
    }, rule);
    expect(absent.score).toBe(0);
    expect(absent.components.every((item) => item.points >= 0)).toBe(true);

    const negative = calculateFormScore({
      interestSummary: "Apenas conhecer por curiosidade",
      budgetCents: 0n,
      jobTitle: null,
      organizationName: null,
      city: null,
      stateCode: null,
    }, rule);
    expect(negative.score).toBe(0);
    expect(negative.components.filter((item) => item.points < 0).map((item) => item.factor)).toEqual([
      "NO_CAPACITY",
      "CURIOSITY",
    ]);
    expect(negative.reason).toContain("Sinais negativos");
  });

  it("calcula PACTO validado por componentes e conserva desconhecido como lacuna", () => {
    const calculation = calculatePactoScore(
      pactoDimensions.map((dimension, index) => ({
        dimension,
        status: index === 4 ? "UNKNOWN" as const : "PARTIAL" as const,
        evidence: index === 4 ? null : `Evidência ${index}`,
      })),
      rule,
    );
    expect(calculation.score).toBe(41);
    expect(calculation.priorityBandCode).toBe("P2");
    expect(calculation.components.find((item) => item.factor === "INTENT")).toMatchObject({
      points: 0,
      missingData: true,
    });
  });

  it("a mesma versão reproduz o resultado e outra versão pode alterar pesos sem reescrever a anterior", () => {
    const input = {
      interestSummary: "Dor explícita",
      budgetCents: null,
      jobTitle: null,
      organizationName: null,
      city: null,
      stateCode: null,
    };
    const original = calculateFormScore(input, rule);
    const versionTwo: ScoringRule = {
      ...rule,
      id: "00000000-0000-4000-8000-000000000002",
      version: 2,
      painMaxPoints: 35,
      contextMaxPoints: 0,
    };
    expect(calculateFormScore(input, rule)).toEqual(original);
    expect(calculateFormScore(input, versionTwo).score).toBe(35);
    expect(original.score).toBe(25);
  });
});
