import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import type {
  AutomationActionExecution,
  AutomationActionExecutor,
} from "@/modules/automations/domain/automation-contracts";
import {
  cancelOutreachCadencesInTransaction,
} from "@/modules/automations/application/lifecycle-automation-scheduler";
import {
  LifecycleAutomationKeys,
  type LifecycleAutomationKey,
} from "@/modules/automations/domain/predefined-lifecycle-automations";
import { transitionLeadStageInTransaction } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { evaluatePrivacyInTransaction } from "@/modules/privacy/application/privacy-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { workspaceDayRange } from "@/shared/core/time/workspace-time";
import { z } from "zod";

const lifecycleKeys = Object.values(LifecycleAutomationKeys) as [
  LifecycleAutomationKey,
  ...LifecycleAutomationKey[],
];

const actionConfigSchema = z
  .object({ automationKey: z.enum(lifecycleKeys) })
  .passthrough();

const payloadSchema = z
  .object({
    eventType: z.string().min(1),
    leadId: z.string().uuid(),
    activityId: z.string().uuid().nullable().optional(),
    attemptNumber: z.number().int().positive().optional(),
    dayOffset: z.number().int().min(0).optional(),
    cadenceAction: z.enum(["WHATSAPP", "CALL", "EMAIL", "RECYCLE", "CLOSE"]).optional(),
    cadenceMessage: z.string().max(2_000).nullable().optional(),
    assigneeMemberId: z.string().uuid().nullable().optional(),
    targetStageId: z.string().uuid().nullable().optional(),
    initialStageId: z.string().uuid().optional(),
    stopOnReply: z.boolean().optional(),
    stopOnMeetingScheduled: z.boolean().optional(),
    stopOnStageChange: z.boolean().optional(),
    cadenceTemplateKey: z.string().max(80).optional(),
    cadenceStartedAt: z.coerce.date().optional(),
    scheduledFor: z.coerce.date().optional(),
    settingsRevision: z.number().int().positive().optional(),
    timeZone: z.string().min(1).optional(),
    meetingId: z.string().uuid().optional(),
    meetingRevision: z.number().int().positive().optional(),
    reminderMinutes: z.union([z.literal(1_440), z.literal(120), z.literal(15)]).optional(),
    expectedStartsAt: z.coerce.date().optional(),
    recoveryTaskId: z.string().uuid().nullable().optional(),
    stageHistoryId: z.string().uuid().optional(),
    thresholdDays: z.number().int().positive().optional(),
    detectedUpdatedAt: z.coerce.date().optional(),
    opportunityId: z.string().uuid().optional(),
    status: z.enum(["WON", "LOST"]).optional(),
  })
  .passthrough();

type LeadRecord = Awaited<ReturnType<typeof getLead>>;

function invalidAction(message: string, code = "INVALID_LIFECYCLE_AUTOMATION_EVENT"): never {
  throw new ApplicationError(message, {
    code,
    statusCode: 409,
    expose: true,
  });
}

function eventPayload(execution: AutomationActionExecution) {
  const parsed = payloadSchema.safeParse(execution.eventPayload.payload);
  if (!parsed.success) invalidAction("O evento da automação de ciclo de vida é inválido.");
  return parsed.data;
}

async function getLead(
  transaction: PrismaTypes.TransactionClient,
  workspaceId: string,
  leadId: string,
) {
  const lead = await transaction.lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      jobTitle: true,
      organizationName: true,
      interestSummary: true,
      contactPreference: true,
      status: true,
      priority: true,
      ownerMemberId: true,
      queueId: true,
      routingQueueId: true,
      nextActionTaskId: true,
      nextActionAt: true,
      nextActionDescription: true,
      lastInboundResponseAt: true,
      currentStageId: true,
      owner: {
        select: {
          status: true,
          deletedAt: true,
          user: { select: { status: true, deletedAt: true } },
        },
      },
      routingQueue: { select: { teamId: true } },
      queue: { select: { teamId: true } },
      workspace: { select: { timeZone: true } },
    },
  });
  if (!lead) invalidAction("Lead da automação não foi encontrado.", "LEAD_NOT_FOUND");
  return lead;
}

