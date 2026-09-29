import type { Prisma, PrismaClient, QualificationCriterionStatus } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import {
  getAIExecutionService,
  type AIExecutionResult,
} from "@/modules/ai/application/ai-execution-service";
import {
  aiAnalysisInputSchema,
  parseAIOutput,
  type AIAnalysisInput,
  type AIValidatedOutput,
} from "@/modules/ai/domain/ai-contracts";
import {
  leadIntelligenceUseCases,
  type LeadIntelligenceInsight,
  type LeadIntelligenceProposal,
  type LeadIntelligenceReview,
  type LeadIntelligenceScreen,
  type LeadIntelligenceUseCase,
  type PactoIntelligenceProposal,
  type ScoreIntelligenceProposal,
  type TaskIntelligenceProposal,
} from "@/modules/ai/domain/lead-intelligence-contracts";
import { getOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { getLeadScoringService } from "@/modules/qualification/application/lead-scoring-service";
import { getPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import {
  pactoDimensionLabels,
  pactoDimensions,
  type PactoDimensionKey,
} from "@/modules/qualification/domain/pacto-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import type {
  AuthorizationDecision,
  ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { getPrivacyService } from "@/modules/privacy/application/privacy-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const runSchema = z
  .object({
    leadId: z.string().uuid(),
    useCase: z.enum(leadIntelligenceUseCases),
    text: z.string().trim().min(3).max(12_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.useCase === "CONVERSATION_EXTRACTION" && !value.text) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Cole uma nota ou transcrição para extrair.",
      });
    }
  });

const reviewItemSchema = z.discriminatedUnion("target", [
  z
    .object({
      target: z.literal("TASK"),
      proposalId: z.literal("task"),
      title: z.string().trim().min(2).max(200),
      dueAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      target: z.literal("SCORE"),
      proposalId: z.literal("score"),
      score: z.number().int().min(0).max(100),
      reason: z.string().trim().min(3).max(1_000),
    })
    .strict(),
  z
    .object({
      target: z.literal("PACTO"),
      proposalId: z.string().regex(/^pacto:(POLITICAL_CONTEXT|AFFLICTION|CAPACITY|DECISION|OPPORTUNITY_NOW)$/),
      status: z.enum(["POSITIVE", "PARTIAL", "NEGATIVE", "DISQUALIFYING"]),
      evidence: z.string().trim().min(2).max(5_000),
      note: z.string().trim().max(2_000).nullable().optional(),
    })
    .strict(),
]);

const reviewSchema = z
  .object({
    leadId: z.string().uuid(),
    insightId: z.string().uuid(),
    decision: z.enum(["APPLY", "REJECT"]),
    reason: z.string().trim().max(1_000).nullable().optional(),
    items: z.array(reviewItemSchema).max(7).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "APPLY" && value.items.length === 0) {
      context.addIssue({ code: "custom", path: ["items"], message: "Selecione ao menos uma proposta." });
    }
    if (value.decision === "REJECT" && (!value.reason || value.reason.length < 3)) {
      context.addIssue({ code: "custom", path: ["reason"], message: "Informe o motivo da rejeição." });
    }
    if (value.decision === "REJECT" && value.items.length > 0) {
      context.addIssue({ code: "custom", path: ["items"], message: "Uma rejeição não aplica propostas." });
    }
    const ids = value.items.map((item) => item.proposalId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: ["items"], message: "Cada proposta pode ser selecionada uma vez." });
    }
  });

type AuthorizationPort = Readonly<{
  assertAuthorized: (
    context: AuthenticatedContext,
    permissionKey: typeof PermissionKeys.AI_USE,
    resource: ResourceScope,
  ) => Promise<void>;
  authorize: (
    context: AuthenticatedContext,
    permissionKey:
      | typeof PermissionKeys.AI_USE
      | typeof PermissionKeys.LEADS_WRITE
      | typeof PermissionKeys.TASKS_WRITE,
    resource: ResourceScope,
  ) => Promise<AuthorizationDecision>;
}>;

type AIExecutionPort = Readonly<{
  execute: (
    context: AuthenticatedContext,
    request: Parameters<ReturnType<typeof getAIExecutionService>["execute"]>[1],
  ) => Promise<AIExecutionResult>;
}>;

type PactoPort = Pick<ReturnType<typeof getPactoQualificationService>, "getPacto" | "saveDraft">;
type ScoringPort = Pick<ReturnType<typeof getLeadScoringService>, "getScore" | "override">;
type OperationalPort = Pick<ReturnType<typeof getOperationalHistoryService>, "createTask">;

type LeadIntelligenceServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  execution: AIExecutionPort;
  pacto: PactoPort;
  scoring: ScoringPort;
  operations: OperationalPort;
  now: () => Date;
}>;

type LeadSnapshot = Awaited<ReturnType<typeof loadLeadSnapshot>>;
type InsightRecord = Awaited<ReturnType<typeof loadInsightRecords>>[number];

const useCaseAgent = Object.freeze({
  LEAD_ANALYSIS: "QUALIFICATION",
  CALL_PREPARATION: "CALL_PREPARATION",
  CONVERSATION_EXTRACTION: "CONVERSATION_EXTRACTION",
  NEXT_BEST_ACTION: "NEXT_BEST_ACTION",
} as const);

