import type { Instrumentation } from "next";

import { resolveCorrelationId } from "@/shared/core/http/correlation";
import { logger } from "@/shared/core/logging/logger";

export function register(): void {
  logger.info({ runtime: process.env.NEXT_RUNTIME ?? "unknown" }, "Runtime web inicializado");
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(key, Array.isArray(value) ? value.join(",") : value);
    }
  }
  logger.error({
    correlationId: resolveCorrelationId(headers),
    errorName: error instanceof Error ? error.name : "UnknownError",
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
  }, "Erro não tratado capturado pela instrumentação do Next.js");
};
