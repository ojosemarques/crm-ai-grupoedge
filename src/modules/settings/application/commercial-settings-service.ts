import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import type {
  CommercialSettingsScreen,
  SettingsPreview,
} from "@/modules/settings/domain/commercial-settings-contracts";
import { getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";
import { isCatalogItemSellable } from "@/modules/catalog/domain/catalog-sellability-policy";

type AuthorizationPort = Readonly<{
  assertAuthorized: ReturnType<typeof getAuthorizationService>["assertAuthorized"];
}>;

type SettingsServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: AuthorizationPort;
  beforeCommit?: () => Promise<void>;
}>;

const idSchema = z.string().uuid();
const keySchema = z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
const centsSchema = z.string().regex(/^\d{1,18}$/).transform((value) => BigInt(value));
const expectedAtSchema = z.string().datetime({ offset: true });
const baseCommand = { confirmed: z.boolean().optional().default(false) };
const cadenceActionSchema = z.enum(["WHATSAPP", "CALL", "EMAIL", "INSTAGRAM_MESSAGE", "INSTAGRAM_FOLLOW", "RECYCLE", "CLOSE"]);
const cadenceStepsSchema = z.array(z.object({
  dayOffset: z.number().int().min(0).max(90),
  action: cadenceActionSchema,
  timeOfDay: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().default("09:00"),
  message: z.string().trim().max(2_000).nullable().optional().default(null),
  assigneeMemberId: idSchema.nullable().optional().default(null),
  targetStageId: idSchema.nullable().optional().default(null),
}).strict()).min(1).max(30);

const operationalCommand = z.object({
  action: z.literal("SAVE_OPERATIONAL_POLICY"),
  ...baseCommand,
  expectedRevision: z.number().int().positive(),
  pactoMinimumInvestigatedDimensions: z.number().int().min(1).max(5),
  defaultMeetingDurationMinutes: z.union([z.literal(30), z.literal(40)]),
  distributionStrategy: z.literal("ROUND_ROBIN"),
  maxOpenLeadsPerSdr: z.number().int().min(1).max(10_000).nullable(),
  leadStagnationDays: z.number().int().min(1).max(365),
  leadWithoutActivityDays: z.number().int().min(1).max(365),
  cadenceTemplateKey: z.string().trim().min(2).max(80).optional().default("CUSTOM"),
  cadenceStopOnReply: z.boolean().optional().default(true),
  cadenceStopOnMeetingScheduled: z.boolean().optional().default(true),
  cadenceStopOnStageChange: z.boolean().optional().default(false),
  cadenceSteps: cadenceStepsSchema.optional(),
  cadenceDayOffsets: z.array(z.number().int().min(0).max(90)).min(1).max(30).optional(),
}).strict().superRefine((value, context) => {
  const steps = value.cadenceSteps ?? value.cadenceDayOffsets?.map((dayOffset) => ({ dayOffset, action: "CALL" as const }));
  if (!steps) {
    context.addIssue({ code: "custom", message: "Informe ao menos uma etapa da cadência." });
    return;
  }
  const days = steps.map((step) => step.dayOffset);
  if (days[0] !== 0 && days[0] !== 1) {
    context.addIssue({ code: "custom", message: "A cadência deve começar no dia zero ou no dia um." });
  }
  if (days.some((day, index, values) => index > 0 && day < values[index - 1]!)) {
    context.addIssue({ code: "custom", message: "Os dias da cadência devem estar em ordem não decrescente." });
  }
});

function cadenceSteps(command: z.infer<typeof operationalCommand>) {
  return command.cadenceSteps ?? command.cadenceDayOffsets!.map((dayOffset) => ({
    dayOffset,
    action: "CALL" as const,
    timeOfDay: "09:00",
    message: null,
    assigneeMemberId: null,
    targetStageId: null,
  }));
}

const scoringCommand = z.object({
  action: z.literal("SAVE_SCORING_SLA"),
  ...baseCommand,
  expectedScoringVersion: z.number().int().positive(),
  painMaxPoints: z.number().int().min(0).max(100),
  capacityMaxPoints: z.number().int().min(0).max(100),
  decisionMaxPoints: z.number().int().min(0).max(100),
  intentMaxPoints: z.number().int().min(0).max(100),
  contextMaxPoints: z.number().int().min(0).max(100),
  partialFactorBasisPoints: z.number().int().min(0).max(10_000),
  noCapacityPenalty: z.number().int().min(0).max(100),
  noPainPenalty: z.number().int().min(0).max(100),
  curiosityPenalty: z.number().int().min(0).max(100),
  invalidContactPenalty: z.number().int().min(0).max(100),
  noDecisionAccessPenalty: z.number().int().min(0).max(100),
  capacityFullThresholdCents: centsSchema,
  p1Minimum: z.number().int().min(1).max(100),
  p2Minimum: z.number().int().min(1).max(99),
  healthyMaxSeconds: z.number().int().min(1).max(3_600),
  attentionMaxSeconds: z.number().int().min(2).max(7_200),
}).strict().superRefine((value, context) => {
  const total = value.painMaxPoints + value.capacityMaxPoints + value.decisionMaxPoints + value.intentMaxPoints + value.contextMaxPoints;
  if (total !== 100) context.addIssue({ code: "custom", message: "Os pesos positivos devem somar 100 pontos." });
  if (value.p2Minimum >= value.p1Minimum) context.addIssue({ code: "custom", message: "A faixa P2 deve começar abaixo da P1." });
  if (value.attentionMaxSeconds <= value.healthyMaxSeconds) context.addIssue({ code: "custom", message: "A faixa de atenção deve terminar após a faixa saudável." });
});

