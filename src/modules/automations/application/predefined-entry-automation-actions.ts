import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import { createAutomationActionRegistry } from "@/modules/automations/application/automation-action-registry";
import { createPredefinedLifecycleAutomationActionExecutor } from "@/modules/automations/application/predefined-lifecycle-automation-actions";
import type {
  AutomationActionExecution,
  AutomationActionExecutor,
} from "@/modules/automations/domain/automation-contracts";
import {
  EntryAutomationKeys,
  type EntryAutomationKey,
} from "@/modules/automations/domain/predefined-entry-automations";
import { evaluatePrivacyInTransaction } from "@/modules/privacy/application/privacy-service";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { z } from "zod";

const entryAutomationKeys = Object.values(EntryAutomationKeys) as [
  EntryAutomationKey,
  ...EntryAutomationKey[],
];

const actionConfigSchema = z
  .object({ automationKey: z.enum(entryAutomationKeys) })
  .passthrough();

const basePayloadSchema = z
  .object({
    leadId: z.string().uuid(),
    submissionId: z.string().uuid().optional(),
    slaCycleId: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    reviewId: z.string().uuid().nullable().optional(),
    outcome: z.enum(["CREATED", "ATTACHED"]).optional(),
    priorityBandCode: z.enum(["P1", "P2", "P3"]).optional(),
    phase: z.enum(["INITIAL", "MANAGER_ESCALATION"]).optional(),
    thresholdSeconds: z.union([z.literal(60), z.literal(180)]).optional(),
    activityId: z.string().uuid().optional(),
  })
  .passthrough();

type LeadRecord = Awaited<ReturnType<typeof getLead>>;

function invalidAction(message: string, code = "INVALID_ENTRY_AUTOMATION_EVENT"): never {
  throw new ApplicationError(message, {
    code,
    statusCode: 409,
    expose: true,
  });
}

function eventPayload(execution: AutomationActionExecution) {
  const nested = execution.eventPayload.payload;
  const parsed = basePayloadSchema.safeParse(nested);
  if (!parsed.success) invalidAction("O evento da automação de entrada é inválido.");
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
      ownerMemberId: true,
      queueId: true,
      routingQueueId: true,
      priority: true,
      contactPreference: true,
      awaitingHumanResponse: true,
      nextActionTaskId: true,
      nextActionAt: true,
      nextActionDescription: true,
      owner: {
        select: {
          status: true,
          deletedAt: true,
          user: { select: { status: true, deletedAt: true } },
        },
      },
      routingQueue: { select: { teamId: true } },
      queue: { select: { teamId: true } },
      currentScore: {
        select: {
          leadScore: {
            select: {
              score: true,
              priorityBandCode: true,
              reason: true,
              modelVersion: true,
            },
          },
        },
      },
    },
  });
  if (!lead) invalidAction("Lead da automação não foi encontrado.", "LEAD_NOT_FOUND");
  return lead;
}

function activeOwnerMemberId(lead: LeadRecord): string | null {
  return lead.ownerMemberId &&
    lead.owner?.status === "ACTIVE" &&
    lead.owner.deletedAt === null &&
    lead.owner.user.status === "ACTIVE" &&
    lead.owner.user.deletedAt === null
    ? lead.ownerMemberId
    : null;
}

async function managerMemberIds(
  transaction: PrismaTypes.TransactionClient,
  workspaceId: string,
  lead: LeadRecord,
): Promise<string[]> {
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
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { workspaceMemberId: true },
  });
  return managers.map(({ workspaceMemberId }) => workspaceMemberId);
}

async function operationalRecipients(
  transaction: PrismaTypes.TransactionClient,
  workspaceId: string,
  lead: LeadRecord,
  includeManagers: boolean,
): Promise<string[]> {
  const ids = new Set<string>();
  const ownerMemberId = activeOwnerMemberId(lead);
  if (ownerMemberId) ids.add(ownerMemberId);
  if (includeManagers || !ownerMemberId) {
    for (const memberId of await managerMemberIds(transaction, workspaceId, lead)) {
      ids.add(memberId);
    }
  }
  return [...ids];
}

