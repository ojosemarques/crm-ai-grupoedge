import { createHash } from "node:crypto";

import type {
  Prisma,
  PrismaClient,
  TeamFunction,
} from "@/generated/prisma/client";
import { hashPassword } from "@/modules/auth/domain/password";
import { initialAIUseCaseDefinitions, forbiddenAIInputFields, defaultAIExecutionLimits } from "@/modules/ai/domain/ai-governance-contracts";
import { AI_EVALUATION_DATASET_KEY, AI_EVALUATION_DATASET_VERSION, aiEvaluationDatasetV1 } from "@/modules/ai/evals/dataset-v1";
import { predefinedEntryAutomations } from "@/modules/automations/domain/predefined-entry-automations";
import { predefinedLifecycleAutomations } from "@/modules/automations/domain/predefined-lifecycle-automations";
import { lifecycleRuleDefinitions, LIFECYCLE_RULE_KEY, LIFECYCLE_RULE_VERSION } from "@/modules/lifecycle/domain/lifecycle-policy";
import { ensurePrivacyFoundation } from "@/modules/privacy/application/privacy-foundation";
import { LOCAL_MOCK_ADAPTER_KEY, LOCAL_MOCK_PROVIDER_KEY } from "@/modules/integrations/domain/integration-contracts";
import { canonicalJson, sha256 } from "@/modules/integrations/domain/integration-policy";
import { EMAIL_ADAPTER_KEY, EMAIL_CONTRACT_VERSION, EMAIL_PROVIDER_KEY } from "@/modules/integrations/domain/email-contracts";
import { TELEPHONY_ADAPTER_KEY, TELEPHONY_CONNECTION_KEY, TELEPHONY_CONTRACT_VERSION, TELEPHONY_PROVIDER_KEY } from "@/modules/integrations/domain/telephony-contracts";
import { CALENDAR_ADAPTER_KEY, CALENDAR_CONNECTION_KEY, CALENDAR_CONTRACT_VERSION, CALENDAR_PROVIDER_KEY } from "@/modules/integrations/domain/calendar-contracts";
import {
  WHATSAPP_ADAPTER_KEY,
  WHATSAPP_CONTRACT_VERSION,
  WHATSAPP_DEFAULT_GRAPH_API_VERSION,
  WHATSAPP_POLICY_REVIEW_TRIGGER,
  WHATSAPP_POLICY_SOURCE_OBSERVED_AT,
  WHATSAPP_POLICY_SOURCE_URL,
  WHATSAPP_POLITIZAI_INELIGIBILITY_RATIONALE,
  WHATSAPP_POLITIZAI_POLICY_SCOPE,
  WHATSAPP_PROVIDER_KEY,
  WHATSAPP_SECRET_REFERENCES,
  whatsAppWebhookKey,
} from "@/modules/integrations/domain/whatsapp-contracts";
import { ensureAttributionModelsInTransaction } from "@/modules/marketing/application/marketing-attribution-service";
import {
  AccessRoleKeys,
  permissionCatalog,
  type PermissionKey,
} from "@/modules/users/permissions/permission-keys";
import { defaultRoleDefinitions as roleDefinitions, type AccessRoleKey } from "@/modules/users/permissions/default-role-definitions";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const DEMO_WORKSPACE_SLUG = "politizai";
export const DEMO_SEED_PASSWORD = "Politizai#Local2026";
export const DEMO_SEED_VERSION = 1;

export const DEMO_USERS = [
  {
    key: "admin",
    email: "admin@demo.politizai.local",
    displayName: "Administrador de demonstração",
    roleKey: AccessRoleKeys.ADMINISTRATOR,
    teams: [] as const,
  },
  {
    key: "gestor",
    email: "gestor@demo.politizai.local",
    displayName: "Gestor comercial de demonstração",
    roleKey: AccessRoleKeys.COMMERCIAL_MANAGER,
    teams: [
      ["pre-sales", "MANAGER"],
      ["sales", "MANAGER"],
    ] as const,
  },
  {
    key: "sdr-1",
    email: "sdr1@demo.politizai.local",
    displayName: "SDR 1 de demonstração",
    roleKey: AccessRoleKeys.SDR,
    teams: [["pre-sales", "SDR"]] as const,
  },
  {
    key: "sdr-2",
    email: "sdr2@demo.politizai.local",
    displayName: "SDR 2 de demonstração",
    roleKey: AccessRoleKeys.SDR,
    teams: [["pre-sales", "SDR"]] as const,
  },
  {
    key: "sdr-3",
    email: "sdr3@demo.politizai.local",
    displayName: "SDR 3 de demonstração",
    roleKey: AccessRoleKeys.SDR,
    teams: [["pre-sales", "SDR"]] as const,
  },
  {
    key: "closer-1",
    email: "closer1@demo.politizai.local",
    displayName: "Closer 1 de demonstração",
    roleKey: AccessRoleKeys.CLOSER,
    teams: [["sales", "CLOSER"]] as const,
  },
  {
    key: "closer-2",
    email: "closer2@demo.politizai.local",
    displayName: "Closer 2 de demonstração",
    roleKey: AccessRoleKeys.CLOSER,
    teams: [["sales", "CLOSER"]] as const,
  },
  {
    key: "viewer",
    email: "viewer@demo.politizai.local",
    displayName: "Visualizador de demonstração",
    roleKey: AccessRoleKeys.VIEWER,
    teams: [] as const,
  },
] as const;

const teamDefinitions = [
  {
    key: "pre-sales",
    name: "Pré-vendas",
    description: "Gestor comercial e SDRs responsáveis pela entrada e qualificação.",
  },
  {
    key: "sales",
    name: "Vendas",
    description: "Gestor comercial e closers responsáveis por reuniões e negócios.",
  },
] as const;

const pipelineDefinitions = [
  {
    key: "pre-sales",
    name: "Pré-vendas",
    entityType: "LEAD",
    stages: [
      ["new", "Novo", "OPEN", "NEW", null],
      ["contact-attempt", "Tentando contato", "OPEN", "TRYING_CONTACT", null],
      ["contacted", "Conectado", "OPEN", "CONNECTED", null],
      ["pacto", "Em qualificação", "OPEN", "IN_QUALIFICATION", null],
      ["sales-qualified", "Qualificado", "WON", "QUALIFIED", null],
      ["meeting-scheduled", "Reunião agendada", "OPEN", "MEETING_SCHEDULED", null],
      ["nurturing", "Nutrição", "OPEN", "NURTURING", null],
      ["disqualified", "Desqualificado", "LOST", "DISQUALIFIED", null],
    ],
    transitions: [
      ["NEW", "TRYING_CONTACT"],
      ["NEW", "CONNECTED"],
      ["NEW", "DISQUALIFIED"],
      ["TRYING_CONTACT", "CONNECTED"],
      ["TRYING_CONTACT", "NURTURING"],
      ["TRYING_CONTACT", "DISQUALIFIED"],
      ["CONNECTED", "IN_QUALIFICATION"],
      ["CONNECTED", "NURTURING"],
      ["CONNECTED", "DISQUALIFIED"],
      ["IN_QUALIFICATION", "CONNECTED"],
      ["IN_QUALIFICATION", "QUALIFIED"],
      ["IN_QUALIFICATION", "NURTURING"],
      ["IN_QUALIFICATION", "DISQUALIFIED"],
      ["QUALIFIED", "MEETING_SCHEDULED"],
      ["QUALIFIED", "NURTURING"],
      ["QUALIFIED", "DISQUALIFIED"],
      ["MEETING_SCHEDULED", "QUALIFIED"],
      ["MEETING_SCHEDULED", "NURTURING"],
      ["MEETING_SCHEDULED", "DISQUALIFIED"],
      ["NURTURING", "TRYING_CONTACT"],
      ["NURTURING", "CONNECTED"],
      ["NURTURING", "IN_QUALIFICATION"],
      ["NURTURING", "DISQUALIFIED"],
    ],
  },
  {
    key: "sales",
    name: "Vendas",
    entityType: "OPPORTUNITY",
    stages: [
      ["meeting-scheduled", "Reunião agendada", "OPEN", null, "MEETING_SCHEDULED"],
      ["meeting-held", "Reunião realizada", "OPEN", null, "MEETING_HELD"],
      ["opportunity-confirmed", "Oportunidade confirmada", "OPEN", null, "OPPORTUNITY_CONFIRMED"],
      ["proposal", "Proposta", "OPEN", null, "PROPOSAL"],
      ["negotiation", "Negociação", "OPEN", null, "NEGOTIATION"],
      ["won", "Ganho", "WON", null, "WON"],
      ["lost", "Perdido", "LOST", null, "LOST"],
    ],
    transitions: [
      ["MEETING_SCHEDULED", "MEETING_HELD"],
      ["MEETING_SCHEDULED", "LOST"],
      ["MEETING_HELD", "OPPORTUNITY_CONFIRMED"],
      ["MEETING_HELD", "LOST"],
      ["OPPORTUNITY_CONFIRMED", "PROPOSAL"],
      ["OPPORTUNITY_CONFIRMED", "LOST"],
      ["PROPOSAL", "NEGOTIATION"],
      ["PROPOSAL", "LOST"],
      ["NEGOTIATION", "WON"],
      ["NEGOTIATION", "LOST"],
    ],
  },
] as const;

