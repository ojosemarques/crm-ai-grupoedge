import type {
  PriorityBandKey,
  ScoreCalculation,
  ScoreComponent,
  ScoringRule,
} from "@/modules/qualification/domain/scoring-contracts";
import type { PactoDimensionKey, PactoStatusKey } from "@/modules/qualification/domain/pacto-contracts";

const decisionTitle = /(?:prefeit|secret[aá]ri|diretor|president|coordenador|gestor|gerente|s[oó]ci|fundador|chefe)/iu;
const curiositySignal = /(?:curiosidade|s[oó]\s+conhecer|apenas\s+conhecer|sem\s+interesse\s+agora)/iu;

function partial(maxPoints: number, basisPoints: number) {
  return Math.round((maxPoints * basisPoints) / 10_000);
}

export function priorityForScore(score: number, rule: ScoringRule): PriorityBandKey {
  if (score >= rule.p1Minimum) return "P1";
  if (score >= rule.p2Minimum) return "P2";
  return "P3";
}

function finalize(components: readonly ScoreComponent[], rule: ScoringRule): ScoreCalculation {
  const raw = components.reduce((sum, component) => sum + component.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  const positive = components.filter((item) => item.points > 0).map((item) => item.reason);
  const negative = components.filter((item) => item.points < 0).map((item) => item.reason);
  const missing = components.filter((item) => item.missingData).map((item) => item.reason);
  const reason = [
    positive.length ? `Sinais positivos: ${positive.join("; ")}.` : "Nenhum sinal positivo confirmado.",
    negative.length ? `Sinais negativos: ${negative.join("; ")}.` : "Nenhum sinal negativo explícito.",
    missing.length ? `Dados ausentes: ${missing.join("; ")}.` : "Sem lacunas nos cinco componentes.",
  ].join(" ");
  return Object.freeze({ score, priorityBandCode: priorityForScore(score, rule), reason, components });
}

export function calculateFormScore(
  input: Readonly<{
    interestSummary: string | null;
    budgetCents: bigint | null;
    jobTitle: string | null;
    organizationName: string | null;
    city: string | null;
    stateCode: string | null;
  }>,
  rule: ScoringRule,
): ScoreCalculation {
  const components: ScoreComponent[] = [];
  const interest = input.interestSummary?.trim() ?? "";
  components.push(
    interest
      ? { factor: "PAIN", points: rule.painMaxPoints, maxPoints: rule.painMaxPoints, reason: "Dor ou interesse explicitado no formulário", missingData: false, evidence: { interestSummary: interest } }
      : { factor: "PAIN", points: 0, maxPoints: rule.painMaxPoints, reason: "Dor ainda não informada", missingData: true },
  );

  if (input.budgetCents === null) {
    components.push({ factor: "CAPACITY", points: 0, maxPoints: rule.capacityMaxPoints, reason: "Capacidade ainda não informada", missingData: true });
  } else if (input.budgetCents === 0n) {
    components.push(
      { factor: "CAPACITY", points: 0, maxPoints: rule.capacityMaxPoints, reason: "Capacidade informada como zero", missingData: false, evidence: { budgetCents: "0" } },
      { factor: "NO_CAPACITY", points: -rule.noCapacityPenalty, maxPoints: 0, reason: "Sem capacidade ou perspectiva informada", missingData: false },
    );
  } else if (input.budgetCents >= rule.capacityFullThresholdCents) {
    components.push({ factor: "CAPACITY", points: rule.capacityMaxPoints, maxPoints: rule.capacityMaxPoints, reason: "Capacidade compatível com a referência atual", missingData: false, evidence: { budgetCents: input.budgetCents.toString(), thresholdCents: rule.capacityFullThresholdCents.toString() } });
  } else {
    components.push({ factor: "CAPACITY", points: partial(rule.capacityMaxPoints, rule.partialFactorBasisPoints), maxPoints: rule.capacityMaxPoints, reason: "Capacidade informada, ainda abaixo da referência atual", missingData: false, evidence: { budgetCents: input.budgetCents.toString(), thresholdCents: rule.capacityFullThresholdCents.toString() } });
  }

  const jobTitle = input.jobTitle?.trim() ?? "";
  components.push(
    !jobTitle
      ? { factor: "DECISION", points: 0, maxPoints: rule.decisionMaxPoints, reason: "Papel na decisão ainda não informado", missingData: true }
      : decisionTitle.test(jobTitle)
        ? { factor: "DECISION", points: rule.decisionMaxPoints, maxPoints: rule.decisionMaxPoints, reason: "Cargo indica decisão ou influência", missingData: false, evidence: { jobTitle } }
        : { factor: "DECISION", points: partial(rule.decisionMaxPoints, rule.partialFactorBasisPoints), maxPoints: rule.decisionMaxPoints, reason: "Atuação informada; influência ainda precisa ser validada", missingData: false, evidence: { jobTitle } },
  );
  components.push({ factor: "INTENT", points: 0, maxPoints: rule.intentMaxPoints, reason: "Intenção em até 30 dias ainda não informada", missingData: true });

  const contextSignals = [input.organizationName, input.jobTitle, input.city, input.stateCode].filter((value) => Boolean(value?.trim())).length;
  components.push(
    contextSignals === 0
      ? { factor: "CONTEXT", points: 0, maxPoints: rule.contextMaxPoints, reason: "Contexto ainda não informado", missingData: true }
      : contextSignals >= 2
        ? { factor: "CONTEXT", points: rule.contextMaxPoints, maxPoints: rule.contextMaxPoints, reason: "Contexto institucional ou operacional identificado", missingData: false, evidence: { contextSignals } }
        : { factor: "CONTEXT", points: partial(rule.contextMaxPoints, rule.partialFactorBasisPoints), maxPoints: rule.contextMaxPoints, reason: "Contexto parcialmente identificado", missingData: false, evidence: { contextSignals } },
  );
  if (interest && curiositySignal.test(interest)) {
    components.push({ factor: "CURIOSITY", points: -rule.curiosityPenalty, maxPoints: 0, reason: "Texto indica curiosidade sem intenção confirmada", missingData: false, evidence: { interestSummary: interest } });
  }
  return finalize(components, rule);
}

const dimensionFactor: Readonly<Record<PactoDimensionKey, "CONTEXT" | "PAIN" | "CAPACITY" | "DECISION" | "INTENT">> = {
  POLITICAL_CONTEXT: "CONTEXT",
  AFFLICTION: "PAIN",
  CAPACITY: "CAPACITY",
  DECISION: "DECISION",
  OPPORTUNITY_NOW: "INTENT",
};

const dimensionMaximum = (dimension: PactoDimensionKey, rule: ScoringRule) => ({
  POLITICAL_CONTEXT: rule.contextMaxPoints,
  AFFLICTION: rule.painMaxPoints,
  CAPACITY: rule.capacityMaxPoints,
  DECISION: rule.decisionMaxPoints,
  OPPORTUNITY_NOW: rule.intentMaxPoints,
})[dimension];

export function calculatePactoScore(
  dimensions: readonly Readonly<{
    dimension: PactoDimensionKey;
    status: PactoStatusKey;
    evidence: string | null;
  }>[],
  rule: ScoringRule,
): ScoreCalculation {
  const components: ScoreComponent[] = [];
  for (const dimension of dimensions) {
    const maximum = dimensionMaximum(dimension.dimension, rule);
    const label = dimension.dimension.replaceAll("_", " ").toLowerCase();
    const points = dimension.status === "POSITIVE"
      ? maximum
      : dimension.status === "PARTIAL"
        ? partial(maximum, rule.partialFactorBasisPoints)
        : 0;
    components.push({
      factor: dimensionFactor[dimension.dimension],
      points,
      maxPoints: maximum,
      reason: dimension.status === "UNKNOWN"
        ? `${label} não investigado`
        : `${label}: ${dimension.status.toLowerCase()}`,
      missingData: dimension.status === "UNKNOWN",
      ...(dimension.evidence ? { evidence: { text: dimension.evidence } } : {}),
    });
    if ((dimension.status === "NEGATIVE" || dimension.status === "DISQUALIFYING") && dimension.dimension === "AFFLICTION") {
      components.push({ factor: "NO_PAIN", points: -rule.noPainPenalty, maxPoints: 0, reason: "Ausência de dor validada pelo responsável", missingData: false });
    }
    if ((dimension.status === "NEGATIVE" || dimension.status === "DISQUALIFYING") && dimension.dimension === "CAPACITY") {
      components.push({ factor: "NO_CAPACITY", points: -rule.noCapacityPenalty, maxPoints: 0, reason: "Sem capacidade ou perspectiva validada", missingData: false });
    }
    if ((dimension.status === "NEGATIVE" || dimension.status === "DISQUALIFYING") && dimension.dimension === "DECISION") {
      components.push({ factor: "NO_DECISION_ACCESS", points: -rule.noDecisionAccessPenalty, maxPoints: 0, reason: "Sem acesso ou influência sobre o decisor", missingData: false });
    }
  }
  return finalize(components, rule);
}