async function createNotifications(
  transaction: PrismaTypes.TransactionClient,
  input: Readonly<{
    workspaceId: string;
    actorId: string;
    leadId: string;
    recipientMemberIds: readonly string[];
    type: "SLA_WARNING" | "SLA_BREACH" | "AUTOMATION_RESULT";
    title: string;
    body: string;
  }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const recipientMemberId of input.recipientMemberIds) {
    const notification = await transaction.notification.create({
      data: {
        workspaceId: input.workspaceId,
        recipientMemberId,
        leadId: input.leadId,
        type: input.type,
        title: input.title,
        body: input.body,
        createdByActorId: input.actorId,
      },
      select: { id: true },
    });
    ids.push(notification.id);
  }
  return ids;
}

async function appendAutomationFact(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
  lead: LeadRecord,
  input: Readonly<{
    subject: string;
    description: string;
    newValues: PrismaTypes.InputJsonValue;
    auditAction: string;
  }>,
): Promise<string> {
  const activity = await transaction.activity.create({
    data: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      type: "AUTOMATION",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: input.subject,
      description: input.description,
      occurredAt: execution.now,
      nextActionAt: lead.nextActionAt,
      nextActionDescription: lead.nextActionDescription,
      newValues: input.newValues,
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
      entityType: "Lead",
      entityId: lead.id,
      occurredAt: execution.now,
      changes: input.newValues,
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

async function ensureAlert(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
  lead: LeadRecord,
  type: "P1_PRIORITY" | "SLA_ATTENTION" | "SLA_CRITICAL",
  title: string,
  message: string,
): Promise<string> {
  const queueId = lead.routingQueueId ?? lead.queueId;
  if (!queueId) invalidAction("Lead sem fila operacional para o alerta.");
  const existing = await transaction.operationalAlert.findFirst({
    where: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      type,
      status: "OPEN",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (existing) return existing.id;
  return (
    await transaction.operationalAlert.create({
      data: {
        workspaceId: execution.workspaceId,
        leadId: lead.id,
        queueId,
        type,
        title,
        message,
        createdByActorId: execution.actorId,
      },
      select: { id: true },
    })
  ).id;
}

async function handleLeadReceived(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (
    payload.outcome !== "CREATED" ||
    !payload.submissionId ||
    !payload.slaCycleId ||
    !payload.taskId
  ) {
    invalidAction("A automação Lead recebido exige os artefatos completos da entrada.");
  }
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  const persisted = await transaction.leadFormSubmission.findFirst({
    where: {
      id: payload.submissionId,
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      intakeOutcome: "CREATED",
      slaCycle: { id: payload.slaCycleId, task: { id: payload.taskId } },
    },
    select: { id: true },
  });
  if (!persisted) invalidAction("A entrada não possui submissão, SLA e tarefa consistentes.");

  const recipients = await operationalRecipients(
    transaction,
    execution.workspaceId,
    lead,
    false,
  );
  const notificationIds = await createNotifications(transaction, {
    workspaceId: execution.workspaceId,
    actorId: execution.actorId,
    leadId: lead.id,
    recipientMemberIds: recipients,
    type: "AUTOMATION_RESULT",
    title: "Novo lead para atendimento imediato",
    body: `${lead.fullName} entrou com SLA imediato — 0 minutos.`,
  });

  let simulatedMessageId: string | null = null;
  const privacy = await evaluatePrivacyInTransaction(transaction, {
    workspaceId: execution.workspaceId,
    actorId: execution.actorId,
    leadId: lead.id,
    channel: "WHATSAPP",
    intendedAction: "AUTOMATION_SIMULATED_WELCOME",
    persist: false,
  });
  if (privacy.outcome !== "DENY") {
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
        direction: "OUTBOUND",
        status: "SENT",
        body: "SIMULAÇÃO LOCAL — Recebemos seu contato. O atendimento humano foi sinalizado.",
        isSimulated: true,
        simulationLabel: "Mensagem automática simulada; nenhum canal externo foi acionado.",
        sentAt: execution.now,
      },
      select: { id: true },
    });
    simulatedMessageId = message.id;
    await transaction.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: execution.now,
        updatedByActorId: execution.actorId,
      },
    });
  }

  const activityId = await appendAutomationFact(transaction, execution, lead, {
    subject: "Automação: lead recebido",
    description:
      privacy.outcome === "DENY"
        ? `Entrada confirmada; mensagem simulada suprimida pela decisão de privacidade (${privacy.outcome}).`
        : "Entrada confirmada e mensagem automática apenas simulada no ambiente local.",
    newValues: {
      submissionId: payload.submissionId,
      slaCycleId: payload.slaCycleId,
      taskId: payload.taskId,
      notificationIds,
      simulatedMessageId,
      simulated: true,
      privacyOutcome: privacy.outcome,
      domainArtifactsReused: true,
    },
    auditAction: "automation.lead_received.completed",
  });
  return { leadId: lead.id, notificationIds, simulatedMessageId, activityId };
}

