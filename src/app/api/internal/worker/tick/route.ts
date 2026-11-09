import { NextResponse } from "next/server";
import { z } from "zod";

import { createDefaultWorkerBatchRunner } from "@/modules/automations/application/worker-runtime";
import { getConversionFeedbackService } from "@/modules/conversion-feedback/application/conversion-feedback-service";
import {
  assertServerlessWorkerEnabled,
  assertServerlessWorkerRequest,
  loadServerlessWorkerPolicy,
} from "@/modules/automations/domain/serverless-worker-policy";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { ConfigurationError } from "@/shared/core/errors/application-error";
import { correlationResponseHeaders, resolveCorrelationId } from "@/shared/core/http/correlation";
import { logger } from "@/shared/core/logging/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function logMetaDiagnostics(correlationId: string) {
  if (process.env.VERCEL_ENV !== "production" || process.env.META_ADS_CONVERSIONS_DIAGNOSTICS_ENABLED !== "true") return;
  const workspace = z.uuid().safeParse(process.env.META_ADS_REPORTING_WORKSPACE_ID);
  if (!workspace.success) {
    logger.warn({ correlationId }, "META_CONVERSION_DIAGNOSTICS_WORKSPACE_MISSING");
    return;
  }
  try {
    const diagnostics = await getConversionFeedbackService().getDeliveryDiagnostics(workspace.data);
    logger.info({ correlationId, diagnostics }, "META_CONVERSION_DIAGNOSTICS");
  } catch {
    logger.warn({ correlationId }, "META_CONVERSION_DIAGNOSTICS_UNAVAILABLE");
  }
}

async function runTick(request: Request): Promise<NextResponse> {
  const correlationId = resolveCorrelationId(request.headers);
  let runtimeWorker: ReturnType<typeof createDefaultWorkerBatchRunner> | undefined;
  try {
    if (request.method === "GET" && process.env.VERCEL_ENV === "production"
      && process.env.SERVERLESS_WORKER_ENABLED === "false"
      && process.env.META_ADS_CONVERSIONS_WORKER_ENABLED === "true") {
      const secret = process.env.CRON_SECRET?.trim() ?? "";
      if (secret.length < 32) throw new ConfigurationError(["CRON_SECRET"]);
      assertServerlessWorkerRequest(request, { secret });

      const workspace = z.uuid().safeParse(process.env.META_ADS_REPORTING_WORKSPACE_ID);
      if (!workspace.success) throw new ConfigurationError(["META_ADS_REPORTING_WORKSPACE_ID"]);
      const service = getConversionFeedbackService();
      const { status } = await service.processNext(`meta-cron:${correlationId}`, workspace.data);
      logger.info({ correlationId, code: status }, "Tick de conversões Meta concluído");
      await logMetaDiagnostics(correlationId);
      return NextResponse.json({ status }, {
        headers: { ...correlationResponseHeaders(correlationId), "Cache-Control": "no-store" },
      });
    }
    const policy = loadServerlessWorkerPolicy(process.env);
    assertServerlessWorkerRequest(request, policy);
    assertServerlessWorkerEnabled(policy);
    const config = getApplicationConfig();
    runtimeWorker = createDefaultWorkerBatchRunner(config);
    const result = await runtimeWorker.runner.run({
      workerId: `serverless:${correlationId}`,
      maxJobs: policy.maxJobs,
      maxDurationMs: policy.maxDurationMs,
    });
    logger.info({ correlationId, code: result.code, processed: result.processed }, "Tick serverless do worker concluído");
    await logMetaDiagnostics(correlationId);
    return NextResponse.json(
      {
        code: result.code,
        processed: result.processed,
        published: result.published,
        elapsedMs: result.elapsedMs,
        outcomes: result.outcomes,
        correlationId,
      },
      {
        status: 200,
        headers: {
          ...correlationResponseHeaders(correlationId),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return handleRouteError(error, request);
  } finally {
    await runtimeWorker?.database.$disconnect();
  }
}

export const GET = runTick;
export const POST = runTick;
