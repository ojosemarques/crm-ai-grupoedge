import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { MillionSendProviderError, MillionSendTransport } from "@/modules/integrations/application/millionsend-transport";
import { calculateRetryDelaySeconds } from "@/modules/integrations/domain/integration-policy";

const JOB_KIND = "MEETING_PARTICIPANT_EMAIL_V1";
const REMINDER_MINUTES = [180, 60, 30, 0] as const;

type Transaction = Prisma.TransactionClient;
type EmailKind = "INVITATION" | "REMINDER";
type JobPayload = Readonly<{
  kind: typeof JOB_KIND;
  emailKind: EmailKind;
  meetingId: string;
  meetingRevision: number;
  reminderMinutes: number | null;
}>;

type WorkerEnvironment = Readonly<Record<string, string | undefined>>;
type WorkerOptions = Readonly<{
  database: PrismaClient;
  now: () => Date;
  environment?: WorkerEnvironment;
  fetchImpl?: typeof fetch;
  lockTimeoutSeconds?: number;
  backoffBaseSeconds?: number;
}>;

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function parsePayload(value: Prisma.JsonValue): JobPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MEETING_PARTICIPANT_EMAIL_JOB_INVALID");
  if (
    value.kind !== JOB_KIND ||
    (value.emailKind !== "INVITATION" && value.emailKind !== "REMINDER") ||
    typeof value.meetingId !== "string" ||
    typeof value.meetingRevision !== "number" ||
    (value.reminderMinutes !== null && typeof value.reminderMinutes !== "number")
  ) throw new Error("MEETING_PARTICIPANT_EMAIL_JOB_INVALID");
  return {
    kind: JOB_KIND,
    emailKind: value.emailKind,
    meetingId: value.meetingId,
    meetingRevision: value.meetingRevision,
    reminderMinutes: value.reminderMinutes,
  };
}

export function meetingParticipantEmailSchedule(startsAt: Date, occurredAt: Date) {
  return REMINDER_MINUTES.flatMap((reminderMinutes) => {
    const runAt = new Date(startsAt.getTime() - reminderMinutes * 60_000);
    return runAt >= occurredAt ? [{ reminderMinutes, runAt }] : [];
  });
}

async function cancelPendingParticipantEmailJobs(
  transaction: Transaction,
  input: Readonly<{ workspaceId: string; meetingId: string; actorId: string; occurredAt: Date; reasonCode: string }>,
) {
  const cancelled = await transaction.$executeRaw(Prisma.sql`
    UPDATE "jobs"
    SET "status" = 'CANCELLED',
        "cancelRequestedAt" = ${input.occurredAt},
        "cancelledAt" = ${input.occurredAt},
        "finishedAt" = ${input.occurredAt},
        "errorCode" = ${input.reasonCode},
        "lastError" = 'Envio cancelado porque a reunião mudou.',
        "updatedByActorId" = ${input.actorId}::uuid,
        "updatedAt" = ${input.occurredAt}
    WHERE "workspaceId" = ${input.workspaceId}::uuid
      AND "type" = 'NOTIFICATION'
      AND "status" = 'PENDING'
      AND "payload"->>'kind' = ${JOB_KIND}
      AND "payload"->>'meetingId' = ${input.meetingId}
  `);
  await transaction.$executeRaw(Prisma.sql`
    UPDATE "jobs"
    SET "cancelRequestedAt" = ${input.occurredAt},
        "updatedByActorId" = ${input.actorId}::uuid,
        "updatedAt" = ${input.occurredAt}
    WHERE "workspaceId" = ${input.workspaceId}::uuid
      AND "type" = 'NOTIFICATION'
      AND "status" = 'RUNNING'
      AND "payload"->>'kind' = ${JOB_KIND}
      AND "payload"->>'meetingId' = ${input.meetingId}
  `);
  return cancelled;
}

