import { createHash } from "node:crypto";

import {
  Prisma,
  type AutomationActionType,
  type AutomationTriggerType,
  type LeadPriority,
  type LeadStatus,
  type MeetingStatus,
  type OpportunityStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import {
  assertDemoSeedEnvironment,
  DEMO_WORKSPACE_SLUG,
} from "@/modules/settings/application/demo-seed-service";
import type {
  AIAnalysisInput,
  AIAgentType,
} from "@/modules/ai/domain/ai-contracts";
import { buildMockAIOutput } from "@/modules/ai/providers/mock-ai-provider";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const CRM29_DEMO_DATASET_VERSION = 1;
export const CRM29_DEMO_LEAD_COUNT = 320;
export const CRM29_DEMO_NAMESPACE = "crm29-demo-v1";
export const CRM29_DEMO_TAG_NAME = "Demonstração CRM-29";

const dayMs = 24 * 60 * 60 * 1_000;
const minuteMs = 60 * 1_000;
const dimensions = [
  "POLITICAL_CONTEXT",
  "AFFLICTION",
  "CAPACITY",
  "DECISION",
  "OPPORTUNITY_NOW",
] as const;
const dimensionLabels = [
  "contexto político compatível",
  "dor operacional explícita",
  "capacidade compatível",
  "acesso à decisão",
  "oportunidade nos próximos 30 dias",
] as const;
const locations = [
  ["São Paulo", "SP"],
  ["Campinas", "SP"],
  ["Rio de Janeiro", "RJ"],
  ["Belo Horizonte", "MG"],
  ["Curitiba", "PR"],
  ["Porto Alegre", "RS"],
  ["Salvador", "BA"],
  ["Recife", "PE"],
  ["Fortaleza", "CE"],
  ["Goiânia", "GO"],
] as const;
const jobTitles = [
  "Assessor(a) de comunicação",
  "Coordenador(a) institucional",
  "Consultor(a) político(a)",
  "Diretor(a) de estratégia",
  "Empreendedor(a)",
  "Gestor(a) de projetos",
] as const;
const fictionalOrganizations = [
  "Instituto Horizonte Fictício",
  "Projeto Ponte de Ideias",
  "Núcleo Cidadania Laboratório",
  "Coletivo Rumo Público",
  "Rede Aurora Experimental",
  "Organização Farol de Testes",
] as const;
const interests = [
  "Organizar o processo comercial permanente",
  "Melhorar posicionamento e comunicação institucional",
  "Estruturar diagnóstico e prioridades de atuação",
  "Criar uma rotina previsível de relacionamento",
] as const;

type SeedOptions = Readonly<{ now?: Date }>;

export type Crm29DemoSeedResult = Readonly<{
  workspaceId: string;
  namespace: string;
  anchoredAt: string;
  leads: number;
  submissions: number;
  duplicateSubmissions: number;
  tasks: number;
  activities: number;
  qualifications: number;
  stageHistories: number;
  meetings: number;
  noShows: number;
  cancelledMeetings: number;
  opportunities: number;
  wins: number;
  losses: number;
  automationRuns: number;
  aiInsights: number;
  auditLogs: number;
}>;

type References = Readonly<{
  workspaceId: string;
  systemActorId: string;
  automationActorId: string;
  aiActorId: string;
  sdrMemberIds: readonly string[];
  sdrActorIds: readonly string[];
  closerMemberIds: readonly string[];
  generalQueueId: string;
  preSalesPipelineId: string;
  preSalesStages: ReadonlyMap<string, string>;
  salesPipelineId: string;
  salesStages: ReadonlyMap<string, string>;
  sourceIds: ReadonlyMap<string, string>;
  campaignIds: readonly string[];
  creativeIdsByCampaign: ReadonlyMap<string, readonly string[]>;
  priorityBandIds: ReadonlyMap<string, string>;
  scoringRuleVersionId: string;
  productIds: readonly string[];
  offerTemplateIdsByProduct: ReadonlyMap<string, string>;
  lossReasonIds: readonly string[];
  disqualificationReasonIds: readonly string[];
  automationRules: readonly Readonly<{
    id: string;
    version: number;
    triggerType: AutomationTriggerType;
    actionType: AutomationActionType;
    conditions: Prisma.InputJsonValue;
    actionConfig: Prisma.InputJsonValue;
  }>[];
}>;

type LeadPlan = Readonly<{
  ordinal: number;
  id: string;
  receivedAt: Date;
  sourceId: string;
  campaignId: string | null;
  creativeId: string | null;
  ownerMemberId: string | null;
  queueId: string | null;
  actorId: string;
  stageCode: string;
  stageSequence: readonly string[];
  status: LeadStatus;
  priorityBandCode: "P1" | "P2" | "P3";
  leadPriority: LeadPriority;
  score: number;
  attemptSeconds: number | null;
  connectedSeconds: number | null;
  respondedAt: Date | null;
  isDuplicate: boolean;
  lacksNextAction: boolean;
  isStagnant: boolean;
  lastActivityAt: Date;
}>;

type DemoAIInsightContent = Readonly<{
  agentType: AIAgentType;
  promptKey: string;
  confidenceBps: number;
  recommendation: string;
  explanation: string;
  facts: Prisma.InputJsonValue;
  inferences: Prisma.InputJsonValue;
  missingData: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue;
}>;

type MeetingPlan = Readonly<{
  ordinal: number;
  id: string;
  lead: LeadPlan;
  ownerMemberId: string;
  startsAt: Date;
  endsAt: Date;
  status: MeetingStatus;
  revision: number;
  terminalAt: Date | null;
}>;

type OpportunityPlan = Readonly<{
  ordinal: number;
  id: string;
  lead: LeadPlan;
  meeting: MeetingPlan;
  ownerMemberId: string;
  productId: string;
  currentStageCode: string;
  stageSequence: readonly string[];
  status: OpportunityStatus;
  createdAt: Date;
  closedAt: Date | null;
  amountCents: bigint;
  mrrCents: bigint;
  tcvCents: bigint;
  lossReasonId: string | null;
}>;

function stableId(key: string): string {
  const hash = createHash("sha256")
    .update(`politizai:${CRM29_DEMO_NAMESPACE}:${key}`)
    .digest("hex")
    .split("");
  hash[12] = "5";
  hash[16] = ((Number.parseInt(hash[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function fingerprint(key: string): string {
  return createHash("sha256").update(`${CRM29_DEMO_NAMESPACE}:${key}`).digest("hex");
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function atSecondPrecision(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1_000) * 1_000);
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function betweenStartAndAnchor(start: Date, desiredMilliseconds: number, anchor: Date): Date {
  const available = Math.max(2_000, anchor.getTime() - start.getTime() - 1_000);
  return addMilliseconds(start, Math.min(desiredMilliseconds, Math.max(1_000, Math.floor(available / 2))));
}

function startOfTomorrowInSaoPaulo(now: Date): Date {
  const local = new Date(now.getTime() - 3 * 60 * 60 * 1_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, 3));
}

function stageCodeForOrdinal(ordinal: number): string {
  const position = (ordinal - 1) % 32;
  if (position < 6) return "NEW";
  if (position < 12) return "TRYING_CONTACT";
  if (position < 16) return "CONNECTED";
  if (position < 20) return "IN_QUALIFICATION";
  if (position < 23) return "QUALIFIED";
  if (position < 26) return "MEETING_SCHEDULED";
  if (position < 29) return "NURTURING";
  return "DISQUALIFIED";
}

function leadStageSequence(code: string): readonly string[] {
  const sequences: Record<string, readonly string[]> = {
    NEW: ["NEW"],
    TRYING_CONTACT: ["NEW", "TRYING_CONTACT"],
    CONNECTED: ["NEW", "CONNECTED"],
    IN_QUALIFICATION: ["NEW", "CONNECTED", "IN_QUALIFICATION"],
    QUALIFIED: ["NEW", "CONNECTED", "IN_QUALIFICATION", "QUALIFIED"],
    MEETING_SCHEDULED: ["NEW", "CONNECTED", "IN_QUALIFICATION", "QUALIFIED", "MEETING_SCHEDULED"],
    NURTURING: ["NEW", "TRYING_CONTACT", "NURTURING"],
    DISQUALIFIED: ["NEW", "DISQUALIFIED"],
  };
  const sequence = sequences[code];
  if (!sequence) throw new Error(`Etapa de demonstração desconhecida: ${code}`);
  return sequence;
}

function priorityForOrdinal(ordinal: number): Readonly<{
  band: "P1" | "P2" | "P3";
  priority: LeadPriority;
  score: number;
}> {
  const position = (ordinal - 1) % 16;
  if (position < 4) return { band: "P1", priority: "URGENT", score: 78 + (ordinal % 20) };
  if (position < 11) return { band: "P2", priority: "HIGH", score: 45 + (ordinal % 24) };
  return { band: "P3", priority: "MEDIUM", score: 15 + (ordinal % 25) };
}

function splitScore(score: number): readonly number[] {
  const maximums = [25, 30, 15, 20, 10] as const;
  let remaining = score;
  return maximums.map((maximum) => {
    const points = Math.min(maximum, remaining);
    remaining -= points;
    return points;
  });
}

function requiredMapValue(map: ReadonlyMap<string, string>, key: string, label: string): string {
  const value = map.get(key);
  if (!value) throw new Error(`${label} ausente: ${key}`);
  return value;
}

async function resolveReferences(transaction: Prisma.TransactionClient): Promise<References> {
  const workspace = await transaction.workspace.findUnique({
    where: { slug: DEMO_WORKSPACE_SLUG },
    select: { id: true },
  });
  if (!workspace) {
    throw new ApplicationError("Execute o seed estrutural antes da base CRM-29.", {
      code: "CRM29_STRUCTURE_REQUIRED",
      statusCode: 409,
      expose: true,
    });
  }

  const actors = await transaction.actor.findMany({ where: { workspaceId: workspace.id }, select: { id: true, key: true, userId: true } });
  const members = await transaction.workspaceMember.findMany({
      where: { workspaceId: workspace.id, status: "ACTIVE", deletedAt: null },
      include: { user: { select: { normalizedEmail: true } } },
    });
  const pipelines = await transaction.pipeline.findMany({
      where: { workspaceId: workspace.id, deletedAt: null, isDefault: true },
      include: { stages: { where: { deletedAt: null } } },
    });
  const sources = await transaction.leadSource.findMany({ where: { workspaceId: workspace.id, deletedAt: null }, select: { id: true, key: true } });
  const campaigns = await transaction.acquisitionCampaign.findMany({
      where: { workspaceId: workspace.id, externalRef: { startsWith: "demo:campaign:" }, deletedAt: null },
      include: { creatives: { where: { deletedAt: null }, select: { id: true } } },
      orderBy: { externalRef: "asc" },
    });
  const priorityBands = await transaction.leadPriorityBand.findMany({ where: { workspaceId: workspace.id, deletedAt: null }, select: { id: true, code: true } });
  const scoringRule = await transaction.scoringRuleVersion.findFirstOrThrow({ where: { workspaceId: workspace.id, active: true }, orderBy: { version: "desc" }, select: { id: true } });
  const products = await transaction.product.findMany({ where: { workspaceId: workspace.id, active: true, deletedAt: null }, orderBy: { sku: "asc" }, select: { id: true } });
  const templates = await transaction.offerTemplate.findMany({ where: { workspaceId: workspace.id, active: true, deletedAt: null }, orderBy: { key: "asc" }, select: { id: true, productId: true } });
  const lossReasons = await transaction.lossReason.findMany({ where: { workspaceId: workspace.id, active: true, deletedAt: null }, orderBy: { position: "asc" }, select: { id: true } });
  const disqualificationReasons = await transaction.disqualificationReason.findMany({ where: { workspaceId: workspace.id, active: true, deletedAt: null }, orderBy: { position: "asc" }, select: { id: true } });
  const generalQueue = await transaction.queue.findFirstOrThrow({ where: { workspaceId: workspace.id, isGeneral: true, deletedAt: null }, select: { id: true } });
  const automationRules = await transaction.automationRule.findMany({ where: { workspaceId: workspace.id, isPredefined: true, deletedAt: null }, orderBy: { key: "asc" } });

  const actorByKey = new Map(actors.map((actor) => [actor.key, actor.id]));
  const actorByUserId = new Map(actors.flatMap((actor) => actor.userId ? [[actor.userId, actor.id] as const] : []));
  const memberByEmail = new Map(members.map((member) => [member.user.normalizedEmail, member]));
  const sdrEmails = ["sdr1@demo.politizai.local", "sdr2@demo.politizai.local", "sdr3@demo.politizai.local"];
  const closerEmails = ["closer1@demo.politizai.local", "closer2@demo.politizai.local"];
  const sdrMembers = sdrEmails.map((email) => memberByEmail.get(email)).filter((member): member is NonNullable<typeof member> => Boolean(member));
  const closerMembers = closerEmails.map((email) => memberByEmail.get(email)).filter((member): member is NonNullable<typeof member> => Boolean(member));
  const preSales = pipelines.find((pipeline) => pipeline.entityType === "LEAD");
  const sales = pipelines.find((pipeline) => pipeline.entityType === "OPPORTUNITY");

  if (!preSales || !sales || sdrMembers.length !== 3 || closerMembers.length !== 2 || campaigns.length < 2 || products.length < 3 || automationRules.length < 12) {
    throw new ApplicationError("A estrutura local está incompleta para a base CRM-29.", {
      code: "CRM29_STRUCTURE_INCOMPLETE",
      statusCode: 409,
      expose: true,
    });
  }

  const systemActorId = actorByKey.get("system");
  const automationActorId = actorByKey.get("automation:local");
  const aiActorId = actorByKey.get("ai:recommendation");
  if (!systemActorId || !automationActorId || !aiActorId) throw new Error("Atores estruturais ausentes.");

  return Object.freeze({
    workspaceId: workspace.id,
    systemActorId,
    automationActorId,
    aiActorId,
    sdrMemberIds: sdrMembers.map(({ id }) => id),
    sdrActorIds: sdrMembers.map((member) => actorByUserId.get(member.userId) ?? systemActorId),
    closerMemberIds: closerMembers.map(({ id }) => id),
    generalQueueId: generalQueue.id,
    preSalesPipelineId: preSales.id,
    preSalesStages: new Map(preSales.stages.flatMap((stage) => stage.leadStageCode ? [[stage.leadStageCode, stage.id] as const] : [])),
    salesPipelineId: sales.id,
    salesStages: new Map(sales.stages.flatMap((stage) => stage.opportunityStageCode ? [[stage.opportunityStageCode, stage.id] as const] : [])),
    sourceIds: new Map(sources.map((source) => [source.key, source.id])),
    campaignIds: campaigns.map(({ id }) => id),
    creativeIdsByCampaign: new Map(campaigns.map((campaign) => [campaign.id, campaign.creatives.map(({ id }) => id)])),
    priorityBandIds: new Map(priorityBands.map((band) => [band.code, band.id])),
    scoringRuleVersionId: scoringRule.id,
    productIds: products.map(({ id }) => id),
    offerTemplateIdsByProduct: new Map(templates.map((template) => [template.productId, template.id])),
    lossReasonIds: lossReasons.map(({ id }) => id),
    disqualificationReasonIds: disqualificationReasons.map(({ id }) => id),
    automationRules: automationRules.map((rule) => ({
      id: rule.id,
      version: rule.version,
      triggerType: rule.triggerType,
      actionType: rule.actionType,
      conditions: rule.conditions as Prisma.InputJsonValue,
      actionConfig: rule.actionConfig as Prisma.InputJsonValue,
    })),
  });
}

function buildLeadPlans(references: References, anchor: Date): LeadPlan[] {
  const sourceKeys = ["manual", "website", "referral", "paid-media", "organic"] as const;
  return Array.from({ length: CRM29_DEMO_LEAD_COUNT }, (_, index) => {
    const ordinal = index + 1;
    const ageDays = index % 30;
    const receivedAt = addMilliseconds(anchor, -(ageDays * dayMs + ((index % 10) + 1) * 60 * minuteMs));
    const priority = priorityForOrdinal(ordinal);
    const stageCode = stageCodeForOrdinal(ordinal);
    const queueAssigned = ordinal % 40 === 0;
    const noAttempt = queueAssigned || ordinal % 4 === 0;
    const attemptSeconds = noAttempt ? null : ordinal % 4 === 1 ? 30 : ordinal % 4 === 2 ? 120 : 300;
    const connectedSeconds = attemptSeconds !== null && ordinal % 3 !== 0 ? attemptSeconds + 15 : null;
    const respondedAt = ordinal % 17 === 0 ? addMilliseconds(receivedAt, 20 * minuteMs) : null;
    const sourceKey = sourceKeys[index % sourceKeys.length]!;
    const paid = sourceKey === "paid-media";
    const paidOrdinal = Math.floor(index / sourceKeys.length);
    const campaignId = paid ? references.campaignIds[paidOrdinal % references.campaignIds.length]! : null;
    const creatives = campaignId ? references.creativeIdsByCampaign.get(campaignId) ?? [] : [];
    const creativeId = campaignId ? creatives[Math.floor(paidOrdinal / references.campaignIds.length) % creatives.length] ?? null : null;
    const ownerIndex = index % references.sdrMemberIds.length;
    const lastOperationalAt = connectedSeconds !== null
      ? addMilliseconds(receivedAt, connectedSeconds * 1_000)
      : attemptSeconds !== null
        ? addMilliseconds(receivedAt, attemptSeconds * 1_000)
        : receivedAt;
    const lastActivityAt = respondedAt && respondedAt > lastOperationalAt ? respondedAt : lastOperationalAt;
    const open = stageCode !== "DISQUALIFIED";
    return Object.freeze({
      ordinal,
      id: stableId(`lead:${ordinal}`),
      receivedAt,
      sourceId: requiredMapValue(references.sourceIds, sourceKey, "Origem estrutural"),
      campaignId,
      creativeId,
      ownerMemberId: queueAssigned ? null : references.sdrMemberIds[ownerIndex]!,
      queueId: queueAssigned ? references.generalQueueId : null,
      actorId: queueAssigned ? references.systemActorId : references.sdrActorIds[ownerIndex]!,
      stageCode,
      stageSequence: leadStageSequence(stageCode),
      status: stageCode === "DISQUALIFIED" ? "DISQUALIFIED" : ["QUALIFIED", "MEETING_SCHEDULED"].includes(stageCode) ? "QUALIFIED" : "OPEN",
      priorityBandCode: priority.band,
      leadPriority: priority.priority,
      score: priority.score,
      attemptSeconds,
      connectedSeconds,
      respondedAt,
      isDuplicate: ordinal % 10 === 0,
      lacksNextAction: open && attemptSeconds !== null && ordinal % 37 === 0,
      isStagnant: open && ageDays >= 10 && lastActivityAt <= addMilliseconds(anchor, -7 * dayMs),
      lastActivityAt,
    });
  });
}

function demoAIInsightContent(
  lead: LeadPlan,
  index: number,
): DemoAIInsightContent {
  const agentType: AIAgentType =
    index % 3 === 0
      ? "QUALIFICATION"
      : index % 3 === 1
        ? "CALL_PREPARATION"
        : "NEXT_BEST_ACTION";
  const input: AIAnalysisInput = {
    facts: [
      {
        field: "full_name",
        value: `Lead demonstrativo ${String(lead.ordinal).padStart(3, "0")}`,
        source: "CRM",
      },
      {
        field: "pain",
        value: interests[(lead.ordinal - 1) % interests.length]!,
        source: "FORM",
        evidence: "Dor informada no formulário fictício.",
      },
      {
        field: "priority",
        value: lead.priorityBandCode,
        source: "CRM",
      },
    ],
    requiredFields: ["full_name", "pain", "capacity", "decision", "intent", "context"],
    scoreSignals: {
      pain: lead.priorityBandCode === "P3" ? "PARTIAL" : "POSITIVE",
      capacity: lead.priorityBandCode === "P1" ? "POSITIVE" : "PARTIAL",
      decision: lead.priorityBandCode === "P3" ? "UNKNOWN" : "PARTIAL",
      intent: lead.priorityBandCode === "P1" ? "POSITIVE" : "PARTIAL",
      context: "POSITIVE",
    },
    pacto: [],
    currentState: {
      stage: lead.stageCode,
      priority: lead.priorityBandCode,
      score: lead.score,
      ...(lead.lacksNextAction
        ? {}
        : {
            nextAction: lead.respondedAt
              ? "Responder o lead"
              : lead.attemptSeconds === null
                ? "Ligar agora"
                : "Executar retorno planejado",
          }),
      awaitingHumanResponse: lead.respondedAt !== null,
      hasHumanAttempt: lead.attemptSeconds !== null,
      doNotContact: (lead.ordinal - 1) % 41 === 0,
    },
  };
  const output = buildMockAIOutput(agentType, input);

  return Object.freeze({
    agentType,
    promptKey:
      agentType === "QUALIFICATION"
        ? "qualification"
        : agentType === "CALL_PREPARATION"
          ? "call-preparation"
          : "next-best-action",
    confidenceBps: Math.round(output.confidence * 10_000),
    recommendation: output.action?.title ?? output.summary,
    explanation: output.action?.reason ?? output.summary,
    facts: json(output.facts),
    inferences: json(output.inferences),
    missingData: json(output.missingFields),
    evidence: json({
      contractVersion: 1,
      dataset: CRM29_DEMO_NAMESPACE,
      simulated: true,
      summary: output.summary,
      evidence: output.evidence,
      pacto: output.pacto,
      questions: output.questions,
      score: output.score,
      priority: output.priority,
      action: output.action,
      alternativeAction: output.alternativeAction,
      urgency: output.urgency,
      confidence: output.confidence,
      risks: output.risks,
    }),
  });
}

async function refreshDemoAIInsights(
  transaction: Prisma.TransactionClient,
  references: References,
  leads: readonly LeadPlan[],
) {
  // AIInsight é uma evidência histórica append-only. Em reexecuções do seed,
  // os registros existentes permanecem imutáveis; apenas a criação inicial,
  // feita mais abaixo, materializa o conteúdo determinístico.
  await transaction.aIInsight.count({
    where: {
      workspaceId: references.workspaceId,
      id: { in: leads.slice(0, 48).map((_, index) => stableId(`ai-insight:${index + 1}`)) },
    },
  });
}

function buildMeetingPlans(leads: readonly LeadPlan[], references: References, anchor: Date): MeetingPlan[] {
  const tomorrow = startOfTomorrowInSaoPaulo(anchor);
  let activeSlot = 0;
  return leads.filter((lead) => lead.ordinal % 4 === 0).map((lead, index) => {
    const ageDays = Math.floor((anchor.getTime() - lead.receivedAt.getTime()) / dayMs);
    const active = ageDays <= 1;
    const ownerMemberId = references.closerMemberIds[index % references.closerMemberIds.length]!;
    let startsAt: Date;
    let status: MeetingStatus;
    if (active) {
      const closerSlot = Math.floor(activeSlot / references.closerMemberIds.length);
      startsAt = addMilliseconds(tomorrow, (8 * 60 + closerSlot * 40) * minuteMs);
      status = activeSlot % 2 === 0 ? "SCHEDULED" : "CONFIRMED";
      activeSlot += 1;
    } else {
      startsAt = addMilliseconds(lead.receivedAt, Math.min(2 * dayMs, Math.max(2 * 60 * minuteMs, (anchor.getTime() - lead.receivedAt.getTime()) / 2)));
      const outcome = index % 6;
      status = outcome <= 2 || outcome === 5 ? "COMPLETED" : outcome === 3 ? "NO_SHOW" : "CANCELLED";
    }
    const endsAt = addMilliseconds(startsAt, 40 * minuteMs);
    const terminalAt = ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(status)
      ? addMilliseconds(endsAt, 10 * minuteMs)
      : null;
    return Object.freeze({
      ordinal: index + 1,
      id: stableId(`meeting:${lead.ordinal}`),
      lead,
      ownerMemberId,
      startsAt,
      endsAt,
      status,
      revision: status === "SCHEDULED" ? 1 : 2,
      terminalAt,
    });
  });
}

function buildOpportunityPlans(meetings: readonly MeetingPlan[], references: References, anchor: Date): OpportunityPlan[] {
  const openStages = ["MEETING_HELD", "OPPORTUNITY_CONFIRMED", "PROPOSAL", "NEGOTIATION"] as const;
  return meetings.filter((meeting) => meeting.status === "COMPLETED").map((meeting, index) => {
    const ordinal = index + 1;
    const outcome = ordinal % 5;
    const status = outcome === 0 ? "WON" : outcome === 1 ? "LOST" : "OPEN";
    const currentStageCode = status === "WON" ? "WON" : status === "LOST" ? "LOST" : openStages[index % openStages.length]!;
    const baseSequence = ["MEETING_SCHEDULED", "MEETING_HELD"];
    const stageSequence = currentStageCode === "MEETING_HELD"
      ? baseSequence
      : currentStageCode === "OPPORTUNITY_CONFIRMED"
        ? [...baseSequence, "OPPORTUNITY_CONFIRMED"]
        : currentStageCode === "PROPOSAL"
          ? [...baseSequence, "OPPORTUNITY_CONFIRMED", "PROPOSAL"]
          : currentStageCode === "NEGOTIATION"
            ? [...baseSequence, "OPPORTUNITY_CONFIRMED", "PROPOSAL", "NEGOTIATION"]
            : currentStageCode === "WON"
              ? [...baseSequence, "OPPORTUNITY_CONFIRMED", "PROPOSAL", "NEGOTIATION", "WON"]
              : [...baseSequence, "OPPORTUNITY_CONFIRMED", "PROPOSAL", "LOST"];
    const createdAt = addMilliseconds(meeting.endsAt, 15 * minuteMs);
    const closedAt = status === "OPEN" ? null : addMilliseconds(createdAt, Math.min(2 * dayMs, Math.max(60 * minuteMs, (anchor.getTime() - createdAt.getTime()) / 2)));
    const productId = references.productIds[index % references.productIds.length]!;
    const amountCents = BigInt(350_000 + (index % 3) * 425_000);
    return Object.freeze({
      ordinal,
      id: stableId(`opportunity:${meeting.lead.ordinal}`),
      lead: meeting.lead,
      meeting,
      ownerMemberId: meeting.ownerMemberId,
      productId,
      currentStageCode,
      stageSequence,
      status,
      createdAt,
      closedAt,
      amountCents,
      mrrCents: index % 3 === 2 ? 80_000n : 0n,
      tcvCents: amountCents,
      lossReasonId: status === "LOST" ? references.lossReasonIds[index % references.lossReasonIds.length]! : null,
    });
  });
}

function intervalEntries(start: Date, end: Date, count: number): Date[] {
  const usable = Math.max(count * 1_000, end.getTime() - start.getTime());
  return Array.from({ length: count }, (_, index) =>
    addMilliseconds(start, Math.floor((usable * index) / count)));
}

function expectedResult(references: References, anchor: Date, leads: readonly LeadPlan[], meetings: readonly MeetingPlan[], opportunities: readonly OpportunityPlan[], counts: Readonly<{ tasks: number; activities: number; qualifications: number; stageHistories: number; automationRuns: number; aiInsights: number; auditLogs: number }>): Crm29DemoSeedResult {
  return Object.freeze({
    workspaceId: references.workspaceId,
    namespace: CRM29_DEMO_NAMESPACE,
    anchoredAt: anchor.toISOString(),
    leads: leads.length,
    submissions: leads.length + leads.filter(({ isDuplicate }) => isDuplicate).length,
    duplicateSubmissions: leads.filter(({ isDuplicate }) => isDuplicate).length,
    tasks: counts.tasks,
    activities: counts.activities,
    qualifications: counts.qualifications,
    stageHistories: counts.stageHistories,
    meetings: meetings.length,
    noShows: meetings.filter(({ status }) => status === "NO_SHOW").length,
    cancelledMeetings: meetings.filter(({ status }) => status === "CANCELLED").length,
    opportunities: opportunities.length,
    wins: opportunities.filter(({ status }) => status === "WON").length,
    losses: opportunities.filter(({ status }) => status === "LOST").length,
    automationRuns: counts.automationRuns,
    aiInsights: counts.aiInsights,
    auditLogs: counts.auditLogs,
  });
}

async function readExistingResult(transaction: Prisma.TransactionClient, references: References, markerCreatedAt: Date): Promise<Crm29DemoSeedResult> {
  const leadPlans = buildLeadPlans(references, markerCreatedAt);
  const meetingPlans = buildMeetingPlans(leadPlans, references, markerCreatedAt);
  const opportunityPlans = buildOpportunityPlans(meetingPlans, references, markerCreatedAt);
  const leadIds = leadPlans.map(({ id }) => id);
  const submissionIds = leadPlans.flatMap((lead) => [
    stableId(`submission:${lead.ordinal}:initial`),
    ...(lead.isDuplicate ? [stableId(`submission:${lead.ordinal}:duplicate`)] : []),
  ]);
  const taskIds = [
    ...leadPlans.map((lead) => stableId(`task:${lead.ordinal}:immediate`)),
    ...leadPlans.filter((lead) => lead.attemptSeconds !== null && lead.status !== "DISQUALIFIED" && !lead.lacksNextAction).map((lead) => stableId(`task:${lead.ordinal}:follow-up`)),
    ...opportunityPlans.filter(({ status }) => status === "OPEN").map((opportunity) => stableId(`task:opportunity:${opportunity.ordinal}`)),
  ];
  const activityIds = leadPlans.flatMap((lead) => [
    stableId(`activity:${lead.ordinal}:intake`),
    ...(lead.attemptSeconds === null ? [] : [stableId(`activity:${lead.ordinal}:call`)]),
    ...(lead.respondedAt ? [stableId(`activity:${lead.ordinal}:response`)] : []),
  ]);
  const qualificationPlans = leadPlans.filter((lead) => ["QUALIFIED", "MEETING_SCHEDULED", "DISQUALIFIED"].includes(lead.stageCode) || lead.ordinal % 5 === 0);
  const stageHistoryIds = [
    ...leadPlans.flatMap((lead) => lead.stageSequence.map((_, index) => stableId(`stage-history:lead:${lead.ordinal}:${index + 1}`))),
    ...opportunityPlans.flatMap((opportunity) => opportunity.stageSequence.map((_, index) => stableId(`stage-history:opportunity:${opportunity.ordinal}:${index + 1}`))),
  ];
  const meetingIds = meetingPlans.map(({ id }) => id);
  const opportunityIds = opportunityPlans.map(({ id }) => id);
  const automationRunIds = leadPlans.filter(({ ordinal }) => ordinal % 5 === 0).map((lead) => stableId(`automation-run:${lead.ordinal}`));
  const aiInsightIds = leadPlans.slice(0, 48).map((_, index) => stableId(`ai-insight:${index + 1}`));
  const auditIds = [
    ...leadPlans.flatMap((lead) => [stableId(`audit:lead:${lead.ordinal}:created`), stableId(`audit:lead:${lead.ordinal}:assigned`)]),
    ...opportunityPlans.map((opportunity) => stableId(`audit:opportunity:${opportunity.ordinal}`)),
    stableId("audit:dataset"),
  ];
  const scoreIds = leadPlans.map((lead) => stableId(`score:${lead.ordinal}`));
  const scoreComponentIds = leadPlans.flatMap((lead) => ["PAIN", "CAPACITY", "DECISION", "INTENT", "CONTEXT"].map((factor) => stableId(`score-component:${lead.ordinal}:${factor}`)));
  const pactoAssessmentIds = qualificationPlans.flatMap((lead) => dimensions.map((dimension) => stableId(`pacto-assessment:${lead.ordinal}:${dimension}`)));
  const pactoRevisionDimensionIds = qualificationPlans.flatMap((lead) => dimensions.map((dimension) => stableId(`pacto-revision-dimension:${lead.ordinal}:${dimension}`)));
  const meetingHistoryIds = meetingPlans.flatMap((meeting) => [stableId(`meeting-history:${meeting.ordinal}:1`), ...(meeting.status === "SCHEDULED" ? [] : [stableId(`meeting-history:${meeting.ordinal}:2`)])]);
  const offerIds = opportunityPlans.filter((opportunity) => ["PROPOSAL", "NEGOTIATION", "WON", "LOST"].includes(opportunity.currentStageCode)).map((opportunity) => stableId(`offer:${opportunity.ordinal}`));
  const outcomeSnapshotIds = opportunityPlans.filter(({ status }) => status !== "OPEN").map((opportunity) => stableId(`outcome-snapshot:${opportunity.ordinal}`));
  const leads = await transaction.lead.count({ where: { workspaceId: references.workspaceId, id: { in: leadIds } } });
  const leadTags = await transaction.leadTag.count({ where: { workspaceId: references.workspaceId, id: { in: leadPlans.map((lead) => stableId(`lead-tag:${lead.ordinal}`)) } } });
  const submissions = await transaction.leadFormSubmission.count({ where: { workspaceId: references.workspaceId, id: { in: submissionIds } } });
  const duplicateSubmissions = await transaction.leadFormSubmission.count({ where: { workspaceId: references.workspaceId, id: { in: leadPlans.filter(({ isDuplicate }) => isDuplicate).map((lead) => stableId(`submission:${lead.ordinal}:duplicate`)) } } });
  const identityReviews = await transaction.leadIdentityReview.count({ where: { workspaceId: references.workspaceId, id: { in: leadPlans.filter(({ isDuplicate }) => isDuplicate).map((lead) => stableId(`identity-review:${lead.ordinal}`)) } } });
  const slaCycles = await transaction.leadSlaCycle.count({ where: { workspaceId: references.workspaceId, id: { in: leadPlans.map((lead) => stableId(`sla-cycle:${lead.ordinal}`)) } } });
  const assignments = await transaction.leadAssignment.count({ where: { workspaceId: references.workspaceId, id: { in: leadPlans.map((lead) => stableId(`assignment:${lead.ordinal}`)) } } });
  const tasks = await transaction.task.count({ where: { workspaceId: references.workspaceId, id: { in: taskIds } } });
  const activities = await transaction.activity.count({ where: { workspaceId: references.workspaceId, id: { in: activityIds } } });
  const qualifications = await transaction.leadQualification.count({ where: { workspaceId: references.workspaceId, id: { in: qualificationPlans.map((lead) => stableId(`qualification:${lead.ordinal}`)) } } });
  const pactoAssessments = await transaction.pactoAssessment.count({ where: { workspaceId: references.workspaceId, id: { in: pactoAssessmentIds } } });
  const pactoRevisions = await transaction.pactoRevision.count({ where: { workspaceId: references.workspaceId, id: { in: qualificationPlans.map((lead) => stableId(`pacto-revision:${lead.ordinal}`)) } } });
  const pactoRevisionDimensions = await transaction.pactoRevisionDimension.count({ where: { workspaceId: references.workspaceId, id: { in: pactoRevisionDimensionIds } } });
  const scores = await transaction.leadScore.count({ where: { workspaceId: references.workspaceId, id: { in: scoreIds } } });
  const scoreComponents = await transaction.leadScoreComponent.count({ where: { workspaceId: references.workspaceId, id: { in: scoreComponentIds } } });
  const currentScores = await transaction.leadCurrentScore.count({ where: { workspaceId: references.workspaceId, id: { in: leadPlans.map((lead) => stableId(`current-score:${lead.ordinal}`)) } } });
  const stageHistories = await transaction.stageHistory.count({ where: { workspaceId: references.workspaceId, id: { in: stageHistoryIds } } });
  const meetings = await transaction.meeting.count({ where: { workspaceId: references.workspaceId, id: { in: meetingIds } } });
  const meetingHistories = await transaction.meetingHistory.count({ where: { workspaceId: references.workspaceId, id: { in: meetingHistoryIds } } });
  const noShows = await transaction.meeting.count({ where: { workspaceId: references.workspaceId, id: { in: meetingIds }, status: "NO_SHOW" } });
  const cancelledMeetings = await transaction.meeting.count({ where: { workspaceId: references.workspaceId, id: { in: meetingIds }, status: "CANCELLED" } });
  const opportunities = await transaction.opportunity.count({ where: { workspaceId: references.workspaceId, id: { in: opportunityIds } } });
  const offers = await transaction.offer.count({ where: { workspaceId: references.workspaceId, id: { in: offerIds } } });
  const outcomeSnapshots = await transaction.opportunityOutcomeSnapshot.count({ where: { workspaceId: references.workspaceId, id: { in: outcomeSnapshotIds } } });
  const wins = await transaction.opportunity.count({ where: { workspaceId: references.workspaceId, id: { in: opportunityIds }, status: "WON" } });
  const losses = await transaction.opportunity.count({ where: { workspaceId: references.workspaceId, id: { in: opportunityIds }, status: "LOST" } });
  const automationRuns = await transaction.automationRun.count({ where: { workspaceId: references.workspaceId, id: { in: automationRunIds } } });
  const aiInsights = await transaction.aIInsight.count({ where: { workspaceId: references.workspaceId, id: { in: aiInsightIds } } });
  const auditLogs = await transaction.auditLog.count({ where: { workspaceId: references.workspaceId, id: { in: auditIds } } });
  const complete = leads === leadIds.length
    && leadTags === leadPlans.length
    && submissions === submissionIds.length
    && identityReviews === duplicateSubmissions
    && slaCycles === leadPlans.length
    && assignments === leadPlans.length
    && tasks === taskIds.length
    && activities === activityIds.length
    && qualifications === qualificationPlans.length
    && pactoAssessments === pactoAssessmentIds.length
    && pactoRevisions === qualificationPlans.length
    && pactoRevisionDimensions === pactoRevisionDimensionIds.length
    && scores === scoreIds.length
    && scoreComponents === scoreComponentIds.length
    && currentScores === leadPlans.length
    && stageHistories === stageHistoryIds.length
    && meetings === meetingIds.length
    && meetingHistories === meetingHistoryIds.length
    && opportunities === opportunityIds.length
    && offers === offerIds.length
    && outcomeSnapshots === outcomeSnapshotIds.length
    && automationRuns === automationRunIds.length
    && aiInsights === aiInsightIds.length
    && auditLogs === auditIds.length;
  if (!complete) {
    throw new ApplicationError("A base CRM-29 existente está incompleta; use um schema de demonstração novo.", {
      code: "CRM29_DATASET_INCONSISTENT",
      statusCode: 409,
      expose: true,
    });
  }
  return Object.freeze({
    workspaceId: references.workspaceId,
    namespace: CRM29_DEMO_NAMESPACE,
    anchoredAt: markerCreatedAt.toISOString(),
    leads,
    submissions,
    duplicateSubmissions,
    tasks,
    activities,
    qualifications,
    stageHistories,
    meetings,
    noShows,
    cancelledMeetings,
    opportunities,
    wins,
    losses,
    automationRuns,
    aiInsights,
    auditLogs,
  });
}

export async function seedCrm29DemoData(
  database: PrismaClient,
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options: SeedOptions = {},
): Promise<Crm29DemoSeedResult> {
  assertDemoSeedEnvironment(environment);
  const anchor = atSecondPrecision(options.now ?? new Date());

  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('politizai_crm29_demo_data_v1'))`;
    const references = await resolveReferences(transaction);
    const markerId = stableId("tag:dataset");
    const existingMarker = await transaction.tag.findUnique({ where: { id: markerId }, select: { createdAt: true } });
    if (existingMarker) {
      const existingLeads = buildLeadPlans(references, existingMarker.createdAt);
      await refreshDemoAIInsights(transaction, references, existingLeads);
      return readExistingResult(transaction, references, existingMarker.createdAt);
    }

    const leads = buildLeadPlans(references, anchor);
    const duplicateLeads = leads.filter(({ isDuplicate }) => isDuplicate);
    const meetings = buildMeetingPlans(leads, references, anchor);
    const opportunities = buildOpportunityPlans(meetings, references, anchor);
    const opportunityByLeadId = new Map(opportunities.map((opportunity) => [opportunity.lead.id, opportunity]));
    const meetingByLeadId = new Map(meetings.map((meeting) => [meeting.lead.id, meeting]));

    await transaction.tag.create({
      data: {
        id: markerId,
        workspaceId: references.workspaceId,
        name: CRM29_DEMO_TAG_NAME,
        color: "#64748b",
        createdByActorId: references.systemActorId,
        updatedByActorId: references.systemActorId,
        createdAt: anchor,
        updatedAt: anchor,
      },
    });

    const leadRows: Prisma.LeadCreateManyInput[] = leads.map((lead, index) => {
      const [city, stateCode] = locations[index % locations.length]!;
      const duplicateAt = lead.isDuplicate ? betweenStartAndAnchor(lead.receivedAt, 6 * 60 * minuteMs, anchor) : null;
      return {
        id: lead.id,
        workspaceId: references.workspaceId,
        sourceId: lead.sourceId,
        campaignId: lead.campaignId,
        creativeId: lead.creativeId,
        latestSourceId: lead.sourceId,
        latestCampaignId: lead.campaignId,
        latestCreativeId: lead.creativeId,
        pipelineId: references.preSalesPipelineId,
        currentStageId: references.preSalesStages.get(lead.stageCode)!,
        ownerMemberId: lead.ownerMemberId,
        queueId: lead.queueId,
        routingQueueId: references.generalQueueId,
        disqualificationReasonId: lead.status === "DISQUALIFIED" ? references.disqualificationReasonIds[index % references.disqualificationReasonIds.length]! : null,
        fullName: `Lead demonstrativo ${String(lead.ordinal).padStart(3, "0")}`,
        normalizedEmail: `lead.${String(lead.ordinal).padStart(3, "0")}@example.invalid`,
        normalizedPhone: `+5555900${String(lead.ordinal).padStart(6, "0")}`,
        jobTitle: jobTitles[index % jobTitles.length]!,
        organizationName: fictionalOrganizations[index % fictionalOrganizations.length]!,
        city,
        stateCode,
        interestSummary: interests[index % interests.length]!,
        latestInterestSummary: lead.isDuplicate ? `${interests[index % interests.length]!} — nova conversão fictícia` : interests[index % interests.length]!,
        budgetCents: BigInt(250_000 + (index % 6) * 175_000),
        contactPreference: index % 41 === 0 ? "DO_NOT_CONTACT" : "CONSENTED",
        contactPreferenceUpdatedAt: lead.receivedAt,
        conversionCount: lead.isDuplicate ? 2 : 1,
        latestSubmissionAt: duplicateAt ?? lead.receivedAt,
        needsIdentityReview: lead.isDuplicate,
        status: lead.status,
        priority: lead.leadPriority,
        slaStartedAt: lead.receivedAt,
        slaDueAt: lead.receivedAt,
        firstRespondedAt: lead.connectedSeconds === null ? null : addMilliseconds(lead.receivedAt, lead.connectedSeconds * 1_000),
        lastInboundResponseAt: lead.respondedAt,
        awaitingHumanResponse: lead.respondedAt !== null,
        lastActivityAt: lead.lastActivityAt,
        createdByActorId: references.systemActorId,
        updatedByActorId: references.systemActorId,
        createdAt: lead.receivedAt,
        updatedAt: lead.lastActivityAt,
      };
    });
    await transaction.lead.createMany({ data: leadRows });

    await transaction.leadTag.createMany({ data: leads.map((lead) => ({
      id: stableId(`lead-tag:${lead.ordinal}`),
      workspaceId: references.workspaceId,
      leadId: lead.id,
      tagId: markerId,
      createdByActorId: references.systemActorId,
      createdAt: anchor,
    })) });

    const submissions: Prisma.LeadFormSubmissionCreateManyInput[] = leads.flatMap((lead, index) => {
      const base = {
        workspaceId: references.workspaceId,
        leadId: lead.id,
        sourceId: lead.sourceId,
        campaignId: lead.campaignId,
        creativeId: lead.creativeId,
        status: "LINKED" as const,
        channel: index % 4 === 0 ? "MANUAL" as const : index % 4 === 1 ? "CSV" as const : index % 4 === 2 ? "LOCAL_WEBHOOK" as const : "SIMULATOR" as const,
        submittedFullName: `Lead demonstrativo ${String(lead.ordinal).padStart(3, "0")}`,
        submittedEmail: `lead.${String(lead.ordinal).padStart(3, "0")}@example.invalid`,
        submittedPhone: `+55 (55) 900${String(lead.ordinal).padStart(6, "0")}`,
        normalizedEmail: `lead.${String(lead.ordinal).padStart(3, "0")}@example.invalid`,
        normalizedPhone: `+5555900${String(lead.ordinal).padStart(6, "0")}`,
        submittedJobTitle: jobTitles[index % jobTitles.length]!,
        submittedOrganizationName: fictionalOrganizations[index % fictionalOrganizations.length]!,
        submittedCity: locations[index % locations.length]![0],
        submittedStateCode: locations[index % locations.length]![1],
        submittedInterestSummary: interests[index % interests.length]!,
        submittedBudgetCents: BigInt(250_000 + (index % 6) * 175_000),
        submittedContactPreference: index % 41 === 0 ? "DO_NOT_CONTACT" as const : "CONSENTED" as const,
        createdByActorId: references.systemActorId,
      };
      const initial: Prisma.LeadFormSubmissionCreateManyInput = {
        ...base,
        id: stableId(`submission:${lead.ordinal}:initial`),
        intakeOutcome: "CREATED",
        formIdentifier: `${CRM29_DEMO_NAMESPACE}:initial`,
        idempotencyKey: `${CRM29_DEMO_NAMESPACE}:submission:${lead.ordinal}:initial`,
        submittedAt: lead.receivedAt,
        rawPayload: { simulated: true, dataset: CRM29_DEMO_NAMESPACE, ordinal: lead.ordinal, conversion: 1 },
        createdAt: lead.receivedAt,
      };
      if (!lead.isDuplicate) return [initial];
      const duplicateAt = betweenStartAndAnchor(lead.receivedAt, 6 * 60 * minuteMs, anchor);
      return [initial, {
        ...base,
        id: stableId(`submission:${lead.ordinal}:duplicate`),
        intakeOutcome: "ATTACHED",
        formIdentifier: `${CRM29_DEMO_NAMESPACE}:duplicate`,
        idempotencyKey: `${CRM29_DEMO_NAMESPACE}:submission:${lead.ordinal}:duplicate`,
        submittedInterestSummary: `${interests[index % interests.length]} — reconversão fictícia`,
        submittedAt: duplicateAt,
        rawPayload: { simulated: true, dataset: CRM29_DEMO_NAMESPACE, ordinal: lead.ordinal, conversion: 2, duplicatePhone: true },
        createdAt: duplicateAt,
      }];
    });
    await transaction.leadFormSubmission.createMany({ data: submissions });

    await transaction.leadIdentityReview.createMany({ data: duplicateLeads.map((lead) => ({
      id: stableId(`identity-review:${lead.ordinal}`),
      workspaceId: references.workspaceId,
      leadId: lead.id,
      submissionId: stableId(`submission:${lead.ordinal}:duplicate`),
      reason: "DUPLICATE_PHONE",
      status: "OPEN",
      divergenceFields: ["INTEREST"],
      evidence: { dataset: CRM29_DEMO_NAMESPACE, fact: "Telefone normalizado idêntico em nova submissão fictícia." },
      createdByActorId: references.systemActorId,
      createdAt: betweenStartAndAnchor(lead.receivedAt, 6 * 60 * minuteMs, anchor),
    })) });

    const slaRows: Prisma.LeadSlaCycleCreateManyInput[] = leads.map((lead) => ({
      id: stableId(`sla-cycle:${lead.ordinal}`),
      workspaceId: references.workspaceId,
      leadId: lead.id,
      submissionId: stableId(`submission:${lead.ordinal}:initial`),
      priorityBandId: references.priorityBandIds.get(lead.priorityBandCode)!,
      assignedMemberId: lead.ownerMemberId,
      assignedQueueId: lead.queueId,
      receivedAt: lead.receivedAt,
      assignedAt: addMilliseconds(lead.receivedAt, 1_000),
      automaticAcknowledgedAt: lead.receivedAt,
      firstHumanAttemptAt: lead.attemptSeconds === null ? null : addMilliseconds(lead.receivedAt, lead.attemptSeconds * 1_000),
      firstConnectedAt: lead.connectedSeconds === null ? null : addMilliseconds(lead.receivedAt, lead.connectedSeconds * 1_000),
      firstResponseTimeSeconds: lead.connectedSeconds,
      firstHumanAttemptSeconds: lead.attemptSeconds,
      createdByActorId: references.systemActorId,
      createdAt: lead.receivedAt,
    }));
    await transaction.leadSlaCycle.createMany({ data: slaRows });

    await transaction.leadAssignment.createMany({ data: leads.map((lead) => ({
      id: stableId(`assignment:${lead.ordinal}`),
      workspaceId: references.workspaceId,
      leadId: lead.id,
      toMemberId: lead.ownerMemberId,
      toQueueId: lead.queueId,
      type: lead.queueId ? "GENERAL_QUEUE_FALLBACK" : "AUTOMATIC_ROUND_ROBIN",
      reason: lead.queueId ? "Cenário demonstrativo sem SDR disponível." : "Distribuição demonstrativa previsível entre SDRs.",
      assignedAt: addMilliseconds(lead.receivedAt, 1_000),
      createdByActorId: references.systemActorId,
      createdAt: addMilliseconds(lead.receivedAt, 1_000),
    })) });

    const immediateTasks: Prisma.TaskCreateManyInput[] = leads.map((lead) => {
      const attemptedAt = lead.attemptSeconds === null ? null : addMilliseconds(lead.receivedAt, lead.attemptSeconds * 1_000);
      return {
        id: stableId(`task:${lead.ordinal}:immediate`),
        workspaceId: references.workspaceId,
        leadId: lead.id,
        slaCycleId: stableId(`sla-cycle:${lead.ordinal}`),
        assigneeMemberId: lead.ownerMemberId,
        queueId: lead.queueId,
        title: "Ligar agora",
        description: "Tarefa demonstrativa do SLA imediato — 0 minutos.",
        kind: "IMMEDIATE_CALL",
        status: attemptedAt ? "COMPLETED" : "OPEN",
        priority: lead.leadPriority,
        dueAt: lead.receivedAt,
        completedAt: attemptedAt,
        result: attemptedAt ? (lead.connectedSeconds === null ? "Tentativa sem conexão" : "Contato realizado") : null,
        createdByActorId: references.systemActorId,
        updatedByActorId: lead.actorId,
        createdAt: lead.receivedAt,
        updatedAt: attemptedAt ?? lead.receivedAt,
      };
    });
    const followUpTasks: Prisma.TaskCreateManyInput[] = leads.flatMap((lead) => {
      if (lead.attemptSeconds === null || lead.status === "DISQUALIFIED" || lead.lacksNextAction) return [];
      const dueAt = addMilliseconds(anchor, ((lead.ordinal % 5) - 2) * 3 * 60 * minuteMs);
      return [{
        id: stableId(`task:${lead.ordinal}:follow-up`),
        workspaceId: references.workspaceId,
        leadId: lead.id,
        assigneeMemberId: lead.ownerMemberId,
        queueId: lead.queueId,
        title: lead.respondedAt ? "Responder lead" : "Executar próxima ação",
        description: "Próxima ação persistida para o cenário de demonstração.",
        kind: lead.respondedAt ? "MESSAGE" : "FOLLOW_UP",
        status: "OPEN",
        priority: lead.leadPriority,
        dueAt,
        createdByActorId: references.systemActorId,
        updatedByActorId: references.systemActorId,
        createdAt: lead.lastActivityAt,
        updatedAt: lead.lastActivityAt,
      } satisfies Prisma.TaskCreateManyInput];
    });
    await transaction.task.createMany({ data: [...immediateTasks, ...followUpTasks] });

    for (const lead of leads) {
      const taskId = lead.attemptSeconds === null
        ? stableId(`task:${lead.ordinal}:immediate`)
        : lead.status !== "DISQUALIFIED" && !lead.lacksNextAction
          ? stableId(`task:${lead.ordinal}:follow-up`)
          : null;
      if (!taskId) continue;
      const task = [...immediateTasks, ...followUpTasks].find(({ id }) => id === taskId)!;
      await transaction.lead.update({
        where: { id: lead.id },
        data: {
          nextActionTaskId: taskId,
          nextActionAt: task.dueAt,
          nextActionDescription: task.title,
        },
      });
    }

    const activities: Prisma.ActivityCreateManyInput[] = leads.flatMap((lead) => {
      const rows: Prisma.ActivityCreateManyInput[] = [{
        id: stableId(`activity:${lead.ordinal}:intake`),
        workspaceId: references.workspaceId,
        leadId: lead.id,
        type: "AUTOMATION",
        direction: "INTERNAL",
        result: "COMPLETED",
        subject: "Lead demonstrativo recebido",
        description: "Entrada simulada e identificada como dado fictício da CRM-29.",
        occurredAt: lead.receivedAt,
        createdByActorId: references.automationActorId,
        updatedByActorId: references.automationActorId,
        createdAt: lead.receivedAt,
        updatedAt: lead.receivedAt,
      }];
      if (lead.attemptSeconds !== null) {
        const occurredAt = addMilliseconds(lead.receivedAt, lead.attemptSeconds * 1_000);
        rows.push({
          id: stableId(`activity:${lead.ordinal}:call`),
          workspaceId: references.workspaceId,
          leadId: lead.id,
          type: lead.connectedSeconds === null ? "CALL_UNANSWERED" : "CALL_CONNECTED",
          direction: "OUTBOUND",
          result: lead.connectedSeconds === null ? "NOT_CONNECTED" : "CONNECTED",
          subject: lead.connectedSeconds === null ? "Ligação não atendida" : "Ligação atendida",
          description: lead.connectedSeconds === null ? "Tentativa fictícia sem conexão." : "Contato fictício com contexto comercial registrado.",
          occurredAt,
          durationSeconds: lead.connectedSeconds === null ? 20 : 180 + (lead.ordinal % 240),
          createdByActorId: lead.actorId,
          updatedByActorId: lead.actorId,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        });
      }
      if (lead.respondedAt) rows.push({
        id: stableId(`activity:${lead.ordinal}:response`),
        workspaceId: references.workspaceId,
        leadId: lead.id,
        type: "MESSAGE_RECEIVED",
        direction: "INBOUND",
        result: "RECEIVED",
        subject: "Resposta simulada do lead",
        description: "Resposta fictícia para priorização da fila do SDR.",
        occurredAt: lead.respondedAt,
        createdByActorId: references.systemActorId,
        updatedByActorId: references.systemActorId,
        createdAt: lead.respondedAt,
        updatedAt: lead.respondedAt,
      });
      return rows;
    });
    await transaction.activity.createMany({ data: activities });

    const leadStageRows: Prisma.StageHistoryCreateManyInput[] = leads.flatMap((lead) => {
      const entries = intervalEntries(lead.receivedAt, addMilliseconds(anchor, -minuteMs), lead.stageSequence.length);
      return lead.stageSequence.map((code, index) => ({
        id: stableId(`stage-history:lead:${lead.ordinal}:${index + 1}`),
        workspaceId: references.workspaceId,
        pipelineId: references.preSalesPipelineId,
        stageId: references.preSalesStages.get(code)!,
        leadId: lead.id,
        enteredAt: entries[index]!,
        exitedAt: index === lead.stageSequence.length - 1 ? null : entries[index + 1]!,
        enteredByActorId: index === 0 ? references.systemActorId : lead.actorId,
        exitedByActorId: index === lead.stageSequence.length - 1 ? null : lead.actorId,
        transitionOrigin: index === 0 ? "INTAKE" : "SYSTEM",
        transitionReason: index === 0 ? "Entrada fictícia CRM-29." : "Progressão histórica fictícia coerente.",
        createdAt: entries[index]!,
      }));
    });
    await transaction.stageHistory.createMany({ data: leadStageRows });

    const scores: Prisma.LeadScoreCreateManyInput[] = leads.map((lead) => ({
      id: stableId(`score:${lead.ordinal}`),
      workspaceId: references.workspaceId,
      leadId: lead.id,
      scoringRuleVersionId: references.scoringRuleVersionId,
      submissionId: stableId(`submission:${lead.ordinal}:initial`),
      source: "FORM_PROVISIONAL",
      priorityBandCode: lead.priorityBandCode,
      score: lead.score,
      currentRevision: 1,
      modelKey: "pacto-weighted",
      modelVersion: "1",
      reason: `Pontuação fictícia reproduzível: ${lead.priorityBandCode} com ${lead.score} pontos.`,
      evidence: { dataset: CRM29_DEMO_NAMESPACE, simulated: true },
      inputSnapshot: { pain: true, budgetCents: String(250_000 + ((lead.ordinal - 1) % 6) * 175_000), simulated: true },
      calculatedByActorId: references.systemActorId,
      calculatedAt: lead.receivedAt,
    }));
    await transaction.leadScore.createMany({ data: scores });
    const scoreFactors = ["PAIN", "CAPACITY", "DECISION", "INTENT", "CONTEXT"] as const;
    const maximums = [25, 30, 15, 20, 10] as const;
    await transaction.leadScoreComponent.createMany({ data: leads.flatMap((lead) => splitScore(lead.score).map((points, index) => ({
      id: stableId(`score-component:${lead.ordinal}:${scoreFactors[index]}`),
      workspaceId: references.workspaceId,
      leadScoreId: stableId(`score:${lead.ordinal}`),
      factor: scoreFactors[index]!,
      points,
      maxPoints: maximums[index]!,
      reason: `${dimensionLabels[index]} — evidência fictícia controlada.`,
      missingData: false,
      evidence: { dataset: CRM29_DEMO_NAMESPACE, simulated: true },
      createdAt: lead.receivedAt,
    })) ) });
    await transaction.leadCurrentScore.createMany({ data: leads.map((lead) => ({
      id: stableId(`current-score:${lead.ordinal}`),
      workspaceId: references.workspaceId,
      leadId: lead.id,
      leadScoreId: stableId(`score:${lead.ordinal}`),
      revision: 1,
      updatedByActorId: references.systemActorId,
      updatedAt: lead.receivedAt,
    })) });

    const qualifiedLeads = leads.filter((lead) => ["QUALIFIED", "MEETING_SCHEDULED", "DISQUALIFIED"].includes(lead.stageCode) || lead.ordinal % 5 === 0);
    await transaction.leadQualification.createMany({ data: qualifiedLeads.map((lead) => {
      const completed = ["QUALIFIED", "MEETING_SCHEDULED", "DISQUALIFIED"].includes(lead.stageCode) || lead.ordinal % 10 === 0;
      const status = completed ? "COMPLETED" : "IN_PROGRESS";
      const assessedAt = betweenStartAndAnchor(lead.receivedAt, 30 * minuteMs, anchor);
      return {
        id: stableId(`qualification:${lead.ordinal}`),
        workspaceId: references.workspaceId,
        leadId: lead.id,
        status,
        problemStatus: "POSITIVE",
        problemEvidence: { text: "Precisamos organizar a operação comercial.", simulated: true },
        authorityStatus: completed ? "POSITIVE" : "PARTIAL",
        authorityEvidence: { text: "Participa da decisão fictícia.", simulated: true },
        consequenceStatus: completed ? "POSITIVE" : "UNKNOWN",
        consequenceEvidence: completed ? { text: "Perde previsibilidade sem processo.", simulated: true } : Prisma.DbNull,
        timingStatus: completed ? "POSITIVE" : "UNKNOWN",
        timingEvidence: completed ? { text: "Pretende agir nos próximos 30 dias.", simulated: true } : Prisma.DbNull,
        objectiveStatus: lead.stageCode === "DISQUALIFIED" ? "DISQUALIFYING" : completed ? "POSITIVE" : "UNKNOWN",
        objectiveEvidence: lead.stageCode === "DISQUALIFIED" ? { text: "Cenário fictício fora do perfil.", simulated: true } : completed ? { text: "Objetivo compatível com o produto fictício.", simulated: true } : Prisma.DbNull,
        revision: 1,
        minimumRequiredDimensions: 5,
        validatedAt: completed ? assessedAt : null,
        validatedByActorId: completed ? lead.actorId : null,
        assessedAt,
        createdByActorId: lead.actorId,
        updatedByActorId: lead.actorId,
        createdAt: assessedAt,
        updatedAt: assessedAt,
      } satisfies Prisma.LeadQualificationCreateManyInput;
    }) });
    await transaction.pactoAssessment.createMany({ data: qualifiedLeads.flatMap((lead) => {
      const completed = ["QUALIFIED", "MEETING_SCHEDULED", "DISQUALIFIED"].includes(lead.stageCode) || lead.ordinal % 10 === 0;
      const assessedAt = betweenStartAndAnchor(lead.receivedAt, 30 * minuteMs, anchor);
      return dimensions.map((dimension, index) => {
        const investigated = completed || index < 3;
        const status = !investigated ? "UNKNOWN" : lead.stageCode === "DISQUALIFIED" && dimension === "OPPORTUNITY_NOW" ? "DISQUALIFYING" : index === 3 && !completed ? "PARTIAL" : "POSITIVE";
        return {
          id: stableId(`pacto-assessment:${lead.ordinal}:${dimension}`),
          workspaceId: references.workspaceId,
          qualificationId: stableId(`qualification:${lead.ordinal}`),
          leadId: lead.id,
          dimension,
          status,
          note: investigated ? `Registro fictício: ${dimensionLabels[index]}.` : null,
          evidence: investigated ? `Evidência fictícia controlada para ${dimensionLabels[index]}.` : null,
          origin: investigated ? "SDR" : null,
          recordedAt: investigated ? assessedAt : null,
          recordedByActorId: investigated ? lead.actorId : null,
          validatedAt: completed ? assessedAt : null,
          validatedByActorId: completed ? lead.actorId : null,
          createdAt: assessedAt,
          updatedAt: assessedAt,
        } satisfies Prisma.PactoAssessmentCreateManyInput;
      });
    }) });
    await transaction.pactoRevision.createMany({ data: qualifiedLeads.map((lead) => {
      const completed = ["QUALIFIED", "MEETING_SCHEDULED", "DISQUALIFIED"].includes(lead.stageCode) || lead.ordinal % 10 === 0;
      return {
        id: stableId(`pacto-revision:${lead.ordinal}`),
        workspaceId: references.workspaceId,
        qualificationId: stableId(`qualification:${lead.ordinal}`),
        leadId: lead.id,
        revisionNumber: 1,
        kind: completed ? "VALIDATED" : "DRAFT_SAVED",
        qualificationStatus: completed ? "COMPLETED" : "IN_PROGRESS",
        minimumRequiredDimensions: 5,
        investigatedDimensions: completed ? 5 : 3,
        hasDisqualifyingDimension: lead.stageCode === "DISQUALIFIED",
        isQualificationReady: completed && lead.stageCode !== "DISQUALIFIED",
        createdByActorId: lead.actorId,
        createdAt: betweenStartAndAnchor(lead.receivedAt, 30 * minuteMs, anchor),
      } satisfies Prisma.PactoRevisionCreateManyInput;
    }) });
    await transaction.pactoRevisionDimension.createMany({ data: qualifiedLeads.flatMap((lead) => {
      const completed = ["QUALIFIED", "MEETING_SCHEDULED", "DISQUALIFIED"].includes(lead.stageCode) || lead.ordinal % 10 === 0;
      const assessedAt = betweenStartAndAnchor(lead.receivedAt, 30 * minuteMs, anchor);
      return dimensions.map((dimension, index) => {
        const investigated = completed || index < 3;
        return {
          id: stableId(`pacto-revision-dimension:${lead.ordinal}:${dimension}`),
          workspaceId: references.workspaceId,
          revisionId: stableId(`pacto-revision:${lead.ordinal}`),
          dimension,
          status: !investigated ? "UNKNOWN" : lead.stageCode === "DISQUALIFIED" && dimension === "OPPORTUNITY_NOW" ? "DISQUALIFYING" : index === 3 && !completed ? "PARTIAL" : "POSITIVE",
          note: investigated ? `Registro fictício: ${dimensionLabels[index]}.` : null,
          evidence: investigated ? `Evidência fictícia controlada para ${dimensionLabels[index]}.` : null,
          origin: investigated ? "SDR" : null,
          recordedAt: investigated ? assessedAt : null,
          recordedByActorId: investigated ? lead.actorId : null,
          validatedAt: completed ? assessedAt : null,
          validatedByActorId: completed ? lead.actorId : null,
          createdAt: assessedAt,
        } satisfies Prisma.PactoRevisionDimensionCreateManyInput;
      });
    }) });

    await transaction.opportunity.createMany({ data: opportunities.map((opportunity, index) => ({
      id: opportunity.id,
      workspaceId: references.workspaceId,
      leadId: opportunity.lead.id,
      pipelineId: references.salesPipelineId,
      currentStageId: references.salesStages.get(opportunity.currentStageCode)!,
      ownerMemberId: opportunity.ownerMemberId,
      productId: opportunity.productId,
      name: `Oportunidade demonstrativa ${String(opportunity.ordinal).padStart(3, "0")}`,
      interestDescription: interests[index % interests.length]!,
      status: opportunity.status,
      amountCents: opportunity.amountCents,
      mrrCents: opportunity.mrrCents,
      tcvCents: opportunity.tcvCents,
      probabilityBps: opportunity.status === "WON" ? 10_000 : opportunity.status === "LOST" ? 0 : 3_500 + (index % 5) * 1_000,
      expectedCloseAt: opportunity.status === "OPEN" ? addMilliseconds(anchor, (7 + index % 14) * dayMs) : opportunity.closedAt,
      closedAt: opportunity.closedAt,
      outcomeReasonCode: opportunity.status === "WON" ? "Contrato fictício confirmado" : opportunity.status === "LOST" ? "Perda fictícia documentada" : null,
      lossReasonId: opportunity.lossReasonId,
      commercialNotes: "Narrativa fictícia e controlada para demonstração local.",
      revision: 1,
      createdByActorId: references.systemActorId,
      updatedByActorId: references.systemActorId,
      createdAt: opportunity.createdAt,
      updatedAt: opportunity.closedAt ?? opportunity.createdAt,
    })) });

    const opportunityTasks: Prisma.TaskCreateManyInput[] = opportunities.filter(({ status }) => status === "OPEN").map((opportunity) => ({
      id: stableId(`task:opportunity:${opportunity.ordinal}`),
      workspaceId: references.workspaceId,
      leadId: opportunity.lead.id,
      opportunityId: opportunity.id,
      assigneeMemberId: opportunity.ownerMemberId,
      title: opportunity.currentStageCode === "PROPOSAL" ? "Acompanhar proposta" : "Avançar oportunidade",
      description: "Próxima ação fictícia da oportunidade.",
      kind: "FOLLOW_UP",
      status: "OPEN",
      priority: opportunity.lead.leadPriority,
      dueAt: addMilliseconds(anchor, ((opportunity.ordinal % 5) - 2) * dayMs),
      createdByActorId: references.systemActorId,
      updatedByActorId: references.systemActorId,
      createdAt: opportunity.createdAt,
      updatedAt: opportunity.createdAt,
    }));
    await transaction.task.createMany({ data: opportunityTasks });
    for (const opportunity of opportunities.filter(({ status }) => status === "OPEN")) {
      const task = opportunityTasks.find(({ opportunityId }) => opportunityId === opportunity.id);
      if (!task?.id) throw new Error(`Tarefa da oportunidade ausente: ${opportunity.id}`);
      await transaction.opportunity.update({
        where: { id: opportunity.id },
        data: { nextActionTaskId: task.id, nextActionAt: new Date(task.dueAt), nextActionDescription: task.title },
      });
    }

    const opportunityStageRows: Prisma.StageHistoryCreateManyInput[] = opportunities.flatMap((opportunity) => {
      const intervalEnd = opportunity.closedAt ?? addMilliseconds(anchor, -minuteMs);
      const entries = intervalEntries(opportunity.createdAt, intervalEnd, opportunity.stageSequence.length);
      return opportunity.stageSequence.map((code, index) => ({
        id: stableId(`stage-history:opportunity:${opportunity.ordinal}:${index + 1}`),
        workspaceId: references.workspaceId,
        pipelineId: references.salesPipelineId,
        stageId: references.salesStages.get(code)!,
        opportunityId: opportunity.id,
        enteredAt: entries[index]!,
        exitedAt: index === opportunity.stageSequence.length - 1 ? null : entries[index + 1]!,
        enteredByActorId: references.systemActorId,
        exitedByActorId: index === opportunity.stageSequence.length - 1 ? null : references.systemActorId,
        transitionOrigin: "SYSTEM",
        transitionReason: "Progressão comercial fictícia CRM-29.",
        createdAt: entries[index]!,
      }));
    });
    await transaction.stageHistory.createMany({ data: opportunityStageRows });

    await transaction.meeting.createMany({ data: meetings.map((meeting) => ({
      id: meeting.id,
      workspaceId: references.workspaceId,
      leadId: meeting.lead.id,
      opportunityId: opportunityByLeadId.get(meeting.lead.id)?.id ?? null,
      ownerMemberId: meeting.ownerMemberId,
      title: `Reunião demonstrativa — lead ${String(meeting.lead.ordinal).padStart(3, "0")}`,
      status: meeting.status,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      durationMinutes: 40,
      timeZone: "America/Sao_Paulo",
      location: "Sala virtual simulada",
      observation: "Agenda interna fictícia; nenhuma integração externa.",
      outcome: meeting.status === "COMPLETED" ? "Contexto validado e oportunidade fictícia registrada." : meeting.status === "NO_SHOW" ? "Ausência fictícia; recuperação pendente." : meeting.status === "CANCELLED" ? "Cancelada previamente; não conta como no-show." : null,
      confirmedAt: meeting.status === "CONFIRMED" ? addMilliseconds(meeting.startsAt, -dayMs) : null,
      cancelledAt: meeting.status === "CANCELLED" ? meeting.terminalAt : null,
      completedAt: meeting.status === "COMPLETED" ? meeting.terminalAt : null,
      noShowAt: meeting.status === "NO_SHOW" ? meeting.terminalAt : null,
      revision: meeting.revision,
      createdByActorId: references.systemActorId,
      updatedByActorId: references.systemActorId,
      createdAt: addMilliseconds(meeting.startsAt, -Math.min(dayMs, Math.max(minuteMs, meeting.startsAt.getTime() - meeting.lead.receivedAt.getTime()))),
      updatedAt: meeting.terminalAt ?? meeting.startsAt,
    })) });

    const meetingHistory: Prisma.MeetingHistoryCreateManyInput[] = meetings.flatMap((meeting) => {
      const scheduledAt = addMilliseconds(meeting.startsAt, -Math.min(dayMs, Math.max(minuteMs, meeting.startsAt.getTime() - meeting.lead.receivedAt.getTime())));
      const rows: Prisma.MeetingHistoryCreateManyInput[] = [{
        id: stableId(`meeting-history:${meeting.ordinal}:1`),
        workspaceId: references.workspaceId,
        meetingId: meeting.id,
        leadId: meeting.lead.id,
        ownerMemberId: meeting.ownerMemberId,
        meetingRevision: 1,
        action: "SCHEDULED",
        newStatus: "SCHEDULED",
        newStartsAt: meeting.startsAt,
        newEndsAt: meeting.endsAt,
        reason: "Agendamento interno fictício CRM-29.",
        occurredAt: scheduledAt,
        recordedByActorId: references.systemActorId,
        createdAt: scheduledAt,
      }];
      if (meeting.status !== "SCHEDULED") rows.push({
        id: stableId(`meeting-history:${meeting.ordinal}:2`),
        workspaceId: references.workspaceId,
        meetingId: meeting.id,
        leadId: meeting.lead.id,
        ownerMemberId: meeting.ownerMemberId,
        meetingRevision: 2,
        action: meeting.status === "CONFIRMED" ? "CONFIRMED" : meeting.status === "COMPLETED" ? "ATTENDED" : meeting.status === "NO_SHOW" ? "NO_SHOW" : "CANCELLED",
        previousStatus: "SCHEDULED",
        newStatus: meeting.status,
        previousStartsAt: meeting.startsAt,
        previousEndsAt: meeting.endsAt,
        newStartsAt: meeting.startsAt,
        newEndsAt: meeting.endsAt,
        reason: meeting.status === "NO_SHOW" ? "Lead fictício não compareceu." : meeting.status === "CANCELLED" ? "Cancelamento fictício informado antes do horário." : "Atualização fictícia de reunião.",
        outcome: meeting.status === "COMPLETED" ? "Reunião realizada e contexto validado." : null,
        occurredAt: meeting.status === "CONFIRMED" ? addMilliseconds(meeting.startsAt, -12 * 60 * minuteMs) : meeting.terminalAt!,
        recordedByActorId: references.systemActorId,
        createdAt: meeting.status === "CONFIRMED" ? addMilliseconds(meeting.startsAt, -12 * 60 * minuteMs) : meeting.terminalAt!,
      });
      return rows;
    });
    await transaction.meetingHistory.createMany({ data: meetingHistory });

    const offers: Prisma.OfferCreateManyInput[] = opportunities.filter((opportunity) => ["PROPOSAL", "NEGOTIATION", "WON", "LOST"].includes(opportunity.currentStageCode)).map((opportunity) => ({
      id: stableId(`offer:${opportunity.ordinal}`),
      workspaceId: references.workspaceId,
      opportunityId: opportunity.id,
      productId: opportunity.productId,
      offerTemplateId: references.offerTemplateIdsByProduct.get(opportunity.productId) ?? null,
      name: `Proposta fictícia ${String(opportunity.ordinal).padStart(3, "0")}`,
      quantity: 1,
      unitPriceCents: opportunity.amountCents,
      discountCents: 0n,
      totalCents: opportunity.amountCents,
      justification: "Valor demonstrativo configurado no catálogo local.",
      validUntil: addMilliseconds(opportunity.createdAt, 15 * dayMs),
      acceptedAt: opportunity.status === "WON" ? opportunity.closedAt : null,
      createdByActorId: references.systemActorId,
      updatedByActorId: references.systemActorId,
      createdAt: addMilliseconds(opportunity.createdAt, 30 * minuteMs),
      updatedAt: opportunity.closedAt ?? addMilliseconds(opportunity.createdAt, 30 * minuteMs),
    }));
    await transaction.offer.createMany({ data: offers });

    const outcomeSnapshots: Prisma.OpportunityOutcomeSnapshotCreateManyInput[] = opportunities.filter((opportunity) => opportunity.status !== "OPEN").map((opportunity) => ({
      id: stableId(`outcome-snapshot:${opportunity.ordinal}`),
      workspaceId: references.workspaceId,
      opportunityId: opportunity.id,
      leadId: opportunity.lead.id,
      stageHistoryId: stableId(`stage-history:opportunity:${opportunity.ordinal}:${opportunity.stageSequence.length}`),
      ownerMemberId: opportunity.ownerMemberId,
      productId: opportunity.productId,
      status: opportunity.status === "WON" ? "WON" : "LOST",
      amountCents: opportunity.amountCents,
      mrrCents: opportunity.mrrCents,
      tcvCents: opportunity.tcvCents,
      lossReasonId: opportunity.lossReasonId,
      occurredAt: opportunity.closedAt!,
      createdByActorId: references.systemActorId,
      createdAt: opportunity.closedAt!,
    }));
    await transaction.opportunityOutcomeSnapshot.createMany({ data: outcomeSnapshots });

    const automationLeads = leads.filter(({ ordinal }) => ordinal % 5 === 0);
    const automationRuns: Prisma.AutomationRunCreateManyInput[] = automationLeads.map((lead, index) => {
      const rule = references.automationRules[index % references.automationRules.length]!;
      const status = index % 12 === 10 ? "FAILED" : index % 12 === 11 ? "CANCELLED" : "SUCCEEDED";
      const triggeredAt = addMilliseconds(lead.receivedAt, 2 * minuteMs);
      const startedAt = addMilliseconds(triggeredAt, 1_000);
      const finishedAt = addMilliseconds(startedAt, 500);
      return {
        id: stableId(`automation-run:${lead.ordinal}`),
        workspaceId: references.workspaceId,
        automationRuleId: rule.id,
        leadId: lead.id,
        meetingId: meetingByLeadId.get(lead.id)?.id ?? null,
        opportunityId: opportunityByLeadId.get(lead.id)?.id ?? null,
        actorId: references.automationActorId,
        status,
        idempotencyKey: `${CRM29_DEMO_NAMESPACE}:automation:${lead.ordinal}`,
        ruleVersion: rule.version,
        triggerType: rule.triggerType,
        actionType: rule.actionType,
        conditionsSnapshot: rule.conditions,
        actionConfigSnapshot: rule.actionConfig,
        triggeredAt,
        startedAt,
        finishedAt,
        inputPayload: { dataset: CRM29_DEMO_NAMESPACE, leadId: lead.id, simulated: true },
        outputPayload: status === "SUCCEEDED" ? { simulated: true, result: "Efeito local registrado." } : Prisma.DbNull,
        errorCode: status === "FAILED" ? "DEMO_CONTROLLED_FAILURE" : null,
        errorMessage: status === "FAILED" ? "Falha controlada para inspeção local." : null,
        cancelledAt: status === "CANCELLED" ? finishedAt : null,
        createdAt: triggeredAt,
      };
    });
    await transaction.automationRun.createMany({ data: automationRuns });

    const insightLeads = leads.slice(0, 48);
    const aiInsights: Prisma.AIInsightCreateManyInput[] = insightLeads.map((lead, index) => ({
      id: stableId(`ai-insight:${index + 1}`),
      workspaceId: references.workspaceId,
      leadId: lead.id,
      targetType: "LEAD",
      ...demoAIInsightContent(lead, index),
      engine: "RULE_ENGINE",
      engineVersion: "local-deterministic-v1",
      requestedProviderKey: "mock",
      providerKey: "mock",
      providerMode: "LOCAL_DETERMINISTIC",
      promptVersion: 1,
      requestFingerprint: fingerprint(`ai-insight:${index + 1}`),
      durationMs: 5,
      status: index % 5 === 0 ? "ACCEPTED" : "OPEN",
      title: "Insight local simulado",
      requiresConfirmation: true,
      requestedByActorId: lead.actorId,
      createdByActorId: references.aiActorId,
      confirmedByActorId: index % 5 === 0 ? lead.actorId : null,
      confirmedAt: index % 5 === 0 ? addMilliseconds(lead.receivedAt, 35 * minuteMs) : null,
      createdAt: addMilliseconds(lead.receivedAt, 30 * minuteMs),
    }));
    await transaction.aIInsight.createMany({ data: aiInsights });

    const violationRows: Prisma.ProcessViolationCreateManyInput[] = [];
    for (const lead of leads) {
      if (lead.attemptSeconds === null || lead.attemptSeconds > 180) violationRows.push({
        id: stableId(`violation:sla:${lead.ordinal}`), workspaceId: references.workspaceId,
        type: "SLA_VIOLATED", severity: lead.attemptSeconds === null ? "CRITICAL" : "HIGH", status: "OPEN",
        fingerprint: `${CRM29_DEMO_NAMESPACE}:sla:${lead.ordinal}`, leadId: lead.id,
        slaCycleId: stableId(`sla-cycle:${lead.ordinal}`), title: "SLA imediato violado",
        evidenceSummary: lead.attemptSeconds === null ? "Lead fictício permanece sem tentativa." : `Primeira tentativa fictícia em ${lead.attemptSeconds} segundos.`,
        evidence: { receivedAt: lead.receivedAt.toISOString(), firstHumanAttemptSeconds: lead.attemptSeconds, simulated: true },
        detectedAt: anchor, lastDetectedAt: anchor, detectedByActorId: references.systemActorId,
        createdAt: anchor, updatedAt: anchor,
      });
      if (lead.isStagnant) violationRows.push({
        id: stableId(`violation:stagnant:${lead.ordinal}`), workspaceId: references.workspaceId,
        type: "LEAD_STAGNANT", severity: "MEDIUM", status: "OPEN",
        fingerprint: `${CRM29_DEMO_NAMESPACE}:stagnant:${lead.ordinal}`, leadId: lead.id,
        title: "Lead parado", evidenceSummary: "Última atividade fictícia ultrapassou o limite configurado.",
        evidence: { lastActivityAt: lead.lastActivityAt.toISOString(), simulated: true },
        detectedAt: anchor, lastDetectedAt: anchor, detectedByActorId: references.systemActorId,
        createdAt: anchor, updatedAt: anchor,
      });
      if (lead.lacksNextAction) violationRows.push({
        id: stableId(`violation:next-action:${lead.ordinal}`), workspaceId: references.workspaceId,
        type: "LEAD_WITHOUT_NEXT_ACTION", severity: "HIGH", status: "OPEN",
        fingerprint: `${CRM29_DEMO_NAMESPACE}:next-action:${lead.ordinal}`, leadId: lead.id,
        title: "Lead sem próxima ação", evidenceSummary: "Projeção de próxima ação ausente no cenário controlado.",
        evidence: { nextActionTaskId: null, simulated: true }, detectedAt: anchor, lastDetectedAt: anchor,
        detectedByActorId: references.systemActorId, createdAt: anchor, updatedAt: anchor,
      });
    }
    await transaction.processViolation.createMany({ data: violationRows });

    const auditRows: Prisma.AuditLogCreateManyInput[] = leads.flatMap((lead) => [{
      id: stableId(`audit:lead:${lead.ordinal}:created`), workspaceId: references.workspaceId,
      actorId: references.systemActorId, action: "demo.lead.created", entityType: "Lead", entityId: lead.id,
      origin: "SEED", reason: "Base fictícia CRM-29", occurredAt: lead.receivedAt, requestId: CRM29_DEMO_NAMESPACE,
      changes: { after: { priority: lead.priorityBandCode, stage: lead.stageCode, simulated: true } },
      metadata: { dataset: CRM29_DEMO_NAMESPACE, ordinal: lead.ordinal },
    }, {
      id: stableId(`audit:lead:${lead.ordinal}:assigned`), workspaceId: references.workspaceId,
      actorId: references.systemActorId, action: "demo.lead.assigned", entityType: "Lead", entityId: lead.id,
      origin: "SEED", reason: lead.queueId ? "Fallback explícito para Fila Geral" : "Round-robin fictício",
      occurredAt: addMilliseconds(lead.receivedAt, 1_000), requestId: CRM29_DEMO_NAMESPACE,
      changes: { after: { ownerMemberId: lead.ownerMemberId, queueId: lead.queueId } },
      metadata: { dataset: CRM29_DEMO_NAMESPACE, simulated: true },
    } satisfies Prisma.AuditLogCreateManyInput]);
    auditRows.push(...opportunities.map((opportunity): Prisma.AuditLogCreateManyInput => ({
      id: stableId(`audit:opportunity:${opportunity.ordinal}`), workspaceId: references.workspaceId,
      actorId: references.systemActorId, action: opportunity.status === "OPEN" ? "demo.opportunity.created" : `demo.opportunity.${opportunity.status.toLowerCase()}`,
      entityType: "Opportunity", entityId: opportunity.id, origin: "SEED", reason: "Histórico comercial fictício CRM-29",
      occurredAt: opportunity.closedAt ?? opportunity.createdAt, requestId: CRM29_DEMO_NAMESPACE,
      changes: { after: { status: opportunity.status, amountCents: opportunity.amountCents.toString(), simulated: true } },
      metadata: { dataset: CRM29_DEMO_NAMESPACE, leadId: opportunity.lead.id },
    })));
    auditRows.push({
      id: stableId("audit:dataset"), workspaceId: references.workspaceId, actorId: references.systemActorId,
      action: "seed.crm29_demo_dataset.created", entityType: "Workspace", entityId: references.workspaceId,
      origin: "SEED", reason: "Base demonstrativa temporalmente relativa e fictícia.", occurredAt: anchor,
      requestId: CRM29_DEMO_NAMESPACE, changes: { datasetVersion: CRM29_DEMO_DATASET_VERSION, leads: leads.length },
      metadata: { dataset: CRM29_DEMO_NAMESPACE, simulated: true, containsOperationalLeads: true },
    });
    await transaction.auditLog.createMany({ data: auditRows });

    return expectedResult(references, anchor, leads, meetings, opportunities, {
      tasks: immediateTasks.length + followUpTasks.length + opportunityTasks.length,
      activities: activities.length,
      qualifications: qualifiedLeads.length,
      stageHistories: leadStageRows.length + opportunityStageRows.length,
      automationRuns: automationRuns.length,
      aiInsights: aiInsights.length,
      auditLogs: auditRows.length,
    });
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

export function assertSafeDemoResetTarget(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Readonly<{ databaseUrl: string; schema: string }> {
  assertDemoSeedEnvironment(environment);
  const databaseUrl = environment.DATABASE_URL!;
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get("schema") ?? "public";
  const expectedConfirmation = `RESET ${schema}`;
  if (!/^politizai_demo(?:_[a-z0-9_]+)?$/.test(schema) || environment.DEMO_RESET_CONFIRM !== expectedConfirmation) {
    throw new ApplicationError(
      `Reset recusado. Use um schema politizai_demo* e DEMO_RESET_CONFIRM=\"${expectedConfirmation}\".`,
      { code: "DEMO_RESET_NOT_CONFIRMED", statusCode: 400, expose: true },
    );
  }
  return Object.freeze({ databaseUrl, schema });
}
