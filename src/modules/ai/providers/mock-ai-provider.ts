import {
  aiAnalysisInputSchema,
  type AIAnalysisInput,
  type AIAgentType,
  type AIValidatedOutput,
} from "@/modules/ai/domain/ai-contracts";
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResponse,
} from "@/modules/ai/providers/ai-provider";

const scoreWeights = Object.freeze({
  pain: 25,
  capacity: 30,
  decision: 15,
  intent: 20,
  context: 10,
});

const factorNames = Object.freeze({
  pain: "PAIN",
  capacity: "CAPACITY",
  decision: "DECISION",
  intent: "INTENT",
  context: "CONTEXT",
} as const);

const signalDescriptions = Object.freeze({
  UNKNOWN: "Sem dado; nenhum ponto foi inferido.",
  PARTIAL: "Sinal parcial informado no DTO.",
  POSITIVE: "Sinal favorável informado no DTO.",
  NEGATIVE: "Sinal explicitamente desfavorável informado no DTO.",
});

const agentSummaries: Readonly<Record<AIAgentType, string>> = Object.freeze({
  QUALIFICATION: "análise do lead baseada somente nos sinais estruturados fornecidos",
  CALL_PREPARATION: "briefing de ligação por template a partir dos fatos disponíveis",
  CONVERSATION_EXTRACTION: "extração local limitada aos marcadores explícitos reconhecidos",
  NEXT_BEST_ACTION: "próxima ação definida por regras do estado operacional",
  MANAGER_COPILOT: "síntese por template dos indicadores já calculados",
  AUDIT_AGENT: "explicação por template das evidências determinísticas fornecidas",
});

function pointsFor(signal: "UNKNOWN" | "PARTIAL" | "POSITIVE" | "NEGATIVE", maximum: number) {
  if (signal === "POSITIVE") return maximum;
  if (signal === "PARTIAL") return Math.floor(maximum / 2);
  return 0;
}

function deterministicScore(input: AIAnalysisInput) {
  if (!input.scoreSignals) return null;

  const components = (Object.keys(scoreWeights) as Array<keyof typeof scoreWeights>).map(
    (key) => {
      const signal = input.scoreSignals?.[key] ?? "UNKNOWN";
      const maxPoints = scoreWeights[key];
      return {
        factor: factorNames[key],
        points: pointsFor(signal, maxPoints),
        maxPoints,
        reason: signalDescriptions[signal],
        missingData: signal === "UNKNOWN",
      };
    },
  );
  const value = components.reduce((total, component) => total + component.points, 0);
  return {
    value,
    reason: `Pontuação local reproduzível: ${components
      .map(({ factor, points, maxPoints }) => `${factor} ${points}/${maxPoints}`)
      .join(", ")}.`,
    components,
  };
}

function nextAction(input: AIAnalysisInput) {
  if (input.currentState.doNotContact) {
    return {
      title: "Revisar preferência de contato",
      reason: "O registro está marcado como não contatar; nenhuma mensagem é sugerida.",
      requiresConfirmation: true as const,
      message: null,
      urgency: "HIGH" as const,
    };
  }
  if (input.currentState.awaitingHumanResponse) {
    return {
      title: "Responder o lead",
      reason: "Há resposta recebida aguardando atendimento humano.",
      requiresConfirmation: true as const,
      message: null,
      urgency: "IMMEDIATE" as const,
    };
  }
  if (input.currentState.hasHumanAttempt === false) {
    return {
      title: "Ligar agora",
      reason: "Nenhuma tentativa humana foi informada.",
      requiresConfirmation: true as const,
      message: null,
      urgency: "IMMEDIATE" as const,
    };
  }
  if (input.currentState.nextAction) {
    return {
      title: input.currentState.nextAction,
      reason: "A próxima ação já persistida deve ser executada ou revisada pela pessoa responsável.",
      requiresConfirmation: true as const,
      message: null,
      urgency: input.currentState.nextActionDueAt ? ("HIGH" as const) : ("MEDIUM" as const),
    };
  }
  return {
    title: "Definir próxima ação",
    reason: "Nenhuma próxima ação foi fornecida ao analisador.",
    requiresConfirmation: true as const,
    message: null,
    urgency: "HIGH" as const,
  };
}

function factValue(input: AIAnalysisInput, field: string): string | null {
  return input.facts.find((fact) => fact.field === field)?.value ?? null;
}

const pactoQuestions = Object.freeze({
  P: "Qual contexto político, institucional ou operacional torna esta conversa relevante?",
  A: "Qual dor precisa ser aprofundada nas palavras do lead?",
  C: "Que perspectiva de investimento pode ser investigada com respeito?",
  T: "Quem participa da decisão e qual é a influência desta pessoa?",
  O: "Existe uma janela concreta para agir agora?",
});

function questionsFor(input: AIAnalysisInput, missingFields: readonly string[]) {
  const missingPacto = (["P", "A", "C", "T", "O"] as const).filter((dimension) => {
    const current = input.pacto.find((item) => item.dimension === dimension);
    return !current || current.status === "NOT_INVESTIGATED";
  });
  const questions: string[] = missingPacto.map((dimension) => pactoQuestions[dimension]);
  for (const field of missingFields) {
    if (questions.length >= 20) break;
    const fallback = `Qual é a informação confirmada para ${field}?`;
    if (!questions.includes(fallback)) questions.push(fallback);
  }
  return questions;
}