const agentUseCase = Object.freeze({
  QUALIFICATION: "LEAD_ANALYSIS",
  CALL_PREPARATION: "CALL_PREPARATION",
  CONVERSATION_EXTRACTION: "CONVERSATION_EXTRACTION",
  NEXT_BEST_ACTION: "NEXT_BEST_ACTION",
} as const);

const aiDimensionToDomain = Object.freeze({
  P: "POLITICAL_CONTEXT",
  A: "AFFLICTION",
  C: "CAPACITY",
  T: "DECISION",
  O: "OPPORTUNITY_NOW",
} as const);

const domainDimensionToAI = Object.freeze({
  POLITICAL_CONTEXT: "P",
  AFFLICTION: "A",
  CAPACITY: "C",
  DECISION: "T",
  OPPORTUNITY_NOW: "O",
} as const);

const aiStatusByDomain = Object.freeze({
  UNKNOWN: "NOT_INVESTIGATED",
  POSITIVE: "FAVORABLE",
  PARTIAL: "PARTIAL",
  NEGATIVE: "UNFAVORABLE",
  DISQUALIFYING: "DISQUALIFYING",
} as const);

const domainStatusByAI = Object.freeze({
  NOT_INVESTIGATED: "UNKNOWN",
  FAVORABLE: "POSITIVE",
  PARTIAL: "PARTIAL",
  UNFAVORABLE: "NEGATIVE",
  DISQUALIFYING: "DISQUALIFYING",
} as const);

function invalidInput(error: z.ZodError): never {
  throw new ApplicationError(error.issues.map((issue) => issue.message).join(" "), {
    code: "INVALID_INPUT",
    statusCode: 400,
    expose: true,
  });
}

function notFound(message = "Lead não encontrado."): never {
  throw new ApplicationError(message, { code: "NOT_FOUND", statusCode: 404, expose: true });
}

function conflict(code: string, message: string): never {
  throw new ApplicationError(message, { code, statusCode: 409, expose: true });
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function resourceForLead(workspaceId: string, lead: Readonly<{
  id: string;
  ownerMemberId: string | null;
  queueId: string | null;
  routingQueue: { teamId: string | null } | null;
  queue: { teamId: string | null } | null;
}>): ResourceScope {
  return {
    workspaceId,
    resourceType: "Lead",
    resourceId: lead.id,
    ownerMemberId: lead.ownerMemberId,
    queueId: lead.ownerMemberId ? null : lead.queueId,
    teamId: lead.ownerMemberId
      ? null
      : lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null,
  };
}

async function loadLeadScope(database: PrismaClient, workspaceId: string, leadId: string) {
  const lead = await database.lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: {
      id: true,
      ownerMemberId: true,
      queueId: true,
      routingQueue: { select: { teamId: true } },
      queue: { select: { teamId: true } },
    },
  });
  if (!lead) notFound();
  return lead;
}

async function loadLeadSnapshot(database: PrismaClient, workspaceId: string, leadId: string) {
  const lead = await database.lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: {
      id: true,
      ownerMemberId: true,
      queueId: true,
      fullName: true,
      jobTitle: true,
      organizationName: true,
      city: true,
      stateCode: true,
      interestSummary: true,
      latestInterestSummary: true,
      budgetCents: true,
      contactPreference: true,
      awaitingHumanResponse: true,
      nextActionAt: true,
      nextActionDescription: true,
      currentStage: { select: { name: true } },
      routingQueue: { select: { teamId: true } },
      queue: { select: { teamId: true } },
      currentScore: {
        select: {
          revision: true,
          leadScore: { select: { score: true, priorityBandCode: true, reason: true } },
        },
      },
      qualification: {
        select: {
          revision: true,
          assessments: {
            orderBy: { dimension: "asc" },
            select: { dimension: true, status: true, note: true, evidence: true, origin: true },
          },
        },
      },
      slaCycles: {
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { firstHumanAttemptAt: true },
      },
      activities: {
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { subject: true, description: true, occurredAt: true },
      },
      latestSource: { select: { name: true } },
      source: { select: { name: true } },
      latestCampaign: { select: { name: true } },
      campaign: { select: { name: true } },
      latestCreative: { select: { name: true } },
      creative: { select: { name: true } },
    },
  });
  if (!lead) notFound();
  return lead;
}