async function handleDuplicate(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (payload.outcome !== "ATTACHED" || !payload.submissionId || !payload.reviewId) {
    invalidAction("A automação Duplicado exige submissão anexada e revisão aberta.");
  }
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  const review = await transaction.leadIdentityReview.findFirst({
    where: {
      id: payload.reviewId,
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      submissionId: payload.submissionId,
      status: "OPEN",
    },
    select: { id: true, divergenceFields: true },
  });
  if (!review) invalidAction("A revisão de identidade da duplicidade não foi encontrada.");

  const ownerMemberId = activeOwnerMemberId(lead);
  const notificationIds = ownerMemberId
    ? await createNotifications(transaction, {
        workspaceId: execution.workspaceId,
        actorId: execution.actorId,
        leadId: lead.id,
        recipientMemberIds: [ownerMemberId],
        type: "AUTOMATION_RESULT",
        title: "Nova conversão duplicada",
        body: "A submissão foi anexada sem mesclagem destrutiva e requer revisão humana.",
      })
    : [];
  const managers = await managerMemberIds(transaction, execution.workspaceId, lead);
  const managersAlreadySignaled = await transaction.notification.count({
    where: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      recipientMemberId: { in: managers },
      title: "Revisão de identidade pendente",
      deletedAt: null,
    },
  });

  const activityId = await appendAutomationFact(transaction, execution, lead, {
    subject: "Automação: duplicidade tratada",
    description:
      "A nova conversão foi preservada como submissão; os campos confiáveis não foram sobrescritos.",
    newValues: {
      submissionId: payload.submissionId,
      reviewId: review.id,
      divergenceFields: review.divergenceFields,
      notificationIds,
      managersAlreadySignaled,
      recalculationDelegatedToIntakePolicy: true,
      automaticMergePerformed: false,
    },
    auditAction: "automation.duplicate.completed",
  });
  return {
    leadId: lead.id,
    reviewId: review.id,
    notificationIds,
    managersAlreadySignaled,
    activityId,
  };
}

async function handleP1(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (payload.priorityBandCode !== "P1" || !payload.slaCycleId || !payload.phase) {
    invalidAction("A automação P1 exige prioridade, fase e ciclo de SLA.");
  }
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  const score = lead.currentScore?.leadScore;
  const reason =
    score?.priorityBandCode === "P1"
      ? score.reason
      : "Prioridade P1 informada na entrada; não há score vigente disponível.";

  if (payload.phase === "MANAGER_ESCALATION") {
    if (lead.contactPreference === "DO_NOT_CONTACT") {
      return {
        leadId: lead.id,
        phase: payload.phase,
        skipped: true,
        reason: "CONTACT_BLOCKED",
      };
    }
    const cycle = await transaction.leadSlaCycle.findFirst({
      where: {
        id: payload.slaCycleId,
        workspaceId: execution.workspaceId,
        leadId: lead.id,
      },
      select: { firstHumanAttemptAt: true },
    });
    if (!cycle) invalidAction("Ciclo de SLA do P1 não encontrado.");
    if (cycle.firstHumanAttemptAt) {
      return {
        leadId: lead.id,
        phase: payload.phase,
        skipped: true,
        reason: "HUMAN_ATTEMPT_ALREADY_RECORDED",
      };
    }
    const notificationIds = await createNotifications(transaction, {
      workspaceId: execution.workspaceId,
      actorId: execution.actorId,
      leadId: lead.id,
      recipientMemberIds: await managerMemberIds(
        transaction,
        execution.workspaceId,
        lead,
      ),
      type: "SLA_WARNING",
      title: "P1 ainda sem tentativa humana",
      body: `${lead.fullName} permanece sem tentativa após 60 segundos. Motivo P1: ${reason}`,
    });
    const activityId = await appendAutomationFact(transaction, execution, lead, {
      subject: "Automação: P1 escalado ao gestor",
      description: reason,
      newValues: {
        phase: payload.phase,
        notificationIds,
        reason,
        firstHumanAttemptAt: null,
      },
      auditAction: "automation.p1.manager_escalated",
    });
    return { leadId: lead.id, phase: payload.phase, notificationIds, activityId };
  }

  const alertId = await ensureAlert(
    transaction,
    execution,
    lead,
    "P1_PRIORITY",
    "Lead P1 exige ação imediata",
    reason,
  );
  const notificationIds = await createNotifications(transaction, {
    workspaceId: execution.workspaceId,
    actorId: execution.actorId,
    leadId: lead.id,
    recipientMemberIds: await operationalRecipients(
      transaction,
      execution.workspaceId,
      lead,
      false,
    ),
    type: "AUTOMATION_RESULT",
    title: "Lead P1 priorizado",
    body: reason,
  });
  const activityId = await appendAutomationFact(transaction, execution, lead, {
    subject: "Automação: prioridade P1 destacada",
    description: reason,
    newValues: {
      phase: payload.phase,
      alertId,
      notificationIds,
      score: score?.score ?? null,
      scoreVersion: score?.modelVersion ?? null,
      reason,
    },
    auditAction: "automation.p1.highlighted",
  });
  return { leadId: lead.id, phase: payload.phase, alertId, notificationIds, activityId };
}