const lossReasonDefinitions = [
  ["no-budget", "Sem orçamento"],
  ["no-priority", "Sem prioridade no momento"],
  ["competitor", "Escolheu outra solução"],
  ["no-response", "Sem retorno"],
  ["timing", "Momento inadequado"],
] as const;

const disqualificationReasonDefinitions = [
  ["outside-profile", "Fora do perfil atendido"],
  ["no-clear-problem", "Sem problema claro"],
  ["no-authority", "Sem acesso à autoridade"],
  ["no-timing", "Sem timing definido"],
  ["invalid-data", "Dados inválidos"],
] as const;

const slaDefinitions = [
  {
    key: "p1-immediate",
    name: "SLA imediato — 0 minutos",
    firstResponseMinutes: 0,
    warningMinutesBeforeDue: 0,
    healthyMaxSeconds: 60,
    attentionMaxSeconds: 180,
  },
  {
    key: "p2-priority",
    name: "SLA imediato — 0 minutos",
    firstResponseMinutes: 0,
    warningMinutesBeforeDue: 0,
    healthyMaxSeconds: 60,
    attentionMaxSeconds: 180,
  },
  {
    key: "p3-standard",
    name: "SLA imediato — 0 minutos",
    firstResponseMinutes: 0,
    warningMinutesBeforeDue: 0,
    healthyMaxSeconds: 60,
    attentionMaxSeconds: 180,
  },
] as const;

const priorityBandDefinitions = [
  {
    code: "P1",
    name: "P1 — atendimento imediato",
    position: 0,
    scoreMin: 70,
    scoreMax: 100,
    leadPriority: "URGENT",
    slaKey: "p1-immediate",
  },
  {
    code: "P2",
    name: "P2 — atendimento prioritário",
    position: 1,
    scoreMin: 40,
    scoreMax: 69,
    leadPriority: "HIGH",
    slaKey: "p2-priority",
  },
  {
    code: "P3",
    name: "P3 — atendimento padrão",
    position: 2,
    scoreMin: 0,
    scoreMax: 39,
    leadPriority: "MEDIUM",
    slaKey: "p3-standard",
  },
] as const;

const scoringRuleDefinition = {
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
} as const;

const productDefinitions = [
  {
    key: "diagnosis",
    sku: "DEMO-DIAGNOSTICO",
    name: "Diagnóstico estratégico",
    description: "Produto fictício para desenvolvimento local.",
    listPriceCents: 350_000n,
  },
  {
    key: "positioning",
    sku: "DEMO-POSICIONAMENTO",
    name: "Projeto de posicionamento",
    description: "Produto fictício para desenvolvimento local.",
    listPriceCents: 1_200_000n,
  },
  {
    key: "advisory",
    sku: "DEMO-ACOMPANHAMENTO",
    name: "Acompanhamento estratégico mensal",
    description: "Produto fictício para desenvolvimento local.",
    listPriceCents: 800_000n,
  },
] as const;

const offerTemplateDefinitions = [
  {
    key: "diagnosis-standard",
    productKey: "diagnosis",
    name: "Diagnóstico inicial",
    description: "Oferta fictícia, editável e válida somente no ambiente local.",
    priceCents: 350_000n,
    discountCents: 0n,
    validDays: 15,
  },
  {
    key: "positioning-launch",
    productKey: "positioning",
    name: "Projeto de posicionamento — demonstração",
    description: "Oferta fictícia, editável e válida somente no ambiente local.",
    priceCents: 1_200_000n,
    discountCents: 120_000n,
    validDays: 20,
  },
  {
    key: "advisory-local",
    productKey: "advisory",
    name: "Acompanhamento mensal — demonstração",
    description: "Oferta fictícia, editável e válida somente no ambiente local.",
    priceCents: 800_000n,
    discountCents: 80_000n,
    validDays: 10,
  },
] as const;

const sourceDefinitions = [
  ["manual", "Cadastro manual", "MANUAL"],
  ["website", "Formulário do site", "FORM"],
  ["referral", "Indicação", "REFERRAL"],
  ["paid-media", "Mídia paga de demonstração", "PAID_MEDIA"],
  ["organic", "Conteúdo orgânico", "ORGANIC"],
] as const;

const campaignDefinitions = [
  {
    key: "institutional",
    name: "Demonstração — aquisição institucional",
    externalRef: "demo:campaign:institutional",
    creatives: [
      ["institutional-video", "Vídeo institucional"],
      ["institutional-guide", "Guia de comunicação pública"],
    ],
  },
  {
    key: "educational-content",
    name: "Demonstração — conteúdo educativo",
    externalRef: "demo:campaign:educational-content",
    creatives: [
      ["pacto-guide", "Guia PACTO"],
      ["commercial-checklist", "Checklist comercial"],
    ],
  },
] as const;