const productCommand = z.object({
  action: z.literal("SAVE_PRODUCT"), ...baseCommand,
  id: idSchema.nullable(), expectedUpdatedAt: expectedAtSchema.nullable(),
  sku: z.string().trim().min(2).max(80), name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2_000).nullable(), listPriceCents: centsSchema,
  kind: z.enum(["PRODUCT", "MODULE", "LINE", "PLAN", "LICENSE", "IMPLEMENTATION", "RECURRING_SERVICE", "PROJECT"]).default("PRODUCT"),
  revenueCategory: z.enum(["SOFTWARE", "IMPLEMENTATION", "RECURRING_SERVICE", "PROJECT"]).default("SOFTWARE"),
  audience: z.enum(["INSTITUTIONAL", "INDIVIDUAL", "GOVERNMENT"]).default("INSTITUTIONAL"),
  availability: z.enum(["DRAFT", "AVAILABLE", "CAPACITY_LIMITED", "FUTURE", "RETIRED"]).default("AVAILABLE"),
  capacityUnits: z.number().int().positive().nullable().default(null),
  salesGateProfile: z.enum(["STANDARD", "MANDATO"]).default("STANDARD"),
  approvedConditions: z.string().trim().min(3).max(4_000).default("Condições comerciais padrão aprovadas."),
}).strict();
const productStatusCommand = z.object({ action: z.literal("SET_PRODUCT_ACTIVE"), ...baseCommand, id: idSchema, active: z.boolean() }).strict();
const offerTemplateCommand = z.object({
  action: z.literal("SAVE_OFFER_TEMPLATE"), ...baseCommand,
  id: idSchema.nullable(), expectedUpdatedAt: expectedAtSchema.nullable(), productId: idSchema,
  key: keySchema, name: z.string().trim().min(2).max(160), description: z.string().trim().max(2_000).nullable(),
  priceCents: centsSchema, discountCents: centsSchema, validDays: z.number().int().min(1).max(365).nullable(),
  availability: z.enum(["DRAFT", "AVAILABLE", "CAPACITY_LIMITED", "FUTURE", "RETIRED"]).default("AVAILABLE"),
  approvedConditions: z.string().trim().min(3).max(4_000).default("Condições comerciais padrão aprovadas."),
  components: z.array(z.object({ productId: idSchema, quantity: z.number().int().min(1).max(1000), unitPriceCents: centsSchema, discountCents: centsSchema }).strict()).max(32).default([]),
}).strict().superRefine((value, context) => {
  if (value.discountCents > value.priceCents) context.addIssue({ code: "custom", message: "O desconto não pode superar o preço." });
  for (const component of value.components) if (component.discountCents > component.unitPriceCents * BigInt(component.quantity)) context.addIssue({ code: "custom", message: "O desconto de um componente não pode superar seu total." });
});
const offerTemplateStatusCommand = z.object({ action: z.literal("SET_OFFER_TEMPLATE_ACTIVE"), ...baseCommand, id: idSchema, active: z.boolean() }).strict();
const reasonCommand = z.object({
  action: z.literal("SAVE_REASON"), ...baseCommand,
  reasonType: z.enum(["LOSS_REASON", "DISQUALIFICATION_REASON"]), id: idSchema.nullable(),
  expectedUpdatedAt: expectedAtSchema.nullable(), key: keySchema, name: z.string().trim().min(2).max(160),
  position: z.number().int().min(0).max(1_000),
}).strict();
const reasonStatusCommand = z.object({
  action: z.literal("SET_REASON_ACTIVE"), ...baseCommand,
  reasonType: z.enum(["LOSS_REASON", "DISQUALIFICATION_REASON"]), id: idSchema, active: z.boolean(),
}).strict();
const pipelineCommand = z.object({
  action: z.literal("SAVE_PIPELINE"), ...baseCommand,
  pipelineId: idSchema, expectedUpdatedAt: expectedAtSchema,
  name: z.string().trim().min(2).max(160),
  stages: z.array(z.object({ id: idSchema, name: z.string().trim().min(2).max(160), position: z.number().int().min(0).max(100) }).strict()).min(1).max(30),
}).strict().superRefine((value, context) => {
  if (new Set(value.stages.map((stage) => stage.id)).size !== value.stages.length) context.addIssue({ code: "custom", message: "Uma etapa foi enviada mais de uma vez." });
  if (new Set(value.stages.map((stage) => stage.position)).size !== value.stages.length) context.addIssue({ code: "custom", message: "As posições das etapas devem ser únicas." });
});
const transitionStatusCommand = z.object({ action: z.literal("SET_TRANSITION_ACTIVE"), ...baseCommand, transitionId: idSchema, active: z.boolean() }).strict();

export const commercialSettingsCommandSchema = z.discriminatedUnion("action", [
  operationalCommand, scoringCommand, productCommand, productStatusCommand,
  offerTemplateCommand, offerTemplateStatusCommand, reasonCommand,
  reasonStatusCommand, pipelineCommand, transitionStatusCommand,
]);
export type CommercialSettingsCommand = z.infer<typeof commercialSettingsCommandSchema>;