async function handleSlaLate(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (!payload.slaCycleId || !payload.thresholdSeconds) {
    invalidAction("A automação de SLA exige ciclo e faixa de tempo.");
  }
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  if (lead.contactPreference === "DO_NOT_CONTACT") {
    return {
      leadId: lead.id,
      thresholdSeconds: payload.thresholdSeconds,
      skipped: true,
      reason: "CONTACT_BLOCKED",
    };
  }
  const cycle = await transaction.leadSlaCycle.findFirst({
    where: {
      id: payload.slaCycleId,
      workspaceId: execution.workspaceId,
      leadId: lead.id,
    },
    select: { receivedAt: true, firstHumanAttemptAt: true },
  });
  if (!cycle) invalidAction("Ciclo do SLA não encontrado.");
  if (cycle.firstHumanAttemptAt) {
    return {
      leadId: lead.id,
      thresholdSeconds: payload.thresholdSeconds,
      skipped: true,
      reason: "HUMAN_ATTEMPT_ALREADY_RECORDED",
    };
  }
  const elapsedSeconds = Math.floor(
    (execution.now.getTime() - cycle.receivedAt.getTime()) / 1_000,
  );
  if (elapsedSeconds <= payload.thresholdSeconds) {
    invalidAction("A checagem do SLA foi executada antes da faixa configurada.", "SLA_CHECK_TOO_EARLY");
  }

  const critical = payload.thresholdSeconds === 180;
  const alertId = await ensureAlert(
    transaction,
    execution,
    lead,
    critical ? "SLA_CRITICAL" : "SLA_ATTENTION",
    critical ? "SLA crítico" : "SLA em atenção",
    critical
      ? "Sem tentativa humana após 180 segundos; redistribuição autorizada está disponível ao gestor."
      : "Sem tentativa humana após 60 segundos; o SLA imediato segue vencido desde a entrada.",
  );
  const notificationIds = await createNotifications(transaction, {
    workspaceId: execution.workspaceId,
    actorId: execution.actorId,
    leadId: lead.id,
    recipientMemberIds: await operationalRecipients(
      transaction,
      execution.workspaceId,
      lead,
      critical,
    ),
    type: critical ? "SLA_BREACH" : "SLA_WARNING",
    title: critical
      ? "SLA crítico: acima de 180 segundos"
      : "SLA em atenção: acima de 60 segundos",
    body: critical
      ? "A política continua SLA imediato — 0 minutos. O gestor pode redistribuir pelo fluxo autorizado."
      : "A política continua SLA imediato — 0 minutos; registre a tentativa humana.",
  });
  const activityId = await appendAutomationFact(transaction, execution, lead, {
    subject: critical ? "Automação: SLA crítico" : "Automação: SLA em atenção",
    description: `Sem tentativa humana aos ${elapsedSeconds} segundos; SLA devido desde a entrada.`,
    newValues: {
      slaCycleId: payload.slaCycleId,
      thresholdSeconds: payload.thresholdSeconds,
      elapsedSeconds,
      alertId,
      notificationIds,
      slaPolicyMinutes: 0,
      redistributionAvailableToAuthorizedManager: critical,
    },
    auditAction: critical
      ? "automation.sla.critical_recorded"
      : "automation.sla.attention_recorded",
  });
  return {
    leadId: lead.id,
    thresholdSeconds: payload.thresholdSeconds,
    elapsedSeconds,
    alertId,
    notificationIds,
    activityId,
  };
}