async function loadInsightRecords(database: PrismaClient, workspaceId: string, leadId: string) {
  return database.aIInsight.findMany({
    where: {
      workspaceId,
      leadId,
      agentType: { in: ["QUALIFICATION", "CALL_PREPARATION", "CONVERSATION_EXTRACTION", "NEXT_BEST_ACTION"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 30,
    include: {
      requestedBy: { select: { displayName: true } },
      auditLogs: {
        where: { action: { in: ["ai.insight.review_applied", "ai.insight.rejected"] } },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 1,
        include: { actor: { select: { displayName: true } } },
      },
    },
  });
}

function valueRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePersistedOutput(record: InsightRecord): AIValidatedOutput {
  const evidence = valueRecord(record.evidence);
  if (!evidence) {
    throw new ApplicationError("A recomendação persistida não possui contrato legível.", {
      code: "AI_INSIGHT_INVALID",
      statusCode: 500,
    });
  }
  return parseAIOutput(record.agentType, {
    agent: record.agentType,
    summary: evidence.summary,
    facts: record.facts,
    inferences: record.inferences,
    missingFields: record.missingData,
    evidence: evidence.evidence,
    pacto: evidence.pacto,
    questions: evidence.questions,
    score: evidence.score,
    priority: evidence.priority,
    action: evidence.action,
    alternativeAction: evidence.alternativeAction,
    urgency: evidence.urgency,
    confidence: evidence.confidence,
    risks: evidence.risks,
  });
}

function signalFor(status: QualificationCriterionStatus | undefined) {
  if (status === "POSITIVE") return "POSITIVE" as const;
  if (status === "PARTIAL") return "PARTIAL" as const;
  if (status === "NEGATIVE" || status === "DISQUALIFYING") return "NEGATIVE" as const;
  return "UNKNOWN" as const;
}

function addFact(
  facts: AIAnalysisInput["facts"],
  field: string,
  value: string | null | undefined,
  source: "FORM" | "CRM" | "ACTIVITY" | "MEETING" | "METRIC" | "HUMAN" = "CRM",
  evidence?: string | null,
) {
  const compact = value?.trim();
  if (!compact) return;
  facts.push({ field, value: compact, source, ...(evidence ? { evidence } : {}) });
}

function explicitConversationMarkers(text: string) {
  const facts: AIAnalysisInput["facts"] = [];
  const pacto = new Map<"P" | "A" | "C" | "T" | "O", string>();
  const counts = new Map<string, number>();
  const markerDefinitions = [
    { pattern: /^(?:dor|afli[cç][aã]o|problema)\s*[:\-]\s*(.+)$/i, field: "pain", dimension: "A" },
    { pattern: /^(?:capacidade|or[cç]amento)\s*[:\-]\s*(.+)$/i, field: "capacity", dimension: "C" },
    { pattern: /^(?:decisor|tomada de decis[aã]o)\s*[:\-]\s*(.+)$/i, field: "decision", dimension: "T" },
    { pattern: /^(?:urg[eê]ncia|oportunidade agora|prazo)\s*[:\-]\s*(.+)$/i, field: "intent", dimension: "O" },
    { pattern: /^(?:contexto|contexto pol[ií]tico)\s*[:\-]\s*(.+)$/i, field: "context", dimension: "P" },
    { pattern: /^obje[cç][aã]o\s*[:\-]\s*(.+)$/i, field: "objection" },
    { pattern: /^sinal de compra\s*[:\-]\s*(.+)$/i, field: "buying_signal" },
    { pattern: /^concorrente\s*[:\-]\s*(.+)$/i, field: "competitor" },
    { pattern: /^(?:pr[oó]xima a[cç][aã]o|combinado)\s*[:\-]\s*(.+)$/i, field: "agreed_next_action" },
    { pattern: /^data(?: mencionada)?\s*[:\-]\s*(.+)$/i, field: "mentioned_date" },
  ] as const;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const marker of markerDefinitions) {
      const match = line.match(marker.pattern);
      const value = match?.[1]?.trim().slice(0, 2_000);
      if (!value) continue;
      const count = (counts.get(marker.field) ?? 0) + 1;
      counts.set(marker.field, count);
      addFact(facts, `extraction.${marker.field}.${count}`, value, "ACTIVITY", value);
      addFact(facts, marker.field, value, "ACTIVITY", value);
      if ("dimension" in marker && marker.dimension && !pacto.has(marker.dimension)) {
        pacto.set(marker.dimension, value);
      }
      break;
    }
  }

  return {
    facts,
    pacto: [...pacto].map(([dimension, evidence]) => ({
      dimension,
      status: "PARTIAL" as const,
      evidence,
    })),
  };
}

function buildAIInput(snapshot: LeadSnapshot, useCase: LeadIntelligenceUseCase, text?: string) {
  const facts: AIAnalysisInput["facts"] = [];
  const interest = snapshot.interestSummary ?? snapshot.latestInterestSummary;
  addFact(facts, "full_name", snapshot.fullName);
  addFact(facts, "job_title", snapshot.jobTitle);
  addFact(facts, "organization", snapshot.organizationName);
  addFact(facts, "city", snapshot.city);
  addFact(facts, "state", snapshot.stateCode);
  addFact(facts, "pain", interest, "FORM", interest);
  addFact(
    facts,
    "capacity",
    snapshot.budgetCents === null
      ? null
      : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(snapshot.budgetCents) / 100),
    "FORM",
  );
  addFact(
    facts,
    "context",
    [snapshot.jobTitle, snapshot.organizationName, snapshot.city, snapshot.stateCode].filter(Boolean).join(" · "),
  );
  addFact(facts, "source", snapshot.latestSource?.name ?? snapshot.source.name);
  addFact(facts, "campaign", snapshot.latestCampaign?.name ?? snapshot.campaign?.name);
  addFact(facts, "creative", snapshot.latestCreative?.name ?? snapshot.creative?.name);
  addFact(facts, "stage", snapshot.currentStage.name);
  addFact(facts, "next_action", snapshot.nextActionDescription);
  addFact(facts, "last_activity", snapshot.activities[0]?.subject, "ACTIVITY", snapshot.activities[0]?.description);

  const assessmentByDimension = new Map(
    snapshot.qualification?.assessments.map((assessment) => [assessment.dimension, assessment]) ?? [],
  );
  const pacto = pactoDimensions.map((dimension) => {
    const assessment = assessmentByDimension.get(dimension);
    const field = dimension === "AFFLICTION"
      ? "pain"
      : dimension === "CAPACITY"
        ? "capacity"
        : dimension === "DECISION"
          ? "decision"
          : dimension === "OPPORTUNITY_NOW"
            ? "intent"
            : "context";
    if (assessment?.evidence) addFact(facts, field, assessment.evidence, "HUMAN", assessment.evidence);
    return {
      dimension: domainDimensionToAI[dimension],
      status: aiStatusByDomain[assessment?.status ?? "UNKNOWN"],
      ...(assessment?.evidence ? { evidence: assessment.evidence } : {}),
    };
  });

  let scoreSignals: AIAnalysisInput["scoreSignals"] = {
    pain: assessmentByDimension.has("AFFLICTION")
      ? signalFor(assessmentByDimension.get("AFFLICTION")?.status)
      : interest
        ? "PARTIAL"
        : "UNKNOWN",
    capacity: assessmentByDimension.has("CAPACITY")
      ? signalFor(assessmentByDimension.get("CAPACITY")?.status)
      : snapshot.budgetCents !== null
        ? "PARTIAL"
        : "UNKNOWN",
    decision: signalFor(assessmentByDimension.get("DECISION")?.status),
    intent: signalFor(assessmentByDimension.get("OPPORTUNITY_NOW")?.status),
    context: assessmentByDimension.has("POLITICAL_CONTEXT")
      ? signalFor(assessmentByDimension.get("POLITICAL_CONTEXT")?.status)
      : snapshot.jobTitle || snapshot.organizationName || snapshot.city
        ? "PARTIAL"
        : "UNKNOWN",
  };
  let suppliedPacto = pacto;

  if (useCase === "CONVERSATION_EXTRACTION" && text) {
    const extracted = explicitConversationMarkers(text);
    const extractionContext = facts.filter((fact) =>
      fact.field === "full_name" || fact.field === "stage",
    );
    facts.length = 0;
    facts.push(...extractionContext);
    facts.push(...extracted.facts);
    suppliedPacto = extracted.pacto;
    const extractedByDimension = new Map(extracted.pacto.map((item) => [item.dimension, item]));
    scoreSignals = {
      pain: extractedByDimension.has("A") ? "PARTIAL" : "UNKNOWN",
      capacity: extractedByDimension.has("C") ? "PARTIAL" : "UNKNOWN",
      decision: extractedByDimension.has("T") ? "PARTIAL" : "UNKNOWN",
      intent: extractedByDimension.has("O") ? "PARTIAL" : "UNKNOWN",
      context: extractedByDimension.has("P") ? "PARTIAL" : "UNKNOWN",
    };
  }

  return aiAnalysisInputSchema.parse({
    facts,
    requiredFields: ["pain", "capacity", "decision", "intent", "context"],
    scoreSignals,
    pacto: suppliedPacto,
    currentState: {
      stage: snapshot.currentStage.name,
      priority: snapshot.currentScore?.leadScore.priorityBandCode,
      score: snapshot.currentScore?.leadScore.score,
      nextAction: snapshot.nextActionDescription ?? undefined,
      nextActionDueAt: snapshot.nextActionAt?.toISOString(),
      awaitingHumanResponse: snapshot.awaitingHumanResponse,
      hasHumanAttempt: Boolean(snapshot.slaCycles[0]?.firstHumanAttemptAt),
      doNotContact:
        snapshot.contactPreference === "DO_NOT_CONTACT" ||
        snapshot.contactPreference === "NOT_CONSENTED",
    },
    ...(text ? { textExcerpt: text } : {}),
  });
}