function invalidInput(error: z.ZodError | string): never {
  throw new ApplicationError(typeof error === "string" ? error : error.issues.map((issue) => issue.message).join(" "), { code: "INVALID_INPUT", statusCode: 400, expose: true });
}
function notFound(message: string): never { throw new ApplicationError(message, { code: "NOT_FOUND", statusCode: 404, expose: true }); }
function conflict(code: string, message: string): never { throw new ApplicationError(message, { code, statusCode: 409, expose: true }); }
function parseCommand(input: unknown): CommercialSettingsCommand {
  const result = commercialSettingsCommandSchema.safeParse(input);
  if (!result.success) invalidInput(result.error);
  return result.data;
}
function asJson(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

export function createCommercialSettingsService(options: SettingsServiceOptions) {
  const workspaceResource = (workspaceId: string) => ({ workspaceId, resourceType: "CommercialSettings", resourceId: workspaceId });
  async function authorize(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.WORKSPACE_MANAGE, workspaceResource(context.workspaceId));
  }

  async function getScreen(context: AuthenticatedContext): Promise<CommercialSettingsScreen> {
    await authorize(context);
    const workspaceId = context.workspaceId;
    const [workspace, scoring, slaBands, products, templates, lossReasons, disqualificationReasons, pipelines, members] = await Promise.all([
      options.database.workspace.findFirst({
        where: { id: workspaceId, deletedAt: null },
        select: {
          id: true, name: true, timeZone: true, commercialSettingsRevision: true,
          pactoMinimumInvestigatedDimensions: true, defaultMeetingDurationMinutes: true,
          distributionStrategy: true, maxOpenLeadsPerSdr: true, leadStagnationDays: true, leadWithoutActivityDays: true,
        },
      }),
      options.database.scoringRuleVersion.findFirst({ where: { workspaceId, active: true }, orderBy: [{ version: "desc" }], include: { _count: { select: { leadScores: true } } } }),
      options.database.leadPriorityBand.findMany({ where: { workspaceId, active: true, deletedAt: null, slaPolicy: { active: true, deletedAt: null } }, orderBy: [{ position: "asc" }], include: { slaPolicy: { include: { _count: { select: { priorityBands: true } } } }, _count: { select: { slaCycles: true } } } }),
      options.database.product.findMany({ where: { workspaceId, deletedAt: null }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { opportunities: true, offers: true } } } }),
      options.database.offerTemplate.findMany({ where: { workspaceId, deletedAt: null }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { product: { select: { name: true } }, components: { orderBy: { position: "asc" }, include: { product: { select: { name: true, revenueCategory: true } } } }, _count: { select: { offers: true } } } }),
      options.database.lossReason.findMany({ where: { workspaceId, deletedAt: null }, orderBy: [{ position: "asc" }, { name: "asc" }], include: { _count: { select: { opportunities: true } } } }),
      options.database.disqualificationReason.findMany({ where: { workspaceId, deletedAt: null }, orderBy: [{ position: "asc" }, { name: "asc" }], include: { _count: { select: { leads: true } } } }),
      options.database.pipeline.findMany({ where: { workspaceId, deletedAt: null }, orderBy: [{ entityType: "asc" }, { name: "asc" }], include: {
        stages: { where: { deletedAt: null }, orderBy: [{ position: "asc" }], include: { _count: { select: { currentLeads: true, currentOpportunities: true, histories: true } } } },
        transitions: { orderBy: [{ fromStageId: "asc" }, { toStageId: "asc" }], include: { fromStage: { select: { name: true } }, toStage: { select: { name: true } } } },
      } }),
      options.database.workspaceMember.findMany({ where: { workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, user: { select: { displayName: true } } }, orderBy: { user: { displayName: "asc" } } }),
    ]);
    if (!workspace) notFound("Workspace não encontrado.");
    const currentSettings = await options.database.commercialSettingsVersion.findFirst({
      where: { workspaceId, revision: workspace.commercialSettingsRevision },
      include: { cadence: { orderBy: { attemptNumber: "asc" } } },
    });
    if (!currentSettings) conflict("SETTINGS_HISTORY_INCONSISTENT", "A versão vigente das configurações não foi encontrada.");
    const meetingDuration = workspace.defaultMeetingDurationMinutes;
    if (meetingDuration !== 30 && meetingDuration !== 40) conflict("SETTINGS_INVALID", "A duração padrão de reunião é inválida.");
    return {
      workspace: {
        id: workspace.id, name: workspace.name, timeZone: workspace.timeZone, revision: workspace.commercialSettingsRevision,
        pactoMinimumInvestigatedDimensions: workspace.pactoMinimumInvestigatedDimensions,
        defaultMeetingDurationMinutes: meetingDuration, distributionStrategy: workspace.distributionStrategy,
        maxOpenLeadsPerSdr: workspace.maxOpenLeadsPerSdr, leadStagnationDays: workspace.leadStagnationDays,
        leadWithoutActivityDays: workspace.leadWithoutActivityDays,
        cadenceTemplateKey: currentSettings.cadenceTemplateKey,
        cadenceStopOnReply: currentSettings.cadenceStopOnReply,
        cadenceStopOnMeetingScheduled: currentSettings.cadenceStopOnMeetingScheduled,
        cadenceStopOnStageChange: currentSettings.cadenceStopOnStageChange,
        cadenceDayOffsets: currentSettings.cadence.map((step) => step.dayOffset),
        cadenceSteps: currentSettings.cadence.map((step) => ({ dayOffset: step.dayOffset, action: step.action, timeOfDay: step.timeOfDay ?? "09:00", message: step.message ?? "", assigneeMemberId: step.assigneeMemberId, targetStageId: step.targetStageId })),
      },
      members: members.map((member) => ({ id: member.id, name: member.user.displayName })),
      cadenceTargetStages: pipelines.filter((pipeline) => pipeline.entityType === "LEAD" && pipeline.isDefault).flatMap((pipeline) => pipeline.stages.filter((stage) => stage.type === "OPEN").map((stage) => ({ id: stage.id, name: stage.name }))),
      scoring: scoring ? {
        id: scoring.id, key: scoring.key, version: scoring.version, painMaxPoints: scoring.painMaxPoints,
        capacityMaxPoints: scoring.capacityMaxPoints, decisionMaxPoints: scoring.decisionMaxPoints,
        intentMaxPoints: scoring.intentMaxPoints, contextMaxPoints: scoring.contextMaxPoints,
        partialFactorBasisPoints: scoring.partialFactorBasisPoints, noCapacityPenalty: scoring.noCapacityPenalty,
        noPainPenalty: scoring.noPainPenalty, curiosityPenalty: scoring.curiosityPenalty,
        invalidContactPenalty: scoring.invalidContactPenalty, noDecisionAccessPenalty: scoring.noDecisionAccessPenalty,
        capacityFullThresholdCents: scoring.capacityFullThresholdCents.toString(), p1Minimum: scoring.p1Minimum,
        p2Minimum: scoring.p2Minimum, historicalCalculations: scoring._count.leadScores,
      } : null,
      slaBands: slaBands.map((band) => ({
        id: band.id, code: band.code, name: band.name, position: band.position,
        scoreMin: band.scoreMin, scoreMax: band.scoreMax, leadPriority: band.leadPriority,
        policyId: band.slaPolicy.id, policyKey: band.slaPolicy.key, policyVersion: band.slaPolicy.version,
        policyName: band.slaPolicy.name, firstResponseMinutes: band.slaPolicy.firstResponseMinutes,
        healthyMaxSeconds: band.slaPolicy.healthyMaxSeconds, attentionMaxSeconds: band.slaPolicy.attentionMaxSeconds,
        historicalCycles: band._count.slaCycles,
      })),
      products: products.map((product) => ({ id: product.id, catalogItemId: product.catalogItemId, version: product.version, sku: product.sku, name: product.name, description: product.description, listPriceCents: product.listPriceCents.toString(), kind: product.kind, revenueCategory: product.revenueCategory, audience: product.audience, availability: product.availability, capacityUnits: product.capacityUnits, approvedConditions: product.approvedConditions, salesGateProfile: product.salesGateProfile, active: product.active, updatedAt: product.updatedAt.toISOString(), opportunitiesInUse: product._count.opportunities, offersInUse: product._count.offers })),
      offerTemplates: templates.map((template) => ({ id: template.id, catalogTemplateId: template.catalogTemplateId, version: template.version, productId: template.productId, productName: template.product.name, key: template.key, name: template.name, description: template.description, priceCents: template.priceCents.toString(), discountCents: template.discountCents.toString(), validDays: template.validDays, availability: template.availability, approvedConditions: template.approvedConditions, components: template.components.map((component) => ({ productId: component.productId, productName: component.product.name, revenueCategory: component.product.revenueCategory, position: component.position, quantity: component.quantity, unitPriceCents: component.unitPriceCents.toString(), discountCents: component.discountCents.toString() })), active: template.active, updatedAt: template.updatedAt.toISOString(), offersInUse: template._count.offers })),
      lossReasons: lossReasons.map((reason) => ({ id: reason.id, key: reason.key, name: reason.name, position: reason.position, active: reason.active, updatedAt: reason.updatedAt.toISOString(), recordsInUse: reason._count.opportunities })),
      disqualificationReasons: disqualificationReasons.map((reason) => ({ id: reason.id, key: reason.key, name: reason.name, position: reason.position, active: reason.active, updatedAt: reason.updatedAt.toISOString(), recordsInUse: reason._count.leads })),
      pipelines: pipelines.map((pipeline) => ({
        id: pipeline.id, name: pipeline.name, entityType: pipeline.entityType, isDefault: pipeline.isDefault, updatedAt: pipeline.updatedAt.toISOString(),
        stages: pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name, position: stage.position, type: stage.type, code: stage.leadStageCode ?? stage.opportunityStageCode ?? "UNCONFIGURED", currentRecords: stage._count.currentLeads + stage._count.currentOpportunities, historyRecords: stage._count.histories })),
        transitions: pipeline.transitions.map((transition) => ({ id: transition.id, fromStageId: transition.fromStageId, fromName: transition.fromStage.name, toStageId: transition.toStageId, toName: transition.toStage.name, active: transition.active })),
      })),
    };
  }

  async function preview(context: AuthenticatedContext, input: unknown): Promise<SettingsPreview> {
    await authorize(context);
    const command = parseCommand(input);
    const screen = await getScreen(context);
    switch (command.action) {
      case "SAVE_OPERATIONAL_POLICY":
        return { title: "Atualizar regras operacionais", summary: `Criará a revisão ${screen.workspace.revision + 1}; as revisões anteriores continuarão imutáveis.`, warnings: ["A nova duração valerá apenas para novos agendamentos.", "O limite de carga passa a influenciar novas distribuições."], impacts: [{ key: "leads", label: "Leads abertos existentes (não redistribuídos automaticamente)", count: await options.database.lead.count({ where: { workspaceId: context.workspaceId, status: { in: ["OPEN", "QUALIFIED"] }, deletedAt: null } }) }] };
      case "SAVE_SCORING_SLA":
        return { title: "Versionar scoring e SLA", summary: `Criará a versão ${command.expectedScoringVersion + 1}; pontuações e ciclos anteriores manterão a regra original.`, warnings: ["Nenhum score histórico será reescrito.", "O SLA permanece imediato — 0 minutos."], impacts: [{ key: "scores", label: "Pontuações históricas preservadas", count: screen.scoring?.historicalCalculations ?? 0 }, { key: "sla", label: "Ciclos históricos preservados", count: screen.slaBands.reduce((sum, band) => sum + band.historicalCycles, 0) }] };
      case "SAVE_PRODUCT": return { title: command.id ? "Atualizar produto" : "Criar produto", summary: "O catálogo do workspace será atualizado sem reescrever oportunidades ou ofertas.", warnings: [], impacts: command.id ? screen.products.filter((item) => item.id === command.id).flatMap((item) => [{ key: "opportunities", label: "Oportunidades vinculadas", count: item.opportunitiesInUse }, { key: "offers", label: "Propostas vinculadas", count: item.offersInUse }]) : [] };
      case "SET_PRODUCT_ACTIVE": return { title: command.active ? "Reativar produto" : "Inativar produto", summary: "O histórico permanece consultável; a opção deixa de aparecer em novos fluxos quando inativa.", warnings: command.active ? [] : ["Registros existentes não serão alterados."], impacts: screen.products.filter((item) => item.id === command.id).flatMap((item) => [{ key: "opportunities", label: "Oportunidades vinculadas", count: item.opportunitiesInUse }, { key: "offers", label: "Propostas vinculadas", count: item.offersInUse }]) };
      case "SAVE_OFFER_TEMPLATE": return { title: command.id ? "Atualizar plano/oferta" : "Criar plano/oferta", summary: "A alteração vale para novas propostas; propostas emitidas preservam seus valores.", warnings: [], impacts: command.id ? screen.offerTemplates.filter((item) => item.id === command.id).map((item) => ({ key: "offers", label: "Propostas vinculadas", count: item.offersInUse })) : [] };
      case "SET_OFFER_TEMPLATE_ACTIVE": return { title: command.active ? "Reativar plano/oferta" : "Inativar plano/oferta", summary: "Propostas históricas permanecem intactas.", warnings: [], impacts: screen.offerTemplates.filter((item) => item.id === command.id).map((item) => ({ key: "offers", label: "Propostas vinculadas", count: item.offersInUse })) };
      case "SAVE_REASON": return { title: command.id ? "Atualizar motivo" : "Criar motivo", summary: "O motivo pertence somente a este workspace.", warnings: [], impacts: [] };
      case "SET_REASON_ACTIVE": {
        const reasons = command.reasonType === "LOSS_REASON" ? screen.lossReasons : screen.disqualificationReasons;
        return { title: command.active ? "Reativar motivo" : "Inativar motivo", summary: "Registros históricos continuarão apontando para este motivo.", warnings: [], impacts: reasons.filter((item) => item.id === command.id).map((item) => ({ key: "records", label: "Registros vinculados", count: item.recordsInUse })) };
      }
      case "SAVE_PIPELINE": {
        const pipeline = screen.pipelines.find((item) => item.id === command.pipelineId);
        return { title: "Atualizar nomes e ordem do pipeline", summary: "Códigos semânticos e histórico de etapas serão preservados.", warnings: ["A ordem visual muda imediatamente."], impacts: [{ key: "records", label: "Registros atualmente no pipeline", count: pipeline?.stages.reduce((sum, stage) => sum + stage.currentRecords, 0) ?? 0 }, { key: "history", label: "Eventos históricos preservados", count: pipeline?.stages.reduce((sum, stage) => sum + stage.historyRecords, 0) ?? 0 }] };
      }
      case "SET_TRANSITION_ACTIVE": return { title: command.active ? "Permitir transição" : "Bloquear transição", summary: "A regra passa a ser validada pelos serviços do domínio.", warnings: command.active ? [] : ["Movimentos futuros por esta rota serão bloqueados."], impacts: [] };
    }
  }

  async function writeAudit(
    transaction: Prisma.TransactionClient,
    context: AuthenticatedContext,
    action: string,
    entityType: string,
    entityId: string,
    previous: unknown,
    next: unknown,
  ) {
    await transaction.auditLog.create({
      data: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        action,
        entityType,
        entityId,
        changes: asJson({ previous, next }),
        metadata: asJson({ source: "commercial_settings", confirmedByHuman: true }),
      },
    });
  }

  async function assertUniqueCatalogKey(
    transaction: Prisma.TransactionClient,
    context: AuthenticatedContext,
    kind: "product" | "offerTemplate" | "lossReason" | "disqualificationReason",
    key: string,
    excludedId: string | null,
  ) {
    const common = { workspaceId: context.workspaceId, deletedAt: null, ...(excludedId ? { id: { not: excludedId } } : {}) };
    const found = kind === "product"
      ? await transaction.product.findFirst({ where: { ...common, sku: { equals: key, mode: "insensitive" } }, select: { id: true } })
      : kind === "offerTemplate"
        ? await transaction.offerTemplate.findFirst({ where: { ...common, key: { equals: key, mode: "insensitive" } }, select: { id: true } })
        : kind === "lossReason"
          ? await transaction.lossReason.findFirst({ where: { ...common, key: { equals: key, mode: "insensitive" } }, select: { id: true } })
          : await transaction.disqualificationReason.findFirst({ where: { ...common, key: { equals: key, mode: "insensitive" } }, select: { id: true } });
    if (found) conflict("SETTINGS_KEY_CONFLICT", "Já existe um item com esta chave neste workspace.");
  }

  async function applyOperational(
    transaction: Prisma.TransactionClient,
    context: AuthenticatedContext,
    command: z.infer<typeof operationalCommand>,
  ) {
    const workspace = await transaction.workspace.findFirst({ where: { id: context.workspaceId, deletedAt: null } });
    if (!workspace) notFound("Workspace não encontrado.");
    if (workspace.commercialSettingsRevision !== command.expectedRevision) conflict("SETTINGS_VERSION_CONFLICT", "As configurações mudaram. Recarregue antes de confirmar.");
    const nextRevision = workspace.commercialSettingsRevision + 1;
    const previous = {
      revision: workspace.commercialSettingsRevision,
      pactoMinimumInvestigatedDimensions: workspace.pactoMinimumInvestigatedDimensions,
      defaultMeetingDurationMinutes: workspace.defaultMeetingDurationMinutes,
      distributionStrategy: workspace.distributionStrategy,
      maxOpenLeadsPerSdr: workspace.maxOpenLeadsPerSdr,
      leadStagnationDays: workspace.leadStagnationDays,
      leadWithoutActivityDays: workspace.leadWithoutActivityDays,
    };
    const nextCadence = cadenceSteps(command);
    const assigneeIds = [...new Set(nextCadence.flatMap((step) => step.assigneeMemberId ? [step.assigneeMemberId] : []))];
    const targetStageIds = [...new Set(nextCadence.flatMap((step) => step.targetStageId ? [step.targetStageId] : []))];
    const [validAssignees, validStages] = await Promise.all([
      assigneeIds.length ? transaction.workspaceMember.count({ where: { workspaceId: context.workspaceId, id: { in: assigneeIds }, status: "ACTIVE", deletedAt: null } }) : 0,
      targetStageIds.length ? transaction.pipelineStage.count({ where: { workspaceId: context.workspaceId, id: { in: targetStageIds }, deletedAt: null, type: "OPEN", pipeline: { entityType: "LEAD", isDefault: true, deletedAt: null } } }) : 0,
    ]);
    if (validAssignees !== assigneeIds.length) invalidInput("Um responsável da cadência não está ativo neste workspace.");
    if (validStages !== targetStageIds.length) invalidInput("Uma etapa de destino da cadência não pertence a um pipeline de leads ativo.");
    const next = {
      revision: nextRevision,
      pactoMinimumInvestigatedDimensions: command.pactoMinimumInvestigatedDimensions,
      defaultMeetingDurationMinutes: command.defaultMeetingDurationMinutes,
      distributionStrategy: command.distributionStrategy,
      maxOpenLeadsPerSdr: command.maxOpenLeadsPerSdr,
      leadStagnationDays: command.leadStagnationDays,
      leadWithoutActivityDays: command.leadWithoutActivityDays,
      cadenceTemplateKey: command.cadenceTemplateKey,
      cadenceStopOnReply: command.cadenceStopOnReply,
      cadenceStopOnMeetingScheduled: command.cadenceStopOnMeetingScheduled,
      cadenceStopOnStageChange: command.cadenceStopOnStageChange,
      cadenceSteps: nextCadence,
    };
    await transaction.commercialSettingsVersion.create({
      data: {
        workspaceId: context.workspaceId, revision: nextRevision,
        pactoMinimumInvestigatedDimensions: command.pactoMinimumInvestigatedDimensions,
        defaultMeetingDurationMinutes: command.defaultMeetingDurationMinutes,
        distributionStrategy: command.distributionStrategy, maxOpenLeadsPerSdr: command.maxOpenLeadsPerSdr,
        leadStagnationDays: command.leadStagnationDays, leadWithoutActivityDays: command.leadWithoutActivityDays,
        cadenceTemplateKey: command.cadenceTemplateKey,
        cadenceStopOnReply: command.cadenceStopOnReply,
        cadenceStopOnMeetingScheduled: command.cadenceStopOnMeetingScheduled,
        cadenceStopOnStageChange: command.cadenceStopOnStageChange,
        createdByActorId: context.actorId,
        cadence: { create: nextCadence.map((step, index) => ({ attemptNumber: index + 1, dayOffset: step.dayOffset, action: step.action, timeOfDay: step.timeOfDay, message: step.message || null, assigneeMemberId: step.assigneeMemberId, targetStageId: step.targetStageId })) },
      },
    });
    await transaction.workspace.update({
      where: { id: workspace.id },
      data: {
        commercialSettingsRevision: nextRevision,
        pactoMinimumInvestigatedDimensions: command.pactoMinimumInvestigatedDimensions,
        defaultMeetingDurationMinutes: command.defaultMeetingDurationMinutes,
        distributionStrategy: command.distributionStrategy,
        maxOpenLeadsPerSdr: command.maxOpenLeadsPerSdr,
        leadStagnationDays: command.leadStagnationDays,
        leadWithoutActivityDays: command.leadWithoutActivityDays,
      },
    });
    await writeAudit(transaction, context, "settings.operational.versioned", "Workspace", workspace.id, previous, next);
  }

  async function applyScoring(
    transaction: Prisma.TransactionClient,
    context: AuthenticatedContext,
    command: z.infer<typeof scoringCommand>,
  ) {
    const current = await transaction.scoringRuleVersion.findFirst({ where: { workspaceId: context.workspaceId, active: true }, orderBy: { version: "desc" } });
    if (!current) notFound("Regra de scoring vigente não encontrada.");
    if (current.version !== command.expectedScoringVersion) conflict("SETTINGS_VERSION_CONFLICT", "O scoring mudou. Recarregue antes de confirmar.");
    const policies = await transaction.slaPolicy.findMany({ where: { workspaceId: context.workspaceId, active: true, deletedAt: null }, orderBy: { key: "asc" } });
    const bands = await transaction.leadPriorityBand.findMany({ where: { workspaceId: context.workspaceId, active: true, deletedAt: null }, orderBy: { position: "asc" } });
    if (policies.length !== 3 || bands.length !== 3) conflict("SETTINGS_HISTORY_INCONSISTENT", "São necessárias exatamente três faixas P1, P2 e P3 vigentes.");
    const byCode = new Map(bands.map((band) => [band.code, band]));
    if (!byCode.has("P1") || !byCode.has("P2") || !byCode.has("P3")) conflict("SETTINGS_HISTORY_INCONSISTENT", "As faixas P1, P2 e P3 estão incompletas.");
    await transaction.scoringRuleVersion.update({ where: { id: current.id }, data: { active: false } });
    const nextVersion = current.version + 1;
    const nextRule = await transaction.scoringRuleVersion.create({
      data: {
        workspaceId: context.workspaceId, key: current.key, version: nextVersion,
        algorithmKey: current.algorithmKey, painMaxPoints: command.painMaxPoints,
        capacityMaxPoints: command.capacityMaxPoints, decisionMaxPoints: command.decisionMaxPoints,
        intentMaxPoints: command.intentMaxPoints, contextMaxPoints: command.contextMaxPoints,
        partialFactorBasisPoints: command.partialFactorBasisPoints, noCapacityPenalty: command.noCapacityPenalty,
        noPainPenalty: command.noPainPenalty, curiosityPenalty: command.curiosityPenalty,
        invalidContactPenalty: command.invalidContactPenalty, noDecisionAccessPenalty: command.noDecisionAccessPenalty,
        capacityFullThresholdCents: command.capacityFullThresholdCents,
        p1Minimum: command.p1Minimum, p2Minimum: command.p2Minimum,
        createdByActorId: context.actorId,
      },
    });
    await transaction.leadPriorityBand.updateMany({ where: { workspaceId: context.workspaceId, active: true, deletedAt: null }, data: { active: false, updatedByActorId: context.actorId } });
    await transaction.slaPolicy.updateMany({ where: { workspaceId: context.workspaceId, active: true, deletedAt: null }, data: { active: false, updatedByActorId: context.actorId } });
    const ranges = {
      P1: { min: command.p1Minimum, max: 100 },
      P2: { min: command.p2Minimum, max: command.p1Minimum - 1 },
      P3: { min: 0, max: command.p2Minimum - 1 },
    } as const;
    for (const oldPolicy of policies) {
      const oldBand = bands.find((band) => band.slaPolicyId === oldPolicy.id);
      if (!oldBand) conflict("SETTINGS_HISTORY_INCONSISTENT", `A política ${oldPolicy.key} não possui faixa vigente.`);
      const policy = await transaction.slaPolicy.create({
        data: {
          workspaceId: context.workspaceId, key: oldPolicy.key, name: "SLA imediato — 0 minutos",
          firstResponseMinutes: 0, warningMinutesBeforeDue: 0,
          healthyMaxSeconds: command.healthyMaxSeconds, attentionMaxSeconds: command.attentionMaxSeconds,
          version: oldPolicy.version + 1, supersedesPolicyId: oldPolicy.id,
          createdByActorId: context.actorId, updatedByActorId: context.actorId,
        },
      });
      const range = ranges[oldBand.code];
      await transaction.leadPriorityBand.create({
        data: {
          workspaceId: context.workspaceId, slaPolicyId: policy.id, code: oldBand.code,
          name: oldBand.name, position: oldBand.position, scoreMin: range.min, scoreMax: range.max,
          leadPriority: oldBand.leadPriority, createdByActorId: context.actorId, updatedByActorId: context.actorId,
        },
      });
    }
    await writeAudit(transaction, context, "settings.scoring_sla.versioned", "ScoringRuleVersion", nextRule.id,
      { scoringRuleId: current.id, scoringVersion: current.version, policies: policies.map((policy) => ({ id: policy.id, key: policy.key, version: policy.version })) },
      { scoringRuleId: nextRule.id, scoringVersion: nextVersion, p1Minimum: command.p1Minimum, p2Minimum: command.p2Minimum, healthyMaxSeconds: command.healthyMaxSeconds, attentionMaxSeconds: command.attentionMaxSeconds, slaMinutes: 0 });
  }

  async function applyProduct(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: z.infer<typeof productCommand>) {
    await assertUniqueCatalogKey(transaction, context, "product", command.sku, command.id);
    const active = isCatalogItemSellable({ active: true, audience: command.audience, availability: command.availability, capacityUnits: command.capacityUnits });
    if (!command.id) {
      const product = await transaction.product.create({ data: { workspaceId: context.workspaceId, sku: command.sku, name: command.name, description: command.description, kind: command.kind, revenueCategory: command.revenueCategory, audience: command.audience, availability: command.availability, capacityUnits: command.capacityUnits, approvedConditions: command.approvedConditions, salesGateProfile: command.salesGateProfile, listPriceCents: command.listPriceCents, active, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await writeAudit(transaction, context, "settings.product.version_created", "Product", product.id, null, { catalogItemId: product.catalogItemId, version: product.version, sku: product.sku, name: product.name, kind: product.kind, revenueCategory: product.revenueCategory, availability: product.availability, active: product.active, listPriceCents: product.listPriceCents.toString() });
      return;
    }
    const current = await transaction.product.findFirst({ where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null } });
    if (!current) notFound("Produto não encontrado.");
    if (!command.expectedUpdatedAt || current.updatedAt.getTime() !== new Date(command.expectedUpdatedAt).getTime()) conflict("SETTINGS_VERSION_CONFLICT", "O produto mudou. Recarregue antes de confirmar.");
    await transaction.product.update({ where: { id: current.id }, data: { active: false, updatedByActorId: context.actorId } });
    const updated = await transaction.product.create({ data: { workspaceId: context.workspaceId, catalogItemId: current.catalogItemId, version: current.version + 1, sku: command.sku, name: command.name, description: command.description, kind: command.kind, revenueCategory: command.revenueCategory, audience: command.audience, availability: command.availability, capacityUnits: command.capacityUnits, approvedConditions: command.approvedConditions, salesGateProfile: command.salesGateProfile, listPriceCents: command.listPriceCents, active, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    await writeAudit(transaction, context, "settings.product.version_created", "Product", updated.id, { productVersionId: current.id, version: current.version }, { catalogItemId: updated.catalogItemId, productVersionId: updated.id, version: updated.version, sku: updated.sku, name: updated.name, kind: updated.kind, revenueCategory: updated.revenueCategory, availability: updated.availability, active: updated.active, listPriceCents: updated.listPriceCents.toString() });
  }

  async function applyProductStatus(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: z.infer<typeof productStatusCommand>) {
    const current = await transaction.product.findFirst({ where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null } });
    if (!current) notFound("Produto não encontrado.");
    if (current.active === command.active) return;
    if (command.active && !isCatalogItemSellable(current)) conflict("CATALOG_ITEM_NOT_SELLABLE", "Somente versão institucional disponível e com capacidade pode ser ativada.");
    await transaction.product.update({ where: { id: current.id }, data: { active: command.active, updatedByActorId: context.actorId } });
    await writeAudit(transaction, context, command.active ? "settings.product.activated" : "settings.product.deactivated", "Product", current.id, { active: current.active }, { active: command.active });
  }

  async function applyOfferTemplate(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: z.infer<typeof offerTemplateCommand>) {
    const product = await transaction.product.findFirst({ where: { id: command.productId, workspaceId: context.workspaceId, deletedAt: null } });
    if (!product) notFound("Produto da oferta não encontrado.");
    if (!product.active) conflict("INACTIVE_CATALOG_ITEM", "Reative o produto antes de criar ou alterar esta oferta.");
    const componentIds = [...new Set(command.components.map((component) => component.productId))];
    const components = componentIds.length ? await transaction.product.findMany({ where: { workspaceId: context.workspaceId, id: { in: componentIds }, deletedAt: null } }) : [product];
    if (components.length !== (componentIds.length || 1) || components.some((component) => !isCatalogItemSellable(component))) conflict("CATALOG_COMPONENT_NOT_SELLABLE", "Todos os componentes devem ser versões ativas, institucionais e disponíveis.");
    const lineInputs = command.components.length ? command.components : [{ productId: product.id, quantity: 1, unitPriceCents: command.priceCents, discountCents: command.discountCents }];
    await assertUniqueCatalogKey(transaction, context, "offerTemplate", command.key, command.id);
    if (!command.id) {
      const template = await transaction.offerTemplate.create({ data: { workspaceId: context.workspaceId, productId: product.id, key: command.key, name: command.name, description: command.description, priceCents: command.priceCents, discountCents: command.discountCents, validDays: command.validDays, availability: command.availability, approvedConditions: command.approvedConditions, active: command.availability === "AVAILABLE" || command.availability === "CAPACITY_LIMITED", createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await transaction.catalogBundleLine.createMany({ data: lineInputs.map((component, position) => ({ workspaceId: context.workspaceId, offerTemplateId: template.id, productId: component.productId, position: position + 1, quantity: component.quantity, unitPriceCents: component.unitPriceCents, discountCents: component.discountCents })) });
      await writeAudit(transaction, context, "settings.offer_template.created", "OfferTemplate", template.id, null, { productId: template.productId, key: template.key, name: template.name, priceCents: template.priceCents.toString(), discountCents: template.discountCents.toString(), validDays: template.validDays });
      return;
    }
    const current = await transaction.offerTemplate.findFirst({ where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null } });
    if (!current) notFound("Oferta/plano não encontrado.");
    if (!command.expectedUpdatedAt || current.updatedAt.getTime() !== new Date(command.expectedUpdatedAt).getTime()) conflict("SETTINGS_VERSION_CONFLICT", "A oferta mudou. Recarregue antes de confirmar.");
    await transaction.offerTemplate.update({ where: { id: current.id }, data: { active: false, updatedByActorId: context.actorId } });
    const updated = await transaction.offerTemplate.create({ data: { workspaceId: context.workspaceId, productId: product.id, catalogTemplateId: current.catalogTemplateId, version: current.version + 1, key: command.key, name: command.name, description: command.description, priceCents: command.priceCents, discountCents: command.discountCents, validDays: command.validDays, availability: command.availability, approvedConditions: command.approvedConditions, active: command.availability === "AVAILABLE" || command.availability === "CAPACITY_LIMITED", createdByActorId: context.actorId, updatedByActorId: context.actorId } });
    await transaction.catalogBundleLine.createMany({ data: lineInputs.map((component, position) => ({ workspaceId: context.workspaceId, offerTemplateId: updated.id, productId: component.productId, position: position + 1, quantity: component.quantity, unitPriceCents: component.unitPriceCents, discountCents: component.discountCents })) });
    await writeAudit(transaction, context, "settings.offer_template.updated", "OfferTemplate", current.id,
      { productId: current.productId, key: current.key, name: current.name, priceCents: current.priceCents.toString(), discountCents: current.discountCents.toString(), validDays: current.validDays },
      { productId: updated.productId, key: updated.key, name: updated.name, priceCents: updated.priceCents.toString(), discountCents: updated.discountCents.toString(), validDays: updated.validDays });
  }

  async function applyOfferTemplateStatus(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: z.infer<typeof offerTemplateStatusCommand>) {
    const current = await transaction.offerTemplate.findFirst({ where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null } });
    if (!current) notFound("Oferta/plano não encontrado.");
    if (current.active === command.active) return;
    if (command.active) {
      const product = await transaction.product.findFirst({ where: { id: current.productId, workspaceId: context.workspaceId, active: true, deletedAt: null }, select: { id: true } });
      if (!product) conflict("INACTIVE_CATALOG_ITEM", "Reative o produto antes de reativar esta oferta.");
    }
    await transaction.offerTemplate.update({ where: { id: current.id }, data: { active: command.active, updatedByActorId: context.actorId } });
    await writeAudit(transaction, context, command.active ? "settings.offer_template.activated" : "settings.offer_template.deactivated", "OfferTemplate", current.id, { active: current.active }, { active: command.active });
  }

  async function applyReason(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: z.infer<typeof reasonCommand>) {
    const kind = command.reasonType === "LOSS_REASON" ? "lossReason" : "disqualificationReason";
    await assertUniqueCatalogKey(transaction, context, kind, command.key, command.id);
    if (command.reasonType === "LOSS_REASON") {
      if (!command.id) {
        const created = await transaction.lossReason.create({ data: { workspaceId: context.workspaceId, key: command.key, name: command.name, position: command.position, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
        await writeAudit(transaction, context, "settings.loss_reason.created", "LossReason", created.id, null, { key: created.key, name: created.name, position: created.position });
        return;
      }
      const current = await transaction.lossReason.findFirst({ where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null } });
      if (!current) notFound("Motivo de perda não encontrado.");
      if (!command.expectedUpdatedAt || current.updatedAt.getTime() !== new Date(command.expectedUpdatedAt).getTime()) conflict("SETTINGS_VERSION_CONFLICT", "O motivo mudou. Recarregue antes de confirmar.");
      const updated = await transaction.lossReason.update({ where: { id: current.id }, data: { key: command.key, name: command.name, position: command.position, updatedByActorId: context.actorId } });
      await writeAudit(transaction, context, "settings.loss_reason.updated", "LossReason", current.id, { key: current.key, name: current.name, position: current.position }, { key: updated.key, name: updated.name, position: updated.position });
      return;
    }
    if (!command.id) {
      const created = await transaction.disqualificationReason.create({ data: { workspaceId: context.workspaceId, key: command.key, name: command.name, position: command.position, createdByActorId: context.actorId, updatedByActorId: context.actorId } });
      await writeAudit(transaction, context, "settings.disqualification_reason.created", "DisqualificationReason", created.id, null, { key: created.key, name: created.name, position: created.position });
      return;
    }
    const current = await transaction.disqualificationReason.findFirst({ where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null } });
    if (!current) notFound("Motivo de desqualificação não encontrado.");
    if (!command.expectedUpdatedAt || current.updatedAt.getTime() !== new Date(command.expectedUpdatedAt).getTime()) conflict("SETTINGS_VERSION_CONFLICT", "O motivo mudou. Recarregue antes de confirmar.");
    const updated = await transaction.disqualificationReason.update({ where: { id: current.id }, data: { key: command.key, name: command.name, position: command.position, updatedByActorId: context.actorId } });
    await writeAudit(transaction, context, "settings.disqualification_reason.updated", "DisqualificationReason", current.id, { key: current.key, name: current.name, position: current.position }, { key: updated.key, name: updated.name, position: updated.position });
  }

  async function applyReasonStatus(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: z.infer<typeof reasonStatusCommand>) {
    if (command.reasonType === "LOSS_REASON") {
      const current = await transaction.lossReason.findFirst({ where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null } });
      if (!current) notFound("Motivo de perda não encontrado.");
      if (current.active === command.active) return;
      await transaction.lossReason.update({ where: { id: current.id }, data: { active: command.active, updatedByActorId: context.actorId } });
      await writeAudit(transaction, context, command.active ? "settings.loss_reason.activated" : "settings.loss_reason.deactivated", "LossReason", current.id, { active: current.active }, { active: command.active });
      return;
    }
    const current = await transaction.disqualificationReason.findFirst({ where: { id: command.id, workspaceId: context.workspaceId, deletedAt: null } });
    if (!current) notFound("Motivo de desqualificação não encontrado.");
    if (current.active === command.active) return;
    await transaction.disqualificationReason.update({ where: { id: current.id }, data: { active: command.active, updatedByActorId: context.actorId } });
    await writeAudit(transaction, context, command.active ? "settings.disqualification_reason.activated" : "settings.disqualification_reason.deactivated", "DisqualificationReason", current.id, { active: current.active }, { active: command.active });
  }

  async function applyPipeline(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: z.infer<typeof pipelineCommand>) {
    const current = await transaction.pipeline.findFirst({ where: { id: command.pipelineId, workspaceId: context.workspaceId, deletedAt: null }, include: { stages: { where: { deletedAt: null }, orderBy: { position: "asc" } } } });
    if (!current) notFound("Pipeline não encontrado.");
    if (current.updatedAt.getTime() !== new Date(command.expectedUpdatedAt).getTime()) conflict("SETTINGS_VERSION_CONFLICT", "O pipeline mudou. Recarregue antes de confirmar.");
    const currentIds = new Set(current.stages.map((stage) => stage.id));
    if (command.stages.length !== current.stages.length || command.stages.some((stage) => !currentIds.has(stage.id))) invalidInput("Todas as etapas existentes devem ser enviadas; criação e remoção estrutural não fazem parte deste editor seguro.");
    const positions = [...command.stages.map((stage) => stage.position)].sort((a, b) => a - b);
    if (positions.some((position, index) => position !== index)) invalidInput("A ordenação deve usar posições contínuas iniciadas em zero.");
    await transaction.pipeline.update({ where: { id: current.id }, data: { name: command.name, updatedByActorId: context.actorId } });
    for (const [index, stage] of current.stages.entries()) {
      await transaction.pipelineStage.update({ where: { id: stage.id }, data: { position: 1_000 + index, updatedByActorId: context.actorId } });
    }
    for (const stage of command.stages) {
      await transaction.pipelineStage.update({ where: { id: stage.id }, data: { name: stage.name, position: stage.position, updatedByActorId: context.actorId } });
    }
    await writeAudit(transaction, context, "settings.pipeline.updated", "Pipeline", current.id,
      { name: current.name, stages: current.stages.map((stage) => ({ id: stage.id, name: stage.name, position: stage.position })) },
      { name: command.name, stages: command.stages });
  }

  async function applyTransitionStatus(transaction: Prisma.TransactionClient, context: AuthenticatedContext, command: z.infer<typeof transitionStatusCommand>) {
    const current = await transaction.pipelineStageTransition.findFirst({ where: { id: command.transitionId, workspaceId: context.workspaceId }, include: { fromStage: true, toStage: true } });
    if (!current) notFound("Transição não encontrada.");
    if (current.active === command.active) return;
    if (!command.active) {
      const [remaining, currentLeads, currentOpportunities] = await Promise.all([
        transaction.pipelineStageTransition.count({ where: { workspaceId: context.workspaceId, pipelineId: current.pipelineId, fromStageId: current.fromStageId, active: true, id: { not: current.id } } }),
        transaction.lead.count({ where: { workspaceId: context.workspaceId, pipelineId: current.pipelineId, currentStageId: current.fromStageId, status: { in: ["OPEN", "QUALIFIED"] }, deletedAt: null } }),
        transaction.opportunity.count({ where: { workspaceId: context.workspaceId, pipelineId: current.pipelineId, currentStageId: current.fromStageId, status: "OPEN", deletedAt: null } }),
      ]);
      if (remaining === 0 && currentLeads + currentOpportunities > 0) conflict("PIPELINE_WOULD_STRAND_RECORDS", "Esta é a última saída ativa de uma etapa com registros abertos.");
    }
    await transaction.pipelineStageTransition.update({ where: { id: current.id }, data: { active: command.active, updatedByActorId: context.actorId } });
    await writeAudit(transaction, context, command.active ? "settings.pipeline_transition.activated" : "settings.pipeline_transition.deactivated", "PipelineStageTransition", current.id,
      { active: current.active, from: current.fromStage.name, to: current.toStage.name },
      { active: command.active, from: current.fromStage.name, to: current.toStage.name });
  }

  async function apply(context: AuthenticatedContext, input: unknown): Promise<CommercialSettingsScreen> {
    await authorize(context);
    const command = parseCommand(input);
    if (!command.confirmed) conflict("SETTINGS_CONFIRMATION_REQUIRED", "Revise o impacto e confirme a alteração.");
    await options.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`commercial-settings:${context.workspaceId}`}, 0))`;
      switch (command.action) {
        case "SAVE_OPERATIONAL_POLICY": await applyOperational(transaction, context, command); break;
        case "SAVE_SCORING_SLA": await applyScoring(transaction, context, command); break;
        case "SAVE_PRODUCT": await applyProduct(transaction, context, command); break;
        case "SET_PRODUCT_ACTIVE": await applyProductStatus(transaction, context, command); break;
        case "SAVE_OFFER_TEMPLATE": await applyOfferTemplate(transaction, context, command); break;
        case "SET_OFFER_TEMPLATE_ACTIVE": await applyOfferTemplateStatus(transaction, context, command); break;
        case "SAVE_REASON": await applyReason(transaction, context, command); break;
        case "SET_REASON_ACTIVE": await applyReasonStatus(transaction, context, command); break;
        case "SAVE_PIPELINE": await applyPipeline(transaction, context, command); break;
        case "SET_TRANSITION_ACTIVE": await applyTransitionStatus(transaction, context, command); break;
      }
      await options.beforeCommit?.();
    }, { isolationLevel: "Serializable", timeout: 15_000 });
    return getScreen(context);
  }

  return Object.freeze({ getScreen, preview, apply });
}

let service: ReturnType<typeof createCommercialSettingsService> | undefined;
export function getCommercialSettingsService() {
  service ??= createCommercialSettingsService({ database: getDatabaseClient(), authorization: getAuthorizationService() });
  return service;
}
