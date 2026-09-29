import { NextResponse } from "next/server";

import { createDefaultWorkerBatchRunner } from "@/modules/automations/application/worker-runtime";
import {
  assertServerlessWorkerEnabled,
  assertServerlessWorkerRequest,
  loadServerlessWorkerPolicy,
} from "@/modules/automations/domain/serverless-worker-policy";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { handleRouteError } from "@/shared/core/errors/route-error-handler";
import { correlationResponseHeaders, resolveCorrelationId } from "@/shared/core/http/correlation";
import { logger } from "@/shared/core/logging/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function runTick(request: Request): Promise<NextResponse> {
  const correlationId = resolveCorrelationId(request.headers);
  let runtimeWorker: ReturnType<typeof createDefaultWorkerBatchRunner> | undefined;
  try {
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
