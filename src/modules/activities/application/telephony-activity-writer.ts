import type { Prisma, TelephonyCallStatus, TelephonyDisposition } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

function callOutcome(status: TelephonyCallStatus) {
  if (status === "ANSWERED" || status === "COMPLETED") return { type: "CALL_CONNECTED" as const, result: "CONNECTED" as const };
  if (status === "BUSY" || status === "NO_ANSWER" || status === "VOICEMAIL") return { type: "CALL_UNANSWERED" as const, result: "NOT_CONNECTED" as const };
  return { type: "CALL" as const, result: status === "CANCELLED" ? "CANCELLED" as const : "OTHER" as const };
}

export async function registerTelephonyFirstAttemptInTransaction(tx: Tx, input: Readonly<{
  workspaceId: string;
  leadId: string;
  actorId: string;
  occurredAt: Date;
}>) {
  const cycles = await tx.leadSlaCycle.findMany({
    where: { workspaceId: input.workspaceId, leadId: input.leadId, receivedAt: { lte: input.occurredAt } },
    orderBy: { receivedAt: "asc" },
    select: { id: true, receivedAt: true, firstHumanAttemptAt: true },
  });
  const changed: string[] = [];
  for (const cycle of cycles) {
    if (cycle.firstHumanAttemptAt) continue;
    await tx.leadSlaCycle.update({
      where: { id: cycle.id },
      data: {
        firstHumanAttemptAt: input.occurredAt,
        firstHumanAttemptSeconds: Math.max(0, Math.floor((input.occurredAt.getTime() - cycle.receivedAt.getTime()) / 1_000)),
      },
    });
    changed.push(cycle.id);
  }
  if (changed.length) {
    await tx.task.updateMany({
      where: { workspaceId: input.workspaceId, slaCycleId: { in: changed }, kind: "IMMEDIATE_CALL", status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null },
      data: { status: "COMPLETED", completedAt: input.occurredAt, result: "Tentativa humana registrada pela telefonia local.", updatedByActorId: input.actorId },
    });
  }
  return { firstHumanAttemptRecorded: changed.length > 0 };
}

export async function registerTelephonyConnectedInTransaction(tx: Tx, input: Readonly<{
  workspaceId: string;
  leadId: string;
  occurredAt: Date;
}>) {
  const cycles = await tx.leadSlaCycle.findMany({
    where: { workspaceId: input.workspaceId, leadId: input.leadId, receivedAt: { lte: input.occurredAt } },
    select: { id: true, receivedAt: true, firstConnectedAt: true },
  });
  let recorded = 0;
  for (const cycle of cycles) {
    if (cycle.firstConnectedAt) continue;
    await tx.leadSlaCycle.update({
      where: { id: cycle.id },
      data: {
        firstConnectedAt: input.occurredAt,
        firstResponseTimeSeconds: Math.max(0, Math.floor((input.occurredAt.getTime() - cycle.receivedAt.getTime()) / 1_000)),
      },
    });
    recorded += 1;
  }
  return { firstConnectedRecorded: recorded > 0 };
}

export async function registerTelephonyOutcomeInTransaction(tx: Tx, input: Readonly<{
  workspaceId: string;
  callId: string;
  leadId: string;
  opportunityId?: string | null;
  messageId: string;
  actorId: string;
  status: TelephonyCallStatus;
  occurredAt: Date;
  durationSeconds?: number | null;
  talkDurationSeconds?: number | null;
}>) {
  if (input.status === "ANSWERED" || input.status === "COMPLETED") {
    await registerTelephonyConnectedInTransaction(tx, input);
  }
  const existing = await tx.activity.findFirst({ where: { workspaceId: input.workspaceId, phoneCallId: input.callId } });
  if (existing) return { activityId: existing.id, idempotent: true };
  const mapped = callOutcome(input.status);
  const activity = await tx.activity.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      opportunityId: input.opportunityId ?? null,
      messageId: input.messageId,
      phoneCallId: input.callId,
      type: mapped.type,
      direction: "OUTBOUND",
      result: mapped.result,
      subject: "Ligação local simulada",
      description: "Fato técnico da telefonia local. Resultado comercial exige disposição humana.",
      occurredAt: input.occurredAt,
      durationSeconds: input.talkDurationSeconds ?? input.durationSeconds ?? null,
      newValues: { callStatus: input.status, simulated: true, externalEgress: false },
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
    },
  });
  await tx.lead.updateMany({
    where: { id: input.leadId, workspaceId: input.workspaceId, deletedAt: null },
    data: { lastActivityAt: input.occurredAt, updatedByActorId: input.actorId },
  });
  return { activityId: activity.id, idempotent: false };
}

export async function recordTelephonyDispositionInTransaction(tx: Tx, input: Readonly<{
  workspaceId: string;
  callId: string;
  leadId: string;
  opportunityId?: string | null;
  actorId: string;
  ownerMemberId?: string | null;
  queueId?: string | null;
  leadPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  disposition: TelephonyDisposition;
  note?: string | null;
  occurredAt: Date;
  nextAction?: Readonly<{ title: string; dueAt: Date }> | null;
}>) {
  let taskId: string | null = null;
  if (input.nextAction) {
    const task = await tx.task.create({
      data: {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        opportunityId: input.opportunityId ?? null,
        assigneeMemberId: input.ownerMemberId ?? null,
        queueId: input.ownerMemberId ? null : input.queueId ?? null,
        title: input.nextAction.title,
        description: `Criada explicitamente após disposição ${input.disposition}.`,
        kind: "FOLLOW_UP",
        status: "OPEN",
        priority: input.leadPriority,
        dueAt: input.nextAction.dueAt,
        createdByActorId: input.actorId,
        updatedByActorId: input.actorId,
      },
    });
    taskId = task.id;
    await tx.lead.update({
      where: { id: input.leadId },
      data: { nextActionTaskId: task.id, nextActionAt: task.dueAt, nextActionDescription: task.title, updatedByActorId: input.actorId },
    });
  }
  const activity = await tx.activity.create({
    data: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      opportunityId: input.opportunityId ?? null,
      type: "NOTE",
      direction: "INTERNAL",
      result: "INFORMATION",
      subject: "Resultado comercial da ligação",
      description: input.note ?? `Disposição registrada: ${input.disposition}.`,
      occurredAt: input.occurredAt,
      nextActionAt: input.nextAction?.dueAt ?? null,
      nextActionDescription: input.nextAction?.title ?? null,
      newValues: { phoneCallId: input.callId, disposition: input.disposition, nextTaskId: taskId },
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
    },
  });
  return { activityId: activity.id, nextTaskId: taskId };
}
