import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { after } from "next/server";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { normalizeTelephonyAddress } from "@/modules/integrations/domain/telephony-contracts";
import { evaluatePrivacyInTransaction } from "@/modules/privacy/application/privacy-service";
import { logger } from "@/shared/core/logging/logger";

const API_URL = "https://api.topsend.io/api/v1/campaign/audio/send";
const JOB_KIND = "TOPSEND_LEAD_VOICE_V1";
const TOPSEND_VOICE_DELAY_MS = 30_000;
const campaignSchema = z.object({ id: z.string().min(1), status: z.string().min(1) });
const payloadSchema = z.object({ leadId: z.string().uuid() });
const startDateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});

type Target = Readonly<{ workspaceId: string; leadId: string }>;
type Environment = Readonly<Record<string, string | undefined>>;
type Options = Readonly<{
  database: PrismaClient;
  now: () => Date;
  environment?: Environment;
  fetcher?: typeof fetch;
}>;

function loadConfig(environment: Environment) {
  if (environment.TOPSEND_VOICE_ENABLED !== "true") return null;
  const token = environment.TOPSEND_API_TOKEN?.trim();
  const audioId = environment.TOPSEND_VOICE_AUDIO_ID?.trim();
  const audioUrl = environment.TOPSEND_VOICE_AUDIO_URL?.trim();
  if (!token || !audioId || !audioUrl?.startsWith("https://")) return null;
  return { token, audioId, audioUrl };
}

function idempotencyKey(leadId: string) {
  return `topsend-voice:${leadId}:v1`;
}