export async function cancelMeetingParticipantEmailsInTransaction(
  transaction: Transaction,
  input: Readonly<{ workspaceId: string; meetingId: string; actorId: string; occurredAt: Date; reasonCode: string }>,
) {
  return cancelPendingParticipantEmailJobs(transaction, input);
}

export async function scheduleMeetingParticipantEmailsInTransaction(
  transaction: Transaction,
  input: Readonly<{
    workspaceId: string;
    meetingId: string;
    meetingRevision: number;
    participantEmail: string | null;
    startsAt: Date;
    occurredAt: Date;
    actorId: string;
    includeInvitation: boolean;
  }>,
) {
  const cancelled = await cancelPendingParticipantEmailJobs(transaction, {
    workspaceId: input.workspaceId,
    meetingId: input.meetingId,
    actorId: input.actorId,
    occurredAt: input.occurredAt,
    reasonCode: "MEETING_PARTICIPANT_EMAIL_SUPERSEDED",
  });
  if (!input.participantEmail) return Object.freeze({ scheduled: 0, cancelled });

  const definitions: Array<Readonly<{ emailKind: EmailKind; reminderMinutes: number | null; runAt: Date; priority: number }>> = [];
  if (input.includeInvitation) definitions.push({ emailKind: "INVITATION", reminderMinutes: null, runAt: input.occurredAt, priority: 95 });
  for (const reminder of meetingParticipantEmailSchedule(input.startsAt, input.occurredAt)) {
    definitions.push({ emailKind: "REMINDER", reminderMinutes: reminder.reminderMinutes, runAt: reminder.runAt, priority: reminder.reminderMinutes === 0 ? 100 : 90 });
  }

  for (const definition of definitions) {
    const suffix = definition.emailKind === "INVITATION" ? "invitation" : `m${definition.reminderMinutes}`;
    const idempotencyKey = `meeting-participant-email:${input.meetingId}:r${input.meetingRevision}:${suffix}`;
    await transaction.job.upsert({
      where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey } },
      update: {},
      create: {
        workspaceId: input.workspaceId,
        type: "NOTIFICATION",
        status: "PENDING",
        idempotencyKey,
        priority: definition.priority,
        runAt: definition.runAt,
        maxAttempts: 5,
        payload: json({
          kind: JOB_KIND,
          emailKind: definition.emailKind,
          meetingId: input.meetingId,
          meetingRevision: input.meetingRevision,
          reminderMinutes: definition.reminderMinutes,
        } satisfies JobPayload),
        createdByActorId: input.actorId,
        updatedByActorId: input.actorId,
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt,
      },
    });
  }
  return Object.freeze({ scheduled: definitions.length, cancelled });
}

function loadConfig(environment: WorkerEnvironment) {
  if (environment.MILLIONSEND_ENABLED !== "true") return null;
  const apiKey = environment.MILLIONSEND_API_KEY?.trim();
  if (!apiKey?.startsWith("ms_") || apiKey.length < 12) throw new Error("MILLIONSEND_API_KEY_MISSING");
  return { apiKey };
}

function dateTimeLabel(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(value);
}

function reminderLabel(minutes: number) {
  if (minutes === 180) return "3 horas";
  if (minutes === 60) return "1 hora";
  if (minutes === 30) return "30 minutos";
  return "agora";
}

export function buildMeetingParticipantEmail(input: Readonly<{
  emailKind: EmailKind;
  reminderMinutes: number | null;
  title: string;
  leadName: string;
  closerName: string;
  startsAt: Date;
  timeZone: string;
  conferenceUrl: string | null;
}>) {
  const when = dateTimeLabel(input.startsAt, input.timeZone);
  const join = input.conferenceUrl ? `\nLink da reunião: ${input.conferenceUrl}` : "";
  if (input.emailKind === "INVITATION") {
    return {
      subject: `Convite: ${input.title}`,
      text: `Você foi convidado(a) para a reunião “${input.title}”.\n\nData e horário: ${when}\nResponsável: ${input.closerName}\nContato: ${input.leadName}${join}\n\nO convite também será sincronizado pelo Google Agenda quando a conta do responsável estiver conectada.`,
    };
  }
  const label = reminderLabel(input.reminderMinutes ?? 0);
  return {
    subject: input.reminderMinutes === 0 ? `A reunião “${input.title}” começa agora` : `Lembrete: reunião em ${label}`,
    text: `Lembrete da reunião “${input.title}”.\n\nHorário: ${when}\nResponsável: ${input.closerName}\nContato: ${input.leadName}${join}`,
  };
}