function stableSeedId(key: string): string {
  const hash = createHash("sha256")
    .update(`politizai-crm-demo-v${DEMO_SEED_VERSION}:${key}`)
    .digest("hex")
    .split("");
  hash[12] = "5";
  hash[16] = ((Number.parseInt(hash[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = hash.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

async function ensureAIGovernanceFoundation(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  ownerMemberId: string,
  adminActorId: string,
) {
  for (const definition of initialAIUseCaseDefinitions) {
    const versionId = stableSeedId(`ai-use-case:${definition.key}:v1`);
    const existing = await transaction.aIUseCaseVersion.findFirst({
      where: { workspaceId, key: definition.key, version: 1 },
      select: { id: true },
    });
    if (existing) continue;
    await transaction.aIUseCaseVersion.create({
      data: {
        id: versionId,
        workspaceId,
        key: definition.key,
        version: 1,
        name: definition.name,
        description: definition.description,
        ownerMemberId,
        riskLevel: definition.riskLevel,
        agentType: definition.agentType,
        logicalProviderKey: "mock",
        logicalModel: "politizai-rules-v1",
        promptKey: definition.promptKey,
        promptVersion: definition.promptVersion,
        configurationVersion: 1,
        inputSchemaVersion: 1,
        outputSchemaVersion: 1,
        allowedInputFields: [...definition.allowedInputFields],
        forbiddenInputFields: [...forbiddenAIInputFields],
        confidenceThresholdBps: defaultAIExecutionLimits.confidenceThresholdBps,
        fallbackPolicy: "LOCAL_DETERMINISTIC",
        timeoutMs: defaultAIExecutionLimits.timeoutMs,
        maxRetries: defaultAIExecutionLimits.maxRetries,
        rateLimitPerMinute: defaultAIExecutionLimits.rateLimitPerMinute,
        maxInputTokens: defaultAIExecutionLimits.maxInputTokens,
        maxOutputTokens: defaultAIExecutionLimits.maxOutputTokens,
        maxEstimatedCostCents: defaultAIExecutionLimits.maxEstimatedCostCents,
        status: "APPROVED",
        approvedByActorId: adminActorId,
        approvedAt: new Date("2026-09-13T00:00:00.000Z"),
        approvalReason: "Avaliação local determinística inicial aprovada para o ambiente de demonstração.",
        createdByActorId: adminActorId,
      },
    });
    for (const [index, transition] of [
      [null, "DRAFT", "Versão inicial criada."],
      ["DRAFT", "EVALUATED", "Dataset local determinístico aprovado."],
      ["EVALUATED", "APPROVED", "Uso local aprovado pelo administrador de demonstração."],
    ].entries()) {
      const [fromStatus, toStatus, reason] = transition as ["DRAFT" | "EVALUATED" | null, "DRAFT" | "EVALUATED" | "APPROVED", string];
      await transaction.aIGovernanceEvent.create({
        data: {
          id: stableSeedId(`ai-governance-event:${definition.key}:${index}`),
          workspaceId,
          useCaseVersionId: versionId,
          fromStatus,
          toStatus,
          reason,
          createdByActorId: adminActorId,
        },
      });
    }
    const runId = stableSeedId(`ai-evaluation:${definition.key}:v1`);
    await transaction.aIEvaluationRun.create({
      data: {
        id: runId,
        workspaceId,
        useCaseVersionId: versionId,
        datasetKey: AI_EVALUATION_DATASET_KEY,
        datasetVersion: AI_EVALUATION_DATASET_VERSION,
        status: "PASSED",
        totalCases: aiEvaluationDatasetV1.length,
        passedCases: aiEvaluationDatasetV1.length,
        failedCases: 0,
        durationMs: 0,
        inputFingerprint: createHash("sha256").update(`${definition.key}:dataset:v1`).digest("hex"),
        createdByActorId: adminActorId,
        completedAt: new Date("2026-09-13T00:00:00.000Z"),
        results: {
          create: aiEvaluationDatasetV1.map((testCase) => ({
            id: stableSeedId(`ai-evaluation:${definition.key}:v1:${testCase.key}`),
            caseKey: testCase.key,
            category: testCase.category,
            passed: true,
            reasonCode: testCase.expectedReasonCode,
            safeEvidence: { mode: "LOCAL_DETERMINISTIC", containsPayload: false },
            durationMs: 0,
          })),
        },
      },
    });
  }
}

async function ensureLocalIntegrationFoundation(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
) {
  const key = "local-mock";
  const id = stableSeedId(`integration:${key}`);
  const config = { mode: "LOCAL_DETERMINISTIC", pageSize: 25, fault: "NONE" };
  const connection = await transaction.integrationConnection.upsert({
    where: { workspaceId_key: { workspaceId, key } },
    create: {
      id, workspaceId, key, providerKey: LOCAL_MOCK_PROVIDER_KEY,
      adapterKey: LOCAL_MOCK_ADAPTER_KEY, displayName: "Adaptador local determinístico",
      environment: "LOCAL", status: "READY_FOR_LOCAL_TEST", capabilityLevel: "IMPLEMENTED",
      createdByActorId: actorId, updatedByActorId: actorId,
    },
    update: {},
  });
  await transaction.integrationConnectionConfigVersion.upsert({
    where: { workspaceId_connectionId_version: { workspaceId, connectionId: connection.id, version: 1 } },
    create: {
      id: stableSeedId(`integration-config:${key}:1`), workspaceId, connectionId: connection.id,
      version: 1, schemaVersion: "1.0", config,
      configHash: sha256(canonicalJson(config)), createdByActorId: actorId,
    },
    update: {},
  });
  for (const capability of ["WEBHOOK_RECEIVE", "SYNC_PULL", "SYNC_PUSH", "OBJECT_MAPPING"] as const) {
    await transaction.integrationConnectionCapability.upsert({
      where: { workspaceId_connectionId_capability: { workspaceId, connectionId: connection.id, capability } },
      create: { id: stableSeedId(`integration-capability:${key}:${capability}`), workspaceId, connectionId: connection.id, capability },
      update: {},
    });
  }
}

async function ensureWhatsAppLocalFoundation(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
) {
  const key = "whatsapp-cloud-api";
  const id = stableSeedId(`integration:${key}`);
  const config = {
    graphApiVersion: WHATSAPP_DEFAULT_GRAPH_API_VERSION,
    businessAccountId: null,
    businessPortfolioId: null,
    phoneNumberId: null,
    displayPhoneMasked: null,
    timeZone: "America/Sao_Paulo",
    locale: "pt-BR",
    operatingMode: "LOCAL_SIMULATOR",
  };
  const connection = await transaction.integrationConnection.upsert({
    where: { workspaceId_key: { workspaceId, key } },
    create: {
      id, workspaceId, key, providerKey: WHATSAPP_PROVIDER_KEY,
      adapterKey: WHATSAPP_ADAPTER_KEY, displayName: "WhatsApp — simulador local",
      environment: "LOCAL", status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY",
      enabled: true, createdByActorId: actorId, updatedByActorId: actorId,
    },
    update: {},
  });
  await transaction.integrationConnectionConfigVersion.upsert({
    where: { workspaceId_connectionId_version: { workspaceId, connectionId: connection.id, version: 1 } },
    create: {
      id: stableSeedId(`integration-config:${key}:1`), workspaceId, connectionId: connection.id,
      version: 1, schemaVersion: WHATSAPP_CONTRACT_VERSION, config,
      configHash: sha256(canonicalJson(config)), createdByActorId: actorId,
    },
    update: {},
  });
  for (const capability of ["WEBHOOK_RECEIVE", "SYNC_PUSH", "OBJECT_MAPPING"] as const) {
    await transaction.integrationConnectionCapability.upsert({
      where: { workspaceId_connectionId_capability: { workspaceId, connectionId: connection.id, capability } },
      create: { id: stableSeedId(`integration-capability:${key}:${capability}`), workspaceId, connectionId: connection.id, capability },
      update: {},
    });
  }
  for (const [name, reference] of Object.entries(WHATSAPP_SECRET_REFERENCES)) {
    await transaction.integrationSecretReference.upsert({
      where: { workspaceId_connectionId_alias_version: { workspaceId, connectionId: connection.id, alias: reference.alias, version: 1 } },
      create: { id: stableSeedId(`integration-secret:${key}:${name}:1`), workspaceId, connectionId: connection.id, alias: reference.alias, referenceKey: reference.referenceKey, present: false, createdByActorId: actorId },
      update: {},
    });
  }
  const profile = await transaction.whatsAppConnectionProfile.upsert({
    where: { workspaceId_connectionId: { workspaceId, connectionId: connection.id } },
    create: {
      id: stableSeedId(`whatsapp-profile:${key}`), workspaceId, connectionId: connection.id, webhookKey: whatsAppWebhookKey(workspaceId), graphApiVersion: WHATSAPP_DEFAULT_GRAPH_API_VERSION,
      operatingMode: "LOCAL_SIMULATOR", policyEligibility: "INELIGIBLE", policyDecisionScope: WHATSAPP_POLITIZAI_POLICY_SCOPE,
      policyDecisionRationale: WHATSAPP_POLITIZAI_INELIGIBILITY_RATIONALE, policySourceUrl: WHATSAPP_POLICY_SOURCE_URL,
      policySourceObservedAt: new Date(WHATSAPP_POLICY_SOURCE_OBSERVED_AT), policyDecidedAt: new Date(WHATSAPP_POLICY_SOURCE_OBSERVED_AT), policyDecidedByActorId: actorId,
      policyReviewTrigger: WHATSAPP_POLICY_REVIEW_TRIGGER, alternativeChannel: "PHONE", alternativeChannelStatus: "AUTHORIZED",
      alternativeChannelDetail: "Contato humano manual por telefone, com registro da atividade no CRM; sem envio automatizado ou provider externo implícito.",
      createdByActorId: actorId, updatedByActorId: actorId,
    },
    update: {},
  });
  const policyDecisionId = stableSeedId(`whatsapp-policy-decision:${key}:2026-09-30`);
  const existingPolicyDecision = await transaction.whatsAppPolicyDecision.findUnique({ where: { id: policyDecisionId }, select: { id: true } });
  if (!existingPolicyDecision) {
    await transaction.whatsAppPolicyDecision.create({ data: {
      id: policyDecisionId, workspaceId, profileId: profile.id,
      eligibility: "INELIGIBLE", scope: WHATSAPP_POLITIZAI_POLICY_SCOPE, rationale: WHATSAPP_POLITIZAI_INELIGIBILITY_RATIONALE,
      sourceUrl: WHATSAPP_POLICY_SOURCE_URL, sourceObservedAt: new Date(WHATSAPP_POLICY_SOURCE_OBSERVED_AT),
      reviewTrigger: WHATSAPP_POLICY_REVIEW_TRIGGER, alternativeChannel: "PHONE", alternativeChannelStatus: "AUTHORIZED",
      alternativeChannelDetail: "Contato humano manual por telefone, com registro da atividade no CRM; sem envio automatizado ou provider externo implícito.",
      decidedByActorId: actorId, decidedAt: new Date(WHATSAPP_POLICY_SOURCE_OBSERVED_AT),
    } });
  }
}

async function ensureEmailLocalFoundation(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
) {
  const key = "email-local-sink";
  const senderAddress = "crm@demo.politizai.local";
  const config = { operatingMode: "LOCAL_SINK", senderAddress, replyTo: null, domain: "demo.politizai.local", externalEgress: false };
  const connection = await transaction.integrationConnection.upsert({
    where: { workspaceId_key: { workspaceId, key } },
    create: { id: stableSeedId(`integration:${key}`), workspaceId, key, providerKey: EMAIL_PROVIDER_KEY, adapterKey: EMAIL_ADAPTER_KEY, displayName: "E-mail — sink local", environment: "LOCAL", status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY", enabled: true, createdByActorId: actorId, updatedByActorId: actorId },
    update: {},
  });
  await transaction.integrationConnectionConfigVersion.upsert({
    where: { workspaceId_connectionId_version: { workspaceId, connectionId: connection.id, version: 1 } },
    create: { id: stableSeedId(`integration-config:${key}:1`), workspaceId, connectionId: connection.id, version: 1, schemaVersion: EMAIL_CONTRACT_VERSION, config, configHash: sha256(canonicalJson(config)), createdByActorId: actorId },
    update: {},
  });
  for (const capability of ["WEBHOOK_RECEIVE", "SYNC_PUSH", "OBJECT_MAPPING"] as const) {
    await transaction.integrationConnectionCapability.upsert({ where: { workspaceId_connectionId_capability: { workspaceId, connectionId: connection.id, capability } }, create: { id: stableSeedId(`integration-capability:${key}:${capability}`), workspaceId, connectionId: connection.id, capability }, update: {} });
  }
  for (const [alias, referenceKey] of [["smtp-credential", "EMAIL_SMTP_CREDENTIAL"], ["webhook-secret", "EMAIL_WEBHOOK_SECRET"], ["unsubscribe-secret", "EMAIL_UNSUBSCRIBE_SECRET"]] as const) {
    await transaction.integrationSecretReference.upsert({ where: { workspaceId_connectionId_alias_version: { workspaceId, connectionId: connection.id, alias, version: 1 } }, create: { id: stableSeedId(`integration-secret:${key}:${alias}:1`), workspaceId, connectionId: connection.id, alias, referenceKey, present: false, createdByActorId: actorId }, update: {} });
  }
  const profile = await transaction.emailConnectionProfile.upsert({
    where: { workspaceId_connectionId: { workspaceId, connectionId: connection.id } },
    create: { id: stableSeedId(`email-profile:${key}`), workspaceId, connectionId: connection.id, operatingMode: "LOCAL_SINK", adapterVersion: EMAIL_CONTRACT_VERSION, senderAddress, senderAddressNormalized: senderAddress, displayName: "Politizai CRM", envelopeFrom: senderAddress, domain: "demo.politizai.local", spfStatus: "PENDING_EXTERNAL", dkimStatus: "PENDING_EXTERNAL", dmarcStatus: "PENDING_EXTERNAL", domainStatusProvenance: "LOCAL_FIXTURE_NOT_DNS", configuredAt: new Date(), createdByActorId: actorId, updatedByActorId: actorId },
    update: {},
  });
  const existingObservation = await transaction.emailDomainObservation.findFirst({ where: { workspaceId, profileId: profile.id, provenance: "LOCAL_FIXTURE_NOT_DNS" } });
  if (!existingObservation) await transaction.emailDomainObservation.create({ data: { id: stableSeedId(`email-domain-observation:${key}:1`), workspaceId, profileId: profile.id, domain: profile.domain, spfStatus: "PENDING_EXTERNAL", dkimStatus: "PENDING_EXTERNAL", dmarcStatus: "PENDING_EXTERNAL", alignmentStatus: "UNKNOWN", provenance: "LOCAL_FIXTURE_NOT_DNS", evidence: { externalDnsQueried: false, verified: false }, observedAt: new Date(), createdByActorId: actorId } });
}

async function ensureTelephonyLocalFoundation(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
) {
  const key = TELEPHONY_CONNECTION_KEY;
  const config = {
    operatingMode: "LOCAL_SIMULATOR",
    originatorLabel: "Politizai CRM local",
    timeZone: "America/Sao_Paulo",
    contactWindowStartMinute: 0,
    contactWindowEndMinute: 1440,
    contactWeekdays: [0, 1, 2, 3, 4, 5, 6],
    recordingEnabled: false,
    transcriptionEnabled: false,
    externalEgress: false,
  };
  const connection = await transaction.integrationConnection.upsert({
    where: { workspaceId_key: { workspaceId, key } },
    create: {
      id: stableSeedId(`integration:${key}`), workspaceId, key,
      providerKey: TELEPHONY_PROVIDER_KEY, adapterKey: TELEPHONY_ADAPTER_KEY,
      displayName: "Telefonia — simulador local", environment: "LOCAL",
      status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY", enabled: true,
      createdByActorId: actorId, updatedByActorId: actorId,
    },
    update: {},
  });
  await transaction.integrationConnectionConfigVersion.upsert({
    where: { workspaceId_connectionId_version: { workspaceId, connectionId: connection.id, version: 1 } },
    create: {
      id: stableSeedId(`integration-config:${key}:1`), workspaceId,
      connectionId: connection.id, version: 1, schemaVersion: TELEPHONY_CONTRACT_VERSION,
      config, configHash: sha256(canonicalJson(config)), createdByActorId: actorId,
    },
    update: {},
  });
  for (const capability of ["WEBHOOK_RECEIVE", "SYNC_PUSH", "OBJECT_MAPPING"] as const) {
    await transaction.integrationConnectionCapability.upsert({
      where: { workspaceId_connectionId_capability: { workspaceId, connectionId: connection.id, capability } },
      create: { id: stableSeedId(`integration-capability:${key}:${capability}`), workspaceId, connectionId: connection.id, capability },
      update: {},
    });
  }
  await transaction.telephonyConnectionProfile.upsert({
    where: { workspaceId_connectionId: { workspaceId, connectionId: connection.id } },
    create: {
      id: stableSeedId(`telephony-profile:${key}`), workspaceId, connectionId: connection.id,
      operatingMode: "LOCAL_SIMULATOR", adapterVersion: TELEPHONY_CONTRACT_VERSION,
      originatorLabel: config.originatorLabel, timeZone: config.timeZone,
      contactWindowStartMinute: config.contactWindowStartMinute,
      contactWindowEndMinute: config.contactWindowEndMinute,
      contactWeekdays: config.contactWeekdays,
      recordingEnabled: false, transcriptionEnabled: false,
      capabilitySnapshotVersion: TELEPHONY_CONTRACT_VERSION,
      configuredAt: new Date(), createdByActorId: actorId, updatedByActorId: actorId,
    },
    update: {},
  });
}

async function ensureCalendarLocalFoundation(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
) {
  const key = CALENDAR_CONNECTION_KEY;
  const config = {
    operatingMode: "LOCAL_SANDBOX",
    externalCalendarId: "politizai-local-primary",
    displayName: "Agenda Politizai · sandbox local",
    timeZone: "America/Sao_Paulo",
    syncPastDays: 30,
    syncFutureDays: 180,
    maxItemsPerRun: 200,
    externalEgress: false,
  };
  const connection = await transaction.integrationConnection.upsert({
    where: { workspaceId_key: { workspaceId, key } },
    create: {
      id: stableSeedId(`integration:${key}`), workspaceId, key,
      providerKey: CALENDAR_PROVIDER_KEY, adapterKey: CALENDAR_ADAPTER_KEY,
      displayName: "Calendário — sandbox local", environment: "LOCAL",
      status: "ACTIVE_LOCAL", capabilityLevel: "VALIDATED_LOCALLY", enabled: true,
      createdByActorId: actorId, updatedByActorId: actorId,
    },
    update: {},
  });
  await transaction.integrationConnectionConfigVersion.upsert({
    where: { workspaceId_connectionId_version: { workspaceId, connectionId: connection.id, version: 1 } },
    create: {
      id: stableSeedId(`integration-config:${key}:1`), workspaceId,
      connectionId: connection.id, version: 1, schemaVersion: CALENDAR_CONTRACT_VERSION,
      config, configHash: sha256(canonicalJson(config)), createdByActorId: actorId,
    },
    update: {},
  });
  for (const capability of ["WEBHOOK_RECEIVE", "SYNC_PULL", "SYNC_PUSH", "OBJECT_MAPPING"] as const) {
    await transaction.integrationConnectionCapability.upsert({
      where: { workspaceId_connectionId_capability: { workspaceId, connectionId: connection.id, capability } },
      create: { id: stableSeedId(`integration-capability:${key}:${capability}`), workspaceId, connectionId: connection.id, capability },
      update: {},
    });
  }
  await transaction.calendarConnectionProfile.upsert({
    where: { workspaceId_connectionId: { workspaceId, connectionId: connection.id } },
    create: {
      id: stableSeedId(`calendar-profile:${key}`), workspaceId, connectionId: connection.id,
      operatingMode: "LOCAL_SANDBOX", providerKey: CALENDAR_PROVIDER_KEY,
      adapterVersion: CALENDAR_CONTRACT_VERSION, externalCalendarId: config.externalCalendarId,
      displayName: config.displayName, timeZone: config.timeZone,
      syncPastDays: config.syncPastDays, syncFutureDays: config.syncFutureDays,
      maxItemsPerRun: config.maxItemsPerRun, configuredAt: new Date(),
      createdByActorId: actorId, updatedByActorId: actorId,
    },
    update: {},
  });
}

async function ensureContractTemplateFoundation(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
) {
  const templateId = stableSeedId("contract-template:commercial-standard-local");
  const versionId = stableSeedId("contract-template:commercial-standard-local:v1");
  const allowedVariables = ["contractNumber", "accountName", "contactName", "opportunityName", "total"];
  const clauses = [
    {
      key: "scope",
      titleTemplate: "Objeto comercial",
      bodyTemplate: "O presente instrumento registra os itens aprovados para {{accountName}} conforme a oportunidade {{opportunityName}}.",
    },
    {
      key: "payment",
      titleTemplate: "Condições comerciais",
      bodyTemplate: "O valor comercial total é {{total}}. Condições detalhadas constam no resumo versionado.",
    },
    {
      key: "local-notice",
      titleTemplate: "Demonstração local",
      bodyTemplate: "Este documento é demonstrativo, não possui assinatura eletrônica e requer revisão jurídica antes de uso real.",
    },
  ];
  await transaction.contractTemplate.upsert({
    where: { workspaceId_key: { workspaceId, key: "commercial-standard-local" } },
    create: {
      id: templateId, workspaceId, key: "commercial-standard-local",
      name: "Contrato comercial padrão — demonstração local",
      purpose: "Snapshot comercial demonstrativo, sem validade jurídica presumida.",
      status: "ACTIVE", currentVersion: 1, legalReviewState: "PENDING_LEGAL",
      createdByActorId: actorId, updatedByActorId: actorId,
    },
    update: {},
  });
  await transaction.contractTemplateVersion.upsert({
    where: { workspaceId_templateId_version: { workspaceId, templateId, version: 1 } },
    create: {
      id: versionId, workspaceId, templateId, version: 1,
      titleTemplate: "Contrato {{contractNumber}} — {{accountName}}",
      introduction: "Acordo comercial versionado entre a Politizai e {{accountName}}, representada operacionalmente por {{contactName}}.",
      allowedVariables,
      contentHash: sha256(canonicalJson({ allowedVariables, clauses })),
      createdByActorId: actorId,
    },
    update: {},
  });
  for (const [position, clause] of clauses.entries()) {
    await transaction.contractTemplateClause.upsert({
      where: { workspaceId_templateVersionId_position: { workspaceId, templateVersionId: versionId, position } },
      create: {
        id: stableSeedId(`contract-template:commercial-standard-local:v1:${clause.key}`),
        workspaceId, templateVersionId: versionId, position, ...clause,
      },
      update: {},
    });
  }
}

async function ensureGeographicTerritories(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  ownerTeamId: string,
) {
  const definitions = [
    ["BR-SP", "São Paulo", "SP", 500],
    ["BR-RJ", "Rio de Janeiro", "RJ", 490],
    ["BR-MG", "Minas Gerais", "MG", 480],
    ["BR-BA", "Bahia", "BA", 470],
    ["BR-DF", "Distrito Federal", "DF", 460],
  ] as const;
  for (const [code, name, stateCode, priority] of definitions) {
    const rule = { type: "STATE", countryCode: "BR", stateCode, priority };
    const existing = await transaction.territory.findFirst({
      where: { workspaceId, code, version: 1 },
    });
    if (!existing) {
      await transaction.territory.create({
        data: {
          id: stableSeedId(`territory:${code}:1`), workspaceId, code, name,
          type: "STATE", status: "ACTIVE", version: 1, priority,
          countryCode: "BR", stateCode, ownerTeamId,
          timeZone: "America/Sao_Paulo",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          ruleHash: sha256(canonicalJson(rule)),
          reason: "Território determinístico de demonstração local da CRM-42.",
          createdByActorId: actorId,
        },
      });
    }
  }
}

export function assertDemoSeedEnvironment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
  const databaseUrl = source.DATABASE_URL;
  if (
    !databaseUrl ||
    source.NODE_ENV === "production" ||
    source.APP_ENV === "staging" ||
    source.APP_ENV === "production" ||
    source.DEMO_SEED_ENABLED === "false"
  ) {
    throw new ApplicationError("O seed de demonstração só pode rodar localmente.", {
      code: "DEMO_SEED_NOT_LOCAL",
      statusCode: 500,
      expose: true,
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new ApplicationError("A conexão do seed local é inválida.", {
      code: "DEMO_SEED_INVALID_DATABASE_URL",
      statusCode: 500,
      expose: true,
    });
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  if (
    !["postgresql:", "postgres:"].includes(parsedUrl.protocol) ||
    !localHosts.has(parsedUrl.hostname)
  ) {
    throw new ApplicationError("O seed de demonstração recusou um banco não local.", {
      code: "DEMO_SEED_NOT_LOCAL",
      statusCode: 500,
      expose: true,
    });
  }
}

async function ensureWorkspace(transaction: Prisma.TransactionClient) {
  const id = stableSeedId("workspace:politizai");
  const existingById = await transaction.workspace.findUnique({ where: { id } });
  if (existingById) return existingById;
  const existingBySlug = await transaction.workspace.findUnique({
    where: { slug: DEMO_WORKSPACE_SLUG },
  });
  if (existingBySlug) return existingBySlug;
  return transaction.workspace.create({
    data: {
      id,
      slug: DEMO_WORKSPACE_SLUG,
      name: "Politizai",
      timeZone: "America/Sao_Paulo",
    },
  });
}

async function ensureActor(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    seedKey: string;
    key: string;
    displayName: string;
    type: "HUMAN" | "SYSTEM" | "AUTOMATION" | "AI_AGENT";
    userId?: string;
  }>,
) {
  const id = stableSeedId(`actor:${input.seedKey}`);
  const existingById = await transaction.actor.findUnique({ where: { id } });
  if (existingById) return existingById;
  const existingByKey = await transaction.actor.findFirst({
    where: { workspaceId: input.workspaceId, key: input.key },
  });
  if (existingByKey) return existingByKey;
  return transaction.actor.create({
    data: {
      id,
      workspaceId: input.workspaceId,
      key: input.key,
      displayName: input.displayName,
      type: input.type,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
    },
  });
}

async function ensureRole(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  definition: (typeof roleDefinitions)[number],
) {
  const id = stableSeedId(`role:${definition.key}`);
  const existingById = await transaction.role.findUnique({ where: { id } });
  if (existingById) return existingById;
  const existingByKey = await transaction.role.findFirst({
    where: { workspaceId, key: definition.key, deletedAt: null },
  });
  if (existingByKey) return existingByKey;
  return transaction.role.create({
    data: {
      id,
      workspaceId,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      isSystem: true,
      createdByActorId: actorId,
      updatedByActorId: actorId,
    },
  });
}

async function ensureUser(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  roles: ReadonlyMap<AccessRoleKey, string>,
  definition: (typeof DEMO_USERS)[number],
) {
  const userId = stableSeedId(`user:${definition.key}`);
  const normalizedEmail = definition.email.toLowerCase();
  let user = await transaction.user.findUnique({ where: { id: userId } });
  user ??= await transaction.user.findUnique({ where: { normalizedEmail } });
  user ??= await transaction.user.create({
    data: {
      id: userId,
      email: definition.email,
      normalizedEmail,
      displayName: definition.displayName,
    },
  });

  const credential = await transaction.localCredential.findUnique({
    where: { userId: user.id },
  });
  if (!credential) {
    await transaction.localCredential.create({
      data: {
        id: stableSeedId(`credential:${definition.key}`),
        userId: user.id,
        passwordHash: await hashPassword(DEMO_SEED_PASSWORD),
      },
    });
  }

  const roleId = roles.get(definition.roleKey);
  if (!roleId) throw new Error(`Seed role missing: ${definition.roleKey}`);
  let member = await transaction.workspaceMember.findUnique({
    where: { id: stableSeedId(`member:${definition.key}`) },
  });
  member ??= await transaction.workspaceMember.findFirst({
    where: { workspaceId, userId: user.id },
  });
  member ??= await transaction.workspaceMember.create({
    data: {
      id: stableSeedId(`member:${definition.key}`),
      workspaceId,
      userId: user.id,
      roleId,
      status: "ACTIVE",
      joinedAt: new Date(),
      createdByActorId: actorId,
      updatedByActorId: actorId,
    },
  });

  const humanActor = await ensureActor(transaction, {
    workspaceId,
    seedKey: `human:${definition.key}`,
    key: `user:${user.id}`,
    displayName: definition.displayName,
    type: "HUMAN",
    userId: user.id,
  });
  return { user, member, humanActor };
}

async function ensureTeam(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  definition: (typeof teamDefinitions)[number],
) {
  const id = stableSeedId(`team:${definition.key}`);
  const existingById = await transaction.team.findUnique({ where: { id } });
  if (existingById) return existingById;
  const existingByName = await transaction.team.findFirst({
    where: { workspaceId, name: definition.name, deletedAt: null },
  });
  if (existingByName) return existingByName;
  return transaction.team.create({
    data: {
      id,
      workspaceId,
      name: definition.name,
      description: definition.description,
      createdByActorId: actorId,
      updatedByActorId: actorId,
    },
  });
}

async function ensurePipeline(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  definition: (typeof pipelineDefinitions)[number],
) {
  const id = stableSeedId(`pipeline:${definition.key}`);
  let pipeline = await transaction.pipeline.findUnique({ where: { id } });
  pipeline ??= await transaction.pipeline.findFirst({
    where: { workspaceId, name: definition.name, deletedAt: null },
  });
  pipeline ??= await transaction.pipeline.findFirst({
    where: {
      workspaceId,
      entityType: definition.entityType,
      isDefault: true,
      deletedAt: null,
    },
  });
  pipeline ??= await transaction.pipeline.create({
    data: {
      id,
      workspaceId,
      name: definition.name,
      entityType: definition.entityType,
      isDefault: true,
      createdByActorId: actorId,
      updatedByActorId: actorId,
    },
  });

  for (const [position, [stageKey, name, type, leadStageCode, opportunityStageCode]] of definition.stages.entries()) {
    const stageId = stableSeedId(`stage:${definition.key}:${stageKey}`);
    let stage = await transaction.pipelineStage.findUnique({
      where: { id: stageId },
    });
    stage ??= await transaction.pipelineStage.findFirst({
      where: {
        workspaceId,
        pipelineId: pipeline.id,
        deletedAt: null,
        OR: [{ name }, { position }],
      },
    });
    if (!stage) {
      await transaction.pipelineStage.create({
        data: {
          id: stageId,
          workspaceId,
          pipelineId: pipeline.id,
          name,
          position,
          type,
          leadStageCode,
          opportunityStageCode,
          createdByActorId: actorId,
          updatedByActorId: actorId,
        },
      });
    }
  }

  const stages = await transaction.pipelineStage.findMany({
    where: { workspaceId, pipelineId: pipeline.id, deletedAt: null },
    select: { id: true, leadStageCode: true, opportunityStageCode: true },
  });
  const stageByCode = new Map(
    stages.flatMap((stage) => {
      const code = stage.leadStageCode ?? stage.opportunityStageCode;
      return code ? [[code, stage.id] as const] : [];
    }),
  );
  for (const [fromCode, toCode] of definition.transitions) {
    const fromStageId = stageByCode.get(fromCode);
    const toStageId = stageByCode.get(toCode);
    if (!fromStageId || !toStageId) {
      throw new Error(`Seed pipeline transition missing stage: ${fromCode} -> ${toCode}`);
    }
    const existing = await transaction.pipelineStageTransition.findFirst({
      where: { workspaceId, pipelineId: pipeline.id, fromStageId, toStageId },
    });
    if (!existing) {
      await transaction.pipelineStageTransition.create({
        data: {
          id: stableSeedId(`pipeline-transition:${definition.key}:${fromCode}:${toCode}`),
          workspaceId,
          pipelineId: pipeline.id,
          fromStageId,
          toStageId,
          createdByActorId: actorId,
          updatedByActorId: actorId,
        },
      });
    }
  }
  return pipeline;
}

async function ensureCommercialSettings(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
) {
  const existing = await transaction.commercialSettingsVersion.findFirst({
    where: { workspaceId, revision: 1 },
  });
  if (existing) return existing;
  return transaction.commercialSettingsVersion.create({
    data: {
      id: stableSeedId("commercial-settings:1"),
      workspaceId,
      revision: 1,
      pactoMinimumInvestigatedDimensions: 5,
      defaultMeetingDurationMinutes: 30,
      distributionStrategy: "ROUND_ROBIN",
      maxOpenLeadsPerSdr: null,
      leadStagnationDays: 7,
      leadWithoutActivityDays: 3,
      createdByActorId: actorId,
      cadence: {
        create: [
          { dayOffset: 1, action: "WHATSAPP" as const },
          { dayOffset: 2, action: "CALL" as const },
          { dayOffset: 3, action: "EMAIL" as const },
          { dayOffset: 5, action: "WHATSAPP" as const },
          { dayOffset: 7, action: "RECYCLE" as const },
        ].map((step, index) => ({
          id: stableSeedId(`cadence:1:${step.dayOffset}`),
          attemptNumber: index + 1,
          ...step,
        })),
      },
    },
  });
}

async function ensureEntryAutomationRules(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
): Promise<void> {
  for (const definition of [
    ...predefinedEntryAutomations,
    ...predefinedLifecycleAutomations,
  ]) {
    const existing = await transaction.automationRule.findFirst({
      where: { workspaceId, key: definition.key },
      select: { id: true },
    });
    if (existing) continue;

    await transaction.automationRule.create({
      data: {
        id: stableSeedId(`automation-rule:${definition.key}`),
        workspaceId,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isPredefined: true,
        status: "ACTIVE",
        triggerType: definition.triggerType,
        actionType: definition.actionType,
        conditions: definition.conditions,
        actionConfig: definition.actionConfig,
        version: 1,
        createdByActorId: actorId,
        updatedByActorId: actorId,
      },
    });
  }
}

export type DemoSeedResult = Readonly<{
  workspaceId: string;
  users: number;
  roles: number;
  teams: number;
  pipelines: number;
  products: number;
  offerTemplates: number;
  leads: number;
}>;

export async function seedDemoDatabase(
  database: PrismaClient,
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<DemoSeedResult> {
  assertDemoSeedEnvironment(environment);

  return database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('politizai_crm_demo_seed_v1'))`;
      const workspace = await ensureWorkspace(transaction);
      const systemActor = await ensureActor(transaction, {
        workspaceId: workspace.id,
        seedKey: "system",
        key: "system",
        displayName: "Sistema Politizai",
        type: "SYSTEM",
      });
      await ensureActor(transaction, {
        workspaceId: workspace.id,
        seedKey: "automation",
        key: "automation:local",
        displayName: "Automação local",
        type: "AUTOMATION",
      });
      await ensureActor(transaction, {
        workspaceId: workspace.id,
        seedKey: "ai-agent",
        key: "ai:recommendation",
        displayName: "Agente de recomendação",
        type: "AI_AGENT",
      });
      await ensureCommercialSettings(transaction, workspace.id, systemActor.id);
      await ensurePrivacyFoundation(transaction, workspace.id, systemActor.id);
      await ensureAttributionModelsInTransaction(transaction, workspace.id, systemActor.id);
      await ensureLocalIntegrationFoundation(transaction, workspace.id, systemActor.id);
      await ensureWhatsAppLocalFoundation(transaction, workspace.id, systemActor.id);
      await ensureEmailLocalFoundation(transaction, workspace.id, systemActor.id);
      await ensureTelephonyLocalFoundation(transaction, workspace.id, systemActor.id);
      await ensureCalendarLocalFoundation(transaction, workspace.id, systemActor.id);
      await ensureContractTemplateFoundation(transaction, workspace.id, systemActor.id);
      const automationActor = await transaction.actor.findFirstOrThrow({
        where: {
          workspaceId: workspace.id,
          key: "automation:local",
          type: "AUTOMATION",
        },
        select: { id: true },
      });
      await ensureEntryAutomationRules(
        transaction,
        workspace.id,
        automationActor.id,
      );

      const scoringRuleId = stableSeedId(
        `scoring-rule:${scoringRuleDefinition.key}:${scoringRuleDefinition.version}`,
      );
      const existingScoringRule = await transaction.scoringRuleVersion.findFirst({
        where: {
          workspaceId: workspace.id,
          key: scoringRuleDefinition.key,
          version: scoringRuleDefinition.version,
        },
      });
      if (!existingScoringRule) {
        await transaction.scoringRuleVersion.create({
          data: {
            id: scoringRuleId,
            workspaceId: workspace.id,
            ...scoringRuleDefinition,
            active: true,
            createdByActorId: systemActor.id,
          },
        });
      }

      const permissions = new Map<PermissionKey, string>();
      for (const definition of permissionCatalog) {
        let permission = await transaction.permission.findUnique({
          where: { key: definition.key },
        });
        permission ??= await transaction.permission.create({
          data: {
            id: stableSeedId(`permission:${definition.key}`),
            key: definition.key,
            description: definition.description,
          },
        });
        permissions.set(definition.key, permission.id);
      }

      const roles = new Map<AccessRoleKey, string>();
      for (const definition of roleDefinitions) {
        const role = await ensureRole(
          transaction,
          workspace.id,
          systemActor.id,
          definition,
        );
        roles.set(definition.key, role.id);
        for (const [permissionKey, scope] of definition.grants) {
          const permissionId = permissions.get(permissionKey);
          if (!permissionId) throw new Error(`Seed permission missing: ${permissionKey}`);
          const existingGrant = await transaction.rolePermission.findFirst({
            where: { workspaceId: workspace.id, roleId: role.id, permissionId },
          });
          if (!existingGrant) {
            await transaction.rolePermission.create({
              data: {
                id: stableSeedId(`grant:${definition.key}:${permissionKey}`),
                workspaceId: workspace.id,
                roleId: role.id,
                permissionId,
                scope,
                createdByActorId: systemActor.id,
              },
            });
          }
        }
      }

      const members = new Map<string, Awaited<ReturnType<typeof ensureUser>>>();
      for (const definition of DEMO_USERS) {
        members.set(
          definition.key,
          await ensureUser(
            transaction,
            workspace.id,
            systemActor.id,
            roles,
            definition,
          ),
        );
      }

      const teams = new Map<string, string>();
      for (const definition of teamDefinitions) {
        const team = await ensureTeam(
          transaction,
          workspace.id,
          systemActor.id,
          definition,
        );
        teams.set(definition.key, team.id);
      }
      for (const definition of DEMO_USERS) {
        const member = members.get(definition.key)?.member;
        if (!member) throw new Error(`Seed member missing: ${definition.key}`);
        for (const [teamKey, teamFunction] of definition.teams) {
          const teamId = teams.get(teamKey);
          if (!teamId) throw new Error(`Seed team missing: ${teamKey}`);
          const existingMembership = await transaction.teamMember.findFirst({
            where: {
              workspaceId: workspace.id,
              teamId,
              workspaceMemberId: member.id,
            },
          });
          if (!existingMembership) {
            await transaction.teamMember.create({
              data: {
                id: stableSeedId(`team-member:${definition.key}:${teamKey}`),
                workspaceId: workspace.id,
                teamId,
                workspaceMemberId: member.id,
                function: teamFunction as TeamFunction,
                createdByActorId: systemActor.id,
                updatedByActorId: systemActor.id,
              },
            });
          }
        }
      }

      const admin = members.get("admin");
      if (!admin) throw new Error("Seed admin missing");
      await ensureAIGovernanceFoundation(
        transaction,
        workspace.id,
        admin.member.id,
        admin.humanActor.id,
      );

      const preSalesTeamId = teams.get("pre-sales");
      if (!preSalesTeamId) throw new Error("Seed pre-sales team missing");
      await ensureGeographicTerritories(
        transaction,
        workspace.id,
        systemActor.id,
        preSalesTeamId,
      );
      const queueId = stableSeedId("queue:general");
      let generalQueue = await transaction.queue.findUnique({ where: { id: queueId } });
      generalQueue ??= await transaction.queue.findFirst({
        where: {
          workspaceId: workspace.id,
          deletedAt: null,
          OR: [{ key: "general" }, { isGeneral: true }],
        },
      });
      generalQueue ??= await transaction.queue.create({
        data: {
          id: queueId,
          workspaceId: workspace.id,
          teamId: preSalesTeamId,
          key: "general",
          name: "Fila Geral",
          isGeneral: true,
          createdByActorId: systemActor.id,
          updatedByActorId: systemActor.id,
        },
      });

      for (const definition of pipelineDefinitions) {
        await ensurePipeline(transaction, workspace.id, systemActor.id, definition);
      }

      const slaPolicies = new Map<string, string>();
      for (const definition of slaDefinitions) {
        const id = stableSeedId(`sla:${definition.key}`);
        let policy = await transaction.slaPolicy.findUnique({ where: { id } });
        policy ??= await transaction.slaPolicy.findFirst({
          where: { workspaceId: workspace.id, key: definition.key, deletedAt: null },
        });
        policy ??= await transaction.slaPolicy.create({
          data: {
            id,
            workspaceId: workspace.id,
            ...definition,
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });
        slaPolicies.set(definition.key, policy.id);
      }
      for (const definition of priorityBandDefinitions) {
        const slaPolicyId = slaPolicies.get(definition.slaKey);
        if (!slaPolicyId) throw new Error(`Seed SLA missing: ${definition.slaKey}`);
        const id = stableSeedId(`priority-band:${definition.code}`);
        let band = await transaction.leadPriorityBand.findUnique({ where: { id } });
        band ??= await transaction.leadPriorityBand.findFirst({
          where: { workspaceId: workspace.id, code: definition.code, deletedAt: null },
        });
        if (!band) {
          await transaction.leadPriorityBand.create({
            data: {
              id,
              workspaceId: workspace.id,
              slaPolicyId,
              code: definition.code,
              name: definition.name,
              position: definition.position,
              scoreMin: definition.scoreMin,
              scoreMax: definition.scoreMax,
              leadPriority: definition.leadPriority,
              createdByActorId: systemActor.id,
              updatedByActorId: systemActor.id,
            },
          });
        }
      }

      for (const [position, [key, name]] of lossReasonDefinitions.entries()) {
        const id = stableSeedId(`loss-reason:${key}`);
        let reason = await transaction.lossReason.findUnique({ where: { id } });
        reason ??= await transaction.lossReason.findFirst({
          where: { workspaceId: workspace.id, key, deletedAt: null },
        });
        if (!reason) {
          await transaction.lossReason.create({
            data: {
              id,
              workspaceId: workspace.id,
              key,
              name,
              position,
              createdByActorId: systemActor.id,
              updatedByActorId: systemActor.id,
            },
          });
        }
      }
      for (const [position, [key, name]] of disqualificationReasonDefinitions.entries()) {
        const id = stableSeedId(`disqualification-reason:${key}`);
        let reason = await transaction.disqualificationReason.findUnique({
          where: { id },
        });
        reason ??= await transaction.disqualificationReason.findFirst({
          where: { workspaceId: workspace.id, key, deletedAt: null },
        });
        if (!reason) {
          await transaction.disqualificationReason.create({
            data: {
              id,
              workspaceId: workspace.id,
              key,
              name,
              position,
              createdByActorId: systemActor.id,
              updatedByActorId: systemActor.id,
            },
          });
        }
      }

      const products = new Map<string, string>();
      for (const definition of productDefinitions) {
        const id = stableSeedId(`product:${definition.key}`);
        let product = await transaction.product.findUnique({ where: { id } });
        product ??= await transaction.product.findFirst({
          where: { workspaceId: workspace.id, sku: definition.sku, deletedAt: null },
        });
        product ??= await transaction.product.create({
          data: {
            id,
            workspaceId: workspace.id,
            sku: definition.sku,
            name: definition.name,
            description: definition.description,
            listPriceCents: definition.listPriceCents,
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });
        products.set(definition.key, product.id);
      }
      for (const definition of offerTemplateDefinitions) {
        const productId = products.get(definition.productKey);
        if (!productId) throw new Error(`Seed product missing: ${definition.productKey}`);
        const id = stableSeedId(`offer-template:${definition.key}`);
        let template = await transaction.offerTemplate.findUnique({ where: { id } });
        template ??= await transaction.offerTemplate.findFirst({
          where: { workspaceId: workspace.id, key: definition.key, deletedAt: null },
        });
        if (!template) {
          await transaction.offerTemplate.create({
            data: {
              id,
              workspaceId: workspace.id,
              productId,
              key: definition.key,
              name: definition.name,
              description: definition.description,
              priceCents: definition.priceCents,
              discountCents: definition.discountCents,
              validDays: definition.validDays,
              createdByActorId: systemActor.id,
              updatedByActorId: systemActor.id,
            },
          });
        }
      }

      for (const [key, name, type] of sourceDefinitions) {
        const id = stableSeedId(`source:${key}`);
        let source = await transaction.leadSource.findUnique({ where: { id } });
        source ??= await transaction.leadSource.findFirst({
          where: { workspaceId: workspace.id, key, deletedAt: null },
        });
        if (!source) {
          await transaction.leadSource.create({
            data: {
              id,
              workspaceId: workspace.id,
              key,
              name,
              type,
              createdByActorId: systemActor.id,
              updatedByActorId: systemActor.id,
            },
          });
        }
      }
      for (const campaignDefinition of campaignDefinitions) {
        const campaignId = stableSeedId(`campaign:${campaignDefinition.key}`);
        let campaign = await transaction.acquisitionCampaign.findUnique({
          where: { id: campaignId },
        });
        campaign ??= await transaction.acquisitionCampaign.findFirst({
          where: {
            workspaceId: workspace.id,
            externalRef: campaignDefinition.externalRef,
            deletedAt: null,
          },
        });
        campaign ??= await transaction.acquisitionCampaign.create({
          data: {
            id: campaignId,
            workspaceId: workspace.id,
            name: campaignDefinition.name,
            externalRef: campaignDefinition.externalRef,
            createdByActorId: systemActor.id,
            updatedByActorId: systemActor.id,
          },
        });
        for (const [creativeKey, creativeName] of campaignDefinition.creatives) {
          const creativeId = stableSeedId(`creative:${creativeKey}`);
          const externalRef = `demo:creative:${creativeKey}`;
          let creative = await transaction.acquisitionCreative.findUnique({
            where: { id: creativeId },
          });
          creative ??= await transaction.acquisitionCreative.findFirst({
            where: {
              workspaceId: workspace.id,
              campaignId: campaign.id,
              externalRef,
              deletedAt: null,
            },
          });
          if (!creative) {
            await transaction.acquisitionCreative.create({
              data: {
                id: creativeId,
                workspaceId: workspace.id,
                campaignId: campaign.id,
                name: creativeName,
                externalRef,
                createdByActorId: systemActor.id,
                updatedByActorId: systemActor.id,
              },
            });
          }
        }
      }

      for (const definition of lifecycleRuleDefinitions) {
        const id = stableSeedId(`lifecycle-rule:${LIFECYCLE_RULE_VERSION}:${definition.fromStage}:${definition.toStage}`);
        const existing = await transaction.lifecycleRuleVersion.findUnique({ where: { id } });
        if (!existing) {
          await transaction.lifecycleRuleVersion.create({ data: {
            id,
            workspaceId: workspace.id,
            key: LIFECYCLE_RULE_KEY,
            version: LIFECYCLE_RULE_VERSION,
            fromStage: definition.fromStage,
            toStage: definition.toStage,
            requiredFunctions: [...definition.requiredFunctions],
            allowedSources: [...definition.allowedSources],
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            createdByActorId: systemActor.id,
          } });
        }
      }

      const onboardingTemplateId = stableSeedId("onboarding-template:implantacao-padrao");
      let onboardingTemplate = await transaction.onboardingTemplate.findUnique({
        where: { id: onboardingTemplateId },
      });
      onboardingTemplate ??= await transaction.onboardingTemplate.findFirst({
        where: { workspaceId: workspace.id, name: "Implantação padrão" },
      });
      onboardingTemplate ??= await transaction.onboardingTemplate.create({
        data: {
          id: onboardingTemplateId,
          workspaceId: workspace.id,
          name: "Implantação padrão",
          status: "PUBLISHED",
          createdByActorId: systemActor.id,
          updatedByActorId: systemActor.id,
        },
      });
      const onboardingVersionId = stableSeedId("onboarding-template:implantacao-padrao:v1");
      let onboardingVersion = await transaction.onboardingTemplateVersion.findUnique({
        where: { id: onboardingVersionId },
      });
      onboardingVersion ??= await transaction.onboardingTemplateVersion.findFirst({
        where: { workspaceId: workspace.id, templateId: onboardingTemplate.id, version: 1 },
      });
      onboardingVersion ??= await transaction.onboardingTemplateVersion.create({
        data: {
          id: onboardingVersionId,
          workspaceId: workspace.id,
          templateId: onboardingTemplate.id,
          version: 1,
          status: "PUBLISHED",
          requiredOpportunityWon: true,
          requiredAcceptedContract: true,
          expectedDurationDays: 14,
          publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          createdByActorId: systemActor.id,
        },
      });
      const onboardingMilestones = [
        ["kickoff", "Reunião de kickoff", 1, 24, null],
        ["access", "Acessos e responsáveis confirmados", 2, 48, "kickoff"],
        ["configuration", "Configuração inicial validada", 3, 96, "access"],
        ["activation", "Critérios de ativação validados", 4, 168, "configuration"],
      ] as const;
      for (const [key, name, position, expectedDurationHours, dependsOnKey] of onboardingMilestones) {
        const id = stableSeedId(`onboarding-milestone:implantacao-padrao:v1:${key}`);
        const existing = await transaction.onboardingTemplateMilestone.findFirst({
          where: { workspaceId: workspace.id, templateVersionId: onboardingVersion.id, key },
        });
        if (!existing) {
          await transaction.onboardingTemplateMilestone.create({
            data: {
              id,
              workspaceId: workspace.id,
              templateVersionId: onboardingVersion.id,
              key,
              name,
              position,
              required: true,
              expectedDurationHours,
              dependsOnKey,
            },
          });
        }
      }
      if (!onboardingTemplate.currentVersionId) {
        await transaction.onboardingTemplate.update({
          where: { id: onboardingTemplate.id },
          data: { currentVersionId: onboardingVersion.id },
        });
      }

      const successTemplateId = stableSeedId("success-plan-template:resultado-inicial");
      const successVersionId = stableSeedId("success-plan-template:resultado-inicial:v1");
      await transaction.successPlanTemplate.upsert({
        where: { workspaceId_key: { workspaceId: workspace.id, key: "resultado-inicial" } },
        create: { id: successTemplateId, workspaceId: workspace.id, key: "resultado-inicial", name: "Plano de resultado inicial", currentVersionId: null, createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
        update: {},
      });
      await transaction.successPlanTemplateVersion.upsert({
        where: { workspaceId_templateId_version: { workspaceId: workspace.id, templateId: successTemplateId, version: 1 } },
        create: { id: successVersionId, workspaceId: workspace.id, templateId: successTemplateId, version: 1, status: "PUBLISHED", objective: "Comprovar adoção e resultado observado nos primeiros 30 dias.", defaultDays: 30, createdByActorId: systemActor.id },
        update: {},
      });
      const successMilestones = [
        ["objective", "Objetivo de sucesso confirmado", 1, 3, null],
        ["adoption", "Adoção inicial observada", 2, 14, "objective"],
        ["result", "Resultado inicial documentado", 3, 30, "adoption"],
      ] as const;
      for (const [key, name, position, dueOffsetDays, dependencyKey] of successMilestones) {
        await transaction.successPlanTemplateMilestone.upsert({
          where: { workspaceId_templateVersionId_key: { workspaceId: workspace.id, templateVersionId: successVersionId, key } },
          create: { id: stableSeedId(`success-plan-template:resultado-inicial:v1:${key}`), workspaceId: workspace.id, templateVersionId: successVersionId, key, name, position, dueOffsetDays, dependencyKey },
          update: {},
        });
      }
      await transaction.successPlanTemplate.updateMany({ where: { id: successTemplateId, workspaceId: workspace.id, currentVersionId: null }, data: { currentVersionId: successVersionId, updatedByActorId: systemActor.id } });

      const healthRuleId = stableSeedId("customer-health-rule:v1");
      await transaction.customerHealthRuleVersion.upsert({
        where: { workspaceId_version: { workspaceId: workspace.id, version: 1 } },
        create: { id: healthRuleId, workspaceId: workspace.id, version: 1, status: "PUBLISHED", name: "Saúde inicial do cliente", healthyMinScore: 75, attentionMinScore: 45, observationWindowDays: 30, formula: "média ponderada dos sinais atuais; obrigatório ausente ou vencido resulta em INSUFFICIENT", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), createdByActorId: systemActor.id },
        update: {},
      });
      const healthSignals = [
        ["ONBOARDING_COMPLETED", "Onboarding concluído", 25, true, "POSITIVE", 120],
        ["SUCCESS_PLAN_ACTIVE", "Plano de sucesso ativo", 20, true, "POSITIVE", 45],
        ["NEXT_ACTION_ON_TIME", "Próxima ação no prazo", 20, true, "POSITIVE", 14],
        ["NO_ACTIVE_BLOCKER", "Ausência de bloqueio ativo", 15, false, "POSITIVE", 14],
        ["SUBSCRIPTION_ACTIVE", "Assinatura ativa", 20, true, "POSITIVE", 45],
      ] as const;
      for (const [key, name, weight, required, direction, freshnessDays] of healthSignals) {
        await transaction.customerHealthSignalDefinition.upsert({
          where: { workspaceId_ruleVersionId_key: { workspaceId: workspace.id, ruleVersionId: healthRuleId, key } },
          create: { id: stableSeedId(`customer-health-rule:v1:${key}`), workspaceId: workspace.id, ruleVersionId: healthRuleId, key, name, weight, required, direction, freshnessDays, position: healthSignals.findIndex((item) => item[0] === key) + 1 },
          update: {},
        });
      }

      const customerServicePolicyId = stableSeedId("customer-service-sla:standard");
      const customerServiceVersionId = stableSeedId("customer-service-sla:standard:v1");
      await transaction.customerServiceSlaPolicy.upsert({
        where: { workspaceId_key: { workspaceId: workspace.id, key: "standard" } },
        create: { id: customerServicePolicyId, workspaceId: workspace.id, key: "standard", name: "Atendimento padrão", currentVersionId: null, createdByActorId: systemActor.id, updatedByActorId: systemActor.id },
        update: {},
      });
      await transaction.customerServiceSlaPolicyVersion.upsert({
        where: { workspaceId_policyId_version: { workspaceId: workspace.id, policyId: customerServicePolicyId, version: 1 } },
        create: { id: customerServiceVersionId, workspaceId: workspace.id, policyId: customerServicePolicyId, version: 1, status: "PUBLISHED", firstResponseMinutes: 60, resolutionMinutes: 1_440, timeZone: "America/Sao_Paulo", effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), publishedAt: new Date("2026-01-01T00:00:00.000Z"), createdByActorId: systemActor.id },
        update: {},
      });
      await transaction.customerServiceSlaPolicy.updateMany({ where: { id: customerServicePolicyId, workspaceId: workspace.id, currentVersionId: null }, data: { currentVersionId: customerServiceVersionId, updatedByActorId: systemActor.id } });

      for (const survey of [
        { key: "csat-request", name: "CSAT pós-atendimento", type: "CSAT" as const, question: "De 1 a 5, quão satisfeito você ficou com este atendimento?", minValue: 1, maxValue: 5 },
        { key: "nps-relationship", name: "NPS de relacionamento", type: "NPS" as const, question: "De 0 a 10, qual a chance de recomendar a Politizai?", minValue: 0, maxValue: 10 },
      ]) {
        const definitionId = stableSeedId(`customer-survey:${survey.key}`); const versionId = stableSeedId(`customer-survey:${survey.key}:v1`);
        await transaction.customerSurveyDefinition.upsert({ where: { workspaceId_key: { workspaceId: workspace.id, key: survey.key } }, create: { id: definitionId, workspaceId: workspace.id, key: survey.key, name: survey.name, type: survey.type, currentVersionId: null, createdByActorId: systemActor.id, updatedByActorId: systemActor.id }, update: {} });
        await transaction.customerSurveyVersion.upsert({ where: { workspaceId_definitionId_version: { workspaceId: workspace.id, definitionId, version: 1 } }, create: { id: versionId, workspaceId: workspace.id, definitionId, version: 1, status: "PUBLISHED", question: survey.question, minValue: survey.minValue, maxValue: survey.maxValue, labels: survey.type === "CSAT" ? { "1": "Muito insatisfeito", "5": "Muito satisfeito" } : { "0": "Nada provável", "10": "Muito provável" }, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), publishedAt: new Date("2026-01-01T00:00:00.000Z"), createdByActorId: systemActor.id }, update: {} });
        await transaction.customerSurveyDefinition.updateMany({ where: { id: definitionId, workspaceId: workspace.id, currentVersionId: null }, data: { currentVersionId: versionId, updatedByActorId: systemActor.id } });
      }

      const auditId = stableSeedId("audit:initial-seed");
      const existingAudit = await transaction.auditLog.findUnique({
        where: { id: auditId },
      });
      if (!existingAudit) {
        await transaction.auditLog.create({
          data: {
            id: auditId,
            workspaceId: workspace.id,
            actorId: systemActor.id,
            action: "seed.initial_structure.created",
            origin: "SEED",
            entityType: "Workspace",
            entityId: workspace.id,
            changes: { seedVersion: DEMO_SEED_VERSION },
            metadata: { kind: "local_demo", containsOperationalLeads: false },
          },
        });
      }

      return {
        workspaceId: workspace.id,
        users: DEMO_USERS.length,
        roles: roleDefinitions.length,
        teams: teamDefinitions.length,
        pipelines: pipelineDefinitions.length,
        products: productDefinitions.length,
        offerTemplates: offerTemplateDefinitions.length,
        leads: 0,
      };
    },
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
}