function activeOwner(lead: LeadRecord): string | null {
  return lead.ownerMemberId &&
    lead.owner?.status === "ACTIVE" &&
    lead.owner.deletedAt === null &&
    lead.owner.user.status === "ACTIVE" &&
    lead.owner.user.deletedAt === null
    ? lead.ownerMemberId
    : null;
}

async function recipients(
  transaction: PrismaTypes.TransactionClient,
  workspaceId: string,
  lead: LeadRecord,
  includeManagers = false,
) {
  const values = new Set<string>();
  const owner = activeOwner(lead);
  if (owner) values.add(owner);
  if (includeManagers || !owner) {
    const teamId = lead.routingQueue?.teamId ?? lead.queue?.teamId ?? null;
    const managers = await transaction.teamMember.findMany({
      where: {
        workspaceId,
        ...(teamId ? { teamId } : {}),
        function: "MANAGER",
        deletedAt: null,
        member: {
          status: "ACTIVE",
          deletedAt: null,
          user: { status: "ACTIVE", deletedAt: null },
        },
      },
      distinct: ["workspaceMemberId"],
      select: { workspaceMemberId: true },
    });
    for (const manager of managers) values.add(manager.workspaceMemberId);
  }
  return [...values];
}

async function notify(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
  input: Readonly<{
    leadId: string;
    opportunityId?: string;
    recipientIds: readonly string[];
    type?: "MEETING_REMINDER" | "AUTOMATION_RESULT" | "SYSTEM";
    title: string;
    body: string;
  }>,
) {
  const ids: string[] = [];
  for (const recipientMemberId of input.recipientIds) {
    const row = await transaction.notification.create({
      data: {
        workspaceId: execution.workspaceId,
        recipientMemberId,
        leadId: input.leadId,
        ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
        automationRunId: execution.automationRunId,
        type: input.type ?? "AUTOMATION_RESULT",
        title: input.title,
        body: input.body,
        createdByActorId: execution.actorId,
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

async function appendFact(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
  lead: LeadRecord,
  input: Readonly<{
    subject: string;
    description: string;
    values: PrismaTypes.InputJsonValue;
    auditAction: string;
    opportunityId?: string;
    meetingId?: string;
  }>,
) {
  const activity = await transaction.activity.create({
    data: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
      ...(input.meetingId ? { meetingId: input.meetingId } : {}),
      automationRunId: execution.automationRunId,
      type: "AUTOMATION",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: input.subject,
      description: input.description,
      occurredAt: execution.now,
      nextActionAt: lead.nextActionAt,
      nextActionDescription: lead.nextActionDescription,
      newValues: input.values,
      createdByActorId: execution.actorId,
      updatedByActorId: execution.actorId,
      createdAt: execution.now,
      updatedAt: execution.now,
    },
    select: { id: true },
  });
  await transaction.auditLog.create({
    data: {
      workspaceId: execution.workspaceId,
      actorId: execution.actorId,
      automationRunId: execution.automationRunId,
      action: input.auditAction,
      origin: "AUTOMATION",
      entityType: input.opportunityId ? "Opportunity" : input.meetingId ? "Meeting" : "Lead",
      entityId: input.opportunityId ?? input.meetingId ?? lead.id,
      occurredAt: execution.now,
      changes: input.values,
      metadata: {
        automationRuleId: execution.automationRuleId,
        automationRunId: execution.automationRunId,
        ruleVersion: execution.ruleVersion,
        activityId: activity.id,
      },
    },
  });
  return activity.id;
}

async function simulatedMessage(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
  lead: LeadRecord,
  body: string,
) {
  const privacy = await evaluatePrivacyInTransaction(transaction, {
    workspaceId: execution.workspaceId,
    actorId: execution.actorId,
    leadId: lead.id,
    channel: "WHATSAPP",
    intendedAction: "AUTOMATION_SIMULATED_MESSAGE",
    persist: false,
  });
  if (privacy.outcome === "DENY") return null;
  let conversation = await transaction.conversation.findFirst({
    where: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      channel: "INTERNAL",
      deletedAt: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  conversation ??= await transaction.conversation.create({
    data: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      assigneeMemberId: lead.ownerMemberId,
      queueId: lead.queueId,
      channel: "INTERNAL",
      status: "OPEN",
      createdByActorId: execution.actorId,
      updatedByActorId: execution.actorId,
    },
    select: { id: true },
  });
  const message = await transaction.message.create({
    data: {
      workspaceId: execution.workspaceId,
      conversationId: conversation.id,
      senderActorId: execution.actorId,
      automationRunId: execution.automationRunId,
      direction: "OUTBOUND",
      status: "SENT",
      body: `SIMULAÇÃO LOCAL — ${body}`,
      isSimulated: true,
      simulationLabel: "Mensagem simulada; nenhum canal externo foi acionado.",
      sentAt: execution.now,
    },
    select: { id: true },
  });
  await transaction.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: execution.now, updatedByActorId: execution.actorId },
  });
  return message.id;
}

async function projectNextTask(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
  leadId: string,
) {
  const next = await transaction.task.findFirst({
    where: {
      workspaceId: execution.workspaceId,
      leadId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, dueAt: true },
  });
  await transaction.lead.update({
    where: { id: leadId },
    data: {
      nextActionTaskId: next?.id ?? null,
      nextActionAt: next?.dueAt ?? null,
      nextActionDescription: next?.title ?? null,
      updatedByActorId: execution.actorId,
    },
  });
  return next;
}

async function handleNoAnswer(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (
    payload.eventType !== "NO_ANSWER_CADENCE" ||
    payload.attemptNumber === undefined ||
    payload.dayOffset === undefined ||
    !payload.scheduledFor
  ) {
    invalidAction("A cadência exige tentativa, dia e data de execução.");
  }
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  if (lead.contactPreference === "DO_NOT_CONTACT") {
    const cancelled = await cancelOutreachCadencesInTransaction(transaction, {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      occurredAt: execution.now,
      actorId: execution.actorId,
      reasonCode: "CONTACT_BLOCKED",
      reason: "Cadência encerrada porque o lead está marcado como não contatar.",
      excludeAutomationRunId: execution.automationRunId,
    });
    return { leadId: lead.id, skipped: true, reason: "CONTACT_BLOCKED", cancelled };
  }
  if (!(["OPEN", "QUALIFIED"] as const).includes(lead.status as "OPEN" | "QUALIFIED")) {
    return { leadId: lead.id, skipped: true, reason: "LEAD_CLOSED" };
  }
  if (payload.stopOnReply !== false && lead.lastInboundResponseAt && lead.lastInboundResponseAt >= (payload.cadenceStartedAt ?? payload.scheduledFor ?? execution.now)) {
    return { leadId: lead.id, skipped: true, reason: "LEAD_REPLIED" };
  }
  if (payload.stopOnStageChange && payload.initialStageId && lead.currentStageId !== payload.initialStageId) {
    return { leadId: lead.id, skipped: true, reason: "LEAD_STAGE_CHANGED" };
  }
  if (payload.stopOnMeetingScheduled && await transaction.meeting.count({ where: { workspaceId: execution.workspaceId, leadId: lead.id, status: { in: ["SCHEDULED", "CONFIRMED"] }, deletedAt: null } })) {
    return { leadId: lead.id, skipped: true, reason: "MEETING_SCHEDULED" };
  }

  const timeZone = payload.timeZone ?? lead.workspace.timeZone;
  const cadenceAction = payload.cadenceAction ?? "CALL";
  const configuredMessage = payload.cadenceMessage?.replaceAll("{nome}", lead.fullName).trim() || null;
  const taskSpec = ({
    WHATSAPP: { kind: "MESSAGE", title: "enviar WhatsApp", description: "Envie uma mensagem contextual e registre o resultado." },
    CALL: { kind: "CALL", title: "fazer ligação", description: "Faça a ligação e registre o resultado do contato." },
    EMAIL: { kind: "EMAIL", title: "enviar e-mail", description: "Envie o e-mail e registre o resultado." },
    RECYCLE: { kind: "FOLLOW_UP", title: "revisar e reciclar lead", description: "Revise o histórico e confirme se o lead deve voltar para nutrição ou outra fila." },
    CLOSE: { kind: "FOLLOW_UP", title: "revisar encerramento", description: "Revise o histórico e confirme o encerramento da cadência." },
  } as const)[cadenceAction];
  const range = workspaceDayRange(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(payload.scheduledFor),
    timeZone,
  );
  let task = await transaction.task.findFirst({
    where: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      automationRunId: execution.automationRunId,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
      dueAt: { gte: range.start, lt: range.end },
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    select: { id: true, dueAt: true },
  });
  let taskCreated = false;
  if (!task) {
    task = await transaction.task.create({
      data: {
        workspaceId: execution.workspaceId,
        leadId: lead.id,
        automationRunId: execution.automationRunId,
        assigneeMemberId: payload.assigneeMemberId ?? lead.ownerMemberId,
        queueId: payload.assigneeMemberId || lead.ownerMemberId ? null : lead.queueId,
        title: `Cadência D${payload.dayOffset}: ${taskSpec.title}`,
        description: `${configuredMessage ?? taskSpec.description} Etapa ${payload.attemptNumber} da revisão ${payload.settingsRevision ?? "vigente"}.`,
        kind: taskSpec.kind,
        status: "OPEN",
        priority: lead.priority,
        dueAt: payload.scheduledFor,
        createdByActorId: execution.actorId,
        updatedByActorId: execution.actorId,
        createdAt: execution.now,
        updatedAt: execution.now,
      },
      select: { id: true, dueAt: true },
    });
    taskCreated = true;
  }
  const messageId = cadenceAction === "WHATSAPP" ? await simulatedMessage(
    transaction,
    execution,
    lead,
    configuredMessage ?? `WhatsApp D${payload.dayOffset} sugerido: retomar o contato com contexto e confirmar a próxima ação.`,
  ) : null;
  const transition = payload.targetStageId && payload.targetStageId !== lead.currentStageId
    ? await transitionLeadStageInTransaction(transaction, { workspaceId: execution.workspaceId, actorId: execution.actorId }, {
        leadId: lead.id,
        targetStageId: payload.targetStageId,
        reason: `Movido pela cadência ${payload.cadenceTemplateKey ?? "configurada"}, etapa ${payload.attemptNumber}.`,
        origin: "AUTOMATION",
        managerCorrection: false,
        confirmed: true,
      }, execution.now)
    : null;
  await projectNextTask(transaction, execution, lead.id);
  const refreshed = await getLead(transaction, execution.workspaceId, lead.id);
  const activityId = await appendFact(transaction, execution, refreshed, {
    subject: `Automação: cadência D${payload.dayOffset}`,
    description: cadenceAction === "WHATSAPP"
      ? "Tarefa persistida e mensagem exclusivamente simulada; nenhum canal externo foi acionado."
      : "Atividade da cadência criada para execução pelo responsável do lead.",
    values: {
      attemptNumber: payload.attemptNumber,
      dayOffset: payload.dayOffset,
      cadenceAction,
      scheduledFor: payload.scheduledFor.toISOString(),
      taskId: task.id,
      taskCreated,
      simulatedMessageId: messageId,
      simulatedOnly: true,
      cadenceTemplateKey: payload.cadenceTemplateKey ?? "CUSTOM",
      targetStageId: payload.targetStageId ?? null,
      transition,
    },
    auditAction: "automation.cadence.step_completed",
  });
  return { leadId: lead.id, taskId: task.id, taskCreated, cadenceAction, messageId, activityId, transition };
}

async function handleQualified(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (payload.eventType !== "LEAD_QUALIFIED") invalidAction("Evento de qualificação inválido.");
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  const revision = await transaction.pactoRevision.findFirst({
    where: { workspaceId: execution.workspaceId, leadId: lead.id, kind: "VALIDATED" },
    orderBy: [{ revisionNumber: "desc" }, { id: "desc" }],
    include: { dimensions: { orderBy: { dimension: "asc" } } },
  });
  const nextTask = await transaction.task.findFirst({
    where: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
  });
  if (!revision?.isQualificationReady) invalidAction("PACTO validado e completo é obrigatório.", "PACTO_REQUIRED");
  if (!lead.ownerMemberId && !lead.queueId) invalidAction("Lead qualificado sem responsável operacional.", "RESPONSIBLE_REQUIRED");
  if (!nextTask) invalidAction("Lead qualificado sem próxima ação.", "NEXT_ACTION_REQUIRED");

  const facts = revision.dimensions.map((dimension) => ({
    dimension: dimension.dimension,
    status: dimension.status,
    evidence: dimension.evidence,
  }));
  const briefing = {
    context: [lead.fullName, lead.jobTitle, lead.organizationName].filter(Boolean).join(" · "),
    interest: lead.interestSummary ?? "Interesse ainda não registrado.",
    pactoEvidence: facts,
    nextAction: { taskId: nextTask.id, title: nextTask.title, dueAt: nextTask.dueAt.toISOString() },
  };
  const notificationIds = await notify(transaction, execution, {
    leadId: lead.id,
    recipientIds: await recipients(transaction, execution.workspaceId, lead, true),
    title: "Lead qualificado: preparar agenda",
    body: "PACTO validado. Revise o briefing persistido e escolha um horário disponível para o closer.",
  });
  const activityId = await appendFact(transaction, execution, lead, {
    subject: "Automação: briefing do qualificado preparado",
    description: "Sugestão determinística de agenda e briefing criada a partir de fatos persistidos.",
    values: { qualificationRevisionId: revision.id, notificationIds, briefing, agendaSuggested: true },
    auditAction: "automation.qualified.briefing_prepared",
  });
  return { leadId: lead.id, revisionId: revision.id, notificationIds, activityId, briefing };
}

async function handleMeetingReminder(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (
    payload.eventType !== "MEETING_REMINDER" ||
    !payload.meetingId ||
    !payload.meetingRevision ||
    !payload.reminderMinutes ||
    !payload.expectedStartsAt
  ) invalidAction("Evento de lembrete de reunião incompleto.");
  const meeting = await transaction.meeting.findFirst({
    where: { id: payload.meetingId, workspaceId: execution.workspaceId, deletedAt: null },
    select: { id: true, leadId: true, ownerMemberId: true, title: true, status: true, revision: true, startsAt: true },
  });
  if (!meeting) invalidAction("Reunião não encontrada.", "MEETING_NOT_FOUND");
  if (
    meeting.revision !== payload.meetingRevision ||
    meeting.startsAt.getTime() !== payload.expectedStartsAt.getTime() ||
    !(["SCHEDULED", "CONFIRMED"] as const).includes(meeting.status as "SCHEDULED" | "CONFIRMED")
  ) return { meetingId: meeting.id, skipped: true, reason: "MEETING_REVISION_OR_STATUS_CHANGED" };
  const lead = await getLead(transaction, execution.workspaceId, meeting.leadId);
  const label = payload.reminderMinutes === 1_440 ? "24 horas" : payload.reminderMinutes === 120 ? "2 horas" : "15 minutos";
  const notificationIds = await notify(transaction, execution, {
    leadId: lead.id,
    recipientIds: [meeting.ownerMemberId],
    type: "MEETING_REMINDER",
    title: `Reunião em ${label}`,
    body: `${meeting.title}. Revise o briefing antes do horário agendado.`,
  });
  const messageId = await simulatedMessage(
    transaction,
    execution,
    lead,
    `Lembrete de reunião em ${label}. Confirme o horário combinado.`,
  );
  const activityId = await appendFact(transaction, execution, lead, {
    subject: `Automação: lembrete de reunião (${label})`,
    description: messageId ? "Lembrete interno e mensagem simulada registrados." : "Lembrete interno registrado; mensagem suprimida por não contatar.",
    values: { meetingId: meeting.id, meetingRevision: meeting.revision, reminderMinutes: payload.reminderMinutes, notificationIds, simulatedMessageId: messageId },
    auditAction: "automation.meeting.reminder_completed",
    meetingId: meeting.id,
  });
  return { meetingId: meeting.id, notificationIds, messageId, activityId };
}

async function handleNoShow(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (payload.eventType !== "MEETING_NO_SHOW" || !payload.meetingId || !payload.meetingRevision) {
    invalidAction("Evento de no-show incompleto.");
  }
  const meeting = await transaction.meeting.findFirst({
    where: { id: payload.meetingId, workspaceId: execution.workspaceId, deletedAt: null },
    select: { id: true, leadId: true, ownerMemberId: true, status: true, revision: true },
  });
  if (!meeting) invalidAction("Reunião não encontrada.", "MEETING_NOT_FOUND");
  if (meeting.status !== "NO_SHOW" || meeting.revision !== payload.meetingRevision) {
    return { meetingId: meeting.id, skipped: true, reason: "MEETING_STATUS_CHANGED" };
  }
  const lead = await getLead(transaction, execution.workspaceId, meeting.leadId);
  const recovery = payload.recoveryTaskId
    ? await transaction.task.findFirst({ where: { id: payload.recoveryTaskId, workspaceId: execution.workspaceId, leadId: lead.id, status: { in: ["OPEN", "IN_PROGRESS"] } } })
    : await transaction.task.findFirst({ where: { workspaceId: execution.workspaceId, leadId: lead.id, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null }, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
  if (!recovery) invalidAction("No-show sem tarefa de recuperação persistida.", "RECOVERY_TASK_REQUIRED");
  const notificationIds = await notify(transaction, execution, {
    leadId: lead.id,
    recipientIds: [...new Set([meeting.ownerMemberId, ...(await recipients(transaction, execution.workspaceId, lead))])],
    title: "Recuperar no-show",
    body: `Tarefa “${recovery.title}” ativa. Sugira uma remarcação sem alterar o compromisso silenciosamente.`,
  });
  const messageId = await simulatedMessage(
    transaction,
    execution,
    lead,
    "Percebemos que não conseguimos nos encontrar. Quer escolher um novo horário?",
  );
  const activityId = await appendFact(transaction, execution, lead, {
    subject: "Automação: recuperação de no-show preparada",
    description: messageId ? "Tarefa confirmada e mensagem de remarcação apenas simulada." : "Tarefa confirmada; mensagem suprimida por não contatar.",
    values: { meetingId: meeting.id, recoveryTaskId: recovery.id, notificationIds, simulatedMessageId: messageId, rescheduleSuggested: true },
    auditAction: "automation.meeting.no_show_recovery_prepared",
    meetingId: meeting.id,
  });
  return { meetingId: meeting.id, recoveryTaskId: recovery.id, notificationIds, messageId, activityId };
}

async function handleStagnant(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (payload.eventType !== "LEAD_STAGNANT" || !payload.stageHistoryId || !payload.thresholdDays) {
    invalidAction("Evento de lead parado incompleto.");
  }
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  const history = await transaction.stageHistory.findFirst({
    where: { id: payload.stageHistoryId, workspaceId: execution.workspaceId, leadId: lead.id, exitedAt: null },
    select: { id: true, enteredAt: true, stage: { select: { name: true } } },
  });
  const cut = new Date(execution.now.getTime() - payload.thresholdDays * 86_400_000);
  if (!history || history.enteredAt > cut) return { leadId: lead.id, skipped: true, reason: "NO_LONGER_STAGNANT" };
  const notificationIds = await notify(transaction, execution, {
    leadId: lead.id,
    recipientIds: await recipients(transaction, execution.workspaceId, lead, true),
    title: "Lead parado",
    body: `${lead.fullName} permanece em ${history.stage.name} além de ${payload.thresholdDays} dias. Revise a próxima ação e o responsável.`,
  });
  const activityId = await appendFact(transaction, execution, lead, {
    subject: "Automação: lead parado detectado",
    description: "Detecção determinística baseada no intervalo aberto de StageHistory.",
    values: { stageHistoryId: history.id, enteredAt: history.enteredAt.toISOString(), thresholdDays: payload.thresholdDays, notificationIds, recommendation: "Revisar responsável, próxima ação e motivo da estagnação." },
    auditAction: "automation.process_health.stagnant_detected",
  });
  return { leadId: lead.id, notificationIds, activityId };
}

async function handleNoNextAction(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (payload.eventType !== "LEAD_WITHOUT_NEXT_ACTION") invalidAction("Evento sem próxima ação inválido.");
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  const activeTask = await transaction.task.findFirst({
    where: { workspaceId: execution.workspaceId, leadId: lead.id, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
    select: { id: true },
  });
  if (activeTask) return { leadId: lead.id, skipped: true, reason: "NEXT_ACTION_RESTORED" };
  const notificationIds = await notify(transaction, execution, {
    leadId: lead.id,
    recipientIds: await recipients(transaction, execution.workspaceId, lead, true),
    type: "SYSTEM",
    title: "Erro operacional: sem próxima ação",
    body: `${lead.fullName} está aberto sem tarefa ativa. Crie uma próxima ação pelo fluxo do lead.`,
  });
  const activityId = await appendFact(transaction, execution, lead, {
    subject: "Automação: erro sem próxima ação",
    description: "O fato foi registrado sem inventar tarefa ou corrigir o processo silenciosamente.",
    values: { notificationIds, operationalError: "LEAD_WITHOUT_NEXT_ACTION", correctionRequiresHuman: true },
    auditAction: "automation.process_health.no_next_action_detected",
  });
  return { leadId: lead.id, notificationIds, activityId };
}

async function handleOpportunityClosed(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (payload.eventType !== "OPPORTUNITY_CLOSED" || !payload.opportunityId || !payload.status) {
    invalidAction("Evento de encerramento de oportunidade incompleto.");
  }
  const opportunity = await transaction.opportunity.findFirst({
    where: { id: payload.opportunityId, workspaceId: execution.workspaceId, leadId: payload.leadId, deletedAt: null },
    select: { id: true, leadId: true, ownerMemberId: true, status: true, lossReasonId: true, name: true },
  });
  if (!opportunity) invalidAction("Oportunidade não encontrada.", "OPPORTUNITY_NOT_FOUND");
  if (opportunity.status !== payload.status) return { opportunityId: opportunity.id, skipped: true, reason: "OPPORTUNITY_STATUS_CHANGED" };
  if (opportunity.status === "LOST" && !opportunity.lossReasonId) invalidAction("Perda sem motivo persistido.", "LOSS_REASON_REQUIRED");
  const lead = await getLead(transaction, execution.workspaceId, opportunity.leadId);
  const cancelledCadences = await cancelOutreachCadencesInTransaction(transaction, {
    workspaceId: execution.workspaceId,
    leadId: lead.id,
    occurredAt: execution.now,
    actorId: execution.actorId,
    reasonCode: "OPPORTUNITY_CLOSED",
    reason: `Cadência encerrada após oportunidade ${opportunity.status === "WON" ? "ganha" : "perdida"}.`,
  });
  const cadenceTasks = await transaction.task.findMany({
    where: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
      automationRun: { actionConfigSnapshot: { path: ["category"], equals: "OUTREACH_CADENCE" } },
    },
    select: { id: true },
  });
  if (cadenceTasks.length > 0) {
    await transaction.task.updateMany({
      where: { id: { in: cadenceTasks.map(({ id }) => id) }, workspaceId: execution.workspaceId },
      data: { status: "CANCELLED", result: "Encerrada pela decisão da oportunidade.", updatedByActorId: execution.actorId, updatedAt: execution.now },
    });
    await projectNextTask(transaction, execution, lead.id);
  }

  let handoffId: string | null = null;
  if (opportunity.status === "WON") {
    const queue = await transaction.queue.findFirst({
      where: { workspaceId: execution.workspaceId, isGeneral: true, deletedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const handoff = await transaction.customerHandoff.create({
      data: {
        workspaceId: execution.workspaceId,
        leadId: lead.id,
        opportunityId: opportunity.id,
        automationRunId: execution.automationRunId,
        fromMemberId: opportunity.ownerMemberId,
        toQueueId: queue?.id ?? null,
        status: "REQUESTED",
        reason: "Preparação futura de onboarding; nenhum onboarding foi executado.",
        requestedAt: execution.now,
        createdByActorId: execution.actorId,
        createdAt: execution.now,
      },
      select: { id: true },
    });
    handoffId = handoff.id;
  }
  const notificationIds = await notify(transaction, execution, {
    leadId: lead.id,
    opportunityId: opportunity.id,
    recipientIds: [...new Set([opportunity.ownerMemberId, ...(await recipients(transaction, execution.workspaceId, lead, true))])],
    title: opportunity.status === "WON" ? "Ganho: handoff futuro preparado" : "Perda: nutrição futura sinalizada",
    body: opportunity.status === "WON"
      ? "O handoff foi criado como preparação local; onboarding não foi iniciado."
      : "Cadências incompatíveis foram encerradas. Uma estratégia futura de nutrição exige decisão humana.",
  });
  const refreshed = await getLead(transaction, execution.workspaceId, lead.id);
  const activityId = await appendFact(transaction, execution, refreshed, {
    subject: opportunity.status === "WON" ? "Automação: handoff futuro preparado" : "Automação: nutrição futura sinalizada",
    description: opportunity.status === "WON" ? "Preparação simples, sem onboarding automático." : "Sinalização apenas; nenhuma cadência futura foi iniciada.",
    values: { opportunityId: opportunity.id, status: opportunity.status, cancelledCadences, cancelledCadenceTaskIds: cadenceTasks.map(({ id }) => id), handoffId, notificationIds, futurePreparationOnly: true },
    auditAction: "automation.opportunity.closure_completed",
    opportunityId: opportunity.id,
  });
  return { opportunityId: opportunity.id, cancelledCadences, handoffId, notificationIds, activityId };
}

export function createPredefinedLifecycleAutomationActionExecutor(): AutomationActionExecutor {
  return Object.freeze({
    async execute(transaction, execution) {
      if (execution.actionType !== "APPLY_LIFECYCLE_AUTOMATION") {
        invalidAction("Tipo de ação incompatível com as automações de ciclo de vida.");
      }
      const config = actionConfigSchema.safeParse(execution.actionConfig);
      if (!config.success) invalidAction("Configuração da automação de ciclo de vida inválida.");
      switch (config.data.automationKey) {
        case LifecycleAutomationKeys.NO_ANSWER:
          return handleNoAnswer(transaction, execution);
        case LifecycleAutomationKeys.QUALIFIED:
          return handleQualified(transaction, execution);
        case LifecycleAutomationKeys.MEETING_SCHEDULED:
          return handleMeetingReminder(transaction, execution);
        case LifecycleAutomationKeys.NO_SHOW:
          return handleNoShow(transaction, execution);
        case LifecycleAutomationKeys.STAGNANT:
          return handleStagnant(transaction, execution);
        case LifecycleAutomationKeys.NO_NEXT_ACTION:
          return handleNoNextAction(transaction, execution);
        case LifecycleAutomationKeys.OPPORTUNITY_CLOSED:
          return handleOpportunityClosed(transaction, execution);
      }
    },
  });
}