async function cancelIncompatibleCadences(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
  leadId: string,
): Promise<number> {
  const runs = await transaction.automationRun.findMany({
    where: {
      workspaceId: execution.workspaceId,
      leadId,
      status: { in: ["PENDING", "RUNNING"] },
      actionConfigSnapshot: {
        path: ["category"],
        equals: "OUTREACH_CADENCE",
      },
    },
    select: { id: true, status: true, job: { select: { id: true, status: true } } },
  });
  let affected = 0;
  for (const run of runs) {
    if (!run.job) continue;
    if (run.job.status === "RUNNING") {
      await transaction.job.update({
        where: { id: run.job.id },
        data: {
          cancelRequestedAt: execution.now,
          updatedByActorId: execution.actorId,
        },
      });
      affected += 1;
      continue;
    }
    if (run.job.status !== "PENDING") continue;
    await transaction.job.update({
      where: { id: run.job.id },
      data: {
        status: "CANCELLED",
        cancelRequestedAt: execution.now,
        cancelledAt: execution.now,
        finishedAt: execution.now,
        updatedByActorId: execution.actorId,
      },
    });
    await transaction.automationRun.update({
      where: { id: run.id },
      data: {
        status: "CANCELLED",
        cancelledAt: execution.now,
        finishedAt: execution.now,
        errorCode: "LEAD_REPLIED",
        errorMessage: "Cadência suspensa porque o lead respondeu.",
      },
    });
    affected += 1;
  }
  return affected;
}

async function ensureReplyTask(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
  lead: LeadRecord,
): Promise<Readonly<{ taskId: string | null; created: boolean }>> {
  if (lead.contactPreference === "DO_NOT_CONTACT") {
    return { taskId: null, created: false };
  }
  const existing = await transaction.task.findFirst({
    where: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      kind: "IMMEDIATE_CALL",
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (existing) {
    await transaction.task.update({
      where: { id: existing.id },
      data: {
        assigneeMemberId: lead.ownerMemberId,
        queueId: lead.queueId,
        dueAt: execution.now,
        status: "OPEN",
        updatedByActorId: execution.actorId,
      },
    });
    return { taskId: existing.id, created: false };
  }
  const task = await transaction.task.create({
    data: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      assigneeMemberId: lead.ownerMemberId,
      queueId: lead.queueId,
      title: "Ligar agora",
      description: "Resposta recebida; retorno humano imediato solicitado pela automação.",
      kind: "IMMEDIATE_CALL",
      status: "OPEN",
      priority: lead.priority,
      dueAt: execution.now,
      createdByActorId: execution.actorId,
      updatedByActorId: execution.actorId,
    },
    select: { id: true },
  });
  await transaction.activity.create({
    data: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      type: "TASK",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: "Tarefa criada: Ligar agora",
      occurredAt: execution.now,
      nextActionAt: execution.now,
      nextActionDescription: "Ligar agora",
      newValues: {
        taskId: task.id,
        kind: "IMMEDIATE_CALL",
        status: "OPEN",
        dueAt: execution.now.toISOString(),
        automationRunId: execution.automationRunId,
      },
      createdByActorId: execution.actorId,
      updatedByActorId: execution.actorId,
      createdAt: execution.now,
      updatedAt: execution.now,
    },
  });
  return { taskId: task.id, created: true };
}