function taskPriority(urgency: AIValidatedOutput["urgency"]): "MEDIUM" | "HIGH" | "URGENT" {
  if (urgency === "IMMEDIATE") return "URGENT";
  if (urgency === "HIGH") return "HIGH";
  return "MEDIUM";
}

function taskDueAt(createdAt: Date, urgency: AIValidatedOutput["urgency"]): string {
  const delay = urgency === "IMMEDIATE"
    ? 0
    : urgency === "HIGH"
      ? 60 * 60 * 1_000
      : urgency === "MEDIUM"
        ? 24 * 60 * 60 * 1_000
        : 3 * 24 * 60 * 60 * 1_000;
  return new Date(createdAt.getTime() + delay).toISOString();
}

function proposalsFor(
  useCase: LeadIntelligenceUseCase,
  output: AIValidatedOutput,
  snapshot: LeadSnapshot,
  createdAt: Date,
): readonly LeadIntelligenceProposal[] {
  const proposals: LeadIntelligenceProposal[] = [];
  if ((useCase === "LEAD_ANALYSIS" || useCase === "NEXT_BEST_ACTION") && output.action) {
    const task: TaskIntelligenceProposal = {
      id: "task",
      target: "TASK",
      label: "Criar próxima ação",
      currentValue: snapshot.nextActionDescription && snapshot.nextActionAt
        ? { title: snapshot.nextActionDescription, dueAt: snapshot.nextActionAt.toISOString() }
        : null,
      suggestedValue: {
        title: output.action.title,
        dueAt: taskDueAt(createdAt, output.urgency),
        kind: "FOLLOW_UP",
        priority: taskPriority(output.urgency),
        message: output.action.message,
      },
    };
    proposals.push(task);
  }

  if (useCase === "LEAD_ANALYSIS" && output.score && output.priority) {
    const current = snapshot.currentScore;
    if (!current || current.leadScore.score !== output.score.value) {
      const score: ScoreIntelligenceProposal = {
        id: "score",
        target: "SCORE",
        label: "Aplicar pontuação revisada",
        currentValue: current
          ? {
              score: current.leadScore.score,
              priority: current.leadScore.priorityBandCode,
              revision: current.revision,
            }
          : null,
        suggestedValue: {
          score: output.score.value,
          priority: output.priority,
          reason: output.score.reason,
        },
      };
      proposals.push(score);
    }
  }

  if (useCase === "CONVERSATION_EXTRACTION") {
    const currentByDimension = new Map(
      snapshot.qualification?.assessments.map((assessment) => [assessment.dimension, assessment]) ?? [],
    );
    for (const suggestion of output.pacto) {
      if (suggestion.status === "NOT_INVESTIGATED" || suggestion.evidenceIds.length === 0) continue;
      const dimension = aiDimensionToDomain[suggestion.dimension];
      const current = currentByDimension.get(dimension);
      if (current && current.status !== "UNKNOWN") continue;
      const evidence = output.evidence
        .filter((item) => suggestion.evidenceIds.includes(item.id))
        .map((item) => item.statement)
        .join("\n")
        .trim();
      if (!evidence) continue;
      const proposal: PactoIntelligenceProposal = {
        id: `pacto:${dimension}`,
        target: "PACTO",
        dimension,
        label: `Preencher ${pactoDimensionLabels[dimension]}`,
        currentValue: { status: current?.status ?? "UNKNOWN", evidence: current?.evidence ?? null },
        suggestedValue: {
          status: domainStatusByAI[suggestion.status],
          evidence,
          note: "Sugestão extraída por regra local; revisão humana obrigatória.",
        },
      };
      proposals.push(proposal);
    }
  }
  return proposals;
}