export function buildMockAIOutput(
  agent: AIAgentType,
  rawInput: AIAnalysisInput,
): AIValidatedOutput {
  const input = aiAnalysisInputSchema.parse(rawInput);
  const suppliedFields = new Set(input.facts.map(({ field }) => field));
  const missingFields = input.requiredFields.filter((field) => !suppliedFields.has(field));
  const facts = input.facts.map((fact) => ({
    statement: `${fact.field}: ${fact.value}`,
    source: fact.source,
    evidence: fact.evidence ?? null,
  }));
  const evidence = input.facts.map((fact, index) => ({
    id: `fact-${index + 1}`,
    statement: fact.evidence ?? `${fact.field}: ${fact.value}`,
    source: fact.source,
  }));
  const pacto = (["P", "A", "C", "T", "O"] as const).map((dimension) => {
    const supplied = input.pacto.find((item) => item.dimension === dimension);
    const evidenceId = supplied?.evidence ? `pacto-${dimension}` : null;
    if (supplied?.evidence) {
      evidence.push({ id: evidenceId!, statement: supplied.evidence, source: "HUMAN" });
    }
    return {
      dimension,
      status: supplied?.status ?? ("NOT_INVESTIGATED" as const),
      evidenceIds: evidenceId ? [evidenceId] : [],
    };
  });
  const score = deterministicScore(input);
  const priority = score
    ? score.value >= 70
      ? "P1"
      : score.value >= 40
        ? "P2"
        : "P3"
    : (input.currentState.priority ?? null);
  const recommended = nextAction(input);
  const denominator = facts.length + missingFields.length;
  const confidence = denominator === 0 ? 0 : Number((facts.length / denominator).toFixed(2));
  const risks = [
    "O modo local considera somente campos persistidos e marcadores explícitos; não faz interpretação semântica aberta.",
  ];
  if (missingFields.length > 0) {
    risks.push(`${missingFields.length} campo(s) obrigatório(s) continuam ausentes.`);
  }

  let summary = `Modo local determinístico: ${agentSummaries[agent]}.`;
  let action: {
    title: string;
    reason: string;
    requiresConfirmation: true;
    message: string | null;
  } = {
    title: recommended.title,
    reason: recommended.reason,
    requiresConfirmation: true as const,
    message: recommended.message,
  };
  let questions: string[] = questionsFor(input, missingFields);

  if (agent === "QUALIFICATION") {
    const name = factValue(input, "full_name") ?? "Lead sem nome no DTO";
    summary = `${name}: ${facts.length} fato(s) disponível(is), ${missingFields.length} campo(s) ausente(s) e prioridade ${priority ?? "não calculável"}.`;
  }

  if (agent === "CALL_PREPARATION") {
    const name = factValue(input, "full_name") ?? "lead";
    const context = factValue(input, "context") ?? "Contexto ainda não confirmado.";
    const pain = factValue(input, "pain") ?? "Dor ainda não confirmada.";
    summary = [
      `Contato: ${name}.`,
      `Contexto: ${context}`,
      `Dor a aprofundar: ${pain}`,
    ].join("\n");
    questions = questionsFor(input, missingFields).slice(0, 3);
    while (questions.length < 3) {
      questions.push(pactoQuestions[("PACTO"[questions.length] ?? "O") as keyof typeof pactoQuestions]);
    }
    if (!input.currentState.doNotContact) {
      action = {
        title: "Conduzir ligação de descoberta",
        reason: "Confirmar contexto, dor e lacunas PACTO sem completar dados ausentes.",
        requiresConfirmation: true,
        message: `Olá, ${name.split(/\s+/)[0]}. Quero entender melhor seu contexto e o que motivou este contato.`,
      };
    }
    if (!factValue(input, "objection")) {
      risks.push("Objeção provável não identificada nos dados persistidos.");
    }
  }

  if (agent === "CONVERSATION_EXTRACTION") {
    const extracted = input.facts.filter((fact) => fact.field.startsWith("extraction.")).length;
    summary = extracted > 0
      ? `${extracted} marcador(es) explícito(s) extraído(s); todos exigem confirmação humana.`
      : "Nenhum marcador explícito reconhecido; o texto permanece sem interpretação local.";
    questions = extracted > 0
      ? ["Quais itens extraídos devem ser confirmados no CRM?"]
      : ["Cole notas com marcadores como Dor:, Decisor: ou Próxima ação:." ];
  }

  if (agent === "NEXT_BEST_ACTION") {
    summary = `${recommended.title}: ${recommended.reason}`;
  }

  if (agent === "MANAGER_COPILOT") {
    summary = factValue(input, "direct_answer") ?? "Não há resposta métrica disponível para esta consulta.";
    action = {
      title: factValue(input, "recommended_action") ?? "Revisar os registros relacionados",
      reason: factValue(input, "recommended_action_reason") ?? "A decisão permanece sob controle humano.",
      requiresConfirmation: true,
      message: null,
    };
    questions = [];
    risks.push("Possíveis causas apresentadas pelo Copilot são correlações determinísticas, não causalidade comprovada.");
  }

  return {
    agent,
    summary,
    facts,
    inferences: [],
    missingFields,
    evidence,
    pacto: agent === "MANAGER_COPILOT" ? [] : pacto,
    questions,
    score: agent === "MANAGER_COPILOT" ? null : score,
    priority: agent === "MANAGER_COPILOT" ? null : priority,
    action,
    alternativeAction: null,
    urgency: recommended.urgency,
    confidence,
    risks,
  } as AIValidatedOutput;
}

export class MockAIProvider implements AIProvider {
  readonly key = "mock";
  readonly mode = "LOCAL_DETERMINISTIC" as const;
  readonly engineVersion = "mock-rules-v3";

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    return {
      output: buildMockAIOutput(request.agent, request.input),
      model: null,
    };
  }
}
