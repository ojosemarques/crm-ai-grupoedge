import { randomUUID } from "node:crypto";

import { z } from "zod";

import { MillionSendProviderError, MillionSendTransport } from "@/modules/integrations/application/millionsend-transport";
import { createOpenDotHttpClient } from "@/modules/prospecting/application/open-dot-http-client";

const claimResponseSchema = z.object({
  jobs: z.array(z.object({
    id: z.string().uuid(),
    recipient: z.string().email(),
    sender: z.string().email(),
    replyTo: z.string().email().nullable().optional(),
    subject: z.string().min(1),
    body: z.string(),
    idempotencyKey: z.string().min(8),
  }).passthrough()),
}).passthrough();

const revalidationResponseSchema = z.object({
  authorized: z.boolean(),
  disposition: z.string(),
}).passthrough();

type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

export function loadMillionSendWorkerConfig(environment: WorkerEnvironment = process.env) {
  if (environment.MILLIONSEND_ENABLED !== "true") return null;
  const baseUrl = z.string().url().parse(environment.APP_CANONICAL_URL);
  const parsed = new URL(baseUrl);
  if (environment.NODE_ENV === "production" && parsed.protocol !== "https:") throw new Error("MILLIONSEND_CANONICAL_URL_MUST_USE_HTTPS");
  return Object.freeze({
    baseUrl,
    clientId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/).parse(environment.MILLIONSEND_OPEN_DOT_CLIENT_ID),
    secret: z.string().min(32).parse(environment.MILLIONSEND_OPEN_DOT_SECRET),
    apiKey: z.string().startsWith("ms_").min(12).parse(environment.MILLIONSEND_API_KEY),
  });
}

type WorkerOptions = Readonly<{
  environment?: WorkerEnvironment;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}>;

export function createMillionSendProspectingWorker(options: WorkerOptions = {}) {
  const environment = options.environment ?? process.env;
  const config = loadMillionSendWorkerConfig(environment);
  if (!config) return Object.freeze({ processNext: async () => ({ status: "IDLE" }) });

  const now = options.now ?? (() => new Date());
  const openDot = createOpenDotHttpClient({ ...config, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), now });
  const transport = new MillionSendTransport({ externalEgress: true, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });

  async function receipt(jobId: string, body: Record<string, unknown>) {
    return openDot.post(
      `/api/integrations/open-dot/v1/email-jobs/${jobId}/receipt`,
      body,
      `ms-receipt:${jobId}:${randomUUID()}`,
    );
  }

  return Object.freeze({
    async processNext(): Promise<Readonly<{ status: string }>> {
      const claim = claimResponseSchema.parse(await openDot.post(
        "/api/integrations/open-dot/v1/email-jobs/claim",
        { limit: 1, leaseSeconds: 120 },
        `ms-claim:${randomUUID()}`,
      ));
      const job = claim.jobs[0];
      if (!job) return { status: "IDLE" };

      const revalidation = revalidationResponseSchema.parse(await openDot.post(
        `/api/integrations/open-dot/v1/email-jobs/${job.id}/revalidate`,
        {},
        `ms-revalidate:${job.id}:${randomUUID()}`,
      ));
      if (!revalidation.authorized) return { status: revalidation.disposition };

      try {
        const result = await transport.send({
          from: job.sender,
          ...(job.replyTo !== undefined ? { replyTo: job.replyTo } : {}),
          to: [job.recipient],
          subject: job.subject,
          text: job.body,
          messageId: `<${job.id}@politizai.com>`,
          idempotencyKey: job.idempotencyKey,
        }, config.apiKey);
        await receipt(job.id, {
          outcome: "SENT",
          providerMessageId: result.providerMessageId,
          occurredAt: result.acceptedAt.toISOString(),
        });
        return { status: "SENT" };
      } catch (error) {
        const occurredAt = now().toISOString();
        if (error instanceof MillionSendProviderError && !error.outcomeUncertain) {
          await receipt(job.id, { outcome: "FAILED", errorCode: error.code, retryable: error.retryable, occurredAt });
          return { status: error.retryable ? "RETRY_SCHEDULED" : "FAILED" };
        }
        await receipt(job.id, { outcome: "RECONCILIATION_REQUIRED", occurredAt });
        return { status: "RECONCILIATION_REQUIRED" };
      }
    },
  });
}