function reviewFromRecord(record: InsightRecord): LeadIntelligenceReview | null {
  const audit = record.auditLogs[0];
  if (!audit) return null;
  const changes = valueRecord(audit.changes) ?? {};
  const metadata = valueRecord(audit.metadata) ?? {};
  const decision = changes.decision;
  if (decision !== "ACCEPTED" && decision !== "PARTIALLY_ACCEPTED" && decision !== "REJECTED") {
    return null;
  }
  return {
    decision,
    reason: typeof changes.reason === "string" ? changes.reason : null,
    selectedProposalIds: Array.isArray(metadata.selectedProposalIds)
      ? metadata.selectedProposalIds.filter((item): item is string => typeof item === "string")
      : [],
    editedProposalIds: Array.isArray(metadata.editedProposalIds)
      ? metadata.editedProposalIds.filter((item): item is string => typeof item === "string")
      : [],
    reviewedBy: audit.actor.displayName,
    reviewedAt: audit.occurredAt.toISOString(),
  };
}

function insightView(record: InsightRecord, snapshot: LeadSnapshot): LeadIntelligenceInsight {
  const useCase = agentUseCase[record.agentType as keyof typeof agentUseCase];
  if (!useCase) {
    throw new ApplicationError("Tipo de recomendação não suportado no cartão do lead.", {
      code: "AI_INSIGHT_INVALID",
      statusCode: 500,
    });
  }
  const output = parsePersistedOutput(record);
  return {
    id: record.id,
    useCase,
    agent: output.agent,
    title: record.title,
    status: record.status,
    prompt: { key: record.promptKey, version: record.promptVersion },
    provider: {
      requestedKey: record.requestedProviderKey,
      key: record.providerKey,
      mode: record.providerMode,
      failureCode: record.providerFailureCode,
    },
    output,
    proposals: proposalsFor(useCase, output, snapshot, record.createdAt),
    requestedBy: record.requestedBy.displayName,
    createdAt: record.createdAt.toISOString(),
    review: reviewFromRecord(record),
  };
}

function proposalSnapshot(proposal: LeadIntelligenceProposal, applied: unknown) {
  return {
    proposalId: proposal.id,
    target: proposal.target,
    currentValue: proposal.currentValue,
    suggestedValue: proposal.suggestedValue,
    appliedValue: applied,
  };
}