async function handleLeadReplied(
  transaction: PrismaTypes.TransactionClient,
  execution: AutomationActionExecution,
) {
  const payload = eventPayload(execution);
  if (!payload.activityId) invalidAction("A automação Lead respondeu exige a atividade recebida.");
  const lead = await getLead(transaction, execution.workspaceId, payload.leadId);
  const activity = await transaction.activity.findFirst({
    where: {
      id: payload.activityId,
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      type: "MESSAGE_RECEIVED",
      direction: "INBOUND",
    },
    select: { id: true },
  });
  if (!activity || !lead.awaitingHumanResponse) {
    invalidAction("A resposta recebida não está consistente com o estado operacional do lead.");
  }

  const task = await ensureReplyTask(transaction, execution, lead);
  const cancelledCadences = await cancelIncompatibleCadences(
    transaction,
    execution,
    lead.id,
  );
  const nextTask = await transaction.task.findFirst({
    where: {
      workspaceId: execution.workspaceId,
      leadId: lead.id,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      deletedAt: null,
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, title: true, dueAt: true },
  });
  if (nextTask) {
    await transaction.lead.update({
      where: { id: lead.id },
      data: {
        nextActionTaskId: nextTask.id,
        nextActionAt: nextTask.dueAt,
        nextActionDescription: nextTask.title,
        updatedByActorId: execution.actorId,
      },
    });
  }
  const notificationIds = await createNotifications(transaction, {
    workspaceId: execution.workspaceId,
    actorId: execution.actorId,
    leadId: lead.id,
    recipientMemberIds: await operationalRecipients(
      transaction,
      execution.workspaceId,
      lead,
      false,
    ),
    type: "AUTOMATION_RESULT",
    title: "Lead respondeu",
    body:
      lead.contactPreference === "DO_NOT_CONTACT"
        ? "Resposta recebida; a restrição de contato foi preservada e exige revisão humana."
        : "Resposta no topo da fila; a tarefa Ligar agora está vencendo neste instante.",
  });
  const refreshedLead = await getLead(transaction, execution.workspaceId, lead.id);
  const activityId = await appendAutomationFact(transaction, execution, refreshedLead, {
    subject: "Automação: lead respondeu",
    description:
      lead.contactPreference === "DO_NOT_CONTACT"
        ? "Resposta priorizada sem criar contato incompatível com o opt-out."
        : "Resposta priorizada e retorno humano imediato garantido.",
    newValues: {
      sourceActivityId: payload.activityId,
      taskId: task.taskId,
      taskCreated: task.created,
      cancelledCadences,
      notificationIds,
      awaitingHumanResponse: true,
      optOutPreserved: lead.contactPreference === "DO_NOT_CONTACT",
    },
    auditAction: "automation.lead_replied.completed",
  });
  return {
    leadId: lead.id,
    taskId: task.taskId,
    taskCreated: task.created,
    cancelledCadences,
    notificationIds,
    activityId,
  };
}

export function createPredefinedEntryAutomationActionExecutor(): AutomationActionExecutor {
  return Object.freeze({
    async execute(transaction, execution) {
      if (execution.actionType !== "APPLY_ENTRY_AUTOMATION") {
        invalidAction("Tipo de ação incompatível com as automações de entrada.");
      }
      const config = actionConfigSchema.safeParse(execution.actionConfig);
      if (!config.success) invalidAction("Configuração da automação de entrada inválida.");

      switch (config.data.automationKey) {
        case EntryAutomationKeys.LEAD_RECEIVED:
          return handleLeadReceived(transaction, execution);
        case EntryAutomationKeys.DUPLICATE:
          return handleDuplicate(transaction, execution);
        case EntryAutomationKeys.P1:
          return handleP1(transaction, execution);
        case EntryAutomationKeys.SLA_LATE:
          return handleSlaLate(transaction, execution);
        case EntryAutomationKeys.LEAD_REPLIED:
          return handleLeadReplied(transaction, execution);
      }
    },
  });
}

export function createDefaultAutomationActionRegistry(): AutomationActionExecutor {
  const entryExecutor = createPredefinedEntryAutomationActionExecutor();
  const lifecycleExecutor = createPredefinedLifecycleAutomationActionExecutor();
  return createAutomationActionRegistry({
    APPLY_ENTRY_AUTOMATION: (transaction, execution) =>
      entryExecutor.execute(transaction, execution),
    APPLY_LIFECYCLE_AUTOMATION: (transaction, execution) =>
      lifecycleExecutor.execute(transaction, execution),
  });
}