export async function enqueueTopSendVoiceInTransaction(
  tx: Prisma.TransactionClient,
  input: Target & Readonly<{ actorId: string; receivedAt: Date; phone: string }>,
) {
  if (!loadConfig(process.env) || !/^\+55[1-9]\d{9,10}$/.test(input.phone)) return false;
  const workspace = await tx.workspace.findFirst({
    where: { id: input.workspaceId, slug: "politizai", status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!workspace) return false;
  await tx.job.createMany({
    data: [{
      workspaceId: input.workspaceId,
      type: "NOTIFICATION",
      idempotencyKey: idempotencyKey(input.leadId),
      runAt: new Date(input.receivedAt.getTime() + TOPSEND_VOICE_DELAY_MS),
      maxAttempts: 1,
      payload: { kind: JOB_KIND, leadId: input.leadId },
      createdByActorId: input.actorId,
      updatedByActorId: input.actorId,
    }],
    skipDuplicates: true,
  });
  return true;
}

export function createTopSendVoiceWorker(options: Options) {
  const { database, now } = options;
  const config = loadConfig(options.environment ?? process.env);
  const fetcher = options.fetcher ?? fetch;

  async function processNext(workerId: string, target?: Target) {
    if (!config) return { status: "IDLE" };
    const startedAt = now();
    const job = await database.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string; status: "PENDING" | "RUNNING" }[]>(Prisma.sql`
        SELECT j.id, j.status FROM jobs j JOIN workspaces w ON w.id = j."workspaceId"
        WHERE j.type = 'NOTIFICATION' AND j.payload->>'kind' = ${JOB_KIND}
          AND w.slug = 'politizai' AND w.status = 'ACTIVE' AND w."deletedAt" IS NULL
          ${target ? Prisma.sql`AND j."workspaceId" = ${target.workspaceId}::uuid AND j."idempotencyKey" = ${idempotencyKey(target.leadId)}` : Prisma.empty}
          AND ((j.status = 'PENDING' AND j."runAt" <= ${startedAt})
            OR (j.status = 'RUNNING' AND j."lockExpiresAt" <= ${startedAt}))
        ORDER BY j."runAt", j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
      `);
      if (!row) return null;
      // A TopSend não documenta idempotência. Uma chamada interrompida exige
      // conferência antes de qualquer reenvio, pois pode ter criado a campanha.
      if (row.status === "RUNNING") {
        return tx.job.update({ where: { id: row.id }, data: {
          status: "FAILED", finishedAt: startedAt, errorCode: "TOPSEND_OUTCOME_UNKNOWN",
          lockedAt: null, lockedBy: null, lockExpiresAt: null,
        } });
      }
      return tx.job.update({ where: { id: row.id }, data: {
        status: "RUNNING", lockedBy: workerId, lockedAt: startedAt,
        lockExpiresAt: new Date(startedAt.getTime() + 60_000),
        attempts: { increment: 1 }, lastAttemptAt: startedAt,
      } });
    });
    if (!job) return { status: "IDLE" };
    if (job.status === "FAILED") return { status: "FAILED" };
    const jobId = job.id;

    async function finish(status: "SUCCEEDED" | "FAILED" | "CANCELLED", errorCode: string | null, result?: z.infer<typeof campaignSchema>) {
      const finishedAt = now();
      await database.job.updateMany({
        where: { id: jobId, status: "RUNNING", lockedBy: workerId },
        data: { status, errorCode, finishedAt, cancelledAt: status === "CANCELLED" ? finishedAt : null,
          lockedAt: null, lockedBy: null, lockExpiresAt: null, ...(result ? { result } : {}) },
      });
      if (status === "FAILED") logger.error({ jobId, errorCode }, "Falha no torpedo de voz TopSend");
      return { status };
    }

    let phone: string | null;
    try {
      const { leadId } = payloadSchema.parse(job.payload);
      phone = job.cancelRequestedAt ? null : await database.$transaction(async (tx) => {
        const lead = await tx.lead.findFirst({
          where: { id: leadId, workspaceId: job.workspaceId, deletedAt: null },
          select: { normalizedPhone: true, contactId: true, contactPreference: true },
        });
        if (!lead?.normalizedPhone || !lead.contactId || lead.contactPreference === "DO_NOT_CONTACT") return null;
        const address = normalizeTelephonyAddress(lead.normalizedPhone);
        if (!address.success || address.countryCode !== "55") return null;
        const point = await tx.contactPoint.findFirst({
          where: { workspaceId: job.workspaceId, contactId: lead.contactId, type: "PHONE", normalizedValue: address.e164, deletedAt: null },
          select: { id: true },
        });
        if (!point) return null;
        const privacy = await evaluatePrivacyInTransaction(tx, {
          workspaceId: job.workspaceId, actorId: job.createdByActorId, leadId, contactPointId: point.id,
          channel: "PHONE", intendedAction: "TOPSEND_VOICE_DISPATCH",
        });
        if (privacy.outcome === "DENY") return null;
        const suppression = await tx.telephonySuppression.findFirst({
          where: { workspaceId: job.workspaceId, phoneHash: address.hash, purposeKey: "legacy-commercial-contact" },
          orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
          select: { action: true },
        });
        return suppression?.action === "APPLIED" ? null : address.e164.slice(1);
      });
    } catch {
      return finish("FAILED", "TOPSEND_TARGET_CHECK_FAILED");
    }
    if (!phone) return finish("CANCELLED", "TOPSEND_TARGET_UNAVAILABLE_OR_BLOCKED");

    const body = new FormData();
    body.set("data", JSON.stringify({
      title: `Politizai - ${jobId}`,
      audio_id: config.audioId,
      audio_url: config.audioUrl,
      start_date: startDateFormat.format(now()).replace(" ", "T"),
      type: "TVOZ",
      numbers: [phone],
    }));
    let campaign: z.infer<typeof campaignSchema>;
    try {
      const response = await fetcher(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
        body, redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return finish("FAILED", `TOPSEND_HTTP_${response.status}`);
      campaign = campaignSchema.parse(await response.json());
    } catch {
      return finish("FAILED", "TOPSEND_OUTCOME_UNKNOWN");
    }
    return finish("SUCCEEDED", null, campaign);
  }

  return { processNext };
}

export function wakeTopSendVoiceAfterResponse(database: PrismaClient, target: Target, receivedAt: Date) {
  try {
    after(async () => {
      await sleep(Math.max(0, receivedAt.getTime() + TOPSEND_VOICE_DELAY_MS - Date.now()));
      try {
        await createTopSendVoiceWorker({ database, now: () => new Date() }).processNext(randomUUID(), target);
      } catch {
        logger.error({ leadId: target.leadId, errorCode: "TOPSEND_WORKER_FAILED" }, "Falha ao processar a fila de voz TopSend");
      }
    });
  } catch {
    // Fora de uma requisição Next.js, o worker da fila assume o trabalho.
  }
}