export function createMeetingParticipantEmailWorker(options: WorkerOptions) {
  const environment = options.environment ?? process.env;
  const config = loadConfig(environment);
  if (!config) return Object.freeze({ processNext: async () => ({ status: "IDLE" as const }) });
  const apiKey = config.apiKey;
  const transport = new MillionSendTransport({ externalEgress: true, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const lockTimeoutSeconds = options.lockTimeoutSeconds ?? 60;
  const backoffBaseSeconds = options.backoffBaseSeconds ?? 5;

  async function claim(workerId: string) {
    const now = options.now();
    return options.database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT "id" FROM "jobs"
        WHERE "type" = 'NOTIFICATION'
          AND "payload"->>'kind' = ${JOB_KIND}
          AND (("status" = 'PENDING' AND "runAt" <= ${now})
            OR ("status" = 'RUNNING' AND "lockExpiresAt" < ${now}))
        ORDER BY "priority" DESC, "runAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED LIMIT 1
      `);
      if (!rows[0]) return null;
      return transaction.job.update({
        where: { id: rows[0].id },
        data: {
          status: "RUNNING",
          lockedAt: now,
          lockedBy: workerId,
          lockExpiresAt: new Date(now.getTime() + lockTimeoutSeconds * 1_000),
          attempts: { increment: 1 },
          lastAttemptAt: now,
        },
      });
    }, { isolationLevel: "ReadCommitted" });
  }

  async function finishCancelled(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, code: string) {
    const now = options.now();
    await options.database.job.updateMany({
      where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId },
      data: { status: "CANCELLED", cancelledAt: now, finishedAt: now, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: code, lastError: "Envio cancelado após revalidação da reunião." },
    });
    return { status: "CANCELLED" as const, code };
  }

  async function fail(job: NonNullable<Awaited<ReturnType<typeof claim>>>, workerId: string, error: unknown) {
    const permanent = error instanceof MillionSendProviderError && !error.retryable && !error.outcomeUncertain;
    const terminal = permanent || job.attempts >= job.maxAttempts;
    const now = options.now();
    const delay = terminal ? null : calculateRetryDelaySeconds(job.attempts, backoffBaseSeconds);
    const code = error instanceof MillionSendProviderError ? error.code : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "MILLIONSEND_MEETING_EMAIL_FAILED";
    await options.database.job.updateMany({
      where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId },
      data: {
        status: terminal ? "FAILED" : "PENDING",
        runAt: delay === null ? job.runAt : new Date(now.getTime() + delay * 1_000),
        finishedAt: terminal ? now : null,
        lockedAt: null,
        lockedBy: null,
        lockExpiresAt: null,
        errorCode: code,
        lastError: "Falha controlada no envio do e-mail da reunião.",
      },
    });
    return { status: terminal ? "FAILED" as const : "RETRY_PENDING" as const, code };
  }

  async function processNext(workerId: string) {
    const job = await claim(workerId);
    if (!job) return { status: "IDLE" as const };
    try {
      const data = parsePayload(job.payload);
      if (job.cancelRequestedAt) return finishCancelled(job, workerId, "MEETING_PARTICIPANT_EMAIL_CANCEL_REQUESTED");
      const meeting = await options.database.meeting.findFirst({
        where: { id: data.meetingId, workspaceId: job.workspaceId, deletedAt: null },
        include: {
          lead: { select: { fullName: true } },
          owner: { select: { user: { select: { displayName: true } } } },
          googleCalendarLink: { select: { conferenceUrl: true } },
        },
      });
      const now = options.now();
      if (!meeting || !meeting.participantEmail || !["SCHEDULED", "CONFIRMED"].includes(meeting.status) || meeting.endsAt <= now) {
        return finishCancelled(job, workerId, "MEETING_PARTICIPANT_EMAIL_STALE");
      }
      const [profile, suppression, currentJob] = await Promise.all([
        options.database.emailConnectionProfile.findFirst({
          where: {
            workspaceId: job.workspaceId,
            operatingMode: "EXTERNAL_READY",
            spfStatus: "VERIFIED_EXTERNAL",
            dkimStatus: "VERIFIED_EXTERNAL",
            dmarcStatus: "VERIFIED_EXTERNAL",
            connection: { enabled: true },
          },
          orderBy: [{ lastSuccessAt: "desc" }, { validatedAt: "desc" }, { createdAt: "asc" }],
        }),
        options.database.emailSuppression.findFirst({
          where: { workspaceId: job.workspaceId, normalizedEmail: meeting.participantEmail, action: "APPLIED" },
          orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
          select: { id: true },
        }),
        options.database.job.findUnique({ where: { id: job.id }, select: { cancelRequestedAt: true } }),
      ]);
      if (!profile) throw new Error("MEETING_PARTICIPANT_EMAIL_SENDER_NOT_READY");
      if (suppression) return finishCancelled(job, workerId, "MEETING_PARTICIPANT_EMAIL_SUPPRESSED");
      if (currentJob?.cancelRequestedAt) return finishCancelled(job, workerId, "MEETING_PARTICIPANT_EMAIL_CANCEL_REQUESTED");
      const content = buildMeetingParticipantEmail({
        emailKind: data.emailKind,
        reminderMinutes: data.reminderMinutes,
        title: meeting.title,
        leadName: meeting.lead.fullName,
        closerName: meeting.owner.user.displayName,
        startsAt: meeting.startsAt,
        timeZone: meeting.timeZone,
        conferenceUrl: meeting.googleCalendarLink?.conferenceUrl ?? null,
      });
      const result = await transport.send({
        from: profile.senderAddressNormalized,
        replyTo: profile.replyTo,
        to: [meeting.participantEmail],
        subject: content.subject,
        text: content.text,
        messageId: `<${job.id}@politizai.com>`,
        idempotencyKey: job.idempotencyKey,
      }, apiKey);
      const completedAt = options.now();
      return options.database.$transaction(async (transaction) => {
        const changed = await transaction.job.updateMany({
          where: { id: job.id, workspaceId: job.workspaceId, status: "RUNNING", lockedBy: workerId },
          data: { status: "SUCCEEDED", result: json({ provider: "MILLIONSEND", providerMessageId: result.providerMessageId, emailKind: data.emailKind, reminderMinutes: data.reminderMinutes }), finishedAt: completedAt, lockedAt: null, lockedBy: null, lockExpiresAt: null, errorCode: null, lastError: null },
        });
        if (changed.count !== 1) return { status: "LOST_LOCK" as const };
        await transaction.emailConnectionProfile.update({ where: { id: profile.id }, data: { lastSuccessAt: completedAt, updatedByActorId: job.updatedByActorId } });
        await transaction.auditLog.create({ data: { workspaceId: job.workspaceId, actorId: job.updatedByActorId, action: "meeting.participant_email_sent", entityType: "Meeting", entityId: meeting.id, origin: "SYSTEM", occurredAt: completedAt, changes: { provider: "MILLIONSEND", emailKind: data.emailKind, reminderMinutes: data.reminderMinutes, meetingRevision: data.meetingRevision } } });
        return { status: "SUCCEEDED" as const, emailKind: data.emailKind, reminderMinutes: data.reminderMinutes };
      });
    } catch (error) {
      return fail(job, workerId, error);
    }
  }

  return Object.freeze({ processNext });
}