export function createLeadIntelligenceService(options: LeadIntelligenceServiceOptions) {
  async function authorizedLead(context: AuthenticatedContext, leadId: string) {
    const lead = await loadLeadScope(options.database, context.workspaceId, leadId);
    const resource = resourceForLead(context.workspaceId, lead);
    await options.authorization.assertAuthorized(context, PermissionKeys.AI_USE, resource);
    return { lead, resource };
  }

  async function getScreen(
    context: AuthenticatedContext,
    payload: unknown,
  ): Promise<LeadIntelligenceScreen> {
    const parsed = z.object({ leadId: z.string().uuid() }).strict().safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    const { resource } = await authorizedLead(context, parsed.data.leadId);
    const [snapshot, records, workspace, pactoDecision, scoreDecision, taskDecision, privacy] = await Promise.all([
      loadLeadSnapshot(options.database, context.workspaceId, parsed.data.leadId),
      loadInsightRecords(options.database, context.workspaceId, parsed.data.leadId),
      options.database.workspace.findUniqueOrThrow({
        where: { id: context.workspaceId },
        select: { timeZone: true },
      }),
      options.authorization.authorize(context, PermissionKeys.LEADS_WRITE, resource),
      options.authorization.authorize(context, PermissionKeys.LEADS_WRITE, resource),
      options.authorization.authorize(context, PermissionKeys.TASKS_WRITE, resource),
      getPrivacyService().getLeadStatus(context, parsed.data.leadId, "PHONE"),
    ]);
    return Object.freeze({
      leadId: snapshot.id,
      generatedAt: options.now().toISOString(),
      timeZone: workspace.timeZone,
      modeNotice: "Modo local determinístico ativo por padrão. Nenhuma chave externa é necessária e nenhuma sugestão é aplicada automaticamente.",
      doNotContact: privacy.outcome === "DENY",
      permissions: {
        canUse: true,
        canApplyPacto: pactoDecision.allowed,
        canApplyScore: scoreDecision.allowed,
        canCreateTask: taskDecision.allowed,
      },
      insights: records.map((record) => insightView(record, snapshot)),
    });
  }

  async function run(context: AuthenticatedContext, payload: unknown) {
    const parsed = runSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    await authorizedLead(context, parsed.data.leadId);
    const snapshot = await loadLeadSnapshot(options.database, context.workspaceId, parsed.data.leadId);
    const privacy = await getPrivacyService().getLeadStatus(context, parsed.data.leadId, "PHONE");
    const input = buildAIInput(
      privacy.outcome === "DENY" ? { ...snapshot, contactPreference: "DO_NOT_CONTACT" } : snapshot,
      parsed.data.useCase,
      parsed.data.text,
    );
    const execution = await options.execution.execute(context, {
      agent: useCaseAgent[parsed.data.useCase],
      target: { type: "LEAD", id: parsed.data.leadId },
      input,
    });
    const screen = await getScreen(context, { leadId: parsed.data.leadId });
    const generated = screen.insights.find((insight) => insight.id === execution.insightId);
    return generated
      ? Object.freeze({
          ...screen,
          insights: [generated, ...screen.insights.filter((insight) => insight.id !== generated.id)],
        })
      : screen;
  }

  async function reject(
    context: AuthenticatedContext,
    input: z.output<typeof reviewSchema>,
    insight: InsightRecord,
  ) {
    const occurredAt = options.now();
    return options.database.$transaction(async (transaction) => {
      const updated = await transaction.aIInsight.updateMany({
        where: {
          id: insight.id,
          workspaceId: context.workspaceId,
          leadId: input.leadId,
          status: "OPEN",
        },
        data: {
          status: "REJECTED",
          confirmedByActorId: context.actorId,
          confirmedAt: occurredAt,
        },
      });
      if (updated.count !== 1) {
        conflict("AI_INSIGHT_ALREADY_REVIEWED", "Esta recomendação já foi revisada.");
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          aiInsightId: insight.id,
          action: "ai.insight.rejected",
          origin: "DOMAIN",
          entityType: "AIInsight",
          entityId: insight.id,
          ...(input.reason ? { reason: input.reason } : {}),
          changes: { decision: "REJECTED", reason: input.reason ?? null },
          metadata: { selectedProposalIds: [], editedProposalIds: [] },
          occurredAt,
        },
      });
      await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: input.leadId,
          type: "AI_ACTION",
          direction: "INTERNAL",
          result: "CANCELLED",
          subject: "Recomendação de IA rejeitada",
          description: input.reason ?? "Rejeição humana registrada.",
          occurredAt,
          previousValues: { insightId: insight.id, status: "OPEN" },
          newValues: { insightId: insight.id, status: "REJECTED" },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
    });
  }

  async function claimInsight(context: AuthenticatedContext, input: z.output<typeof reviewSchema>) {
    const claimedAt = options.now();
    await options.database.$transaction(async (transaction) => {
      const claimed = await transaction.aIInsight.updateMany({
        where: {
          id: input.insightId,
          workspaceId: context.workspaceId,
          leadId: input.leadId,
          status: "OPEN",
        },
        data: { status: "ACCEPTED", confirmedByActorId: context.actorId, confirmedAt: claimedAt },
      });
      if (claimed.count !== 1) {
        conflict("AI_INSIGHT_ALREADY_REVIEWED", "Esta recomendação já foi revisada.");
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          aiInsightId: input.insightId,
          action: "ai.insight.review_started",
          origin: "DOMAIN",
          entityType: "AIInsight",
          entityId: input.insightId,
          changes: { before: { status: "OPEN" }, after: { status: "ACCEPTED" } },
          metadata: { selectedProposalIds: input.items.map((item) => item.proposalId) },
          occurredAt: claimedAt,
        },
      });
    });
  }

  async function releaseFailedClaim(
    context: AuthenticatedContext,
    input: z.output<typeof reviewSchema>,
    error: unknown,
  ) {
    const occurredAt = options.now();
    await options.database.$transaction(async (transaction) => {
      await transaction.aIInsight.updateMany({
        where: {
          id: input.insightId,
          workspaceId: context.workspaceId,
          leadId: input.leadId,
          status: "ACCEPTED",
          confirmedByActorId: context.actorId,
        },
        data: { status: "OPEN", confirmedByActorId: null, confirmedAt: null },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          aiInsightId: input.insightId,
          action: "ai.insight.review_failed",
          origin: "DOMAIN",
          entityType: "AIInsight",
          entityId: input.insightId,
          changes: { before: { status: "ACCEPTED" }, after: { status: "OPEN" } },
          metadata: {
            errorCode: error instanceof ApplicationError ? error.code : "UNEXPECTED_ERROR",
            selectedProposalIds: input.items.map((item) => item.proposalId),
          },
          occurredAt,
        },
      });
    });
  }

  async function apply(
    context: AuthenticatedContext,
    input: z.output<typeof reviewSchema>,
    insight: InsightRecord,
    proposals: readonly LeadIntelligenceProposal[],
  ) {
    const proposalById = new Map<string, LeadIntelligenceProposal>(
      proposals.map((proposal) => [proposal.id, proposal]),
    );
    for (const item of input.items) {
      const proposal = proposalById.get(item.proposalId);
      if (!proposal || proposal.target !== item.target) {
        throw new ApplicationError("A proposta selecionada não pertence a esta recomendação.", {
          code: "AI_PROPOSAL_INVALID",
          statusCode: 400,
          expose: true,
        });
      }
    }

    const editedProposalIds = input.items.flatMap((item) => {
      const proposal = proposalById.get(item.proposalId)!;
      if (item.target === "TASK" && proposal.target === "TASK") {
        return proposal.suggestedValue.title === item.title &&
          proposal.suggestedValue.dueAt === item.dueAt
          ? []
          : [item.proposalId];
      }
      if (item.target === "SCORE" && proposal.target === "SCORE") {
        return proposal.suggestedValue.score === item.score &&
          proposal.suggestedValue.reason === item.reason
          ? []
          : [item.proposalId];
      }
      if (item.target === "PACTO" && proposal.target === "PACTO") {
        return sameValue(proposal.suggestedValue, {
          status: item.status,
          evidence: item.evidence,
          note: item.note ?? null,
        })
          ? []
          : [item.proposalId];
      }
      return [item.proposalId];
    });
    if (editedProposalIds.length > 0 && (!input.reason || input.reason.trim().length < 3)) {
      throw new ApplicationError("Informe o motivo das edições feitas na sugestão.", {
        code: "AI_EDIT_REASON_REQUIRED",
        statusCode: 400,
        expose: true,
      });
    }

    await claimInsight(context, input);
    const applied: Array<ReturnType<typeof proposalSnapshot>> = [];
    try {
      const pactoItems = input.items.filter((item) => item.target === "PACTO");
      if (pactoItems.length > 0) {
        const current = await options.pacto.getPacto(context, { leadId: input.leadId });
        const accepted = new Map(
          pactoItems.map((item) => [item.proposalId.replace("pacto:", "") as PactoDimensionKey, item]),
        );
        const dimensions = current.dimensions.map((dimension) => {
          const item = accepted.get(dimension.dimension);
          if (!item) {
            return {
              dimension: dimension.dimension,
              status: dimension.status,
              note: dimension.note,
              evidence: dimension.evidence,
              origin: dimension.origin as "FORM" | "SDR" | "CLOSER" | "AI" | null,
            };
          }
          return {
            dimension: dimension.dimension,
            status: item.status,
            note: item.note ?? null,
            evidence: item.evidence,
            origin: "AI" as const,
          };
        });
        await options.pacto.saveDraft(context, {
          leadId: input.leadId,
          expectedRevision: current.revision,
          dimensions,
        });
        for (const item of pactoItems) {
          const proposal = proposalById.get(item.proposalId)!;
          const appliedValue = { status: item.status, evidence: item.evidence, note: item.note ?? null };
          applied.push(proposalSnapshot(proposal, appliedValue));
        }
      }

      const scoreItem = input.items.find((item) => item.target === "SCORE");
      if (scoreItem) {
        const current = await options.scoring.getScore(context, { leadId: input.leadId });
        await options.scoring.override(context, {
          leadId: input.leadId,
          expectedRevision: current.revision,
          score: scoreItem.score,
          reason: `Sugestão ${insight.id} confirmada por ${context.displayName}. ${scoreItem.reason}`,
        });
        const proposal = proposalById.get(scoreItem.proposalId)!;
        const appliedValue = { score: scoreItem.score, reason: scoreItem.reason };
        applied.push(proposalSnapshot(proposal, appliedValue));
      }

      const taskItem = input.items.find((item) => item.target === "TASK");
      if (taskItem) {
        const proposal = proposalById.get(taskItem.proposalId)!;
        if (proposal.target !== "TASK") {
          throw new ApplicationError("Proposta de tarefa inválida.", {
            code: "AI_PROPOSAL_INVALID",
            statusCode: 400,
            expose: true,
          });
        }
        await options.operations.createTask(context, {
          leadId: input.leadId,
          title: taskItem.title,
          description: `Criada após confirmação humana da recomendação ${insight.id}.`,
          kind: proposal.suggestedValue.kind,
          priority: proposal.suggestedValue.priority,
          dueAt: taskItem.dueAt,
        });
        const appliedValue = { title: taskItem.title, dueAt: taskItem.dueAt };
        applied.push(proposalSnapshot(proposal, appliedValue));
      }
    } catch (error) {
      await releaseFailedClaim(context, input, error);
      throw error;
    }

    const decision = input.items.length === proposals.length ? "ACCEPTED" : "PARTIALLY_ACCEPTED";
    const occurredAt = options.now();
    await options.database.$transaction(async (transaction) => {
      const updated = await transaction.aIInsight.updateMany({
        where: {
          id: insight.id,
          workspaceId: context.workspaceId,
          leadId: input.leadId,
          status: "ACCEPTED",
          confirmedByActorId: context.actorId,
        },
        data: { status: "EXECUTED", confirmedAt: occurredAt },
      });
      if (updated.count !== 1) {
        conflict("AI_INSIGHT_REVIEW_LOST", "A revisão perdeu sua reserva antes da conclusão.");
      }
      await transaction.auditLog.create({
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          aiInsightId: insight.id,
          action: "ai.insight.review_applied",
          origin: "DOMAIN",
          entityType: "AIInsight",
          entityId: insight.id,
          ...(input.reason ? { reason: input.reason } : {}),
          changes: json({
            decision,
            reason: input.reason ?? null,
            applied,
          }),
          metadata: {
            selectedProposalIds: input.items.map((item) => item.proposalId),
            editedProposalIds,
          },
          occurredAt,
        },
      });
      await transaction.activity.create({
        data: {
          workspaceId: context.workspaceId,
          leadId: input.leadId,
          type: "AI_ACTION",
          direction: "INTERNAL",
          result: "COMPLETED",
          subject: decision === "ACCEPTED" ? "Recomendação de IA aceita" : "Recomendação de IA aceita parcialmente",
          description: `${input.items.length} de ${proposals.length} proposta(s) aplicada(s) por confirmação humana.`,
          occurredAt,
          previousValues: { insightId: insight.id, status: "OPEN" },
          newValues: {
            insightId: insight.id,
            status: "EXECUTED",
            decision,
            selectedProposalIds: input.items.map((item) => item.proposalId),
          },
          createdByActorId: context.actorId,
          updatedByActorId: context.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
    });
  }

  async function review(context: AuthenticatedContext, payload: unknown) {
    const parsed = reviewSchema.safeParse(payload);
    if (!parsed.success) invalidInput(parsed.error);
    await authorizedLead(context, parsed.data.leadId);
    const [snapshot, insight] = await Promise.all([
      loadLeadSnapshot(options.database, context.workspaceId, parsed.data.leadId),
      options.database.aIInsight.findFirst({
        where: {
          id: parsed.data.insightId,
          workspaceId: context.workspaceId,
          leadId: parsed.data.leadId,
        },
        include: {
          requestedBy: { select: { displayName: true } },
          auditLogs: {
            where: { action: { in: ["ai.insight.review_applied", "ai.insight.rejected"] } },
            orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            take: 1,
            include: { actor: { select: { displayName: true } } },
          },
        },
      }),
    ]);
    if (!insight) notFound("Recomendação não encontrada.");
    if (insight.status !== "OPEN") {
      conflict("AI_INSIGHT_ALREADY_REVIEWED", "Esta recomendação já foi revisada.");
    }
    const view = insightView(insight, snapshot);
    if (parsed.data.decision === "REJECT") {
      await reject(context, parsed.data, insight);
    } else {
      await apply(context, parsed.data, insight, view.proposals);
    }
    return getScreen(context, { leadId: parsed.data.leadId });
  }

  return Object.freeze({ getScreen, run, review });
}

let service: ReturnType<typeof createLeadIntelligenceService> | undefined;

export function getLeadIntelligenceService() {
  service ??= createLeadIntelligenceService({
    database: getDatabaseClient(),
    authorization: getAuthorizationService(),
    execution: getAIExecutionService(),
    pacto: getPactoQualificationService(),
    scoring: getLeadScoringService(),
    operations: getOperationalHistoryService(),
    now: () => new Date(),
  });
  return service;
}

export { explicitConversationMarkers };
